import type { Adapter } from './adapter.js';
/**
 * Loads a project's adapter module. Its default export is
 * `(sinopia, { repo, name }) => Adapter`; `sinopia` is this package's API, so
 * the module needs no install of its own.
 */
export declare const loadAdapterFile: (file: string, repo: string, name: string) => Promise<Adapter>;
/**
 * The adapter for a repo: `js` or `plain` for the generic one, `auto` for the
 * repo's own LOCAL_ADAPTER or LOCAL_MAP when it has one (else js or plain by
 * its code), or a path to an adapter module or a map file. When a repo has
 * both, the adapter wins: it's the full-code escape hatch.
 */
export declare const pickAdapter: (choice: string, repo: string, name: string) => Promise<{
    adapter: Adapter;
    source: string;
}>;
