import { linkTargets } from '../links';
import type { FileKind, Route } from '../model';
import {
  type Change,
  fileLabel,
  fileName,
  type MapIndex,
  type Mode,
  operationLabel,
  partLabel,
} from './mapIndex';

export type Tone =
  | 'feature'
  | 'poc'
  | 'core'
  | 'app'
  | 'subgraph'
  | 'query'
  | 'mutation'
  | 'view'
  | 'component'
  | 'logic'
  | 'external';

export type SelectionKind = 'part' | 'file' | 'operation' | 'subgraph';

export interface MapNode {
  id: string;
  label: string;
  sublabel: string;
  tone: Tone;
  group: string | null;
  select: { kind: SelectionKind; id: string };
  change: Change | null;
  badge: string | null;
  width: number;
  height: number;
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  dashed: boolean;
  highlight: boolean;
}

export interface MapGroup {
  id: string;
  label: string;
}

export interface MapModel {
  nodes: MapNode[];
  edges: MapEdge[];
  groups: MapGroup[];
  /** Which group sits above which on the overview (group ids). */
  groupFlow?: [string, string][];
  /** 'grouped' packs cards inside each group; 'layered' draws a flow along the edges. */
  layout: 'grouped' | 'layered';
}

const CARD = { width: 220, height: 64 };
const SMALL = { width: 170, height: 52 };

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

// Card colours by part kind; kinds an adapter invents fall back to the core colour.
const PART_TONES: Record<string, Tone> = {
  feature: 'feature',
  poc: 'poc',
  core: 'core',
  app: 'app',
  package: 'feature',
  folder: 'core',
  root: 'app',
};

const toneOfPart = (kind: string): Tone => PART_TONES[kind] ?? 'core';

const toneOfFile = (kind: FileKind): Tone =>
  kind === 'view' ? 'view' : kind === 'component' ? 'component' : 'logic';

const subgraphNode = (name: string): MapNode => ({
  id: `subgraph:${name}`,
  label: name,
  sublabel: 'Backend service',
  tone: 'subgraph',
  group: null,
  select: { kind: 'subgraph', id: name },
  change: null,
  badge: null,
  ...SMALL,
});

const operationNode = (index: MapIndex, name: string, mode: Mode): MapNode => {
  const operation = index.operations.get(name);
  return {
    id: `operation:${name}`,
    label: operationLabel(index, name, mode),
    sublabel: [
      operation?.type === 'mutation' ? 'Saves' : 'Asks for',
      operation?.subgraphs.join(', ') ?? '',
    ]
      .filter(Boolean)
      .join(' · '),
    tone: operation?.type === 'mutation' ? 'mutation' : 'query',
    group: null,
    select: { kind: 'operation', id: name },
    change: index.changedOperations.has(name) ? 'modified' : null,
    badge: null,
    ...SMALL,
  };
};

const fileNode = (
  index: MapIndex,
  id: string,
  mode: Mode,
  group: string | null = null
): MapNode => {
  const file = index.files.get(id);
  const routes = index.routesByComponent.get(id) ?? [];
  return {
    id: `file:${id}`,
    label: fileLabel(index, id, mode),
    sublabel:
      routes[0] && routes[0].component === id
        ? routes[0].path
        : mode === 'plain'
          ? fileName(id)
          : (file?.kind ?? ''),
    tone: toneOfFile(file?.kind ?? 'other'),
    group,
    select: { kind: 'file', id },
    change: index.changedFiles.get(id) ?? null,
    badge: null,
    ...CARD,
  };
};

/** Files the plain view leaves out: tests, generated code, types and translations. */
export const isShown = (kind: FileKind, mode: Mode): boolean =>
  kind !== 'test' &&
  kind !== 'generated' &&
  (mode === 'dev' || (kind !== 'type' && kind !== 'locale'));

/** The whole app: every part in its group, and the backend services behind them. */
export const appModel = (index: MapIndex, mode: Mode): MapModel => {
  const nodes: MapNode[] = index.graph.parts.map((part) => ({
    id: `part:${part.id}`,
    label: partLabel(index, part.id, mode),
    sublabel: `${plural(part.files.filter((id) => !id.endsWith('.spec.ts')).length, 'file')} · ${plural(index.partOperations.get(part.id)?.size ?? 0, 'server call')}`,
    tone: toneOfPart(part.kind),
    group: `group:${part.kind}`,
    select: { kind: 'part', id: part.id },
    change: index.touchedParts.has(part.id) ? 'modified' : null,
    badge: null,
    ...CARD,
  }));
  for (const subgraph of index.graph.subgraphs)
    nodes.push({ ...subgraphNode(subgraph.name), group: 'group:services' });
  const groups: MapGroup[] = [
    ...index.graph.meta.groups.map((group) => ({
      id: `group:${group.kind}`,
      label: group.label,
    })),
    { id: 'group:services', label: index.graph.meta.servicesLabel },
  ];
  const edges: MapEdge[] = [];
  for (const [from, targets] of index.partLinks) {
    for (const to of targets.keys()) {
      const isNew = index.newPartLinks.has(`${from} -> ${to}`);
      edges.push({
        id: `part:${from}->part:${to}`,
        from: `part:${from}`,
        to: `part:${to}`,
        dashed: isNew,
        highlight: isNew,
      });
    }
  }
  for (const [part, operations] of index.partOperations) {
    const subgraphs = new Set(
      [...operations].flatMap(
        (name) => index.operations.get(name)?.subgraphs ?? []
      )
    );
    for (const subgraph of subgraphs) {
      edges.push({
        id: `part:${part}->subgraph:${subgraph}`,
        from: `part:${part}`,
        to: `subgraph:${subgraph}`,
        dashed: false,
        highlight: false,
      });
    }
  }
  const groupId = (kind: string) => (kind === 'services' ? 'group:services' : `group:${kind}`);
  const groupFlow = index.graph.meta.groupFlow.map(
    ([from, to]): [string, string] => [groupId(from), groupId(to)]
  );
  return { nodes, edges, groups, groupFlow, layout: 'grouped' };
};

/**
 * One part: its files, the server calls they make and the services behind
 * them, plus the other parts it uses, collapsed to one card each. Parts that
 * use this one are listed in the side panel rather than drawn into every file.
 */
export const partModel = (
  index: MapIndex,
  partId: string,
  mode: Mode
): MapModel => {
  const part = index.parts.get(partId);
  if (!part) return { nodes: [], edges: [], groups: [], layout: 'layered' };
  const shown = part.files.filter((id) => {
    const file = index.files.get(id);
    return file && isShown(file.kind, mode);
  });
  const shownSet = new Set(shown);
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const addEdge = (from: string, to: string) => {
    if (from !== to)
      edges.set(`${from}->${to}`, {
        id: `${from}->${to}`,
        from,
        to,
        dashed: false,
        highlight: false,
      });
  };
  const externalPart = (id: string): string => {
    const nodeId = `part:${id}`;
    if (!nodes.has(nodeId)) {
      nodes.set(nodeId, {
        id: nodeId,
        label: partLabel(index, id, mode),
        sublabel: 'Another part',
        tone: 'external',
        group: null,
        select: { kind: 'part', id },
        change: index.touchedParts.has(id) ? 'modified' : null,
        badge: null,
        ...SMALL,
      });
    }
    return nodeId;
  };

  for (const id of shown) nodes.set(`file:${id}`, fileNode(index, id, mode));
  for (const id of shown) {
    const file = index.files.get(id);
    if (!file) continue;
    for (const target of linkTargets(file)) {
      const targetPart = index.files.get(target)?.part;
      if (shownSet.has(target)) addEdge(`file:${id}`, `file:${target}`);
      else if (targetPart && targetPart !== partId)
        addEdge(`file:${id}`, externalPart(targetPart));
    }
    for (const name of file.operations) {
      const operation = index.operations.get(name);
      if (!operation) continue;
      nodes.set(`operation:${name}`, operationNode(index, name, mode));
      addEdge(`file:${id}`, `operation:${name}`);
      for (const subgraph of operation.subgraphs) {
        nodes.set(`subgraph:${subgraph}`, subgraphNode(subgraph));
        addEdge(`operation:${name}`, `subgraph:${subgraph}`);
      }
    }
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    groups: [],
    layout: 'layered',
  };
};

/**
 * A screen, starting from the component its route mounts: the components it
 * renders (by tag or by registered name) down to `depth` levels, the server
 * calls they make directly or through their shared logic, and the services
 * that answer them. Developers also see the shared logic as cards.
 */
export const screenModel = (
  index: MapIndex,
  route: Route,
  depth: number,
  mode: Mode
): MapModel => {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const addEdge = (from: string, to: string, dashed = false) => {
    if (from !== to)
      edges.set(`${from}->${to}`, {
        id: `${from}->${to}`,
        from,
        to,
        dashed,
        highlight: false,
      });
  };
  const roots = [route.component, ...route.extraComponents].filter(
    (id): id is string => !!id
  );
  const level = new Map<string, number>(roots.map((id) => [id, 0]));
  const queue = [...roots];

  const addOperations = (from: string, fileId: string) => {
    for (const name of index.files.get(fileId)?.operations ?? []) {
      const operation = index.operations.get(name);
      if (!operation) continue;
      nodes.set(`operation:${name}`, operationNode(index, name, mode));
      addEdge(from, `operation:${name}`);
      for (const subgraph of operation.subgraphs) {
        nodes.set(`subgraph:${subgraph}`, subgraphNode(subgraph));
        addEdge(`operation:${name}`, `subgraph:${subgraph}`);
      }
    }
  };

  while (queue.length > 0) {
    const id = queue.shift();
    const file = id ? index.files.get(id) : undefined;
    if (!id || !file) continue;
    const current = level.get(id) ?? 0;
    const node = fileNode(index, id, mode);
    nodes.set(node.id, node);
    addOperations(node.id, id);

    // Shared logic one step away: its server calls count as the component's.
    for (const target of file.imports) {
      const logic = index.files.get(target);
      if (
        !logic ||
        logic.kind === 'view' ||
        logic.kind === 'component' ||
        !isShown(logic.kind, 'plain')
      )
        continue;
      if (logic.operations.length === 0 && mode === 'plain') continue;
      if (mode === 'dev') {
        nodes.set(`file:${target}`, {
          ...fileNode(index, target, mode),
          tone: 'logic',
        });
        addEdge(node.id, `file:${target}`);
        addOperations(`file:${target}`, target);
      } else {
        addOperations(node.id, target);
      }
    }

    const children = file.components.filter(
      (use) => use.target && use.target.endsWith('.vue')
    );
    if (current >= depth) {
      const hidden = children.filter(
        (use) => use.target && !level.has(use.target)
      ).length;
      if (hidden > 0) node.badge = `+${hidden}`;
      continue;
    }
    for (const use of children) {
      const target = use.target as string;
      addEdge(node.id, `file:${target}`, use.byName);
      if (!level.has(target)) {
        level.set(target, current + 1);
        queue.push(target);
      }
    }
  }
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter(
      (edge) => nodes.has(edge.from) && nodes.has(edge.to)
    ),
    groups: [],
    layout: 'layered',
  };
};
