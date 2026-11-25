import { listFiles, sha1 } from '../adapters/files.js';
import type { FileNode, Operation, OperationType } from '../model.js';
import { checkOptions, type CommonOptions, describeScope, makeRule, type Rule, type RuleContext, type Scope } from './context.js';
import { lineOf, skipString } from './parse.js';

export interface GraphqlOptions extends CommonOptions {
  /** Where the operations are declared: `.graphql`/`.gql` files, and gql`…` or graphql(`…`) in code. Default: the whole repo. */
  documents?: Scope;
  /**
   * The file(s) graphql-codegen writes (`src/gql/generated.ts`). With it, only
   * names the client exports count, only files that import it (or a file that
   * re-exports it) are callers, and each document links to it.
   */
  client?: string | string[];
  /** Files that call the operations. Default: the whole repo. */
  in?: Scope;
}

const KEYS = ['documents', 'client', 'in'];
const SCRIPT = /\.(m|c)?[jt]sx?$|\.vue$|\.svelte$/;
const DOCUMENT = /\.(graphql|gql)$/;

export type DefinitionKind = OperationType | 'fragment';

export interface GraphqlDefinition {
  kind: DefinitionKind;
  name: string;
  /** Offsets in the text the definitions were read from. */
  start: number;
  end: number;
  /** Top-level fields of its selection, aliases dropped. */
  rootFields: string[];
  /** Fragments it spreads (`...TodoFields`). */
  spreads: string[];
}

/** GraphQL text with `#` comments blanked out, offsets kept. Strings, block strings included, stay. */
export const stripGraphqlComments = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; ) {
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      const stop = end === -1 ? text.length : end + 3;
      out += text.slice(i, stop);
      i = stop;
    } else if (text[i] === '"') {
      const stop = skipString(text, i);
      out += text.slice(i, stop);
      i = stop;
    } else if (text[i] === '#') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else out += text[i++];
  }
  return out;
};

/** Index past the bracket that closes the one at `open` (`(`, `{`), skipping GraphQL strings. */
const closing = (text: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3);
      i = end === -1 ? text.length : end + 2;
    } else if (c === '"') i = skipString(text, i) - 1;
    else if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
};

const NAME = /[_A-Za-z]\w*/y;

/** The top-level fields of the selection set whose `{` is at `open`. */
const selectionFields = (text: string, open: number): string[] => {
  const end = closing(text, open) - 1;
  const fields: string[] = [];
  let i = open + 1;
  const word = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(text);
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const skipSpace = () => {
    while (i < end && /[\s,]/.test(text[i] as string)) i++;
  };
  const skipTail = () => {
    // Arguments, directives and a sub-selection after a field or a spread.
    for (;;) {
      skipSpace();
      if (text[i] === '(' || text[i] === '{') i = closing(text, i);
      else if (text[i] === '@') {
        i++;
        word();
      } else return;
    }
  };
  while (i < end) {
    skipSpace();
    if (i >= end) break;
    if (text.startsWith('...', i)) {
      i += 3;
      skipSpace();
      word();
      skipSpace();
      if (/[_A-Za-z]/.test(text[i] as string)) word(); // `... on Type`
      skipTail();
      continue;
    }
    const first = word();
    if (!first) {
      i++;
      continue;
    }
    skipSpace();
    let field = first;
    if (text[i] === ':') {
      i++;
      skipSpace();
      field = word() ?? first;
    }
    fields.push(field);
    skipTail();
  }
  return fields;
};

/** The named operations and fragments of a GraphQL text, at the top level only. */
export const graphqlDefinitions = (source: string): GraphqlDefinition[] => {
  const text = stripGraphqlComments(source);
  const out: GraphqlDefinition[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') {
      i = closing(text, i); // an anonymous `{ … }` query: codegen can't name it
      continue;
    }
    if (c === '"') {
      const block = text.startsWith('"""', i) ? text.indexOf('"""', i + 3) : null;
      i = block === null ? skipString(text, i) : block === -1 ? text.length : block + 3;
      continue;
    }
    if (c !== 'q' && c !== 'm' && c !== 's' && c !== 'f') {
      i++;
      continue;
    }
    const head = /^(query|mutation|subscription|fragment)\s+([_A-Za-z]\w*)/.exec(text.slice(i, i + 300));
    if (!head || (i > 0 && /\w/.test(text[i - 1] as string))) {
      i++;
      continue;
    }
    // The selection set: the first `{` after the variables and directives.
    let j = i + head[0].length;
    while (j < text.length && text[j] !== '{') j = text[j] === '(' ? closing(text, j) : j + 1;
    const end = closing(text, j);
    const body = text.slice(j, end);
    out.push({
      kind: head[1] as DefinitionKind,
      name: head[2] as string,
      start: i,
      end,
      rootFields: j < text.length ? selectionFields(text, j) : [],
      spreads: [...new Set([...body.matchAll(/\.\.\.\s*(?!on\b)([_A-Za-z]\w*)/g)].map((m) => m[1] as string))],
    });
    i = end;
  }
  return out;
};

/** gql`…` and graphql(`…`) in code: the text of each, at its offset in the file. */
export const taggedDocuments = (code: string): { index: number; text: string }[] => {
  const out: { index: number; text: string }[] = [];
  for (const m of code.matchAll(/(?<![\w$.])(?:gql|graphql)\s*(?:\(\s*)?(?=`)/g)) {
    const open = m.index + m[0].length;
    const close = skipString(code, open);
    out.push({ index: open + 1, text: code.slice(open + 1, close - 1) });
  }
  return out;
};

/**
 * An operation name as graphql-codegen writes it: PascalCase by change-case's
 * rules, underscores kept (`currentUser` → `CurrentUser`, `setAPIKey` →
 * `SetApiKey`, `list_todos` → `List_Todos`).
 */
export const codegenName = (name: string): string =>
  name
    .split('_')
    .map((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((w, index) => (index > 0 && /\d/.test(w[0] as string) ? `_${w}` : (w[0] as string).toUpperCase() + w.slice(1).toLowerCase()))
        .join('')
    )
    .join('_');

const SUFFIX: Record<DefinitionKind, string> = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription', fragment: 'Fragment' };

/**
 * The names codegen's plugins give a definition's hooks and documents: urql,
 * vue-apollo, Apollo React (`use…Query`, `use…LazyQuery`, `…Document`),
 * apollo-angular (`…GQL`), with and without `dedupeOperationSuffix` and
 * `omitOperationSuffix`. The last ones only count when the client exports them.
 */
export const generatedNames = (kind: DefinitionKind, name: string): { sure: string[]; ifExported: string[] } => {
  const base = codegenName(name);
  const suffix = SUFFIX[kind];
  if (kind === 'fragment') return { sure: [`${base}FragmentDoc`, `use${base}Fragment`], ifExported: [] };
  const deduped = base.endsWith(suffix) ? base.slice(0, -suffix.length) : null;
  const hooks = (b: string) => [`use${b}${suffix}`, ...(kind === 'query' ? [`use${b}LazyQuery`, `use${b}SuspenseQuery`] : [])];
  return {
    sure: [...hooks(base), `${base}Document`, `${base}GQL`, `${base}${suffix}GQL`],
    ifExported: [...(deduped ? [...hooks(deduped), `${deduped}${suffix}GQL`] : []), `use${base}`],
  };
};

/** What a module exports by name. */
const exportsOf = (code: string): Set<string> => {
  const names = new Set<string>();
  for (const m of code.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1] as string);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const entry of (m[1] as string).split(',')) {
      const name = entry.trim().split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
};

interface Declared extends GraphqlDefinition {
  file: string;
  text: string;
}

/**
 * GraphQL operations, matched across codegen's renaming: each file that uses a
 * generated hook or document (`useCurrentUserQuery`, `CurrentUserDocument`)
 * links to the document that declares `query currentUser`, and makes that
 * call as a server call on the map.
 */
export const graphql = (options: GraphqlOptions = {}): Rule => {
  checkOptions('graphql', options, KEYS);
  const clients = options.client === undefined ? [] : (Array.isArray(options.client) ? options.client : [options.client]).map((path) => path.replace(/^\.\//, ''));
  const summary = `GraphQL operations in ${describeScope(options.documents)}${clients.length ? ` through ${clients.join(', ')}` : ''}, called from ${describeScope(options.in)}`;

  return makeRule('graphql', options, summary, [], (ctx: RuleContext) => {
    const clientSet = new Set(clients);
    for (const client of clients) {
      if (!ctx.addFile(client)) ctx.addGap({ kind: 'unmatched-graphql', level: 'warning', file: null, detail: `client ${client} isn't there` });
    }

    // 1. Every named operation and fragment, with the file that declares it.
    const declared: Declared[] = [];
    for (const id of listFiles(ctx.input.root)) {
      if (!DOCUMENT.test(id) || !ctx.inScope(id, options.documents)) continue;
      const text = ctx.read(id);
      const definitions = graphqlDefinitions(text);
      if (definitions.length === 0) continue; // a schema, not a document
      if (!ctx.addFile(id)) continue;
      const stripped = stripGraphqlComments(text);
      declared.push(...definitions.map((d) => ({ ...d, file: id, text: stripped.slice(d.start, d.end).trim() })));
    }
    for (const file of ctx.files(options.documents)) {
      if (!SCRIPT.test(file.id) || clientSet.has(file.id) || file.kind === 'generated') continue;
      const code = ctx.code(file.id);
      if (!code.includes('gql') && !code.includes('graphql')) continue;
      for (const doc of taggedDocuments(code)) {
        declared.push(...graphqlDefinitions(doc.text).map((d) => ({ ...d, file: file.id, text: doc.text.slice(d.start, d.end).trim() })));
      }
    }

    // 2. One definition per generated name: the same name twice is ambiguous.
    const clientExports = new Set(clients.flatMap((client) => [...exportsOf(ctx.code(client))]));
    const byIdentifier = new Map<string, Declared>();
    const byKey = new Map<string, Declared>();
    const kept: Declared[] = [];
    for (const def of declared) {
      const key = `${def.kind === 'fragment' ? 'fragment' : 'operation'}:${codegenName(def.name)}`;
      const first = byKey.get(key);
      if (first) {
        ctx.addGap({ kind: 'ambiguous-graphql', level: 'warning', file: def.file, detail: `${def.kind} ${def.name} (line ${lineOf(ctx.read(def.file), def.start)}): also declared in ${first.file}; codegen keeps one` });
        continue;
      }
      byKey.set(key, def);
      kept.push(def);
      const { sure, ifExported } = generatedNames(def.kind, def.name);
      for (const id of sure) if (clients.length === 0 || clientExports.has(id)) byIdentifier.set(id, def);
      for (const id of ifExported) if (clientExports.has(id) && !byIdentifier.has(id)) byIdentifier.set(id, def);
    }
    const fragments = new Map(kept.filter((d) => d.kind === 'fragment').map((d) => [d.name, d]));

    // 3. Documents link to the fragments they spread, and to the client generated from them.
    for (const def of kept) {
      const file = ctx.byId.get(def.file);
      if (!file) continue;
      for (const spread of def.spreads) {
        const fragment = fragments.get(spread);
        if (fragment && fragment.file !== def.file) ctx.addLink(file, { target: fragment.file, kind: 'graphql', label: spread });
        else if (!fragment) ctx.addGap({ kind: 'unmatched-graphql', level: 'warning', file: def.file, detail: `${def.name} spreads ...${spread}, which no document declares` });
      }
      const names = Object.values(generatedNames(def.kind, def.name)).flat();
      for (const client of clients) {
        if (client !== def.file && names.some((id) => clientExports.has(id))) ctx.addLink(file, { target: client, kind: 'codegen', label: null });
      }
    }

    // 4. The map's server calls: one operation per query, mutation and subscription.
    const recorded = new Set(ctx.graph.operations.map((operation) => operation.name));
    const operationOf = new Map<Declared, Operation>();
    for (const def of kept) {
      if (def.kind === 'fragment' || def.rootFields.length === 0 || recorded.has(def.name)) continue;
      const type = SUFFIX[def.kind];
      const hook = [...byIdentifier].find(([id, d]) => d === def && id.startsWith('use'))?.[0] ?? `use${codegenName(def.name)}${type}`;
      const operation: Operation = {
        name: def.name,
        type: def.kind,
        file: def.file,
        part: ctx.byId.get(def.file)?.part ?? '',
        composable: hook,
        rootFields: def.rootFields.map((field) => `${type}.${field}`),
        fields: def.rootFields.map((field) => `${type}.${field}`),
        subgraphs: [],
        allSubgraphs: [],
        hash: sha1(def.text),
        document: def.text,
      };
      ctx.graph.operations.push(operation);
      recorded.add(def.name);
      operationOf.set(def, operation);
    }

    // 5. Callers: files that use a generated name.
    const reexports = new Set<string>();
    if (clients.length > 0) {
      for (const file of ctx.files()) {
        if (!file.imports.some((target) => clientSet.has(target))) continue;
        for (const m of ctx.code(file.id).matchAll(/export\s*(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) {
          const target = ctx.resolve(file.id, m[1] as string);
          if (target && clientSet.has(target)) reexports.add(file.id);
        }
      }
    }
    const usesClient = (file: FileNode) => clients.length === 0 || file.imports.some((target) => clientSet.has(target) || reexports.has(target));
    const generatedShape = /^use\w+(?:Query|Mutation|Subscription)$|\w(?:Document|FragmentDoc)$/;
    for (const file of ctx.files(options.in)) {
      if (!SCRIPT.test(file.id) || clientSet.has(file.id) || file.id.endsWith('.d.ts') || !usesClient(file)) continue;
      const text = ctx.code(file.id);
      const seen = new Set<string>();
      for (const m of text.matchAll(/(?<![\w$])(use[A-Z][\w$]*|[A-Z][\w$]*(?:Document|FragmentDoc|GQL))(?![\w$])/g)) {
        const id = m[1] as string;
        // A file that declares the name (the client, a hand-written hook) doesn't call it.
        if (seen.has(id) || /\b(?:function\s*\*?|const|let|var|class)\s+$/.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
        seen.add(id);
        const def = byIdentifier.get(id);
        if (!def) {
          if (clientExports.has(id) && generatedShape.test(id)) {
            ctx.addGap({ kind: 'unmatched-graphql', level: 'warning', file: file.id, detail: `${id} (line ${lineOf(text, m.index)}): the client exports it, but no document declares its operation` });
          }
          continue;
        }
        if (def.file !== file.id) ctx.addLink(file, { target: def.file, kind: 'graphql', label: def.name });
        const operation = operationOf.get(def);
        if (operation && !file.operations.includes(operation.name)) file.operations.push(operation.name);
      }
    }
  });
};
