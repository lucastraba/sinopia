import { fileLinks } from './links.js';
/** Kinds that hold no code: they're mapped and described, but nothing is expected to link them. */
const NOT_CODE = ['doc', 'config', 'generated', 'test'];
export const coverageOf = (graph, adapter) => {
    const partByFile = new Map(graph.files.map((file) => [file.id, file.part]));
    const linked = new Set();
    const links = {};
    const pairs = new Set();
    const count = (kind, amount = 1) => {
        links[kind] = (links[kind] ?? 0) + amount;
    };
    for (const file of graph.files) {
        if (file.kind === 'test')
            continue;
        for (const link of fileLinks(file)) {
            count(link.kind);
            linked.add(file.id);
            linked.add(link.target);
            const from = file.part;
            const to = partByFile.get(link.target);
            if (to && to !== from)
                pairs.add(`${from} -> ${to}`);
        }
        if (file.operations.length > 0) {
            count('operation', file.operations.length);
            linked.add(file.id);
        }
    }
    const code = graph.files.filter((file) => !NOT_CODE.includes(file.kind));
    const isolated = code
        .filter((file) => !linked.has(file.id))
        .map((file) => file.id)
        .sort();
    const level = (name) => graph.gaps.filter((gap) => gap.level === name).length;
    const largest = graph.parts
        .map((part) => ({ id: part.id, files: part.files.length }))
        .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id))[0];
    return {
        adapter,
        passes: level('error') === 0,
        gaps: { error: level('error'), warning: level('warning'), info: level('info') },
        files: graph.files.length,
        codeFiles: code.length,
        tests: graph.files.filter((file) => file.kind === 'test').length,
        parts: graph.parts.length,
        largestPart: largest ?? null,
        unclaimed: graph.gaps.filter((gap) => gap.kind === 'unpartitioned-file').length,
        isolated: {
            count: isolated.length,
            share: code.length === 0 ? 0 : Math.round((isolated.length / code.length) * 1000) / 1000,
            examples: isolated.slice(0, 15),
        },
        unresolved: graph.gaps.filter((gap) => gap.kind === 'unresolved-import').length,
        links: Object.fromEntries(Object.entries(links).sort(([a], [b]) => a.localeCompare(b))),
        partLinks: pairs.size,
        routes: graph.routes.length,
        operations: graph.operations.length,
    };
};
export const formatCoverage = (coverage) => {
    const percent = (share) => `${(share * 100).toFixed(1)}%`;
    const kinds = Object.entries(coverage.links);
    return [
        `Passes: ${coverage.passes ? 'yes' : 'no'} (${coverage.gaps.error} errors, ${coverage.gaps.warning} warnings, ${coverage.gaps.info} info)`,
        `Files: ${coverage.files} mapped, ${coverage.codeFiles} code, ${coverage.tests} tests, in ${coverage.parts} parts` +
            (coverage.largestPart ? ` (largest: ${coverage.largestPart.id}, ${coverage.largestPart.files} files)` : ''),
        `Files no part claims: ${coverage.unclaimed}`,
        `Isolated code files (no link in or out): ${coverage.isolated.count} of ${coverage.codeFiles} (${percent(coverage.isolated.share)})` +
            (coverage.isolated.examples.length > 0
                ? `: ${coverage.isolated.examples.join(', ')}${coverage.isolated.count > coverage.isolated.examples.length ? ', …' : ''}`
                : ''),
        `Unresolved imports and links: ${coverage.unresolved}`,
        `Links by kind: ${kinds.length > 0 ? kinds.map(([kind, n]) => `${kind} ${n}`).join(', ') : 'none'}`,
        `Part-to-part links: ${coverage.partLinks}`,
        ...(coverage.routes + coverage.operations > 0
            ? [`Routes: ${coverage.routes}, server operations: ${coverage.operations}`]
            : []),
    ];
};
