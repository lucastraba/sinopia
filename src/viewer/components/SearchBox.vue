<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SelectionKind } from '../graphs';
import { fileName, type MapIndex, type Mode } from '../mapIndex';

interface SearchBoxProps {
  index: MapIndex;
  mode: Mode;
}

interface Result {
  kind: SelectionKind | 'screen';
  id: string;
  label: string;
  hint: string;
}

const props = defineProps<SearchBoxProps>();
const emit = defineEmits<{ pick: [result: Result] }>();
const query = ref('');

const entries = computed<(Result & { haystack: string })[]>(() => {
  const { index } = props;
  const entries: (Result & { haystack: string })[] = [];
  for (const route of index.graph.routes) {
    if (!route.component) continue;
    const title = index.descriptions.files[route.component]?.title ?? '';
    entries.push({
      kind: 'screen',
      id: route.path,
      label: title || route.path,
      hint: `screen ${route.path}`,
      haystack: `${route.path} ${route.name ?? ''} ${title}`,
    });
  }
  for (const part of index.graph.parts) {
    const description = index.descriptions.parts[part.id];
    entries.push({
      kind: 'part',
      id: part.id,
      label: description?.title ?? part.name,
      hint: `part ${part.id}`,
      haystack: `${part.id} ${part.name} ${description?.title ?? ''}`,
    });
  }
  for (const operation of index.graph.operations) {
    const description = index.descriptions.operations[operation.name];
    entries.push({
      kind: 'operation',
      id: operation.name,
      label: description?.title ?? operation.name,
      hint: `${operation.type} ${operation.name}`,
      haystack: `${operation.name} ${description?.title ?? ''} ${operation.rootFields.join(' ')}`,
    });
  }
  for (const file of index.graph.files) {
    if (file.kind === 'test' || file.kind === 'generated') continue;
    const description = index.descriptions.files[file.id];
    entries.push({
      kind: 'file',
      id: file.id,
      label: description?.title ?? fileName(file.id),
      hint: fileName(file.id),
      haystack: `${file.id} ${description?.title ?? ''}`,
    });
  }
  return entries.map((entry) => ({
    ...entry,
    haystack: entry.haystack.toLowerCase(),
  }));
});

const results = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return entries.value
    .filter((entry) => words.every((word) => entry.haystack.includes(word)))
    .slice(0, 30);
});

const pick = (result: Result) => {
  query.value = '';
  emit('pick', result);
};
</script>

<template>
  <div class="relative w-full">
    <input
      v-model="query"
      type="search"
      data-test-id="map-search"
      placeholder="Search screens, parts, files, server calls"
      class="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500"
      @keydown.enter="results[0] && pick(results[0])"
      @keydown.escape="query = ''"
    />
    <ul
      v-if="results.length"
      class="absolute top-full right-0 left-0 z-20 mt-1 max-h-96 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg"
    >
      <li v-for="result in results" :key="`${result.kind}:${result.id}`">
        <button
          type="button"
          :data-test-id="`map-search-result-${result.kind}-${result.id}`"
          class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
          @click="pick(result)"
        >
          <span class="text-slate-900">{{ result.label }}</span>
          <span class="truncate text-xs text-slate-400">{{ result.hint }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
