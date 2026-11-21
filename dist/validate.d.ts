import type { Gap, Graph } from './model.js';
/**
 * Checks the graph against itself and the code it came from: every file sits
 * in exactly one part, every link points at a scanned file, every operation
 * reaches a subgraph. Anything that fails becomes a gap, so a scan never hides
 * what it couldn't place.
 */
/**
 * `scannedFileCount` is how many files the adapter read, when it knows: then
 * parts plus unpartitioned files must add up to it. Without it (the core's
 * own run after every scan) the check is that every file node sits in a part;
 * parts may also hold files without a node, such as GraphQL documents.
 */
export declare const validateGraph: (graph: Graph, scannedFileCount?: number) => Gap[];
export declare const summarizeGaps: (gaps: Gap[]) => string[];
