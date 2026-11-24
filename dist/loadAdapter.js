import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UsageError } from './args.js';
import { LOCAL_ADAPTER } from './adapterInit.js';
import { autoAdapter, folderAdapter } from './adapters/folders.js';
import { LOCAL_MAP, mapAdapter } from './rules/index.js';
/** A map file holds rules (`.sinopia/map.mjs`, or a `map.mjs`, `*.map.mjs` or `*-map.mjs` passed with --adapter); anything else is an adapter module. */
const isMapFile = (file) => /(^|[.-])map\.mjs$/.test(basename(file));
/**
 * Loads a project's adapter module. Its default export is
 * `(sinopia, { repo, name }) => Adapter`; `sinopia` is this package's API, so
 * the module needs no install of its own.
 */
export const loadAdapterFile = async (file, repo, name) => {
    const api = await import('./index.js');
    const module = (await import(pathToFileURL(file).href));
    if (typeof module.default !== 'function') {
        throw new Error(`${file} must export a default function (sinopia, { repo, name }) => adapter`);
    }
    return (await module.default(api, { repo, name }));
};
/**
 * The adapter for a repo: `js` or `plain` for the generic one, `auto` for the
 * repo's own LOCAL_ADAPTER or LOCAL_MAP when it has one (else js or plain by
 * its code), or a path to an adapter module or a map file. When a repo has
 * both, the adapter wins: it's the full-code escape hatch.
 */
export const pickAdapter = async (choice, repo, name) => {
    if (choice === 'js' || choice === 'plain') {
        return { adapter: folderAdapter(repo, { mode: choice, name }), source: choice };
    }
    const local = join(repo, LOCAL_ADAPTER);
    const localMap = join(repo, LOCAL_MAP);
    let file;
    if (choice === 'auto') {
        file = existsSync(local) ? local : existsSync(localMap) ? localMap : null;
        if (file === local && existsSync(localMap)) {
            console.warn(`! ${repo} has both ${LOCAL_ADAPTER} and ${LOCAL_MAP}; using the adapter. Move what it adds into the map, or delete the map.`);
        }
    }
    else {
        file = resolve(choice);
    }
    if (!file) {
        const adapter = autoAdapter(repo, name);
        return { adapter, source: adapter.name };
    }
    if (!existsSync(file))
        throw new UsageError(`No adapter at ${file}`);
    const adapter = isMapFile(file) ? await mapAdapter(file, repo, name) : await loadAdapterFile(file, repo, name);
    return { adapter, source: file };
};
