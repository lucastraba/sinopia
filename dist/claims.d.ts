import { type AreaContext } from './areas.js';
import type { ClaimResult, ClaimSpec, Gap } from './model.js';
/**
 * Checks a map's `areas` and `claims` exports and returns what's wrong, one
 * line each, so a typo fails the scan with what the file should say.
 */
export declare const checkSpecs: (areas: unknown, claims: unknown) => string[];
/** Evaluates one claim over the scan: the links that break it, and the links it looked at. */
export declare const evaluateClaim: (claim: ClaimSpec, ctx: AreaContext) => ClaimResult;
/** Every claim, plus an error for each broken claim that says `enforce: true`. */
export declare const evaluateClaims: (claims: ClaimSpec[], ctx: AreaContext) => {
    results: ClaimResult[];
    gaps: Gap[];
};
