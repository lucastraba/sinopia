/** Every link out of a file, with its kind: imports, rendered components and the adapter's own links. */
export const fileLinks = (file) => [
    ...file.imports.map((target) => ({ target, kind: 'import', label: null })),
    ...file.components.flatMap((use) => use.target ? [{ target: use.target, kind: 'component', label: use.tag }] : []),
    ...(file.links ?? []),
];
/** Link kinds that are calls to a server: they count as server calls, like the operations an adapter lists. */
export const SERVER_CALL_KINDS = ['graphql', 'trpc', 'http'];
/** The server calls a file makes: its operations, then its server-call links, once per name. */
export const serverCallsOf = (file) => {
    const calls = new Map();
    for (const name of file.operations)
        calls.set(name, { name, kind: 'operation', target: null });
    for (const link of file.links ?? []) {
        if (!SERVER_CALL_KINDS.includes(link.kind))
            continue;
        const name = link.label ?? link.target;
        if (!calls.has(name))
            calls.set(name, { name, kind: link.kind, target: link.target });
    }
    return [...calls.values()];
};
/** The distinct file ids a file links to, whatever the kind. */
export const linkTargets = (file) => [
    ...new Set(fileLinks(file).map((link) => link.target)),
];
/**
 * Adds a link to a file node, once per target, kind and label. For adapters
 * that find links the generic scan can't see.
 */
export const addLink = (file, link) => {
    const links = (file.links ??= []);
    if (!links.some((existing) => existing.target === link.target &&
        existing.kind === link.kind &&
        existing.label === link.label)) {
        links.push(link);
    }
};
