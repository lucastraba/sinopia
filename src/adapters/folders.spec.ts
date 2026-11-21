import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { folderPartOf } from './files.js';
import { chooseMode, fileKindOf, folderAdapter } from './folders.js';

const makeRepo = (files: Record<string, string>): string => {
  const repo = mkdtempSync(join(tmpdir(), 'sinopia-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
};

describe('folderPartOf', () => {
  const packages = new Set(['packages/api']);

  it('makes each workspace package, each folder under src and each top folder a part', () => {
    expect(folderPartOf('packages/api/src/server.ts', packages).id).toBe('packages/api');
    expect(folderPartOf('src/sync/run.ts', packages).id).toBe('src/sync');
    expect(folderPartOf('src/index.ts', packages).id).toBe('src');
    expect(folderPartOf('scripts/deploy.sh', packages).id).toBe('scripts');
    expect(folderPartOf('install.sh', packages)).toMatchObject({ id: '(root)', kind: 'root' });
  });
});

describe('chooseMode', () => {
  it('follows imports in JS/TS repos and lists files in everything else', () => {
    expect(chooseMode(['package.json', 'src/a.ts', 'src/b.ts', 'src/c.ts'])).toBe('js');
    expect(chooseMode(['init.lua', 'lua/a.lua', 'lua/b.lua', 'install.sh'])).toBe('plain');
    expect(chooseMode(['package.json', 'a.js', 'b.py', 'c.py', 'd.py', 'e.py'])).toBe('plain');
  });
});

describe('fileKindOf', () => {
  it.each([
    ['src/sync.spec.ts', 'test'],
    ['tests/test_scout.py', 'test'],
    ['README.md', 'doc'],
    ['systemd/board.service', 'config'],
    ['lua/plugins.lua', 'script'],
    ['src/App.vue', 'component'],
  ])('%s is a %s', (path, kind) => {
    expect(fileKindOf(path)).toBe(kind);
  });
});

describe('folderAdapter', () => {
  const repos: string[] = [];
  afterAll(() => {
    for (const repo of repos) rmSync(repo, { recursive: true, force: true });
  });

  it('maps a JS repo with the imports between its files', async () => {
    const repo = makeRepo({
      'package.json': '{"name":"demo","type":"module"}',
      'src/index.ts': "import { run } from './sync/run';\nrun();\n",
      'src/sync/run.ts': "import { log } from '../log/log';\nexport const run = () => log('hi');\n",
      'src/log/log.ts': 'export const log = (message: string) => console.log(message);\n',
    });
    repos.push(repo);
    const graph = await folderAdapter(repo, { mode: 'js' }).scan({
      repo,
      root: repo,
      artifacts: join(repo, '.map'),
      source: { label: 'test', sha: null },
    });
    expect(graph.parts.map((part) => part.id)).toEqual(['src', 'src/log', 'src/sync']);
    expect(graph.files.find((file) => file.id === 'src/sync/run.ts')?.imports).toEqual(['src/log/log.ts']);
    expect(graph.gaps.filter((gap) => gap.level === 'error')).toEqual([]);
  });

  it('lists the files of a repo it has no links for', async () => {
    const repo = makeRepo({
      'init.lua': "require('plugins')\n",
      'lua/plugins.lua': 'return {}\n',
      'install.sh': '#!/bin/sh\necho hi\n',
      'logo.png': '\u0000PNG',
    });
    repos.push(repo);
    const graph = await folderAdapter(repo, { mode: 'plain' }).scan({
      repo,
      root: repo,
      artifacts: join(repo, '.map'),
      source: { label: 'test', sha: null },
    });
    expect(graph.meta.hasLinks).toBe(false);
    expect(graph.files.map((file) => file.id)).toEqual(['init.lua', 'install.sh', 'lua/plugins.lua']);
    expect(graph.files.every((file) => file.imports.length === 0)).toBe(true);
  });
});
