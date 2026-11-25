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

export interface Capture {
  value: string;
  /** True when it was a string literal, false for an identifier. */
  quoted: boolean;
}

export interface TemplateMatch {
  index: number;
  end: number;
  /** True when a regular expression matched: its captures say nothing about quotes. */
  raw: boolean;
  values: Record<string, Capture>;
}

export interface CompiledTemplate {
  source: string;
  raw: boolean;
  names: string[];
  match(text: string): TemplateMatch[];
}

/** An identifier or a member path of them: `FOO`, `IPC.readSaves`, `Events.order.paid`. */
const IDENT_PATH = '[A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*';

/** `<T>`, `<Map<K, V>>`: type arguments, nested two deep. */
const TYPE_ARGUMENTS = '<(?:[^<>()\\n;]|<(?:[^<>()\\n;]|<[^<>()\\n;]*>)*>)*>';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

type Token =
  | { type: 'word'; text: string }
  | { type: 'punct'; text: string }
  | { type: 'space' }
  | { type: 'capture'; name: string }
  | { type: 'skip' };

const tokenize = (template: string): Token[] => {
  const tokens: Token[] = [];
  const re = /\{(\w+|\*)\}|[\w$]+|\s+|[^\w$\s]/g;
  for (const [text, name] of template.matchAll(re)) {
    if (name === '*') tokens.push({ type: 'skip' });
    else if (name) tokens.push({ type: 'capture', name });
    else if (/^\s+$/.test(text)) tokens.push({ type: 'space' });
    else if (/^[\w$]+$/.test(text)) tokens.push({ type: 'word', text });
    else tokens.push({ type: 'punct', text });
  }
  return tokens;
};

const isWordish = (token: Token | undefined) => token?.type === 'word' || token?.type === 'capture';

export const compileTemplate = (template: string | RegExp): CompiledTemplate => {
  if (template instanceof RegExp) {
    const regex = new RegExp(template.source, template.flags.includes('g') ? template.flags : `${template.flags}g`);
    const names = [...template.source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1] as string);
    return {
      source: String(template),
      raw: true,
      names,
      match: (text) =>
        [...text.matchAll(regex)].map((m) => ({
          index: m.index,
          end: m.index + m[0].length,
          raw: true,
          values: Object.fromEntries(
            Object.entries(m.groups ?? {})
              .filter(([, value]) => value !== undefined)
              .map(([name, value]) => [name, { value: value as string, quoted: false }])
          ),
        })),
    };
  }

  const tokens = tokenize(template);
  const significant = tokens.filter((t) => t.type !== 'space');
  if (significant.length === 0) throw new Error(`Empty call template: '${template}'`);
  const names: string[] = [];
  let pattern = '';
  let previous: Token | undefined;
  let spaceBefore = false;
  for (const token of tokens) {
    if (token.type === 'space') {
      spaceBefore = true;
      continue;
    }
    if (previous) pattern += spaceBefore && isWordish(previous) && isWordish(token) ? '\\s+' : '\\s*';
    // A call may pass TypeScript type arguments: `provide({key}` also matches `provide<Theme>(KEY`.
    if (token.type === 'punct' && token.text === '(' && previous?.type === 'word') pattern += `(?:${TYPE_ARGUMENTS}\\s*)?`;
    spaceBefore = false;
    if (token.type === 'word') pattern += escape(token.text);
    else if (token.type === 'punct') pattern += escape(token.text);
    else if (token.type === 'skip') pattern += '[^\\n]*?';
    else {
      if (names.includes(token.name)) throw new Error(`'{${token.name}}' appears twice in the call template '${template}'`);
      const i = names.length;
      names.push(token.name);
      pattern += `(?:(?<q${i}>['"\`])(?<s${i}>(?:\\\\.|(?!\\k<q${i}>)[^\\\\\\n])*)\\k<q${i}>|(?<i${i}>${IDENT_PATH})(?![\\w$]))`;
    }
    previous = token;
  }
  const first = significant[0];
  const last = significant[significant.length - 1];
  if (first?.type === 'word') pattern = `(?<![\\w$])${pattern}`;
  if (last?.type === 'word') pattern += '(?![\\w$])';
  const regex = new RegExp(pattern, 'g');
  // The longest word the code must contain: a quick no for files without it.
  const needle = significant.reduce((best, t) => (t.type === 'word' && t.text.length > best.length ? t.text : best), '');

  return {
    source: template,
    raw: false,
    names,
    match: (text) =>
      (needle && !text.includes(needle) ? [] : [...text.matchAll(regex)]).map((m) => {
        const values: Record<string, Capture> = {};
        names.forEach((name, i) => {
          const quoted = m.groups?.[`s${i}`];
          const ident = m.groups?.[`i${i}`];
          if (quoted !== undefined) values[name] = { value: quoted, quoted: true };
          else if (ident !== undefined) values[name] = { value: ident.replace(/\s+/g, ''), quoted: false };
        });
        return { index: m.index, end: m.index + m[0].length, raw: false, values };
      }),
  };
};

/**
 * Matches of several templates, tried in order. A match that starts where an
 * earlier template already matched is dropped, so a longer shape listed first
 * wins over a shorter one that covers the same code.
 */
export const matchAll = (templates: CompiledTemplate[], text: string): TemplateMatch[] => {
  const taken = new Set<number>();
  const out: TemplateMatch[] = [];
  for (const template of templates) {
    for (const match of template.match(text)) {
      if (taken.has(match.index)) continue;
      taken.add(match.index);
      out.push(match);
    }
  }
  return out.sort((a, b) => a.index - b.index);
};
