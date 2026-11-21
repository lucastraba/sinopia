import type { FileNode, Graph, Part } from '../model.js';
import { type DescribeContext } from './prompt.js';
export declare const fileKey: (file: FileNode) => string;
export declare const partKey: (part: Part, graph: Graph) => string;
export declare const isDescribable: (file: FileNode) => boolean;
/** Groups files into prompts of at most `limit` characters; a bigger file goes alone. */
export declare const chunkBySize: <T>(items: T[], size: (item: T) => number, limit: number) => T[][];
export interface DescribeOptions {
    root: string;
    artifacts: string;
    graph: Graph;
    context: DescribeContext;
    parts: string[] | null;
    model: string;
    estimateOnly: boolean;
}
/**
 * Describes parts, files and operations with `claude -p`, cached by content:
 * a file is described again only when its content (or the prompt) changes.
 * Writes `.artifacts/map/descriptions.json` after each part, so an interrupted
 * run keeps what it finished.
 */
export declare const describe: ({ root, artifacts, graph, context, parts: only, model, estimateOnly, }: DescribeOptions) => Promise<void>;
