import type { ScanInput } from '../adapter.js';
import type { FileLink, FileNode, Gap, Graph, RuleReport } from '../model.js';
import { type CompiledTemplate } from './template.js';
/** Folders or files a rule looks at: a repo-relative path or a list of them. Empty means the whole repo. */
export type Scope = string | string[];
export type { RuleReport };
export interface Rule {
    rule: string;
    summary: string;
    why: string | null;
    draft: boolean;
    templates: CompiledTemplate[];
    run(ctx: RuleContext): void;
}
/** Everything a rule (or a `custom` function) gets to read the repo and write the graph. */
export interface RuleContext {
    graph: Graph;
    input: ScanInput;
    ids: Set<string>;
    byId: Map<string, FileNode>;
    /** A file's text from the scan root, or '' when it can't be read. */
    read(id: string): string;
    /** The same text with comments blanked out (JS/TS, Vue, Python), offsets kept. */
    code(id: string): string;
    /** Mapped files under the scope, tests left out. */
    files(scope?: Scope): FileNode[];
    inScope(id: string, scope?: Scope): boolean;
    addLink(file: FileNode, link: FileLink): void;
    /** Adds an import between two mapped files, once. */
    addImport(file: FileNode, target: string): void;
    addGap(gap: Gap): void;
    addRoute(route: Graph['routes'][number]): void;
    /**
     * Puts a file the generic scan skipped on the map (a data file, a language
     * it doesn't read), in the part of its folder, and returns it. Null when it
     * can't be read. A file already mapped comes back as it is.
     */
    addFile(id: string): FileNode | null;
}
export declare const scopeList: (scope: Scope | undefined) => string[];
export declare const inScope: (id: string, scope: Scope | undefined) => boolean;
/** Test files: mapped as tests, plus pytest's conftest.py. Rules never look at them. */
export declare const isTestFile: (file: FileNode) => boolean;
/** A context for one rule, counting what it adds into `report`. */
export declare const ruleContext: (graph: Graph, input: ScanInput, report: RuleReport, cache: Map<string, string>) => RuleContext;
export interface CommonOptions {
    /** Why the rule exists, in a sentence. Shown with what the rule found. */
    why?: string;
    /** Written by an agent and not yet confirmed. `check` lists drafts. */
    draft?: boolean;
}
export declare const COMMON_KEYS: readonly ["why", "draft"];
/** Refuses options a primitive doesn't know, so a typo in the map fails loudly instead of doing nothing. */
export declare const checkOptions: (rule: string, options: object, allowed: readonly string[]) => void;
export declare const templatesOf: (value: string | RegExp | (string | RegExp)[] | undefined) => CompiledTemplate[];
export declare const describeScope: (scope: Scope | undefined) => string;
export declare const makeRule: (rule: string, options: CommonOptions, summary: string, templates: CompiledTemplate[], run: (ctx: RuleContext) => void) => Rule;
