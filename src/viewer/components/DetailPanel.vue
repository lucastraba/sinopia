<script setup lang="ts">
import { computed } from 'vue';
import { serverCallsOf } from '../../links';
import type { SelectionKind } from '../graphs';
import {
  fileLabel,
  fileName,
  type MapIndex,
  type Mode,
  operationLabel,
  partLabel,
  textOf,
} from '../mapIndex';

interface DetailPanelProps {
  index: MapIndex;
  selection: { kind: SelectionKind; id: string };
  mode: Mode;
}

const props = defineProps<DetailPanelProps>();
const emit = defineEmits<{
  select: [selection: { kind: SelectionKind; id: string }];
  openPart: [id: string];
  openScreen: [path: string];
  close: [];
}>();

interface Row {
  label: string;
  hint: string;
  target: { kind: SelectionKind; id: string } | null;
}

interface Section {
  title: string;
  rows: Row[];
}

const fileRow = (id: string): Row => ({
  label: fileLabel(props.index, id, props.mode),
  hint:
    props.mode === 'plain'
      ? fileName(id)
      : (props.index.files.get(id)?.kind ?? ''),
  target: { kind: 'file', id },
});

const operationRow = (name: string): Row => {
  const operation = props.index.operations.get(name);
  // A server call that is a link (tRPC, HTTP) opens the file that answers it.
  const call = operation ? undefined : props.index.serverCalls.get(name);
  if (call?.target) {
    return {
      label: name,
      hint: `${call.kind} · ${fileName(call.target)}`,
      target: { kind: 'file', id: call.target },
    };
  }
  return {
    label: operationLabel(props.index, name, props.mode),
    hint: [operation?.type ?? '', operation?.subgraphs.join(', ') ?? '']
      .filter(Boolean)
      .join(' · '),
    target: { kind: 'operation', id: name },
  };
};

const partRow = (id: string): Row => ({
  label: partLabel(props.index, id, props.mode),
  hint: id,
  target: { kind: 'part', id },
});

const unique = (rows: Row[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.target?.kind}:${row.target?.id ?? row.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const gate = (feature: string | null, flags: string[]) =>
  [
    feature ? `needs ${feature}` : 'open to all',
    ...flags.map((flag) => `flag ${flag}`),
  ].join(', ');

const view = computed(() => {
  const { index, selection, mode } = props;
  const sections: Section[] = [];
  const facts: string[] = [];
  const screens: { path: string; gate: string }[] = [];
  let title = selection.id;
  let subtitle = '';
  let text = '';
  let code = '';
  let part: string | null = null;

  if (selection.kind === 'part') {
    const record = index.parts.get(selection.id);
    title = partLabel(index, selection.id, mode);
    subtitle = `${selection.id} · ${record?.kind ?? ''}`;
    text = textOf(index.descriptions.parts[selection.id], mode);
    part = selection.id;
    const files = record?.files ?? [];
    facts.push(
      `${files.filter((id) => !id.endsWith('.spec.ts')).length} files, ${files.filter((id) => id.endsWith('.spec.ts')).length} tests`
    );
    for (const route of index.graph.routes) {
      if (route.component && files.includes(route.component)) {
        screens.push({
          path: route.path,
          gate: gate(route.feature, route.flags),
        });
      }
    }
    sections.push({
      title: 'Server calls',
      rows: [...(index.partOperations.get(selection.id) ?? [])]
        .toSorted()
        .map(operationRow),
    });
    sections.push({
      title: 'Uses these parts',
      rows: [
        ...(index.partLinks.get(selection.id) ?? new Map<string, number>()),
      ]
        .toSorted((a, b) => b[1] - a[1])
        .map(([id, count]) => ({ ...partRow(id), hint: `${count} links` })),
    });
    sections.push({
      title: 'Used by these parts',
      rows: [...index.partLinks]
        .filter(([, targets]) => targets.has(selection.id))
        .map(([id]) => partRow(id)),
    });
    const flags = [
      ...new Set(files.flatMap((id) => index.files.get(id)?.flags ?? [])),
    ].toSorted();
    if (flags.length > 0) facts.push(`Feature flags: ${flags.join(', ')}`);
  }

  if (selection.kind === 'file') {
    const file = index.files.get(selection.id);
    title = fileLabel(index, selection.id, mode);
    subtitle = index.graph.meta.srcDir
      ? selection.id.replace(`${index.graph.meta.srcDir}/`, '')
      : selection.id;
    text = textOf(index.descriptions.files[selection.id], mode);
    part = file?.part ?? null;
    if (file) {
      facts.push(
        `${file.kind}, ${file.lines} lines, in ${partLabel(index, file.part, mode)}`
      );
      if (file.registeredAs)
        facts.push(`Opened by name at runtime as "${file.registeredAs}"`);
      if (file.flags.length > 0)
        facts.push(`Feature flags: ${file.flags.join(', ')}`);
      if (file.libraries.length > 0 && mode === 'dev')
        facts.push(`Libraries: ${file.libraries.join(', ')}`);
      for (const route of index.routesByComponent.get(file.id) ?? []) {
        screens.push({
          path: route.path,
          gate: gate(route.feature, route.flags),
        });
      }
      sections.push({
        title: 'Shows these parts of the screen',
        rows: unique(
          file.components.map((use) =>
            use.target
              ? {
                  ...fileRow(use.target),
                  hint: use.byName ? 'opened by name' : fileName(use.target),
                }
              : { label: use.tag, hint: use.library ?? 'unknown', target: null }
          )
        ),
      });
      sections.push({
        title: 'Server calls',
        rows: serverCallsOf(file).map((call) => operationRow(call.name)),
      });
      sections.push({
        title: 'Uses',
        rows: file.imports
          .filter((id) => !file.components.some((use) => use.target === id))
          .map(fileRow),
      });
      sections.push({
        title: 'Other links',
        rows: (file.links ?? []).map((link) => ({
          ...fileRow(link.target),
          hint: link.label ? `${link.kind} ${link.label}` : link.kind,
        })),
      });
      sections.push({
        title: 'Used by',
        rows: (index.usedBy.get(file.id) ?? []).map(fileRow),
      });
      const gaps = index.gapsByFile.get(file.id) ?? [];
      if (gaps.length > 0) {
        sections.push({
          title: 'What the scan could not follow',
          rows: gaps.map((gap) => ({
            label: gap.detail,
            hint: gap.kind,
            target: null,
          })),
        });
      }
    }
  }

  if (selection.kind === 'operation') {
    const operation = index.operations.get(selection.id);
    title = operationLabel(index, selection.id, mode);
    subtitle = `${operation?.type ?? ''} ${selection.id}`;
    text = textOf(index.descriptions.operations[selection.id], mode);
    part = operation?.part ?? null;
    if (operation) {
      if (operation.subgraphs.length > 0)
        facts.push(
          `Answered by ${operation.subgraphs.join(', ')}${
            operation.allSubgraphs.length > operation.subgraphs.length
              ? ` (fields also come from ${operation.allSubgraphs.filter((name) => !operation.subgraphs.includes(name)).join(', ')})`
              : ''
          }`
        );
      const more = operation.fields.length - operation.rootFields.length;
      facts.push(
        `Asks for ${operation.rootFields.join(', ')}${more > 0 ? ` and ${more} more fields` : ''}`
      );
      if (mode === 'dev') code = operation.document;
      sections.push({
        title: 'Called from',
        rows: (index.operationCallers.get(selection.id) ?? []).map(fileRow),
      });
      sections.push({
        title: 'Defined in',
        rows: [
          {
            label: fileName(operation.file),
            hint: operation.part,
            target: null,
          },
        ],
      });
    }
  }

  if (selection.kind === 'subgraph') {
    const subgraph = index.graph.subgraphs.find(
      (candidate) => candidate.name === selection.id
    );
    title = selection.id;
    subtitle = `Backend service${index.graph.backend ? ` · ${index.graph.backend.label}` : ''}`;
    text =
      mode === 'plain'
        ? `One of the backend services behind the app. The map lists the server calls it answers.`
        : `Backend service. Its schema was read from ${subgraph?.sources.length ?? 0} file(s)${index.graph.backend ? ` in ${index.graph.backend.label}` : ''}.`;
    sections.push({
      title: 'Answers these server calls',
      rows: index.graph.operations
        .filter((operation) => operation.subgraphs.includes(selection.id))
        .map((operation) => operationRow(operation.name)),
    });
    if (mode === 'dev') {
      sections.push({
        title: 'Schema files',
        rows: (subgraph?.sources ?? []).map((source) => ({
          label: source,
          hint: '',
          target: null,
        })),
      });
    }
  }

  return {
    title,
    subtitle,
    text,
    facts,
    screens,
    code,
    part,
    sections: sections.filter((section) => section.rows.length > 0),
  };
});
</script>

<template>
  <aside class="flex h-full flex-col overflow-hidden bg-white">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-base leading-snug font-semibold text-slate-900">
          {{ view.title }}
        </h2>
        <p class="truncate text-xs text-slate-500">{{ view.subtitle }}</p>
      </div>
      <button
        type="button"
        data-test-id="detail-close"
        class="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>
    <div class="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
      <p v-if="view.text" class="leading-relaxed text-slate-800">
        {{ view.text }}
      </p>
      <p v-else class="text-slate-400 italic">
        No description yet (pnpm map describe).
      </p>
      <ul v-if="view.facts.length" class="space-y-1 text-xs text-slate-600">
        <li v-for="fact in view.facts" :key="fact">{{ fact }}</li>
      </ul>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="view.part && selection.kind !== 'part'"
          type="button"
          data-test-id="detail-open-part"
          class="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
          @click="emit('openPart', view.part)"
        >
          Show its part
        </button>
        <button
          v-if="selection.kind === 'part'"
          type="button"
          data-test-id="detail-open-this-part"
          class="rounded-md border border-blue-600 bg-blue-600 px-2.5 py-1 text-xs text-white"
          @click="emit('openPart', selection.id)"
        >
          Open this part
        </button>
      </div>
      <section v-if="view.screens.length">
        <h3
          class="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase"
        >
          Screens
        </h3>
        <button
          v-for="screen in view.screens"
          :key="screen.path"
          type="button"
          :data-test-id="`detail-screen-${screen.path}`"
          class="block w-full rounded px-2 py-1 text-left hover:bg-sky-50"
          @click="emit('openScreen', screen.path)"
        >
          <span class="font-mono text-xs text-sky-800">{{ screen.path }}</span>
          <span class="ml-2 text-xs text-slate-500">{{ screen.gate }}</span>
        </button>
      </section>
      <section v-for="section in view.sections" :key="section.title">
        <h3
          class="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase"
        >
          {{ section.title }} ({{ section.rows.length }})
        </h3>
        <ul>
          <li v-for="row in section.rows" :key="`${row.label}-${row.hint}`">
            <button
              v-if="row.target"
              type="button"
              :data-test-id="`detail-row-${row.target.kind}-${row.target.id}`"
              class="flex w-full items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-slate-100"
              @click="row.target && emit('select', row.target)"
            >
              <span class="text-slate-800">{{ row.label }}</span>
              <span class="truncate text-xs text-slate-400">{{
                row.hint
              }}</span>
            </button>
            <div v-else class="flex items-baseline gap-2 px-2 py-1">
              <span class="text-slate-700">{{ row.label }}</span>
              <span class="truncate text-xs text-slate-400">{{
                row.hint
              }}</span>
            </div>
          </li>
        </ul>
      </section>
      <pre
        v-if="view.code"
        class="overflow-x-auto rounded bg-slate-900 p-3 text-[11px] leading-snug text-slate-100"
        >{{ view.code }}</pre
      >
    </div>
  </aside>
</template>
