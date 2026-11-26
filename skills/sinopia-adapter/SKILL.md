---
name: sinopia-adapter
description: Teach Sinopia how a codebase connects. Writes the project's map rules (.sinopia/map.mjs), or repairs, upgrades or converts a full adapter (.sinopia/adapter.mjs). Use when a Sinopia map misses links the code has (RPC calls, sockets, message buses, HTTP between its apps, generated clients, spawned processes, contracts with other repos), when `sinopia check` fails because of the map or adapter, or when sinopia reports that an adapter implements an older interface version.
---

# Sinopia map rules and adapters

Sinopia maps a repo as parts, files and links. Its generic scan only sees folders and JS/TS imports. Many codebases connect through things imports don't show: a client calls a server procedure by name, a component sends a socket event that a handler three folders away receives, a Python process posts to what a Node process serves. Your job is to tell sinopia where those links are, and to prove with `sinopia check` that the map is better for it.

There are two ways, in this order:

1. **Map rules**, `.sinopia/map.mjs`: a short list of rules, one per mechanism, each saying where to look, what the call looks like (`'ee.emit({key}'`) and why. Sinopia does the parsing and matching. This is what the user reviews, so it's what you write.
2. **A full adapter**, `.sinopia/adapter.mjs`: code that builds the graph. Only for what rules can't say (its own parts or file kinds, describe context, a schema fetched from another repo), or a repo that already has one.

You need the `sinopia` CLI (`sinopia help`; install with `npm install -g --install-links github:lucastraba/sinopia` if it's missing) and a repo. Run every command from the repo root.

## 1. Read the docs

Run `sinopia map docs` and read all of it before writing rules: the primitives, their options, templates and what `check` reports. When you need an adapter, `sinopia adapter docs` too. This skill doesn't repeat them.

## 2. Start from what exists

- Neither file: run `sinopia map init`. The empty map gives the generic result.
- A map exists and `check` fails or reports `rule-failed`: read the errors and fix the rule, not the code being mapped.
- An adapter exists and `sinopia check` reports an interface version mismatch: upgrade it (section 7), then continue here.
- An adapter exists and works: offer to convert it to rules (section 5b). Don't delete it without the user's yes; it's their code.

## 3. Measure the baseline

Save both numbers before changing anything:

```bash
sinopia check --adapter js --json > /tmp/sinopia-generic.json     # or --adapter plain for a non-JS repo
sinopia check --json > /tmp/sinopia-before.json                    # the project adapter as it is
```

The fields that matter: `passes`, `isolated.count` and `isolated.examples` (code files with no link in or out), `links` (counts by kind), `partLinks` (pairs of parts with a link), `unresolved`, `gaps.error`.

## 4. Find the links the generic scan misses

Read the code, starting from the README, the package manifests and the entry points of each app. You're looking for every place where one file reaches another without importing it. Common mechanisms, with what to search for:

| Mechanism | Declared where | Called where |
|---|---|---|
| tRPC | `router({ ... })` objects, `t.procedure`, `publicProcedure`, the root `appRouter` that nests routers by key | `trpc.<router>.<proc>.useQuery(`, `.query(`, `.mutate(`, `.subscribe(`, `useMutation(` |
| The client's connection itself | the server file that listens on a path (`new WebSocketServer({ path: '/ws' })`, a `/trpc` or `/api` handler) | where the client is built with a URL (`createWSClient({ url })`, `httpBatchLink({ url })`, `new WebSocket(url)`, `axios.create({ baseURL })`) |
| REST between your own apps | `app.get('/path'`, `router.post(`, framework route files | `fetch('/path'`, `axios.get(`, a generated or hand-written client |
| WebSocket and Socket.IO events | `socket.on('event'`, `ws.on('message'` with a switch on a type field | `socket.emit('event'`, `ws.send(JSON.stringify({ type: 'event'` |
| Message buses and queues | `subscribe('topic'`, consumers, event handler maps | `publish('topic'`, `emit(`, queue producers |
| Generated clients | the schema or spec (GraphQL, OpenAPI, protobuf) and the server code that implements it | the generated module, and the files that call it |
| Auto-imported components | a global registration, `unplugin-auto-import`, Nuxt's `components/` | tags in templates with no matching import |
| Processes and services | the program that's started or the service that listens (often another language) | `spawn(`, `exec(`, a URL built from an env var, a Docker or compose file |
| Registries by name | a map from strings to modules (commands, plugins, handlers) | the place that looks up the string |
| Contracts with other repos | shared schema files, published types | the code on this side that relies on them |
| Config that names files | the file named (a test setup file, a workspace project, a build entry) | the config that names it (`setupFiles`, a workspace list, `pyproject.toml` scripts) |

For each mechanism you find, write down the pattern on both sides, how a call is matched to its handler (a procedure path like `counter.increment`, an event name, a URL path), and two or three concrete examples from the code. Check the examples by reading them, not by guessing from names.

Services outside the repo (a third-party API, another team's server) have no file to link to. Record each as an `info` gap on the file that calls it, for example `{ kind: 'external-service', level: 'info', file, detail: 'POST {EMBERHOLLOW_URL}/api/cmd (Emberhollow)' }`, so the map's scan notes list them. Don't invent a target.

Also look at `isolated.examples` from the baseline. Each isolated file either stands alone (a one-off script, a config file, a test helper) or is reached through a mechanism you haven't found yet. Find out which for every one.

## 5. Write the rules

One rule per mechanism, in `.sinopia/map.mjs`:

- Pick the primitive that matches: `trpc`, `http`, `graphql`, `spawn`, `pythonImports`, `vitest`, `vueRoutes`, `vueComponents`, `globImports`, `dataFiles`, `runs`, `externalServices`, `external`, and `link` for anything matched by a name (events, message types, queue topics, commands). Auto-registered Vue components need `vueComponents`, and codegen'd GraphQL hooks need `graphql`, not `link`: the hook's name isn't the operation's.
- Don't map aliases by hand: every primitive resolves `@/…`, tsconfig paths, Vite aliases and workspace packages the way the project does. A scope can be a glob (`'**/*Locales.ts'`) when the files share a shape rather than a folder.
- Write call shapes as templates copied from the code: `'ee.emit({key}'`, `"app.{method}({path}"`. Use a regular expression only when no template can say it, and expect `check` to count it against you.
- Scope every rule to the folders where the mechanism lives (`in`, `from`, `to`, `server`, `clients`). A rule over the whole repo matches strings in places nobody meant.
- Give every rule a `why`: one sentence a reader of the map would want, in the project's words.
- Mark every rule you write `draft: true`. The user confirms a rule by deleting that line. Never remove `draft` yourself, and leave rules the user already confirmed alone unless they're wrong.
- When no primitive fits, write a `custom({ name, why, run(ctx) })` rule and keep it small. Then say in your report which custom rule looks reusable, as a candidate primitive for sinopia.

### 5b. Converting an adapter to rules

Save `sinopia check --json` and a fingerprint of the adapter's graph first (every link, import, route and gap, and every part with the files in it, sorted). An adapter can group files into its own parts, so links that match can still hide a map that's grouped differently. Write the map, run it with `--adapter .sinopia/map.mjs`, and compare: the goal is the same fingerprint, not just the same counts. Every difference is either a bug in a rule or a bug the adapter had; find out which before you call it done. Delete the adapter only when the user agrees.

While `.sinopia/adapter.mjs` exists, `--adapter auto` (the default) keeps picking it over the map. So for the whole conversion, including the loop in section 6, pass `--adapter .sinopia/map.mjs` to every `check` and `scan`. If the user keeps the adapter, tell them it stays the one sinopia uses until they remove it or pass the map explicitly.

### 5c. Writing links in an adapter

When you're writing a full adapter, work in `addProjectLinks` (or the adapter's `scan`), following these rules:

- Read files from `input.root` with `sinopia.readText(join(input.root, file.id), 500_000)`. Never read from `input.repo`: `diff` scans older commits from a snapshot.
- Index the declaring side first (every handler with its key and file), then walk the calling side and match by key. Put each link on the calling file, pointing at the handling file: `sinopia.addLink(file, { target, kind, label })`. `kind` names the mechanism (`trpc`, `ws-event`, `http`, `spawn`); `label` is the key that crossed (`counter.increment`, `chat:message`, `GET /api/health`).
- A call you can't match is a gap, not a guess: `graph.gaps.push({ kind: 'unmatched-<kind>', level: 'warning', file: file.id, detail: '...' })`. Use `error` only for something that makes the map wrong.
- Targets must be file ids in `graph.files`. If the handling file isn't mapped (a language the generic adapter skips, a folder it ignores), add it to `graph.files` and to a part first, with `kind`, `lines`, `hash` (`sinopia.sha1(text)`) and empty `imports`, `libraries`, `components`, `operations`, `flags`, and `registeredAs: null`.
- Parse with regular expressions when the syntax is regular, and keep them anchored to the specific call shapes you found. Match whole keys: `counter.increment` must not match `counter.incrementBy`.
- No network, no model calls, no absolute paths, no clock. The same code must give the same graph.
- Keep it in the one file. Plain JavaScript, Node built-ins (`import { join } from 'node:path'` at the top of the module) and the `sinopia` API passed in. The module can't import packages from the project or from sinopia.
- Leave parts alone unless they're clearly wrong. Changing part ids throws away their cached descriptions, which costs money to rebuild.

## 6. Loop on check

```bash
sinopia check                      # human-readable
sinopia check --json > /tmp/sinopia-after.json
```

When you're converting an adapter that's still in the repo (5b), add `--adapter .sinopia/map.mjs` to both, or they check the adapter.

Repeat sections 4 to 6 until both of these hold:

1. `passes` is true: no errors.
2. Two rounds in a row change nothing: no fewer isolated files, no more part-to-part links, no new link kinds, and every remaining isolated file is one you've decided stands alone.

Then check recall: for each mechanism, search the repo for its calling pattern and confirm that every non-test file that matches got at least one link of that kind. A file the search finds and the adapter doesn't is either a call shape your matcher misses or a false hit in a comment or string; find out which.

Then check precision: pick five links of each new kind from `graph.json` (`sinopia scan` writes it to the map folder that it prints) and confirm in the code that each one is real. A wrong link is worse than a missing one, because the map states it as fact. Fix the matcher if any are wrong.

If the adapter throws, `sinopia check` prints the stack trace, and the top frame in `.sinopia/adapter.mjs` is where to look. A map rule that throws becomes a `rule-failed` error with its stack; the other rules still run.

## 6b. Draft areas and claims

Once the rules hold, give the map its overview (`sinopia map docs`, "Areas and claims"). It matters most on repos with 12 parts or more, where the viewer opens on it.

1. Read the folders, the part list in `graph.json` and the app's README, then write `export const areas` with 3 to 9 areas, each `{ folders, why, draft: true }`. Name them by what they do for the product ("Game rules", "Reports & dashboards", "Tooling"), not by folder. A server is not an area. Put the bare root (`main.ts`, `App.vue`) with what it mounts, and tests, scripts, CI and `(root)` config in Tooling unless the user splits them.
2. Run `check`. Every part should land somewhere: fix each `part-without-area` warning by adding its folder to an area. Look at the lines: one area that sends or takes most of the links usually holds two things; split it.
3. Write `export const claims`, 3 to 6, each `{ says, never | only | through, why, draft: true }`. Start from the rules' `why` lines and the README: "the core never imports the UI", "only the store calls the API", "the page reaches the desktop only through the bridge". Phrase `says` as a sentence the user would say.
4. Run `check` again and read each claim's result. Don't rewrite a claim until it passes: a broken claim is either a finding (tell the user, with the examples `check` printed) or a sentence that says more than was meant (say which, and offer the narrower one). Never add `enforce: true` yourself.
5. If the repo keeps a full adapter (`.sinopia/adapter.mjs`), `--adapter auto` loads it and never reads `areas` or `claims` from the map, so the overview falls back to folders and shows no claims. Either export the same `areas` and `claims` from the adapter object (fields `areas` and `claims`, as in `docs/adapters.md`), or run every `check`, `scan` and `refresh` with `--adapter .sinopia/map.mjs` until the adapter is removed. Say which one you did in the report.
6. In the report, list the areas (name, part and file counts, one line why) and each claim with holds/broken and its count, so the user can confirm them, move a folder, or reword a claim without opening the file.

## 7. Upgrading to a new interface version

When `sinopia` says the adapter implements an older interface version:

1. Run `sinopia adapter docs` and read "Changes between versions", every section from the adapter's version up to the current one.
2. Make each change, then set `interfaceVersion` to the current version.
3. Run `sinopia check` and compare with the adapter's last good numbers if the repo kept them (section 8). An upgrade must not lose links.

## 8. Finish

- Commit `.sinopia/map.mjs` (or the adapter) with the repo: on the branch the user is working on, or on a new branch when you're not sure that's wanted. Sinopia loads it automatically from then on, also for `refresh` timers, unless the repo also has `.sinopia/adapter.mjs`: then the adapter wins until it's removed, and the map runs only with `--adapter .sinopia/map.mjs`.
- Put the numbers at the top of the file as a comment: generic baseline and the result (isolated count, links by kind, part-to-part links), with the date. The next agent compares against it.
- Tell the user what changed, in numbers: errors, isolated files before and after, part-to-part links before and after, the link kinds added with counts, what's still isolated and why, and any mechanism you saw but didn't map, with the reason. Then list the draft rules by number, one line each, so they can confirm or reject them without opening the file, then the draft areas and claims (6b).
- If the map already had descriptions, `sinopia refresh --force` (or `scan` then `describe`) updates them; while `.sinopia/adapter.mjs` is still there, add `--adapter .sinopia/map.mjs`, or the refresh reads the adapter. Files whose content didn't change keep their descriptions; the new links show in the viewer at once.
