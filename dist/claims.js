// Claims: statements about the app's shape ("the game rules never import the
// screen") that the scan proves or flags. Three forms cover what we've needed:
// never, only and through. No node imports: the viewer may use these too.
import { pickExamples, sortCounts, verbOf } from './areas.js';
import { globToRegExp } from './rules/glob.js';
const FORMS = ['never', 'only', 'through'];
const SIDE_KEYS = ['area', 'areas', 'folders', 'files', 'except'];
const KIND_KEYS = ['kind', 'kinds'];
const RULE_KEYS = {
    never: ['from', 'to', 'each', ...KIND_KEYS],
    only: ['who', 'to', 'from', ...KIND_KEYS],
    through: ['from', 'to', 'via', ...KIND_KEYS],
};
const CLAIM_KEYS = ['says', ...FORMS, 'why', 'draft', 'enforce', 'areas'];
const AREA_KEYS = ['folders', 'why', 'draft'];
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const quote = (value) => JSON.stringify(value);
/** Area names a side names, for the claim's `areas` and the area pages. With `except`, also the names it leaves out, for checking them. */
const sideAreas = (side, withExcept = false) => {
    if (typeof side === 'string')
        return [side];
    if (!isObject(side))
        return [];
    return [
        ...(typeof side.area === 'string' ? [side.area] : []),
        ...(isStrings(side.areas) ? side.areas : []),
        ...(withExcept ? sideAreas(side.except, true) : []),
    ];
};
const SIDES = ['from', 'to', 'who', 'via'];
/** Every area name a claim uses, in its sides (with their `except`) and its `areas`, with where it says it. */
const namesInClaim = (claim) => {
    const form = FORMS.find((candidate) => claim[candidate] !== undefined);
    const rule = form && isObject(claim[form]) ? claim[form] : {};
    return [
        ...SIDES.flatMap((key) => (rule[key] === undefined ? [] : sideAreas(rule[key], true).map((name) => ({ key, name })))),
        ...(isStrings(claim.areas) ? claim.areas.map((name) => ({ key: 'areas', name })) : []),
    ];
};
const unknownName = (label, { key, name }) => key === 'areas' ? `${label}: areas names ${quote(name)}, which the map doesn't have` : `${label}: ${key} names the area ${quote(name)}, which the map doesn't have`;
const claimLabel = (claim, i) => typeof claim.says === 'string' ? `claim ${i + 1} (${quote(claim.says)})` : `claim ${i + 1}`;
const checkAreas = (areas, problems) => {
    const names = new Set();
    if (areas === undefined)
        return names;
    if (!isObject(areas)) {
        problems.push("`areas` must be an object: { 'Area name': { folders: [...], why } }");
        return names;
    }
    for (const [name, spec] of Object.entries(areas)) {
        names.add(name);
        const at = `area ${quote(name)}`;
        if (!isObject(spec)) {
            problems.push(`${at} must be { folders: [...], why }`);
            continue;
        }
        const unknown = Object.keys(spec).filter((key) => !AREA_KEYS.includes(key));
        if (unknown.length)
            problems.push(`${at}: unknown option ${unknown.join(', ')}; an area takes ${AREA_KEYS.join(', ')}`);
        if (!isStrings(spec.folders) || spec.folders.length === 0)
            problems.push(`${at}: folders must be a list of repo-relative folders`);
        if (spec.why !== undefined && typeof spec.why !== 'string')
            problems.push(`${at}: why must be a sentence`);
        if (spec.draft !== undefined && typeof spec.draft !== 'boolean')
            problems.push(`${at}: draft must be true or false`);
    }
    return names;
};
const checkClaim = (claim, i, knownArea, problems) => {
    const at = `claim ${i + 1}`;
    if (!isObject(claim)) {
        problems.push(`${at} must be { says, never | only | through }`);
        return;
    }
    const label = claimLabel(claim, i);
    if (typeof claim.says !== 'string' || !claim.says)
        problems.push(`${at}: says must be the sentence the claim makes`);
    const unknown = Object.keys(claim).filter((key) => !CLAIM_KEYS.includes(key));
    if (unknown.length)
        problems.push(`${label}: unknown option ${unknown.join(', ')}; a claim takes ${CLAIM_KEYS.join(', ')}`);
    const forms = FORMS.filter((form) => claim[form] !== undefined);
    if (forms.length !== 1) {
        problems.push(`${label}: needs exactly one of never, only or through`);
        return;
    }
    const form = forms[0];
    const rule = claim[form];
    if (!isObject(rule)) {
        problems.push(`${label}: ${form} must be an object`);
        return;
    }
    const extra = Object.keys(rule).filter((key) => !RULE_KEYS[form].includes(key));
    if (extra.length)
        problems.push(`${label}: ${form} takes ${RULE_KEYS[form].join(', ')}, not ${extra.join(', ')}`);
    const each = form === 'never' && rule.each !== undefined;
    const needs = form === 'never' ? (each ? ['each'] : ['from', 'to']) : form === 'only' ? ['who', 'to'] : ['from', 'to', 'via'];
    for (const key of needs)
        if (rule[key] === undefined)
            problems.push(`${label}: ${form} needs ${key}`);
    if (each && (typeof rule.each !== 'string' || rule.from !== undefined || rule.to !== undefined)) {
        problems.push(`${label}: never.each is one folder pattern ('apps/*/src/features/*'), without from and to`);
    }
    if (rule.kind !== undefined && typeof rule.kind !== 'string')
        problems.push(`${label}: kind must be a link kind ('import', 'graphql')`);
    if (rule.kinds !== undefined && !isStrings(rule.kinds))
        problems.push(`${label}: kinds must be a list of link kinds`);
    const checkSide = (key, side) => {
        if (typeof side === 'string')
            return;
        if (!isObject(side)) {
            problems.push(`${label}: ${key} must be an area name or { area, areas, folders, files, except }`);
            return;
        }
        const bad = Object.keys(side).filter((name) => !SIDE_KEYS.includes(name));
        if (bad.length)
            problems.push(`${label}: ${key} takes ${SIDE_KEYS.join(', ')}, not ${bad.join(', ')}`);
        if (side.area !== undefined && typeof side.area !== 'string')
            problems.push(`${label}: ${key}.area must be an area name`);
        if (side.areas !== undefined && !isStrings(side.areas))
            problems.push(`${label}: ${key}.areas must be a list of area names`);
        if (side.folders !== undefined && !isStrings(side.folders))
            problems.push(`${label}: ${key}.folders must be a list of folders`);
        if (side.files !== undefined && typeof side.files !== 'string' && !isStrings(side.files))
            problems.push(`${label}: ${key}.files must be a glob or a list of them`);
        if (side.except !== undefined)
            checkSide(`${key}.except`, side.except);
    };
    for (const key of SIDES)
        if (rule[key] !== undefined)
            checkSide(key, rule[key]);
    if (claim.areas !== undefined && !isStrings(claim.areas))
        problems.push(`${label}: areas must be a list of area names`);
    for (const named of namesInClaim(claim))
        if (!knownArea(named.name))
            problems.push(unknownName(label, named));
    for (const key of ['draft', 'enforce'])
        if (claim[key] !== undefined && typeof claim[key] !== 'boolean')
            problems.push(`${label}: ${key} must be true or false`);
};
/**
 * Checks a map's `areas` and `claims` exports and returns what's wrong, one
 * line each, so a typo fails the scan with what the file should say. Without
 * `areas`, area names wait for the scan: `unknownAreas` checks them against
 * the folder areas it made.
 */
export const checkSpecs = (areas, claims) => {
    const problems = [];
    const names = checkAreas(areas, problems);
    if (claims === undefined)
        return problems;
    if (!Array.isArray(claims))
        return [...problems, '`claims` must be a list: [{ says, never: { from, to } }, …]'];
    // Without written areas, claims can still name files and folders, and the folder areas by name.
    const knownArea = (name) => areas === undefined || names.has(name) || name === 'Other';
    claims.forEach((claim, i) => checkClaim(claim, i, knownArea, problems));
    return problems;
};
/**
 * The area names claims use that the scan has no area for, one line each.
 * For a map without `areas`, whose areas come from the folders: a misspelled
 * name would match no file, and a claim about it would hold for nothing.
 */
export const unknownAreas = (claims, areaNames) => {
    const known = new Set([...areaNames, 'Other']);
    return claims.flatMap((claim, i) => {
        const record = claim;
        return namesInClaim(record)
            .filter((named) => !known.has(named.name))
            .map((named) => unknownName(claimLabel(record, i), named));
    });
};
/** A test for the files one side of a claim picks. */
const sideTest = (side, ctx) => {
    if (side === undefined)
        return () => true;
    const spec = typeof side === 'string' ? { area: side } : side;
    const tests = [];
    if (spec.area !== undefined)
        tests.push((file) => ctx.areaOfFile(file) === spec.area);
    if (spec.areas) {
        const areas = spec.areas;
        tests.push((file) => areas.includes(ctx.areaOfFile(file) ?? ''));
    }
    if (spec.folders) {
        const folders = spec.folders.map((folder) => folder.replace(/\/+$/, ''));
        tests.push((file) => folders.some((folder) => file === folder || file.startsWith(`${folder}/`)));
    }
    if (spec.files !== undefined) {
        const patterns = [spec.files].flat().map(globToRegExp);
        tests.push((file) => patterns.some((re) => re.test(file)));
    }
    const any = (file) => tests.some((test) => test(file));
    if (spec.except === undefined)
        return any;
    const not = sideTest(spec.except, ctx);
    return (file) => any(file) && !not(file);
};
/** Link kinds a claim looks at, or null for all. `import` is any static import: code, a component, a data file. */
const kindsOf = (rule) => {
    const kinds = rule.kinds ?? (rule.kind ? [rule.kind] : null);
    return kinds && kinds.flatMap((kind) => (kind === 'import' ? ['import', 'component', 'data'] : [kind]));
};
/** The folder matching an `each` pattern that holds a file, named by what its wildcards matched. */
const eachGroups = (pattern) => {
    const re = globToRegExp(pattern.replace(/\/+$/, ''));
    const wild = pattern
        .split('/')
        .map((segment, i) => (segment.includes('*') ? i : -1))
        .filter((i) => i >= 0);
    const cache = new Map();
    const owner = (file) => {
        const known = cache.get(file);
        if (known !== undefined)
            return known;
        const segments = file.split('/');
        let found = null;
        for (let i = segments.length; i > 0 && !found; i -= 1) {
            const prefix = segments.slice(0, i).join('/');
            if (re.test(prefix))
                found = prefix;
        }
        cache.set(file, found);
        return found;
    };
    const name = (folder) => {
        const segments = folder.split('/');
        return wild.length ? wild.map((i) => segments[i]).join('/') : folder;
    };
    return { owner, name };
};
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Evaluates one claim over the scan: the links that break it, and the links it looked at. */
export const evaluateClaim = (claim, ctx) => {
    const form = FORMS.find((candidate) => claim[candidate] !== undefined) ?? 'never';
    const rule = (claim[form] ?? {});
    const kinds = kindsOf(rule);
    const kindOk = (edge) => !kinds || kinds.includes(edge.kind);
    const side = (key) => sideTest(rule[key], ctx);
    const offending = [];
    const scope = [];
    if (form === 'never' && typeof rule.each === 'string') {
        // No match of the pattern reaches another match.
        const { owner, name } = eachGroups(rule.each);
        for (const edge of ctx.edges) {
            const a = owner(edge.from);
            const b = owner(edge.to);
            if (!a || !b || a === b)
                continue;
            scope.push(edge);
            if (kindOk(edge))
                offending.push({ ...edge, fromGroup: name(a), toGroup: name(b) });
        }
    }
    else if (form === 'never') {
        // A link with both ends where `from` and `to` overlap (one nested in the other) stays inside both, so it doesn't cross.
        const from = side('from');
        const to = side('to');
        const inBoth = (file) => from(file) && to(file);
        for (const edge of ctx.edges) {
            if (!from(edge.from) || !to(edge.to) || (inBoth(edge.from) && inBoth(edge.to)))
                continue;
            scope.push(edge);
            if (kindOk(edge))
                offending.push(edge);
        }
    }
    else if (form === 'only') {
        // Links from inside `to` don't count.
        const who = side('who');
        const to = side('to');
        const from = side('from');
        for (const edge of ctx.edges) {
            if (!to(edge.to) || to(edge.from) || !from(edge.from) || !kindOk(edge))
                continue;
            scope.push(edge);
            if (!who(edge.from))
                offending.push(edge);
        }
    }
    else {
        const from = side('from');
        const to = side('to');
        const via = side('via');
        for (const edge of ctx.edges) {
            if (!from(edge.from) || !kindOk(edge))
                continue;
            if (!to(edge.to) && !via(edge.to))
                continue;
            // Links inside `from` don't count, unless they enter a `to` nested in it from outside `to` and `via`.
            if (from(edge.to) && !(to(edge.to) && !to(edge.from) && !via(edge.from)))
                continue;
            scope.push(edge);
            if (!via(edge.to))
                offending.push(edge);
        }
    }
    const byKind = Object.create(null);
    for (const edge of offending)
        byKind[edge.kind] = (byKind[edge.kind] ?? 0) + 1;
    const scopeByVerb = Object.create(null);
    for (const edge of scope) {
        const verb = verbOf(edge.kind);
        scopeByVerb[verb] = (scopeByVerb[verb] ?? 0) + 1;
    }
    const pairCounts = new Map();
    for (const edge of offending) {
        const from = edge.fromGroup ?? ctx.areaOfFile(edge.from) ?? '?';
        const to = edge.toGroup ?? ctx.areaOfFile(edge.to) ?? '?';
        const key = `${from}|${to}`;
        const pair = pairCounts.get(key) ?? { from, to, count: 0 };
        pair.count += 1;
        pairCounts.set(key, pair);
    }
    const pairs = [...pairCounts.values()].sort((a, b) => b.count - a.count || byName(`${a.from}|${a.to}`, `${b.from}|${b.to}`));
    const named = new Set([...['from', 'to', 'who', 'via'].flatMap((key) => sideAreas(rule[key])), ...(claim.areas ?? [])]);
    return {
        says: claim.says,
        why: claim.why ?? null,
        draft: claim.draft === true,
        enforce: claim.enforce === true,
        form,
        rule: { [form]: rule },
        holds: offending.length === 0,
        count: offending.length,
        files: new Set(offending.map((edge) => edge.from)).size,
        scope: scope.length,
        scopeByVerb: sortCounts(scopeByVerb),
        byKind: sortCounts(byKind),
        pairs: pairs.slice(0, 8),
        pairsTotal: pairs.length,
        examples: pickExamples(offending, ctx.partOf),
        areas: ctx.areaNames.filter((name) => named.has(name)),
    };
};
/** Every claim, plus an error for each broken claim that says `enforce: true`. */
export const evaluateClaims = (claims, ctx) => {
    const results = claims.map((claim) => evaluateClaim(claim, ctx));
    const gaps = results
        .filter((result) => result.enforce && !result.holds)
        .map((result) => ({
        kind: 'claim-broken',
        level: 'error',
        file: result.examples[0]?.from ?? null,
        detail: `"${result.says}" is enforced and broken: ${result.count} link${result.count === 1 ? '' : 's'} from ${result.files} file${result.files === 1 ? '' : 's'}`,
    }));
    return { results, gaps };
};
