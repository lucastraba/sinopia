import { type CommonOptions, type Rule, type Scope } from './context.js';
export interface LinkOptions extends CommonOptions {
    /** What crosses the link: `event`, `ws-event`, `queue`, `command`. */
    kind: string;
    /** Where both sides live. `from` and `to` narrow it per side. */
    in?: Scope;
    /** Files that make the call. Defaults to `in`. */
    from?: Scope;
    /** Files that answer it. Defaults to `in`. */
    to?: Scope;
    /**
     * The calling shape, with `{key}` where the name that crosses goes: `'ee.emit({key}'`.
     * Leave it out when a file uses the name without a call shape (a registry
     * looked up by name, a global exposed by name): then any whole-word mention
     * of a key the answering side declares counts.
     */
    call?: string | RegExp | (string | RegExp)[];
    /** The answering shape, with the same `{key}`: `['ee.on({key}', 'on(ee, {key}']`. */
    answer: string | RegExp | (string | RegExp)[];
    /**
     * Calls made through exported helper functions count as calls from the
     * helper's callers: with `export const emitFoo = () => ee.emit(FOO)`, a file
     * calling `emitFoo()` emits FOO, and the helper's own file doesn't. When the
     * map knows imports, only files that import the helper's file (or are it)
     * count, so another function with the same name elsewhere doesn't.
     */
    wrappers?: boolean;
    /**
     * `'constants'`: when the key is a constant (`ee.emit(COUNTER_UPDATE)`), the
     * link's label is its string value (`'counter.update'`) from an
     * `export const` in the same files.
     */
    labels?: 'constants';
}
export declare const link: (options: LinkOptions) => Rule;
