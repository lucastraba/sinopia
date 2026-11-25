import type { FileNode, Graph, Operation, Route } from '../model';
import { appModel, partModel, screenModel } from './graphs';
import { buildIndex } from './mapIndex';

const SRC = 'packages/apps/web/src';

const file = (
  rel: string,
  part: string,
  extra: Partial<FileNode> = {}
): FileNode => ({
  id: `${SRC}/${rel}`,
  part,
  kind: rel.endsWith('View.vue')
    ? 'view'
    : rel.endsWith('.vue')
      ? 'component'
      : 'composable',
  lines: 1,
  hash: rel,
  imports: [],
  libraries: [],
  components: [],
  operations: [],
  flags: [],
  registeredAs: null,
  ...extra,
});

const use = (rel: string, byName = false) => ({
  tag: rel,
  target: `${SRC}/${rel}`,
  library: null,
  byName,
});

const operation: Operation = {
  name: 'report',
  type: 'query',
  file: `${SRC}/features/reports/api/reports.query.graphql`,
  part: 'features/reports',
  composable: 'useReportQuery',
  rootFields: ['Query.report'],
  fields: ['Query.report'],
  subgraphs: ['core'],
  allSubgraphs: ['core'],
  hash: 'h',
  document: '',
};

const route: Route = {
  path: '/report/:id',
  name: 'report',
  component: `${SRC}/features/reports/ReportView.vue`,
  extraComponents: [],
  feature: null,
  flags: [],
  guards: [],
  redirect: null,
  definedIn: `${SRC}/features/folders/folders.route.ts`,
};

const graph: Graph = {
  version: 1,
  generatedAt: '',
  meta: {
    title: 'Test map',
    srcDir: SRC,
    sourceLabel: 'the main app',
    groups: [{ kind: 'feature', label: 'Features' }],
    groupFlow: [['feature', 'services']],
    servicesLabel: 'Backend services',
    operationsLabel: 'GraphQL operations',
    boundary: null,
    library: null,
    hasLinks: true,
  },
  source: { label: 'test', sha: null },
  backend: { sha: 'b', label: 'b' },
  parts: [
    {
      id: 'features/reports',
      kind: 'feature',
      name: 'Reports',
      dir: '',
      files: [
        `${SRC}/features/reports/ReportView.vue`,
        `${SRC}/features/reports/ReportGrid.vue`,
        `${SRC}/features/reports/useReportsStore.ts`,
      ],
    },
    {
      id: 'features/widgets',
      kind: 'feature',
      name: 'Widgets',
      dir: '',
      files: [
        `${SRC}/features/widgets/ChartWidget.vue`,
        `${SRC}/features/widgets/ChartAxis.vue`,
      ],
    },
  ],
  files: [
    file('features/reports/ReportView.vue', 'features/reports', {
      components: [use('features/reports/ReportGrid.vue')],
      imports: [`${SRC}/features/reports/useReportsStore.ts`],
    }),
    file('features/reports/ReportGrid.vue', 'features/reports', {
      components: [use('features/widgets/ChartWidget.vue', true)],
    }),
    file('features/reports/useReportsStore.ts', 'features/reports', {
      operations: ['report'],
    }),
    file('features/widgets/ChartWidget.vue', 'features/widgets', {
      components: [use('features/widgets/ChartAxis.vue')],
    }),
    file('features/widgets/ChartAxis.vue', 'features/widgets'),
  ],
  operations: [operation],
  routes: [route],
  flags: [],
  subgraphs: [{ name: 'core', sources: [] }],
  cycles: [],
  gaps: [],
};

const index = buildIndex(
  graph,
  { app: null, parts: {}, files: {}, operations: {}, runs: [] },
  null
);
const ids = (model: { nodes: { id: string }[] }) =>
  model.nodes.map((node) => node.id).sort();

describe('screenModel', () => {
  it('follows rendered components, including ones opened by name, down to the depth asked', () => {
    const model = screenModel(index, route, 2, 'plain');
    expect(ids(model)).toEqual([
      `file:${SRC}/features/reports/ReportGrid.vue`,
      `file:${SRC}/features/reports/ReportView.vue`,
      `file:${SRC}/features/widgets/ChartWidget.vue`,
      'operation:report',
      'subgraph:core',
    ]);
    expect(
      model.nodes.find((node) => node.id.endsWith('ChartWidget.vue'))?.badge
    ).toBe('+1');
    expect(
      model.edges.find((edge) => edge.to.endsWith('ChartWidget.vue'))?.dashed
    ).toBe(true);
  });

  it('credits a component with the server calls its shared logic makes, and shows that logic to developers', () => {
    const plain = screenModel(index, route, 1, 'plain');
    expect(plain.edges.map((edge) => `${edge.from} -> ${edge.to}`)).toContain(
      `file:${SRC}/features/reports/ReportView.vue -> operation:report`
    );
    const dev = screenModel(index, route, 1, 'dev');
    expect(ids(dev)).toContain(
      `file:${SRC}/features/reports/useReportsStore.ts`
    );
  });
});

describe('partModel', () => {
  it('shows the part files, the parts it uses as one card each, and the services behind its calls', () => {
    expect(ids(partModel(index, 'features/reports', 'plain'))).toEqual([
      `file:${SRC}/features/reports/ReportGrid.vue`,
      `file:${SRC}/features/reports/ReportView.vue`,
      `file:${SRC}/features/reports/useReportsStore.ts`,
      'operation:report',
      'part:features/widgets',
      'subgraph:core',
    ]);
  });
});

describe('appModel', () => {
  it('links parts to each other and to the services their calls reach', () => {
    expect(appModel(index, 'plain').edges.map((edge) => edge.id)).toEqual([
      'part:features/reports->part:features/widgets',
      'part:features/reports->subgraph:core',
    ]);
  });
});

describe('server calls', () => {
  it('counts graphql, trpc and http links as server calls, once per name, and opens the file that answers them', () => {
    const callGraph: Graph = {
      ...graph,
      files: [
        ...graph.files,
        file('features/widgets/useTodos.ts', 'features/widgets', {
          links: [
            { target: `${SRC}/features/widgets/todos.graphql`, kind: 'graphql', label: 'todos' },
            { target: `${SRC}/features/widgets/router.ts`, kind: 'trpc', label: 'todo.add' },
            { target: `${SRC}/features/widgets/router.ts`, kind: 'trpc', label: 'todo.add' },
            { target: `${SRC}/features/widgets/server.ts`, kind: 'http', label: 'POST /todos' },
            { target: `${SRC}/features/widgets/bus.ts`, kind: 'event', label: 'todo.added' },
          ],
        }),
      ],
    };
    const callIndex = buildIndex(
      callGraph,
      { app: null, parts: {}, files: {}, operations: {}, runs: [] },
      null
    );
    expect([...(callIndex.partOperations.get('features/widgets') ?? [])].sort()).toEqual(['POST /todos', 'todo.add', 'todos']);
    expect(callIndex.serverCalls.get('todo.add')).toEqual({ name: 'todo.add', kind: 'trpc', target: `${SRC}/features/widgets/router.ts` });
    expect(
      appModel(callIndex, 'plain').nodes.find((node) => node.id === 'part:features/widgets')?.sublabel
    ).toBe('2 files · 3 server calls');
  });
});
