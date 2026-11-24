import { type CommonOptions, type Rule, type Scope } from './context.js';
export interface HttpOptions extends CommonOptions {
    /** Where the server declares its routes. */
    server: Scope;
    /** Files that call those routes. */
    clients: Scope;
    /**
     * How a route is declared, with `{path}` and optionally `{method}`:
     * `"app.{method}({path}"`, `"req.url === {path} && req.method === {method}"`.
     * List the longer shape first when two cover the same code.
     */
    routes: string | RegExp | (string | RegExp)[];
}
/**
 * The URL paths a client file calls:
 * - interpolated strings built on a base, `f"{cfg.url}/control/voice"` or `${base}/api/x`;
 * - the same through a variable holding one, `f"{self._endpoint}/roster"`;
 * - a path literal of two or more segments passed as an argument, `send("/ingest/subtitle", …)`.
 */
export declare const calledPaths: (text: string) => Set<string>;
export declare const http: (options: HttpOptions) => Rule;
