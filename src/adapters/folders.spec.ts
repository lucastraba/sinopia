import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { folderPartOf, folderPartsOf } from './files.js';
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

describe('folderPartsOf', () => {
  const partOf = (files: string[], path: string, maxFiles?: number) =>
    folderPartOf(path, folderPartsOf(files, undefined, maxFiles)).id;

  it('makes each workspace package, each folder under src and each top folder a part', () => {
    const files = [
      'packages/api/package.json',
      'packages/api/src/server.ts',
      'src/sync/run.ts',
      'src/index.ts',
      'scripts/deploy.sh',
      'install.sh',
    ];
    expect(partOf(files, 'packages/api/src/server.ts')).toBe('packages/api');
    expect(partOf(files, 'src/sync/run.ts')).toBe('src/sync');
    expect(partOf(files, 'src/index.ts')).toBe('src');
    expect(partOf(files, 'scripts/deploy.sh')).toBe('scripts');
    expect(folderPartOf('install.sh', folderPartsOf(files))).toMatchObject({ id: '(root)', kind: 'root' });
  });

  it('finds packages at any depth and splits their src folders like the root', () => {
    const files = [
      'projects/apps/hub/package.json',
      'projects/apps/hub/src/main.ts',
      'projects/apps/hub/src/features/chat.ts',
      'projects/apps/hub/vite.config.ts',
      'projects/apps/server/package.json',
      'projects/apps/server/src/index.ts',
    ];
    const parts = folderPartsOf(files);
    expect(folderPartOf('projects/apps/hub/src/features/chat.ts', parts)).toMatchObject({
      id: 'projects/apps/hub/src/features',
      name: 'hub/features',
    });
    expect(folderPartOf('projects/apps/hub/src/main.ts', parts)).toMatchObject({ id: 'projects/apps/hub', kind: 'package' });
    expect(folderPartOf('projects/apps/hub/vite.config.ts', parts).id).toBe('projects/apps/hub');
    expect(folderPartOf('projects/apps/server/src/index.ts', parts).id).toBe('projects/apps/server');
  });

  it('splits a part that has too many files by its subfolders', () => {
    const files = ['src/ui/app.ts', 'src/ui/menus/main.ts', 'src/ui/menus/pause.ts', 'src/ui/hud/bar.ts', 'src/ui/hud/deep/x.ts'];
    expect(partOf(files, 'src/ui/menus/main.ts', 3)).toBe('src/ui/menus');
    expect(partOf(files, 'src/ui/hud/deep/x.ts', 3)).toBe('src/ui/hud');
    expect(partOf(files, 'src/ui/app.ts', 3)).toBe('src/ui');
    expect(folderPartOf('src/ui/menus/main.ts', folderPartsOf(files, undefined, 3)).name).toBe('ui/menus');
    // A folder with one subfolder isn't split: it would only rename the part.
    expect(partOf(['lib/a/1.ts', 'lib/a/2.ts', 'lib/a/3.ts'], 'lib/a/1.ts', 2)).toBe('lib');
    // Below the limit nothing is split.
    expect(partOf(files, 'src/ui/menus/main.ts')).toBe('src/ui');
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

  it('lists the scripts of a JS repo without links, and skips tool state', async () => {
    const repo = makeRepo({
      'package.json': '{"name":"ops","type":"module"}',
      'alerts/alert.mjs': 'export const raise = () => {};\n',
      'bin/deploy': '#!/bin/sh\necho deploy\n',
      'bin/notes': 'not a script\n',
      'start-page/server.py': 'print("hi")\n',
      '.serena/project.yml': 'name: ops\n',
      '.history/a.ts': 'export {};\n',
    });
    repos.push(repo);
    const graph = await folderAdapter(repo, { mode: 'js' }).scan({
      repo,
      root: repo,
      artifacts: join(repo, '.map'),
      source: { label: 'test', sha: null },
    });
    expect(graph.files.map((file) => file.id)).toEqual(['alerts/alert.mjs', 'bin/deploy', 'start-page/server.py']);
    expect(graph.files.find((file) => file.id === 'bin/deploy')?.kind).toBe('script');
  });
});
