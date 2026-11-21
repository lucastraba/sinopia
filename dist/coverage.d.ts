import type { Graph } from './model.js';
/**
 * How much of a repo the map connects. Deterministic: the same graph always
 * gives the same numbers, so an agent improving an adapter can compare runs.
 */
export interface Coverage {
    adapter: string;
    passes: boolean;
    gaps: {
        error: number;
        warning: number;
        info: number;
    };
    files: number;
    codeFiles: number;
    tests: number;
    parts: number;
    largestPart: {
        id: string;
        files: number;
    } | null;
    /** Files no part claims (the scan reported them as unpartitioned). */
    unclaimed: number;
    /** Code files with no link in or out (tests don't count as links in). */
    isolated: {
        count: number;
        share: number;
        examples: string[];
    };
    /** Imports and links whose target the scan couldn't resolve. */
    unresolved: number;
    /** Links by kind: import, component, operation, and each kind the adapter adds. */
    links: Record<string, number>;
    /** Distinct part-to-part pairs with at least one link. */
    partLinks: number;
    routes: number;
    operations: number;
}
export declare const coverageOf: (graph: Graph, adapter: string) => Coverage;
export declare const formatCoverage: (coverage: Coverage) => string[];
