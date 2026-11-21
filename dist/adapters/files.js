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
]);
const walk = (root, prefix = '') => readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
        return SKIPPED_DIRS.has(entry.name) ? [] : walk(root, rel);
    return entry.isFile() ? [rel] : [];
});
/**
 * The repo's files: tracked and untracked-but-not-ignored ones in a working
 * tree, or everything outside build and dependency folders in a snapshot.
 */
export const listFiles = (root) => {
    const files = existsSync(join(root, '.git'))
        ? git(root, ['ls-files', '-co', '--exclude-standard'])
            .split('\n')
            .filter((path) => path && existsSync(join(root, path)))
        : walk(root);
    return files
        .filter((path) => !path.split('/').some((segment) => SKIPPED_DIRS.has(segment)))
        .sort();
};
export const sha1 = (value) => createHash('sha1').update(value).digest('hex');
/** Text content of a file, or null for binaries and files over `maxBytes`. */
export const readText = (path, maxBytes) => {
    if (statSync(path).size > maxBytes)
        return null;
    const buffer = readFileSync(path);
    if (buffer.subarray(0, 8000).includes(0))
        return null;
    return buffer.toString('utf8');
};
/** The README (or CLAUDE.md, AGENTS.md) at the repo root, trimmed, as background for describe. */
export const readmeOf = (repo, maxChars = 6000) => {
    const entries = readdirSync(repo);
    const name = entries.find((file) => /^readme\.md$/i.test(file)) ??
        entries.find((file) => /^(claude|agents)\.md$/i.test(file));
    return name ? readFileSync(join(repo, name), 'utf8').slice(0, maxChars) : '';
};
/** Generic folder parts: `packages/<name>` for workspace packages, `src/<dir>`, else the top folder. */
export const folderPartOf = (path, packageDirs) => {
    const segments = path.split('/');
    const [top, second] = segments;
    if (top && second && segments.length > 2 && packageDirs.has(`${top}/${second}`)) {
        return { id: `${top}/${second}`, kind: 'package', name: second, dir: `${top}/${second}` };
    }
    if (top === 'src' && second && segments.length > 2) {
        return { id: `src/${second}`, kind: 'folder', name: second, dir: `src/${second}` };
    }
    if (top && segments.length > 1)
        return { id: top, kind: 'folder', name: top, dir: top };
    return { id: '(root)', kind: 'root', name: 'Top-level files', dir: '' };
};
/** Folders that hold a workspace package: `<dir>/<name>/package.json`, one level under the root. */
export const packageDirsOf = (files) => new Set(files
    .map((path) => /^([^/]+\/[^/]+)\/package\.json$/.exec(path)?.[1])
    .filter((dir) => !!dir));
