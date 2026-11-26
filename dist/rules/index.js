import { pathToFileURL } from 'node:url';
import { ADAPTER_INTERFACE_VERSION } from '../adapter.js';
import { listFiles } from '../adapters/files.js';
import { chooseMode, folderAdapter } from '../adapters/folders.js';
import { ruleContext } from './context.js';
import { http } from './http.js';
import { link } from './link.js';
import { makeResolver } from './resolve.js';
import { custom, dataFiles, external, externalServices, pythonImports, runs, spawn, vitest, vueRoutes } from './tools.js';
import { trpc } from './trpc.js';
import { globImports } from './vite.js';
import { checkSpecs } from '../claims.js';
import { vueComponents } from './vue.js';
import { graphql } from './graphql.js';
/** Where a project keeps its map rules. `sinopia` loads them by default when they exist. */
export const LOCAL_MAP = '.sinopia/map.mjs';
/** The primitives a map file gets: its default export is `(primitives) => rules`. */
export const primitives = {
    link,
    trpc,
    http,
    graphql,
    spawn,
    vitest,
    vueRoutes,
    vueComponents,
    globImports,
    pythonImports,
    dataFiles,
    runs,
    externalServices,
    external,
    custom,
};
/** Runs the rules over a graph in order, writing what each did to `graph.meta.rules`. */
export const applyRules = (rules, graph, input) => {
    const cache = new Map();
    // One resolver for every rule: configs are read once, and every primitive resolves `@/x` the same way.
    const resolver = makeResolver(input.root, () => listFiles(input.root));
    const reports = [];
    for (const rule of rules) {
        const report = {
            rule: rule.rule,
            summary: rule.summary,
            why: rule.why,
            draft: rule.draft,
            regexes: rule.templates.filter((t) => t.raw).length,
            links: {},
            routes: 0,
            gaps: 0,
        };
        try {
            rule.run(ruleContext(graph, input, report, cache, resolver));
        }
        catch (error) {
            graph.gaps.push({
                kind: 'rule-failed',
                level: 'error',
                file: null,
                detail: `${rule.rule} (${rule.summary}) threw: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`.slice(0, 2000),
            });
        }
        reports.push(report);
    }
    graph.meta.rules = reports;
};
/** An adapter from a map file: the generic adapter, then the file's rules. */
export const mapAdapter = async (file, repo, name) => {
    const module = (await import(pathToFileURL(file).href));
    if (typeof module.default !== 'function') {
        throw new Error(`${file} must export a default function ({ link, trpc, … }) => [rules]`);
    }
    const rules = (await module.default(primitives));
    if (!Array.isArray(rules) || rules.some((rule) => typeof rule?.run !== 'function')) {
        throw new Error(`${file}: the default export must return a list of rules, each made by a primitive (link(...), trpc(...), custom(...))`);
    }
    const mode = module.base === 'js' || module.base === 'plain' ? module.base : chooseMode(listFiles(repo));
    if (module.base !== undefined && module.base !== mode)
        throw new Error(`${file}: base must be 'js' or 'plain', not ${JSON.stringify(module.base)}`);
    const problems = checkSpecs(module.areas, module.claims);
    if (problems.length > 0)
        throw new Error(`${file}: ${problems.join('; ')}`);
    const base = folderAdapter(repo, { mode, name });
    return {
        ...base,
        interfaceVersion: ADAPTER_INTERFACE_VERSION,
        name: `${mode} + map rules`,
        areas: module.areas ?? null,
        claims: module.claims ?? [],
        async scan(input) {
            const graph = await base.scan(input);
            applyRules(rules, graph, input);
            return graph;
        },
    };
};
