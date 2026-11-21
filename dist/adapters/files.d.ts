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
export interface FolderPart {
    id: string;
    kind: 'package' | 'folder' | 'root';
    name: string;
    dir: string;
}
/** A part this size or bigger is split by its subfolders. */
export declare const MAX_PART_FILES = 40;
/** Folders that hold a workspace package (`<dir>/package.json`), at any depth below the root. */
export declare const packageDirsOf: (files: string[]) => Set<string>;
/**
 * The parts of a repo, by folder: workspace packages, `src/<dir>`, top folders,
 * and the root. A part with MAX_PART_FILES files or more that spreads over two
 * or more subfolders is split into one part per subfolder (repeatedly); its
 * own top-level files stay in it.
 */
export declare const folderPartsOf: (files: string[], packageDirs?: Set<string>, maxFiles?: number) => Map<string, FolderPart>;
/** The part of any path, also one in a folder the parts were not built from. */
export declare const folderPartOf: (path: string, parts: Map<string, FolderPart>) => FolderPart;
