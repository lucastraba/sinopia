import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { listFiles } from '../adapters/files.js';
import type { FileNode } from '../model.js';
import { checkOptions, type CommonOptions, describeScope, makeRule, type Rule, type Scope, templatesOf } from './context.js';
import { lineOf, skipString } from './parse.js';
import { matchAll } from './template.js';

export interface VueComponentsOptions extends CommonOptions {
  /** Files that render components. Default: the whole repo. */
  in?: Scope;
  /**
   * The `components.d.ts` files unplugin-vue-components writes (or a hand-written
   * `GlobalComponents` declaration). Their names apply to every file in `in`.
   * Default: every `components.d.ts` in the repo, each for the files of its own
   * app (the folder of the nearest package.json or vite.config above it).
   */
  dts?: string | string[];
  /** Folders whose `.vue` files are registered by file name, as unplugin's `dirs` (`'src/components'`). */
  dirs?: Scope;
  /** Registries that name a component and its file: templates with `{key}` and `{path}`: `'{key}: () => import({path}'`. */
  registries?: string | RegExp | (string | RegExp)[];
  /** Places a component is named as a value rather than a tag: templates with `{key}`: `'component: {key}'`. */
  byName?: string | RegExp | (string | RegExp)[];
}

const KEYS = ['in', 'dts', 'dirs', 'registries', 'byName'];

/** `my-thing` → `MyThing`; a PascalCase name stays as it is. */
export const pascalName = (name: string): string =>
  name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => (part[0] as string).toUpperCase() + part.slice(1))
    .join('');

const SCRIPT = /\.(m|c)?[jt]sx?$|\.vue$/;
const STRING = `(['"\`])([^'"\`\\n]+)\\1`;

/** Tags in a .vue file's template that can be components: PascalCase or kebab-case with a dash. */
export const templateTags = (text: string): { name: string; index: number }[] => {
  const start = text.search(/<template[\s>]/);
  if (start === -1) return [];
  const end = text.lastIndexOf('</template>');
  const template = text.slice(start, end > start ? end : text.length).replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const tags: { name: string; index: number }[] = [];
  for (const m of template.matchAll(/<([A-Za-z][\w-]*)(?=[\s/>])/g)) {
    const tag = m[1] as string;
    if (tag.includes('-') || /^[A-Z]/.test(tag)) tags.push({ name: pascalName(tag), index: start + m.index });
  }
  return tags;
};

/** Tags in `template: '…'` strings of a script (Storybook stories, the runtime compiler). */
export const templateOptionTags = (code: string): { name: string; index: number }[] => {
  const tags: { name: string; index: number }[] = [];
  for (const m of code.matchAll(/\btemplate\s*:\s*(['"`])/g)) {
    const open = m.index + m[0].length - 1;
    const close = skipString(code, open);
    for (const tag of templateTags(`<template>${code.slice(open + 1, close - 1)}</template>`)) tags.push({ name: tag.name, index: open });
  }
  return tags;
};

/** JSX tags that can be components: PascalCase. */
const jsxTags = (text: string) =>
  [...text.matchAll(/<([A-Z][\w$]*)(?=[\s/>])/g)].map((m) => ({ name: m[1] as string, index: m.index }));

/**
 * Components Vue resolves by name rather than by an import: tags in
 * templates (`<TodoItem>`, `<todo-item>`) and names passed as values, linked
 * to the `.vue` file behind the name. Names come from a file's own imports
 * first, then `app.component('Name', …)`, the map's `registries`,
 * unplugin-vue-components' `components.d.ts`, and its `dirs`.
 */
export const vueComponents = (options: VueComponentsOptions = {}): Rule => {
  checkOptions('vueComponents', options, KEYS);
  const registries = templatesOf(options.registries);
  const byName = templatesOf(options.byName);
  for (const t of registries) {
    if (!t.names.includes('key') || !t.names.includes('path')) throw new Error(`vueComponents(): the registry shape ${t.source} needs {key} and {path}`);
  }
  for (const t of byName) if (!t.names.includes('key')) throw new Error(`vueComponents(): the byName shape ${t.source} has no {key}`);
  const dtsList = options.dts === undefined ? null : (Array.isArray(options.dts) ? options.dts : [options.dts]).map((path) => path.replace(/^\.\//, ''));
  const summary = `components by tag and name in ${describeScope(options.in)}`;

  return makeRule('vueComponents', options, summary, [...registries, ...byName], (ctx) => {
    const root = ctx.input.root;
    /** The app a file belongs to: the nearest folder above it with a package.json or a vite config. */
    const apps = new Map<string, string>();
    const appOf = (id: string): string => {
      const dir = posix.dirname(id);
      if (dir === '.' || dir === '') return '';
      let app = apps.get(dir);
      if (app === undefined) {
        const marked = ['package.json', 'vite.config.ts', 'vite.config.js', 'vite.config.mts', 'vite.config.mjs'].some((name) => existsSync(join(root, dir, name)));
        app = marked ? dir : appOf(dir);
        apps.set(dir, app);
      }
      return app;
    };
    const inApp = (app: string, id: string) => app === '' || id.startsWith(`${app}/`);
    const isVue = (id: string | null): id is string => !!id && /\.(vue|[jt]sx)$/.test(id);

    // A component a module exports by name, followed through barrels (`export { default as X } from './X.vue'`).
    const exportCache = new Map<string, string | null>();
    const exported = (file: string, name: string, depth = 0): string | null => {
      if (depth > 5) return null;
      if (name === 'default' && isVue(file)) return file;
      const key = `${file}\0${name}`;
      if (exportCache.has(key)) return exportCache.get(key) ?? null;
      exportCache.set(key, null); // a cycle of re-exports ends here
      const hit = findExport(file, name, depth);
      exportCache.set(key, hit);
      return hit;
    };
    // What a module exports, read once per file: re-exports, exported imports, lazy components, `export *`.
    interface Exports {
      from: Map<string, { local: string; spec: string }>;
      own: Map<string, string>;
      lazy: Map<string, string>;
      stars: string[];
    }
    const exportTables = new Map<string, Exports>();
    const exportsOf = (file: string): Exports => {
      let table = exportTables.get(file);
      if (table) return table;
      table = { from: new Map(), own: new Map(), lazy: new Map(), stars: [] };
      exportTables.set(file, table);
      const text = ctx.code(file);
      if (!text.includes('export')) return table;
      const entries = (list: string) => list.split(',').map((entry) => entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/));
      for (const m of text.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}(\s*from\s*['"]([^'"]+)['"])?/g)) {
        for (const [local, as] of entries(m[1] as string)) {
          if (!local) continue;
          if (m[3]) table.from.set(as ?? local, { local, spec: m[3] });
          else table.own.set(as ?? local, local);
        }
      }
      for (const m of text.matchAll(new RegExp(`export\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*defineAsyncComponent\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*${STRING}`, 'g'))) {
        table.lazy.set(m[1] as string, m[3] as string);
      }
      for (const m of text.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) table.stars.push(m[1] as string);
      return table;
    };
    const findExport = (file: string, name: string, depth: number): string | null => {
      const table = exportsOf(file);
      const reexport = table.from.get(name);
      if (reexport) {
        const target = ctx.resolve(file, reexport.spec);
        return target ? exported(target, reexport.local, depth + 1) : null;
      }
      const local = table.own.get(name);
      if (local) return localImports(file, depth + 1).get(local) ?? null;
      const lazy = table.lazy.get(name);
      if (lazy) return ctx.resolve(file, lazy);
      for (const spec of table.stars) {
        const target = ctx.resolve(file, spec);
        const hit = target ? exported(target, name, depth + 1) : null;
        if (hit) return hit;
      }
      return null;
    };

    // What a file imports under each local name, when it's a component.
    const importsCache = new Map<string, Map<string, string>>();
    const localImports = (file: string, depth = 0): Map<string, string> => {
      const cached = importsCache.get(file);
      if (cached) return cached;
      const out = new Map<string, string>();
      importsCache.set(file, out);
      const text = ctx.code(file);
      const add = (local: string, spec: string, name: string) => {
        // Components are PascalCase; composables, helpers and constants aren't followed.
        if (!/^[A-Z]/.test(local)) return;
        const target = ctx.resolve(file, spec);
        if (!target) return;
        const component = isVue(target) && name === 'default' ? target : exported(target, name, depth);
        if (isVue(component)) out.set(local, component);
      };
      for (const m of text.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g)) {
        const spec = m[3] as string;
        if (m[1] && m[1] !== 'type') add(m[1], spec, 'default');
        for (const entry of (m[2] ?? '').split(',')) {
          const [name, as] = entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
          if (name) add(as ?? name, spec, name);
        }
      }
      for (const m of text.matchAll(new RegExp(`(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*defineAsyncComponent\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*${STRING}`, 'g'))) {
        const target = ctx.resolve(file, m[3] as string);
        if (isVue(target)) out.set(m[1] as string, target);
      }
      return out;
    };

    // Names the files can use without importing them. Only a components.d.ts the rule found itself
    // is limited to its app; what the map names applies to all of `in`. Nearest app first.
    const globals: { app: string; names: Map<string, string> }[] = [];
    const register = (app: string, name: string, target: string) => {
      let entry = globals.find((g) => g.app === app);
      if (!entry) {
        entry = { app, names: new Map() };
        globals.push(entry);
      }
      if (!entry.names.has(name)) entry.names.set(name, target);
    };
    const users = ctx.files(options.in).filter((file) => SCRIPT.test(file.id) && !file.id.endsWith('.d.ts'));

    // 1. app.component('Name', X).
    for (const file of users) {
      const text = ctx.code(file.id);
      for (const m of text.matchAll(new RegExp(`\\.component\\(\\s*${STRING}\\s*,\\s*`, 'g'))) {
        const name = pascalName(m[2] as string);
        const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 300);
        const ident = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest);
        const lazy = new RegExp(`^(?:defineAsyncComponent\\(\\s*)?\\(\\)\\s*=>\\s*import\\(\\s*${STRING}`).exec(rest);
        const target = ident ? (localImports(file.id).get(ident[1] as string) ?? null) : lazy ? ctx.resolve(file.id, lazy[2] as string) : null;
        if (target) register('', name, target);
        else ctx.addGap({ kind: 'unresolved-component', level: 'warning', file: file.id, detail: `${name} (line ${lineOf(text, m.index)}): registered with app.component, but its file isn't found` });
      }
    }
    // 2. The map's registries: {key} is the name, {path} the file.
    if (registries.length > 0) {
      for (const file of users) {
        for (const m of matchAll(registries, ctx.code(file.id))) {
          const key = m.values.key?.value;
          const path = m.values.path?.value;
          if (!key || !path) continue;
          const target = ctx.resolve(file.id, path);
          if (target) register('', pascalName(key), target);
          else ctx.addGap({ kind: 'unresolved-component', level: 'warning', file: file.id, detail: `${key}: ${path} isn't found` });
        }
      }
    }
    // 3. components.d.ts: `Name: typeof import('./src/components/Name.vue')['default']`.
    const dtsFiles = dtsList ?? listFiles(root).filter((id) => posix.basename(id) === 'components.d.ts');
    for (const dts of dtsFiles) {
      const text = ctx.read(dts);
      if (!text) {
        ctx.addGap({ kind: 'unresolved-component', level: 'warning', file: dts, detail: `${dts} can't be read` });
        continue;
      }
      const app = dtsList ? '' : appOf(dts);
      for (const m of text.matchAll(/^\s*['"]?([\w$-]+)['"]?\s*:\s*typeof\s+import\(\s*['"]([^'"]+)['"]\s*\)\s*\[\s*['"]([\w$]+)['"]\s*\]/gm)) {
        const [, name, spec, exportName] = m as unknown as [string, string, string, string];
        const target = ctx.resolve(dts, spec);
        const component = target ? exported(target, exportName) : null;
        if (component) register(app, pascalName(name), component);
        // A package (`vue-router`) is a library component, not a file of the repo.
        else if (spec.startsWith('.') || spec.startsWith('/') || target || ctx.pathOf(dts, spec) !== null) {
          ctx.addGap({ kind: 'unresolved-component', level: 'warning', file: dts, detail: `${name} from ${spec}: no such component file` });
        }
      }
    }
    // 4. dirs: every .vue file under them, by its file name.
    if (options.dirs !== undefined) {
      for (const file of ctx.graph.files) {
        if (file.id.endsWith('.vue') && ctx.inScope(file.id, options.dirs)) register('', pascalName(posix.basename(file.id, '.vue')), file.id);
      }
    }
    globals.sort((a, b) => b.app.length - a.app.length);

    const lookup = (file: FileNode, name: string): string | null => {
      const local = localImports(file.id).get(name);
      if (local) return local;
      for (const entry of globals) {
        if (!inApp(entry.app, file.id)) continue;
        const hit = entry.names.get(name);
        if (hit) return hit;
      }
      return null;
    };

    for (const file of users) {
      const tags = file.id.endsWith('.vue')
        ? templateTags(ctx.read(file.id))
        : [...(/\.[jt]sx$/.test(file.id) ? jsxTags(ctx.code(file.id)) : []), ...templateOptionTags(ctx.code(file.id))];
      for (const { name } of tags) {
        const target = lookup(file, name);
        if (target && target !== file.id) ctx.addComponent(file, { tag: name, target, library: null, byName: false });
      }
      if (byName.length === 0) continue;
      const text = ctx.code(file.id);
      for (const m of matchAll(byName, text)) {
        const key = m.values.key?.value;
        if (!key) continue;
        const target = lookup(file, pascalName(key));
        if (target && target !== file.id) ctx.addComponent(file, { tag: pascalName(key), target, library: null, byName: true });
        // A name written as a string should be a component; a variable may hold anything.
        else if (!target && m.values.key?.quoted && /^[A-Za-z][\w-]*$/.test(key)) {
          ctx.addGap({ kind: 'unmatched-component', level: 'warning', file: file.id, detail: `${key} (line ${lineOf(text, m.index)}): no component by that name` });
        }
      }
    }
  });
};

