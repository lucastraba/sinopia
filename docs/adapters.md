# Sinopia adapters

An adapter turns a repo's code into the graph that sinopia describes, diffs and draws. Sinopia ships two generic ones and leaves the rest to the project: each repo can carry its own adapter, written by its developers or their agent, that knows the links the generic scan can't see. Nobody maintains a list of supported stacks.

This file is the interface. `sinopia adapter docs` prints it.

**Current version: 1.** Every adapter declares the version it was written for (`interfaceVersion`). Sinopia refuses an adapter with another version and says how to upgrade it; "Changes between versions" at the end lists what each version changed.

## Where an adapter lives

- **Generic:** `--adapter js` reads folders as parts and follows JS/TS imports with dependency-cruiser; shell, Python and Lua files and shebang scripts are listed without links. `--adapter plain` lists folders and files with no links, for repos in other languages. `--adapter auto` (the default) picks `js` when most code is JS/TS and there's a `package.json`, else `plain`.
- **A project's own:** `.sinopia/adapter.mjs` in the repo. Under `--adapter auto`, sinopia uses it whenever it exists, for `scan`, `check`, `describe`, `diff` and `refresh`. `sinopia adapter init` writes one that starts from the generic adapter, so the map works at once and tailoring is an upgrade. Commit it with the repo.
- **A file elsewhere:** `--adapter path/to/adapter.mjs`.
- **A package with its own CLI:** a project can also depend on sinopia and call `runCli({ adapter, repo, out, argv, command, diffBase })` from its own command, as Helu's frontend does (below).

## The module

```js
// .sinopia/adapter.mjs
export default function createAdapter(sinopia, { repo, name }) {
  const base = sinopia.folderAdapter(repo, { mode: 'js', name });
  return {
    ...base,
    interfaceVersion: 1,
    name: 'my-app',
    async scan(input) {
      const graph = await base.scan(input);
      // add what the generic scan misses
      return graph;
    },
  };
}
```

The default export takes `sinopia`, the package's API, and `{ repo, name }` (the repo's absolute path and the map's name). It returns the adapter, or a promise of it. Because sinopia passes its API in, the file needs no `npm install` and no import of `sinopia`. Plain JavaScript (`.mjs`) keeps it loadable without a build step.

## The adapter

| Field | What it is |
|---|---|
| `interfaceVersion` | The interface version the adapter implements: `1`. |
| `name` | Shown in `check` and in errors. |
| `scan(input)` | Builds the graph (below). Async. |
| `partOf(path)` | The part id a repo-relative path belongs to, or null. `diff` uses it for changed files neither graph holds (deleted files, files outside the scan). |
| `snapshotPaths` | The paths `diff` exports with `git archive` to scan an older commit, or `null` for the whole tree. List only what the scan reads, for speed on big repos. |
| `describeContext(input)` | Background for `describe`: `{ rules, backgroundLabel, background, overviewLabel, overview }`. `rules` is the writing guide (`sinopia.personalRules(name)` for a generic one, or `sinopia.writingRules({...})` with the project's words); `background` is usually the README. Spread `base` to keep the generic one. |

`scan(input)` gets `{ repo, root, artifacts, source }`:

- `root` is where to read files. For the working tree it's the repo; for `diff` it's a snapshot of an older commit. **Read from `root`, never from `repo`**, or a diff compares today's code with itself.
- `artifacts` is a folder the adapter may use for caches and scratch files.
- `source` goes into `graph.source` unchanged.

## The graph

The full model, with comments, is `src/model.ts`. What an adapter fills:

- **`parts`**: `{ id, kind, name, dir, files }`. Every file in exactly one part. `kind` is free text, and `meta.groups` lists the kinds in display order with their headings.
- **`files`**: one `FileNode` per mapped file. `id` is the repo-relative path. `kind` is one of `view component composable store api route type util locale test generated script doc config other`; tests and generated files are mapped but not described. `hash` is the content hash (`sinopia.sha1(text)`), which keys the description cache. `imports` holds file ids. `components` holds rendered components (`{ tag, target, library, byName }`). `operations` holds the names of server operations the file calls.
- **`links`** on a file: everything else that connects it to another file, as `{ target, kind, label }`. `kind` names the mechanism (`trpc`, `ws-event`, `queue`, `generated-client`); `label` says what crosses it (`counter.increment`). Put the link on the file that starts the call and point it at the file that answers. Use `sinopia.addLink(file, link)`, which skips duplicates. The viewer draws links as edges and lists them under "Other links"; `describe` tells the model about them; `diff` counts them between parts.
- **`operations`**, **`subgraphs`**, **`backend`**: server operations (GraphQL documents, for example) with the backend services that answer them.
- **`routes`**: screens, `{ path, name, component, extraComponents, feature, flags, guards, redirect, definedIn }`. The viewer's "Screens" view starts from these.
- **`meta`**: the map's title, part groups (`groups`, `groupFlow`), labels, an optional `boundary` (part kinds production code must not depend on) and `library` (a component library whose changes `diff` maps to the parts that use them). `hasLinks: false` hides edges; sinopia sets it to true when any file has `links`.
- **`gaps`**: what the adapter couldn't place, as `{ kind, level, file, detail }`. Report problems here rather than dropping them: `error` fails `check`, `warning` and `info` show in the viewer's scan notes.

## Rules

1. Don't call `validateGraph` yourself; sinopia runs it on every scan.
2. Every link target must be a file id in `graph.files`. A link to anything else is an error.
3. Read from `input.root`.
4. Keep `scan` deterministic and fast: no network, no model calls, no clock in the output except `generatedAt`. Sinopia's only model call is `describe`.
5. Prefer finding links in the code that declares them (a router definition, a client call, an event name) over guessing from file names. When a call can't be matched, add a gap instead of a guess.

## Checks and coverage

`sinopia check` scans without saving and prints two things.

The errors: every file in exactly one part, every link and import resolving to a scanned file, unique operation names, operations and route components resolving. Any error makes `check` exit 1.

The coverage, the same numbers for the same code every time:

- files mapped, code files, tests, parts, and the largest part;
- files no part claims;
- **isolated code files**: code files with no link in or out, with the first examples (links from tests don't count);
- unresolved imports and links;
- **links by kind** (`import`, `component`, `operation`, and every kind the adapter adds);
- **part-to-part links**: distinct pairs of parts with at least one link;
- routes and server operations.

`sinopia check --json` prints the same as JSON, with the gap list. Compare an adapter against the generic one with `sinopia check --adapter js --json`. A good adapter passes, isolates fewer files, adds link kinds, and connects parts the generic one leaves apart. Isolated files that really stand alone (a one-off script, a config read at runtime) are fine; isolated files the app calls through a mechanism the adapter doesn't know are the work.

## Worked example: Helu's frontend

Helu's frontend is a Vue 3 monorepo with a GraphQL backend of several services. Its adapter lives in the frontend repo (`packages/tools/map`), depends on sinopia by commit, and calls `runCli` from its own `pnpm map` command. It's the reference for an adapter that goes far beyond the generic one. This summary is written from what it puts into the graph; the code is the authority.

- **Parts from feature folders.** The main app's `src/features/<name>` folders are parts of kind `feature`, proof-of-concept folders are `poc`, and app shell and core folders get their own kinds. `meta.groups` gives each kind a heading, and `meta.boundary` marks POC parts as something production code must not import, so `diff` flags a new link into one.
- **Imports with the repo's own resolver.** `sinopia.cruiseWithRepoConfig` runs dependency-cruiser with the frontend's own config, so path aliases resolve. Imports of the design system package become `libraries`, not links.
- **SFC templates.** It parses each `.vue` template and turns the tags into `components`: a tag that matches an import resolves to that file, a design system tag to the library (`meta.library` lets `diff` map a design system change to the parts using it), and components opened by name at runtime get `byName: true`, with `registeredAs` on the target.
- **Routes.** It reads the router definitions into `routes`, with the component each mounts, the entitlement it needs (`feature`), the feature flags its guards check, and redirects. The "Screens" view and the plain descriptions use them.
- **GraphQL operations.** Each query, mutation and subscription document becomes an `operation`, attached to the file that calls it through its generated composable. Its root fields are resolved against the federated schema.
- **Backend subgraphs.** It reads the schema from the backend repo at a known commit (`graph.backend`), so each operation knows which services answer its root fields (`subgraphs`) and which serve any field it selects (`allSubgraphs`). The overview draws parts calling services.
- **Its own gaps.** An operation whose composable is missing, a route component that doesn't resolve, a field the schema doesn't know: each becomes a gap with the file, so the map never hides what it couldn't follow.
- **Describe context.** `writingRules` with Helu's words: who reads the map, the product's nouns, the code words to avoid in plain text.

A personal repo rarely needs all that. The usual tailoring is a few dozen lines in `.sinopia/adapter.mjs`: find the calls that cross a boundary imports don't show (RPC, sockets, queues, generated clients, routes, other repos) and add them as `links`.

## The API an adapter gets

`sinopia` (the first argument of the module's default export) has:

- adapters: `folderAdapter(repo, { mode: 'js' | 'plain', name })`, `autoAdapter(repo, name)`, `chooseMode(files)`;
- files: `listFiles(root)` (tracked and untracked-but-not-ignored, minus build and dependency folders), `readText(path, maxBytes)` (null for binaries and big files), `sha1(text)`, `readmeOf(repo)`, `fileKindOf(path)`, `folderPartsOf(files)`, `folderPartOf(path, parts)`, `packageDirsOf(files)`;
- imports: `cruiseWithoutConfig(cwd, targets, scratch, options)`, `cruiseWithRepoConfig(repo, cwd, targets, config, options)`, `CODE_FILE`;
- links: `addLink(file, link)`, `fileLinks(file)`, `linkTargets(file)`;
- checks: `validateGraph(graph, count)`, `coverageOf(graph, name)`, `ADAPTER_INTERFACE_VERSION`;
- describe: `personalRules(name)`, `writingRules(options)`.

## Changes between versions

### Unversioned to 1 (2026-11-21)

- Add `interfaceVersion: 1` to the adapter.
- Stop calling `validateGraph` in `scan`: sinopia runs it on every scan now, so calling it too reports every problem twice.
- New and optional: `links` on a `FileNode` for links that aren't imports or components. Nothing has to change for it, but it's the place for RPC calls and the like, which used to have no home.
- A project adapter can live in `.sinopia/adapter.mjs` and be loaded by the `sinopia` command. Adapters that call `runCli` from their own CLI keep working once they declare the version.
