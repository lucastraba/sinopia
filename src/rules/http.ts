import { checkOptions, type CommonOptions, describeScope, makeRule, type Rule, type Scope, templatesOf } from './context.js';
import { matchAll } from './template.js';

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

const KEYS = ['server', 'clients', 'routes'];

/** A file that talks HTTP at all: without one of these, its path strings are something else (file paths, keys). */
const HTTP_CLIENT = /\bfetch\(|\baxios\b|\bhttpx\b|\brequests\b|\burllib\b|\baiohttp\b|\bky\b|\bgot\(/;

/**
 * The URL paths a client file calls:
 * - interpolated strings built on a base, `f"{cfg.url}/control/voice"` or `${base}/api/x`;
 * - the same through a variable holding one, `f"{self._endpoint}/roster"`;
 * - a path literal of two or more segments passed as an argument, `send("/ingest/subtitle", …)`.
 * A variable that holds a base (`BASE = f"{url}/api"`) is only a call where
 * code passes it on as it is: `httpx.get(BASE)`.
 */
export const calledPaths = (text: string): Set<string> => {
  // Not a keyword argument (`get(url=f"…")`): that one is a call.
  const based = /(?<![\w.]|[(,]\s*)([\w.]+)\s*=\s*(?:f["']\{|`\$\{)([\w.]+)\}(\/[\w/-]*)["'`]/g;
  const composed = /(?:f["']\{|`\$\{)([\w.]+)\}(\/[\w/-]*)["'`]/g;
  const passedOn = /(?:\(|\burl\s*=)\s*([\w.]+)\s*[,)]/g;
  type Step = { at: number; kind: 'set' | 'use' | 'pass'; m: RegExpMatchArray };
  const steps: Step[] = [];
  const valueAt = new Set<number>();
  for (const m of text.matchAll(based)) {
    steps.push({ at: m.index as number, kind: 'set', m });
    valueAt.add((m.index as number) + m[0].length - m[0].replace(/^[\w.]+\s*=\s*/, '').length);
  }
  for (const m of text.matchAll(composed)) if (!valueAt.has(m.index as number)) steps.push({ at: m.index as number, kind: 'use', m });
  for (const m of text.matchAll(passedOn)) steps.push({ at: m.index as number, kind: 'pass', m });
  // In source order, so each use takes the base its name holds at that point:
  // `BASE = f"{url}/v1"`, a call, `BASE = f"{url}/v2"`, a call gives /v1/… then /v2/….
  steps.sort((x, y) => x.at - y.at);
  const vars = new Map<string, string>();
  const paths = new Set<string>();
  for (const { kind, m } of steps) {
    const name = m[1] as string;
    // A base built on another base: `ITEMS = f"{BASE}/items"`.
    if (kind === 'set') vars.set(name, (vars.get(m[2] as string) ?? '') + (m[3] as string));
    else if (kind === 'use') paths.add((vars.get(name) ?? '') + (m[2] as string));
    else if (vars.has(name)) paths.add(vars.get(name) as string);
  }
  for (const m of text.matchAll(/\(\s*["'`](\/[\w-]+(?:\/[\w-]+)+)["'`]/g)) paths.add(m[1] as string);
  return paths;
};

export const http = (options: HttpOptions): Rule => {
  checkOptions('http', options, KEYS);
  // An empty scope is the whole repo; only a missing one is wrong.
  if (options.server === undefined || options.clients === undefined || options.routes === undefined) throw new Error("http(): needs 'server', 'clients' and 'routes'");
  const routes = templatesOf(options.routes);
  for (const t of routes) if (!t.names.includes('path')) throw new Error(`http(): the route shape ${t.source} has no {path}`);
  const summary = `HTTP: calls in ${describeScope(options.clients)} → routes (${routes.map((t) => t.source).join(' | ')}) in ${describeScope(options.server)}`;

  return makeRule('http', options, summary, routes, (ctx) => {
    const declared: { file: string; path: string; method: string | null }[] = [];
    for (const file of ctx.files(options.server)) {
      for (const m of matchAll(routes, ctx.code(file.id))) {
        const path = m.values.path;
        // A string template's path must be a string literal; a regular expression's capture is the path itself.
        if (!path || (!path.quoted && !m.raw)) continue;
        // `'GET'` in `req.method === 'GET'`, or `get` in `app.get(`.
        const method = m.values.method?.value.toUpperCase() ?? null;
        declared.push({ file: file.id, path: path.value, method });
      }
    }
    if (declared.length === 0) return;
    for (const file of ctx.files(options.clients)) {
      const text = ctx.code(file.id);
      if (!HTTP_CLIENT.test(text)) continue;
      for (const path of calledPaths(text)) {
        const hits = declared.filter((r) => r.path === path);
        if (hits.length === 0) {
          ctx.addGap({ kind: 'unmatched-http', level: 'warning', file: file.id, detail: `${path} matches no server route` });
          continue;
        }
        for (const r of hits) ctx.addLink(file, { target: r.file, kind: 'http', label: `${r.method ? `${r.method} ` : ''}${r.path}` });
      }
    }
  });
};
