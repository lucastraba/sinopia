// The map's data model. Adapters write it, describe, diff and the viewer read
// it. File ids are repo-relative paths; parts and operations have stable names.

/** What a part is, as the adapter groups them (`feature`, `poc`, `package`, `folder`…). */
export type PartKind = string;

export interface Part {
  id: string;
  kind: PartKind;
  name: string;
  dir: string;
  files: string[];
}

export type FileKind =
  | 'view'
  | 'component'
  | 'composable'
  | 'store'
  | 'api'
  | 'route'
  | 'type'
  | 'util'
  | 'locale'
  | 'test'
  | 'generated'
  | 'script'
  | 'doc'
  | 'config'
  | 'other';

export interface ComponentUse {
  tag: string;
  /** File id of the component, or null when it comes from a library or is unknown. */
  target: string | null;
  library: string | null;
  /** Rendered through a name registered at runtime (string reference), not a template tag. */
  byName: boolean;
}

/**
 * A link an adapter found that is neither an import nor a rendered component:
 * an RPC call, a message on a bus, a generated client, a contract with another
 * repo. `kind` names the mechanism ("trpc", "ws-event"); `label` says what
 * crosses it ("counter.increment").
 */
export interface FileLink {
  /** File id the link points at. */
  target: string;
  kind: string;
  label: string | null;
}

export interface FileNode {
  id: string;
  part: string;
  kind: FileKind;
  lines: number;
  hash: string;
  /** File ids this file imports. */
  imports: string[];
  /** Workspace libraries this file imports. */
  libraries: string[];
  components: ComponentUse[];
  operations: string[];
  flags: string[];
  /** Name the component is registered under when it is resolved by name at runtime. */
  registeredAs: string | null;
  /** Links beyond imports and components. Optional: graphs written before interface v1 have none. */
  links?: FileLink[];
}

export type OperationType = 'query' | 'mutation' | 'subscription';

/** A call to a server, such as a GraphQL operation. */
export interface Operation {
  name: string;
  type: OperationType;
  file: string;
  part: string;
  composable: string;
  rootFields: string[];
  /** Every `Type.field` the operation selects. */
  fields: string[];
  /** Services that serve the root fields. */
  subgraphs: string[];
  /** Services that serve any selected field. */
  allSubgraphs: string[];
  hash: string;
  document: string;
}

/** A screen: a route and what it mounts. */
export interface Route {
  path: string;
  name: string | null;
  component: string | null;
  /** Other components the route mounts (named views, sidebars). */
  extraComponents: string[];
  /** Entitlement the route needs. */
  feature: string | null;
  /** Feature flags its guards check. */
  flags: string[];
  guards: string[];
  redirect: string | null;
  definedIn: string;
}

/** A backend service that answers operations. */
export interface Subgraph {
  name: string;
  /** Files its schema was read from. */
  sources: string[];
}

export type GapLevel = 'error' | 'warning' | 'info';

export interface Gap {
  kind: string;
  level: GapLevel;
  file: string | null;
  detail: string;
}

/** How a map presents itself: titles, groups, and the optional sections it has. */
export interface GraphMeta {
  title: string;
  /** Folder the parts live in, or '' for the whole repo. */
  srcDir: string;
  /** "the main app": used for "Outside the main app" in diffs. */
  sourceLabel: string;
  /** Part kinds in display order, with the heading of their group. */
  groups: { kind: PartKind; label: string }[];
  /** Which group sits above which on the overview; `services` is the services group. */
  groupFlow: [string, string][];
  servicesLabel: string;
  operationsLabel: string;
  /** Parts production code must not depend on, such as POCs. */
  boundary: { name: string; label: string; partKinds: PartKind[] } | null;
  /** A component library whose changes the diff maps to the parts using them. */
  library: { label: string; package: string; componentPath: string } | null;
  /** False when the adapter knows no links between files (plain folders and files). */
  hasLinks: boolean;
  /** What each rule of a map file (`.sinopia/map.mjs`) did, in the file's order. Absent for adapters without rules. */
  rules?: RuleReport[];
}

/** What one map rule did, so `check` and the viewer can show it next to the rule. */
export interface RuleReport {
  /** The primitive: `link`, `trpc`, `http`, `custom`… */
  rule: string;
  /** One line saying what the rule looks at, made from its options. */
  summary: string;
  why: string | null;
  /** Written by an agent and not yet confirmed by a person. */
  draft: boolean;
  /** Call shapes given as regular expressions instead of templates. */
  regexes: number;
  /** Links the rule added, by kind (imports it adds count as `import`). */
  links: Record<string, number>;
  routes: number;
  gaps: number;
  /** Files the rule put on the map that the generic scan skipped. */
  files?: number;
}

export interface Graph {
  version: 1;
  generatedAt: string;
  meta: GraphMeta;
  source: { label: string; sha: string | null };
  backend: { sha: string; label: string } | null;
  parts: Part[];
  files: FileNode[];
  operations: Operation[];
  routes: Route[];
  flags: string[];
  subgraphs: Subgraph[];
  /** Import cycles, as file id lists. */
  cycles: string[][];
  gaps: Gap[];
  /** The app's areas, each part in one (src/areas.ts). Absent in graphs written before areas. */
  areas?: Area[];
  /** File links between two areas, folded into one line per (from, to, verb), biggest first. */
  areaLinks?: AreaLink[];
  /** What the folding started from: every file link, and the distinct part-to-part pairs among them. */
  linkTotals?: { links: number; partPairs: number };
  /** The map's claims, as the scan found them (src/claims.ts). */
  claims?: ClaimResult[];
}

/** An area as a map file writes it: `export const areas = { 'Game rules': { folders: ['src/game'], why } }`. */
export interface AreaSpec {
  /** Folders whose parts belong here, by prefix of the part's folder; the longest match wins. `(root)` is the top-level files. */
  folders: string[];
  why?: string;
  /** Written by an agent and not yet confirmed. */
  draft?: boolean;
}

/**
 * One side of a claim: an area by name, or files picked by area, folder or
 * glob, minus `except`. A string is an area name.
 */
export type ClaimSide =
  | string
  | {
      area?: string;
      areas?: string[];
      folders?: string[];
      files?: string | string[];
      except?: ClaimSide;
    };

/** Link kinds a claim looks at: `import` means any static import (code, a component, a data file). */
export interface ClaimKinds {
  kind?: string;
  kinds?: string[];
}

/** A statement about the app's shape that the scan proves or flags. One of `never`, `only` or `through`. */
export interface ClaimSpec {
  says: string;
  /** No link goes from `from` into `to`; or, with `each`, between two different matches of a folder pattern. */
  never?: ({ from: ClaimSide; to: ClaimSide; each?: undefined } | { each: string; from?: undefined; to?: undefined }) & ClaimKinds;
  /** Only `who` reaches `to` (links from inside `to` don't count); `from` narrows the files looked at. */
  only?: { who: ClaimSide; to: ClaimSide; from?: ClaimSide } & ClaimKinds;
  /** `from` reaches `to` only by landing on `via`. */
  through?: { from: ClaimSide; to: ClaimSide; via: ClaimSide } & ClaimKinds;
  why?: string;
  draft?: boolean;
  /** A broken claim is an error in `check` instead of a finding. */
  enforce?: boolean;
  /** Areas whose page lists the claim, besides the ones it names. */
  areas?: string[];
}

/** The verbs a line between areas reads with, in display order. */
export type Verb = 'uses' | 'shows' | 'asks the server' | 'tells' | 'talks to the desktop' | 'reads' | 'runs' | 'generates';

/** One file-to-file link, as an example on a line or a claim. */
export interface LinkExample {
  from: string;
  to: string;
  kind: string;
  label: string | null;
}

export interface Area {
  id: string;
  name: string;
  why: string | null;
  draft: boolean;
  /** `map`: written in the map file. `folders`: no areas written, so grouped by folder. `other`: parts no written area claims. */
  source: 'map' | 'folders' | 'other';
  folders: string[];
  /** Part ids, biggest first. */
  parts: string[];
  files: number;
  tests: number;
  /** Links between two files of the area. */
  internalLinks: number;
  /** Server-call links (graphql, trpc, http) its files make, inside the area too. */
  serverCalls: number;
  /** Distinct server calls among them. */
  serverOps: number;
}

/** Every link of one verb from one area into another. */
export interface AreaLink {
  id: string;
  from: string;
  to: string;
  verb: Verb;
  count: number;
  /** Links by kind, biggest first. */
  kinds: Record<string, number>;
  /** Distinct files the links come from. */
  files: number;
  /** Links per part on each side, biggest first. */
  fromParts: Record<string, number>;
  toParts: Record<string, number>;
  /** Every link is a GraphQL call: one area uses queries whose documents live in the other. */
  viaQueries: boolean;
  /** Up to three, real code before tests, different parts first. */
  examples: LinkExample[];
}

export interface ClaimResult {
  says: string;
  why: string | null;
  draft: boolean;
  enforce: boolean;
  form: 'never' | 'only' | 'through';
  /** The claim's rule as written: `{ never: { from, to, kind } }`. */
  rule: Record<string, unknown>;
  holds: boolean;
  /** Links that break it. */
  count: number;
  /** Distinct files they come from. */
  files: number;
  /** Links the claim looked at, broken or not, and their verbs. */
  scope: number;
  scopeByVerb: Record<string, number>;
  byKind: Record<string, number>;
  /** Where it breaks: area to area (or group to group for `each`), biggest first, up to 8. */
  pairs: { from: string; to: string; count: number }[];
  pairsTotal: number;
  examples: LinkExample[];
  /** Areas the claim is about: the ones it names, plus its `areas`. */
  areas: string[];
}

export interface Description {
  hash: string;
  title: string;
  plain: string;
  dev: string;
}

export interface DescribeRun {
  at: string;
  model: string;
  scope: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  describedChars: number;
}

export interface Descriptions {
  app: Description | null;
  parts: Record<string, Description>;
  files: Record<string, Description>;
  operations: Record<string, Description>;
  runs: DescribeRun[];
}

export interface PartLink {
  from: string;
  to: string;
  example: string;
}

export interface RouteChange {
  path: string;
  change: 'added' | 'removed' | 'changed';
  detail: string;
}

export interface OperationChange {
  name: string;
  change: 'added' | 'removed' | 'changed';
  type: OperationType;
  part: string;
  subgraphs: string[];
  newFields: string[];
}

export interface TouchedPart {
  part: string;
  added: string[];
  modified: string[];
  removed: string[];
}

export interface GraphDiff {
  meta: GraphMeta;
  /** Which optional sections the graphs have at all. */
  has: { operations: boolean; routes: boolean; flags: boolean };
  base: { label: string; sha: string };
  head: { label: string; sha: string | null };
  touchedParts: TouchedPart[];
  outsideMain: { area: string; files: string[] }[];
  hdsComponents: { name: string; usedByParts: string[] }[];
  newPartLinks: PartLink[];
  removedPartLinks: PartLink[];
  newCycles: string[][];
  operations: OperationChange[];
  routes: RouteChange[];
  newFlags: string[];
  removedFlags: string[];
  flagUses: { flag: string; parts: string[] }[];
  pocBoundary: string[];
  newGaps: Gap[];
  /** Why each part changed, written by whoever did the work (`notes.json`). */
  notes: Record<string, string>;
}
