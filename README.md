# Sinopia

A map of a code base that you can read on a phone. The structure comes from the code (folders, imports, and whatever an adapter knows about the stack); Claude only writes the plain-language descriptions, cached by file content so a refresh only pays for what changed. A sinopia is the underdrawing beneath a fresco.

It started as Helu Map, inspired by [Floorplan](https://github.com/haydenschmitty/floorplan) (MIT); the plain-language rules in `src/describe/prompt.ts` are adapted from its writing guide.

Ownership: parts of the core were first written in Helu's frontend repo; Helu confirmed in writing on 2026-11-21 that Sinopia belongs to its author.

Each repo can carry its own adapter (`.sinopia/adapter.mjs`), written by its developers or their agent, for the links a generic scan can't see. Sinopia ships the core, two generic adapters and the instructions for writing one: [`docs/adapters.md`](docs/adapters.md).

## Install

The CLI (Node 22 or newer, git; `describe` also needs the `claude` CLI):

```bash
npm install -g --install-links github:lucastraba/sinopia
```

The Claude Code plugin, with the `sinopia` and `sinopia-adapter` skills:

```
/plugin marketplace add lucastraba/sinopia
/plugin install sinopia@sinopia
```

On Claude Code 2.1.275 or later, `/plugin install sinopia --marketplace lucastraba/sinopia` does both.

## Try it on a project

You need Node 22 or newer, git, and Claude Code logged in. It runs on macOS and Linux; Windows is untested.

1. Install the CLI and the plugin (above), then open Claude Code in your repo.
2. Ask for a map ("make a sinopia map of this repo"). The `sinopia` skill scans the code (free, seconds) and runs `sinopia check`, which says how connected the map is.
3. If `check` shows many isolated files, or your code talks across boundaries that imports don't show (RPC, sockets, queues, generated clients, another language), ask Claude to write a sinopia adapter. The `sinopia-adapter` skill writes `.sinopia/adapter.mjs` and keeps going until `check` passes and stops improving. Commit that file.
4. Describe: `sinopia describe --estimate` shows how much code there is, then `sinopia describe` writes the descriptions. With Sonnet, a 30-file repo costs well under a dollar at API prices and a 300-file repo three or four; on a Claude subscription it counts against your usage limits instead.
5. Look at it: `sinopia serve`, then open http://127.0.0.1:8400. Later, `sinopia refresh` updates the map after new commits and only describes files that changed.

What leaves your machine: only `describe` sends code to Claude, through your own `claude` CLI and login, as Claude Code does. Maps stay in `~/.local/share/sinopia/maps`. `serve` binds 127.0.0.1 unless you pass `--host`.

## Commands

```bash
sinopia scan [repo]        # graph.json and the validation report
sinopia check [repo]       # errors and coverage, without saving; --json for agents
sinopia adapter init [repo]   # .sinopia/adapter.mjs from the generic adapter, plus next steps
sinopia adapter docs       # the adapter interface
sinopia describe [repo]    # descriptions with claude -p; --estimate prints the cost first
sinopia diff [repo] [--head <ref>] [--base <ref>]
sinopia refresh [repo]     # scan and describe if HEAD moved since the last refresh
sinopia serve --host <tailscale ip> [--port 8400]   # every map at /p/<name>/
```

Maps go to `$SINOPIA_HOME/maps/<name>` (default `~/.local/share/sinopia/maps`). `--adapter auto|js|plain|<file>` picks how a repo is read; `auto` uses the repo's `.sinopia/adapter.mjs` when it has one, else `js` when most code is JS/TS and there's a `package.json`, `plain` otherwise. `SINOPIA_CLAUDE` points at the `claude` CLI where it isn't on PATH (systemd units).

## Layout

- `src/model.ts`: the graph. `meta` carries a map's title, part groups and optional sections (server calls, screens, a POC-style boundary, a component library), so diff and the viewer don't know any one stack.
- `src/adapter.ts`: the interface an adapter implements and its version (`ADAPTER_INTERFACE_VERSION`); `docs/adapters.md` documents it. Bump the version for any change an existing adapter must follow, and add the upgrade steps to that doc.
- `src/loadAdapter.ts`, `src/adapterInit.ts`: picking and loading a project's adapter, and scaffolding one.
- `src/links.ts`, `src/coverage.ts`: every link out of a file (imports, components, adapter links), and the coverage numbers `check` prints.
- `src/adapters/folders.ts`: `js` (folders as parts, imports from dependency-cruiser without a config) and `plain` (folders and files, no links, for Lua, shell and Python repos).
- `src/cli.ts`: `runCli`, the commands every map has; a project with its own adapter (Helu's frontend) calls it from its own CLI.
- `src/describe/`, `src/diff/`, `src/validate.ts`, `src/serve.ts`: describe, diff, the graph checks, and the HTTP server.
- `src/viewer/`: the Vue + Vite + elkjs viewer, built into `viewer-dist/`.

## Building

`dist/` and `viewer-dist/` are committed, so a project can depend on a commit (`github:lucastraba/sinopia#<sha>`) without building anything. Run `pnpm build` before committing changes to `src/`; `pnpm check` fails when the built files are stale.

## Gotchas

- Edges, groups and cards are one layer moved by one CSS transform (`MapCanvas.vue`). Two WebKit bugs led there: HTML inside `<foreignObject>` ignores an ancestor SVG transform (on iPhone Safari the cards stayed put while the edges panned), and an SVG moved through its `transform` attribute on every frame leaves trails of old edges, arrowheads and group borders. `will-change: transform` is on only during a gesture, so the layer is redrawn sharp at the new zoom afterwards.
- The dark theme mirrors each Tailwind palette under `html.dark` (`src/viewer/style.css`, generated by `scripts/dark-palette.mjs`) instead of adding `dark:` classes, so the light design carries over. A color from a palette the script doesn't list stays light in dark mode: add the palette there and regenerate. The choice (Auto, Light, Dark) is in localStorage under `sinopia-theme`, shared with the map index.
- dependency-cruiser exports no `package.json`; `src/cruise.ts` finds its CLI from `import.meta.resolve`.
- pnpm 11 blocks install scripts; `pnpm-workspace.yaml` allows esbuild's.
