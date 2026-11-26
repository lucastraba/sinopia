// Areas: what a person means by "a piece of the app" (game rules, the screen,
// tooling). A map file names them; every part lands in one; the file links
// between two areas fold into one named line per verb. No node imports here:
// the viewer uses the same functions.
import type { Area, AreaLink, AreaSpec, Gap, Graph, LinkExample, Part, Verb } from './model.js';

/** Below this many parts the viewer opens the parts themselves: an area of two parts adds a tap and nothing else. */
export const OVERVIEW_MIN_PARTS = 12;

/** The verbs in display order. */
export const VERBS: Verb[] = ['uses', 'shows', 'asks the server', 'tells', 'talks to the desktop', 'reads', 'runs', 'generates'];

/** Link kind to verb. `data` is an import of a data file; kinds a map invents fall back by their name. */
const VERB_OF: Record<string, Verb> = {
  import: 'uses',
  flag: 'uses',
  inject: 'uses',
  glob: 'uses',
  config: 'uses',
  component: 'shows',
  data: 'reads',
  i18n: 'reads',
  graphql: 'asks the server',
  trpc: 'asks the server',
  http: 'asks the server',
  ws: 'asks the server',
  event: 'tells',
  'ui-event': 'tells',
  ipc: 'talks to the desktop',
  bridge: 'talks to the desktop',
  runs: 'runs',
  spawn: 'runs',
  codegen: 'generates',
};

export const verbOf = (kind: string): Verb => VERB_OF[kind] ?? (/event$/.test(kind) ? 'tells' : 'uses');

/** A link the folding counts: one per (from, to, kind, label). */
export interface Edge extends LinkExample {
  /** A component the template uses by tag, with no import line (resolved by a plugin). */
  tagOnly?: boolean;
}

const DATA_FILE = /\.(ya?ml|json|csv|toml)$/i;

/**
 * Every file-to-file link once: an import is `data` when it loads a data file
 * and `component` when the file also renders it; components used by tag only
 * count as `component`; then the adapter's own links. Links to a file the
 * graph doesn't hold are left out (validateGraph reports them).
 */
export const fileEdges = (graph: Pick<Graph, 'files'>): Edge[] => {
  const known = new Set(graph.files.map((file) => file.id));
  const edges: Edge[] = [];
  for (const file of graph.files) {
    const seen = new Set<string>();
    const add = (to: string, kind: string, label: string | null, tagOnly = false) => {
      const key = `${to}|${kind}|${label ?? ''}`;
      if (!known.has(to) || to === file.id || seen.has(key)) return;
      seen.add(key);
      edges.push(tagOnly ? { from: file.id, to, kind, label, tagOnly } : { from: file.id, to, kind, label });
    };
    const shown = new Set(file.components.flatMap((use) => (use.target ? [use.target] : [])));
    for (const to of file.imports) add(to, DATA_FILE.test(to) ? 'data' : shown.has(to) ? 'component' : 'import', null);
    for (const to of shown) if (!file.imports.includes(to)) add(to, 'component', null, true);
    for (const link of file.links ?? []) add(link.target, link.kind, link.label ?? null);
  }
  return edges;
};

const ROOT = '(root)';

/** True when a part's folder is the area folder or inside it. `(root)` is the top-level files only. */
const inFolder = (dir: string, folder: string): boolean =>
  folder === ROOT || folder === '' ? dir === '' : dir === folder || dir.startsWith(`${folder}/`);

/** Part id to area name: the area whose folder is the longest prefix of the part's folder, or null. */
export const assignAreas = (parts: Part[], specs: Record<string, AreaSpec>): Map<string, string | null> => {
  const out = new Map<string, string | null>();
  for (const part of parts) {
    let best: string | null = null;
    let bestLength = -1;
    for (const [name, spec] of Object.entries(specs)) {
      for (const folder of spec.folders) {
        const length = folder === ROOT ? 0 : folder.length;
        if (inFolder(part.dir, folder) && length > bestLength) {
          best = name;
          bestLength = length;
        }
      }
    }
    out.set(part.id, best);
  }
  return out;
};

/**
 * Areas when the map writes none: one per workspace package (with the folders
 * inside it), else one per top-level folder, and the top-level files. When
 * that makes a single area, the next folder level splits it.
 */
export const folderAreas = (parts: Part[]): Record<string, AreaSpec> => {
  const packages = parts.filter((part) => part.kind === 'package' && part.dir !== '').sort((a, b) => b.dir.length - a.dir.length);
  const groupOf = (part: Part, depth: number): { name: string; folder: string } => {
    if (part.dir === '') return { name: 'Top level', folder: ROOT };
    const pkg = packages.find((candidate) => inFolder(part.dir, candidate.dir));
    if (pkg) return { name: pkg.name || pkg.dir, folder: pkg.dir };
    const folder = part.dir.split('/').slice(0, depth).join('/');
    return { name: folder, folder };
  };
  const group = (depth: number) => {
    const specs: Record<string, AreaSpec> = {};
    for (const part of parts) {
      const { name, folder } = groupOf(part, depth);
      const spec = (specs[name] ??= { folders: [] });
      if (!spec.folders.includes(folder)) spec.folders.push(folder);
    }
    return specs;
  };
  let specs = group(1);
  const maxDepth = Math.max(1, ...parts.map((part) => part.dir.split('/').length));
  for (let depth = 2; Object.keys(specs).length === 1 && parts.length > 1 && depth <= maxDepth; depth += 1) specs = group(depth);
  return specs;
};

export const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'area';

const inc = (counts: Record<string, number>, key: string, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

/** Counts biggest first, ties by name, so the output is the same on every run. */
export const sortCounts = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));

const TEST_PATH = /(\.|\/)(spec|test|test-utils|stories)\.|(^|\/)(tests?|__tests__|e2e)\//;

/** Up to `n` examples that differ: a new source part first, then a new source file, then anything; real code before tests. */
export const pickExamples = (edges: LinkExample[], partOf: (file: string) => string | undefined, n = 3): LinkExample[] => {
  const isTest = (file: string) => (TEST_PATH.test(file) ? 1 : 0);
  const sorted = [...edges].sort((a, b) => isTest(a.from) - isTest(b.from) || (a.from + a.to < b.from + b.to ? -1 : a.from + a.to > b.from + b.to ? 1 : 0));
  const picked: LinkExample[] = [];
  const parts = new Set<string | undefined>();
  const files = new Set<string>();
  const targets = new Set<string>();
  const take = (test: (edge: LinkExample) => boolean) => {
    for (const edge of sorted) {
      if (picked.length >= n) return;
      if (picked.includes(edge) || !test(edge)) continue;
      picked.push(edge);
      parts.add(partOf(edge.from));
      files.add(edge.from);
      targets.add(edge.to);
    }
  };
  take((edge) => !parts.has(partOf(edge.from)) && !targets.has(edge.to));
  take((edge) => !files.has(edge.from) && !targets.has(edge.to));
  take((edge) => !files.has(edge.from));
  take(() => true);
  return picked.map(({ from, to, kind, label }) => ({ from, to, kind, label }));
};

/** What the claims need to read the scan: every link once, and where each file sits. */
export interface AreaContext {
  edges: Edge[];
  partOf: (file: string) => string | undefined;
  areaOfFile: (file: string) => string | undefined;
  areaNames: string[];
}

export interface Folded {
  areas: Area[];
  areaLinks: AreaLink[];
  linkTotals: { links: number; partPairs: number };
  gaps: Gap[];
  context: AreaContext;
}

const SERVER_VERB: Verb = 'asks the server';

/**
 * Puts every part in an area and folds the file links between areas into
 * lines. `specs` null: the map writes no areas, so they come from the folders.
 * Parts no written area claims go to `Other`, each with a warning.
 */
export const foldAreas = (graph: Pick<Graph, 'parts' | 'files'>, specs: Record<string, AreaSpec> | null): Folded => {
  const written = specs !== null && Object.keys(specs).length > 0;
  const used = written ? specs : folderAreas(graph.parts);
  const assigned = assignAreas(graph.parts, used);
  const gaps: Gap[] = [];
  const areaOfPart = new Map<string, string>();
  for (const part of graph.parts) {
    const name = assigned.get(part.id) ?? 'Other';
    areaOfPart.set(part.id, name);
    if (name === 'Other' && !(name in used)) {
      gaps.push({
        kind: 'part-without-area',
        level: 'warning',
        file: null,
        detail: `${part.id} is in no area, so the overview shows it under Other: add its folder to an area in the map`,
      });
    }
  }
  const names = Object.keys(used);
  if ([...areaOfPart.values()].some((name) => !(name in used))) names.push('Other');

  const fileById = new Map(graph.files.map((file) => [file.id, file]));
  const partOf = (file: string) => fileById.get(file)?.part;
  const areaOfFile = (file: string) => {
    const part = partOf(file);
    return part === undefined ? undefined : areaOfPart.get(part);
  };
  const edges = fileEdges(graph);

  const partPairs = new Set<string>();
  const lines = new Map<string, { from: string; to: string; verb: Verb; edges: Edge[] }>();
  const internal: Record<string, number> = {};
  const serverCalls: Record<string, number> = {};
  const serverOps = new Map<string, Set<string>>();
  for (const edge of edges) {
    const fromPart = partOf(edge.from);
    const toPart = partOf(edge.to);
    if (fromPart !== toPart && !edge.tagOnly) partPairs.add(`${fromPart}|${toPart}`);
    const a = areaOfFile(edge.from);
    const b = areaOfFile(edge.to);
    if (a === undefined || b === undefined) continue;
    const verb = verbOf(edge.kind);
    if (verb === SERVER_VERB) {
      inc(serverCalls, a);
      const ops = serverOps.get(a) ?? new Set<string>();
      serverOps.set(a, ops.add(edge.label ?? edge.to));
    }
    if (a === b) {
      inc(internal, a);
      continue;
    }
    const key = `${a}|${b}|${verb}`;
    const line = lines.get(key) ?? { from: a, to: b, verb, edges: [] };
    line.edges.push(edge);
    lines.set(key, line);
  }

  const ids = new Map<string, string>();
  const idOf = (name: string) => {
    if (!ids.has(name)) {
      let id = slug(name);
      for (let i = 2; [...ids.values()].includes(id); i += 1) id = `${slug(name)}-${i}`;
      ids.set(name, id);
    }
    return ids.get(name) as string;
  };

  const testFile = (id: string) => fileById.get(id)?.kind === 'test';
  const areas: Area[] = names.map((name) => {
    const spec = used[name];
    const parts = graph.parts
      .filter((part) => areaOfPart.get(part.id) === name)
      .sort((a, b) => b.files.length - a.files.length || (a.id < b.id ? -1 : 1));
    const files = parts.flatMap((part) => part.files);
    return {
      id: idOf(name),
      name,
      why: spec?.why ?? (spec ? null : 'Parts no area claims yet.'),
      draft: spec?.draft === true,
      source: !spec ? 'other' : written ? 'map' : 'folders',
      folders: spec?.folders ?? [],
      parts: parts.map((part) => part.id),
      files: files.length,
      tests: files.filter(testFile).length,
      internalLinks: internal[name] ?? 0,
      serverCalls: serverCalls[name] ?? 0,
      serverOps: serverOps.get(name)?.size ?? 0,
    };
  });

  const areaLinks: AreaLink[] = [...lines.values()]
    .map(({ from, to, verb, edges: list }) => {
      const kinds: Record<string, number> = {};
      const fromParts: Record<string, number> = {};
      const toParts: Record<string, number> = {};
      for (const edge of list) {
        inc(kinds, edge.kind);
        inc(fromParts, partOf(edge.from) ?? '');
        inc(toParts, partOf(edge.to) ?? '');
      }
      return {
        id: `${idOf(from)}--${slug(verb)}--${idOf(to)}`,
        from,
        to,
        verb,
        count: list.length,
        kinds: sortCounts(kinds),
        files: new Set(list.map((edge) => edge.from)).size,
        fromParts: sortCounts(fromParts),
        toParts: sortCounts(toParts),
        viaQueries: list.every((edge) => edge.kind === 'graphql'),
        examples: pickExamples(list, partOf),
      };
    })
    .sort((a, b) => b.count - a.count || VERBS.indexOf(a.verb) - VERBS.indexOf(b.verb) || (a.id < b.id ? -1 : 1));

  return {
    areas,
    areaLinks,
    linkTotals: { links: edges.length, partPairs: partPairs.size },
    gaps,
    context: { edges, partOf, areaOfFile, areaNames: names },
  };
};
