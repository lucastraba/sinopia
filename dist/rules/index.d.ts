import { type Adapter } from '../adapter.js';
import { type Rule, ruleContext } from './context.js';
export type { Rule, RuleContext, RuleReport, Scope } from './context.js';
/** Where a project keeps its map rules. `sinopia` loads them by default when they exist. */
export declare const LOCAL_MAP = ".sinopia/map.mjs";
/** The primitives a map file gets: its default export is `(primitives) => rules`. */
export declare const primitives: {
    link: (options: import("./link.js").LinkOptions) => Rule;
    trpc: (options: import("./trpc.js").TrpcOptions) => Rule;
    http: (options: import("./http.js").HttpOptions) => Rule;
    spawn: (options?: import("./tools.js").ScopeOptions) => Rule;
    vitest: (options?: import("./context.js").CommonOptions) => Rule;
    vueRoutes: (options?: import("./tools.js").ScopeOptions) => Rule;
    pythonImports: (options?: import("./tools.js").ScopeOptions) => Rule;
    dataFiles: (options: import("./tools.js").DataFilesOptions) => Rule;
    runs: (options: import("./tools.js").RunsOptions) => Rule;
    externalServices: (options?: import("./tools.js").ExternalServicesOptions) => Rule;
    external: (options: import("./tools.js").ExternalOptions) => Rule;
    custom: (options: import("./tools.js").CustomOptions) => Rule;
};
export type Primitives = typeof primitives;
/** Runs the rules over a graph in order, writing what each did to `graph.meta.rules`. */
export declare const applyRules: (rules: Rule[], graph: Parameters<typeof ruleContext>[0], input: Parameters<typeof ruleContext>[1]) => void;
/** An adapter from a map file: the generic adapter, then the file's rules. */
export declare const mapAdapter: (file: string, repo: string, name: string) => Promise<Adapter>;
