export declare const git: (root: string, args: string[]) => string;
export declare const repoRoot: (from?: string) => string;
/**
 * The repo a folder is in, for the CLI. sinopia lists files and commits
 * through git, so a folder outside a repo is a usage error with the fix, not
 * a stack trace.
 */
export declare const repoRootOf: (path: string) => string;
export declare const resolveSha: (root: string, ref: string) => string;
export declare const ensureDir: (dir: string) => string;
/**
 * Exports `paths` (or the whole tree when null) at `sha` into
 * `<artifacts>/snapshots/<sha>` with `git archive`, so an older commit can be
 * scanned without a checkout or a worktree.
 */
export declare const exportSnapshot: (root: string, artifacts: string, sha: string, paths: string[] | null) => string;
