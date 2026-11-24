import { fileLinks } from './links.js';
import type { FileKind, Graph, RuleReport } from './model.js';

/** Kinds that hold no code: they're mapped and described, but nothing is expected to link them. */
const NOT_CODE: FileKind[] = ['doc', 'config', 'generated', 'test'];

/**
 * How much of a repo the map connects. Deterministic: the same graph always
 * gives the same numbers, so an agent improving an adapter can compare runs.
 */
export interface Coverage {
  adapter: string;
  passes: boolean;
  gaps: { error: number; warning: number; info: number };
  files: number;
  codeFiles: number;
  tests: number;
  parts: number;
  largestPart: { id: string; files: number } | null;
  /** Files no part claims (the scan reported them as unpartitioned). */
  unclaimed: number;
  /** Code files with no link in or out (tests don't count as links in). */
  isolated: { count: number; share: number; examples: string[] };
  /** Imports and links whose target the scan couldn't resolve. */
  unresolved: number;
  /** Links by kind: import, component, operation, and each kind the adapter adds. */
  links: Record<string, number>;
  /** Distinct part-to-part pairs with at least one link. */
  partLinks: number;
  routes: number;
  operations: number;
}

export const coverageOf = (graph: Graph, adapter: string): Coverage => {
  const partByFile = new Map(graph.files.map((file) => [file.id, file.part]));
  const linked = new Set<string>();
  const links: Record<string, number> = {};
  const pairs = new Set<string>();
  const count = (kind: string, amount = 1) => {
    links[kind] = (links[kind] ?? 0) + amount;
  };
  for (const file of graph.files) {
    if (file.kind === 'test') continue;
    for (const link of fileLinks(file)) {
      count(link.kind);
      linked.add(file.id);
      linked.add(link.target);
      const from = file.part;
      const to = partByFile.get(link.target);
      if (to && to !== from) pairs.add(`${from} -> ${to}`);
    }
    if (file.operations.length > 0) {
      count('operation', file.operations.length);
      linked.add(file.id);
    }
  }
  const code = graph.files.filter((file) => !NOT_CODE.includes(file.kind));
  const isolated = code
    .filter((file) => !linked.has(file.id))
    .map((file) => file.id)
    .sort();
  const level = (name: 'error' | 'warning' | 'info') =>
    graph.gaps.filter((gap) => gap.level === name).length;
  const largest = graph.parts
    .map((part) => ({ id: part.id, files: part.files.length }))
    .sort((a, b) => b.files - a.files || a.id.localeCompare(b.id))[0];
  return {
    adapter,
    passes: level('error') === 0,
    gaps: { error: level('error'), warning: level('warning'), info: level('info') },
    files: graph.files.length,
    codeFiles: code.length,
    tests: graph.files.filter((file) => file.kind === 'test').length,
    parts: graph.parts.length,
    largestPart: largest ?? null,
    unclaimed: graph.gaps.filter((gap) => gap.kind === 'unpartitioned-file').length,
    isolated: {
      count: isolated.length,
      share: code.length === 0 ? 0 : Math.round((isolated.length / code.length) * 1000) / 1000,
      examples: isolated.slice(0, 15),
    },
    unresolved: graph.gaps.filter((gap) => gap.kind === 'unresolved-import').length,
    links: Object.fromEntries(Object.entries(links).sort(([a], [b]) => a.localeCompare(b))),
    partLinks: pairs.size,
    routes: graph.routes.length,
    operations: graph.operations.length,
  };
};

const countOf = (links: Record<string, number>) => Object.values(links).reduce((sum, n) => sum + n, 0);

/**
 * What each map rule found, then the three things a reviewer looks for:
 * drafts nobody confirmed, call shapes written as regular expressions, and
 * how much of the map comes from custom code.
 */
export const formatRules = (rules: RuleReport[]): string[] => {
  if (rules.length === 0) return ['Rules: none (the map file returns an empty list)'];
  const lines = ['Rules:'];
  rules.forEach((rule, i) => {
    const found = [
      ...Object.entries(rule.links).map(([kind, n]) => `${n} ${kind}`),
      ...(rule.routes > 0 ? [`${rule.routes} routes`] : []),
      ...(rule.gaps > 0 ? [`${rule.gaps} notes`] : []),
    ];
    const flags = [rule.draft ? 'draft' : null, rule.regexes > 0 ? `${rule.regexes} regex` : null].filter(Boolean);
    lines.push(`  ${i + 1}. ${rule.summary}${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`);
    lines.push(`     found: ${found.length > 0 ? found.join(', ') : 'nothing'}`);
    if (rule.why) lines.push(`     why: ${rule.why}`);
  });
  const drafts = rules.flatMap((rule, i) => (rule.draft ? [i + 1] : []));
  if (drafts.length > 0) {
    lines.push(`Drafts: rule${drafts.length > 1 ? 's' : ''} ${drafts.join(', ')}, written by an agent and not yet confirmed. Delete \`draft: true\` to confirm one.`);
  }
  const regexes = rules.reduce((sum, rule) => sum + rule.regexes, 0);
  if (regexes > 0) lines.push(`Regular expressions: ${regexes} call shape${regexes > 1 ? 's' : ''}; a template ('ee.emit({key}') reads better where one fits.`);
  const total = rules.reduce((sum, rule) => sum + countOf(rule.links), 0);
  const custom = rules.filter((rule) => rule.rule === 'custom').reduce((sum, rule) => sum + countOf(rule.links), 0);
  if (custom > 0) lines.push(`Custom code: ${custom} of ${total} links (${((custom / total) * 100).toFixed(1)}%)`);
  return lines;
};

export const formatCoverage = (coverage: Coverage): string[] => {
  const percent = (share: number) => `${(share * 100).toFixed(1)}%`;
  const kinds = Object.entries(coverage.links);
  return [
    `Passes: ${coverage.passes ? 'yes' : 'no'} (${coverage.gaps.error} errors, ${coverage.gaps.warning} warnings, ${coverage.gaps.info} info)`,
    `Files: ${coverage.files} mapped, ${coverage.codeFiles} code, ${coverage.tests} tests, in ${coverage.parts} parts` +
      (coverage.largestPart ? ` (largest: ${coverage.largestPart.id}, ${coverage.largestPart.files} files)` : ''),
    `Files no part claims: ${coverage.unclaimed}`,
    `Isolated code files (no link in or out): ${coverage.isolated.count} of ${coverage.codeFiles} (${percent(coverage.isolated.share)})` +
      (coverage.isolated.examples.length > 0
        ? `: ${coverage.isolated.examples.join(', ')}${coverage.isolated.count > coverage.isolated.examples.length ? ', …' : ''}`
        : ''),
    `Unresolved imports and links: ${coverage.unresolved}`,
    `Links by kind: ${kinds.length > 0 ? kinds.map(([kind, n]) => `${kind} ${n}`).join(', ') : 'none'}`,
    `Part-to-part links: ${coverage.partLinks}`,
    ...(coverage.routes + coverage.operations > 0
      ? [`Routes: ${coverage.routes}, server operations: ${coverage.operations}`]
      : []),
  ];
};
