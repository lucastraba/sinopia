/** Index just past the string literal starting at `i` (template literals included, simply). */
export declare const skipString: (text: string, i: number) => number;
/** JS/TS text with comments blanked out. Strings are kept. */
export declare const stripJsComments: (text: string) => string;
/**
 * Python text with `#` comments and triple-quoted strings (docstrings) blanked
 * out, offsets kept. Strings are read first, so a `#` inside one stays.
 */
export declare const stripPy: (text: string) => string;
/** Comments blanked out, by the file's language. Other files come back unchanged. */
export declare const stripComments: (id: string, text: string) => string;
/** Index of the bracket that closes the one at `open`, skipping strings. */
export declare const matchBracket: (text: string, open: number) => number;
export interface ObjectEntry {
    key: string;
    /** Where the value starts and ends in the text. */
    start: number;
    end: number;
    value: string;
}
/** Top-level `key: value` entries of the object literal whose `{` is at `open`. Spreads and shorthands are skipped. */
export declare const objectEntries: (text: string, open: number) => ObjectEntry[];
/** 1-based line number of an index. */
export declare const lineOf: (text: string, index: number) => number;
/** A relative import specifier from `fromId`, resolved to a mapped file id. */
export declare const resolveRelative: (ids: Set<string>, fromId: string, spec: string) => string | null;
/**
 * The file a Python module name points at, looked up from `fromId` upwards:
 * `<dir>/<module>.py`, `<dir>/<module>/__init__.py`, and the same under `src/`.
 */
export declare const pythonModuleFile: (ids: Set<string>, fromId: string, module: string) => string | null;
