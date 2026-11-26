// A small todo app as a scanned graph, for the area, claim and overview specs.
import type { FileLink, FileNode, Graph, Part } from './model.js';

export const file = (id: string, extra: Partial<FileNode> = {}): FileNode => ({
  id,
  part: '',
  kind: id.endsWith('.vue') ? 'component' : id.endsWith('.yaml') ? 'config' : 'composable',
  lines: 1,
  hash: id,
  imports: [],
  libraries: [],
  components: [],
  operations: [],
  flags: [],
  registeredAs: null,
  ...extra,
});

const shows = (target: string) => ({ tag: target.split('/').pop() ?? target, target, library: null, byName: false });
const link = (target: string, kind: string, label: string | null = null): FileLink => ({ target, kind, label });

/** Builds a graph from files; each file's part is the part whose folder holds it (longest first). */
export const graphOf = (parts: Omit<Part, 'files'>[], files: FileNode[]): Graph => {
  const byLength = [...parts].sort((a, b) => b.dir.length - a.dir.length);
  const partOf = (id: string) => byLength.find((part) => part.dir === '' ? !id.includes('/') : id.startsWith(`${part.dir}/`))?.id ?? '';
  const placed = files.map((node) => ({ ...node, part: partOf(node.id) }));
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    meta: {
      title: 'todo-app map',
      srcDir: '',
      sourceLabel: 'the repo',
      groups: [],
      groupFlow: [],
      servicesLabel: 'Services',
      operationsLabel: 'Server calls',
      boundary: null,
      library: null,
      hasLinks: true,
    },
    source: { label: 'test', sha: 'abc1234def' },
    backend: null,
    parts: parts.map((part) => ({ ...part, files: placed.filter((node) => node.part === part.id).map((node) => node.id) })),
    files: placed,
    operations: [],
    routes: [],
    flags: [],
    subgraphs: [],
    cycles: [],
    gaps: [],
  };
};

const folder = (dir: string, kind = 'folder'): Omit<Part, 'files'> => ({ id: dir || '(root)', kind: dir ? kind : 'root', name: dir || 'Top-level files', dir });

export const TODO_PARTS = [
  folder('apps/web/src/features/todos'),
  folder('apps/web/src/features/lists'),
  folder('apps/web/src/ui'),
  folder('apps/server/src/routers'),
  folder('apps/server/src/db'),
  folder('content'),
  folder('scripts'),
  folder(''),
];

const WEB = 'apps/web/src';
export const TODO = {
  list: `${WEB}/features/todos/TodoList.vue`,
  useTodos: `${WEB}/features/todos/useTodos.ts`,
  listView: `${WEB}/features/lists/ListView.vue`,
  button: `${WEB}/ui/Button.vue`,
  router: 'apps/server/src/routers/todos.ts',
  db: 'apps/server/src/db/db.ts',
  strings: 'content/strings.yaml',
  seed: 'scripts/seed.ts',
  seedTest: 'scripts/seed.spec.ts',
  pkg: 'package.json',
};

/**
 * The todo app: the list renders a button (imported) and reads its strings;
 * the lists screen renders the todo list by tag only and imports the button;
 * useTodos calls two tRPC procedures; the router and the seed script use the
 * database; package.json runs the seed script.
 */
export const todoFiles = (): FileNode[] => [
  file(TODO.list, { imports: [TODO.useTodos, TODO.button, TODO.strings], components: [shows(TODO.button)] }),
  file(TODO.useTodos, { links: [link(TODO.router, 'trpc', 'todos.list'), link(TODO.router, 'trpc', 'todos.add'), link(TODO.router, 'trpc', 'todos.add')] }),
  file(TODO.listView, { imports: [TODO.button], components: [shows(TODO.list)] }),
  file(TODO.button),
  file(TODO.router, { imports: [TODO.db] }),
  file(TODO.db),
  file(TODO.strings),
  file(TODO.seed, { imports: [TODO.db] }),
  file(TODO.seedTest, { kind: 'test', imports: [TODO.seed] }),
  file(TODO.pkg, { kind: 'config', links: [link(TODO.seed, 'runs')] }),
];

export const todoGraph = (files = todoFiles()): Graph => graphOf(TODO_PARTS, files);

export const TODO_AREAS = {
  Web: { folders: ['apps/web'], why: 'What the user sees.' },
  'UI kit': { folders: ['apps/web/src/ui'], why: 'Buttons and the like.', draft: true },
  Server: { folders: ['apps/server'], why: 'Answers the web app.' },
  Tooling: { folders: ['scripts', '(root)'], why: 'Seeds the database.' },
};
