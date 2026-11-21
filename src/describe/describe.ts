import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DescribeRun,
  Description,
  Descriptions,
  FileNode,
  Graph,
  Part,
} from '../model.js';
import { runPool } from '../pool.js';
import {
  APP_SCHEMA,
  appPrompt,
  FILES_SCHEMA,
  filesPrompt,
  PART_SCHEMA,
  partPrompt,
  PROMPT_VERSION,
  type DescribeContext,
  systemPrompt,
} from './prompt.js';

const CHUNK_CHARS = 120_000;
const CONCURRENCY = 4;

interface Usage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  describedChars: number;
}

interface ClaudeResult {
  structured_output?: unknown;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface DescribedEntry {
  title: string;
  plain: string;
  dev: string;
}

const sha1 = (value: string) => createHash('sha1').update(value).digest('hex');

export const fileKey = (file: FileNode) =>
  sha1(`${PROMPT_VERSION}:${file.hash}`);

export const partKey = (part: Part, graph: Graph) => {
  const hashes = new Map(graph.files.map((file) => [file.id, file.hash]));
  const operations = graph.operations.filter(
    (operation) => operation.part === part.id
  );
  return sha1(
    [
      PROMPT_VERSION,
      ...part.files.map((id) => `${id}:${hashes.get(id) ?? ''}`),
      ...operations.map((operation) => operation.hash),
    ].join('\n')
  );
};

export const isDescribable = (file: FileNode) =>
  file.kind !== 'test' && file.kind !== 'generated';

/** Groups files into prompts of at most `limit` characters; a bigger file goes alone. */
export const chunkBySize = <T>(
  items: T[],
  size: (item: T) => number,
  limit: number
): T[][] => {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;
  for (const item of items) {
    const itemSize = Math.min(size(item), limit);
    if (current.length > 0 && currentSize + itemSize > limit) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(item);
    currentSize += itemSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};

const emptyDescriptions = (): Descriptions => ({
  app: null,
  parts: {},
  files: {},
  operations: {},
  runs: [],
});

/**
 * Runs one `claude -p` call with no tools, no MCP servers and no settings, so
 * it only reads what the prompt gives it. Uses whoever's Claude plan runs it.
 */
const callClaude = (
  model: string,
  system: string,
  prompt: string,
  schema: object,
  cwd: string,
  usage: Usage
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    // SINOPIA_CLAUDE points at the CLI where `claude` isn't on PATH (systemd units).
    const child = spawn(
      process.env.SINOPIA_CLAUDE ?? 'claude',
      [
        '-p',
        '--output-format',
        'json',
        '--model',
        model,
        '--tools',
        '',
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--no-session-persistence',
        '--system-prompt',
        system,
        '--json-schema',
        JSON.stringify(schema),
      ],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data: Buffer) => (stdout += data.toString()));
    child.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      let result: ClaudeResult;
      try {
        result = JSON.parse(stdout) as ClaudeResult;
      } catch {
        reject(
          new Error(
            `claude -p exited ${code}: ${stderr || stdout}`.slice(0, 2000)
          )
        );
        return;
      }
      usage.calls += 1;
      usage.costUsd += result.total_cost_usd ?? 0;
      usage.inputTokens +=
        (result.usage?.input_tokens ?? 0) +
        (result.usage?.cache_creation_input_tokens ?? 0) +
        (result.usage?.cache_read_input_tokens ?? 0);
      usage.outputTokens += result.usage?.output_tokens ?? 0;
      if (result.is_error || result.structured_output === undefined) {
        reject(
          new Error(
            `claude -p failed: ${result.result ?? stderr}`.slice(0, 2000)
          )
        );
        return;
      }
      resolve(result.structured_output);
    });
    child.stdin.end(prompt);
  });

const withRetry = async <T>(task: () => Promise<T>): Promise<T> => {
  try {
    return await task();
  } catch (error) {
    console.warn(`  ! ${String(error).slice(0, 300)}; retrying once`);
    return task();
  }
};

const toDescription = (hash: string, entry: DescribedEntry): Description => ({
  hash,
  title: entry.title.trim(),
  plain: entry.plain.trim(),
  dev: entry.dev.trim(),
});

export interface DescribeOptions {
  root: string;
  artifacts: string;
  graph: Graph;
  context: DescribeContext;
  parts: string[] | null;
  model: string;
  estimateOnly: boolean;
}

const formatUsage = (usage: Usage) =>
  `${usage.calls} calls, ${(usage.inputTokens / 1000).toFixed(0)}k tokens in, ${(usage.outputTokens / 1000).toFixed(0)}k out, $${usage.costUsd.toFixed(2)} at API prices`;

/**
 * Describes parts, files and operations with `claude -p`, cached by content:
 * a file is described again only when its content (or the prompt) changes.
 * Writes `.artifacts/map/descriptions.json` after each part, so an interrupted
 * run keeps what it finished.
 */
export const describe = async ({
  root,
  artifacts,
  graph,
  context,
  parts: only,
  model,
  estimateOnly,
}: DescribeOptions) => {
  const path = join(artifacts, 'descriptions.json');
  const descriptions: Descriptions = existsSync(path)
    ? {
        ...emptyDescriptions(),
        ...(JSON.parse(readFileSync(path, 'utf8')) as Descriptions),
      }
    : emptyDescriptions();
  const save = () => writeFileSync(path, JSON.stringify(descriptions, null, 2));
  const cwd = join(artifacts, 'claude');
  mkdirSync(cwd, { recursive: true });

  const unknown = (only ?? []).filter(
    (id) => !graph.parts.some((part) => part.id === id)
  );
  if (unknown.length > 0)
    throw new Error(`Unknown part(s): ${unknown.join(', ')}`);
  const parts = graph.parts.filter((part) => !only || only.includes(part.id));
  const fileById = new Map(graph.files.map((file) => [file.id, file]));
  const read = (file: FileNode) => readFileSync(join(root, file.id), 'utf8');

  const pending = parts.map((part) => ({
    part,
    files: part.files
      .map((id) => fileById.get(id))
      .filter(
        (file): file is FileNode =>
          !!file &&
          isDescribable(file) &&
          descriptions.files[file.id]?.hash !== fileKey(file)
      ),
  }));
  const pendingChars = pending.reduce(
    (sum, { files }) =>
      sum +
      files.reduce(
        (total, file) => total + Math.min(read(file).length, 40_000),
        0
      ),
    0
  );
  const pendingParts = pending.filter(
    ({ part, files }) =>
      files.length > 0 ||
      descriptions.parts[part.id]?.hash !== partKey(part, graph)
  );

  const lastRun = [...descriptions.runs]
    .toReversed()
    .find((run) => run.describedChars > 0);
  const estimate = lastRun
    ? (pendingChars / lastRun.describedChars) * lastRun.costUsd
    : null;
  console.log(
    `${pendingParts.length} of ${parts.length} parts and ${pending.reduce((sum, { files }) => sum + files.length, 0)} files need describing (${(pendingChars / 1000).toFixed(0)}k characters of code).` +
      (estimate !== null
        ? ` Estimate from the last run (${lastRun?.scope}): about $${estimate.toFixed(2)} at API prices.`
        : '')
  );
  if (estimateOnly) return;

  const system = systemPrompt(context);
  const usage: Usage = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    describedChars: 0,
  };
  const failures: string[] = [];

  await runPool(pendingParts, CONCURRENCY, async ({ part, files }) => {
    const started = Date.now();
    const contents = files.map((file) => ({ file, content: read(file) }));
    const describeChunk = async (
      chunk: { file: FileNode; content: string }[],
      attemptsLeft: number
    ): Promise<void> => {
      try {
        const output = (await withRetry(() =>
          callClaude(
            model,
            system,
            filesPrompt(part, chunk, graph),
            FILES_SCHEMA,
            cwd,
            usage
          )
        )) as {
          files: (DescribedEntry & { path: string })[];
        };
        for (const entry of output.files) {
          const file = fileById.get(entry.path);
          if (file && chunk.some((item) => item.file.id === file.id)) {
            descriptions.files[file.id] = toDescription(fileKey(file), entry);
            usage.describedChars += Math.min(read(file).length, 40_000);
          }
        }
      } catch (error) {
        failures.push(`${part.id}: ${String(error).slice(0, 200)}`);
      }
      const missing = chunk.filter(
        ({ file }) => descriptions.files[file.id]?.hash !== fileKey(file)
      );
      if (missing.length === 0) return;
      if (attemptsLeft > 1) return describeChunk(missing, attemptsLeft - 1);
      for (const { file } of missing) {
        failures.push(`${file.id}: no description came back`);
      }
    };
    await runPool(
      chunkBySize(contents, ({ content }) => content.length, CHUNK_CHARS),
      1,
      (chunk) => describeChunk(chunk, 2)
    );

    const operations = graph.operations.filter(
      (operation) => operation.part === part.id
    );
    try {
      const output = (await withRetry(() =>
        callClaude(
          model,
          system,
          partPrompt(part, graph, descriptions.files, operations),
          PART_SCHEMA,
          cwd,
          usage
        )
      )) as {
        part: DescribedEntry;
        operations: (DescribedEntry & { name: string })[];
      };
      descriptions.parts[part.id] = toDescription(
        partKey(part, graph),
        output.part
      );
      for (const entry of output.operations) {
        const operation = operations.find(
          (candidate) => candidate.name === entry.name
        );
        if (operation)
          descriptions.operations[operation.name] = toDescription(
            operation.hash,
            entry
          );
      }
      for (const operation of operations) {
        if (descriptions.operations[operation.name]?.hash !== operation.hash)
          failures.push(
            `operation ${operation.name}: no description came back`
          );
      }
    } catch (error) {
      failures.push(
        `${part.id} (part summary): ${String(error).slice(0, 200)}`
      );
    }
    save();
    console.log(
      `  ${part.id}: ${files.length} files in ${((Date.now() - started) / 1000).toFixed(0)}s (running total: ${formatUsage(usage)})`
    );
  });

  const appKey = sha1(
    [
      PROMPT_VERSION,
      ...graph.parts.map((part) => descriptions.parts[part.id]?.hash ?? ''),
    ].join('\n')
  );
  if (!only && descriptions.app?.hash !== appKey) {
    try {
      const output = (await withRetry(() =>
        callClaude(
          model,
          system,
          appPrompt(graph, descriptions.parts, context),
          APP_SCHEMA,
          cwd,
          usage
        )
      )) as DescribedEntry;
      descriptions.app = toDescription(appKey, output);
    } catch (error) {
      failures.push(`app summary: ${String(error).slice(0, 200)}`);
    }
  }

  const run: DescribeRun = {
    at: new Date().toISOString(),
    model,
    scope: only ? only.join(', ') : 'all parts',
    ...usage,
  };
  descriptions.runs.push(run);
  save();
  console.log(`\nDescribed ${run.scope} with ${model}: ${formatUsage(usage)}.`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} problem(s):`);
    for (const failure of failures) console.log(`  ${failure}`);
    process.exitCode = 1;
  }
};
