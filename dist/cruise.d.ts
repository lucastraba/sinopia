export interface CruiseDependency {
    module: string;
    resolved: string;
    couldNotResolve: boolean;
}
interface CruiseModule {
    source: string;
    dependencies: CruiseDependency[];
}
interface CruiseViolation {
    rule: {
        name: string;
    };
    from: string;
    cycle?: {
        name: string;
    }[];
}
export interface CruiseOutput {
    modules: CruiseModule[];
    summary: {
        violations: CruiseViolation[];
    };
}
export interface FileImports {
    imports: string[];
    libraries: string[];
    /** Import specifier as written → resolved file id, for matching template tags to imports. */
    specifiers: Map<string, string>;
    unresolved: string[];
}
export interface ImportScan {
    byFile: Map<string, FileImports>;
    cycles: string[][];
}
export interface ReadOptions {
    /** Only files under this folder are mapped ('' for the whole repo). */
    srcDir: string;
    /** Which resolved files count as code; JSON and stylesheets are not parts of the architecture. */
    codeFile: RegExp;
    /** The workspace library a dependency belongs to, if any. */
    libraryOf: (dependency: CruiseDependency) => string | null;
    /** Specifiers that should resolve to a file here; when they don't, it's a gap. */
    isLocal: (specifier: string) => boolean;
}
export declare const CODE_FILE: RegExp;
/** A cycle listed from its smallest file id, so the same loop always reads the same. */
export declare const normalizeCycle: (cycle: string[]) => string[];
export declare const readCruise: (output: CruiseOutput, options?: Partial<ReadOptions>) => ImportScan;
/**
 * Runs the repo's own dependency-cruiser with the repo's own config, so its
 * aliases resolve the way its own checks resolve them. `cwd` is the repo or a
 * `git archive` snapshot of an older commit.
 */
export declare const cruiseWithRepoConfig: (repo: string, cwd: string, targets: string[], config: string, options?: Partial<ReadOptions>) => ImportScan;
/**
 * Runs sinopia's own dependency-cruiser on a repo that has no config for it:
 * follows nothing in node_modules, uses the repo's tsconfig.json when there is
 * one, and reports cycles that aren't type-only.
 */
export declare const cruiseWithoutConfig: (cwd: string, targets: string[], scratch: string, options?: Partial<ReadOptions>) => ImportScan;
export {};
