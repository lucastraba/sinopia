import { globScope, globToRegExp } from './glob.js';
import { makeResolver, parseJsonc, viteAliases } from './resolve.js';

const resolverFor = (files: Record<string, string>) => {
  const ids = new Set(Object.keys(files));
  return {
    // Configs are read from disk by path; this resolver reads them from the fixture instead.
    resolver: makeResolver('/', () => [...ids], (id) => files[id] ?? null),
    exists: (id: string) => ids.has(id),
  };
};

describe('glob patterns', () => {
  it('matches folders with **, names with *, and alternatives', () => {
    const re = globToRegExp('src/**/*.{vue,ts}');
    expect(['src/a.vue', 'src/x/y/b.ts', 'src/c.js', 'lib/a.vue'].filter((id) => re.test(id))).toEqual(['src/a.vue', 'src/x/y/b.ts']);
    expect(globToRegExp('icons/?.svg').test('icons/a.svg')).toBe(true);
    expect(globToRegExp('icons/*.svg').test('icons/sub/a.svg')).toBe(false);
  });

  it('takes a scope pattern as the files it matches and everything inside the folders it matches', () => {
    expect(globScope('**/*Locales.ts').test('apps/web/src/todoLocales.ts')).toBe(true);
    expect(globScope('apps/*/src').test('apps/web/src/main.ts')).toBe(true);
    expect(globScope('apps/*/src').test('apps/web/test/main.ts')).toBe(false);
  });
});

describe('parseJsonc', () => {
  it('reads tsconfig files with comments and trailing commas, and keeps // inside strings', () => {
    expect(parseJsonc('{\n // note\n "a": "http://x", /* b */ "c": [1, 2,],\n}')).toEqual({ a: 'http://x', c: [1, 2] });
    expect(parseJsonc('{ broken')).toBeNull();
  });
});

describe('viteAliases', () => {
  it('reads the object form with fileURLToPath and path.resolve', () => {
    const config = `export default defineConfig({ resolve: { alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '~shared': path.resolve(__dirname, '..', 'shared', 'src'),
    } } })`;
    expect(viteAliases(config, 'apps/web')).toEqual([
      { pattern: '@', targets: ['apps/web/src'] },
      { pattern: '@/*', targets: ['apps/web/src/*'] },
      { pattern: '~shared', targets: ['apps/shared/src'] },
      { pattern: '~shared/*', targets: ['apps/shared/src/*'] },
    ]);
  });

  it('reads the [{ find, replacement }] form', () => {
    expect(viteAliases(`resolve: { alias: [{ find: '#lib', replacement: resolve(__dirname, 'lib') }] }`, '')).toEqual([
      { pattern: '#lib', targets: ['lib'] },
      { pattern: '#lib/*', targets: ['lib/*'] },
    ]);
  });
});

describe('makeResolver', () => {
  it('resolves relative paths with the extensions and index files TypeScript and Vite try, and ./x.js to x.ts', () => {
    const { resolver, exists } = resolverFor({ 'src/a.ts': '', 'src/todos/index.ts': '', 'src/List.vue': '', 'src/util.ts': '' });
    expect(resolver.resolve('src/a.ts', './todos', exists)).toBe('src/todos/index.ts');
    expect(resolver.resolve('src/a.ts', './List.vue', exists)).toBe('src/List.vue');
    expect(resolver.resolve('src/a.ts', './util.js', exists)).toBe('src/util.ts');
    expect(resolver.resolve('src/a.ts', '../../outside', exists)).toBeNull();
    expect(resolver.resolve('src/a.ts', 'vue', exists)).toBeNull();
  });

  it('follows tsconfig paths through extends, as an Nx workspace declares its libraries', () => {
    const { resolver, exists } = resolverFor({
      'tsconfig.base.json': '{ "compilerOptions": { "baseUrl": ".", "paths": { "@todo/ui": ["libs/ui/src/index.ts"], "@todo/ui/*": ["libs/ui/src/*"] } } }',
      'apps/web/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
      'apps/web/src/main.ts': '',
      'libs/ui/src/index.ts': '',
      'libs/ui/src/Button.vue': '',
    });
    expect(resolver.resolve('apps/web/src/main.ts', '@todo/ui', exists)).toBe('libs/ui/src/index.ts');
    expect(resolver.resolve('apps/web/src/main.ts', '@todo/ui/Button.vue', exists)).toBe('libs/ui/src/Button.vue');
  });

  it("reads paths from the configs a tsconfig references (Vite's tsconfig.app.json), relative to that config", () => {
    const { resolver, exists } = resolverFor({
      'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
      'tsconfig.app.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'src/router.ts': '',
      'src/views/TodoList.vue': '',
    });
    expect(resolver.resolve('src/router.ts', '@/views/TodoList.vue', exists)).toBe('src/views/TodoList.vue');
    expect(resolver.toPath('src/router.ts', '@/icons/*.svg')).toBe('src/icons/*.svg');
  });

  it('gives each app its own @/ from the nearest config, and Vite aliases and a leading / from the vite config', () => {
    const { resolver, exists } = resolverFor({
      'apps/web/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'apps/web/src/a.ts': '',
      'apps/web/src/store.ts': '',
      'apps/admin/vite.config.ts': "export default { resolve: { alias: { '@': path.resolve(__dirname, 'src') } } }",
      'apps/admin/src/b.ts': '',
      'apps/admin/src/store.ts': '',
    });
    expect(resolver.resolve('apps/web/src/a.ts', '@/store', exists)).toBe('apps/web/src/store.ts');
    expect(resolver.resolve('apps/admin/src/b.ts', '@/store', exists)).toBe('apps/admin/src/store.ts');
    expect(resolver.toPath('apps/admin/src/b.ts', '/src/icons/*.vue')).toBe('apps/admin/src/icons/*.vue');
  });

  it('resolves the workspace packages by name, with subpaths', () => {
    const { resolver, exists } = resolverFor({
      'package.json': '{ "name": "root" }',
      'packages/shared/package.json': '{ "name": "@todo/shared", "main": "dist/index.js", "source": "src/index.ts" }',
      'packages/shared/src/index.ts': '',
      'packages/shared/src/dates.ts': '',
      'apps/web/src/a.ts': '',
    });
    expect(resolver.resolve('apps/web/src/a.ts', '@todo/shared', exists)).toBe('packages/shared/src/index.ts');
    expect(resolver.resolve('apps/web/src/a.ts', '@todo/shared/dates', exists)).toBe('packages/shared/src/dates.ts');
  });
});
