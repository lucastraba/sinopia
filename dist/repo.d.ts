export declare const git: (root: string, args: string[]) => string;
export declare const repoRoot: (from?: string) => string;
export declare const resolveSha: (root: string, ref: string) => string;
export declare const ensureDir: (dir: string) => string;
/**
 * Exports `paths` (or the whole tree when null) at `sha` into
 * `<artifacts>/snapshots/<sha>` with `git archive`, so an older commit can be
 * scanned without a checkout or a worktree.
 */
export declare const exportSnapshot: (root: string, artifacts: string, sha: string, paths: string[] | null) => string;
