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

  it('keeps a # inside a Python string, and the code after it, at the same offsets', () => {
    const py = 'label = "a # b"; ee.emit("paid")  # note';
    const out = stripPy(py);
    expect(out).toHaveLength(py.length);
    expect(out).toContain('label = "a # b"; ee.emit("paid")');
    expect(out).not.toContain('note');
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
    expect([...calledPaths(py)].sort()).toEqual(['/control/voice/roster', '/ingest/subtitle']);
  });

  it('counts a base variable only where code passes it on as it is', () => {
    const py = ['self._endpoint = f"{cfg.url}/control/voice"', 'self._client.get(\n  self._endpoint,\n)', 'BASE = f"{url}/api"', 'httpx.get(f"{BASE}/items")'].join('\n');
    expect([...calledPaths(py)].sort()).toEqual(['/api/items', '/control/voice']);
  });

  it('resolves each use with the base its name holds at that point', () => {
    const py = ['BASE = f"{url}/v1"', 'httpx.get(f"{BASE}/items")', 'BASE = f"{url}/v2"', 'httpx.get(f"{BASE}/items")', 'ITEMS = f"{BASE}/things"', 'httpx.get(ITEMS)'].join('\n');
    expect([...calledPaths(py)].sort()).toEqual(['/v1/items', '/v2/items', '/v2/things']);
  });

  it('takes the path of an interpolated call on a base it does not know', () => {
    expect([...calledPaths('httpx.post(f"{cfg.url}/control/voice")')]).toEqual(['/control/voice']);
    expect([...calledPaths('fetch(`${base}/api/x`)')]).toEqual(['/api/x']);
    expect([...calledPaths('httpx.get(url=f"{cfg.url}/health")')]).toEqual(['/health']);
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
    expect(report).toMatch(/Custom code: 1 of 2 links besides imports \(50\.0%\)/);
  });

  it('leaves imports out of the custom-code share', async () => {
    const graph = await scan(
      bus,
      `export const base = 'plain';
export default ({ link, custom }) => [
  link({ kind: 'event', in: 'src', call: 'ee.emit({key}', answer: 'ee.on({key}', wrappers: true }),
  custom({ name: 'stray', run: (ctx) => {
    ctx.addLink(ctx.byId.get('src/stray.ts'), { target: 'src/bus.ts', kind: 'uses', label: null });
    for (const id of ['src/bus.ts', 'src/mailer.ts', 'src/checkout.ts']) ctx.addImport(ctx.byId.get('src/stray.ts'), id);
  } }),
];`
    );
    expect(formatRules(graph.meta.rules ?? []).join('\n')).toMatch(/Custom code: 1 of 2 links besides imports \(50\.0%\)/);
  });

  it('counts only function bodies as helpers, so calls after them stay the file\'s own', async () => {
    const graph = await scan(
      {
        'src/bus.ts': [
          'export const bus = new EventEmitter();',
          "bus.emit('ready');",
          'export function emitDone(id) {',
          "  bus.emit('done', id);",
          '}',
          "bus.emit('started');",
          "export const emitLater = async (id): Promise<void> => { bus.emit('later', id); };",
        ].join('\n'),
        'src/app.ts': "import { emitDone } from './bus';\nemitDone(1);",
        'src/listen.ts': "bus.on('ready', f);\nbus.on('done', f);\nbus.on('started', f);\nbus.on('later', f);",
      },
      `export const base = 'plain';\nexport default ({ link }) => [link({ kind: 'event', in: 'src', call: 'bus.emit({key}', answer: 'bus.on({key}', wrappers: true })];`
    );
    expect(links(graph)).toEqual([
      'src/app.ts -> src/listen.ts [event] done',
      'src/bus.ts -> src/listen.ts [event] ready',
      'src/bus.ts -> src/listen.ts [event] started',
    ]);
  });

  it('keeps helpers with the same name in two files apart', async () => {
    const graph = await scan(
      {
        'package.json': '{}',
        'src/a.ts': "export const notify = () => ee.emit('a.done');",
        'src/b.ts': "export const notify = () => ee.emit('b.done');",
        'src/useA.ts': "import { notify } from './a';\nnotify();",
        'src/useB.ts': "import { notify } from './b';\nnotify();",
        'src/listen.ts': "ee.on('a.done', f);\nee.on('b.done', f);",
      },
      `export const base = 'js';\nexport default ({ link }) => [link({ kind: 'event', in: 'src', call: 'ee.emit({key}', answer: 'ee.on({key}', wrappers: true })];`
    );
    expect(links(graph)).toEqual(['src/useA.ts -> src/listen.ts [event] a.done', 'src/useB.ts -> src/listen.ts [event] b.done']);
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
    expect(links(graph)).toEqual(['client/sync.py -> server/main.ts [http] /health', 'client/sync.py -> server/main.ts [http] POST /api/items']);
    expect(graph.gaps.filter((g) => g.kind === 'unmatched-http').map((g) => g.detail)).toEqual(['/api/missing matches no server route']);
  });

  it('takes routes declared by a regular expression, and an empty scope as the whole repo', async () => {
    const graph = await scan(
      {
        'server/main.ts': "app.get('/api/items', f);",
        'client/sync.py': 'import httpx\nhttpx.get(f"{cfg.url}/api/items")',
      },
      `export const base = 'plain';
export default ({ http }) => [http({ server: 'server', clients: '', routes: /app\\.(?<method>get|post)\\('(?<path>[^']+)'/ })];`
    );
    expect(links(graph)).toEqual(['client/sync.py -> server/main.ts [http] GET /api/items']);
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

  it('roots tRPC paths only at routers nothing uses, at any depth', async () => {
    const graph = await scan(
      {
        'server/leaf.ts': 'export const leaf = t.router({ ping: t.procedure.query(() => 1) });',
        // After leaf.ts, so leaf is seen before the router that uses it.
        'server/root.ts': 'export const appRouter = t.router({ api: t.router({ leaf: leaf }) });',
        'app/call.ts': "import { trpc } from './trpc';\ntrpc.api.leaf.ping.query();\ntrpc.ping.query();",
      },
      `export const base = 'plain';\nexport default ({ trpc }) => [trpc({ routers: 'server', connection: false })];`
    );
    expect(links(graph)).toEqual(['app/call.ts -> server/leaf.ts [trpc] api.leaf.ping']);
    expect(graph.gaps.find((g) => g.kind === 'unmatched-trpc')?.detail).toMatch(/^trpc\.ping\.query /);
  });

  it('reads the tRPC client name and mount path literally', async () => {
    const graph = await scan(
      {
        'server/router.ts': 'export const appRouter = t.router({ ping: t.procedure.query(() => 1) });',
        'server/main.ts': "const handler = createHTTPHandler({ router });\nif (req.url?.startsWith('/trpc(v1)')) { handler(req, res); }",
        'app/client.ts': "export const $trpc = createTRPCClient({ links: [httpBatchLink({ url: '/trpc(v1)' })] });",
        'app/call.ts': "import { $trpc } from './client';\n$trpc.ping.query();",
      },
      `export const base = 'plain';\nexport default ({ trpc }) => [trpc({ routers: 'server', client: '$trpc' })];`
    );
    expect(links(graph)).toEqual([
      'app/call.ts -> server/router.ts [trpc] ping',
      'app/client.ts -> server/main.ts [http] /trpc(v1) (tRPC over HTTP)',
    ]);
  });

  it('links Python imports by name: aliases, and a package next to its submodules', async () => {
    const graph = await scan(
      {
        'app/main.py': 'from pkg import helper, VERSION\nimport alpha as a, beta as b\n',
        'app/pkg/__init__.py': 'VERSION = 1',
        'app/pkg/helper.py': 'x = 1',
        'app/alpha.py': 'x = 1',
        'app/beta.py': 'x = 1',
      },
      `export const base = 'plain';\nexport default ({ pythonImports }) => [pythonImports()];`
    );
    expect(graph.files.find((f) => f.id === 'app/main.py')?.imports.sort()).toEqual(['app/alpha.py', 'app/beta.py', 'app/pkg/__init__.py', 'app/pkg/helper.py']);
  });

  it('notes a URL constant passed to fetch as it is', async () => {
    const graph = await scan(
      { 'src/api.ts': "const API = 'https://example.com';\nexport const load = () => fetch(API);" },
      `export const base = 'plain';\nexport default ({ externalServices }) => [externalServices({ names: { Example: 'example.com' } })];`
    );
    expect(graph.gaps.filter((g) => g.kind === 'external-service').map((g) => g.detail)).toEqual(['fetch https://example.com / (Example)']);
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

  it('warns about a data import even when no data file exists yet', async () => {
    const graph = await scan(
      { 'package.json': '{}', 'src/load.ts': "import missing from '../content/missing.yaml';" },
      `export const base = 'js';\nexport default ({ dataFiles }) => [dataFiles({ in: 'content', extensions: ['yaml'] })];`
    );
    expect(graph.gaps.find((g) => g.kind === 'unresolved-data-import')?.file).toBe('src/load.ts');
  });

  it('lets one runner name another, and takes extensionless paths with a slash', async () => {
    const graph = await scan(
      {
        'build.xml': '<exec>deploy.xml</exec>',
        'deploy.xml': '<exec>bash bin/deploy</exec>',
        'bin/deploy': '#!/bin/sh\necho deploy',
      },
      `export const base = 'plain';\nexport default ({ runs }) => [runs({ from: ['build.xml', 'deploy.xml'] })];`
    );
    expect(links(graph)).toEqual(['build.xml -> deploy.xml [runs] null', 'deploy.xml -> bin/deploy [runs] null']);
  });

  it('gives a custom rule null for a file it cannot read', async () => {
    const graph = await scan(
      { 'src/a.ts': 'export const a = 1;' },
      `export const base = 'plain';\nexport default ({ custom }) => [custom({ name: 'probe', run: (ctx) => { if (ctx.addFile('optional.json') !== null) throw new Error('expected null'); ctx.addGap({ kind: 'probe', level: 'info', file: null, detail: 'went on' }); } })];`
    );
    expect(graph.gaps.find((g) => g.kind === 'rule-failed')).toBeUndefined();
    expect(graph.gaps.find((g) => g.kind === 'probe')?.detail).toBe('went on');
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
