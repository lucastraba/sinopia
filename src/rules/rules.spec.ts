import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { formatRules } from '../coverage.js';
import { pickAdapter } from '../loadAdapter.js';
import type { Graph } from '../model.js';
import { calledPaths } from './http.js';
import { LOCAL_MAP } from './index.js';
import { stripJsComments, stripPy } from './parse.js';

const repos: string[] = [];
afterAll(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

const makeRepo = (files: Record<string, string>): string => {
  const repo = mkdtempSync(join(tmpdir(), 'sinopia-rules-'));
  repos.push(repo);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
};

const scan = async (files: Record<string, string>, map: string): Promise<Graph> => {
  const repo = makeRepo({ ...files, [LOCAL_MAP]: map });
  const { adapter, source } = await pickAdapter('auto', repo, 'fixture');
  expect(source.endsWith(LOCAL_MAP)).toBe(true);
  return adapter.scan({ repo, root: repo, artifacts: join(repo, '.artifacts'), source: { label: 'test', sha: null } });
};

const links = (graph: Graph) =>
  graph.files.flatMap((f) => (f.links ?? []).map((l) => `${f.id} -> ${l.target} [${l.kind}] ${l.label}`)).sort();

describe('parse helpers', () => {
  it('blanks comments and keeps offsets, strings and line breaks', () => {
    const text = "a(); // b\n/* c\n d */ e('// not a comment')";
    const out = stripJsComments(text);
    expect(out).toHaveLength(text.length);
    expect(out).not.toContain('b');
    expect(out).toContain("e('// not a comment')");
    expect(out.split('\n')).toHaveLength(3);
  });

  it('blanks Python comments and docstrings', () => {
    expect(stripPy('x = 1  # note\n"""doc\nstring"""\ny = "#kept"')).not.toMatch(/note|doc/);
    expect(stripPy('y = "#kept"')).toContain('#kept');
  });
});

describe('calledPaths', () => {
  it('follows a base URL through a variable and takes path literals passed as arguments', () => {
    const py = [
      'self._endpoint = f"{cfg.url}/control/voice"',
      'httpx.post(f"{self._endpoint}/roster", json=x)',
      'self._send("/ingest/subtitle", payload)',
      'open("/tmp")',
    ].join('\n');
    expect([...calledPaths(py)].sort()).toEqual(['/control/voice', '/control/voice/roster', '/ingest/subtitle']);
  });
});

describe('map rules', () => {
  const bus = {
    'src/bus.ts': [
      "export const ORDER_PAID = 'order.paid';",
      "export const ee = new EventEmitter();",
      'export const emitPaid = (id) => ee.emit(ORDER_PAID, id);',
    ].join('\n'),
    'src/checkout.ts': "import { emitPaid } from './bus';\nexport const pay = () => emitPaid(1);",
    'src/mailer.ts': "import { ee, ORDER_PAID } from './bus';\nee.on(ORDER_PAID, () => {});",
    'src/stray.ts': "import { ee } from './bus';\nee.emit('nobody.listens');",
  };

  it('links calls to answers by key, through helpers, labelled by the constant value', async () => {
    const graph = await scan(
      bus,
      `export const base = 'plain';
export default ({ link }) => [
  link({ kind: 'event', in: 'src', call: 'ee.emit({key}', answer: 'ee.on({key}', wrappers: true, labels: 'constants', why: 'One bus.' }),
];`
    );
    expect(links(graph)).toEqual(['src/checkout.ts -> src/mailer.ts [event] order.paid']);
    expect(graph.gaps.filter((g) => g.kind === 'unmatched-event').map((g) => [g.file, g.detail])).toEqual([
      ['src/stray.ts', 'nobody.listens (line 2): nothing answers it'],
    ]);
    expect(graph.meta.rules).toEqual([
      expect.objectContaining({ rule: 'link', why: 'One bus.', draft: false, links: { event: 1 }, gaps: 1 }),
    ]);
  });

  it('reports drafts, regular expressions and the share of links from custom code', async () => {
    const graph = await scan(
      bus,
      `export const base = 'plain';
export default ({ link, custom }) => [
  link({ kind: 'event', in: 'src', call: /ee\\.emit\\((?<key>[A-Z_]+)/, answer: 'ee.on({key}', wrappers: true, draft: true }),
  custom({ name: 'stray to bus', run: (ctx) => ctx.addLink(ctx.byId.get('src/stray.ts'), { target: 'src/bus.ts', kind: 'uses', label: null }) }),
];`
    );
    const report = formatRules(graph.meta.rules ?? []).join('\n');
    expect(report).toMatch(/\[draft, 1 regex\]/);
    expect(report).toMatch(/Drafts: rule 1,/);
    expect(report).toMatch(/Regular expressions: 1 call shape/);
    expect(report).toMatch(/Custom code: 1 of 2 links \(50\.0%\)/);
  });

  it('fails loudly on an option a primitive does not know', async () => {
    await expect(
      scan(bus, `export default ({ link }) => [link({ kind: 'event', in: 'src', call: 'a({key}', answer: 'b({key}', wrapper: true })];`)
    ).rejects.toThrow(/unknown option wrapper/);
  });

  it('turns a rule that throws into an error gap instead of crashing the scan', async () => {
    const graph = await scan(bus, `export const base = 'plain';\nexport default ({ custom }) => [custom({ run: () => { throw new Error('boom'); } })];`);
    expect(graph.gaps.find((g) => g.kind === 'rule-failed')?.detail).toMatch(/boom/);
  });

  it('links HTTP calls to routes with their method', async () => {
    const graph = await scan(
      {
        'server/main.ts': "if (req.url === '/api/items' && req.method === 'POST') {}\nif (req.url === '/health') {}",
        'client/sync.py': 'import httpx\nBASE = f"{url}/api"\nhttpx.post(f"{BASE}/items")\nhttpx.get(f"{url}/health")\nhttpx.get(f"{BASE}/missing")',
      },
      `export const base = 'plain';
export default ({ http }) => [
  http({ server: 'server', clients: 'client', routes: ['req.url === {path} && req.method === {method}', 'req.url === {path}'] }),
];`
    );
    expect(links(graph)).toEqual(['client/sync.py -> server/main.ts [http] POST /api/items']);
    expect(graph.gaps.filter((g) => g.kind === 'unmatched-http').map((g) => g.detail).sort()).toEqual([
      '/api matches no server route',
      '/api/missing matches no server route',
    ]);
  });

  it('follows nested tRPC routers to the file that declares each procedure', async () => {
    const graph = await scan(
      {
        'server/routers/counter.ts': 'export const counterRouter = t.router({ increment: t.procedure.mutation(() => 1) });',
        'server/router.ts': "import { counterRouter } from './routers/counter';\nexport const appRouter = t.router({ counter: counterRouter, health: t.procedure.query(() => 'ok') });",
        'app/button.ts': "import { trpc } from './trpc';\ntrpc.counter.increment.mutate();\ntrpc.health.query();\ntrpc.counter.reset.mutate();",
      },
      `export const base = 'plain';\nexport default ({ trpc }) => [trpc({ routers: 'server', connection: false })];`
    );
    expect(links(graph)).toEqual([
      'app/button.ts -> server/router.ts [trpc] health',
      'app/button.ts -> server/routers/counter.ts [trpc] counter.increment',
    ]);
    expect(graph.gaps.find((g) => g.kind === 'unmatched-trpc')?.detail).toMatch(/trpc\.counter\.reset\.mutate .* matches no procedure/);
  });

  it('links mentions of a declared name when there is no call shape', async () => {
    const graph = await scan(
      {
        'desktop/preload.ts': "contextBridge.exposeInMainWorld('gameDesktop', api);",
        'src/platform.ts': 'export const desktop = window.gameDesktop ?? null;',
        'src/other.ts': 'export const gameDesktopish = 1;',
      },
      `export const base = 'plain';\nexport default ({ link }) => [link({ kind: 'bridge', from: 'src', to: 'desktop', answer: 'exposeInMainWorld({key}' })];`
    );
    expect(links(graph)).toEqual(['src/platform.ts -> desktop/preload.ts [bridge] gameDesktop']);
  });

  it('puts imported data files on the map, through relative imports and aliases', async () => {
    const graph = await scan(
      {
        'content/items.yaml': 'sword: 1',
        'content/strings/en.yaml': 'hi: Hello',
        'content/notes.md': '# not data',
        'package.json': '{}',
        'src/load.ts': "import items from '@content/items.yaml';\nimport en from '../content/strings/en.yaml?raw';\nimport gone from '@content/gone.yaml';",
      },
      `export const base = 'js';\nexport default ({ dataFiles }) => [dataFiles({ in: 'content', extensions: ['yaml'], aliases: { '@content': 'content' } })];`
    );
    expect(graph.files.map((f) => f.id).filter((id) => id.endsWith('.yaml')).sort()).toEqual(['content/items.yaml', 'content/strings/en.yaml']);
    expect(graph.files.find((f) => f.id === 'src/load.ts')?.imports.sort()).toEqual(['content/items.yaml', 'content/strings/en.yaml']);
    expect(graph.gaps.find((g) => g.kind === 'unresolved-data-import')?.detail).toMatch(/@content\/gone\.yaml/);
    expect(graph.meta.rules?.[0]).toEqual(expect.objectContaining({ files: 2 }));
  });

  it('links runners to the files they name by path, not in comments', async () => {
    const graph = await scan(
      {
        'package.json': JSON.stringify({ scripts: { sim: 'node scripts/sim.mjs --fast', serve: 'node ./serve.mjs' } }),
        '.github/workflows/ci.yml': 'steps:\n  # scripts/old.mjs used to run here\n  - run: bash scripts/deploy.sh',
        'scripts/sim.mjs': 'export {};',
        'scripts/old.mjs': 'export {};',
        'scripts/deploy.sh': 'echo hi',
        'serve.mjs': 'export {};',
      },
      `export const base = 'plain';\nexport default ({ runs }) => [runs({ from: ['package.json', '.github'] })];`
    );
    expect(links(graph)).toEqual([
      '.github/workflows/ci.yml -> scripts/deploy.sh [runs] null',
      'package.json -> scripts/sim.mjs [runs] null',
      'package.json -> serve.mjs [runs] null',
    ]);
  });

  it('uses the adapter, with a warning, when a repo has both', async () => {
    const repo = makeRepo({
      'src/a.ts': 'export const a = 1;',
      '.sinopia/adapter.mjs':
        "export default (s, { repo, name }) => ({ ...s.folderAdapter(repo, { mode: 'plain', name }), interfaceVersion: 1, name: 'mine' });",
      [LOCAL_MAP]: 'export default () => [];',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { adapter } = await pickAdapter('auto', repo, 'fixture');
    expect(adapter.name).toBe('mine');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/both .*using the adapter/));
    warn.mockRestore();
  });
});
