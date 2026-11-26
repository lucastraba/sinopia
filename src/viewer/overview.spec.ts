import { addAreas } from '../areaReport';
import type { Descriptions, Graph } from '../model';
import { graphOf, TODO, TODO_AREAS, TODO_PARTS, todoFiles } from '../todoGraph.fixture';
import { buildIndex } from './mapIndex';
import {
  areaModel,
  areaOfPart,
  areaWhy,
  claimSource,
  claimSummary,
  exampleFile,
  exampleTag,
  hasOverview,
  namesTarget,
  linesWithVerb,
  overviewModel,
  verbsUsed,
} from './overview';

const EMPTY: Descriptions = { app: null, parts: {}, files: {}, operations: {}, runs: [] };
const description = (title: string, plain = `${title}, plainly.`) => ({ hash: '', title, plain, dev: `${title} for developers.` });

/** The todo app, padded with small folders to `parts` parts so the overview applies. */
const todoMap = (options: { parts?: number; areas?: typeof TODO_AREAS | null; descriptions?: Descriptions } = {}) => {
  const extra = Array.from({ length: Math.max(0, (options.parts ?? 12) - TODO_PARTS.length) }, (_, i) => ({
    id: `apps/web/src/features/extra${i}`,
    kind: 'folder',
    name: `extra${i}`,
    dir: `apps/web/src/features/extra${i}`,
  }));
  const graph: Graph = graphOf([...TODO_PARTS, ...extra], todoFiles());
  addAreas(graph, options.areas === undefined ? TODO_AREAS : options.areas, [
    { says: 'The UI kit never imports the app', never: { from: 'UI kit', to: 'Web', kind: 'import' }, draft: true },
    { says: 'Only the web app calls the server', only: { who: 'Web', to: 'Server', kind: 'trpc' } },
    { says: 'Only the server reads the database', only: { who: 'Server', to: { folders: ['apps/server/src/db'] } } },
    { says: 'The web app reaches the server through its routers', through: { from: 'Web', to: 'Server', via: { folders: ['apps/server/src/routers'] } } },
  ]);
  return buildIndex(graph, options.descriptions ?? EMPTY, null);
};

describe('hasOverview', () => {
  it('opens on the overview with areas and at least 12 parts, and on the parts themselves below that', () => {
    expect(hasOverview(todoMap({ parts: 12 }))).toBe(true);
    expect(hasOverview(todoMap({ parts: 11 }))).toBe(false);
    expect(hasOverview(todoMap({ parts: 12, areas: null }))).toBe(true);
    const old = todoMap();
    expect(hasOverview(buildIndex({ ...old.graph, areas: undefined }, EMPTY, null))).toBe(false);
  });
});

describe('overviewModel', () => {
  it('has the app paragraph, the claims, each area with its two biggest lines out and in, and the facts line', () => {
    const descriptions = { ...EMPTY, app: description('Todo app', 'A list of things to do, kept on a server.') };
    const model = overviewModel(todoMap({ descriptions }), 'plain');
    expect(model.title).toBe('Todo app');
    expect(model.text).toBe('A list of things to do, kept on a server.');
    expect(model.byFolder).toBe(false);
    expect([model.draftAreas, model.draftClaims]).toEqual([1, 1]);
    expect(model.claims.map((claim) => claim.holds)).toEqual([true, true, false, true]);
    expect(model.areas.map((card) => card.area.name)).toEqual(['Web', 'UI kit', 'Server', 'Tooling', 'Other']);
    expect(model.areas[0]?.talks).toEqual([
      { dir: 'out', verb: 'asks the server', area: 'Server', count: 2 },
      { dir: 'out', verb: 'uses', area: 'UI kit', count: 1 },
    ]);
    expect(model.areas[2]?.talks).toEqual([
      { dir: 'in', verb: 'asks the server', area: 'Web', count: 2 },
      { dir: 'in', verb: 'uses', area: 'Tooling', count: 1 },
    ]);
    expect(model.facts).toEqual({ parts: 12, files: 10, partPairs: 7, links: 11 });
  });

  it('says when the areas are only folders, and borrows the folder part’s description for them', () => {
    const descriptions = { ...EMPTY, parts: { content: description('Words on screen') } };
    const index = todoMap({ areas: null, descriptions });
    const model = overviewModel(index, 'plain');
    expect(model.byFolder).toBe(true);
    expect(model.areas.map((card) => [card.area.name, card.why])).toEqual([
      ['apps', 'Everything under apps/.'],
      ['content', 'Words on screen, plainly.'],
      ['scripts', 'Everything under scripts/.'],
      ['Top level', 'Everything under the top level.'],
    ]);
    expect(areaWhy(index, model.areas[1]!.area, 'dev')).toBe('Words on screen for developers.');
  });

  it('filters the lines by verb, and lists the verbs in use in reading order', () => {
    const { lines } = overviewModel(todoMap(), 'plain');
    expect(verbsUsed(lines)).toEqual([
      { verb: 'uses', lines: 2 },
      { verb: 'shows', lines: 1 },
      { verb: 'asks the server', lines: 1 },
      { verb: 'reads', lines: 1 },
    ]);
    expect(linesWithVerb(lines, 'uses').map((line) => line.id)).toEqual(['tooling--uses--server', 'web--uses--ui-kit']);
    expect(linesWithVerb(lines, null)).toHaveLength(5);
  });
});

describe('areaModel', () => {
  it('has the area’s lines out and in, the claims that name it, and its parts with their lines to other areas', () => {
    const index = todoMap({ descriptions: { ...EMPTY, parts: { 'apps/web/src/features/todos': description('Todo list') } } });
    const web = index.graph.areas!.find((area) => area.name === 'Web')!;
    const model = areaModel(index, web, 'plain');
    expect(model.out.map((line) => line.id)).toEqual(['web--asks-the-server--server', 'web--uses--ui-kit', 'web--shows--ui-kit', 'web--reads--other']);
    expect(model.in).toEqual([]);
    expect(model.claims.map((claim) => claim.says)).toEqual([
      'The UI kit never imports the app',
      'Only the web app calls the server',
      'The web app reaches the server through its routers',
    ]);
    const todos = model.parts.find((part) => part.id === 'apps/web/src/features/todos')!;
    expect(todos).toMatchObject({ title: 'Todo list', sub: 'apps/web/src/features/todos', text: 'Todo list, plainly.', files: 2, outTotal: 4, inTotal: 0 });
    expect(todos.out).toEqual([
      { dir: 'out', verb: 'asks the server', area: 'Server', count: 2 },
      { dir: 'out', verb: 'shows', area: 'UI kit', count: 1 },
      { dir: 'out', verb: 'reads', area: 'Other', count: 1 },
    ]);
    expect(areaModel(index, web, 'dev').parts[0]).toMatchObject({ title: 'apps/web/src/features/todos', sub: 'Todo list' });
    expect(areaOfPart(index, 'apps/web/src/ui')?.name).toBe('UI kit');
  });
});

describe('claim and example wording', () => {
  it('says how each form came out', () => {
    const claims = todoMap().graph.claims!;
    expect(claims.map(claimSummary)).toEqual([
      { word: 'Holds', detail: 'nothing crosses at all' },
      { word: 'Holds', detail: 'all 2 links come from the allowed side' },
      { word: 'Broken', detail: '1 link from 1 file' },
      { word: 'Holds', detail: 'all 2 links go through it (asks the server 2)' },
    ]);
    expect(claimSource(claims[0]!)).toBe(
      "{ says: 'The UI kit never imports the app', never: {from: 'UI kit', to: 'Web', kind: 'import'}, draft: true }"
    );
  });

  it('names files by description in plain words and by path for developers, and tags what crosses', () => {
    const index = todoMap({ descriptions: { ...EMPTY, files: { [TODO.list]: description('The todo list') } } });
    expect(exampleFile(index, TODO.list, 'plain')).toEqual({ label: 'The todo list', hint: 'TodoList.vue' });
    expect(exampleFile(index, TODO.db, 'plain')).toEqual({ label: 'db.ts', hint: 'apps/server/src/db' });
    expect(exampleFile(index, TODO.db, 'dev')).toEqual({ label: TODO.db, hint: '' });
    const call = { from: TODO.useTodos, to: TODO.router, kind: 'trpc', label: 'todos.add' };
    expect([exampleTag(call, 'plain'), exampleTag(call, 'dev')]).toEqual(['server call: todos.add', 'trpc todos.add']);
    expect(exampleTag({ ...call, kind: 'import', label: null }, 'plain')).toBe('');
  });

  it('drops the target from a sentence whose verb already names it', () => {
    expect(namesTarget('asks the server', 'server')).toBe(false);
    expect(namesTarget('asks the server', 'Server')).toBe(false);
    expect(namesTarget('asks the server', 'Reports')).toBe(true);
    expect(namesTarget('uses', 'server')).toBe(true);
  });
});
