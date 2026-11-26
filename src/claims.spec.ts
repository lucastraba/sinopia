import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { addAreas, claimStatus, formatAreas } from './areaReport.js';
import { foldAreas } from './areas.js';
import { checkSpecs, evaluateClaim } from './claims.js';
import { runCli } from './cli.js';
import { pickAdapter } from './loadAdapter.js';
import type { ClaimSpec, Graph } from './model.js';
import { file, TODO, TODO_AREAS, todoFiles, todoGraph } from './todoGraph.fixture.js';

const claim = (spec: Omit<ClaimSpec, 'says'>, graph = todoGraph()) =>
  evaluateClaim({ says: 'test claim', ...spec } as ClaimSpec, foldAreas(graph, TODO_AREAS).context);

/** The todo app with the button importing the todos composable: the UI kit now reaches into a feature. */
const leaky = () =>
  todoGraph(todoFiles().map((node) => (node.id === TODO.button ? { ...node, imports: [TODO.useTodos] } : node)));

describe('never', () => {
  it('holds when nothing of the kind crosses, and says what crosses instead', () => {
    const result = claim({ never: { from: 'Web', to: 'UI kit', kind: 'trpc' } });
    expect(result).toMatchObject({ holds: true, count: 0, scope: 2, scopeByVerb: { shows: 1, uses: 1 } });
    expect(claimStatus(result)).toBe('holds: no trpc links; what crosses instead: shows 1, uses 1');
  });

  it('breaks on each link from one side into the other, with where and examples', () => {
    const result = claim({ never: { from: 'UI kit', to: 'Web', kind: 'import' } }, leaky());
    expect(result).toMatchObject({ holds: false, count: 1, files: 1, byKind: { import: 1 }, pairs: [{ from: 'UI kit', to: 'Web', count: 1 }], pairsTotal: 1 });
    expect(result.examples).toEqual([{ from: TODO.button, to: TODO.useTodos, kind: 'import', label: null }]);
    expect(claim({ never: { from: 'UI kit', to: 'Web', kind: 'import' } }).holds).toBe(true);
  });

  it('counts components and data files as imports, and any kind when the claim names none', () => {
    expect(claim({ never: { from: 'Web', to: { folders: ['content'] }, kind: 'import' } })).toMatchObject({ holds: false, byKind: { data: 1 } });
    expect(claim({ never: { from: 'Web', to: 'Server' } })).toMatchObject({ holds: false, count: 2, byKind: { trpc: 2 } });
  });

  it('with each: breaks on links between two different matches of a folder pattern, named by what the wildcard matched', () => {
    const result = claim({ never: { each: 'apps/web/src/features/*', kind: 'import' } });
    expect(result).toMatchObject({ holds: false, count: 1, byKind: { component: 1 }, pairs: [{ from: 'lists', to: 'todos', count: 1 }] });
    expect(claim({ never: { each: 'apps/web/src/features/*', kind: 'trpc' } })).toMatchObject({ holds: true, scope: 1 });
  });
});

describe('only', () => {
  it('breaks on links into the target from anywhere but the allowed side', () => {
    const result = claim({ only: { who: 'Server', to: { folders: ['apps/server/src/db'] } } });
    expect(result).toMatchObject({ holds: false, count: 1, pairs: [{ from: 'Tooling', to: 'Server', count: 1 }] });
    expect(result.examples[0]).toMatchObject({ from: TODO.seed, to: TODO.db });
  });

  it('holds when every link in comes from the allowed side; links inside the target and outside `from` do not count', () => {
    expect(claim({ only: { who: 'Web', to: 'Server', kind: 'trpc' } })).toMatchObject({ holds: true, scope: 2 });
    expect(claim({ only: { who: 'Server', to: { folders: ['apps/server/src/db'] }, from: { folders: ['apps'] } } })).toMatchObject({ holds: true, scope: 1 });
  });

  it('picks files by glob, minus except', () => {
    const graph = todoGraph([...todoFiles(), file('apps/web/src/features/todos/TodoTitle.vue', { links: [{ target: TODO.router, kind: 'trpc', label: 'todos.rename' }] })]);
    const spec = { who: { files: '**/use*.ts' }, to: 'Server', kind: 'trpc' };
    expect(claim({ only: spec }, graph)).toMatchObject({ holds: false, count: 1 });
    expect(claim({ only: { ...spec, from: { area: 'Web', except: { files: ['**/*Title.vue'] } } } }, graph)).toMatchObject({ holds: true });
  });
});

describe('through', () => {
  it('holds when every link from one side to the other lands on the way through', () => {
    const result = claim({ through: { from: 'Web', to: { folders: ['apps/server'] }, via: { files: ['apps/server/src/routers/*.ts'] } } });
    expect(result).toMatchObject({ holds: true, scope: 2 });
    expect(claimStatus(result)).toBe('holds: all 2 links go through it (asks the server 2)');
  });

  it('breaks on links that reach the other side directly', () => {
    const result = claim({ through: { from: 'Tooling', to: { folders: ['apps/server/src/db'] }, via: { folders: ['apps/server/src/routers'] } } });
    expect(result).toMatchObject({ holds: false, count: 1, examples: [{ from: TODO.seed, to: TODO.db }] });
  });

  it('says "the 1 link" when one link is all there is', () => {
    const result = claim({ through: { from: 'Tooling', to: 'Server', via: { folders: ['apps/server/src/db'] } } });
    expect(claimStatus(result)).toBe('holds: the 1 link goes through it (uses 1)');
    expect(claimStatus(claim({ only: { who: 'Tooling', to: 'Server', kind: 'import' } }))).toBe('holds: the 1 link comes from the allowed side');
  });
});

describe('claims on the graph', () => {
  it('keeps every result, lists the areas a claim names, and makes an enforced broken claim an error', () => {
    const graph: Graph = leaky();
    addAreas(graph, TODO_AREAS, [
      { says: 'The UI kit never imports the app', never: { from: 'UI kit', to: 'Web', kind: 'import' }, draft: true },
      { says: 'Only the web app calls the server', only: { who: 'Web', to: 'Server', kind: 'trpc' }, enforce: true },
      { says: 'The UI kit never calls the server', never: { from: 'UI kit', to: 'Server' }, enforce: true, areas: ['Tooling'] },
    ]);
    expect(graph.claims?.map((result) => [result.holds, result.count, result.draft, result.enforce, result.areas])).toEqual([
      [false, 1, true, false, ['Web', 'UI kit']],
      [true, 0, false, true, ['Web', 'Server']],
      [true, 0, false, true, ['UI kit', 'Server', 'Tooling']],
    ]);
    expect(graph.gaps.filter((gap) => gap.kind === 'claim-broken')).toEqual([]);
    addAreas(graph, TODO_AREAS, [{ says: 'The UI kit never imports the app', never: { from: 'UI kit', to: 'Web' }, enforce: true }]);
    expect(graph.gaps.filter((gap) => gap.kind === 'claim-broken')).toEqual([
      { kind: 'claim-broken', level: 'error', file: TODO.button, detail: '"The UI kit never imports the app" is enforced and broken: 1 link from 1 file' },
    ]);
  });

  it('prints each claim in check with its mark, status and examples', () => {
    const graph = leaky();
    addAreas(graph, TODO_AREAS, [
      { says: 'The UI kit never imports the app', never: { from: 'UI kit', to: 'Web', kind: 'import' }, draft: true },
      { says: 'The web app never imports the server', never: { from: 'Web', to: 'Server', kind: 'import' } },
    ]);
    const text = formatAreas(graph).join('\n');
    expect(text).toContain(
      [
        'Claims: 1 hold, 1 broken',
        '  1. ✗ The UI kit never imports the app [draft]',
        '     broken: 1 link from 1 file (UI kit → Web 1)',
        `       ${TODO.button} -> ${TODO.useTodos} (import)`,
        '  2. ✓ The web app never imports the server',
        '     holds: no import links; what crosses instead: asks the server 2',
      ].join('\n')
    );
    expect(text).toContain('Drafts: 1 area (UI kit) and claim 1, written by an agent and not yet confirmed.');
  });
});

describe('checkSpecs', () => {
  it('accepts the three forms and every side shape', () => {
    expect(
      checkSpecs(TODO_AREAS, [
        { says: 'a', never: { from: 'Web', to: { areas: ['Server'], folders: ['x'], files: '**/*.ts', except: { files: ['*.spec.ts'] } }, kinds: ['import'] } },
        { says: 'b', never: { each: 'apps/*/src/features/*' } },
        { says: 'c', only: { who: 'Web', to: 'Server', from: { area: 'Web' } }, why: 'because', draft: true, enforce: false, areas: ['Tooling'] },
        { says: 'd', through: { from: 'Web', to: 'Server', via: { folders: ['apps/server/src/routers'] } } },
      ])
    ).toEqual([]);
  });

  it('names every mistake: unknown options, missing sides, two forms, areas the map lacks', () => {
    expect(
      checkSpecs({ Web: { folder: ['apps/web'] } }, [
        { says: 'a', never: { from: 'Web', to: 'Serverr' } },
        { says: 'b', never: { from: 'Web' }, only: { who: 'Web', to: 'Web' } },
        { says: 'c', through: { from: 'Web', to: 'Web' }, enfroce: true },
        { says: 'd', only: { who: { area: 'Web', dirs: ['x'] }, to: 'Web' } },
      ])
    ).toEqual([
      'area "Web": unknown option folder; an area takes folders, why, draft',
      'area "Web": folders must be a list of repo-relative folders',
      'claim 1 ("a"): to names the area "Serverr", which the map doesn\'t have',
      'claim 2 ("b"): needs exactly one of never, only or through',
      'claim 3 ("c"): unknown option enfroce; a claim takes says, never, only, through, why, draft, enforce, areas',
      'claim 3 ("c"): through needs via',
      'claim 4 ("d"): who takes area, areas, folders, files, except, not dirs',
    ]);
  });
});

describe('areas and claims in a map file', () => {
  const repos: string[] = [];
  afterAll(() => {
    for (const repo of repos) rmSync(repo, { recursive: true, force: true });
  });
  const makeRepo = (files: Record<string, string>) => {
    const repo = mkdtempSync(join(tmpdir(), 'sinopia-areas-'));
    repos.push(repo);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), content);
    }
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'todo app');
    return repo;
  };
  const code = {
    'package.json': '{ "name": "todo-app" }',
    'vite.config.ts': 'export default {};\n',
    'apps/web/package.json': '{ "name": "web" }',
    'apps/server/package.json': '{ "name": "server" }',
    'apps/web/src/features/todos/useTodos.ts': "import { db } from '../../../../server/src/db/db';\nexport const todos = () => db;\n",
    'apps/web/src/ui/Button.ts': "import { todos } from '../features/todos/useTodos';\nexport const button = todos;\n",
    'apps/server/src/db/db.ts': 'export const db = {};\n',
  };

  it('scans them into graph.json and fails check on an enforced broken claim', async () => {
    const map = `export default () => [];
export const areas = {
  Web: { folders: ['apps/web'], why: 'What the user sees.', draft: true },
  'UI kit': { folders: ['apps/web/src/ui'], why: 'Buttons.' },
  Server: { folders: ['apps/server'], why: 'The API.' },
};
export const claims = [
  { says: 'The UI kit never imports the app', never: { from: 'UI kit', to: 'Web', kind: 'import' }, enforce: true },
  { says: 'Only the server reads the database', only: { who: 'Server', to: { folders: ['apps/server/src/db'] } }, draft: true },
];
`;
    const repo = makeRepo({ ...code, '.sinopia/map.mjs': map });
    const out = join(repo, '.artifacts');
    const { adapter, source } = await pickAdapter('auto', repo, 'todo-app');
    const logs: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(String(line)));
    try {
      await runCli({ adapter, adapterSource: source, repo, out, argv: ['scan'], command: 'sinopia', diffBase: null });
      const graph = JSON.parse(readFileSync(join(out, 'graph.json'), 'utf8')) as Graph;
      expect(graph.areas?.map((area) => [area.name, area.source, area.draft])).toEqual([
        ['Web', 'map', true],
        ['UI kit', 'map', false],
        ['Server', 'map', false],
        ['Other', 'other', false],
      ]);
      expect(graph.areaLinks?.map((line) => `${line.from} ${line.verb} ${line.to} ${line.count}`)).toEqual(['UI kit uses Web 1', 'Web uses Server 1']);
      expect(graph.claims?.map((result) => [result.says, result.holds, result.count])).toEqual([
        ['The UI kit never imports the app', false, 1],
        ['Only the server reads the database', false, 1],
      ]);
      expect(logs.join('\n')).toContain('4 areas with 2 lines between them, claims 0 hold, 2 broken');
      logs.length = 0;
      process.exitCode = 0;
      await runCli({ adapter, adapterSource: source, repo, out, argv: ['check'], command: 'sinopia', diffBase: null });
      expect(process.exitCode).toBe(1);
      const text = logs.join('\n');
      expect(text).toContain('1. ✗ The UI kit never imports the app [enforced]');
      expect(text).toContain('ERROR claim-broken');
      expect(text).toContain('WARNING part-without-area: (root) is in no area');
      logs.length = 0;
      await runCli({ adapter, adapterSource: source, repo, out, argv: ['check', '--json'], command: 'sinopia', diffBase: null });
      expect(JSON.parse(logs.join('\n')).linkTotals).toEqual(graph.linkTotals);
    } finally {
      log.mockRestore();
      process.exitCode = 0;
    }
  });

  it('refuses a map whose claims name an area it does not have', async () => {
    const repo = makeRepo({ ...code, '.sinopia/map.mjs': "export default () => [];\nexport const areas = { Web: { folders: ['apps/web'] } };\nexport const claims = [{ says: 'x', never: { from: 'Web', to: 'Sever' } }];\n" });
    await expect(pickAdapter('auto', repo, 'todo-app')).rejects.toThrow('claim 1 ("x"): to names the area "Sever", which the map doesn\'t have');
  });
});

describe('review fixes', () => {
  it('counts links into a `to` nested inside `from`, for never and through', () => {
    const server = { folders: ['apps/server'] };
    const db = { folders: ['apps/server/src/db'] };
    expect(claim({ never: { from: server, to: db } })).toMatchObject({ holds: false, count: 1, examples: [{ from: TODO.router, to: TODO.db }] });
    expect(claim({ through: { from: server, to: db, via: { files: ['apps/server/src/db/index.ts'] } } })).toMatchObject({ holds: false, count: 1 });
  });

  it('refuses area selectors of the wrong type and unknown names in except', () => {
    expect(
      checkSpecs(TODO_AREAS, [
        { says: 'a', never: { from: 'Web', to: { areas: 17 } } },
        { says: 'b', never: { from: { area: 5 }, to: 'Web' } },
        { says: 'c', never: { from: { area: 'Web', except: 'Sever' }, to: 'Server' } },
      ])
    ).toEqual([
      'claim 1 ("a"): to.areas must be a list of area names',
      'claim 2 ("b"): from.area must be an area name',
      'claim 3 ("c"): from names the area "Sever", which the map doesn\'t have',
    ]);
  });

  it('without written areas, makes a claim naming an area the folders did not make an error', () => {
    const bad = todoGraph();
    addAreas(bad, null, [{ says: 'scripts never reach the apps', never: { from: 'scripts', to: 'appss' }, enforce: true } as ClaimSpec]);
    expect(bad.gaps).toEqual([expect.objectContaining({ kind: 'claim-unknown-area', level: 'error', detail: expect.stringContaining('"appss"') })]);
    const good = todoGraph();
    addAreas(good, null, [{ says: 'content never reaches the apps', never: { from: 'content', to: 'apps' } } as ClaimSpec]);
    expect(good.gaps.filter((gap) => gap.kind === 'claim-unknown-area')).toEqual([]);
  });
});

