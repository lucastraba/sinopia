/** True when a path holds glob characters, so it's a pattern rather than a folder or file. */
export declare const isGlob: (path: string) => boolean;
/** The regular expression source for a glob, unanchored. */
export declare const globSource: (pattern: string) => string;
/** A glob that matches whole repo-relative paths. */
export declare const globToRegExp: (pattern: string) => RegExp;
/** A glob scope: a path it matches, or a path inside a folder it matches. */
export declare const globScope: (pattern: string) => RegExp;
