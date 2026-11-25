import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { matchBracket, skipString, stripJsComments } from './parse.js';

// One way to turn an import specifier into a file, for every primitive: the
// way the project's own tools resolve it. Relative paths, tsconfig `paths`
// (through `extends` and `references`, as Nx and Vite templates write them),
// Vite `resolve.alias`, and the workspace's own packages by name. Each file
// uses the configs nearest to it, so two apps with their own `@/` stay apart.

export interface Resolver {
  /**
   * The file a specifier written in `from` points at, or null for a package
   * outside the repo or a path that isn't there. `exists` says which files
   * count (the files on the map). Extensions and index files are tried the
   * way TypeScript and Vite try them.
   */
  resolve(from: string, spec: string, exists: (id: string) => boolean): string | null;
  /**
   * The repo-relative path a specifier names, with no file looked up: for
   * patterns (`'@/icons/*.vue'` becomes `'src/icons/*.vue'`). A leading `/`
   * is the Vite root. Null for a package.
   */
  toPath(from: string, spec: string): string | null;
}

/** An alias rule: `pattern` with at most one `*`, and the paths it stands for. */
interface Alias {
  pattern: string;
  targets: string[];
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json'];
const VITE_CONFIG = /^vite\.config\.[cm]?[jt]s$/;

/** JSON with comments and trailing commas, as tsconfig files are written. Null when it doesn't parse. */
export const parseJsonc = (text: string): unknown => {
  const stripped = stripJsComments(text);
  let out = '';
  for (let i = 0; i < stripped.length; ) {
    const c = stripped[i] as string;
    if (c === '"') {
      const end = skipString(stripped, i);
      out += stripped.slice(i, end);
      i = end;
    } else if (c === ',' && /^\s*[}\]]/.test(stripped.slice(i + 1, i + 200))) i++;
    else {
      out += c;
      i++;
    }
  }
  try {
    return JSON.parse(out) as unknown;
  } catch {
    return null;
  }
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** `a/b/../c` → `a/c`, `./x` → `x`, `''` for the root; null when it climbs out of the repo. */
const clean = (path: string): string | null => {
  const normal = posix.normalize(path || '.');
  if (normal === '..' || normal.startsWith('../') || normal.startsWith('/')) return null;
  return normal === '.' ? '' : normal.replace(/\/$/, '');
};

const join2 = (dir: string, path: string) => clean(posix.join(dir || '.', path));

const dirOf = (id: string) => {
  const dir = posix.dirname(id);
  return dir === '.' ? '' : dir;
};

/** Folders from `dir` up to the repo root, nearest first. */
const upFrom = (dir: string): string[] => {
  const out = [dir];
  while (dir !== '') {
    dir = dirOf(dir);
    out.push(dir);
  }
  return out;
};

/** Matches a specifier against an alias pattern; returns what `*` stood for, or null. */
const matchPattern = (pattern: string, spec: string): string | null => {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === spec ? '' : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return spec.length >= prefix.length + suffix.length && spec.startsWith(prefix) && spec.endsWith(suffix)
    ? spec.slice(prefix.length, spec.length - suffix.length)
    : null;
};

/** Paths a specifier maps to through a list of aliases: exact ones first, then the longest prefix, as TypeScript picks. */
const throughAliases = (aliases: Alias[], spec: string): string[] => {
  const hits = aliases
    .map((alias) => ({ alias, rest: matchPattern(alias.pattern, spec) }))
    .filter((hit): hit is { alias: Alias; rest: string } => hit.rest !== null)
    .sort((a, b) => Number(a.alias.pattern.includes('*')) - Number(b.alias.pattern.includes('*')) || b.alias.pattern.indexOf('*') - a.alias.pattern.indexOf('*'));
  return hits.flatMap(({ alias, rest }) => alias.targets.map((target) => target.replace('*', rest)));
};

/** The `key: value` entries at the top of the object or array whose bracket is at `open`, keys unquoted. */
const topEntries = (text: string, open: number): { key: string | null; value: string }[] => {
  const close = matchBracket(text, open);
  const entries: { key: string | null; value: string }[] = [];
  let start = open + 1;
  const push = (end: number) => {
    const raw = text.slice(start, end).trim();
    if (raw) {
      const m = /^(?:(['"`])([^'"`]+)\1|([A-Za-z_$][\w$]*))\s*:(?!:)\s*([\s\S]*)$/.exec(raw);
      entries.push(m ? { key: (m[2] ?? m[3]) as string, value: (m[4] as string).trim() } : { key: null, value: raw });
    }
    start = end + 1;
  };
  for (let i = open + 1; i < close; i++) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') i = skipString(text, i) - 1;
    else if (c === '(' || c === '{' || c === '[') i = matchBracket(text, i);
    else if (c === ',') push(i);
  }
  push(close);
  return entries;
};

/** The folder an alias value names, relative to the config's folder: every string literal in it, joined. */
const aliasTarget = (value: string): string | null => {
  const literals = [...value.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2] as string);
  if (literals.length === 0) return null;
  return literals.join('/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
};

/** Vite's `resolve.alias`, object or `[{ find, replacement }]` form, as aliases relative to the repo. */
export const viteAliases = (text: string, configDir: string): Alias[] => {
  const code = stripJsComments(text);
  const m = /\balias\s*:\s*([[{])/.exec(code);
  if (!m) return [];
  const open = m.index + m[0].length - 1;
  const out: Alias[] = [];
  const add = (find: string, value: string) => {
    const target = aliasTarget(value);
    const dir = target === null ? null : join2(configDir, target);
    if (dir === null || !find) return;
    // Vite matches `find` itself and `find/…`.
    out.push({ pattern: find, targets: [dir] }, { pattern: `${find.replace(/\/$/, '')}/*`, targets: [dir ? `${dir}/*` : '*'] });
  };
  if (m[1] === '{') {
    for (const entry of topEntries(code, open)) if (entry.key) add(entry.key, entry.value);
  } else {
    for (const entry of topEntries(code, open)) {
      const brace = entry.value.indexOf('{');
      if (brace !== 0) continue;
      const fields = new Map(topEntries(entry.value, 0).map((field) => [field.key, field.value]));
      const find = /^(['"`])(.*)\1$/.exec(fields.get('find') ?? '');
      const replacement = fields.get('replacement');
      if (find && replacement) add(find[2] as string, replacement);
    }
  }
  return out;
};

/** The files an `exports` value names, conditions (`import`, `types`, `default`) in the order written. */
const exportTargets = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportTargets);
  return Object.values(record(value)).flatMap(exportTargets);
};

/** The repo's text files, read from disk; null when one can't be read. */
const fromDisk = (root: string) => (id: string) => {
  try {
    return readFileSync(join(root, id), 'utf8');
  } catch {
    return null;
  }
};

/** A resolver for the repo at `root`; `repoFiles` lists its files, `read` reads one (from disk by default). */
export const makeResolver = (root: string, repoFiles: () => string[], read: (id: string) => string | null = fromDisk(root)): Resolver => {
  let fileSet: Set<string> | null = null;
  const files = () => (fileSet ??= new Set(repoFiles()));
  const readJson = (id: string) => {
    const text = read(id);
    return text === null ? null : parseJsonc(text);
  };

  /** `paths` of a tsconfig, through its `extends` chain (the nearest `paths` wins whole, as in TypeScript). */
  const configAliases = (id: string, seen = new Set<string>()): { aliases: Alias[] | null; baseUrl: string | null } => {
    if (seen.has(id)) return { aliases: null, baseUrl: null };
    seen.add(id);
    const config = record(readJson(id));
    const options = record(config.compilerOptions);
    const dir = dirOf(id);
    let inherited: { aliases: Alias[] | null; baseUrl: string | null } = { aliases: null, baseUrl: null };
    const parents = Array.isArray(config.extends) ? config.extends : config.extends ? [config.extends] : [];
    for (const parent of parents) {
      if (typeof parent !== 'string' || !parent.startsWith('.')) continue; // a shared preset from a package: no aliases of ours
      const path = join2(dir, parent);
      const file = path === null ? null : [path, `${path}.json`].find((candidate) => files().has(candidate));
      if (!file) continue;
      const got = configAliases(file, seen);
      inherited = { aliases: got.aliases ?? inherited.aliases, baseUrl: got.baseUrl ?? inherited.baseUrl };
    }
    const baseUrl = typeof options.baseUrl === 'string' ? join2(dir, options.baseUrl) : inherited.baseUrl;
    const paths = record(options.paths);
    if (Object.keys(paths).length === 0) return { aliases: inherited.aliases, baseUrl };
    // Without baseUrl, paths are relative to the config that declares them.
    const base = typeof options.baseUrl === 'string' ? baseUrl : (baseUrl ?? dir);
    const aliases = Object.entries(paths).map(([pattern, targets]) => ({
      pattern,
      targets: (Array.isArray(targets) ? targets : [])
        .filter((target): target is string => typeof target === 'string')
        .map((target) => join2(base ?? '', target))
        .filter((target): target is string => target !== null),
    }));
    return { aliases, baseUrl };
  };

  const tsconfigCache = new Map<string, Alias[] | null>();
  /** Aliases from the tsconfig in `dir` and the configs it references (the Vite template's tsconfig.app.json). Null when the folder has none. */
  const tsconfigAt = (dir: string): Alias[] | null => {
    if (tsconfigCache.has(dir)) return tsconfigCache.get(dir) ?? null;
    const id = ['tsconfig.json', 'jsconfig.json'].map((name) => (dir ? `${dir}/${name}` : name)).find((candidate) => files().has(candidate));
    let aliases: Alias[] | null = null;
    if (id) {
      aliases = [...(configAliases(id).aliases ?? [])];
      for (const ref of Array.isArray(record(readJson(id)).references) ? (record(readJson(id)).references as unknown[]) : []) {
        const path = record(ref).path;
        if (typeof path !== 'string') continue;
        const target = join2(dir, path);
        const file = target === null ? null : [target, `${target}/tsconfig.json`, `${target}.json`].find((candidate) => files().has(candidate));
        if (file) aliases.push(...(configAliases(file).aliases ?? []));
      }
    }
    tsconfigCache.set(dir, aliases);
    return aliases;
  };

  let viteConfigMap: Map<string, string> | null = null;
  /** Folder → its vite.config file. */
  const viteConfigs = () => {
    if (viteConfigMap) return viteConfigMap;
    viteConfigMap = new Map();
    for (const file of [...files()].sort()) {
      if (VITE_CONFIG.test(posix.basename(file)) && !viteConfigMap.has(dirOf(file))) viteConfigMap.set(dirOf(file), file);
    }
    return viteConfigMap;
  };
  const viteCache = new Map<string, Alias[] | null>();
  const viteAt = (dir: string): Alias[] | null => {
    if (viteCache.has(dir)) return viteCache.get(dir) ?? null;
    const id = viteConfigs().get(dir);
    let aliases: Alias[] | null = null;
    if (id) aliases = viteAliases(read(id) ?? '', dir);
    viteCache.set(dir, aliases);
    return aliases;
  };

  let packages: { name: string; dir: string; entries: string[]; subpaths: Alias[] }[] | null = null;
  /** The workspace's own packages, by the name in their package.json. */
  const workspacePackages = () => {
    if (packages) return packages;
    packages = [];
    for (const id of files()) {
      if (posix.basename(id) !== 'package.json' || id === 'package.json') continue;
      const json = record(readJson(id));
      if (typeof json.name !== 'string') continue;
      const exportsDot = record(json.exports)['.'];
      const fromExports = typeof json.exports === 'string' ? [json.exports] : typeof exportsDot === 'string' ? [exportsDot] : Object.values(record(exportsDot));
      const entries = [json.source, json.module, json.main, json.types, ...fromExports, 'src/index', 'index'].filter((value): value is string => typeof value === 'string');
      const dir = dirOf(id);
      // `"./button": "./src/Button.vue"` and `"./*": { "import": "./src/*.ts" }`: the subpaths the package declares.
      const subpaths = Object.entries(record(json.exports))
        .filter(([key]) => key.startsWith('./'))
        .map(([key, value]) => ({
          pattern: key.slice(2),
          targets: exportTargets(value)
            .map((target) => join2(dir, target))
            .filter((target): target is string => target !== null),
        }));
      packages.push({ name: json.name, dir, entries, subpaths });
    }
    packages.sort((a, b) => b.name.length - a.name.length);
    return packages;
  };

  const nearestRoot = (from: string): string => {
    for (const dir of upFrom(dirOf(from))) {
      if (viteAt(dir) !== null) return dir;
    }
    for (const dir of upFrom(dirOf(from))) {
      if (files().has(dir ? `${dir}/package.json` : 'package.json')) return dir;
    }
    return '';
  };

  /** Paths a specifier may stand for, best first, before extensions are tried. */
  const candidates = (from: string, spec: string): string[] => {
    // `?raw` and `#hash` suffixes go; a leading `#` is an alias (`#lib/…`), not a suffix.
    const clean1 = spec.replace(/(?!^)[?#].*$/, '');
    if (clean1.startsWith('./') || clean1.startsWith('../') || clean1 === '.' || clean1 === '..') {
      const path = join2(dirOf(from), clean1);
      return path === null ? [] : [path];
    }
    if (clean1.startsWith('/')) {
      const path = join2(nearestRoot(from), clean1.slice(1));
      return path === null ? [] : [path];
    }
    const out: string[] = [];
    const dirs = upFrom(dirOf(from));
    // The nearest tsconfig decides; Vite's aliases from the nearest vite config add to it.
    const ts = dirs.map(tsconfigAt).find((aliases) => aliases !== null) ?? [];
    const fromTs = throughAliases(ts, clean1);
    out.push(...fromTs);
    const vite = dirs.map(viteAt).find((aliases) => aliases !== null) ?? [];
    out.push(...throughAliases(vite, clean1));
    // The root tsconfig adds the aliases the nearest one doesn't have; an alias the nearest one has is its own.
    const rootTs = tsconfigAt('') ?? [];
    if (rootTs !== ts && fromTs.length === 0) out.push(...throughAliases(rootTs, clean1));
    for (const pkg of workspacePackages()) {
      if (clean1 === pkg.name) out.push(...pkg.entries.map((entry) => join2(pkg.dir, entry)).filter((path): path is string => path !== null));
      else if (clean1.startsWith(`${pkg.name}/`)) {
        const rest = clean1.slice(pkg.name.length + 1);
        out.push(...throughAliases(pkg.subpaths, rest));
        for (const path of [join2(pkg.dir, rest), join2(pkg.dir, `src/${rest}`)]) if (path !== null) out.push(path);
      }
    }
    return out;
  };

  const probe = (path: string, exists: (id: string) => boolean): string | null => {
    if (path && exists(path)) return path;
    // ESM TypeScript writes `./x.js` for `./x.ts`.
    const js = /\.([cm]?)js(x?)$/.exec(path);
    if (js) {
      const ts = `${path.slice(0, -js[0].length)}.${js[1]}ts${js[2]}`;
      if (exists(ts)) return ts;
    }
    for (const ext of EXTENSIONS) if (exists(`${path}${ext}`)) return `${path}${ext}`;
    for (const ext of EXTENSIONS) {
      const index = path ? `${path}/index${ext}` : `index${ext}`;
      if (exists(index)) return index;
    }
    return null;
  };

  return {
    resolve: (from, spec, exists) => {
      for (const path of candidates(from, spec)) {
        const hit = probe(path, exists);
        if (hit) return hit;
      }
      return null;
    },
    toPath: (from, spec) => candidates(from, spec)[0] ?? null,
  };
};
