import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Adapter } from './adapter.js';
import { UsageError } from './args.js';
import { LOCAL_ADAPTER } from './adapterInit.js';
import { autoAdapter, folderAdapter } from './adapters/folders.js';

/**
 * Loads a project's adapter module. Its default export is
 * `(sinopia, { repo, name }) => Adapter`; `sinopia` is this package's API, so
 * the module needs no install of its own.
 */
export const loadAdapterFile = async (file: string, repo: string, name: string): Promise<Adapter> => {
  const api = await import('./index.js');
  const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
  if (typeof module.default !== 'function') {
    throw new Error(`${file} must export a default function (sinopia, { repo, name }) => adapter`);
  }
  return (await module.default(api, { repo, name })) as Adapter;
};

/**
 * The adapter for a repo: `js` or `plain` for the generic one, `auto` for the
 * repo's own LOCAL_ADAPTER when it has one (else js or plain by its code), or
 * a path to an adapter module.
 */
export const pickAdapter = async (
  choice: string,
  repo: string,
  name: string
): Promise<{ adapter: Adapter; source: string }> => {
  if (choice === 'js' || choice === 'plain') {
    return { adapter: folderAdapter(repo, { mode: choice, name }), source: choice };
  }
  const local = join(repo, LOCAL_ADAPTER);
  const file = choice === 'auto' ? (existsSync(local) ? local : null) : resolve(choice);
  if (!file) {
    const adapter = autoAdapter(repo, name);
    return { adapter, source: adapter.name };
  }
  if (!existsSync(file)) throw new UsageError(`No adapter at ${file}`);
  return { adapter: await loadAdapterFile(file, repo, name), source: file };
};

