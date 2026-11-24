import { join } from 'node:path';
import { readText } from '../adapters/files.js';
import { addLink } from '../links.js';
import { stripComments } from './parse.js';
import { compileTemplate } from './template.js';
export const scopeList = (scope) => scope === undefined ? [] : (Array.isArray(scope) ? scope : [scope]).map((path) => path.replace(/^\.\/|\/+$/g, ''));
export const inScope = (id, scope) => {
    const paths = scopeList(scope);
    return paths.length === 0 || paths.some((path) => path === '' || path === '.' || id === path || id.startsWith(`${path}/`));
};
/** Test files: mapped as tests, plus pytest's conftest.py. Rules never look at them. */
export const isTestFile = (file) => file.kind === 'test' || /(^|\/)conftest\.py$/.test(file.id);
/** A context for one rule, counting what it adds into `report`. */
export const ruleContext = (graph, input, report, cache) => {
    const byId = new Map(graph.files.map((file) => [file.id, file]));
    const ids = new Set(byId.keys());
    const read = (id) => {
        let text = cache.get(id);
        if (text === undefined) {
            text = readText(join(input.root, id), 500_000) ?? '';
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
