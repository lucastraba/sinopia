import { join } from 'node:path';
import type { ScanInput } from '../adapter.js';
import { folderPartOf, listFiles, readText, sha1, type FolderPart } from '../adapters/files.js';
import { fileKindOf, largeFile } from '../adapters/folders.js';
import { addLink } from '../links.js';
import type { ComponentUse, FileLink, FileNode, Gap, Graph, RuleReport } from '../model.js';
import { globScope, isGlob } from './glob.js';
import { stripComments } from './parse.js';
import { makeResolver, type Resolver } from './resolve.js';
import { compileTemplate, type CompiledTemplate } from './template.js';

// Folders or files a rule looks at: a repo-relative path, a glob pattern
// (`'**/*Locales.ts'`, `'apps/*/src'`: a folder it matches counts whole), or a
// list of them. Empty means the whole repo.
export type Scope = string | string[];

/** Rules read files up to this size; the scan maps bigger ones without their text. */
const RULE_READ_BYTES = 5_000_000;

export type { RuleReport };

export interface Rule {
  rule: string;
  summary: string;
  why: string | null;
  draft: boolean;
  templates: CompiledTemplate[];
  run(ctx: RuleContext): void;
}

/** Everything a rule (or a `custom` function) gets to read the repo and write the graph. */
export interface RuleContext {
  graph: Graph;
  input: ScanInput;
  ids: Set<string>;
  byId: Map<string, FileNode>;
  /** A file's text from the scan root, or '' when it can't be read (or is over 5 MB). */
  read(id: string): string;
  /** The same text with comments blanked out (JS/TS, Vue, Python), offsets kept. */
  code(id: string): string;
  /** Mapped files under the scope, tests left out. */
  files(scope?: Scope): FileNode[];
  inScope(id: string, scope?: Scope): boolean;
  addLink(file: FileNode, link: FileLink): void;
  /** Records that a file renders a component (a template tag, a name), once per target; counted as a `component` link. */
  addComponent(file: FileNode, use: ComponentUse): void;
  /**
   * The file an import specifier written in `from` points at, or null: relative
   * paths, tsconfig `paths` (with `extends`), Vite aliases and workspace
   * packages, the way the project's own tools resolve them.
   */
  resolve(from: string, spec: string): string | null;
  /** The repo-relative path a specifier names, without looking for a file: for patterns. Null for a package. */
  pathOf(from: string, spec: string): string | null;
  /** Adds an import between two mapped files, once. */
  addImport(file: FileNode, target: string): void;
  addGap(gap: Gap): void;
  addRoute(route: Graph['routes'][number]): void;
  /**
   * Puts a file the generic scan skipped on the map (a data file, a language
   * it doesn't read), in the part of its folder, and returns it. Null when it
   * can't be read. A file already mapped comes back as it is.
   */
  addFile(id: string): FileNode | null;
}

export const scopeList = (scope: Scope | undefined): string[] =>
  scope === undefined ? [] : (Array.isArray(scope) ? scope : [scope]).map((path) => path.replace(/^\.\/|\/+$/g, ''));

export const inScope = (id: string, scope: Scope | undefined): boolean => {
  const paths = scopeList(scope);
  return (
    paths.length === 0 ||
    paths.some((path) => (isGlob(path) ? globScope(path).test(id) : path === '' || path === '.' || id === path || id.startsWith(`${path}/`)))
  );
};

/** Test files: mapped as tests, plus pytest's conftest.py. Rules never look at them. */
export const isTestFile = (file: FileNode): boolean => file.kind === 'test' || /(^|\/)conftest\.py$/.test(file.id);

/** A context for one rule, counting what it adds into `report`. `cache` and `resolver` are shared by the rules of one scan. */
export const ruleContext = (
  graph: Graph,
  input: ScanInput,
  report: RuleReport,
  cache: Map<string, string>,
  resolver: Resolver = makeResolver(input.root, () => listFiles(input.root))
): RuleContext => {
  const byId = new Map(graph.files.map((file) => [file.id, file]));
  const ids = new Set(byId.keys());
  const read = (id: string) => {
    let text = cache.get(id);
    if (text === undefined) {
      try {
        text = readText(join(input.root, id), RULE_READ_BYTES) ?? '';
      } catch {
        text = '';
      }
      cache.set(id, text);
    }
    return text;
  };
  const stripped = new Map<string, string>();
  const count = (kind: string) => {
    report.links[kind] = (report.links[kind] ?? 0) + 1;
  };
  return {
    graph,
    input,
    ids,
    byId,
    read,
    code: (id) => {
      let text = stripped.get(id);
      if (text === undefined) {
        text = stripComments(id, read(id));
        stripped.set(id, text);
      }
      return text;
    },
    files: (scope) => graph.files.filter((file) => !isTestFile(file) && inScope(file.id, scope)),
    inScope,
    addLink: (file, link) => {
      const before = file.links?.length ?? 0;
      addLink(file, link);
      if ((file.links?.length ?? 0) > before) count(link.kind);
    },
    addComponent: (file, use) => {
      if (file.components.some((existing) => existing.target === use.target && existing.tag === use.tag && existing.byName === use.byName)) return;
      file.components.push(use);
      count('component');
    },
    resolve: (from, spec) => resolver.resolve(from, spec, (id) => ids.has(id)),
    pathOf: (from, spec) => resolver.toPath(from, spec),
    addImport: (file, target) => {
      if (target === file.id || file.imports.includes(target)) return;
      file.imports.push(target);
      count('import');
    },
    addGap: (gap) => {
      const key = `${gap.kind}|${gap.file}|${gap.detail}`;
      if (graph.gaps.some((g) => `${g.kind}|${g.file}|${g.detail}` === key)) return;
      graph.gaps.push(gap);
      report.gaps++;
    },
    addRoute: (route) => {
      graph.routes.push(route);
      report.routes++;
    },
    addFile: (id) => {
      const existing = byId.get(id);
      if (existing) return existing;
      let text: string | null;
      let large: ReturnType<typeof largeFile> = null;
      try {
        text = readText(join(input.root, id), RULE_READ_BYTES);
        // Too big to read whole: on the map all the same, with a note.
        if (text === null) large = largeFile(input.root, id);
      } catch {
        // Missing or unreadable: the rule gets null, as promised, and goes on.
        return null;
      }
      if (text === null && !large) return null;
      if (large) graph.gaps.push(large.gap);
      const folders = new Map<string, FolderPart>(
        graph.parts.map((part) => [
          part.dir,
          { id: part.id, kind: part.kind === 'package' ? 'package' : part.dir === '' ? 'root' : 'folder', name: part.name, dir: part.dir },
        ])
      );
      const home = folderPartOf(id, folders);
      let part = graph.parts.find((p) => p.id === home.id);
      if (!part) {
        part = { ...home, files: [] };
        graph.parts.push(part);
        graph.parts.sort((a, b) => a.id.localeCompare(b.id));
      }
      part.files.push(id);
      const file: FileNode = {
        id,
        part: part.id,
        kind: large?.kind ?? fileKindOf(id),
        lines: large?.lines ?? (text as string).split('\n').length,
        hash: large?.hash ?? sha1(text as string),
        imports: [],
        libraries: [],
        components: [],
        operations: [],
        flags: [],
        registeredAs: null,
      };
      graph.files.push(file);
      byId.set(id, file);
      ids.add(id);
      report.files = (report.files ?? 0) + 1;
      return file;
    },
  };
};

export interface CommonOptions {
  /** Why the rule exists, in a sentence. Shown with what the rule found. */
  why?: string;
  /** Written by an agent and not yet confirmed. `check` lists drafts. */
  draft?: boolean;
}

export const COMMON_KEYS = ['why', 'draft'] as const;

/** Refuses options a primitive doesn't know, so a typo in the map fails loudly instead of doing nothing. */
export const checkOptions = (rule: string, options: object, allowed: readonly string[]): void => {
  const unknown = Object.keys(options).filter((key) => !allowed.includes(key) && !(COMMON_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    throw new Error(`${rule}(): unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. It takes: ${[...allowed, ...COMMON_KEYS].join(', ')}.`);
  }
};

export const templatesOf = (value: string | RegExp | (string | RegExp)[] | undefined): CompiledTemplate[] =>
  value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(compileTemplate);

export const describeScope = (scope: Scope | undefined): string => {
  const paths = scopeList(scope);
  return paths.length === 0 ? 'the whole repo' : paths.join(', ');
};

export const makeRule = (
  rule: string,
  options: CommonOptions,
  summary: string,
  templates: CompiledTemplate[],
  run: (ctx: RuleContext) => void
): Rule => ({ rule, summary, why: options.why ?? null, draft: options.draft === true, templates, run });
