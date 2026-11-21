import { CODE_FILE } from './cruise.js';
import type { Gap, Graph } from './model.js';

/**
 * Checks the graph against itself and the code it came from: every file sits
 * in exactly one part, every link points at a scanned file, every operation
 * reaches a subgraph. Anything that fails becomes a gap, so a scan never hides
 * what it couldn't place.
 */
export const validateGraph = (graph: Graph, scannedFileCount: number): Gap[] => {
  const gaps: Gap[] = [];
  const fileIds = new Set(graph.files.map((file) => file.id));
  const unpartitioned = graph.gaps.filter(
    (gap) => gap.kind === 'unpartitioned-file'
  ).length;

  const membership = new Map<string, number>();
  for (const part of graph.parts) {
    for (const id of part.files)
      membership.set(id, (membership.get(id) ?? 0) + 1);
  }
  for (const [id, count] of membership) {
    if (count > 1) {
      gaps.push({
        kind: 'unpartitioned-file',
        level: 'error',
        file: id,
        detail: `${id} is in ${count} parts`,
      });
    }
  }
  if (membership.size + unpartitioned !== scannedFileCount) {
    gaps.push({
      kind: 'unpartitioned-file',
      level: 'error',
      file: null,
      detail: `scanned ${scannedFileCount} files but parts hold ${membership.size} and ${unpartitioned} have no part`,
    });
  }
  for (const id of membership.keys()) {
    if (CODE_FILE.test(id) && !fileIds.has(id)) {
      gaps.push({
        kind: 'unpartitioned-file',
        level: 'error',
        file: id,
        detail: `${id} is in a part but has no file entry`,
      });
    }
  }

  for (const file of graph.files) {
    for (const target of [
      ...file.imports,
      ...file.components.flatMap((use) => (use.target ? [use.target] : [])),
    ]) {
      if (!fileIds.has(target)) {
        gaps.push({
          kind: 'unresolved-import',
          level: 'error',
          file: file.id,
          detail: `links to ${target}, which the scan didn't find`,
        });
      }
    }
  }

  const names = new Map<string, number>();
  for (const operation of graph.operations)
    names.set(operation.name, (names.get(operation.name) ?? 0) + 1);
  for (const [name, count] of names) {
    if (count > 1) {
      gaps.push({
        kind: 'missing-composable',
        level: 'error',
        file: null,
        detail: `${count} operations are named ${name}; codegen keeps one`,
      });
    }
  }
  for (const operation of graph.operations) {
    if (operation.rootFields.length === 0) {
      gaps.push({
        kind: 'missing-field',
        level: 'error',
        file: operation.file,
        detail: `${operation.name} selects no root field the schema knows`,
      });
    }
    if (!membership.has(operation.file)) {
      gaps.push({
        kind: 'unpartitioned-file',
        level: 'error',
        file: operation.file,
        detail: `${operation.name} is defined outside the scanned files`,
      });
    }
  }

  for (const route of graph.routes) {
    for (const component of [route.component, ...route.extraComponents]) {
      if (component && !fileIds.has(component)) {
        gaps.push({
          kind: 'unresolved-route-component',
          level: 'error',
          file: route.definedIn,
          detail: `route ${route.path} mounts ${component}, which the scan didn't find`,
        });
      }
    }
  }
  return gaps;
};

export const summarizeGaps = (gaps: Gap[]): string[] => {
  const counts = new Map<string, number>();
  for (const gap of gaps) {
    const key = `${gap.level} ${gap.kind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const order = { error: 0, warning: 1, info: 2 };
  return [...counts]
    .toSorted(
      ([a], [b]) =>
        (order[a.split(' ')[0] as keyof typeof order] ?? 3) -
          (order[b.split(' ')[0] as keyof typeof order] ?? 3) ||
        a.localeCompare(b)
    )
    .map(([key, count]) => `${key}: ${count}`);
};
