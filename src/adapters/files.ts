import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../repo.js';

const SKIPPED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  'out',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.turbo',
  '.cache',
  'vendor',
  // Editor and agent tool state, not the project's code.
  '.serena',
  // Where a project keeps its sinopia adapter: tooling, not the project's code.
  '.sinopia',
  '.history',
  '.vscode',
  '.idea',
]);

/** True for a path inside a folder no map holds: dependencies, builds, tool state, the sinopia adapter. */
export const isSkippedPath = (path: string): boolean =>
  path.split('/').some((segment) => SKIPPED_DIRS.has(segment));

const walk = (root: string, prefix = ''): string[] =>
  readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : walk(root, rel);
    return entry.isFile() ? [rel] : [];
  });

/**
 * The repo's files: tracked and untracked-but-not-ignored ones in a working
 * tree, or everything outside build and dependency folders in a snapshot.
 */
export const listFiles = (root: string): string[] => {
  const files = existsSync(join(root, '.git'))
    ? git(root, ['ls-files', '-co', '--exclude-standard'])
        .split('\n')
        .filter((path) => path && existsSync(join(root, path)))
    : walk(root);
  return files
    .filter((path) => !path.split('/').some((segment) => SKIPPED_DIRS.has(segment)))
    .sort();
};

export const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');

/** Text content of a file, or null for binaries and files over `maxBytes`. */
export const readText = (path: string, maxBytes: number): string | null => {
  if (statSync(path).size > maxBytes) return null;
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 8000).includes(0)) return null;
  return buffer.toString('utf8');
};

/** The README (or CLAUDE.md, AGENTS.md) at the repo root, trimmed, as background for describe. */
export const readmeOf = (repo: string, maxChars = 6000): string => {
  const entries = readdirSync(repo);
  const name =
    entries.find((file) => /^readme\.md$/i.test(file)) ??
    entries.find((file) => /^(claude|agents)\.md$/i.test(file));
  return name ? readFileSync(join(repo, name), 'utf8').slice(0, maxChars) : '';
};

export interface FolderPart {
  id: string;
  kind: 'package' | 'folder' | 'root';
  name: string;
  dir: string;
}

/** A part this size or bigger is split by its subfolders. */
export const MAX_PART_FILES = 40;

const ROOT_PART: FolderPart = { id: '(root)', kind: 'root', name: 'Top-level files', dir: '' };

const lastSegment = (dir: string) => dir.split('/').pop() ?? dir;

/** Folders that hold a workspace package (`<dir>/package.json`), at any depth below the root. */
export const packageDirsOf = (files: string[]): Set<string> =>
  new Set(
    files
      .map((path) => /^(.+)\/package\.json$/.exec(path)?.[1])
      .filter((dir): dir is string => !!dir)
  );

/**
 * The part a file falls in before any split: its deepest workspace package (or
 * `<package>/src/<dir>` inside it), `src/<dir>`, the top folder, or the root.
 */
const basePartOf = (path: string, packageDirs: Set<string>): FolderPart => {
  const segments = path.split('/');
  for (let depth = segments.length - 1; depth >= 1; depth--) {
    const dir = segments.slice(0, depth).join('/');
    if (!packageDirs.has(dir)) continue;
    const name = lastSegment(dir);
    const rest = segments.slice(depth);
    if (rest[0] === 'src' && rest.length > 2) {
      return { id: `${dir}/src/${rest[1]}`, kind: 'folder', name: `${name}/${rest[1]}`, dir: `${dir}/src/${rest[1]}` };
    }
    return { id: dir, kind: 'package', name, dir };
  }
  const [top, second] = segments;
  if (top === 'src' && second && segments.length > 2) {
    return { id: `src/${second}`, kind: 'folder', name: second, dir: `src/${second}` };
  }
  if (top && segments.length > 1) return { id: top, kind: 'folder', name: top, dir: top };
  return ROOT_PART;
};

/**
 * The parts of a repo, by folder: workspace packages, `src/<dir>`, top folders,
 * and the root. A part with MAX_PART_FILES files or more that spreads over two
 * or more subfolders is split into one part per subfolder (repeatedly); its
 * own top-level files stay in it.
 */
export const folderPartsOf = (
  files: string[],
  packageDirs = packageDirsOf(files),
  maxFiles = MAX_PART_FILES
): Map<string, FolderPart> => {
  const parts = new Map<string, FolderPart>();
  for (const path of files) {
    const part = basePartOf(path, packageDirs);
    parts.set(part.dir, part);
  }
  for (;;) {
    const members = new Map<string, string[]>();
    for (const path of files) {
      const dir = partFor(path, parts, packageDirs).dir;
      members.set(dir, [...(members.get(dir) ?? []), path]);
    }
    let split = false;
    for (const [dir, paths] of members) {
      if (dir === '' || paths.length < maxFiles) continue;
      const parent = parts.get(dir);
      if (!parent) continue;
      const children = new Set(
        paths
          .map((path) => path.slice(dir.length + 1).split('/'))
          .filter((rest) => rest.length > 1)
          .map((rest) => rest[0])
      );
      if (children.size < 2) continue;
      for (const child of children) {
        const childDir = `${dir}/${child}`;
        parts.set(childDir, { id: childDir, kind: 'folder', name: `${parent.name}/${child}`, dir: childDir });
      }
      split = true;
    }
    if (!split) return parts;
  }
};

const partFor = (path: string, parts: Map<string, FolderPart>, packageDirs: Set<string>): FolderPart => {
  const segments = path.split('/');
  for (let depth = segments.length - 1; depth >= 1; depth--) {
    const part = parts.get(segments.slice(0, depth).join('/'));
    if (part) return part;
  }
  return basePartOf(path, packageDirs);
};

/** The part of any path, also one in a folder the parts were not built from. */
export const folderPartOf = (path: string, parts: Map<string, FolderPart>): FolderPart =>
  partFor(path, parts, new Set([...parts.values()].filter((part) => part.kind === 'package').map((part) => part.dir)));
