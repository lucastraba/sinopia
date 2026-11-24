import { posix } from 'node:path';
// Text helpers the rules share: enough parsing to find call shapes and object
// literals without a parser per language. Offsets and line breaks are kept, so
// an index into the stripped text is an index into the file.
/** Index just past the string literal starting at `i` (template literals included, simply). */
export const skipString = (text, i) => {
    const quote = text[i];
    let j = i + 1;
    while (j < text.length) {
        if (text[j] === '\\')
            j += 2;
        else if (text[j] === quote)
            return j + 1;
        else if (quote !== '`' && text[j] === '\n')
            return j;
        else
            j++;
    }
    return j;
};
/** JS/TS text with comments blanked out. Strings are kept. */
export const stripJsComments = (text) => {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        const n = text[i + 1];
        if (c === '/' && n === '*') {
            const end = text.indexOf('*/', i + 2);
            const stop = end === -1 ? text.length : end + 2;
            out += text.slice(i, stop).replace(/[^\n]/g, ' ');
            i = stop;
        }
        else if (c === '/' && n === '/') {
            const end = text.indexOf('\n', i);
            const stop = end === -1 ? text.length : end;
            out += ' '.repeat(stop - i);
            i = stop;
        }
        else if (c === "'" || c === '"' || c === '`') {
            const stop = skipString(text, i);
            out += text.slice(i, stop);
            i = stop;
        }
        else {
            out += c;
            i++;
        }
    }
    return out;
};
/** Python text with `#` comments and triple-quoted strings (docstrings) blanked out. */
export const stripPy = (text) => text
    .replace(/("""|''')[\s\S]*?\1/g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/(^|[^"'\w])#[^\n]*/g, '$1');
/** Comments blanked out, by the file's language. Other files come back unchanged. */
export const stripComments = (id, text) => {
    if (id.endsWith('.py'))
        return stripPy(text);
    if (/\.(m|c)?[jt]sx?$|\.vue$|\.svelte$/.test(id))
        return stripJsComments(text);
    return text;
};
/** Index of the bracket that closes the one at `open`, skipping strings. */
export const matchBracket = (text, open) => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === "'" || c === '"' || c === '`') {
            i = skipString(text, i) - 1;
        }
        else if (c === '(' || c === '{' || c === '[')
            depth++;
        else if (c === ')' || c === '}' || c === ']') {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return text.length;
};
/** Top-level `key: value` entries of the object literal whose `{` is at `open`. Spreads and shorthands are skipped. */
export const objectEntries = (text, open) => {
    const close = matchBracket(text, open);
    const entries = [];
    /** Where the entry starting at `from` ends: the next top-level comma, or the closing brace. */
    const entryEnd = (from) => {
        let end = from;
        while (end < close) {
            const c = text[end];
            if (c === "'" || c === '"' || c === '`')
                end = skipString(text, end);
            else if (c === '(' || c === '{' || c === '[')
                end = matchBracket(text, end) + 1;
            else if (c === ',')
                break;
            else
                end++;
        }
        return end;
    };
    let i = open + 1;
    while (i < close) {
        const m = /^\s*([A-Za-z_$][\w$]*)\s*:\s*/.exec(text.slice(i, close));
        const start = m ? i + m[0].length : i;
        const end = entryEnd(start);
        if (m?.[1])
            entries.push({ key: m[1], start, end, value: text.slice(start, end).trim() });
        i = end + 1;
    }
    return entries;
};
/** 1-based line number of an index. */
export const lineOf = (text, index) => text.slice(0, index).split('\n').length;
/** A relative import specifier from `fromId`, resolved to a mapped file id. */
export const resolveRelative = (ids, fromId, spec) => {
    if (!spec.startsWith('.'))
        return null;
    const base = posix.normalize(posix.join(posix.dirname(fromId), spec));
    for (const candidate of [base, `${base}.ts`, `${base}.js`, `${base}.vue`, `${base}/index.ts`]) {
        if (ids.has(candidate))
            return candidate;
    }
    return null;
};
/**
 * The file a Python module name points at, looked up from `fromId` upwards:
 * `<dir>/<module>.py`, `<dir>/<module>/__init__.py`, and the same under `src/`.
 */
export const pythonModuleFile = (ids, fromId, module) => {
    const rel = module.split('.').join('/');
    const candidates = [];
    let dir = posix.dirname(fromId);
    while (true) {
        candidates.push(posix.join(dir, `${rel}.py`), posix.join(dir, rel, '__init__.py'));
        candidates.push(posix.join(dir, 'src', `${rel}.py`), posix.join(dir, 'src', rel, '__init__.py'));
        if (dir === '.' || dir === '' || dir === '/')
            break;
        dir = posix.dirname(dir);
    }
    return candidates.map((c) => c.replace(/^\.\//, '')).find((c) => ids.has(c)) ?? null;
};
