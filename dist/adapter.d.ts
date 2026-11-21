import type { DescribeContext } from './describe/prompt.js';
import type { Graph } from './model.js';
/**
 * The adapter interface version this sinopia implements. Bump it on any change
 * an existing adapter has to follow, and add a section to docs/adapters.md
 * ("Changes between versions") that says how to upgrade.
 */
export declare const ADAPTER_INTERFACE_VERSION = 1;
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
    describeContext(input: {
        repo: string;
        artifacts: string;
    }): Promise<DescribeContext>;
}
/** Thrown when an adapter was written for another interface version. */
export declare class AdapterVersionError extends Error {
}
/**
 * Refuses an adapter written for another interface version, with what to do
 * about it. `source` names where the adapter came from, for the message.
 */
export declare const assertAdapterVersion: (adapter: Partial<Adapter>, source: string) => void;
