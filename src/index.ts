export {
  ADAPTER_INTERFACE_VERSION,
  type Adapter,
  AdapterVersionError,
  assertAdapterVersion,
  type ScanInput,
} from './adapter.js';
export {
  folderPartOf,
  folderPartsOf,
  listFiles,
  packageDirsOf,
  readmeOf,
  readText,
  sha1,
} from './adapters/files.js';
export { autoAdapter, chooseMode, fileKindOf, folderAdapter } from './adapters/folders.js';
export { type Coverage, coverageOf, formatCoverage } from './coverage.js';
export { addAreas, claimStatus, formatAreas } from './areaReport.js';
export { assignAreas, fileEdges, foldAreas, folderAreas, OVERVIEW_MIN_PARTS, verbOf, VERBS } from './areas.js';
export { checkSpecs, evaluateClaim, evaluateClaims } from './claims.js';
export { addLink, fileLinks, linkTargets } from './links.js';
export { type CliOptions, readState, runCli } from './cli.js';
export {
  CODE_FILE,
  type CruiseDependency,
  cruiseWithoutConfig,
  cruiseWithRepoConfig,
  type FileImports,
  type ImportScan,
  normalizeCycle,
  readCruise,
  type ReadOptions,
} from './cruise.js';
export { describe, type DescribeOptions } from './describe/describe.js';
export {
  type DescribeContext,
  personalRules,
  type RulesOptions,
  writingRules,
} from './describe/prompt.js';
export { diffGraphs, partLinks } from './diff/diff.js';
export { formatDiff } from './diff/format.js';
export type * from './model.js';
export { runPool } from './pool.js';
export { ensureDir, exportSnapshot, git, repoRoot, resolveSha } from './repo.js';
export { serve, type ServeOptions } from './serve.js';
export { summarizeGaps, validateGraph } from './validate.js';
export {
  applyRules,
  LOCAL_MAP,
  mapAdapter,
  type Primitives,
  primitives,
  type Rule,
  type RuleContext,
  type Scope,
} from './rules/index.js';
export { compileTemplate, type CompiledTemplate, type TemplateMatch } from './rules/template.js';
