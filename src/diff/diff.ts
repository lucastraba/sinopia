import { linkTargets } from '../links.js';
import type {
  Gap,
  Graph,
  GraphDiff,
  OperationChange,
  PartLink,
  RouteChange,
  TouchedPart,
} from '../model.js';

/** Links between parts, from every kind of file link, with one file-level example each. */
export const partLinks = (graph: Graph): Map<string, PartLink> => {
  const partByFile = new Map(graph.files.map((file) => [file.id, file.part]));
  const links = new Map<string, PartLink>();
  for (const file of graph.files) {
    if (file.kind === 'test') continue;
    for (const target of linkTargets(file)) {
      const to = partByFile.get(target);
      if (!to || to === file.part) continue;
      const key = `${file.part} -> ${to}`;
      if (!links.has(key)) {
        links.set(key, {
          from: file.part,
          to,
          example: `${file.id.split('/').pop()} -> ${target.split('/').pop()}`,
        });
      }
    }
  }
  return links;
};

const areaOf = (path: string): string => {
  const segments = path.split('/');
  return segments[0] === 'packages'
    ? segments.slice(0, 3).join('/')
    : (segments[0] ?? path);
};

const parseNameStatus = (nameStatus: string, untracked: string) => {
  const changes: { status: 'A' | 'M' | 'D'; path: string }[] = [];
  for (const line of nameStatus.split('\n')) {
    const [status, path] = line.split('\t');
    if (!status || !path) continue;
    const letter = status.charAt(0);
    changes.push({
      status: letter === 'A' || letter === 'D' ? letter : 'M',
      path,
    });
  }
  for (const path of untracked.split('\n')) {
    if (path) changes.push({ status: 'A', path });
  }
  return changes;
};

const sameList = (a: string[], b: string[]) => a.join('|') === b.join('|');

const routeSummary = (graph: Graph, path: string): string => {
  const route = graph.routes.find((candidate) => candidate.path === path);
  if (!route) return '';
  const parts = [
    route.component
      ? route.component.split('/').pop()
      : `redirect ${route.redirect ?? ''}`,
    route.feature ? `entitlement ${route.feature}` : 'no entitlement',
    route.flags.length > 0 ? `flags ${route.flags.join(', ')}` : '',
  ];
  return parts.filter(Boolean).join(', ');
};

const flagParts = (graph: Graph) => {
  const map = new Map<string, Set<string>>();
  for (const file of graph.files) {
    if (file.kind === 'test') continue;
    for (const flag of file.flags)
      map.set(flag, (map.get(flag) ?? new Set()).add(file.part));
  }
  return map;
};

const registered = (graph: Graph) =>
  new Map(
    graph.files.flatMap((file) =>
      file.registeredAs ? [[file.registeredAs, file.part] as const] : []
    )
  );

const gapKey = (gap: Gap) => `${gap.kind}|${gap.file ?? ''}|${gap.detail}`;

/**
 * Compares the graph at the base with the graph at the head and lists what a
 * reviewer should notice: parts touched, new links between parts and new
 * cycles, server calls and the services behind them, screens and their gates,
 * flags, and anything that crosses the boundary the map declares (POCs).
 * `partOf` places changed files that neither graph holds (repo-relative paths).
 */
export const diffGraphs = (
  base: Graph,
  head: Graph,
  nameStatus: string,
  untracked: string,
  notes: Record<string, string>,
  partOf: (path: string) => string | null
): GraphDiff => {
  const changes = parseNameStatus(nameStatus, untracked);
  const { meta } = head;
  const srcPrefix = meta.srcDir ? `${meta.srcDir}/` : '';
  const libraryComponent = meta.library ? new RegExp(meta.library.componentPath) : null;
  const partKinds = new Map([...base.parts, ...head.parts].map((part) => [part.id, part.kind]));
  const boundaryKinds = new Set(meta.boundary?.partKinds ?? []);
  const isBoundary = (part: string): boolean => boundaryKinds.has(partKinds.get(part) ?? '');
  const boundaryName = meta.boundary?.name ?? '';

  const touched = new Map<string, TouchedPart>();
  const outside = new Map<string, string[]>();
  const hdsNames = new Set<string>();
  for (const { status, path } of changes) {
    if (path.startsWith(srcPrefix)) {
      const part = partOf(path) ?? 'no part';
      const entry = touched.get(part) ?? {
        part,
        added: [],
        modified: [],
        removed: [],
      };
      const list =
        status === 'A'
          ? entry.added
          : status === 'D'
            ? entry.removed
            : entry.modified;
      list.push(path.slice(srcPrefix.length));
      touched.set(part, entry);
      continue;
    }
    const area = areaOf(path);
    outside.set(area, [...(outside.get(area) ?? []), path]);
    const component = libraryComponent?.exec(path)?.[1];
    if (component) hdsNames.add(component);
  }

  const hdsComponents = [...hdsNames].toSorted().map((name) => ({
    name,
    usedByParts: [
      ...new Set(
        head.files
          .filter((file) =>
            file.components.some(
              (use) => use.tag === name && use.library === meta.library?.package
            )
          )
          .map((file) => file.part)
      ),
    ].toSorted(),
  }));

  const baseLinks = partLinks(base);
  const headLinks = partLinks(head);
  const newPartLinks = [...headLinks]
    .filter(([key]) => !baseLinks.has(key))
    .map(([, link]) => link);
  const removedPartLinks = [...baseLinks]
    .filter(([key]) => !headLinks.has(key))
    .map(([, link]) => link);

  const baseCycles = new Set(base.cycles.map((cycle) => cycle.join(' > ')));
  const newCycles = head.cycles.filter(
    (cycle) => !baseCycles.has(cycle.join(' > '))
  );

  const baseOperations = new Map(
    base.operations.map((operation) => [operation.name, operation])
  );
  const headOperations = new Map(
    head.operations.map((operation) => [operation.name, operation])
  );
  const operations: OperationChange[] = [];
  for (const [name, operation] of headOperations) {
    const before = baseOperations.get(name);
    if (before && before.hash === operation.hash) continue;
    operations.push({
      name,
      change: before ? 'changed' : 'added',
      type: operation.type,
      part: operation.part,
      subgraphs: operation.subgraphs,
      newFields: operation.fields.filter(
        (field) => !before?.fields.includes(field)
      ),
    });
  }
  for (const [name, operation] of baseOperations) {
    if (!headOperations.has(name)) {
      operations.push({
        name,
        change: 'removed',
        type: operation.type,
        part: operation.part,
        subgraphs: operation.subgraphs,
        newFields: [],
      });
    }
  }

  const routes: RouteChange[] = [];
  const baseRoutes = new Map(base.routes.map((route) => [route.path, route]));
  const headRoutes = new Map(head.routes.map((route) => [route.path, route]));
  for (const [path, route] of headRoutes) {
    const before = baseRoutes.get(path);
    if (!before) {
      routes.push({ path, change: 'added', detail: routeSummary(head, path) });
    } else if (
      before.component !== route.component ||
      before.feature !== route.feature ||
      before.redirect !== route.redirect ||
      !sameList(before.flags, route.flags) ||
      !sameList(before.guards, route.guards) ||
      !sameList(before.extraComponents, route.extraComponents)
    ) {
      routes.push({
        path,
        change: 'changed',
        detail: `was ${routeSummary(base, path)}; now ${routeSummary(head, path)}`,
      });
    }
  }
  for (const path of baseRoutes.keys()) {
    if (!headRoutes.has(path))
      routes.push({
        path,
        change: 'removed',
        detail: routeSummary(base, path),
      });
  }

  const baseFlagParts = flagParts(base);
  const flagUses = [...flagParts(head)]
    .map(([flag, parts]) => ({
      flag,
      parts: [...parts]
        .filter((part) => !baseFlagParts.get(flag)?.has(part))
        .toSorted(),
    }))
    .filter((use) => use.parts.length > 0)
    .toSorted((a, b) => a.flag.localeCompare(b.flag));

  const pocBoundary: string[] = [];
  if (meta.boundary) {
    for (const link of newPartLinks) {
      if (!isBoundary(link.from) && isBoundary(link.to)) {
        pocBoundary.push(
          `production part ${link.from} now reaches ${boundaryName} part ${link.to} (${link.example})`
        );
      }
    }
    for (const part of head.parts) {
      if (
        isBoundary(part.id) &&
        !base.parts.some((candidate) => candidate.id === part.id)
      ) {
        pocBoundary.push(`new ${boundaryName} part ${part.id}`);
      }
    }
    const baseRegistered = registered(base);
    for (const [name, part] of registered(head)) {
      if (!baseRegistered.has(name)) {
        pocBoundary.push(
          `${name} (${part}) is newly registered by name${isBoundary(part) ? ` as a ${boundaryName} component` : ''}`
        );
      }
    }
  }

  const baseGaps = new Set(base.gaps.map(gapKey));
  const newGaps = head.gaps.filter((gap) => !baseGaps.has(gapKey(gap)));

  return {
    meta,
    has: {
      operations: base.operations.length + head.operations.length > 0,
      routes: base.routes.length + head.routes.length > 0,
      flags: base.flags.length + head.flags.length > 0,
    },
    base: { label: base.source.label, sha: base.source.sha ?? '' },
    head: head.source,
    touchedParts: [...touched.values()].toSorted((a, b) =>
      a.part.localeCompare(b.part)
    ),
    outsideMain: [...outside]
      .map(([area, files]) => ({ area, files }))
      .toSorted((a, b) => a.area.localeCompare(b.area)),
    hdsComponents,
    newPartLinks,
    removedPartLinks,
    newCycles,
    operations: operations.toSorted((a, b) => a.name.localeCompare(b.name)),
    routes,
    newFlags: head.flags.filter((flag) => !base.flags.includes(flag)),
    removedFlags: base.flags.filter((flag) => !head.flags.includes(flag)),
    flagUses,
    pocBoundary,
    newGaps,
    notes,
  };
};
