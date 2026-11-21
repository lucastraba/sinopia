import type { FileLink, FileNode } from './model.js';
/** Every link out of a file, with its kind: imports, rendered components and the adapter's own links. */
export declare const fileLinks: (file: FileNode) => FileLink[];
/** The distinct file ids a file links to, whatever the kind. */
export declare const linkTargets: (file: FileNode) => string[];
/**
 * Adds a link to a file node, once per target, kind and label. For adapters
 * that find links the generic scan can't see.
 */
export declare const addLink: (file: FileNode, link: FileLink) => void;
