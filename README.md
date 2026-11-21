# Sinopia

A map of a code base that you can read on a phone. The structure comes from the code (folders, imports, and whatever an adapter knows about the stack); Claude only writes the plain-language descriptions, cached by file content so a refresh only pays for what changed. A sinopia is the underdrawing beneath a fresco.

Private and personal. It started as Helu Map, inspired by [Floorplan](https://github.com/haydenschmitty/floorplan) (MIT); the plain-language rules in `src/describe/prompt.ts` are adapted from its writing guide.

## Commands

```bash
sinopia scan [repo]        # graph.json and the validation report
sinopia describe [repo]    # descriptions with claude -p; --estimate prints the cost first
sinopia diff [repo] [--head <ref>] [--base <ref>]
sinopia refresh [repo]     # scan and describe if HEAD moved since the last refresh
sinopia serve --host <tailscale ip> [--port 8400]   # every map at /p/<name>/
```

Maps go to `$SINOPIA_HOME/maps/<name>` (default `~/.local/share/sinopia/maps`). `--adapter auto|js|plain` picks how a repo is read; `auto` uses `js` when most code is JS/TS and there's a `package.json`, `plain` otherwise. `SINOPIA_CLAUDE` points at the `claude` CLI where it isn't on PATH (systemd units).

## Layout

- `src/model.ts`: the graph. `meta` carries a map's title, part groups and optional sections (server calls, screens, a POC-style boundary, a component library), so diff and the viewer don't know any one stack.
- `src/adapter.ts`: the interface an adapter implements: `scan`, `partOf`, `snapshotPaths`, `describeContext`.
- `src/adapters/folders.ts`: `js` (folders as parts, imports from dependency-cruiser without a config) and `plain` (folders and files, no links, for Lua, shell and Python repos).
- `src/cli.ts`: `runCli`, the commands every map has; a project with its own adapter (Helu's frontend) calls it from its own CLI.
- `src/describe/`, `src/diff/`, `src/validate.ts`, `src/serve.ts`: describe, diff, the graph checks, and the HTTP server.
- `src/viewer/`: the Vue + Vite + elkjs viewer, built into `viewer-dist/`.

## Building

`dist/` and `viewer-dist/` are committed, so a project can depend on a commit (`github:lucastraba/sinopia#<sha>`) without building anything. Run `pnpm build` before committing changes to `src/`; `pnpm check` fails when the built files are stale.

## Gotchas

- The map cards are an HTML layer over the SVG, moved with the same CSS transform. HTML inside `<foreignObject>` ignores an ancestor SVG transform in WebKit, so on iPhone Safari the cards stayed put while the edges panned.
- dependency-cruiser exports no `package.json`; `src/cruise.ts` finds its CLI from `import.meta.resolve`.
- pnpm 11 blocks install scripts; `pnpm-workspace.yaml` allows esbuild's.
