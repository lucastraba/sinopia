---
name: sinopia-adapter
description: Write, repair or upgrade a project's Sinopia adapter (.sinopia/adapter.mjs), the module that tells Sinopia how a codebase connects. Use when a Sinopia map misses links the code has (RPC calls, sockets, message buses, generated clients, auto-imported components, contracts with other repos), when `sinopia check` fails because of the adapter, or when sinopia reports that an adapter implements an older interface version.
---

# Sinopia adapter

Sinopia maps a repo as parts, files and links. Its generic adapter only sees folders and JS/TS imports. Many codebases connect through things imports don't show: a client calls a server procedure by name, a component sends a socket event that a handler three folders away receives, a Python process reads what a Node process publishes. A project adapter finds those links in the code and adds them to the map. Your job is to write that adapter, or repair or upgrade the one the repo has, and to prove with `sinopia check` that it's better than the generic one.

You need the `sinopia` CLI (`sinopia help`; install with `npm install -g github:lucastraba/sinopia` if it's missing) and a repo. Run every command from the repo root.

## 1. Read the interface

Run `sinopia adapter docs` and read all of it before writing code. It defines the module shape, the graph, the rules and what `check` measures. This skill doesn't repeat it.

## 2. Start from what exists

- No `.sinopia/adapter.mjs`: run `sinopia adapter init`. It writes an adapter that wraps the generic one, so the map already works, and prints next steps.
- An adapter exists and `sinopia check` reports an interface version mismatch: upgrade it (section 7), then continue here.
- An adapter exists and `check` fails: read the errors. Each names a file and what's wrong. Fix the adapter, not the code being mapped.

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
| REST between your own apps | `app.get('/path'`, `router.post(`, framework route files | `fetch('/path'`, `axios.get(`, a generated or hand-written client |
| WebSocket and Socket.IO events | `socket.on('event'`, `ws.on('message'` with a switch on a type field | `socket.emit('event'`, `ws.send(JSON.stringify({ type: 'event'` |
| Message buses and queues | `subscribe('topic'`, consumers, event handler maps | `publish('topic'`, `emit(`, queue producers |
| Generated clients | the schema or spec (GraphQL, OpenAPI, protobuf) and the server code that implements it | the generated module, and the files that call it |
| Auto-imported components | a global registration, `unplugin-auto-import`, Nuxt's `components/` | tags in templates with no matching import |
| Processes and services | the program that's started or the service that listens (often another language) | `spawn(`, `exec(`, a URL built from an env var, a Docker or compose file |
| Registries by name | a map from strings to modules (commands, plugins, handlers) | the place that looks up the string |
| Contracts with other repos | shared schema files, published types | the code on this side that relies on them |

For each mechanism you find, write down the pattern on both sides, how a call is matched to its handler (a procedure path like `counter.increment`, an event name, a URL path), and two or three concrete examples from the code. Check the examples by reading them, not by guessing from names.

Also look at `isolated.examples` from the baseline. Each isolated file either stands alone (a one-off script, a config file, a test helper) or is reached through a mechanism you haven't found yet. Find out which for every one.

## 5. Write the links into the adapter

Work in `addProjectLinks` (or the adapter's `scan`), following these rules:

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

Repeat sections 4 to 6 until both of these hold:

1. `passes` is true: no errors.
2. Two rounds in a row change nothing: no fewer isolated files, no more part-to-part links, no new link kinds, and every remaining isolated file is one you've decided stands alone.

Then check precision: pick five links of each new kind from `graph.json` (`sinopia scan` writes it to the map folder that it prints) and confirm in the code that each one is real. A wrong link is worse than a missing one, because the map states it as fact. Fix the matcher if any are wrong.

If the adapter throws, `sinopia check` prints the stack trace, and the top frame in `.sinopia/adapter.mjs` is where to look.

## 7. Upgrading to a new interface version

When `sinopia` says the adapter implements an older interface version:

1. Run `sinopia adapter docs` and read "Changes between versions", every section from the adapter's version up to the current one.
2. Make each change, then set `interfaceVersion` to the current version.
3. Run `sinopia check` and compare with the adapter's last good numbers if the repo kept them (section 8). An upgrade must not lose links.

## 8. Finish

- Commit `.sinopia/adapter.mjs` with the repo. Sinopia loads it automatically from then on, also for `refresh` timers.
- Put the numbers at the top of the adapter as a comment: generic baseline and the adapter's result (isolated count, links by kind, part-to-part links), with the date. The next agent compares against it.
- Tell the user what changed, in numbers: errors, isolated files before and after, part-to-part links before and after, the link kinds added with counts, what's still isolated and why, and any mechanism you saw but didn't map, with the reason.
- If the map already had descriptions, `sinopia refresh --force` (or `scan` then `describe`) updates them. Files whose content didn't change keep their descriptions; the new links show in the viewer at once.
