// Call shapes written as code: `ee.emit({key}` instead of a regular expression.
//
// A template is the code you'd search for, with placeholders:
//   {name}  captures a string literal ('x', "x", `x`) or an identifier, also a dotted
//           one (`IPC.readSaves`), as a value named `name`
//   {*}     skips anything up to the next part of the template, on the same line
// Whitespace may appear between any two parts of the code; a space between two
// words in the template means at least one. A template that starts or ends
// with a word matches whole words only: `ee.emit(` never matches `free.emit(`.
// A RegExp works too, with named groups as the values; `check` counts them,
// because they're harder to read.
/** An identifier or a member path of them: `FOO`, `IPC.readSaves`, `Events.order.paid`. */
const IDENT_PATH = '[A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*';
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const tokenize = (template) => {
    const tokens = [];
    const re = /\{(\w+|\*)\}|[\w$]+|\s+|[^\w$\s]/g;
    for (const [text, name] of template.matchAll(re)) {
        if (name === '*')
            tokens.push({ type: 'skip' });
        else if (name)
            tokens.push({ type: 'capture', name });
        else if (/^\s+$/.test(text))
            tokens.push({ type: 'space' });
        else if (/^[\w$]+$/.test(text))
            tokens.push({ type: 'word', text });
        else
            tokens.push({ type: 'punct', text });
    }
    return tokens;
};
const isWordish = (token) => token?.type === 'word' || token?.type === 'capture';
export const compileTemplate = (template) => {
    if (template instanceof RegExp) {
        const regex = new RegExp(template.source, template.flags.includes('g') ? template.flags : `${template.flags}g`);
        const names = [...template.source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1]);
        return {
            source: String(template),
            raw: true,
            names,
            match: (text) => [...text.matchAll(regex)].map((m) => ({
                index: m.index,
                end: m.index + m[0].length,
                values: Object.fromEntries(Object.entries(m.groups ?? {})
                    .filter(([, value]) => value !== undefined)
                    .map(([name, value]) => [name, { value: value, quoted: false }])),
            })),
        };
    }
    const tokens = tokenize(template);
    const significant = tokens.filter((t) => t.type !== 'space');
    if (significant.length === 0)
        throw new Error(`Empty call template: '${template}'`);
    const names = [];
    let pattern = '';
    let previous;
    let spaceBefore = false;
    for (const token of tokens) {
        if (token.type === 'space') {
            spaceBefore = true;
            continue;
        }
        if (previous)
            pattern += spaceBefore && isWordish(previous) && isWordish(token) ? '\\s+' : '\\s*';
        spaceBefore = false;
        if (token.type === 'word')
            pattern += escape(token.text);
        else if (token.type === 'punct')
            pattern += escape(token.text);
        else if (token.type === 'skip')
            pattern += '[^\\n]*?';
        else {
            if (names.includes(token.name))
                throw new Error(`'{${token.name}}' appears twice in the call template '${template}'`);
            const i = names.length;
            names.push(token.name);
            pattern += `(?:(?<q${i}>['"\`])(?<s${i}>(?:\\\\.|(?!\\k<q${i}>)[^\\\\\\n])*)\\k<q${i}>|(?<i${i}>${IDENT_PATH})(?![\\w$]))`;
        }
        previous = token;
    }
    const first = significant[0];
    const last = significant[significant.length - 1];
    if (first?.type === 'word')
        pattern = `(?<![\\w$])${pattern}`;
    if (last?.type === 'word')
        pattern += '(?![\\w$])';
    const regex = new RegExp(pattern, 'g');
    return {
        source: template,
        raw: false,
        names,
        match: (text) => [...text.matchAll(regex)].map((m) => {
            const values = {};
            names.forEach((name, i) => {
                const quoted = m.groups?.[`s${i}`];
                const ident = m.groups?.[`i${i}`];
                if (quoted !== undefined)
                    values[name] = { value: quoted, quoted: true };
                else if (ident !== undefined)
                    values[name] = { value: ident.replace(/\s+/g, ''), quoted: false };
            });
            return { index: m.index, end: m.index + m[0].length, values };
        }),
    };
};
/**
 * Matches of several templates, tried in order. A match that starts where an
 * earlier template already matched is dropped, so a longer shape listed first
 * wins over a shorter one that covers the same code.
 */
export const matchAll = (templates, text) => {
    const taken = new Set();
    const out = [];
    for (const template of templates) {
        for (const match of template.match(text)) {
            if (taken.has(match.index))
                continue;
            taken.add(match.index);
            out.push(match);
        }
    }
    return out.sort((a, b) => a.index - b.index);
};
