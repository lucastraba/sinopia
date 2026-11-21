import { type Adapter } from '../adapter.js';
import type { FileKind } from '../model.js';
export declare const fileKindOf: (path: string) => FileKind;
interface FolderAdapterOptions {
    /** 'js' follows imports with dependency-cruiser; 'plain' only lists folders and files. */
    mode: 'js' | 'plain';
    name?: string;
}
/**
 * Maps any repo by its folders: each workspace package, each folder under
 * src/, or each top-level folder is a part. The 'js' mode adds the imports
 * between JS/TS files; the 'plain' mode, for Lua, shell and Python repos,
 * only lists files and leaves the rest to the descriptions.
 */
export declare const folderAdapter: (repo: string, { mode, name }: FolderAdapterOptions) => Adapter;
/** 'js' when most of the code is JS/TS and there is a package.json, else 'plain'. */
export declare const chooseMode: (files: string[]) => "js" | "plain";
export declare const autoAdapter: (repo: string, name?: string) => Adapter;
export {};
