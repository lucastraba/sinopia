---
name: sinopia
description: Make, refresh, diff or serve a Sinopia map of a codebase (parts, files and links from the code, plain-language descriptions from Claude), and answer questions about a codebase from its map. Use when the user asks for a map or overview of a repo's architecture, what a part or file does, what changed between branches at the level of parts, or wants to see the map in a browser.
---

# Sinopia

Sinopia builds a map of a repo. The structure (parts, files, the links between them) comes from the code through an adapter; Claude writes a title and two descriptions for each part and file, one plain and one technical. Descriptions are cached by file content, so after the first run only changed files cost anything. A viewer shows the map in a browser and works on a phone.

The commands below assume the `sinopia` CLI. Check with `sinopia help`. If it's missing, install it (Node 22 or newer, git):

```bash
npm install -g --install-links github:lucastraba/sinopia
```

`describe` also needs the `claude` CLI, logged in. If `claude` isn't on PATH, set `SINOPIA_CLAUDE` to its full path.

## Make a map

Run these from the repo, or pass its path as the first argument.

1. `sinopia scan` reads the code and writes `graph.json`. It's free and takes seconds. It prints the parts, the file count and the validation findings.
2. `sinopia check` prints the same findings plus coverage: how many code files have no link in or out, links by kind, part-to-part links. Read it before describing. If most files are isolated, or the repo talks across boundaries that imports don't show (RPC, sockets, queues, generated clients), the generic adapter misses that structure: offer the `sinopia-adapter` skill before spending money on descriptions. A map with the wrong structure gets descriptions that are wrong about how things connect.
3. `sinopia describe --estimate` prints how much code needs describing. Tell the user the rough cost before the real run: with Sonnet, about $0.25 to $0.40 per 100k characters of code at API prices. A 30-file repo costs well under a dollar; a 300-file repo three or four dollars.
4. `sinopia describe` writes the descriptions. It runs `claude -p` with no tools, part by part, and saves after each part, so an interrupted run keeps what it finished.

Maps live in `$SINOPIA_HOME/maps/<name>` (default `~/.local/share/sinopia/maps/<repo folder>`): `graph.json`, `descriptions.json`, `gaps.txt` and `project.json`. `--name` changes the name and `--out` the folder.

How a repo is read: `--adapter auto` (the default) uses the repo's own `.sinopia/adapter.mjs` when it has one, otherwise the generic `js` adapter (folders as parts, JS/TS imports) when most code is JS/TS, otherwise `plain` (folders and files, no links).

## Keep it current

`sinopia refresh` scans and describes only when HEAD moved since the last refresh, and describe only pays for files whose content changed. `--force` runs it anyway. For a map that should stay current by itself, run `refresh` from a timer (cron, a systemd timer, launchd) every 15 to 30 minutes. It maps the working tree, so a repo checked out on a branch is mapped as that branch.

## What a branch changed

`sinopia diff` compares the working tree with its merge-base on the default branch: parts touched, files added and removed, new links between parts, routes and server operations that changed. `--base <ref>` and `--head <ref>` pick other commits; `--json` gives the raw result. It writes `diff.json` next to the map, and the viewer shows it under "Changes".

## Show it

`sinopia serve --host 127.0.0.1 --port 8400` serves every map at `http://127.0.0.1:8400/p/<name>/` with an index at `/`. `--data <map folder>` serves one map at `/`. It binds only the host given. On a machine with a public IP, never use `0.0.0.0`; bind to loopback, or to a private network address (a Tailscale IP, for example) when the user wants it on their phone. It's a long-running process: start it in the background, or as a service if it should stay up.

## Answer questions from a map

When the user asks how a codebase fits together, read the map before reading code. It's faster and it's already summarized.

- `graph.json`: `parts` (`id`, `name`, `kind`, `files`), `files` (`id` is the repo-relative path, `part`, `kind`, `imports`, `components`, `operations`, `links`), `routes`, `operations`, `gaps`.
- `descriptions.json`: `app`, then `parts`, `files` and `operations` keyed by id, each with `title`, `plain` and `dev`.

Useful queries (with `M=~/.local/share/sinopia/maps/<name>`):

```bash
jq -r '.parts[] | "\(.id)\t\(.files | length)"' $M/graph.json                     # parts and sizes
jq -r --arg p src/sync '.parts[$p].title, .parts[$p].dev' $M/descriptions.json      # what a part does
jq -r --arg f src/sync/run.ts '.files[] | select(.id==$f)' $M/graph.json             # a file's links
jq -r --arg f src/sync/run.ts '.files[] | select((.imports + [.links[]?.target]) | index($f)) | .id' $M/graph.json   # who uses a file
jq -r '.files | to_entries[] | "\(.key)\t\(.value.title)"' $M/descriptions.json | grep -i payment   # find by topic
```

Use the map to find where to look, then confirm in the code before stating details: descriptions can be a commit or two behind (`project.json` has the commit they describe), and they summarize. Say which you did.

## When something is off

- `check` exits 1 on errors: a file in two parts, a link to a file the scan didn't find, an unresolved route. With a project adapter, the error usually comes from it; use the `sinopia-adapter` skill to repair it.
- "implements adapter interface vN; this sinopia needs vM": the project's adapter is older than the installed sinopia. The `sinopia-adapter` skill upgrades it.
- `describe` fails with a `claude -p` error: check that `claude -p "say ok"` works in the same environment, and that the login hasn't run out.
