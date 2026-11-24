import { checkOptions, describeScope, makeRule, templatesOf } from './context.js';
import { lineOf } from './parse.js';
import { matchAll } from './template.js';
const KEYS = ['kind', 'in', 'from', 'to', 'call', 'answer', 'wrappers', 'labels'];
const keysOf = (templates, text) => matchAll(templates, text).flatMap((m) => {
    const key = m.values.key;
    return key ? [{ ...key, index: m.index }] : [];
});
/** `export const name =` / `export function name(` declarations, each with the text up to the next export. */
const exportedFunctions = (text) => {
    const out = [];
    for (const m of text.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+([A-Za-z_$][\w$]*)/g)) {
        const next = text.indexOf('export ', m.index + m[0].length);
        out.push({ name: m[1], start: m.index, end: next === -1 ? text.length : next });
    }
    return out;
};
export const link = (options) => {
    checkOptions('link', options, KEYS);
    if (!options.kind)
        throw new Error("link(): 'kind' is required (event, queue, ws-event…)");
    const calls = templatesOf(options.call);
    const answers = templatesOf(options.answer);
    if (answers.length === 0)
        throw new Error(`link(${options.kind}): needs 'answer'`);
    if (calls.length === 0 && options.wrappers)
        throw new Error(`link(${options.kind}): 'wrappers' needs a 'call' shape`);
    for (const t of [...calls, ...answers]) {
        if (!t.names.includes('key'))
            throw new Error(`link(${options.kind}): the shape ${t.source} has no {key}`);
    }
    const from = options.from ?? options.in;
    const to = options.to ?? options.in;
    const callText = calls.length > 0 ? calls.map((t) => t.source).join(' | ') : 'any mention';
    const summary = from === to
        ? `${options.kind}: ${callText} → ${answers.map((t) => t.source).join(' | ')} in ${describeScope(from)}`
        : `${options.kind}: ${callText} in ${describeScope(from)} → ${answers.map((t) => t.source).join(' | ')} in ${describeScope(to)}`;
    return makeRule('link', options, summary, [...calls, ...answers], (ctx) => {
        const answering = new Map();
        for (const file of ctx.files(to)) {
            for (const key of keysOf(answers, ctx.code(file.id))) {
                if (!answering.has(key.value))
                    answering.set(key.value, new Set());
                answering.get(key.value)?.add(file.id);
            }
        }
        const callers = ctx.files(from);
        if (calls.length === 0) {
            // No call shape: a whole-word mention of a declared key is the use.
            const mention = (key) => new RegExp(`(?<![\\w$])${key.replace(/[.*+?^${}()|[\]\\/$]/g, '\\$&')}(?![\\w$])`);
            const tests = [...answering.keys()].map((key) => ({ key, re: mention(key) }));
            for (const file of callers) {
                const text = ctx.code(file.id);
                for (const { key, re } of tests) {
                    if (!re.test(text))
                        continue;
                    for (const target of answering.get(key) ?? [])
                        if (target !== file.id)
                            ctx.addLink(file, { target, kind: options.kind, label: key });
                }
            }
            return;
        }
        const constants = new Map();
        if (options.labels === 'constants') {
            for (const file of new Set([...callers, ...ctx.files(to)])) {
                for (const m of ctx.code(file.id).matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"\n]+)['"]/g)) {
                    constants.set(m[1], m[2]);
                }
            }
        }
        // Helpers that make the call for their callers.
        const helpers = new Map();
        const helperBodies = new Map();
        if (options.wrappers) {
            for (const file of callers) {
                const text = ctx.code(file.id);
                for (const fn of exportedFunctions(text)) {
                    const keys = keysOf(calls, text.slice(fn.start, fn.end));
                    if (keys.length === 0)
                        continue;
                    helpers.set(fn.name, { file: file.id, keys: new Set(keys.map((k) => k.value)) });
                    helperBodies.set(file.id, [...(helperBodies.get(file.id) ?? []), fn]);
                }
            }
        }
        for (const file of callers) {
            const text = ctx.code(file.id);
            const made = new Map();
            const bodies = helperBodies.get(file.id) ?? [];
            for (const key of keysOf(calls, text)) {
                if (bodies.some((b) => key.index >= b.start && key.index < b.end))
                    continue;
                if (!made.has(key.value))
                    made.set(key.value, key.index);
            }
            for (const [name, { file: helperFile, keys }] of helpers) {
                // With imports known (not the plain adapter), only the helper's importers call it.
                if (ctx.graph.meta.hasLinks && file.id !== helperFile && !file.imports.includes(helperFile))
                    continue;
                const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
                for (const m of text.matchAll(re)) {
                    if (/(?:const|function)\s+$/.test(text.slice(Math.max(0, m.index - 12), m.index)))
                        continue;
                    for (const key of keys)
                        if (!made.has(key))
                            made.set(key, m.index);
                }
            }
            for (const [key, index] of made) {
                const label = constants.get(key) ?? key;
                const targets = answering.get(key);
                if (!targets || targets.size === 0) {
                    ctx.addGap({
                        kind: `unmatched-${options.kind}`,
                        level: 'warning',
                        file: file.id,
                        detail: `${label} (line ${lineOf(text, index)}): nothing answers it`,
                    });
                    continue;
                }
                for (const target of targets)
                    if (target !== file.id)
                        ctx.addLink(file, { target, kind: options.kind, label });
            }
        }
    });
};
