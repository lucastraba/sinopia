import type {
  Description,
  Descriptions,
  FileNode,
  Gap,
  Graph,
  GraphDiff,
  Operation,
  Part,
  Route,
} from '../model';

export type Change = 'added' | 'modified' | 'removed';

export interface MapIndex {
  graph: Graph;
  descriptions: Descriptions;
  diff: GraphDiff | null;
  files: Map<string, FileNode>;
  parts: Map<string, Part>;
  operations: Map<string, Operation>;
  /** File → files that import it or render it. */
  usedBy: Map<string, string[]>;
  routesByComponent: Map<string, Route[]>;
  /** Part → part → number of file-level links. */
  partLinks: Map<string, Map<string, number>>;
  /** Part → operations its files call. */
  partOperations: Map<string, Set<string>>;
  operationCallers: Map<string, string[]>;
  gapsByFile: Map<string, Gap[]>;
  changedFiles: Map<string, Change>;
  touchedParts: Set<string>;
  newPartLinks: Set<string>;
  changedOperations: Set<string>;
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) list.push(value);
  map.set(key, list);
};

/** File ids a file links to: imports and rendered components. */
export const linksOf = (file: FileNode): string[] => [
  ...new Set([
    ...file.imports,
    ...file.components.flatMap((use) => (use.target ? [use.target] : [])),
  ]),
];

export const buildIndex = (
  graph: Graph,
  descriptions: Descriptions,
  diff: GraphDiff | null
): MapIndex => {
  const files = new Map(graph.files.map((file) => [file.id, file]));
  const usedBy = new Map<string, string[]>();
  const partLinks = new Map<string, Map<string, number>>();
  const partOperations = new Map<string, Set<string>>();
  const operationCallers = new Map<string, string[]>();
  for (const file of graph.files) {
    if (file.kind === 'test') continue;
    for (const target of linksOf(file)) {
      push(usedBy, target, file.id);
      const to = files.get(target)?.part;
      if (to && to !== file.part) {
        const links = partLinks.get(file.part) ?? new Map<string, number>();
        links.set(to, (links.get(to) ?? 0) + 1);
        partLinks.set(file.part, links);
      }
    }
    for (const operation of file.operations) {
      partOperations.set(
        file.part,
        (partOperations.get(file.part) ?? new Set()).add(operation)
      );
      push(operationCallers, operation, file.id);
    }
  }

  const routesByComponent = new Map<string, Route[]>();
  for (const route of graph.routes) {
    for (const component of [route.component, ...route.extraComponents]) {
      if (component) push(routesByComponent, component, route);
    }
  }
  const gapsByFile = new Map<string, Gap[]>();
  for (const gap of graph.gaps) if (gap.file) push(gapsByFile, gap.file, gap);

  const changedFiles = new Map<string, Change>();
  for (const part of diff?.touchedParts ?? []) {
    const prefix = graph.meta.srcDir ? `${graph.meta.srcDir}/` : '';
    for (const rel of part.added) changedFiles.set(prefix + rel, 'added');
    for (const rel of part.modified) changedFiles.set(prefix + rel, 'modified');
    for (const rel of part.removed) changedFiles.set(prefix + rel, 'removed');
  }

  return {
    graph,
    descriptions,
    diff,
    files,
    parts: new Map(graph.parts.map((part) => [part.id, part])),
    operations: new Map(
      graph.operations.map((operation) => [operation.name, operation])
    ),
    usedBy,
    routesByComponent,
    partLinks,
    partOperations,
    operationCallers,
    gapsByFile,
    changedFiles,
    touchedParts: new Set(diff?.touchedParts.map((part) => part.part) ?? []),
    newPartLinks: new Set(
      diff?.newPartLinks.map((link) => `${link.from} -> ${link.to}`) ?? []
    ),
    changedOperations: new Set(
      diff?.operations
        .filter((operation) => operation.change !== 'removed')
        .map((operation) => operation.name) ?? []
    ),
  };
};

export type Mode = 'plain' | 'dev';

export const fileName = (id: string): string => id.split('/').pop() ?? id;

export const describeFile = (
  index: MapIndex,
  id: string
): Description | undefined => index.descriptions.files[id];

/** The name shown on a card: the described title in plain mode, the file name for developers. */
export const fileLabel = (index: MapIndex, id: string, mode: Mode): string =>
  mode === 'plain'
    ? (describeFile(index, id)?.title ?? fileName(id))
    : fileName(id);

export const partLabel = (index: MapIndex, id: string, mode: Mode): string =>
  mode === 'plain'
    ? (index.descriptions.parts[id]?.title ?? index.parts.get(id)?.name ?? id)
    : id;

export const operationLabel = (
  index: MapIndex,
  name: string,
  mode: Mode
): string =>
  mode === 'plain'
    ? (index.descriptions.operations[name]?.title ?? name)
    : name;

export const textOf = (
  description: Description | undefined | null,
  mode: Mode
): string =>
  description ? (mode === 'plain' ? description.plain : description.dev) : '';
