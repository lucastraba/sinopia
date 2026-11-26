import type { AreaSpec, ClaimResult, ClaimSpec, Graph } from './model.js';
/**
 * Adds `areas`, `areaLinks`, `linkTotals` and `claims` to the graph, and the
 * gaps they raise: a part in no written area (warning), an enforced claim
 * that's broken (error). `specs` null: the map writes no areas.
 */
export declare const addAreas: (graph: Graph, specs: Record<string, AreaSpec> | null, claims: ClaimSpec[]) => void;
/** One line on how a claim came out: what broke it, or what it checked. */
export declare const claimStatus: (claim: ClaimResult) => string;
/** What `check` prints after the rules: the areas, the biggest lines between them, and every claim. */
export declare const formatAreas: (graph: Graph) => string[];
