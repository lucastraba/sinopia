import type { GraphDiff } from '../model.js';
/** The plain-text report `pnpm map diff` prints, short enough to paste at the end of a task. */
export declare const formatDiff: (diff: GraphDiff) => string;
