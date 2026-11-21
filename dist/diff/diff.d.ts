import type { Graph, GraphDiff, PartLink } from '../model.js';
/** Links between parts, from imports and rendered components, with one file-level example each. */
export declare const partLinks: (graph: Graph) => Map<string, PartLink>;
/**
 * Compares the graph at the base with the graph at the head and lists what a
 * reviewer should notice: parts touched, new links between parts and new
 * cycles, server calls and the services behind them, screens and their gates,
 * flags, and anything that crosses the boundary the map declares (POCs).
 * `partOf` places changed files that neither graph holds (repo-relative paths).
 */
export declare const diffGraphs: (base: Graph, head: Graph, nameStatus: string, untracked: string, notes: Record<string, string>, partOf: (path: string) => string | null) => GraphDiff;
