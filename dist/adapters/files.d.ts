/**
 * The repo's files: tracked and untracked-but-not-ignored ones in a working
 * tree, or everything outside build and dependency folders in a snapshot.
 */
export declare const listFiles: (root: string) => string[];
export declare const sha1: (value: string) => string;
/** Text content of a file, or null for binaries and files over `maxBytes`. */
export declare const readText: (path: string, maxBytes: number) => string | null;
/** The README (or CLAUDE.md, AGENTS.md) at the repo root, trimmed, as background for describe. */
export declare const readmeOf: (repo: string, maxChars?: number) => string;
/** Generic folder parts: `packages/<name>` for workspace packages, `src/<dir>`, else the top folder. */
export declare const folderPartOf: (path: string, packageDirs: Set<string>) => {
    id: string;
    kind: string;
    name: string;
    dir: string;
};
/** Folders that hold a workspace package: `<dir>/<name>/package.json`, one level under the root. */
export declare const packageDirsOf: (files: string[]) => Set<string>;
