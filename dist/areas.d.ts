import type { Area, AreaLink, AreaSpec, Gap, Graph, LinkExample, Part, Verb } from './model.js';
/** Below this many parts the viewer opens the parts themselves: an area of two parts adds a tap and nothing else. */
export declare const OVERVIEW_MIN_PARTS = 12;
/** The verbs in display order. */
export declare const VERBS: Verb[];
export declare const verbOf: (kind: string) => Verb;
/** A link the folding counts: one per (from, to, kind, label). */
export interface Edge extends LinkExample {
    /** A component the template uses by tag, with no import line (resolved by a plugin). */
    tagOnly?: boolean;
}
/**
 * Every file-to-file link once: an import is `data` when it loads a data file
 * and `component` when the file also renders it; components used by tag only
 * count as `component`; then the adapter's own links. Links to a file the
 * graph doesn't hold are left out (validateGraph reports them).
 */
export declare const fileEdges: (graph: Pick<Graph, "files">) => Edge[];
/** Part id to area name: the area whose folder is the longest prefix of the part's folder, or null. */
export declare const assignAreas: (parts: Part[], specs: Record<string, AreaSpec>) => Map<string, string | null>;
/**
 * Areas when the map writes none: one per workspace package (with the folders
 * inside it), else one per top-level folder, and the top-level files. When
 * that makes a single area, the next folder level splits it.
 */
export declare const folderAreas: (parts: Part[]) => Record<string, AreaSpec>;
export declare const slug: (name: string) => string;
/** Counts biggest first, ties by name, so the output is the same on every run. */
export declare const sortCounts: (counts: Record<string, number>) => Record<string, number>;
/** Up to `n` examples that differ: a new source part first, then a new source file, then anything; real code before tests. */
export declare const pickExamples: (edges: LinkExample[], partOf: (file: string) => string | undefined, n?: number) => LinkExample[];
/** What the claims need to read the scan: every link once, and where each file sits. */
export interface AreaContext {
    edges: Edge[];
    partOf: (file: string) => string | undefined;
    areaOfFile: (file: string) => string | undefined;
    areaNames: string[];
}
export interface Folded {
    areas: Area[];
    areaLinks: AreaLink[];
    linkTotals: {
        links: number;
        partPairs: number;
    };
    gaps: Gap[];
    context: AreaContext;
}
/**
 * Puts every part in an area and folds the file links between areas into
 * lines. `specs` null: the map writes no areas, so they come from the folders.
 * Parts no written area claims go to `Other`, each with a warning.
 */
export declare const foldAreas: (graph: Pick<Graph, "parts" | "files">, specs: Record<string, AreaSpec> | null) => Folded;
