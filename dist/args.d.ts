/** A mistake in how sinopia was called: printed as a message, without a stack. */
export declare class UsageError extends Error {
}
export interface CommandArgs {
    /** The repo argument, if given. */
    repo: string | null;
    adapter: string;
    name: string | null;
    out: string | null;
    /** The rest, for runCli: options with their values, without the repo and sinopia's own options. */
    passOn: string[];
}
/**
 * Splits `sinopia <command> [repo] [options]` arguments. The repo is the first
 * word that is neither an option nor an option's value, so
 * `diff --base main~3` keeps `main~3` as the base.
 */
export declare const splitCommandArgs: (args: string[]) => CommandArgs;
