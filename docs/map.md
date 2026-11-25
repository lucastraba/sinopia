# Sinopia map rules

The generic scan sees folders and imports. Most codebases also connect in ways imports don't show: a client calls a server procedure by name, a module emits an event another one listens for, a Python process posts to a Node server. A map file tells sinopia where those connections are, one rule per mechanism, and sinopia does the parsing and matching.

The file is `.sinopia/map.mjs` in the repo. It's meant to be read in review: each rule says where to look, what the call looks like in the code, and why the rule exists. `sinopia map docs` prints this page; `sinopia map init` writes an empty map.

```js
// .sinopia/map.mjs
export default ({ trpc, link, http }) => [
  trpc({
    routers: 'apps/server/src',
    why: 'The web app talks to the server only through tRPC.',
  }),
  link({
    kind: 'event',
    in: 'apps/server/src',
    call: 'ee.emit({key}',
    answer: ['ee.on({key}', 'on(ee, {key}'],
    wrappers: true,
    labels: 'constants',
    why: 'Server modules tell each other about changes on one EventEmitter.',
  }),
  http({
    server: 'apps/server/src',
    clients: 'apps/worker',
    routes: ["app.{method}({path}"],
    why: 'The Python worker reports to the server over HTTP.',
  }),
];
```

The default export gets the primitives and returns the rules, in the order they run. The file needs no install: sinopia passes the primitives in. `export const base = 'js'` (or `'plain'`) picks the generic adapter the rules build on; without it, sinopia picks by the code, as `--adapter auto` does.

## Where things are: scopes

`in`, `from`, `to`, `routers`, `server`, `clients`, `documents` and `dirs` take a repo-relative folder or file, or a list of them: `'apps/server/src'`, `['apps/web', 'apps/admin']`. Leave `in` out for the whole repo. Rules never look at tests.

A scope can also be a glob pattern, for files that share a shape rather than a folder: `'**/*Locales.ts'`, `'apps/*/src'`, `'src/**/api/*.graphql'`. `**` is any number of folders, `*` anything but a slash, `{a,b}` either. A folder the pattern matches counts with everything in it.

## How rules find files: imports and aliases

Wherever a rule follows an import specifier (a route's lazy screen, a component in `components.d.ts`, a glob pattern, a data file), it resolves it the way the project's own tools do, the same for every primitive:

- relative paths, with the extensions and `index` files TypeScript and Vite try, and `./x.js` for `x.ts`;
- `paths` from the nearest `tsconfig.json` (or `jsconfig.json`), through its `extends` chain and the configs it `references`, as Nx workspaces and Vite templates write them;
- `resolve.alias` from the nearest `vite.config`, object or `[{ find, replacement }]` form; a leading `/` is the Vite root;
- the workspace's own packages by the name in their `package.json`, with subpaths.

Each file uses the configs nearest to it, so two apps with their own `@/` stay apart.

## What the code looks like: templates

A call shape is the code you'd search for, with placeholders:

- `{key}` (or any `{name}`) captures a string literal (`'x'`, `"x"`, `` `x` ``) or an identifier, dotted ones whole: in `ipcRenderer.invoke(IPC.readSaves)`, the key is `IPC.readSaves`.
- `{*}` skips anything up to the next part of the template, on the same line: `'bus.publish({*}, {key})'`.

Whitespace may appear between any two parts of the code, so `'ee.emit({key}'` also matches `ee.emit( FOO`. A space between two words in the template means at least one space. A template that starts or ends with a word matches whole words only: `'ee.emit('` never matches `free.emit(`, and `{key}` never matches half a name.

TypeScript type arguments between a name and its call are skipped: `'provide({key}'` also matches `app.provide<Theme>(THEME_KEY`.

Several shapes go in a list. Where two shapes match the same code, the one listed first wins, so list the longer one first.

A regular expression works too, with named groups as the values (`/emit\((?<key>[A-Z_]+)/`). `check` counts them, because the next reader has to decode them.

## Every rule takes

- `why`: one sentence on why the rule exists. `check` prints it next to what the rule found.
- `draft: true`: an agent wrote the rule and nobody has confirmed it. `check` lists drafts. Confirm a rule by deleting the line; that one-line diff is the review.

A misspelled option fails the scan with the list of options the primitive takes. A rule that throws becomes a `rule-failed` error in `check`, with its stack, and the other rules still run.

## Primitives

### `link`: anything matched by a name

Most mechanisms are a call on one side and a handler on the other, matched by a name that crosses: an event, a message type, a queue topic, a command.

| Option | |
|---|---|
| `kind` | What crosses, as the map labels the link: `event`, `ws-event`, `queue`, `command`. |
| `in` | Where both sides live. `from` and `to` narrow it per side. |
| `call` | The calling shape(s), with `{key}`. Leave it out when files use the name without a call (a global exposed by name, a registry looked up by name): then a whole-word mention of a key the answering side declares counts. |
| `answer` | The answering shape(s), with the same `{key}`. |
| `wrappers` | `true`: calls made inside exported helper functions (`export function emitPaid()`, `export const emitPaid = () => ee.emit(PAID)`) count for the helper's callers, not for the helper's file. Only the function's body counts: a call after it is the file's own, and an exported object (`export const bus = new EventEmitter()`) is no helper. When the map knows imports, only files that import the helper's file count, so two helpers with the same name in two files stay apart. |
| `labels` | `'constants'`: when the key is a constant (`ee.emit(PAID)`), label the link with its value from an `export const PAID = 'order.paid'` in the same files. |

Each calling file gets a link to every other file that answers the same key. A key nothing answers is an `unmatched-<kind>` warning.

### `trpc`: tRPC procedures

`trpc({ routers })` follows the routers declared in `routers` (nested and composed, `t.router({ counter: counterRouter })`) to every procedure path, then links each `trpc.<path>.query|mutate|subscribe` in the files that import the client to the file that declares that procedure.

Options: `routers` (required), `callers` (default: everything outside `routers`), `client` (default `'trpc'`), `router` (default `'t.router'`), `procedure` (default `'t.procedure'`; lists are fine: `['publicProcedure', 'protectedProcedure']`), `connection` (default `true`: also link the file that builds the client, `httpBatchLink` or `createWSClient`, to the server file that mounts the HTTP handler or the WebSocketServer on the path it names).

### `http`: HTTP between your own apps

`http({ server, clients, routes })` indexes the routes the server declares, then links client calls to them. `routes` are templates with `{path}` and optionally `{method}`: `"app.{method}({path}"`, `"req.url === {path} && req.method === {method}"`. A template's `{path}` must be a string literal; a regular expression's `path` group is taken as it is. An empty `server` or `clients` (`''`) is the whole repo.

On the client side, a file counts when it uses an HTTP client (`fetch`, axios, httpx, requests, urllib, aiohttp, ky, got). The paths it calls are interpolated strings on a base (`f"{cfg.url}/items"`, `` `${base}/items` ``), the same through a variable that holds one (`BASE = f"{url}/api"`, then `f"{BASE}/items"` calls `/api/items`; `BASE` alone counts only where it's passed on as it is, `httpx.get(BASE)`), and path literals of two or more segments passed as an argument (`send("/ingest/subtitle", …)`). A path no route declares is an `unmatched-http` warning.

### `graphql`: GraphQL operations through a generated client

```js
graphql({
  documents: 'apps/web/src',
  client: 'apps/web/src/gql/generated.ts',
  in: 'apps/web/src',
  why: "The web app reaches the API only through the hooks graphql-codegen generates from each feature's .graphql files.",
}),
```

`graphql` reads every named `query`, `mutation`, `subscription` and `fragment` in `.graphql`/`.gql` files under `documents`, and in gql`…` or graphql(`…`) templates in code there. A `.graphql` file with no operation (a schema) stays off the map. Then it matches the code across graphql-codegen's renaming: `query currentUser` becomes `useCurrentUserQuery`, `useCurrentUserLazyQuery`, `CurrentUserDocument` and `CurrentUserGQL`, in PascalCase as codegen writes it (`setAPIKey` is `SetApiKey`), with and without `dedupeOperationSuffix` and `omitOperationSuffix`; a fragment becomes `…FragmentDoc`.

It adds:

- a `graphql` link from each file that uses a generated name to the document that declares the operation, labelled with the operation's name;
- a `graphql` link from a document to the one that declares each fragment it spreads;
- a `codegen` link from each document to the client generated from it;
- an operation per query, mutation and subscription, with its root fields, listed in the `operations` of each file that calls it, so the viewer shows it as a server call.

| Option | |
|---|---|
| `documents` | Where the operations are declared. Default: the whole repo. |
| `client` | The file(s) codegen writes. With it, only names the client exports count (a hand-written `useTodosQuery` elsewhere doesn't), only files that import the client, or a file that re-exports it, are callers, and the client is never read as documents. Without it, every name shaped like codegen's counts. |
| `in` | Files that make the calls. Default: the whole repo. |

The same operation name in two documents is an `ambiguous-graphql` warning, since codegen keeps one. A name the client exports that no document declares, and a fragment nobody declares, are `unmatched-graphql` warnings. Generated files (by name or header) are never read as documents.

### `vueComponents`: components Vue resolves by name

```js
vueComponents({
  in: ['apps/web/src', 'libs/ui/src'],
  dts: 'apps/web/components.d.ts',
  byName: 'panel: {key}',
  why: 'unplugin-vue-components registers every component, so templates use them without imports; the dialog stack names its panels as strings.',
}),
```

A template tag, `<TodoItem>` or `<todo-item>`, links to the `.vue` file behind the name, recorded as a rendered component, so the viewer's screens follow it. A name comes from, in this order: the file's own imports (through barrels too: `export { default as TodoItem } from './TodoItem.vue'`), `app.component('TodoItem', TodoItem)` or a lazy `defineAsyncComponent(() => import(…))`, the map's `registries`, unplugin-vue-components' `components.d.ts`, and its `dirs`. Tags are read in `.vue` templates (HTML comments left out), in `template: '…'` strings (Storybook stories) and in JSX, never in TypeScript generics.

| Option | |
|---|---|
| `in` | Files that render components. Default: the whole repo. |
| `dts` | The `components.d.ts` file(s); their names apply to every file in `in`. Default: every `components.d.ts` in the repo, each for the files of its own app (the folder of the nearest `package.json` or `vite.config` above it). Entries from packages (`vue-router`'s `RouterLink`) are libraries, not files, and are left out. |
| `dirs` | Folders whose `.vue` files are registered by file name, as unplugin's `dirs`: `'src/components'`. |
| `registries` | Objects that name a component and its file: templates with `{key}` and `{path}`: `'{key}: () => import({path}'`. |
| `byName` | Places a component is named as a value: templates with `{key}`: `'component: {key}'`. A quoted name nothing registers is an `unmatched-component` warning; a variable is left alone. |

A `components.d.ts` entry or an `app.component` registration whose file isn't there is an `unresolved-component` warning.

### Tools and languages

| Primitive | What it adds |
|---|---|
| `spawn({ in })` | `spawn('cmd', [...])` linked to the program it starts; `uv run <script>` resolves through `pyproject.toml`'s `[project.scripts]`. |
| `pythonImports({ in })` | Imports between the repo's own Python modules. The generic `js` adapter lists Python files without links. |
| `vitest()` | Vitest configs linked to their `setupFiles` and `globalSetup`, a workspace file to each project's config. |
| `vueRoutes({ in })` | vue-router records (`RouteRecordRaw`) as the map's screens, with the component each mounts, also through aliases (`() => import('@/views/TodoList.vue')`). |
| `globImports({ in })` | Vite's `import.meta.glob('./icons/*.vue')`: a `glob` link from the file to every file on the map the pattern names. Patterns may be lists, relative, from the Vite root (`/src/…`), through an alias (`@/…`), or left out with `!`. A pattern that matches only files the map doesn't hold (`*.svg`) is an info note; one that matches nothing is an `unmatched-glob` warning. |
| `dataFiles({ in, extensions, aliases })` | Data files the code imports (`extensions: ['yaml', 'json']`) put on the map, which otherwise maps only code, with an import from each file that loads one. `aliases` maps import aliases to folders: `{ '@content': 'content' }`; the project's own aliases (tsconfig, Vite) work without it. |
| `runs({ from })` | Files that start code by naming it (`package.json` scripts, CI workflows, build configs, Makefiles) put on the map, with a `runs` link to every repo file they name by path. Comments don't count; a path a CI file only filters on does. |
| `externalServices({ in, names })` | Services outside the repo reached with `fetch` on a URL constant or base, or `new WebSocket(url)`: a note on the calling file. `names` labels them by a piece of the URL: `{ Twitch: 'twitch.tv' }`. |
| `external({ name, call, in })` | One service reached through an SDK call (`call: 'ElevenLabs('`): a note on each file that makes the call. |

### `custom`: code, when nothing else fits

```js
custom({
  name: 'jobs by queue name',
  why: 'Jobs are registered in a table, not by a call shape.',
  run(ctx) {
    // ctx.files(scope), ctx.read(id), ctx.code(id) (comments blanked out),
    // ctx.byId, ctx.ids, ctx.addLink(file, { target, kind, label }),
    // ctx.addImport(file, target), ctx.addComponent(file, { tag, target, library, byName }),
    // ctx.addGap(gap), ctx.addRoute(route), ctx.addFile(id),
    // ctx.resolve(fromId, specifier), ctx.pathOf(fromId, specifier): imports resolved as the primitives do
  },
}),
```

`check` reports how many links came from custom code. When a custom rule looks like it would fit other repos, it's a candidate primitive: say so in an issue on sinopia.

## What `check` shows

After the coverage numbers, `check` lists every rule: what it looks at, what it found (links by kind, routes, notes), its `why`, and flags for drafts and regular expressions. Then the drafts by number, the count of regular-expression shapes, and the share of links from custom code. `check --json` has the same under `rules`, and the scan keeps it in `graph.json` as `meta.rules`.

Server calls: `graphql`, `trpc` and `http` links count as the calling file's server calls in the viewer, next to the operations an adapter lists.

Big files: a file over 200 KB (a generated API client) stays on the map with its imports, hashed in chunks, and `check` notes it as a `large-file` info. One that says it's generated (by its name, or a header like `@generated`) isn't described.

## Rules or an adapter

Reach for rules first. `.sinopia/adapter.mjs` (`sinopia adapter docs`) is the full-code escape hatch: it builds the whole graph and can change parts, kinds and what `describe` is told. When a repo has both files, the adapter wins and every command warns, so move what the adapter adds into the map and delete it.
