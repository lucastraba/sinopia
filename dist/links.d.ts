import type { FileLink, FileNode } from './model.js';
/** Every link out of a file, with its kind: imports, rendered components and the adapter's own links. */
export declare const fileLinks: (file: FileNode) => FileLink[];
/** Link kinds that are calls to a server: they count as server calls, like the operations an adapter lists. */
export declare const SERVER_CALL_KINDS: readonly string[];
export interface ServerCall {
    /** The operation's name, or what a server-call link carries (`counter.increment`, `POST /items`). */
    name: string;
    /** `operation` for the graph's operations, else the link's kind. */
    kind: string;
    /** The file that answers it, for a link; null for an operation (the operation knows its file). */
    target: string | null;
}
/** The server calls a file makes: its operations, then its server-call links, once per name. */
export declare const serverCallsOf: (file: FileNode) => ServerCall[];
/** The distinct file ids a file links to, whatever the kind. */
export declare const linkTargets: (file: FileNode) => string[];
/**
 * Adds a link to a file node, once per target, kind and label. For adapters
 * that find links the generic scan can't see.
 */
export declare const addLink: (file: FileNode, link: FileLink) => void;
