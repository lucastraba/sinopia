// Puts areas, the lines between them and the claims on a scanned graph, and
// says what they found for `check`.
import { foldAreas, OVERVIEW_MIN_PARTS } from './areas.js';
import { evaluateClaims, unknownAreas } from './claims.js';
/**
 * Adds `areas`, `areaLinks`, `linkTotals` and `claims` to the graph, and the
 * gaps they raise: a part in no written area (warning), an enforced claim
 * that's broken (error). `specs` null: the map writes no areas.
 */
export const addAreas = (graph, specs, claims) => {
    const folded = foldAreas(graph, specs);
    graph.areas = folded.areas;
    graph.areaLinks = folded.areaLinks;
    graph.linkTotals = folded.linkTotals;
    const { results, gaps } = evaluateClaims(claims, folded.context);
    graph.claims = results;
    graph.gaps.push(...folded.gaps, ...gaps);
    // A map without `areas` can only name its folder areas: a misspelled one would match no file and the claim would hold for nothing.
    if (specs === null || Object.keys(specs).length === 0) {
        for (const detail of unknownAreas(claims, folded.areas.map((area) => area.name))) {
            graph.gaps.push({ kind: 'claim-unknown-area', level: 'error', file: null, detail });
        }
    }
};
const plural = (n, noun) => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;
/** One line on how a claim came out: what broke it, or what it checked. */
export const claimStatus = (claim) => {
    if (!claim.holds) {
        const pairs = claim.pairs.slice(0, 3).map((pair) => `${pair.from} → ${pair.to} ${pair.count}`);
        return `broken: ${plural(claim.count, 'link')} from ${plural(claim.files, 'file')}${pairs.length ? ` (${pairs.join(', ')}${claim.pairsTotal > 3 ? ', …' : ''})` : ''}`;
    }
    const verbs = Object.entries(claim.scopeByVerb)
        .map(([verb, n]) => `${verb} ${n}`)
        .join(', ');
    const rule = claim.rule[claim.form];
    const kind = rule.kind ?? rule.kinds?.join('/');
    if (claim.form === 'never' && kind && claim.scope)
        return `holds: no ${kind} links; what crosses instead: ${verbs}`;
    if (claim.form === 'never')
        return claim.scope ? `holds: ${plural(claim.scope, 'link')} checked` : 'holds: nothing crosses at all';
    if (claim.form === 'only')
        return `holds: ${claim.scope === 1 ? 'the 1 link comes' : `all ${plural(claim.scope, 'link')} come`} from the allowed side`;
    return `holds: ${claim.scope === 1 ? 'the 1 link goes' : `all ${plural(claim.scope, 'link')} go`} through it${verbs ? ` (${verbs})` : ''}`;
};
/** What `check` prints after the rules: the areas, the biggest lines between them, and every claim. */
export const formatAreas = (graph) => {
    const areas = graph.areas ?? [];
    if (areas.length === 0)
        return [];
    const lines = [];
    const written = areas.some((area) => area.source === 'map');
    const small = graph.parts.length < OVERVIEW_MIN_PARTS;
    lines.push(written
        ? `Areas: ${areas.length} from the map${small ? ` (the viewer skips them: fewer than ${OVERVIEW_MIN_PARTS} parts)` : ''}`
        : `Areas: none written in the map, so ${areas.length} by folder${small ? ` (the viewer skips them: fewer than ${OVERVIEW_MIN_PARTS} parts)` : ''}`);
    for (const area of areas) {
        const flags = [area.draft ? 'draft' : null, area.source === 'other' ? 'not in any area' : null].filter(Boolean);
        lines.push(`  ${area.name}: ${plural(area.parts.length, 'part')}, ${plural(area.files, 'file')}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
        if (area.source === 'other')
            lines.push(`     ${area.parts.join(', ')}`);
        else if (area.why)
            lines.push(`     why: ${area.why}`);
    }
    const links = graph.areaLinks ?? [];
    const totals = graph.linkTotals;
    lines.push(`Lines between areas: ${links.length}${totals ? ` (${plural(totals.links, 'file link')} folded)` : ''}`);
    for (const link of links.slice(0, 12))
        lines.push(`  ${link.from} ${link.verb} ${link.to}: ${link.count}`);
    if (links.length > 12)
        lines.push(`  … ${links.length - 12} more (check --json lists them all)`);
    const claims = graph.claims ?? [];
    if (claims.length > 0) {
        const holding = claims.filter((claim) => claim.holds).length;
        lines.push(`Claims: ${holding} hold, ${claims.length - holding} broken`);
        claims.forEach((claim, i) => {
            const flags = [claim.draft ? 'draft' : null, claim.enforce ? 'enforced' : null].filter(Boolean);
            lines.push(`  ${i + 1}. ${claim.holds ? '✓' : '✗'} ${claim.says}${flags.length ? ` [${flags.join(', ')}]` : ''}`);
            lines.push(`     ${claimStatus(claim)}`);
            if (!claim.holds)
                for (const example of claim.examples)
                    lines.push(`       ${example.from} -> ${example.to} (${example.kind}${example.label ? ` ${example.label}` : ''})`);
        });
    }
    else {
        lines.push('Claims: none');
    }
    const draftAreas = areas.filter((area) => area.draft).map((area) => area.name);
    const draftClaims = claims.flatMap((claim, i) => (claim.draft ? [i + 1] : []));
    if (draftAreas.length + draftClaims.length > 0) {
        const parts = [
            draftAreas.length ? `${plural(draftAreas.length, 'area')} (${draftAreas.join(', ')})` : null,
            draftClaims.length ? `claim${draftClaims.length > 1 ? 's' : ''} ${draftClaims.join(', ')}` : null,
        ].filter(Boolean);
        lines.push(`Drafts: ${parts.join(' and ')}, written by an agent and not yet confirmed. Delete \`draft: true\` to confirm one.`);
    }
    return lines;
};
