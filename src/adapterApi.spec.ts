import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ADAPTER_INTERFACE_VERSION,
  AdapterVersionError,
  assertAdapterVersion,
} from './adapter.js';
import { adapterInit, LOCAL_ADAPTER } from './adapterInit.js';
import { runCli } from './cli.js';
import { coverageOf } from './coverage.js';
import { pickAdapter } from './loadAdapter.js';
import { validateGraph } from './validate.js';

const repos: string[] = [];
afterAll(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

const makeRepo = (files: Record<string, string>): string => {
  const repo = mkdtempSync(join(tmpdir(), 'sinopia-api-'));
  repos.push(repo);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: repo });
  return repo;
};

const JS_REPO = {
  'package.json': '{"name":"demo","type":"module"}',
  'client/counter.ts': "export const bump = () => fetch('/trpc/counter.increment');\n",
  'client/index.ts': "import { bump } from './counter';\nbump();\n",
  'server/counter.ts': 'export const counterRouter = { increment: () => 1 };\n',
  'server/index.ts': "import { counterRouter } from './counter';\nexport const app = counterRouter;\n",
};

const scan = async (repo: string, choice = 'auto') => {
  const { adapter } = await pickAdapter(choice, repo, 'demo');
  const graph = await adapter.scan({ repo, root: repo, artifacts: join(repo, '.map'), source: { label: 'test', sha: null } });
  graph.gaps.push(...validateGraph(graph));
  return graph;
};

describe('assertAdapterVersion', () => {
  it('accepts the current version and says how to fix any other', () => {
    expect(() => assertAdapterVersion({ interfaceVersion: ADAPTER_INTERFACE_VERSION }, 'x')).not.toThrow();
    expect(() => assertAdapterVersion({}, 'x')).toThrow(/declares no interfaceVersion.*Changes between versions/);
    expect(() => assertAdapterVersion({ interfaceVersion: 0 }, 'x')).toThrow(/v0; this sinopia needs v1/);
    expect(() => assertAdapterVersion({ interfaceVersion: 99 }, 'x')).toThrow(/Update sinopia/);
  });

  it('stops the CLI before it scans', async () => {
    const repo = makeRepo(JS_REPO);
    const { adapter } = await pickAdapter('js', repo, 'demo');
    await expect(
      runCli({ adapter: { ...adapter, interfaceVersion: 0 }, repo, out: join(repo, '.map'), argv: ['scan'], command: 'sinopia', diffBase: null })
    ).rejects.toBeInstanceOf(AdapterVersionError);
  });
});

describe('project adapters', () => {
  it('scaffolds an adapter that maps the repo like the generic one', async () => {
    const repo = makeRepo(JS_REPO);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    adapterInit({ repo, mode: null, force: false });
    log.mockRestore();
    expect(readFileSync(join(repo, LOCAL_ADAPTER), 'utf8')).toContain(`interfaceVersion: ${ADAPTER_INTERFACE_VERSION}`);
    const { adapter, source } = await pickAdapter('auto', repo, 'demo');
    expect(source).toBe(join(repo, LOCAL_ADAPTER));
    const generic = await scan(repo, 'js');
    const local = await scan(repo);
    expect(local.files.map((file) => file.id)).toEqual(generic.files.map((file) => file.id));
    expect(adapter.interfaceVersion).toBe(ADAPTER_INTERFACE_VERSION);
  });

  it('counts the links an adapter adds, and reports ones that point nowhere', async () => {
    const repo = makeRepo({
      ...JS_REPO,
      [LOCAL_ADAPTER]: `export default (sinopia, { repo, name }) => {
  const base = sinopia.folderAdapter(repo, { mode: 'js', name });
  return { ...base, interfaceVersion: ${ADAPTER_INTERFACE_VERSION}, async scan(input) {
    const graph = await base.scan(input);
    const file = graph.files.find((f) => f.id === 'client/counter.ts');
    sinopia.addLink(file, { target: 'server/counter.ts', kind: 'trpc', label: 'counter.increment' });
    sinopia.addLink(file, { target: 'server/counter.ts', kind: 'trpc', label: 'counter.increment' });
    sinopia.addLink(file, { target: 'server/missing.ts', kind: 'trpc', label: 'counter.reset' });
    return graph;
  } };
};
`,
    });
    const before = coverageOf(await scan(repo, 'js'), 'js');
    const graph = await scan(repo);
    const after = coverageOf(graph, 'local');
    expect(before.links).toEqual({ import: 2 });
    expect(after.links).toEqual({ import: 2, trpc: 2 });
    expect(after.partLinks).toBe(before.partLinks + 1);
    expect(after.passes).toBe(false);
    expect(graph.gaps.find((gap) => gap.level === 'error')?.detail).toMatch(/trpc link to server\/missing.ts/);
  });
});

describe('coverageOf', () => {
  it('reports isolated code files, ignoring docs and links from tests', async () => {
    const repo = makeRepo({
      ...JS_REPO,
      'scripts/lonely.ts': 'export const lonely = 1;\n',
      'scripts/lonely.spec.ts': "import { lonely } from './lonely';\n",
    });
    const coverage = coverageOf(await scan(repo, 'js'), 'js');
    expect(coverage.isolated.examples).toEqual(['scripts/lonely.ts']);
    expect(coverage.isolated.count).toBe(1);
    expect(coverage.codeFiles).toBe(5);
    expect(coverage.tests).toBe(1);
    expect(coverage.passes).toBe(true);
  });
});

describe('validateGraph without a scanned count', () => {
  const node = (id: string, part: string) => ({
    id, part, kind: 'other' as const, lines: 1, hash: 'h',
    imports: [], libraries: [], components: [], operations: [], flags: [], registeredAs: null,
  });
  const graph = (files: ReturnType<typeof node>[], parts: { id: string; files: string[] }[]) =>
    ({ files, parts: parts.map((part) => ({ ...part, kind: 'folder', name: part.id, dir: part.id })), gaps: [], operations: [], routes: [] }) as never;

  it('accepts part members without a file node, like GraphQL documents', () => {
    const gaps = validateGraph(graph([node('src/a.ts', 'src')], [{ id: 'src', files: ['src/a.ts', 'src/a.graphql'] }]));
    expect(gaps).toEqual([]);
  });

  it('reports a file node that no part holds', () => {
    const gaps = validateGraph(graph([node('src/a.ts', 'src'), node('lost.ts', 'x')], [{ id: 'src', files: ['src/a.ts'] }]));
    expect(gaps.map((gap) => gap.detail)).toEqual(['lost.ts is in no part']);
  });
});
