/** A mistake in how sinopia was called: printed as a message, without a stack. */
export class UsageError extends Error {}

/** Options the `sinopia` command reads itself; everything else goes on to the map command. */
const OWN = new Set(['adapter', 'name', 'out']);
/** Options that take a value, so the word after them is never mistaken for the repo. */
const TAKES_VALUE = new Set([...OWN, 'head', 'base', 'part', 'model', 'host', 'port']);

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
export const splitCommandArgs = (args: string[]): CommandArgs => {
  const result: CommandArgs = { repo: null, adapter: 'auto', name: null, out: null, passOn: [] };
  const setOwn = (key: string, value: string) => {
    if (key === 'adapter') result.adapter = value;
    if (key === 'name') result.name = value;
    if (key === 'out') result.out = value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    const option = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
    if (option) {
      const [, key = '', inline] = option;
      const value = inline ?? (TAKES_VALUE.has(key) ? args[++index] : undefined);
      if (OWN.has(key)) {
        if (value !== undefined) setOwn(key, value);
      } else {
        result.passOn.push(arg);
        if (inline === undefined && value !== undefined) result.passOn.push(value);
      }
    } else if (result.repo === null && arg !== '--') {
      result.repo = arg;
    } else {
      result.passOn.push(arg);
    }
  }
  return result;
};
