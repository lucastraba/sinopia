import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CruiseDependency {
  module: string;
  resolved: string;
  couldNotResolve: boolean;
}

interface CruiseModule {
  source: string;
  dependencies: CruiseDependency[];
}

interface CruiseViolation {
  rule: { name: string };
  from: string;
  cycle?: { name: string }[];
}

export interface CruiseOutput {
  modules: CruiseModule[];
  summary: { violations: CruiseViolation[] };
}

export interface FileImports {
  imports: string[];
  libraries: string[];
  /** Import specifier as written → resolved file id, for matching template tags to imports. */
  specifiers: Map<string, string>;
  unresolved: string[];
}

export interface ImportScan {
  byFile: Map<string, FileImports>;
  cycles: string[][];
}

export interface ReadOptions {
  /** Only files under this folder are mapped ('' for the whole repo). */
  srcDir: string;
  /** Which resolved files count as code; JSON and stylesheets are not parts of the architecture. */
  codeFile: RegExp;
  /** The workspace library a dependency belongs to, if any. */
  libraryOf: (dependency: CruiseDependency) => string | null;
  /** Specifiers that should resolve to a file here; when they don't, it's a gap. */
  isLocal: (specifier: string) => boolean;
}

export const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte)$/;

const defaults: ReadOptions = {
  srcDir: '',
  codeFile: CODE_FILE,
  libraryOf: () => null,
  isLocal: (specifier) => specifier.startsWith('.'),
};

/** A cycle listed from its smallest file id, so the same loop always reads the same. */
export const normalizeCycle = (cycle: string[]): string[] => {
  if (cycle.length === 0) return cycle;
  const start = cycle.indexOf([...cycle].toSorted()[0] ?? '');
  return [...cycle.slice(start), ...cycle.slice(0, start)];
};

export const readCruise = (
  output: CruiseOutput,
  options: Partial<ReadOptions> = {}
): ImportScan => {
  const { srcDir, codeFile, libraryOf, isLocal } = { ...defaults, ...options };
  const byFile = new Map<string, FileImports>();
  for (const module of output.modules) {
    if (!module.source.startsWith(srcDir)) continue;
    const entry: FileImports = {
      imports: [],
      libraries: [],
      specifiers: new Map(),
      unresolved: [],
    };
    for (const dependency of module.dependencies) {
      const library = libraryOf(dependency);
      if (library) {
        if (!entry.libraries.includes(library)) entry.libraries.push(library);
        continue;
      }
      if (dependency.couldNotResolve) {
        if (isLocal(dependency.module)) {
          entry.unresolved.push(dependency.module);
        }
        continue;
      }
      if (
        !dependency.resolved.startsWith(srcDir) ||
        !codeFile.test(dependency.resolved)
      ) {
        continue;
      }
      entry.specifiers.set(dependency.module, dependency.resolved);
      if (!entry.imports.includes(dependency.resolved)) {
        entry.imports.push(dependency.resolved);
      }
    }
    byFile.set(module.source, entry);
  }

  const seen = new Set<string>();
  const cycles: string[][] = [];
  for (const violation of output.summary.violations) {
    if (violation.rule.name !== 'no-circular' || !violation.cycle) continue;
    const names = violation.cycle.map((step) => step.name);
    const cycle = normalizeCycle(
      names.includes(violation.from) ? names : [violation.from, ...names]
    );
    const key = cycle.join(' > ');
    if (seen.has(key)) continue;
    seen.add(key);
    cycles.push(cycle);
  }
  return { byFile, cycles };
};

const runCruise = (bin: string[], args: string[], cwd: string): CruiseOutput => {
  // depcruise exits non-zero when a rule at "error" level fails; the JSON on
  // stdout is still complete, so only a missing or broken report is fatal.
  const [command, ...prefix] = bin;
  const result = spawnSync(
    command ?? 'depcruise',
    [...prefix, ...args, '--output-type', 'json', '--progress', 'none'],
    { cwd, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }
  );
  const stdout = (result.stdout ?? '').trim();
  if (!stdout.startsWith('{')) {
    throw new Error(`dependency-cruiser failed in ${cwd}: ${result.stderr}`);
  }
  return JSON.parse(stdout) as CruiseOutput;
};

/**
 * Runs the repo's own dependency-cruiser with the repo's own config, so its
 * aliases resolve the way its own checks resolve them. `cwd` is the repo or a
 * `git archive` snapshot of an older commit.
 */
export const cruiseWithRepoConfig = (
  repo: string,
  cwd: string,
  targets: string[],
  config: string,
  options: Partial<ReadOptions> = {}
): ImportScan =>
  readCruise(
    runCruise([join(repo, 'node_modules', '.bin', 'depcruise')], [...targets, '--config', config], cwd),
    options
  );

/** sinopia's own dependency-cruiser CLI, found from the package's main entry (it exports no package.json). */
const ownDepcruise = (): string => {
  let dir = dirname(fileURLToPath(import.meta.resolve('dependency-cruiser')));
  while (!existsSync(join(dir, 'bin', 'dependency-cruiser.mjs'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Cannot find the dependency-cruiser CLI');
    dir = parent;
  }
  return join(dir, 'bin', 'dependency-cruiser.mjs');
};

/**
 * Runs sinopia's own dependency-cruiser on a repo that has no config for it:
 * follows nothing in node_modules, uses the repo's tsconfig.json when there is
 * one, and reports cycles that aren't type-only.
 */
export const cruiseWithoutConfig = (
  cwd: string,
  targets: string[],
  scratch: string,
  options: Partial<ReadOptions> = {}
): ImportScan => {
  const config = {
    forbidden: [
      {
        name: 'no-circular',
        severity: 'warn',
        from: {},
        to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
      },
    ],
    options: {
      doNotFollow: { path: ['node_modules'] },
      exclude: { path: ['(^|/)node_modules/', '(^|/)dist/', '(^|/)build/', '(^|/)coverage/', '(^|/)\\.[\\w-]'] },
      tsPreCompilationDeps: true,
      ...(existsSync(join(cwd, 'tsconfig.json')) ? { tsConfig: { fileName: 'tsconfig.json' } } : {}),
    },
  };
  const configPath = join(scratch, 'dependency-cruiser.config.json');
  writeFileSync(configPath, JSON.stringify(config));
  return readCruise(
    runCruise([process.execPath, ownDepcruise()], [...targets, '--config', configPath], cwd),
    options
  );
};
