import { posix } from 'node:path';
import { listFiles } from '../adapters/files.js';
import { checkOptions, describeScope, makeRule } from './context.js';
import { globToRegExp } from './glob.js';
import { lineOf } from './parse.js';
/** The patterns of each `import.meta.glob(…)` call: one string or a list, `!` for the ones left out. */
export const globCalls = (text) => {
    const out = [];
    for (const m of text.matchAll(/\bimport\.meta\.glob(?:Eager)?\s*(?:<[^>()]*>)?\s*\(\s*(\[[^\]]*\]|(['"`])(?:(?!\2)[^\\\n])*\2)/g)) {
        const patterns = [...m[1].matchAll(/(['"`])((?:(?!\1)[^\\\n])*)\1/g)]
            .map((p) => p[2])
            .filter((p) => !p.includes('${'));
        if (patterns.length > 0)
            out.push({ index: m.index, patterns });
    }
    return out;
};
/**
 * Vite's `import.meta.glob('./icons/*.vue')`: the file that globs, linked to
 * every file on the map the pattern names. Patterns are relative, start at
 * the Vite root (`/src/…`), or use an alias the project declares (`@/…`).
 */
export const globImports = (options = {}) => {
    checkOptions('globImports', options, ['in']);
    return makeRule('globImports', options, `import.meta.glob in ${describeScope(options.in)}`, [], (ctx) => {
        let onDisk = null;
        for (const file of ctx.files(options.in)) {
            if (!/\.(m|c)?[jt]sx?$|\.vue$|\.svelte$/.test(file.id))
                continue;
            const text = ctx.code(file.id);
            if (!text.includes('import.meta.glob'))
                continue;
            for (const call of globCalls(text)) {
                const include = [];
                const exclude = [];
                for (const written of call.patterns) {
                    const negated = written.startsWith('!');
                    const pattern = negated ? written.slice(1) : written;
                    // `**/x` matches anywhere below the file, as Vite takes it.
                    const path = pattern.startsWith('**') ? `${posix.dirname(file.id)}/${pattern}`.replace(/^\.\//, '') : ctx.pathOf(file.id, pattern);
                    if (path === null) {
                        ctx.addGap({ kind: 'unmatched-glob', level: 'warning', file: file.id, detail: `${written} (line ${lineOf(text, call.index)}): not a path the project resolves` });
                        continue;
                    }
                    if (negated)
                        exclude.push(globToRegExp(path));
                    else
                        include.push({ pattern: written, re: globToRegExp(path) });
                }
                for (const { pattern, re } of include) {
                    let found = 0;
                    for (const id of ctx.ids) {
                        if (id === file.id || !re.test(id) || exclude.some((ex) => ex.test(id)))
                            continue;
                        ctx.addLink(file, { target: id, kind: 'glob', label: pattern });
                        found++;
                    }
                    if (found > 0)
                        continue;
                    onDisk ??= listFiles(ctx.input.root);
                    const there = onDisk.filter((id) => re.test(id) && !exclude.some((ex) => ex.test(id))).length;
                    ctx.addGap({
                        kind: 'unmatched-glob',
                        level: there > 0 ? 'info' : 'warning',
                        file: file.id,
                        detail: there > 0 ? `${pattern}: ${there} files, none of them on the map (not code)` : `${pattern} (line ${lineOf(text, call.index)}): matches no file`,
                    });
                }
            }
        }
    });
};
