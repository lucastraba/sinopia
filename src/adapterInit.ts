import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { ADAPTER_INTERFACE_VERSION } from './adapter.js';
import { listFiles } from './adapters/files.js';
import { chooseMode } from './adapters/folders.js';

/** Where a project keeps its own adapter. `sinopia` loads it by default when it exists. */
export const LOCAL_ADAPTER = '.sinopia/adapter.mjs';

export const adapterTemplate = (name: string, mode: 'js' | 'plain', date: string): string => `// Sinopia adapter for ${name}.
// Written by \`sinopia adapter init\` on ${date}, starting from the generic '${mode}'
// adapter, so the map works before anything here is tailored. Add what the
// generic scan can't see to addProjectLinks below, then run \`sinopia check\`.
// The interface: \`sinopia adapter docs\`.
//
// \`sinopia\` is the sinopia package's API (folderAdapter, addLink, listFiles,
// readText, ...), passed in so this file needs no install of its own.

export default function createAdapter(sinopia, { repo, name }) {
  const base = sinopia.folderAdapter(repo, { mode: '${mode}', name });
  return {
    ...base,
    interfaceVersion: ${ADAPTER_INTERFACE_VERSION},
    name: ${JSON.stringify(name)},
    async scan(input) {
      const graph = await base.scan(input);
      addProjectLinks(sinopia, graph, input);
      return graph;
    },
  };
}

/**
 * Links the generic scan misses: RPC calls, messages on a bus, generated
 * clients, routes, contracts with other repos. Put each on the file that makes
 * the call, pointing at the file that answers it:
 *
 *   const file = graph.files.find((f) => f.id === 'src/client/counter.ts');
 *   sinopia.addLink(file, { target: 'server/routers/counter.ts', kind: 'trpc', label: 'counter.increment' });
 *
 * Read files from input.root, not input.repo: diff scans older commits from a
 * snapshot. Targets must be file ids in graph.files, or check reports them.
 */
function addProjectLinks(sinopia, graph, input) {
  // Nothing yet: the map is the generic one.
}
`;

const NEXT_STEPS = (mode: 'js' | 'plain', file: string) => `
Wrote ${file}: the generic '${mode}' adapter, so \`sinopia scan\` and \`refresh\` work now
and use it from here on.

The interface (adapter interface v${ADAPTER_INTERFACE_VERSION}): a module whose default export is
(sinopia, { repo, name }) => adapter, where adapter has interfaceVersion, name,
scan(input) -> graph, partOf(path), snapshotPaths and describeContext(input).
Links the generic scan misses go on graph.files[i].links as { target, kind, label }.
Full text: sinopia adapter docs

What sinopia checks after every scan: each file sits in exactly one part, every
link points at a scanned file, operations and routes resolve. Errors fail
\`sinopia check\`; coverage shows how connected the map is.

Next steps:
  1. Read the interface: sinopia adapter docs
  2. Save a baseline:   sinopia check --adapter ${mode} --json > /tmp/sinopia-baseline.json
  3. Read the code for links the generic scan misses (RPC routes, message buses,
     generated clients, auto-imports, contracts with other repos) and add them
     in addProjectLinks.
  4. Run \`sinopia check\` until it passes and the coverage numbers stop improving
     (fewer isolated files, more part-to-part links, new link kinds).
  5. Commit ${file} with the repo.
`;

import { LOCAL_MAP } from './rules/index.js';

export const mapTemplate = (name: string, date: string): string => `// How ${name} connects, beyond imports. Written by \`sinopia map init\` on ${date}.
// Each rule says where to look and what the call looks like; sinopia does the
// matching. \`sinopia check\` shows what each rule found. All primitives and
// their options: \`sinopia map docs\`.
//
// A rule an agent wrote carries \`draft: true\` until a person confirms it.

export default ({ link, trpc, http, graphql, spawn, vitest, vueRoutes, vueComponents, globImports, pythonImports, dataFiles, runs, externalServices, external, custom }) => [
  // Example: events on a shared emitter, matched by name.
  // link({
  //   kind: 'event',
  //   in: 'src/server',
  //   call: 'bus.emit({key}',
  //   answer: 'bus.on({key}',
  //   why: 'Server modules tell each other about changes on one event bus.',
  // }),
];
`;

const MAP_NEXT_STEPS = (file: string) => `
Wrote ${file}. It has no rules yet, so the map is the generic one.

Next steps:
  1. Read the primitives:  sinopia map docs
  2. Save a baseline:      sinopia check --adapter auto --json > /tmp/sinopia-baseline.json
  3. Add a rule for each way the code connects that imports don't show
     (RPC, events, HTTP between your own apps, spawned processes, routes).
  4. Run \`sinopia check\` until it passes and the numbers stop improving.
     It lists what each rule found.
  5. Commit ${file} with the repo.
`;

export const mapInit = ({ repo, force }: { repo: string; force: boolean }): void => {
  const file = join(repo, LOCAL_MAP);
  if (existsSync(file) && !force) {
    console.error(`${file} already exists; --force replaces it.`);
    process.exitCode = 1;
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, mapTemplate(basename(repo), new Date().toISOString().slice(0, 10)));
  console.log(MAP_NEXT_STEPS(LOCAL_MAP));
  if (existsSync(join(repo, LOCAL_ADAPTER))) {
    console.log(`Note: ${LOCAL_ADAPTER} exists too, and wins while it does. Move what it adds into the map, then delete it.`);
  }
};

export const adapterInit = ({
  repo,
  mode,
  force,
}: {
  repo: string;
  mode: 'js' | 'plain' | null;
  force: boolean;
}): void => {
  const file = join(repo, LOCAL_ADAPTER);
  if (existsSync(file) && !force) {
    console.error(`${file} already exists; --force replaces it.`);
    process.exitCode = 1;
    return;
  }
  const chosen = mode ?? chooseMode(listFiles(repo));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, adapterTemplate(basename(repo), chosen, new Date().toISOString().slice(0, 10)));
  console.log(NEXT_STEPS(chosen, LOCAL_ADAPTER));
};
