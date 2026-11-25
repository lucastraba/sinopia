// Glob patterns as the rules take them: in scopes (`'**/*Locales.ts'`) and in
// Vite's `import.meta.glob('./icons/*.vue')`.
//   **    any number of folders, none included (`a/**/b` matches `a/b`)
//   *     anything but a slash
//   ?     one character but a slash
//   {a,b} either
//   [ab]  one of, as in a regular expression

/** True when a path holds glob characters, so it's a pattern rather than a folder or file. */
export const isGlob = (path: string): boolean => /[*?{[]/.test(path);

const SPECIAL = /[.+^$()|\\/]/;

/** The regular expression source for a glob, unanchored. */
export const globSource = (pattern: string): string => {
  let out = '';
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        const slash = pattern[i + 2] === '/';
        out += slash ? '(?:[^/]*/)*' : '.*';
        i += slash ? 2 : 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '{') {
      braces++;
      out += '(?:';
    } else if (c === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (c === ',' && braces > 0) out += '|';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) out += '\\[';
      else {
        out += `[${pattern.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else out += SPECIAL.test(c) ? `\\${c}` : c;
  }
  return out;
};

const cache = new Map<string, RegExp>();

const compiled = (key: string, source: () => string): RegExp => {
  let re = cache.get(key);
  if (!re) {
    re = new RegExp(source());
    cache.set(key, re);
  }
  return re;
};

/** A glob that matches whole repo-relative paths. */
export const globToRegExp = (pattern: string): RegExp => compiled(`file:${pattern}`, () => `^${globSource(pattern)}$`);

/** A glob scope: a path it matches, or a path inside a folder it matches. */
export const globScope = (pattern: string): RegExp => compiled(`scope:${pattern}`, () => `^${globSource(pattern)}(?:/.*)?$`);
