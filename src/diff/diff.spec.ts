import type { FileNode, Graph, GraphMeta, Operation, Route } from '../model.js';
import { diffGraphs } from './diff.js';
import { formatDiff } from './format.js';

const SRC = 'packages/apps/web/src';

const file = (
  rel: string,
  part: string,
  extra: Partial<FileNode> = {}
): FileNode => ({
  id: `${SRC}/${rel}`,
  part,
  kind: 'component',
  lines: 10,
  hash: rel,
  imports: [],
  libraries: [],
  components: [],
  operations: [],
  flags: [],
  registeredAs: null,
  ...extra,
});

const operation = (
  name: string,
  fields: string[],
  hash: string
): Operation => ({
  name,
  type: 'query',
  file: `${SRC}/features/reports/api/reports.query.graphql`,
  part: 'features/reports',
  composable: `use${name}Query`,
  rootFields: [fields[0] ?? ''],
  fields,
  subgraphs: ['core'],
  allSubgraphs: ['core'],
  hash,
  document: '',
});

const route = (path: string, extra: Partial<Route> = {}): Route => ({
  path,
  name: null,
  component: `${SRC}/features/reports/components/ReportView.vue`,
  extraComponents: [],
  feature: null,
  flags: [],
  guards: [],
  redirect: null,
  definedIn: `${SRC}/features/folders/folders.route.ts`,
  ...extra,
});

const meta: GraphMeta = {
  title: 'Acme Map',
  srcDir: SRC,
  sourceLabel: 'the main app',
  groups: [],
  groupFlow: [],
  servicesLabel: 'Backend services',
  operationsLabel: 'GraphQL operations',
  boundary: { name: 'POC', label: 'POC boundary', partKinds: ['poc'] },
  library: { label: 'UI kit', package: '@acme/ui', componentPath: '^packages/libs/ui/src/components/(Ui\\w+)/' },
  hasLinks: true,
};

const partOf = (path: string): string | null => {
  const [top, second] = path.slice(SRC.length + 1).split('/');
  return top && second ? `${top}/${second}` : null;
};

const graph = (overrides: Partial<Graph>): Graph => ({
  version: 1,
  generatedAt: '',
  meta,
  source: { label: 'x', sha: 'abc' },
  backend: { sha: 'b', label: 'b' },
  parts: [],
  files: [],
  operations: [],
  routes: [],
  flags: [],
  subgraphs: [],
  cycles: [],
  gaps: [],
  ...overrides,
});

const base = graph({
  parts: [
    {
      id: 'features/reports',
      kind: 'feature',
      name: 'Reports',
      dir: '',
      files: [],
    },
  ],
  files: [
    file('features/reports/components/ReportView.vue', 'features/reports'),
    file('features/widgets/Chart.vue', 'features/widgets'),
  ],
  operations: [operation('report', ['Query.report', 'Report.id'], 'h1')],
  routes: [route('/report/:id')],
  flags: ['OLD_FLAG'],
});

const head = graph({
  parts: [
    ...base.parts,
    { id: 'poc/visualisation', kind: 'poc', name: 'POC', dir: '', files: [] },
  ],
  files: [
    file('features/reports/components/ReportView.vue', 'features/reports', {
      imports: [
        `${SRC}/features/widgets/Chart.vue`,
        `${SRC}/poc/visualisation/Visual.vue`,
      ],
      flags: ['NEW_FLAG'],
    }),
    file('features/widgets/Chart.vue', 'features/widgets'),
    file('poc/visualisation/Visual.vue', 'poc/visualisation'),
  ],
  operations: [
    operation('report', ['Query.report', 'Report.id', 'Report.name'], 'h2'),
    operation('reports', ['Query.reports'], 'h3'),
  ],
  routes: [
    route('/report/:id', { feature: 'Reports' }),
    route('/report/:id/print'),
  ],
  flags: ['NEW_FLAG'],
  cycles: [[`${SRC}/a.ts`, `${SRC}/b.ts`]],
});

describe('diffGraphs', () => {
  const diff = diffGraphs(
    base,
    head,
    `M\t${SRC}/features/reports/components/ReportView.vue\nA\tpackages/libs/ui/src/components/UiSelect/UiSelect.vue`,
    `${SRC}/poc/visualisation/Visual.vue`,
    { 'features/reports': 'adds a print view' },
    partOf
  );

  it('groups changed files by part and lists what changed outside the main app', () => {
    expect(
      diff.touchedParts.map((part) => [part.part, part.added, part.modified])
    ).toEqual([
      ['features/reports', [], ['features/reports/components/ReportView.vue']],
      ['poc/visualisation', ['poc/visualisation/Visual.vue'], []],
    ]);
    expect(diff.outsideMain).toEqual([
      {
        area: 'packages/libs/ui',
        files: ['packages/libs/ui/src/components/UiSelect/UiSelect.vue'],
      },
    ]);
    expect(diff.hdsComponents).toEqual([
      { name: 'UiSelect', usedByParts: [] },
    ]);
  });

  it('finds new links between parts, new cycles, and production reaching into a POC', () => {
    expect(
      diff.newPartLinks.map((link) => `${link.from} -> ${link.to}`)
    ).toEqual([
      'features/reports -> features/widgets',
      'features/reports -> poc/visualisation',
    ]);
    expect(diff.newCycles).toHaveLength(1);
    expect(diff.pocBoundary).toEqual([
      'production part features/reports now reaches POC part poc/visualisation (ReportView.vue -> Visual.vue)',
      'new POC part poc/visualisation',
    ]);
  });

  it('lists operation, route and flag changes', () => {
    expect(
      diff.operations.map((change) => [
        change.name,
        change.change,
        change.newFields,
      ])
    ).toEqual([
      ['report', 'changed', ['Report.name']],
      ['reports', 'added', ['Query.reports']],
    ]);
    expect(diff.routes.map((change) => [change.path, change.change])).toEqual([
      ['/report/:id', 'changed'],
      ['/report/:id/print', 'added'],
    ]);
    expect(diff.newFlags).toEqual(['NEW_FLAG']);
    expect(diff.removedFlags).toEqual(['OLD_FLAG']);
    expect(diff.flagUses).toEqual([
      { flag: 'NEW_FLAG', parts: ['features/reports'] },
    ]);
  });

  it('prints a short report with the notes next to their parts', () => {
    const text = formatDiff(diff);
    expect(text).toContain(
      'features/reports: 1 changed. Why: adds a print view'
    );
    expect(text).toContain('+ query reports (features/reports) served by core');
    expect(text).toContain(
      '~ /report/:id: was ReportView.vue, no entitlement; now ReportView.vue, entitlement Reports'
    );
  });
});
