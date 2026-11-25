import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRootOf } from './repo.js';
import { splitCommandArgs, UsageError } from './args.js';

describe('repoRootOf', () => {
  it('says how to fix a folder outside a git repository instead of throwing a git stack trace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sinopia-not-a-repo-'));
    try {
      expect(() => repoRootOf(dir)).toThrow(UsageError);
      expect(() => repoRootOf(dir)).toThrow(/is not in a git repository.*git init/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('splitCommandArgs', () => {
  it('never takes an option value for the repo', () => {
    expect(splitCommandArgs(['--base', 'main~3'])).toMatchObject({ repo: null, passOn: ['--base', 'main~3'] });
    expect(splitCommandArgs(['../app', '--head', 'feature', '--json'])).toMatchObject({
      repo: '../app',
      passOn: ['--head', 'feature', '--json'],
    });
    expect(splitCommandArgs(['--part', 'src/a', '--part', 'src/b', 'repo'])).toMatchObject({
      repo: 'repo',
      passOn: ['--part', 'src/a', '--part', 'src/b'],
    });
  });

  it("keeps sinopia's own options out of what runCli gets", () => {
    expect(splitCommandArgs(['repo', '--adapter', 'js', '--name=x', '--out', '/tmp/m', '--force'])).toEqual({
      repo: 'repo',
      adapter: 'js',
      name: 'x',
      out: '/tmp/m',
      passOn: ['--force'],
    });
  });
});
