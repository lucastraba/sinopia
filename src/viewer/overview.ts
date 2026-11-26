// What the overview (level 0) and an area (level 1) show, worked out from the
// areas, lines and claims the scan put in graph.json. No Vue here, so the
// specs can check it the way graphs.spec.ts checks the canvas models.
import { OVERVIEW_MIN_PARTS, VERBS } from '../areas';
import type { Area, AreaLink, ClaimResult, LinkExample, Verb } from '../model';
import { fileName, type MapIndex, type Mode, partLabel, textOf } from './mapIndex';

/** True when the map opens on the overview: it has areas and enough parts for them to help. */
export const hasOverview = (index: MapIndex): boolean =>
  (index.graph.areas?.length ?? 0) > 0 && index.graph.parts.length >= OVERVIEW_MIN_PARTS;

export const areaById = (index: MapIndex, id: string): Area | null => index.graph.areas?.find((area) => area.id === id) ?? null;

/** The area a part sits in. */
export const areaOfPart = (index: MapIndex, partId: string): Area | null =>
  index.graph.areas?.find((area) => area.parts.includes(partId)) ?? null;

const fmt = (n: number) => n.toLocaleString('en-US');
export const plural = (n: number, one: string, many = `${one}s`): string => `${fmt(n)} ${n === 1 ? one : many}`;

/**
 * An area's sentence: what the map says it's for. Areas grouped by folder
 * borrow the description of the part at their folder, when the map has one.
 */
export const areaWhy = (index: MapIndex, area: Area, mode: Mode): string => {
  if (area.why) return area.why;
  const folder = area.folders[0];
  const part = index.graph.parts.find((candidate) => (folder === '(root)' ? candidate.dir === '' : candidate.dir === folder));
  const text = part ? textOf(index.descriptions.parts[part.id], mode) : '';
  if (text) return text;
  return area.source === 'folders' ? `Everything under ${folder === '(root)' ? 'the top level' : `${folder}/`}.` : '';
};

/** Lines whose verb is `verb`, or all of them. */
export const linesWithVerb = (lines: AreaLink[], verb: Verb | null): AreaLink[] => (verb ? lines.filter((line) => line.verb === verb) : lines);

/** The verbs the lines use, in display order, with how many lines each. */
export const verbsUsed = (lines: AreaLink[]): { verb: Verb; lines: number }[] =>
  VERBS.map((verb) => ({ verb, lines: lines.filter((line) => line.verb === verb).length })).filter((entry) => entry.lines > 0);

export interface Talk {
  dir: 'out' | 'in';
  verb: Verb;
  area: string;
  count: number;
}

export interface AreaCard {
  area: Area;
  why: string;
  /** Its two biggest lines out, then its two biggest in. */
  talks: Talk[];
}

const talksOf = (lines: AreaLink[], name: string, n: number): Talk[] => [
  ...lines
    .filter((line) => line.from === name)
    .slice(0, n)
    .map((line): Talk => ({ dir: 'out', verb: line.verb, area: line.to, count: line.count })),
  ...lines
    .filter((line) => line.to === name)
    .slice(0, n)
    .map((line): Talk => ({ dir: 'in', verb: line.verb, area: line.from, count: line.count })),
];

export interface Overview {
  title: string;
  text: string;
  areas: AreaCard[];
  lines: AreaLink[];
  claims: ClaimResult[];
  /** No areas written in the map: they're the top folders. */
  byFolder: boolean;
  draftAreas: number;
  draftClaims: number;
  facts: { parts: number; files: number; partPairs: number; links: number };
}

/** Level 0: the app in a paragraph, its claims, its areas and the named lines between them. */
export const overviewModel = (index: MapIndex, mode: Mode): Overview => {
  const { graph } = index;
  const areas = graph.areas ?? [];
  const lines = graph.areaLinks ?? [];
  const claims = graph.claims ?? [];
  return {
    title: index.descriptions.app?.title ?? graph.meta.title,
    text: textOf(index.descriptions.app, mode),
    areas: areas.map((area) => ({ area, why: areaWhy(index, area, mode), talks: talksOf(lines, area.name, 2) })),
    lines,
    claims,
    byFolder: areas.length > 0 && areas.every((area) => area.source === 'folders'),
    draftAreas: areas.filter((area) => area.draft).length,
    draftClaims: claims.filter((claim) => claim.draft).length,
    facts: {
      parts: graph.parts.length,
      files: graph.files.length,
      partPairs: graph.linkTotals?.partPairs ?? 0,
      links: graph.linkTotals?.links ?? 0,
    },
  };
};

export interface PartRow {
  id: string;
  title: string;
  /** The path under a described title (plain), or the title under the path (developer). */
  sub: string;
  text: string;
  files: number;
  tests: number;
  out: Talk[];
  in: Talk[];
  outTotal: number;
  inTotal: number;
}

export interface AreaView {
  area: Area;
  why: string;
  out: AreaLink[];
  in: AreaLink[];
  claims: ClaimResult[];
  parts: PartRow[];
}

/** Level 1: one area's lines out and in, the claims about it, and its parts with their lines to other areas. */
export const areaModel = (index: MapIndex, area: Area, mode: Mode): AreaView => {
  const lines = index.graph.areaLinks ?? [];
  const parts = area.parts.map((id): PartRow => {
    const out: Talk[] = [];
    const inn: Talk[] = [];
    for (const line of lines) {
      const sent = line.fromParts[id];
      if (sent) out.push({ dir: 'out', verb: line.verb, area: line.to, count: sent });
      const got = line.toParts[id];
      if (got) inn.push({ dir: 'in', verb: line.verb, area: line.from, count: got });
    }
    const byCount = (a: Talk, b: Talk) => b.count - a.count;
    out.sort(byCount);
    inn.sort(byCount);
    const part = index.parts.get(id);
    const files = part?.files ?? [];
    const described = index.descriptions.parts[id]?.title;
    return {
      id,
      title: partLabel(index, id, mode),
      sub: mode === 'dev' ? (described ?? '') : id,
      text: textOf(index.descriptions.parts[id], mode),
      files: files.length,
      tests: files.filter((file) => index.files.get(file)?.kind === 'test').length,
      out,
      in: inn,
      outTotal: out.reduce((sum, talk) => sum + talk.count, 0),
      inTotal: inn.reduce((sum, talk) => sum + talk.count, 0),
    };
  });
  return {
    area,
    why: areaWhy(index, area, mode),
    out: lines.filter((line) => line.from === area.name),
    in: lines.filter((line) => line.to === area.name),
    claims: (index.graph.claims ?? []).filter((claim) => claim.areas.includes(area.name)),
    parts,
  };
};

const KIND_WORDS: Record<string, string> = {
  import: 'imports',
  component: 'shows a component',
  data: 'reads a data file',
  graphql: 'server call',
  trpc: 'server call',
  http: 'server call',
  'ui-event': 'event',
  event: 'event',
  ipc: 'IPC channel',
  bridge: 'desktop bridge',
  runs: 'runs',
  spawn: 'starts a process',
  i18n: 'text keys',
  flag: 'feature flag',
  inject: 'provide/inject',
  glob: 'loads by pattern',
  codegen: 'generated into',
};

/** A link kind as the page names it: the kind itself for developers, words otherwise. */
export const kindWord = (kind: string, mode: Mode): string => (mode === 'dev' ? kind : (KIND_WORDS[kind] ?? kind));

/** The small tag under an example: what crosses, when it says more than "imports". */
export const exampleTag = (example: LinkExample, mode: Mode): string => {
  if (mode === 'dev') return example.kind + (example.label ? ` ${example.label}` : '');
  if (example.label) return `${KIND_WORDS[example.kind] ?? example.kind}: ${example.label}`;
  return example.kind === 'import' ? '' : (KIND_WORDS[example.kind] ?? example.kind);
};

/** A file in an example: its described title and name (plain), or its path (developer). */
export const exampleFile = (index: MapIndex, id: string, mode: Mode): { label: string; hint: string } => {
  if (mode === 'dev') return { label: id, hint: '' };
  const title = index.descriptions.files[id]?.title;
  if (title) return { label: title, hint: fileName(id) };
  const slash = id.lastIndexOf('/');
  return { label: fileName(id), hint: slash < 0 ? '' : id.slice(0, slash) };
};

/** How a claim came out, in a word and a phrase: "Holds", "no imports. What crosses instead: tells 40". */
export const claimSummary = (claim: ClaimResult): { word: 'Holds' | 'Broken'; detail: string } => {
  if (!claim.holds) return { word: 'Broken', detail: `${plural(claim.count, 'link')} from ${plural(claim.files, 'file')}` };
  const verbs = Object.entries(claim.scopeByVerb)
    .map(([verb, n]) => `${verb} ${fmt(n)}`)
    .join(', ');
  const rule = claim.rule[claim.form] as { kind?: string; kinds?: string[] };
  const kind = rule.kind ?? rule.kinds?.join('/');
  if (claim.form === 'never' && kind && claim.scope) return { word: 'Holds', detail: `no ${kind}s. What crosses instead: ${verbs}` };
  if (claim.form === 'never') return { word: 'Holds', detail: claim.scope ? `${plural(claim.scope, 'link')} checked` : 'nothing crosses at all' };
  if (claim.form === 'only') return { word: 'Holds', detail: (claim.scope === 1 ? 'the 1 link comes from the allowed side' : `all ${plural(claim.scope, 'link')} come from the allowed side`) };
  return { word: 'Holds', detail: `${claim.scope === 1 ? 'the 1 link goes' : `all ${plural(claim.scope, 'link')} go`} through it${verbs ? ` (${verbs})` : ''}` };
};

/** The claim as it reads in the map file, for developers. */
export const claimSource = (claim: ClaimResult): string => {
  const body = JSON.stringify(claim.rule)
    .replace(/"([A-Za-z_]\w*)":/g, '$1: ')
    .replace(/"/g, "'")
    .replace(/,(?=\S)/g, ', ');
  return `{ says: '${claim.says.replace(/'/g, "\\'")}', ${body.slice(1, -1)}${claim.draft ? ', draft: true' : ''}${claim.enforce ? ', enforce: true' : ''} }`;
};

/** Where a part's lines go, summed per area and verb, biggest first: "Game rules 12, Content 3, and 2 more". */
export const topParts = (counts: Record<string, number>, n: number): { ids: [string, number][]; more: number } => {
  const entries = Object.entries(counts);
  return { ids: entries.slice(0, n), more: Math.max(0, entries.length - n) };
};

/**
 * Whether a line's sentence still needs the target's name after the verb: not when the
 * verb already ends with it, as "asks the server" does for a folder area called server.
 */
export const namesTarget = (verb: string, area: string): boolean =>
  verb.split(' ').at(-1)?.toLowerCase() !== area.toLowerCase();
