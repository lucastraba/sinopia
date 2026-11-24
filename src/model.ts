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
