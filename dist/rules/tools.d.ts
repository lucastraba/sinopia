import { type CommonOptions, type Rule, type RuleContext, type Scope } from './context.js';
export interface ScopeOptions extends CommonOptions {
    in?: Scope;
}
/** Python imports between the repo's own modules, as imports. The generic js adapter lists Python files without links. */
export declare const pythonImports: (options?: ScopeOptions) => Rule;
/** `spawn('cmd', [args])` in the scope, linked to the program it starts: `uv run <script>` resolves through pyproject.toml's [project.scripts]. */
export declare const spawn: (options?: ScopeOptions) => Rule;
/** Vitest configs linked to the setup files they name, and a workspace file to each project's config. */
export declare const vitest: (options?: CommonOptions) => Rule;
/** vue-router records (`RouteRecordRaw`) in the scope, as the map's screens. */
export declare const vueRoutes: (options?: ScopeOptions) => Rule;
export interface ExternalServicesOptions extends ScopeOptions {
    /** Names for the services, by a piece of their URL: `{ Twitch: 'twitch.tv' }`. The first that matches wins. */
    names?: Record<string, string>;
}
/**
 * Services outside the repo that JS/TS code reaches with `fetch` on a URL
 * constant or base (`fetch(`${API}/users`)`) or `new WebSocket(url)`. Each
 * becomes a note on the calling file: there's no file to link to.
 */
export declare const externalServices: (options?: ExternalServicesOptions) => Rule;
export interface ExternalOptions extends ScopeOptions {
    /** What the service is, as the note says it: `ElevenLabs text-to-speech API`. */
    name: string;
    /** The call that reaches it: `'ElevenLabs('`. */
    call: string | RegExp | (string | RegExp)[];
}
/** One service outside the repo, reached through an SDK call: a note on each file that makes the call. */
export declare const external: (options: ExternalOptions) => Rule;
export interface DataFilesOptions extends CommonOptions {
    /** Where the data files are: `'content'`. */
    in: Scope;
    /** Their extensions, without the dot: `['yaml', 'json']`. */
    extensions: string[];
    /** Import aliases the code uses for them: `{ '@content': 'content' }`. Relative imports need none. */
    aliases?: Record<string, string>;
}
/**
 * Data files the code imports (YAML, JSON, CSV…) put on the map, with an
 * import from each file that loads one. The generic scan maps only code, so
 * without this a game's content or an app's fixtures don't exist on the map.
 */
export declare const dataFiles: (options: DataFilesOptions) => Rule;
export interface RunsOptions extends CommonOptions {
    /** The files that start code: `['package.json', '.github/workflows', 'electron-builder.yml']`. */
    from: Scope;
}
/**
 * Files that start code by naming it (package.json scripts, CI workflows,
 * build and service configs, Makefiles) put on the map, with a `runs` link to
 * each repo file they name by path. Scripts nothing imports stop looking
 * orphaned when something in the repo runs them.
 */
export declare const runs: (options: RunsOptions) => Rule;
export interface CustomOptions extends CommonOptions {
    /** Short name for the rule in `check`. */
    name?: string;
    run: (ctx: RuleContext) => void;
}
/** Code, for what no primitive can say. `check` counts what custom rules add, so it stays visible. */
export declare const custom: (options: CustomOptions) => Rule;
