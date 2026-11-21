import type { DescribeContext } from './describe/prompt.js';
import type { Graph } from './model.js';

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
 */
export interface Adapter {
  name: string;
  /** Builds the graph, including the adapter's own checks as gaps. */
  scan(input: ScanInput): Promise<Graph>;
  /** The part a repo-relative path belongs to, for changed files no graph holds. */
  partOf(path: string): string | null;
  /** Paths `git archive` exports to scan an older commit; null for the whole tree. */
  snapshotPaths: string[] | null;
  /** Background and wording for `describe`. */
  describeContext(input: { repo: string; artifacts: string }): Promise<DescribeContext>;
}
