# Sinopia: a map you drill into

Status: decisions made 2026-11-25 (below); M0 mockups in progress. Nothing built in the viewer yet.

## Goal

Open a map and understand the app in a minute, then go one level deeper at a time: the app in a sentence and a handful of areas, an area's parts and how it talks to the other areas, a part's files, a file. Each level answers "what is this and what does it talk to" in plain words. Today the map is closer to a dependency graph: it shows everything at once, at one level.

## What Sinopia has today

Counted from the maps in `~/.local/share/sinopia/maps` (part-to-part = distinct ordered pairs of parts with at least one import or link between them):

- **Three views.** The app (every part as a card, grouped as Packages / Folders / Top level), one part (its files, the parts it uses, its server calls) and one screen (a route, the components it renders, the server calls). Plain / Developer switches the wording.
- **Parts are folders.** Fine for small repos: Rug Pull has 19 parts and 70 part-to-part pairs, k-twitch 19 and 45, Spare Me 13 and 26.
- **It breaks on a big app.** A private 2,300-file Vue/GraphQL app has 207 parts and 1,642 part-to-part pairs. Grouping by top folder puts 108 of the 207 parts in one bucket (the main app). There is no level between "the whole app" and "one folder", so the first screen is a wall of cards.
- **Lines between parts are unnamed.** An edge says "these two parts are connected", not how (uses, asks the server, tells, runs) or how much.
- **Descriptions exist for the app, every part, file and server call.** Every map except the big app has them. They're written per folder, so there is nothing describing a group of folders.
- **The rules in `.sinopia/map.mjs` are machinery.** They find connections. Nobody should need to read them to understand the app.

## The shape

Four levels, plus Screens as a second way in (unchanged).

| Level | Shows | Comes from |
|---|---|---|
| 0. Overview | One paragraph about the app, 3–9 **areas**, the named connections between them, and the **claims** with a pass/fail mark | `areas` and `claims` in `.sinopia/map.mjs`, descriptions |
| 1. Area | The area's parts, and its connections to other areas, each with a verb and a count | scan + areas |
| 2. Part | Files, the parts it uses, server calls (today's part view) | scan |
| 3. File | Description and links (today's side panel) | scan + describe |

**Areas** are what a person means by "a piece of the app": game rules, the screen, the desktop shell, content, tooling. They're not folders. A folder grouping can't find them on a big app (108 parts in one bucket). So the repo says what its areas are. An agent drafts them; you confirm or move a folder; small repos get a fallback grouping and can skip the level.

**Connections get a verb.** An area-to-area line folds every file link into one line per kind: *uses* (imports), *asks the server* (graphql, trpc, http), *tells* (events), *talks to the desktop* (ipc, bridge), *runs* (scripts), *reads* (data files). Thickness shows the count; tapping it lists a few real examples.

**Claims** are statements about the shape that the scan proves or flags: "the game rules never import the screen". They sit on the overview, green or red. Red opens the offending links. They're the readable layer of a Sinopia map; the rules stay underneath.

### A real example: Rug Pull

From Rug Pull's current map, grouped into five areas by hand (the grouping is my draft; the counts are real):

```
areas:   Game rules (src/game*)   Screen (src/ui*, src/styles)   Desktop (electron, src/platform)
         Content (content)        Tooling (scripts, .github, tests)

Screen     ── uses 221 ──▶  Game rules
Game rules ── tells 40 ──▶  Screen          (events through the outbox)
Game rules ── reads 33 ──▶  Content
Screen     ── uses 10  ──▶  Desktop
Tooling    ── uses 265 ──▶  Game rules      (tests and balance sims)

claim: "The game rules never import the screen"   ✓  (0 imports; it only tells, 40 events)
```

Five areas and about ten named lines instead of 19 cards and 70 unnamed lines. The claim is the sentence from Rug Pull's own rules ("the sim never touches Vue"), and the scan proves it.

How it would read in `.sinopia/map.mjs` (illustrative syntax):

```js
export const areas = {
  'Game rules': { folders: ['src/game'], why: 'The simulation: rules, systems, content loading. No Vue.', draft: true },
  Screen:       { folders: ['src/ui', 'src/styles'], why: 'Everything you see; drains the sim\'s outbox.', draft: true },
  // …
};

export const claims = [
  { says: 'The game rules never import the screen', never: { from: 'Game rules', to: 'Screen', kind: 'import' }, draft: true },
];
```

## Pieces

1. **Areas in the model.** `areas` in `map.mjs`; each part belongs to one area; unassigned parts land in "Other" and `check` lists them. Fallback without `areas`: today's grouping, and repos with fewer than about 12 parts skip level 1.
2. **Area view and overview.** Area-to-area lines folded by kind with verbs and counts; tap a line for examples; tap an area to open level 1.
3. **Claims.** Three forms cover everything drafted so far: `never` (A never reaches B), `only` (only A reaches B), `through` (A reaches B only through C). `check` evaluates them; the overview shows them; a red claim opens its offending links. On the big app, 7 of 10 drafted claims could be checked from today's scan output; the other 3 need this piece.
4. **Area descriptions.** Written from the part descriptions, not from code, so they're cheap.
5. **The agent skill drafts areas and claims.** The `sinopia-adapter` skill proposes areas and claims after the rules, marked draft, for you to confirm. That's where the review effort goes, not into rules.

## Milestones

- **M0, no code:** mockups of the overview and one area for Rug Pull and for the big app, with real counts, for you to react to. Nothing in the viewer changes.
- **M1:** areas and the overview with named lines (pieces 1–2), first on Rug Pull and k-twitch.
- **M2:** claims (piece 3).
- **M3:** area descriptions and the skill drafting areas and claims (pieces 4–5); then the big app, privately.

## Where it stops

- No more connection-finding primitives unless a claim needs one.
- No editing the app from the map. That's the human layer's job, inside the app; Sinopia only reads.
- Screens stay as they are.

## Decisions for Lucas

Answered 2026-11-25: 1 (a) with (b) as the fallback; 2 skip the area level for small repos; 3 claims on the first screen; 4 M0 first.


1. **Where areas come from.** (a) Written in `map.mjs`, agent-drafted, you confirm. (b) Worked out automatically from the folders. (c) Claude proposes them during `describe`. *Recommended: (a), with (b) as the fallback when there are none.* Folders can't find areas on a big app, and areas are a judgment call that belongs in the readable file.
2. **Small repos.** Skip the area level below about 12 parts, or always show it? *Recommended: skip.* An area of two parts adds a tap and nothing else.
3. **Claims on the first screen, or behind a tab?** *Recommended: first screen.* A red claim is the most useful thing the map can say.
4. **M0 first?** Mockups before code. *Recommended: yes.* We've built twice now before agreeing what the map should show.
