import { checkOptions, describeScope, makeRule, templatesOf } from './context.js';
import { matchAll } from './template.js';
const KEYS = ['server', 'clients', 'routes'];
/** A file that talks HTTP at all: without one of these, its path strings are something else (file paths, keys). */
const HTTP_CLIENT = /\bfetch\(|\baxios\b|\bhttpx\b|\brequests\b|\burllib\b|\baiohttp\b|\bky\b|\bgot\(/;
/**
 * The URL paths a client file calls:
 * - interpolated strings built on a base, `f"{cfg.url}/control/voice"` or `${base}/api/x`;
 * - the same through a variable holding one, `f"{self._endpoint}/roster"`;
 * - a path literal of two or more segments passed as an argument, `send("/ingest/subtitle", …)`.
 */
export const calledPaths = (text) => {
    const vars = new Map();
    const based = /([\w.]+)\s*=\s*(?:f["']\{[^}]+\}|`\$\{[^}]+\})(\/[\w/-]*)["'`]/g;
    for (const m of text.matchAll(based))
        vars.set(m[1], m[2]);
    const paths = new Set(vars.values());
    const composed = /(?:f["']\{|`\$\{)([\w.]+)\}(\/[\w/-]*)["'`]/g;
    for (const m of text.matchAll(composed)) {
        const base = vars.get(m[1]);
        if (base !== undefined)
            paths.add(base + m[2]);
    }
    for (const m of text.matchAll(/\(\s*["'`](\/[\w-]+(?:\/[\w-]+)+)["'`]/g))
        paths.add(m[1]);
    return paths;
};
export const http = (options) => {
    checkOptions('http', options, KEYS);
    if (!options.server || !options.clients || !options.routes)
        throw new Error("http(): needs 'server', 'clients' and 'routes'");
    const routes = templatesOf(options.routes);
    for (const t of routes)
        if (!t.names.includes('path'))
            throw new Error(`http(): the route shape ${t.source} has no {path}`);
    const summary = `HTTP: calls in ${describeScope(options.clients)} → routes (${routes.map((t) => t.source).join(' | ')}) in ${describeScope(options.server)}`;
    return makeRule('http', options, summary, routes, (ctx) => {
        const declared = [];
        for (const file of ctx.files(options.server)) {
            for (const m of matchAll(routes, ctx.code(file.id))) {
                const path = m.values.path;
                if (!path?.quoted)
                    continue;
                // `'GET'` in `req.method === 'GET'`, or `get` in `app.get(`.
                const method = m.values.method?.value.toUpperCase() ?? null;
                declared.push({ file: file.id, path: path.value, method });
            }
        }
        if (declared.length === 0)
            return;
        for (const file of ctx.files(options.clients)) {
            const text = ctx.code(file.id);
            if (!HTTP_CLIENT.test(text))
                continue;
            for (const path of calledPaths(text)) {
                const hits = declared.filter((r) => r.path === path);
                if (hits.length === 0) {
                    ctx.addGap({ kind: 'unmatched-http', level: 'warning', file: file.id, detail: `${path} matches no server route` });
                    continue;
                }
                for (const r of hits)
                    ctx.addLink(file, { target: r.file, kind: 'http', label: `${r.method ? `${r.method} ` : ''}${r.path}` });
            }
        }
    });
};
