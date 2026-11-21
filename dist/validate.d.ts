import type { Gap, Graph } from './model.js';
/**
 * Checks the graph against itself and the code it came from: every file sits
 * in exactly one part, every link points at a scanned file, every operation
 * reaches a subgraph. Anything that fails becomes a gap, so a scan never hides
 * what it couldn't place.
 */
export declare const validateGraph: (graph: Graph, scannedFileCount: number) => Gap[];
export declare const summarizeGaps: (gaps: Gap[]) => string[];
