#!/usr/bin/env node
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { autoAdapter, folderAdapter } from './adapters/folders.js';
import { runCli } from './cli.js';
import { repoRoot } from './repo.js';
import { serve } from './serve.js';
const USAGE = `sinopia <command> [repo] [options]

  scan | describe | diff | refresh [repo]
        --adapter auto|js|plain   how to read the repo (default auto)
        --name <name>             the map's name (default: the repo folder)
        --out <dir>               where the map goes (default $SINOPIA_HOME/maps/<name>)
        plus the command's own options (pnpm map help lists them)
  serve [--maps <dir> | --data <dir>] [--host <ip>] [--port 8400]
        every map under --maps at /p/<name>/, or one map at /

SINOPIA_HOME defaults to ~/.local/share/sinopia; SINOPIA_CLAUDE points at claude when it isn't on PATH.`;
const home = process.env.SINOPIA_HOME ?? join(homedir(), '.local', 'share', 'sinopia');
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
    if (!command || !['scan', 'describe', 'diff', 'refresh'].includes(command)) {
        console.log(USAGE);
        if (command && command !== 'help')
            process.exitCode = 1;
        return;
    }
    const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        strict: false,
        options: {
            adapter: { type: 'string', default: 'auto' },
            name: { type: 'string' },
            out: { type: 'string' },
        },
    });
    const repo = repoRoot(resolve(positionals[0] ?? '.'));
    const name = typeof values.name === 'string' ? values.name : basename(repo);
    const out = resolve(typeof values.out === 'string' ? values.out : join(home, 'maps', name));
    const adapter = values.adapter === 'js' || values.adapter === 'plain'
        ? folderAdapter(repo, { mode: values.adapter, name })
        : autoAdapter(repo, name);
    const own = new Set(['--adapter', '--name', '--out']);
    const argv = [command];
    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index] ?? '';
        if (own.has(arg)) {
            index += 1;
        }
        else if (![...own].some((flag) => arg.startsWith(`${flag}=`)) && arg !== positionals[0]) {
            argv.push(arg);
        }
    }
    await runCli({ adapter, repo, out, argv, command: 'sinopia', diffBase: null });
};
await main();
