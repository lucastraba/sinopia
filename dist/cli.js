import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assertAdapterVersion } from './adapter.js';
import { coverageOf, formatCoverage } from './coverage.js';
import { describe } from './describe/describe.js';
import { diffGraphs } from './diff/diff.js';
import { formatDiff } from './diff/format.js';
import { ensureDir, exportSnapshot, git, resolveSha } from './repo.js';
import { serve } from './serve.js';
import { summarizeGaps, validateGraph } from './validate.js';
const usage = (command) => `${command} <command>

  scan                     Scan the working tree into graph.json, plus the validation report
  check [--json]           Scan without saving and report errors and coverage; exits 1 on errors
  describe [--part <id>]…  Describe parts, files and operations with claude -p (cached by content)
           [--model sonnet] [--estimate]
  diff [--head <ref>] [--base <ref>] [--json]
                           What a branch changed. Head defaults to the working tree,
                           base to its merge-base with the default branch.
  refresh [--force]        Scan and describe if HEAD moved since the last refresh
  serve [--host <ip>] [--port 8400]
                           The viewer for this map`;
/** Scans with the adapter, then runs the generic checks on what it returned. */
const scanAt = async (options, ref) => {
    const graph = await adapterScan(options, ref);
    // A plain-mode adapter that adds its own links has links after all.
    if (graph.files.some((file) => (file.links?.length ?? 0) > 0))
        graph.meta.hasLinks = true;
    graph.gaps.push(...validateGraph(graph, graph.files.length));
    return graph;
};
const adapterScan = async ({ adapter, repo, out }, ref) => {
    if (!ref) {
        const head = git(repo, ['rev-parse', 'HEAD']);
        const branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
        return adapter.scan({
            repo,
            root: repo,
            artifacts: out,
            source: { label: `working tree of ${branch}`, sha: head },
        });
    }
    const sha = resolveSha(repo, ref);
    return adapter.scan({
        repo,
        root: exportSnapshot(repo, out, sha, adapter.snapshotPaths),
        artifacts: out,
        source: { label: ref, sha },
    });
};
const printGaps = (graph) => {
    console.log(`\nValidation (${graph.gaps.length} findings):`);
    for (const line of summarizeGaps(graph.gaps))
        console.log(`  ${line}`);
    const loud = graph.gaps.filter((gap) => gap.level !== 'info');
    for (const gap of loud.slice(0, 40)) {
        console.log(`  ${gap.level.toUpperCase()} ${gap.kind}: ${gap.detail}${gap.file ? ` (${gap.file})` : ''}`);
    }
    if (loud.length > 40) {
        console.log(`  … ${loud.length - 40} more in gaps.txt`);
    }
};
const statePath = (out) => join(out, 'project.json');
export const readState = (out) => existsSync(statePath(out))
    ? JSON.parse(readFileSync(statePath(out), 'utf8'))
    : null;
const writeState = (options, patch) => {
    const current = readState(options.out);
    const name = options.out.split('/').filter(Boolean).pop() ?? 'map';
    const next = {
        name,
        repo: options.repo,
        adapter: options.adapter.name,
        scannedSha: null,
        describedSha: null,
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
    };
    writeFileSync(statePath(options.out), JSON.stringify(next, null, 2));
};
const scanCommand = async (options) => {
    const started = Date.now();
    const graph = await scanAt(options, null);
    writeFileSync(join(options.out, 'graph.json'), JSON.stringify(graph));
    writeFileSync(join(options.out, 'gaps.txt'), graph.gaps
        .map((gap) => `${gap.level}\t${gap.kind}\t${gap.file ?? ''}\t${gap.detail}`)
        .join('\n') + '\n');
    const describable = graph.files.filter((file) => file.kind !== 'test' && file.kind !== 'generated');
    const extras = [
        graph.operations.length > 0 ? `${graph.operations.length} operations` : '',
        graph.routes.length > 0 ? `${graph.routes.length} routes` : '',
        graph.flags.length > 0 ? `${graph.flags.length} flags` : '',
        graph.subgraphs.length > 0
            ? `${graph.subgraphs.length} subgraphs${graph.backend ? ` (${graph.backend.label})` : ''}`
            : '',
        graph.meta.hasLinks ? `${graph.cycles.length} cycles` : '',
    ].filter(Boolean);
    console.log(`Scanned ${graph.source.label} in ${((Date.now() - started) / 1000).toFixed(1)}s: ` +
        [
            `${graph.parts.length} parts`,
            `${graph.files.length} files (${describable.length} describable)`,
            ...extras,
        ].join(', '));
    printGaps(graph);
    console.log(`\nWrote ${join(options.out, 'graph.json')}`);
    writeState(options, { scannedSha: graph.source.sha });
    if (graph.gaps.some((gap) => gap.level === 'error'))
        process.exitCode = 1;
    return graph;
};
const readGraph = (out) => {
    const graphPath = join(out, 'graph.json');
    if (!existsSync(graphPath))
        throw new Error('No scan yet: run scan first.');
    return JSON.parse(readFileSync(graphPath, 'utf8'));
};
/** The commands every map has: scan, describe, diff, refresh and serve. */
export const runCli = async (options) => {
    const { adapter, repo, out, argv } = options;
    assertAdapterVersion(adapter, options.adapterSource ?? adapter.name);
    ensureDir(out);
    const [command, ...rest] = argv;
    const { values } = parseArgs({
        args: rest.filter((arg) => arg !== '--'),
        options: {
            head: { type: 'string' },
            base: { type: 'string' },
            json: { type: 'boolean', default: false },
            part: { type: 'string', multiple: true },
            model: { type: 'string', default: 'sonnet' },
            estimate: { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
            host: { type: 'string', default: '127.0.0.1' },
            port: { type: 'string', default: '8400' },
        },
    });
    if (command === 'scan') {
        await scanCommand(options);
        return;
    }
    if (command === 'check') {
        const graph = await scanAt(options, null);
        const coverage = coverageOf(graph, options.adapterSource ?? adapter.name);
        if (values.json) {
            console.log(JSON.stringify({ ...coverage, gapList: graph.gaps }, null, 2));
        }
        else {
            console.log(`Check of ${repo} with adapter ${coverage.adapter} (interface v${adapter.interfaceVersion})`);
            for (const line of formatCoverage(coverage))
                console.log(`  ${line}`);
            printGaps(graph);
        }
        if (!coverage.passes)
            process.exitCode = 1;
        return;
    }
    if (command === 'describe') {
        await describe({
            root: repo,
            artifacts: out,
            graph: readGraph(out),
            context: await adapter.describeContext({ repo, artifacts: out }),
            parts: values.part ?? null,
            model: values.model,
            estimateOnly: values.estimate,
        });
        return;
    }
    if (command === 'refresh') {
        const head = git(repo, ['rev-parse', 'HEAD']);
        const state = readState(out);
        if (!values.force && state?.describedSha === head) {
            console.log(`${repo}: up to date at ${head.slice(0, 9)}`);
            return;
        }
        const graph = await scanCommand(options);
        await describe({
            root: repo,
            artifacts: out,
            graph,
            context: await adapter.describeContext({ repo, artifacts: out }),
            parts: null,
            model: values.model,
            estimateOnly: false,
        });
        if (!process.exitCode)
            writeState(options, { describedSha: head });
        return;
    }
    if (command === 'diff') {
        const headRef = values.head ?? null;
        const headSha = headRef ? resolveSha(repo, headRef) : 'HEAD';
        let baseSha;
        if (values.base) {
            baseSha = resolveSha(repo, values.base);
        }
        else if (options.diffBase) {
            const [remote, ...branch] = options.diffBase.split('/');
            try {
                git(repo, ['fetch', remote ?? 'origin', branch.join('/'), '--quiet']);
            }
            catch {
                console.warn(`! Could not fetch ${options.diffBase}; using the local copy`);
            }
            baseSha = git(repo, ['merge-base', options.diffBase, headSha]);
        }
        else {
            let defaultBranch = null;
            try {
                defaultBranch = git(repo, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
            }
            catch {
                defaultBranch = null;
            }
            baseSha = defaultBranch
                ? git(repo, ['merge-base', defaultBranch, headSha])
                : git(repo, ['rev-parse', 'HEAD']);
        }
        const base = await scanAt(options, baseSha);
        base.source.label =
            values.base ?? `merge-base with ${options.diffBase ?? 'the default branch'}`;
        const head = await scanAt(options, headRef);
        const notesPath = join(out, 'notes.json');
        const notes = existsSync(notesPath)
            ? JSON.parse(readFileSync(notesPath, 'utf8'))
            : {};
        const changedFiles = git(repo, headRef
            ? ['diff', '--name-status', '--no-renames', baseSha, resolveSha(repo, headRef)]
            : ['diff', '--name-status', '--no-renames', baseSha]);
        const untracked = headRef ? '' : git(repo, ['ls-files', '--others', '--exclude-standard']);
        const diff = diffGraphs(base, head, changedFiles, untracked, notes, adapter.partOf);
        writeFileSync(join(out, 'diff.json'), JSON.stringify(diff, null, 2));
        console.log(values.json ? JSON.stringify(diff, null, 2) : formatDiff(diff));
        return;
    }
    if (command === 'serve') {
        serve({ host: values.host, port: Number(values.port), data: out });
        return;
    }
    console.log(usage(options.command));
    if (command && command !== 'help')
        process.exitCode = 1;
};
