export interface Resolver {
    /**
     * The file a specifier written in `from` points at, or null for a package
     * outside the repo or a path that isn't there. `exists` says which files
     * count (the files on the map). Extensions and index files are tried the
     * way TypeScript and Vite try them.
     */
    resolve(from: string, spec: string, exists: (id: string) => boolean): string | null;
    /**
     * The repo-relative path a specifier names, with no file looked up: for
     * patterns (`'@/icons/*.vue'` becomes `'src/icons/*.vue'`). A leading `/`
     * is the Vite root. Null for a package.
     */
    toPath(from: string, spec: string): string | null;
}
/** An alias rule: `pattern` with at most one `*`, and the paths it stands for. */
interface Alias {
    pattern: string;
    targets: string[];
}
/** JSON with comments and trailing commas, as tsconfig files are written. Null when it doesn't parse. */
export declare const parseJsonc: (text: string) => unknown;
/** Vite's `resolve.alias`, object or `[{ find, replacement }]` form, as aliases relative to the repo. */
export declare const viteAliases: (text: string, configDir: string) => Alias[];
/** A resolver for the repo at `root`; `repoFiles` lists its files, `read` reads one (from disk by default). */
export declare const makeResolver: (root: string, repoFiles: () => string[], read?: (id: string) => string | null) => Resolver;
export {};
