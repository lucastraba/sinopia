import { addAreas, formatAreas } from './areaReport.js';
import { assignAreas, fileEdges, foldAreas, folderAreas, verbOf } from './areas.js';
import type { Part } from './model.js';
import { file, graphOf, TODO, TODO_AREAS, TODO_PARTS, todoGraph } from './todoGraph.fixture.js';

const lines = (graph = todoGraph(), specs: Parameters<typeof foldAreas>[1] = TODO_AREAS) =>
  foldAreas(graph, specs).areaLinks.map((line) => `${line.from} ${line.verb} ${line.to}: ${line.count}`);

describe('fileEdges', () => {
  it('counts each link once, as data for a data file, as component when the file also renders it, and tag-only uses as components', () => {
    const edges = fileEdges(todoGraph()).filter((edge) => edge.from === TODO.list || edge.from === TODO.listView || edge.from === TODO.useTodos);
    expect(edges.map((edge) => `${edge.from.split('/').pop()} -> ${edge.to.split('/').pop()} ${edge.kind}${edge.label ? ` ${edge.label}` : ''}${edge.tagOnly ? ' (tag)' : ''}`)).toEqual([
      'TodoList.vue -> useTodos.ts import',
      'TodoList.vue -> Button.vue component',
      'TodoList.vue -> strings.yaml data',
      'useTodos.ts -> todos.ts trpc todos.list',
      'useTodos.ts -> todos.ts trpc todos.add',
      'ListView.vue -> Button.vue import',
      'ListView.vue -> TodoList.vue component (tag)',
    ]);
  });

  it('leaves out links to files the graph does not hold, and links to the file itself', () => {
    const graph = todoGraph([file(TODO.list, { imports: ['apps/web/src/gone.ts', TODO.list] })]);
    expect(fileEdges(graph)).toEqual([]);
  });
});

describe('verbs', () => {
  it('names each kind of link, and falls back by the kind name for kinds a map invents', () => {
    expect(['import', 'component', 'data', 'i18n', 'trpc', 'graphql', 'event', 'bridge', 'runs', 'codegen', 'flag', 'glob', 'inject'].map(verbOf)).toEqual([
      'uses',
      'shows',
      'reads',
      'reads',
      'asks the server',
      'asks the server',
      'tells',
      'talks to the desktop',
      'runs',
      'generates',
      'uses',
      'uses',
      'uses',
    ]);
    expect(verbOf('ws-event')).toBe('tells');
    expect(verbOf('queue')).toBe('uses');
  });
});

describe('foldAreas', () => {
  it('puts each part in the area with the longest matching folder', () => {
    const assigned = assignAreas(todoGraph().parts, TODO_AREAS);
    expect(Object.fromEntries(assigned)).toEqual({
      'apps/web/src/features/todos': 'Web',
      'apps/web/src/features/lists': 'Web',
      'apps/web/src/ui': 'UI kit',
      'apps/server/src/routers': 'Server',
      'apps/server/src/db': 'Server',
      content: null,
      scripts: 'Tooling',
      '(root)': 'Tooling',
    });
  });

  it('folds the links between two areas into one line per verb, biggest first, and keeps links inside an area out', () => {
    expect(lines()).toEqual([
      'Web asks the server Server: 2',
      'Tooling uses Server: 1',
      'Web uses UI kit: 1',
      'Web shows UI kit: 1',
      'Web reads Other: 1',
    ]);
    const { areas } = foldAreas(todoGraph(), TODO_AREAS);
    expect(areas.map((area) => [area.name, area.parts.length, area.files, area.internalLinks, area.serverCalls, area.serverOps])).toEqual([
      ['Web', 2, 3, 2, 2, 2],
      ['UI kit', 1, 1, 0, 0, 0],
      ['Server', 2, 2, 1, 0, 0],
      ['Tooling', 2, 3, 2, 0, 0],
      ['Other', 1, 1, 0, 0, 0],
    ]);
  });

  it('gives each line its kinds, the parts on each side and up to three examples, real code before tests', () => {
    const graph = todoGraph([
      ...todoGraph().files,
      file('scripts/reset.spec.ts', { kind: 'test', imports: [TODO.db] }),
      file('scripts/a-reset.spec.ts', { kind: 'test', imports: [TODO.db] }),
      file('scripts/backup.ts', { imports: [TODO.db] }),
      file('scripts/clean.ts', { imports: [TODO.db, TODO.router] }),
    ]);
    const line = foldAreas(graph, TODO_AREAS).areaLinks.find((candidate) => candidate.from === 'Tooling');
    expect(line).toMatchObject({ id: 'tooling--uses--server', count: 6, files: 5, kinds: { import: 6 }, fromParts: { scripts: 6 }, toParts: { 'apps/server/src/db': 5, 'apps/server/src/routers': 1 } });
    expect(line?.examples.map((example) => `${example.from} -> ${example.to}`)).toEqual([
      'scripts/backup.ts -> apps/server/src/db/db.ts',
      'scripts/clean.ts -> apps/server/src/routers/todos.ts',
      'scripts/seed.ts -> apps/server/src/db/db.ts',
    ]);
  });

  it('marks a line whose links are all GraphQL calls, so it reads as using the other area\'s queries', () => {
    const graph = todoGraph([
      file(TODO.list, { links: [{ target: 'apps/server/src/db/todos.graphql', kind: 'graphql', label: 'todos' }] }),
      file('apps/server/src/db/todos.graphql'),
    ]);
    expect(foldAreas(graph, TODO_AREAS).areaLinks).toMatchObject([{ from: 'Web', to: 'Server', verb: 'asks the server', viaQueries: true }]);
  });

  it('sends parts no area claims to Other, with a warning for check', () => {
    const graph = todoGraph();
    addAreas(graph, TODO_AREAS, []);
    expect(graph.areas?.at(-1)).toMatchObject({ name: 'Other', source: 'other', parts: ['content'] });
    expect(graph.gaps).toEqual([
      expect.objectContaining({ kind: 'part-without-area', level: 'warning', detail: expect.stringContaining('content is in no area') }),
    ]);
    expect(formatAreas(graph).join('\n')).toContain('Other: 1 part, 1 file [not in any area]\n     content');
  });

  it('counts the part-to-part pairs the folding started from, leaving components used by tag only out', () => {
    expect(foldAreas(todoGraph(), TODO_AREAS).linkTotals).toEqual({ links: 11, partPairs: 7 });
  });
});

describe('areas without a map', () => {
  it('groups by top folder, with the top-level files on their own, and no warnings', () => {
    const folded = foldAreas(todoGraph(), null);
    expect(folded.areas.map((area) => [area.name, area.source, area.folders, area.parts.length])).toEqual([
      ['apps', 'folders', ['apps'], 5],
      ['content', 'folders', ['content'], 1],
      ['scripts', 'folders', ['scripts'], 1],
      ['Top level', 'folders', ['(root)'], 1],
    ]);
    expect(folded.gaps).toEqual([]);
    expect(lines(todoGraph(), null)).toEqual(['scripts uses apps: 1', 'apps reads content: 1', 'Top level runs scripts: 1']);
  });

  it('keeps a workspace package and the folders inside it together', () => {
    const parts: Part[] = [
      { id: 'apps/web', kind: 'package', name: 'web', dir: 'apps/web', files: [] },
      { id: 'apps/web/src/ui', kind: 'folder', name: 'web/ui', dir: 'apps/web/src/ui', files: [] },
      { id: 'apps/server', kind: 'package', name: 'server', dir: 'apps/server', files: [] },
      { id: 'apps/server/src/db', kind: 'folder', name: 'server/db', dir: 'apps/server/src/db', files: [] },
    ];
    expect(folderAreas(parts)).toEqual({ web: { folders: ['apps/web'] }, server: { folders: ['apps/server'] } });
  });

  it('splits one more folder level down when everything sits in one top folder', () => {
    const parts = ['src/todos', 'src/lists', 'src/ui', 'src/ui/icons'].map((dir) => ({ id: dir, kind: 'folder', name: dir, dir, files: [] }));
    expect(Object.keys(folderAreas(parts))).toEqual(['src/todos', 'src/lists', 'src/ui']);
  });

  it('says in check that the areas come from folders, and when the viewer skips them on a small repo', () => {
    const graph = graphOf(TODO_PARTS, todoGraph().files);
    addAreas(graph, null, []);
    expect(formatAreas(graph)[0]).toBe('Areas: none written in the map, so 4 by folder (the viewer skips them: fewer than 12 parts)');
  });
});

describe('review fixes', () => {
  it('groups folders named like Object properties without throwing', () => {
    const parts = ['constructor', '__proto__', 'toString'].map((dir) => ({ id: dir, kind: 'folder', name: dir, dir, files: [] }));
    expect(Object.keys(folderAreas(parts))).toEqual(['constructor', '__proto__', 'toString']);
    expect(foldAreas(graphOf(parts, []), null).areas.map((area) => area.name)).toEqual(['constructor', '__proto__', 'toString']);
  });

  it('warns for a part in no area even when the map has an area called Other', () => {
    const graph = todoGraph();
    addAreas(graph, { ...TODO_AREAS, Other: { folders: ['scripts'] } }, []);
    expect(graph.gaps).toEqual([expect.objectContaining({ kind: 'part-without-area', detail: expect.stringContaining('content is in no area') })]);
  });
});

