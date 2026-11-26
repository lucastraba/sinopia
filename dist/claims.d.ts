import { type AreaContext } from './areas.js';
import type { ClaimResult, ClaimSpec, Gap } from './model.js';
/**
 * Checks a map's `areas` and `claims` exports and returns what's wrong, one
 * line each, so a typo fails the scan with what the file should say. Without
 * `areas`, area names wait for the scan: `unknownAreas` checks them against
 * the folder areas it made.
 */
export declare const checkSpecs: (areas: unknown, claims: unknown) => string[];
/**
 * The area names claims use that the scan has no area for, one line each.
 * For a map without `areas`, whose areas come from the folders: a misspelled
 * name would match no file, and a claim about it would hold for nothing.
 */
export declare const unknownAreas: (claims: ClaimSpec[], areaNames: string[]) => string[];
/** Evaluates one claim over the scan: the links that break it, and the links it looked at. */
export declare const evaluateClaim: (claim: ClaimSpec, ctx: AreaContext) => ClaimResult;
/** Every claim, plus an error for each broken claim that says `enforce: true`. */
export declare const evaluateClaims: (claims: ClaimSpec[], ctx: AreaContext) => {
    results: ClaimResult[];
    gaps: Gap[];
};
