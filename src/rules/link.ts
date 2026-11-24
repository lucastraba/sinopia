import { checkOptions, type CommonOptions, describeScope, makeRule, type Rule, type RuleContext, type Scope, templatesOf } from './context.js';
import { lineOf, matchBracket, skipString } from './parse.js';
import { type CompiledTemplate, matchAll } from './template.js';

export interface LinkOptions extends CommonOptions {
  /** What crosses the link: `event`, `ws-event`, `queue`, `command`. */
  kind: string;
  /** Where both sides live. `from` and `to` narrow it per side. */
  in?: Scope;
  /** Files that make the call. Defaults to `in`. */
  from?: Scope;
  /** Files that answer it. Defaults to `in`. */
  to?: Scope;
  /**
   * The calling shape, with `{key}` where the name that crosses goes: `'ee.emit({key}'`.
   * Leave it out when a file uses the name without a call shape (a registry
   * looked up by name, a global exposed by name): then any whole-word mention
   * of a key the answering side declares counts.
   */
  call?: string | RegExp | (string | RegExp)[];
  /** The answering shape, with the same `{key}`: `['ee.on({key}', 'on(ee, {key}']`. */
  answer: string | RegExp | (string | RegExp)[];
  /**
   * Calls made through exported helper functions count as calls from the
   * helper's callers: with `export const emitFoo = () => ee.emit(FOO)`, a file
   * calling `emitFoo()` emits FOO, and the helper's own file doesn't. When the
   * map knows imports, only files that import the helper's file (or are it)
   * count, so another function with the same name elsewhere doesn't.
   */
  wrappers?: boolean;
  /**
   * `'constants'`: when the key is a constant (`ee.emit(COUNTER_UPDATE)`), the
   * link's label is its string value (`'counter.update'`) from an
   * `export const` in the same files.
   */
  labels?: 'constants';
}

const KEYS = ['kind', 'in', 'from', 'to', 'call', 'answer', 'wrappers', 'labels'];

const keysOf = (templates: CompiledTemplate[], text: string) =>
  matchAll(templates, text).flatMap((m) => {
    const key = m.values.key;
    return key ? [{ ...key, index: m.index }] : [];
  });

/** Index just past the expression starting at `from`: the next `;`, `,` or line break outside brackets and strings. */
const expressionEnd = (text: string, from: number): number => {
  let i = from;
  while (i < text.length && /\s/.test(text[i] as string)) i++;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') i = skipString(text, i);
    else if (c === '(' || c === '{' || c === '[') i = matchBracket(text, i) + 1;
    else if (c === ';' || c === ',' || c === '\n' || c === ')' || c === '}' || c === ']') return i;
    else i++;
  }
  return i;
};

/** Where the body of the function whose parameters start at `paren` ends, or null when no body follows. */
const bodyEnd = (text: string, paren: number, arrow: boolean): number | null => {
  let i = matchBracket(text, paren) + 1;
  // Skip a return type: `(): void {`, `(): Promise<void> =>`.
  const rest = text.slice(i);
  const head = arrow ? /^\s*(?::[^=;{]*?)?\s*=>\s*/.exec(rest) : /^\s*(?::[^{;]*?)?\s*(?=\{)/.exec(rest);
  if (!head) return null;
  i += head[0].length;
  if (text[i] === '{') return matchBracket(text, i) + 1;
  return arrow ? expressionEnd(text, i) : null;
};

/**
 * Exported functions: `export function name(`, and `export const name =` an
 * arrow function or a function expression. Each comes with its body, so a
 * call after it is a call of the file's own.
 */
const exportedFunctions = (text: string) => {
  const out: { name: string; start: number; end: number }[] = [];
  const declared = /export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>\s*)?\(/g;
  for (const m of text.matchAll(declared)) {
    const end = bodyEnd(text, m.index + m[0].length - 1, false);
    if (end !== null) out.push({ name: m[1] as string, start: m.index, end });
  }
  const valued =
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*(\()|(?:<[^>]*>\s*)?(\()|([A-Za-z_$][\w$]*)\s*=>)/g;
  for (const m of text.matchAll(valued)) {
    let end: number | null;
    if (m[4] !== undefined) end = expressionEnd(text, m.index + m[0].length);
    // Null for `= (a + b)`: a parenthesized expression has no `=>` after it, so it's no function.
    else end = bodyEnd(text, m.index + m[0].length - 1, m[2] === undefined);
    if (end !== null) out.push({ name: m[1] as string, start: m.index, end });
  }
  return out;
};

export const link = (options: LinkOptions): Rule => {
  checkOptions('link', options, KEYS);
  if (!options.kind) throw new Error("link(): 'kind' is required (event, queue, ws-event…)");
  const calls = templatesOf(options.call);
  const answers = templatesOf(options.answer);
  if (answers.length === 0) throw new Error(`link(${options.kind}): needs 'answer'`);
  if (calls.length === 0 && options.wrappers) throw new Error(`link(${options.kind}): 'wrappers' needs a 'call' shape`);
  for (const t of [...calls, ...answers]) {
    if (!t.names.includes('key')) throw new Error(`link(${options.kind}): the shape ${t.source} has no {key}`);
  }
  const from = options.from ?? options.in;
  const to = options.to ?? options.in;
  const callText = calls.length > 0 ? calls.map((t) => t.source).join(' | ') : 'any mention';
  const summary =
    from === to
      ? `${options.kind}: ${callText} → ${answers.map((t) => t.source).join(' | ')} in ${describeScope(from)}`
      : `${options.kind}: ${callText} in ${describeScope(from)} → ${answers.map((t) => t.source).join(' | ')} in ${describeScope(to)}`;

  return makeRule('link', options, summary, [...calls, ...answers], (ctx: RuleContext) => {
    const answering = new Map<string, Set<string>>();
    for (const file of ctx.files(to)) {
      for (const key of keysOf(answers, ctx.code(file.id))) {
        if (!answering.has(key.value)) answering.set(key.value, new Set());
        answering.get(key.value)?.add(file.id);
      }
    }

    const callers = ctx.files(from);
    if (calls.length === 0) {
      // No call shape: a whole-word mention of a declared key is the use.
      const mention = (key: string) => new RegExp(`(?<![\\w$])${key.replace(/[.*+?^${}()|[\]\\/$]/g, '\\$&')}(?![\\w$])`);
      const tests = [...answering.keys()].map((key) => ({ key, re: mention(key) }));
      for (const file of callers) {
        const text = ctx.code(file.id);
        for (const { key, re } of tests) {
          if (!re.test(text)) continue;
          for (const target of answering.get(key) ?? []) if (target !== file.id) ctx.addLink(file, { target, kind: options.kind, label: key });
        }
      }
      return;
    }
    const constants = new Map<string, string>();
    if (options.labels === 'constants') {
      for (const file of new Set([...callers, ...ctx.files(to)])) {
        for (const m of ctx.code(file.id).matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"\n]+)['"]/g)) {
          constants.set(m[1] as string, m[2] as string);
        }
      }
    }

    // Helpers that make the call for their callers, each with the file that defines it:
    // two helpers with the same name in two files are two helpers.
    const helpers: { name: string; file: string; keys: Set<string> }[] = [];
    const helperBodies = new Map<string, { start: number; end: number }[]>();
    if (options.wrappers) {
      for (const file of callers) {
        const text = ctx.code(file.id);
        for (const fn of exportedFunctions(text)) {
          const keys = keysOf(calls, text.slice(fn.start, fn.end));
          if (keys.length === 0) continue;
          helpers.push({ name: fn.name, file: file.id, keys: new Set(keys.map((k) => k.value)) });
          helperBodies.set(file.id, [...(helperBodies.get(file.id) ?? []), fn]);
        }
      }
    }

    for (const file of callers) {
      const text = ctx.code(file.id);
      const made = new Map<string, number>();
      const bodies = helperBodies.get(file.id) ?? [];
      for (const key of keysOf(calls, text)) {
        if (bodies.some((b) => key.index >= b.start && key.index < b.end)) continue;
        if (!made.has(key.value)) made.set(key.value, key.index);
      }
      for (const { name, file: helperFile, keys } of helpers) {
        // With imports known (not the plain adapter), only the helper's importers call it.
        if (ctx.graph.meta.hasLinks && file.id !== helperFile && !file.imports.includes(helperFile)) continue;
        const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
        for (const m of text.matchAll(re)) {
          if (/(?:const|function)\s+$/.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
          for (const key of keys) if (!made.has(key)) made.set(key, m.index);
        }
      }
      for (const [key, index] of made) {
        const label = constants.get(key) ?? key;
        const targets = answering.get(key);
        if (!targets || targets.size === 0) {
          ctx.addGap({
            kind: `unmatched-${options.kind}`,
            level: 'warning',
            file: file.id,
            detail: `${label} (line ${lineOf(text, index)}): nothing answers it`,
          });
          continue;
        }
        for (const target of targets) if (target !== file.id) ctx.addLink(file, { target, kind: options.kind, label });
      }
    }
  });
};
