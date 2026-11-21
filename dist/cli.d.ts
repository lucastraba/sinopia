import { type Adapter } from './adapter.js';
export interface CliOptions {
    adapter: Adapter;
    repo: string;
    /** Where the graph, descriptions, diff and caches go. */
    out: string;
    argv: string[];
    /** Where the adapter came from, for error messages (a file path, "js"). */
    adapterSource?: string;
    /** How the usage text names the command: "pnpm map", "sinopia". */
    command: string;
    /**
     * The branch `diff` compares against by default, fetched first ("origin/main").
     * Null: the merge-base with origin/HEAD when the repo has one, else HEAD.
     */
    diffBase: string | null;
}
export interface ProjectState {
    name: string;
    repo: string;
    adapter: string;
    scannedSha: string | null;
    describedSha: string | null;
    updatedAt: string;
}
export declare const readState: (out: string) => ProjectState | null;
/** The commands every map has: scan, describe, diff, refresh and serve. */
export declare const runCli: (options: CliOptions) => Promise<void>;
