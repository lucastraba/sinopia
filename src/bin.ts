#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AdapterVersionError } from './adapter.js';
import { splitCommandArgs, UsageError } from './args.js';
import { pickAdapter } from './loadAdapter.js';
import { adapterInit, LOCAL_ADAPTER, mapInit } from './adapterInit.js';
import { LOCAL_MAP } from './rules/index.js';
import { runCli } from './cli.js';
import { repoRootOf } from './repo.js';
import { serve } from './serve.js';

const USAGE = `sinopia <command> [repo] [options]

  scan | check | describe | diff | refresh [repo]
        --adapter auto|js|plain|<file>
                                  how to read the repo (default auto: the repo's own
                                  ${LOCAL_ADAPTER} or ${LOCAL_MAP} when it has one,
                                  else js or plain)
        --name <name>             the map's name (default: the repo folder)
        --out <dir>               where the map goes (default $SINOPIA_HOME/maps/<name>)
        plus the command's own options (sinopia help lists them)
  serve [--maps <dir> | --data <dir>] [--host <ip>] [--port 8400]
        every map under --maps at /p/<name>/, or one map at /
  map init [repo] [--force]
        write ${LOCAL_MAP}, the rules for links imports don't show, and print next steps
  map docs
        print the rules and their primitives (docs/map.md)
  adapter init [repo] [--adapter js|plain] [--force]
        write ${LOCAL_ADAPTER}: full code, for what map rules can't say
  adapter docs
        print the adapter interface (docs/adapters.md)

SINOPIA_HOME defaults to ~/.local/share/sinopia; SINOPIA_CLAUDE points at claude when it isn't on PATH.`;

const home = process.env.SINOPIA_HOME ?? join(homedir(), '.local', 'share', 'sinopia');
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'serve') {
    const { values } = parseArgs({
      args: rest,
      options: {
        maps: { type: 'string' },
        data: { type: 'string' },
        host: { type: 'string', default: '127.0.0.1' },
        port: { type: 'string', default: '8400' },
      },
    });
    serve({
      host: values.host,
      port: Number(values.port),
      ...(values.data ? { data: resolve(values.data) } : { maps: resolve(values.maps ?? join(home, 'maps')) }),
    });
    return;
  }
  if (command === 'adapter' || command === 'map') {
    const [sub, ...args] = rest;
    if (sub === 'docs') {
      console.log(readFileSync(join(packageRoot, 'docs', command === 'map' ? 'map.md' : 'adapters.md'), 'utf8'));
      return;
    }
    if (sub === 'init') {
      const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        options: { adapter: { type: 'string' }, force: { type: 'boolean', default: false } },
      });
      const repo = repoRootOf(resolve(positionals[0] ?? '.'));
      if (command === 'map') {
        mapInit({ repo, force: values.force });
        return;
      }
      const mode = values.adapter === 'js' || values.adapter === 'plain' ? values.adapter : null;
      adapterInit({ repo, mode, force: values.force });
      return;
    }
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  if (!command || !['scan', 'check', 'describe', 'diff', 'refresh'].includes(command)) {
    console.log(USAGE);
    if (command && command !== 'help') process.exitCode = 1;
    return;
  }
  const parsed = splitCommandArgs(rest);
  const repoPath = resolve(parsed.repo ?? '.');
  if (!existsSync(repoPath)) throw new UsageError(`No folder at ${repoPath}`);
  const repo = repoRootOf(repoPath);
  const name = parsed.name ?? basename(repo);
  const out = resolve(parsed.out ?? join(home, 'maps', name));
  const { adapter, source } = await pickAdapter(parsed.adapter, repo, name);
  const argv = [command, ...parsed.passOn];
  await runCli({ adapter, adapterSource: source, repo, out, argv, command: 'sinopia', diffBase: null });
};

try {
  await main();
} catch (error) {
  // A version mismatch is a message for the user; anything else is a bug, maybe in
  // a project's adapter, and its stack says where.
  console.error(error instanceof AdapterVersionError || error instanceof UsageError ? error.message : error);
  process.exitCode = 1;
}
