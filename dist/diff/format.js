const short = (sha) => (sha ? sha.slice(0, 9) : 'uncommitted');
/** "3 parts: a, b, c", or the first six and a count of the rest. */
const listed = (items, noun) => `${items.length} ${noun}${items.length === 1 ? '' : 's'}: ${items.slice(0, 6).join(', ')}${items.length > 6 ? ` and ${items.length - 6} more` : ''}`;
const section = (title, lines, empty = 'none') => [
    title,
    ...(lines.length > 0 ? lines.map((line) => `  ${line}`) : [`  ${empty}`]),
    '',
];
/** The plain-text report `pnpm map diff` prints, short enough to paste at the end of a task. */
export const formatDiff = (diff) => {
    const { meta } = diff;
    const lines = [
        `${meta.title} diff: ${diff.head.label} (${short(diff.head.sha)}) against ${diff.base.label} (${short(diff.base.sha)})`,
        '',
    ];
    lines.push(...section(`Parts touched (${diff.touchedParts.length})`, diff.touchedParts.map((part) => {
        const counts = [
            part.added.length > 0 ? `${part.added.length} added` : '',
            part.modified.length > 0 ? `${part.modified.length} changed` : '',
            part.removed.length > 0 ? `${part.removed.length} removed` : '',
        ].filter(Boolean);
        const note = diff.notes[part.part];
        return `${part.part}: ${counts.join(', ')}${note ? `. Why: ${note}` : ''}`;
    })));
    if (diff.outsideMain.length > 0) {
        lines.push(...section(`Outside ${meta.sourceLabel}`, diff.outsideMain.map((area) => `${area.area}: ${area.files.length} file(s)`)));
    }
    if (meta.library && diff.hdsComponents.length > 0) {
        lines.push(...section(`${meta.library.label} components changed, and the parts that use them`, diff.hdsComponents.map((component) => `${component.name}: ${component.usedByParts.length > 0 ? listed(component.usedByParts, 'part') : `not used in ${meta.sourceLabel}`}`)));
    }
    if (meta.hasLinks) {
        lines.push(...section('New links between parts', diff.newPartLinks.map((link) => `${link.from} -> ${link.to} (${link.example})`)));
        if (diff.removedPartLinks.length > 0) {
            lines.push(...section('Links between parts that are gone', diff.removedPartLinks.map((link) => `${link.from} -> ${link.to}`)));
        }
        lines.push(...section('New import cycles', diff.newCycles.map((cycle) => cycle.map((file) => file.split('/').pop()).join(' -> '))));
    }
    const sign = { added: '+', removed: '-', changed: '~' };
    if (diff.has.operations) {
        lines.push(...section(meta.operationsLabel, diff.operations.map((operation) => {
            const fields = operation.newFields.length > 0
                ? `; new fields ${operation.newFields.slice(0, 5).join(', ')}${operation.newFields.length > 5 ? ` and ${operation.newFields.length - 5} more` : ''}`
                : '';
            return `${sign[operation.change]} ${operation.type} ${operation.name} (${operation.part}) served by ${operation.subgraphs.join(', ') || 'no subgraph'}${fields}`;
        })));
    }
    if (diff.has.routes) {
        lines.push(...section('Screens and their gates', diff.routes.map((route) => `${sign[route.change]} ${route.path}: ${route.detail}`)));
    }
    const flagLines = [
        ...diff.newFlags.map((flag) => `+ ${flag}`),
        ...diff.removedFlags.map((flag) => `- ${flag}`),
        ...diff.flagUses.map((use) => `${use.flag} now checked in ${use.parts.join(', ')}`),
    ];
    if (diff.has.flags)
        lines.push(...section('Feature flags', flagLines));
    if (meta.boundary) {
        lines.push(...section(meta.boundary.label, diff.pocBoundary, 'nothing crosses it'));
    }
    lines.push(...section('New validation findings', diff.newGaps.map((gap) => `${gap.level} ${gap.kind}: ${gap.detail}`)));
    return lines.join('\n').trimEnd();
};
