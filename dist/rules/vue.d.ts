import { type CommonOptions, type Rule, type Scope } from './context.js';
export interface VueComponentsOptions extends CommonOptions {
    /** Files that render components. Default: the whole repo. */
    in?: Scope;
    /**
     * The `components.d.ts` files unplugin-vue-components writes (or a hand-written
     * `GlobalComponents` declaration). Their names apply to every file in `in`.
     * Default: every `components.d.ts` in the repo, each for the files of its own
     * app (the folder of the nearest package.json or vite.config above it).
     */
    dts?: string | string[];
    /** Folders whose `.vue` files are registered by file name, as unplugin's `dirs` (`'src/components'`). */
    dirs?: Scope;
    /** Registries that name a component and its file: templates with `{key}` and `{path}`: `'{key}: () => import({path}'`. */
    registries?: string | RegExp | (string | RegExp)[];
    /** Places a component is named as a value rather than a tag: templates with `{key}`: `'component: {key}'`. */
    byName?: string | RegExp | (string | RegExp)[];
}
/** `my-thing` → `MyThing`; a PascalCase name stays as it is. */
export declare const pascalName: (name: string) => string;
/** Tags in a .vue file's template that can be components: PascalCase or kebab-case with a dash. */
export declare const templateTags: (text: string) => {
    name: string;
    index: number;
}[];
/** Tags in `template: '…'` strings of a script (Storybook stories, the runtime compiler). */
export declare const templateOptionTags: (code: string) => {
    name: string;
    index: number;
}[];
/**
 * Components Vue resolves by name rather than by an import: tags in
 * templates (`<TodoItem>`, `<todo-item>`) and names passed as values, linked
 * to the `.vue` file behind the name. Names come from a file's own imports
 * first, then `app.component('Name', …)`, the map's `registries`,
 * unplugin-vue-components' `components.d.ts`, and its `dirs`.
 */
export declare const vueComponents: (options?: VueComponentsOptions) => Rule;
