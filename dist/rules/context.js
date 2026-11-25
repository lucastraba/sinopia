import { join } from 'node:path';
import { folderPartOf, listFiles, readText, sha1 } from '../adapters/files.js';
import { fileKindOf, largeFile } from '../adapters/folders.js';
import { addLink } from '../links.js';
import { globScope, isGlob } from './glob.js';
import { stripComments } from './parse.js';
import { makeResolver } from './resolve.js';
import { compileTemplate } from './template.js';
/** Rules read files up to this size; the scan maps bigger ones without their text. */
const RULE_READ_BYTES = 5_000_000;
export const scopeList = (scope) => scope === undefined ? [] : (Array.isArray(scope) ? scope : [scope]).map((path) => path.replace(/^\.\/|\/+$/g, ''));
export const inScope = (id, scope) => {
    const paths = scopeList(scope);
    return (paths.length === 0 ||
        paths.some((path) => (isGlob(path) ? globScope(path).test(id) : path === '' || path === '.' || id === path || id.startsWith(`${path}/`))));
};
/** Test files: mapped as tests, plus pytest's conftest.py. Rules never look at them. */
export const isTestFile = (file) => file.kind === 'test' || /(^|\/)conftest\.py$/.test(file.id);
/** A context for one rule, counting what it adds into `report`. `cache` and `resolver` are shared by the rules of one scan. */
export const ruleContext = (graph, input, report, cache, resolver = makeResolver(input.root, () => listFiles(input.root))) => {
    const byId = new Map(graph.files.map((file) => [file.id, file]));
    const ids = new Set(byId.keys());
    const read = (id) => {
        let text = cache.get(id);
        if (text === undefined) {
            try {
                text = readText(join(input.root, id), RULE_READ_BYTES) ?? '';
            }
            catch {
                text = '';
            }
            cache.set(id, text);
        }
        return text;
    };
    const stripped = new Map();
    const count = (kind) => {
        report.links[kind] = (report.links[kind] ?? 0) + 1;
    };
    return {
        graph,
        input,
        ids,
        byId,
        read,
        code: (id) => {
            let text = stripped.get(id);
            if (text === undefined) {
                text = stripComments(id, read(id));
                stripped.set(id, text);
            }
            return text;
        },
        files: (scope) => graph.files.filter((file) => !isTestFile(file) && inScope(file.id, scope)),
        inScope,
        addLink: (file, link) => {
            const before = file.links?.length ?? 0;
            addLink(file, link);
            if ((file.links?.length ?? 0) > before)
                count(link.kind);
        },
        addComponent: (file, use) => {
            if (file.components.some((existing) => existing.target === use.target && existing.tag === use.tag && existing.byName === use.byName))
                return;
            file.components.push(use);
            count('component');
        },
        resolve: (from, spec) => resolver.resolve(from, spec, (id) => ids.has(id)),
        pathOf: (from, spec) => resolver.toPath(from, spec),
        addImport: (file, target) => {
            if (target === file.id || file.imports.includes(target))
                return;
            file.imports.push(target);
            count('import');
        },
        addGap: (gap) => {
            const key = `${gap.kind}|${gap.file}|${gap.detail}`;
            if (graph.gaps.some((g) => `${g.kind}|${g.file}|${g.detail}` === key))
                return;
            graph.gaps.push(gap);
            report.gaps++;
        },
        addRoute: (route) => {
            graph.routes.push(route);
            report.routes++;
        },
        addFile: (id) => {
            const existing = byId.get(id);
            if (existing)
                return existing;
            let text;
            let large = null;
            try {
                text = readText(join(input.root, id), RULE_READ_BYTES);
                // Too big to read whole: on the map all the same, with a note.
                if (text === null)
                    large = largeFile(input.root, id);
            }
            catch {
                // Missing or unreadable: the rule gets null, as promised, and goes on.
                return null;
            }
            if (text === null && !large)
                return null;
            if (large)
                graph.gaps.push(large.gap);
            const folders = new Map(graph.parts.map((part) => [
                part.dir,
                { id: part.id, kind: part.kind === 'package' ? 'package' : part.dir === '' ? 'root' : 'folder', name: part.name, dir: part.dir },
            ]));
            const home = folderPartOf(id, folders);
            let part = graph.parts.find((p) => p.id === home.id);
            if (!part) {
                part = { ...home, files: [] };
                graph.parts.push(part);
                graph.parts.sort((a, b) => a.id.localeCompare(b.id));
            }
            part.files.push(id);
            const file = {
                id,
                part: part.id,
                kind: large?.kind ?? fileKindOf(id),
                lines: large?.lines ?? text.split('\n').length,
                hash: large?.hash ?? sha1(text),
                imports: [],
                libraries: [],
                components: [],
                operations: [],
                flags: [],
                registeredAs: null,
            };
            graph.files.push(file);
            byId.set(id, file);
            ids.add(id);
            report.files = (report.files ?? 0) + 1;
            return file;
        },
    };
};
export const COMMON_KEYS = ['why', 'draft'];
/** Refuses options a primitive doesn't know, so a typo in the map fails loudly instead of doing nothing. */
export const checkOptions = (rule, options, allowed) => {
    const unknown = Object.keys(options).filter((key) => !allowed.includes(key) && !COMMON_KEYS.includes(key));
    if (unknown.length > 0) {
        throw new Error(`${rule}(): unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}. It takes: ${[...allowed, ...COMMON_KEYS].join(', ')}.`);
    }
};
export const templatesOf = (value) => value === undefined ? [] : (Array.isArray(value) ? value : [value]).map(compileTemplate);
export const describeScope = (scope) => {
    const paths = scopeList(scope);
    return paths.length === 0 ? 'the whole repo' : paths.join(', ');
};
export const makeRule = (rule, options, summary, templates, run) => ({ rule, summary, why: options.why ?? null, draft: options.draft === true, templates, run });
