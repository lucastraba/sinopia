import { posix } from 'node:path';
import { listFiles } from '../adapters/files.js';
import { checkOptions, describeScope, makeRule, templatesOf } from './context.js';
import { objectEntries, pythonModuleFile, resolveRelative } from './parse.js';
import { matchAll } from './template.js';
/** Python imports between the repo's own modules, as imports. The generic js adapter lists Python files without links. */
export const pythonImports = (options = {}) => {
    checkOptions('pythonImports', options, ['in']);
    return makeRule('pythonImports', options, `Python imports in ${describeScope(options.in)}`, [], (ctx) => {
        for (const file of ctx.graph.files) {
            if (!file.id.endsWith('.py') || !ctx.inScope(file.id, options.in))
                continue;
            const text = ctx.code(file.id);
            const add = (target) => {
                if (target)
                    ctx.addImport(file, target);
            };
            const fromRe = /^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+\(?([^\n)]*(?:\n[^)\n]*)*?)\)?[ \t]*$/gm;
            for (const m of text.matchAll(fromRe)) {
                const dots = m[1];
                const mod = m[2];
                const names = m[3]
                    .split(',')
                    .map((s) => s.trim().split(/\s+as\s+/)[0] ?? '')
                    .filter((s) => /^\w+$/.test(s));
                let modFile;
                if (dots) {
                    let dir = posix.dirname(file.id);
                    for (let i = 1; i < dots.length; i++)
                        dir = posix.dirname(dir);
                    const modPath = mod ? posix.join(dir, mod.replace(/\./g, '/')) : dir;
                    modFile = [`${modPath}.py`, `${modPath}/__init__.py`].find((c) => ctx.ids.has(c)) ?? null;
                }
                else {
                    modFile = pythonModuleFile(ctx.ids, file.id, mod);
                }
                if (!modFile)
                    continue; // a third-party or standard library module
                // `from pkg import sub` may import a submodule.
                let usedSub = false;
                if (modFile.endsWith('/__init__.py')) {
                    const pkgDir = posix.dirname(modFile);
                    for (const name of names) {
                        if (ctx.ids.has(`${pkgDir}/${name}.py`)) {
                            add(`${pkgDir}/${name}.py`);
                            usedSub = true;
                        }
                    }
                }
                if (!usedSub)
                    add(modFile);
            }
            for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm)) {
                for (const mod of m[1].split(',').map((s) => s.trim()))
                    add(pythonModuleFile(ctx.ids, file.id, mod));
            }
        }
    });
};
/** `spawn('cmd', [args])` in the scope, linked to the program it starts: `uv run <script>` resolves through pyproject.toml's [project.scripts]. */
export const spawn = (options = {}) => {
    checkOptions('spawn', options, ['in']);
    return makeRule('spawn', options, `spawn('cmd', [...]) in ${describeScope(options.in)} → the program it starts`, [], (ctx) => {
        const scripts = new Map();
        for (const id of listFiles(ctx.input.root)) {
            if (!id.endsWith('pyproject.toml'))
                continue;
            const section = /\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/.exec(ctx.read(id));
            if (!section)
                continue;
            for (const m of section[1].matchAll(/^\s*([\w-]+)\s*=\s*"([\w.]+):\w+"/gm)) {
                const target = pythonModuleFile(ctx.ids, posix.join(posix.dirname(id), 'x'), m[2]);
                if (target)
                    scripts.set(m[1], target);
            }
        }
        for (const file of ctx.files(options.in)) {
            if (!/\.(m?[jt]s)$/.test(file.id))
                continue;
            for (const m of ctx.code(file.id).matchAll(/\bspawn\(\s*'([\w-]+)'\s*,\s*\[([^\]]*)\]/g)) {
                const args = [...m[2].matchAll(/'([^']*)'/g)].map((a) => a[1]);
                const label = [m[1], ...args].join(' ');
                const script = m[1] === 'uv' && args[0] === 'run' ? args[1] : undefined;
                const target = script ? scripts.get(script) : undefined;
                if (target)
                    ctx.addLink(file, { target, kind: 'spawn', label });
                else
                    ctx.addGap({ kind: 'unmatched-spawn', level: 'warning', file: file.id, detail: `spawn ${label}` });
            }
        }
    });
};
/** Vitest configs linked to the setup files they name, and a workspace file to each project's config. */
export const vitest = (options = {}) => {
    checkOptions('vitest', options, []);
    return makeRule('vitest', options, 'Vitest: configs → setup files, workspace → project configs', [], (ctx) => {
        for (const file of ctx.graph.files) {
            const base = posix.basename(file.id);
            if (/^vitest\.config\.[cm]?[jt]s$/.test(base)) {
                for (const m of ctx.code(file.id).matchAll(/\b(setupFiles|globalSetup)\s*:\s*\[([^\]]*)\]/g)) {
                    for (const [, spec] of m[2].matchAll(/'([^']+)'/g)) {
                        const target = resolveRelative(ctx.ids, file.id, spec?.startsWith('.') ? spec : `./${spec}`);
                        if (target)
                            ctx.addLink(file, { target, kind: 'config', label: m[1] });
                        else
                            ctx.addGap({ kind: 'unmatched-config', level: 'warning', file: file.id, detail: `${m[1]} ${spec}` });
                    }
                }
            }
            else if (/^vitest\.workspace\.[cm]?[jt]s$/.test(base)) {
                const list = /export\s+default\s+\[([^\]]*)\]/.exec(ctx.code(file.id));
                if (!list)
                    continue;
                const root = posix.dirname(file.id) === '.' ? '' : `${posix.dirname(file.id)}/`;
                for (const [, dir] of list[1].matchAll(/'([^']+)'/g)) {
                    const config = ['ts', 'mts', 'js', 'mjs']
                        .map((ext) => `${root}${dir?.replace(/\/$/, '')}/vitest.config.${ext}`)
                        .find((c) => ctx.ids.has(c));
                    if (config)
                        ctx.addLink(file, { target: config, kind: 'config', label: 'workspace project' });
                    else
                        ctx.addGap({ kind: 'unmatched-config', level: 'warning', file: file.id, detail: `workspace project ${dir} has no vitest config` });
                }
            }
        }
    });
};
/** vue-router records (`RouteRecordRaw`) in the scope, as the map's screens. */
export const vueRoutes = (options = {}) => {
    checkOptions('vueRoutes', options, ['in']);
    return makeRule('vueRoutes', options, `vue-router routes in ${describeScope(options.in)}`, [], (ctx) => {
        for (const file of ctx.files(options.in)) {
            if (!/\.ts$/.test(file.id))
                continue;
            const text = ctx.code(file.id);
            if (!/RouteRecordRaw/.test(text))
                continue;
            const defaults = new Map();
            for (const [, local, spec] of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']+)'/g))
                defaults.set(local, spec);
            // Every object literal with a `path:` key.
            for (let i = 0; i < text.length; i++) {
                if (text[i] !== '{')
                    continue;
                const entries = objectEntries(text, i);
                const get = (key) => entries.find((e) => e.key === key)?.value ?? null;
                const path = get('path');
                if (!path || !/^'[^']*'$/.test(path))
                    continue;
                const name = get('name');
                const componentValue = get('component');
                const redirectValue = get('redirect');
                let component = null;
                if (componentValue) {
                    const lazy = /import\(\s*'([^']+)'\s*\)/.exec(componentValue);
                    const spec = lazy ? lazy[1] : (defaults.get(componentValue) ?? null);
                    component = spec ? resolveRelative(ctx.ids, file.id, spec) : null;
                    if (!component) {
                        ctx.addGap({ kind: 'unresolved-route-component', level: 'warning', file: file.id, detail: `${path}: ${componentValue.slice(0, 60)}` });
                    }
                }
                let redirect = null;
                if (redirectValue) {
                    const s = /^'([^']*)'$/.exec(redirectValue);
                    const n = /\bname:\s*'([^']+)'/.exec(redirectValue);
                    redirect = s ? s[1] : n ? `name:${n[1]}` : redirectValue.slice(0, 60);
                }
                const route = {
                    path: path.slice(1, -1),
                    name: name && /^'[^']*'$/.test(name) ? name.slice(1, -1) : null,
                    component,
                    extraComponents: [],
                    feature: null,
                    flags: [],
                    guards: [],
                    redirect,
                    definedIn: file.id,
                };
                ctx.addRoute(route);
            }
        }
    });
};
/**
 * Services outside the repo that JS/TS code reaches with `fetch` on a URL
 * constant or base (`fetch(`${API}/users`)`) or `new WebSocket(url)`. Each
 * becomes a note on the calling file: there's no file to link to.
 */
export const externalServices = (options = {}) => {
    checkOptions('externalServices', options, ['in', 'names']);
    const named = (url) => {
        const hit = Object.entries(options.names ?? {}).find(([, piece]) => url.toLowerCase().includes(piece.toLowerCase()));
        return hit ? ` (${hit[0]})` : '';
    };
    return makeRule('externalServices', options, `fetch and WebSocket to outside services in ${describeScope(options.in)}`, [], (ctx) => {
        for (const file of ctx.files(options.in)) {
            if (!/\.(m?[jt]s)$/.test(file.id))
                continue;
            const text = ctx.code(file.id);
            const urls = new Map();
            for (const [, name, url] of text.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*(?:\n\s*)?'((?:https?|wss?):\/\/[^']+)'/g))
                urls.set(name, url);
            const calls = new Map();
            for (const [, expr, rest, dynamic] of text.matchAll(/\bfetch\(\s*`\$\{([\w.]+)\}([^`$]*)(\$\{(\w+)\})?/g)) {
                const base = urls.get(expr) ?? `{${expr}}`;
                if (!calls.has(base))
                    calls.set(base, new Set());
                calls.get(base)?.add(rest || (dynamic ? `{${dynamic.slice(2, -1)}}` : '/'));
            }
            for (const [base, paths] of calls) {
                ctx.addGap({ kind: 'external-service', level: 'info', file: file.id, detail: `fetch ${base} ${[...paths].sort().join(', ')}${named(base)}` });
            }
            for (const [, variable] of text.matchAll(/new\s+WebSocket\(\s*([\w.]+)/g)) {
                const via = new RegExp(`\\b${variable}\\s*=[^;\\n]*\\b([A-Z][A-Z0-9_]*)\\b`).exec(text);
                const url = urls.get(variable) ?? (via ? urls.get(via[1]) : undefined);
                if (url)
                    ctx.addGap({ kind: 'external-service', level: 'info', file: file.id, detail: `WebSocket ${url}${named(url)}` });
            }
        }
    });
};
/** One service outside the repo, reached through an SDK call: a note on each file that makes the call. */
export const external = (options) => {
    checkOptions('external', options, ['in', 'name', 'call']);
    if (!options.name || !options.call)
        throw new Error("external(): needs 'name' and 'call'");
    const calls = templatesOf(options.call);
    return makeRule('external', options, `${options.name}: ${calls.map((t) => t.source).join(' | ')} in ${describeScope(options.in)}`, calls, (ctx) => {
        for (const file of ctx.files(options.in)) {
            if (matchAll(calls, ctx.code(file.id)).length > 0) {
                ctx.addGap({ kind: 'external-service', level: 'info', file: file.id, detail: options.name });
            }
        }
    });
};
/** Code, for what no primitive can say. `check` counts what custom rules add, so it stays visible. */
export const custom = (options) => {
    checkOptions('custom', options, ['name', 'run']);
    if (typeof options.run !== 'function')
        throw new Error("custom(): 'run' must be a function (ctx) => void");
    return makeRule('custom', options, options.name ?? 'custom code', [], options.run);
};
