import { checkOptions, describeScope, makeRule } from './context.js';
import { lineOf, objectEntries } from './parse.js';
const KEYS = ['routers', 'callers', 'client', 'router', 'procedure', 'connection'];
const list = (value) => (Array.isArray(value) ? value : [value]);
const words = (values) => values.map((v) => v.replace(/[.$]/g, '\\$&')).join('|');
const SCRIPT = /\.(m?[jt]s|vue)$/;
/** Every procedure path (`counters.increment`) with the file that declares it. */
const procedures = (ctx, options) => {
    const routerCall = words(list(options.router));
    const procedureStart = new RegExp(`^(?:${words(list(options.procedure))})\\b`);
    const nestedRouter = new RegExp(`^(?:${routerCall})\\(\\s*\\{`);
    const routers = new Map();
    for (const file of ctx.files(options.routers)) {
        if (!SCRIPT.test(file.id))
            continue;
        const text = ctx.code(file.id);
        for (const m of text.matchAll(new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${routerCall})\\(\\s*\\{`, 'g'))) {
            const name = m[1];
            const existing = routers.get(name);
            if (existing) {
                ctx.addGap({ kind: 'duplicate-trpc-router', level: 'warning', file: file.id, detail: `router name ${name} also declared in ${existing.file}` });
                continue;
            }
            routers.set(name, { file: file.id, text, open: m.index + m[0].length - 1 });
        }
    }
    const referenced = new Set();
    const procs = new Map();
    const isRouterName = (value) => /^[A-Za-z_$][\w$]*$/.test(value) && routers.has(value);
    const walk = (file, text, open, prefix, seen) => {
        for (const entry of objectEntries(text, open)) {
            const path = prefix ? `${prefix}.${entry.key}` : entry.key;
            if (procedureStart.test(entry.value)) {
                procs.set(path, file);
            }
            else if (nestedRouter.test(entry.value)) {
                walk(file, text, text.indexOf('{', entry.start), path, seen);
            }
            else if (isRouterName(entry.value)) {
                referenced.add(entry.value);
                if (seen.has(entry.value))
                    continue;
                const r = routers.get(entry.value);
                if (r)
                    walk(r.file, r.text, r.open, path, new Set([...seen, entry.value]));
            }
            else {
                ctx.addGap({ kind: 'unknown-trpc-entry', level: 'warning', file, detail: `${path}: ${entry.value.slice(0, 60)}` });
            }
        }
    };
    for (const r of routers.values()) {
        for (const entry of objectEntries(r.text, r.open))
            if (isRouterName(entry.value))
                referenced.add(entry.value);
    }
    for (const [name, r] of routers)
        if (!referenced.has(name))
            walk(r.file, r.text, r.open, '', new Set([name]));
    return procs;
};
export const trpc = (options) => {
    checkOptions('trpc', options, KEYS);
    if (!options.routers)
        throw new Error("trpc(): 'routers' is required: the folder where the server declares its routers");
    const client = options.client ?? 'trpc';
    const router = options.router ?? 't.router';
    const procedure = options.procedure ?? 't.procedure';
    const summary = `tRPC: ${client}.<procedure> calls → routers in ${describeScope(options.routers)}`;
    return makeRule('trpc', options, summary, [], (ctx) => {
        const procs = procedures(ctx, { routers: options.routers, router, procedure });
        const callers = ctx
            .files(options.callers)
            .filter((file) => SCRIPT.test(file.id) && (options.callers !== undefined || !ctx.inScope(file.id, options.routers)));
        const imports = new RegExp(`import\\s+(?:type\\s+)?\\{[^}]*\\b${client}\\b[^}]*\\}\\s+from`);
        const call = new RegExp(`(?<![\\w$.])${client}((?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)+)`, 'g');
        if (procs.size > 0) {
            for (const file of callers) {
                if (!imports.test(ctx.read(file.id)))
                    continue;
                const text = ctx.code(file.id);
                for (const m of text.matchAll(call)) {
                    if (/\btypeof\s+$/.test(text.slice(Math.max(0, m.index - 20), m.index)))
                        continue;
                    const segs = m[1].split('.').map((s) => s.trim()).filter(Boolean);
                    let matched = null;
                    for (let i = 1; i <= segs.length && !matched; i++) {
                        const path = segs.slice(0, i).join('.');
                        if (procs.has(path))
                            matched = path;
                    }
                    const target = matched ? procs.get(matched) : undefined;
                    if (matched && target)
                        ctx.addLink(file, { target, kind: 'trpc', label: matched });
                    else {
                        ctx.addGap({
                            kind: 'unmatched-trpc',
                            level: 'warning',
                            file: file.id,
                            detail: `${client}.${segs.join('.')} (line ${lineOf(text, m.index)}) matches no procedure`,
                        });
                    }
                }
            }
        }
        if (options.connection === false)
            return;
        const server = ctx.files(options.routers).filter((file) => SCRIPT.test(file.id));
        const httpMounts = [];
        const sockets = [];
        for (const file of server) {
            const text = ctx.code(file.id);
            if (/createHTTPHandler/.test(text)) {
                for (const m of text.matchAll(/req\.url\??\.startsWith\(\s*'([^']+)'\s*\)/g)) {
                    if (/\bhandler\(req,\s*res\)/.test(text.slice(m.index, m.index + 300)))
                        httpMounts.push({ file: file.id, path: m[1] });
                }
            }
            const ws = /new\s+WebSocketServer\(\s*\{[^}]*\bpath:\s*'([^']+)'/.exec(text);
            if (ws)
                sockets.push({ file: file.id, path: ws[1] });
        }
        // The client names the path itself or through a file it imports (the URL builder).
        const mentions = (file, path) => {
            const re = new RegExp(`${path.replace(/[/.]/g, '\\$&')}(?![\\w/-])`);
            return [file.id, ...file.imports].some((id) => ctx.ids.has(id) && re.test(ctx.code(id)));
        };
        for (const file of callers) {
            const text = ctx.code(file.id);
            if (/\bhttp(?:Batch)?Link\(/.test(text)) {
                for (const r of httpMounts)
                    if (mentions(file, r.path))
                        ctx.addLink(file, { target: r.file, kind: 'http', label: `${r.path} (tRPC over HTTP)` });
            }
            if (/\bcreateWSClient\(/.test(text)) {
                for (const s of sockets)
                    if (mentions(file, s.path))
                        ctx.addLink(file, { target: s.file, kind: 'ws', label: `${s.path} (tRPC subscriptions)` });
            }
        }
    });
};
