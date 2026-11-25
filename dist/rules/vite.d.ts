import { type Rule } from './context.js';
import type { ScopeOptions } from './tools.js';
/** The patterns of each `import.meta.glob(…)` call: one string or a list, `!` for the ones left out. */
export declare const globCalls: (text: string) => {
    index: number;
    patterns: string[];
}[];
/**
 * Vite's `import.meta.glob('./icons/*.vue')`: the file that globs, linked to
 * every file on the map the pattern names. Patterns are relative, start at
 * the Vite root (`/src/…`), or use an alias the project declares (`@/…`).
 */
export declare const globImports: (options?: ScopeOptions) => Rule;
