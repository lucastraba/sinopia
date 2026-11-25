# Readable map rules

**Goal:** A project's Sinopia tailoring is a short file a person can read and edit (`.sinopia/map.mjs`), backed by link primitives in the core. `adapter.mjs` stays for the cases the rules can't express.

**Why:** k-twitch's adapter is 638 lines. The part a person needs is its 10-line header comment, which nothing checks and which drifts from the code. The rest is string parsing (comment stripping, bracket matching), mechanisms any repo could use (tRPC, event buses, HTTP routes, spawn), and a handful of project facts (`projects/apps/server/src/`, the emitter is `ee`, `uv run voice-pipeline`). Those facts are what a reviewer cares about, and today they are scattered through regexes.

**Shape:** the same split as Thariq's game. The core is the engine (primitives, parsing, matching). `map.mjs` is the human layer (which mechanisms, where, with what names, and why). The `sinopia-adapter` skill writes the human layer and only falls back to code when no primitive fits.

---

## What the file looks like

The k-twitch target, roughly:

```js
// .sinopia/map.mjs: how streamer-hub connects, beyond imports.
export default ({ trpc, link, httpRoutes, spawn, configFiles, vueRoutes, external, custom }) => [
  trpc({
    routers: 'projects/apps/server/src',
    why: 'The hub calls the server only through tRPC.',
  }),
  link({
    kind: 'event',
    in: 'projects/apps/server/src',
    call: 'ee.emit({key}',
    answer: 'ee.on({key}',
    why: 'Server modules talk through one EventEmitter, ee.',
  }),
  httpRoutes({
    server: 'projects/apps/server/src',
    callers: 'voice_pipeline',
    why: 'The Python voice pipeline posts to the server over plain HTTP.',
  }),
  spawn({ command: 'uv run {script}', scripts: 'pyproject.toml' }),
  configFiles('vitest'),
  vueRoutes({ in: 'projects/apps/hub/src' }),
  external({ name: 'Twitch', url: /twitch\.tv/ }),
  external({ name: 'ElevenLabs', call: 'ElevenLabs(' }),
];
```

- **Call shapes are code templates, not regexes.** `ee.emit({key}` compiles to an anchored matcher in the core; `{key}` captures an identifier or a string literal. A raw regex is allowed and flagged by `check` as harder to read.
- **`why` is optional prose** and shows in the viewer's scan notes next to the links the rule made. It is the header comment, attached to the rule it explains.
- **`draft: true`** marks a rule an agent wrote that nobody has confirmed. `check` lists drafts. A person confirms a rule by deleting the flag, which is a one-line diff in review.
- **`custom(fn)`** is the escape hatch: a function with the same context the adapter gets today. `check` reports how many links came from custom code, so it stays visible.

## Decisions for Lucas

1. **Format: a JS module of declarations (proposed) or YAML.** JS keeps editor completion (JSDoc types on the primitives), allows `custom()` in the same file, and needs no parser. YAML reads friendlier to non-developers but needs a second file for anything custom.
2. **Primitives: one generic `link` plus a few named ones (proposed).** `link({ kind, call, answer })` covers the "declared here, called there, matched by key" table in the skill. The named ones (`trpc`, `httpRoutes`, `spawn`, `configFiles`, `vueRoutes`, `pythonImports`) exist because they need real parsing (nested routers, path prefixes, TOML).
3. **Drafts: on (proposed).** This is the "choices the agent made stay marked" rule from the brainstorm.
4. **Prose rules (`link('the voice pipeline is started by the server')`, compiled by the skill and pinned): not in this plan.** That is the vibe-holes dial and belongs to option 2, once the plain version has been used.
5. **Interface version: no bump.** `map.mjs` is additive; `adapter.mjs` v1 keeps working unchanged. If a repo has both, `adapter.mjs` wins and `check` warns.

## Acceptance

- k-twitch with `map.mjs` in place of `adapter.mjs` gives the same `sinopia check --json` numbers as the adapter recorded on 2026-11-21: passes, isolated 5 of 130, part-to-part 45, routes 19, links import 234, trpc 140, event 14, http 5, config 4, ws 1, spawn 1, 6 info gaps.
- `map.mjs` for k-twitch is under 80 lines, and links from `custom()` are under 10% of non-import links. If either fails, the report says which mechanism didn't fit and why. That is a finding, not a failure.
- A project that calls `runCli` with its own adapter is untouched and still passes.

## Tasks

1. **Template matcher.** `src/rules/template.ts`: compile `ee.emit({key}` to an anchored regex with whole-key matching (`counter.increment` never matches `counter.incrementBy`); strip comments first. Unit tests from k-twitch's real call shapes.
2. **Move the shared parsing into the core.** `stripJsComments`, `matchBracket`, `objectEntries`, `stripPy` from k-twitch's adapter into `src/rules/parse.ts`, with tests.
3. **`link` primitive.** `src/rules/link.ts`: index the answering side by key, walk the calling side, add links or `unmatched-<kind>` warning gaps. Tests on a fixture repo.
4. **Named primitives**, one at a time, each lifted from k-twitch and generalised by parameters only: `trpc`, `httpRoutes` (incl. the client connection to `/trpc` and `/ws`), `spawn`, `configFiles`, `vueRoutes`, `pythonImports`, `external`. One commit each, each with a fixture test.
5. **Loader.** `src/loadAdapter.ts`: `.sinopia/map.mjs` becomes an adapter (the generic `js` or `plain` base plus the rules). `why` and `draft` travel into `graph.gaps` as `info` notes; `check` prints drafts, raw regexes and custom-link share.
6. **`sinopia map init`** next to `adapter init`: writes an empty `map.mjs` with the primitives listed in a comment.
7. **Parity on k-twitch** on a branch there: write `map.mjs`, delete `adapter.mjs`, compare `check --json` with the numbers above. Record the result at the top of `map.mjs`.
8. **Docs and skill.** `docs/adapters.md`: a "Rules" section before "The module", which becomes the escape hatch. `skills/sinopia-adapter/SKILL.md`: write rules first, `custom()` second, a full adapter last; mark everything it writes `draft: true`; when a `custom()` block looks reusable, say so in the report as a candidate primitive.
9. **Build and check.** `pnpm build`, `pnpm check`, `pnpm test`; commit `dist/` and `viewer-dist/` as the README requires.

## Risks

- **Generalising from one repo.** Every primitive here is lifted from k-twitch. The second repo will break some of them. Mitigation: the acceptance allows `custom()`, and the skill reports candidate primitives, so the vocabulary grows from real misses.
- **Templates can't express everything.** k-twitch's event bus goes through `emitFoo` wrapper functions and constant names. If `link` can't follow that, it goes into `custom()` and the parity report says so.
- **Two ways to tailor.** Rules and adapters coexist. The docs must say which to reach for, rules first.
