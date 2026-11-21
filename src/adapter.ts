import type { DescribeContext } from './describe/prompt.js';
import type { Graph } from './model.js';

/**
 * The adapter interface version this sinopia implements. Bump it on any change
 * an existing adapter has to follow, and add a section to docs/adapters.md
 * ("Changes between versions") that says how to upgrade.
 */
export const ADAPTER_INTERFACE_VERSION = 1;

export interface ScanInput {
  /** The repository. */
  repo: string;
  /** What to scan: the repo itself, or a `git archive` snapshot of an older commit. */
  root: string;
  /** Where the adapter may cache things (`.artifacts/map`, `~/.local/share/sinopia/maps/<name>`). */
  artifacts: string;
  source: Graph['source'];
}

/**
 * What sinopia needs to know about one kind of repo. The core does describe,
 * diff, validation and the viewer; an adapter only turns code into a graph.
 * The contract, with a worked example, is docs/adapters.md.
 */
export interface Adapter {
  /** The interface version the adapter was written for: ADAPTER_INTERFACE_VERSION when it was written. */
  interfaceVersion: number;
  name: string;
  /**
   * Builds the graph. Adapter-specific problems go in as gaps; the core runs
   * the generic checks (validateGraph) on the result, so don't call it here.
   */
  scan(input: ScanInput): Promise<Graph>;
  /** The part a repo-relative path belongs to, for changed files no graph holds. */
  partOf(path: string): string | null;
  /** Paths `git archive` exports to scan an older commit; null for the whole tree. */
  snapshotPaths: string[] | null;
  /** Background and wording for `describe`. */
  describeContext(input: { repo: string; artifacts: string }): Promise<DescribeContext>;
}

/** Thrown when an adapter was written for another interface version. */
export class AdapterVersionError extends Error {}

/**
 * Refuses an adapter written for another interface version, with what to do
 * about it. `source` names where the adapter came from, for the message.
 */
export const assertAdapterVersion = (adapter: Partial<Adapter>, source: string): void => {
  const declared = adapter.interfaceVersion;
  const want = ADAPTER_INTERFACE_VERSION;
  if (declared === want) return;
  const docs = 'docs/adapters.md in the sinopia repo, or `sinopia adapter docs`';
  if (typeof declared !== 'number') {
    throw new AdapterVersionError(
      `The adapter in ${source} declares no interfaceVersion, so it predates versioned adapters. ` +
        `This sinopia implements adapter interface v${want}. Upgrade the adapter: follow "Changes between versions" in ${docs}, ` +
        `then set interfaceVersion: ${want}. The sinopia-adapter skill does this for you.`
    );
  }
  if (declared < want) {
    throw new AdapterVersionError(
      `The adapter in ${source} implements adapter interface v${declared}; this sinopia needs v${want}. ` +
        `Upgrade the adapter: follow "Changes between versions" from v${declared} to v${want} in ${docs}, ` +
        `then set interfaceVersion: ${want}. The sinopia-adapter skill does this for you.`
    );
  }
  throw new AdapterVersionError(
    `The adapter in ${source} implements adapter interface v${declared}, newer than this sinopia (v${want}). ` +
      'Update sinopia to a version that supports it.'
  );
};
