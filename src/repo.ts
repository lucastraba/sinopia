import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const git = (root: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

export const repoRoot = (from = process.cwd()): string =>
  git(from, ['rev-parse', '--show-toplevel']);

export const resolveSha = (root: string, ref: string): string =>
  git(root, ['rev-parse', '--verify', `${ref}^{commit}`]);

export const ensureDir = (dir: string): string => {
  mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Exports `paths` (or the whole tree when null) at `sha` into
 * `<artifacts>/snapshots/<sha>` with `git archive`, so an older commit can be
 * scanned without a checkout or a worktree.
 */
export const exportSnapshot = (
  root: string,
  artifacts: string,
  sha: string,
  paths: string[] | null
): string => {
  const dir = join(artifacts, 'snapshots', sha);
  if (existsSync(dir) && readdirSync(dir).length > 0) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync(
    'sh',
    ['-c', 'git archive "$0" -- "$@" | tar -x -C "$DEST"', sha, ...(paths ?? ['.'])],
    { cwd: root, env: { ...process.env, DEST: dir } }
  );
  return dir;
};
