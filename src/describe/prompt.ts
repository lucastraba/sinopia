import { linkTargets } from '../links.js';
import type {
  Description,
  FileNode,
  Graph,
  Operation,
  Part,
} from '../model.js';

/** Bump when the prompts change, so cached descriptions are written again. */
export const PROMPT_VERSION = 'v1';

export interface RulesOptions {
  /** "Helu Map" */
  mapName: string;
  /** What the code is: "Helu's main web app (the app customers use)". */
  subject: string;
  /** Who reads the map, as a sentence. */
  readers: string;
  /** Who the plain description is for: "Becky". */
  plainReader: string;
  /** "Helu's own words" */
  ownWords: string;
  /** "the person using Helu" */
  user: string;
  /** Example of a title that isn't the file name, plus any naming rule. */
  titleExample: string;
  /** The words to avoid in plain descriptions and what to say instead. */
  codeWords: string;
  /** Domain nouns to keep, as a sentence, or null. */
  nouns: string | null;
  /** A specific plain sentence beating a vague one. */
  plainExample: string;
}

// The plain-language rules are adapted from Floorplan's
// references/writing-descriptions.md (github.com/haydenschmitty/floorplan, MIT).
export const writingRules = (options: RulesOptions): string => `You write the descriptions on ${options.mapName}, a map of the code of ${options.subject}. ${options.readers}

Every item gets three fields:
- title: 2 to 5 words in sentence case naming what the thing is or does in ${options.ownWords}. Don't restate the file name: ${options.titleExample}; tests are not described.
- plain: one or two sentences for ${options.plainReader}. Lead with what it does for ${options.user} or for the business, in everyday words. ${options.codeWords}${options.nouns ? ` ${options.nouns}` : ''} Be specific: ${options.plainExample}.
- dev: one or two sentences for an engineer: the mechanism, the state it owns, the operations or stores it relies on, anything surprising.

Say what the code does today, not what its name suggests. If something is a placeholder or only used in one place, say so. Only claim who uses a thing when the facts given show it. Never invent examples or values that aren't in the code. Don't start with "This file" or "This component", don't hedge, don't repeat the title, and don't use em dashes.`;

/** What an adapter gives describe: the rules, background reading, and an overview for the whole-app summary. */
export interface DescribeContext {
  rules: RulesOptions;
  backgroundLabel: string;
  background: string;
  overviewLabel: string;
  overview: string;
}

export const systemPrompt = (context: DescribeContext): string =>
  `${writingRules(context.rules)}\n\n${context.backgroundLabel}\n\n${context.background}`;

/** Plain-language defaults for a personal repo, where Lucas is the reader. */
export const personalRules = (name: string): RulesOptions => ({
  mapName: `the ${name} map`,
  subject: `${name}, one of Lucas's personal projects`,
  readers: 'Lucas reads it, often on his phone, to remember how the project fits together; the plain view is the default and the developer view is a toggle away.',
  plainReader: 'someone who knows what the project is for but has not read its code',
  ownWords: "the project's own words",
  user: 'the person using the project',
  titleExample: '"sync_watchlist.py" becomes "Watchlist sync"',
  codeWords: 'Avoid code words where an everyday phrase works: say "runs every night" rather than "cron job", "keeps a saved copy" rather than "cache", "the settings" rather than "config".',
  nouns: null,
  plainExample: '"Checks the job boards every morning and saves new listings that match the search" beats "Handles jobs"',
});

const MAX_FILE_CHARS = 40_000;

const name = (id: string) => id.split('/').pop() ?? id;

const fileFacts = (file: FileNode, graph: Graph): string => {
  const partByFile = new Map(
    graph.files.map((candidate) => [candidate.id, candidate.part])
  );
  const routes = graph.routes.filter(
    (route) =>
      route.component === file.id || route.extraComponents.includes(file.id)
  );
  const usedBy = graph.files
    .filter(
      (candidate) =>
        candidate.kind !== 'test' &&
        linkTargets(candidate).includes(file.id)
    )
    .map((candidate) => name(candidate.id));
  const otherParts = [
    ...new Set(
      linkTargets(file)
        .map((id) => partByFile.get(id))
        .filter((part) => part && part !== file.part)
    ),
  ];
  const operations = file.operations.map((operationName) => {
    const operation = graph.operations.find(
      (candidate) => candidate.name === operationName
    );
    return operation
      ? `${operation.type} ${operation.name} (${operation.subgraphs.join(', ')})`
      : operationName;
  });
  const facts = [
    `kind: ${file.kind}`,
    routes.length > 0
      ? `screen for: ${routes.map((route) => `${route.path}${route.feature ? ` (needs ${route.feature})` : ''}`).join(', ')}`
      : '',
    file.registeredAs
      ? `opened by name at runtime as "${file.registeredAs}"`
      : '',
    file.components.length > 0
      ? `renders: ${file.components.map((use) => use.tag).join(', ')}`
      : '',
    (file.links ?? []).length > 0
      ? `other links: ${(file.links ?? []).map((link) => `${link.kind}${link.label ? ` ${link.label}` : ''} -> ${name(link.target)}`).join('; ')}`
      : '',
    operations.length > 0 ? `server calls: ${operations.join('; ')}` : '',
    otherParts.length > 0 ? `uses parts: ${otherParts.join(', ')}` : '',
    file.flags.length > 0 ? `feature flags: ${file.flags.join(', ')}` : '',
    `used by: ${usedBy.length > 0 ? usedBy.slice(0, 12).join(', ') + (usedBy.length > 12 ? `, and ${usedBy.length - 12} more` : '') : 'nothing in the app imports it'}`,
  ];
  return facts.filter(Boolean).join('\n');
};

export const filesPrompt = (
  part: Part,
  files: { file: FileNode; content: string }[],
  graph: Graph
): string => {
  const blocks = files.map(({ file, content }) => {
    const truncated = content.length > MAX_FILE_CHARS;
    return [
      `### ${file.id}`,
      fileFacts(file, graph),
      '```',
      truncated
        ? `${content.slice(0, MAX_FILE_CHARS)}\n… (cut at ${MAX_FILE_CHARS} characters)`
        : content,
      '```',
    ].join('\n');
  });
  return [
    `Part: ${part.name} (${part.id}). Its files: ${part.files.map(name).join(', ')}.`,
    `Describe each of the ${files.length} files below. Return one entry per file, with "path" exactly as given after ###.`,
    '',
    ...blocks,
  ].join('\n');
};

export const partPrompt = (
  part: Part,
  graph: Graph,
  fileDescriptions: Record<string, Description>,
  operations: Operation[]
): string => {
  const links = new Set<string>();
  const usedBy = new Set<string>();
  const partByFile = new Map(graph.files.map((file) => [file.id, file.part]));
  for (const file of graph.files) {
    if (file.kind === 'test') continue;
    for (const target of linkTargets(file)) {
      const to = partByFile.get(target);
      if (file.part === part.id && to && to !== part.id) links.add(to);
      if (to === part.id && file.part !== part.id) usedBy.add(file.part);
    }
  }
  const routes = graph.routes.filter(
    (route) => route.component && part.files.includes(route.component)
  );
  const files = part.files
    .filter((id) => fileDescriptions[id])
    .map(
      (id) =>
        `- ${name(id)}: ${fileDescriptions[id]?.title}. ${fileDescriptions[id]?.dev}`
    );
  const otherFiles = part.files.filter((id) => !fileDescriptions[id]).map(name);
  return [
    `Describe the part "${part.name}" (folder ${part.dir || '(root files)'}) as a whole${operations.length > 0 ? ', and each server call (operation) it defines' : ''}.`,
    '',
    'Files and what they do:',
    ...files,
    otherFiles.length > 0
      ? `Other files (tests, generated, not code): ${otherFiles.join(', ')}`
      : '',
    routes.length > 0
      ? `Screens: ${routes.map((route) => `${route.path}${route.feature ? ` (needs ${route.feature})` : ''}${route.flags.length > 0 ? ` (flags ${route.flags.join(', ')})` : ''}`).join('; ')}`
      : graph.routes.length > 0
        ? 'Screens: none of its own'
        : '',
    `Uses parts: ${[...links].join(', ') || 'none'}`,
    `Used by parts: ${[...usedBy].join(', ') || 'none'}`,
    '',
    operations.length > 0
      ? `Operations (return one entry each, "name" exactly as given):\n${operations
          .map(
            (operation) =>
              `#### ${operation.name}: ${operation.type}, served by ${operation.subgraphs.join(', ') || 'no subgraph'}\n${operation.document.slice(0, 1500)}`
          )
          .join('\n\n')}`
      : 'Operations: none (return an empty list)',
  ]
    .filter((line) => line !== '')
    .join('\n');
};

export const appPrompt = (
  graph: Graph,
  partDescriptions: Record<string, Description>,
  context: DescribeContext
): string =>
  [
    `Describe ${context.rules.subject} as a whole, from the parts below${context.overview ? ` and the ${context.overviewLabel}` : ''}.`,
    '',
    'Parts:',
    ...graph.parts.map(
      (part) =>
        `- ${part.id}: ${partDescriptions[part.id]?.title ?? part.name}. ${partDescriptions[part.id]?.plain ?? ''}`
    ),
    '',
    graph.subgraphs.length > 0
      ? `Backend services it talks to: ${graph.subgraphs.map((subgraph) => subgraph.name).join(', ')}.`
      : '',
    '',
    context.overview ? `${context.overviewLabel}:` : '',
    context.overview.slice(0, 8000),
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');

const describedItem = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    plain: { type: 'string' },
    dev: { type: 'string' },
  },
  required: ['title', 'plain', 'dev'],
} as const;

export const FILES_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: { path: { type: 'string' }, ...describedItem.properties },
        required: ['path', ...describedItem.required],
      },
    },
  },
  required: ['files'],
};

export const PART_SCHEMA = {
  type: 'object',
  properties: {
    part: describedItem,
    operations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, ...describedItem.properties },
        required: ['name', ...describedItem.required],
      },
    },
  },
  required: ['part', 'operations'],
};

export const APP_SCHEMA = describedItem;
