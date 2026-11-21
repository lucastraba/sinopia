<script setup lang="ts">
import { computed } from 'vue';
import { formatDiff } from '../../diff/format';
import type { GraphDiff } from '../../model';

interface ChangesPanelProps {
  diff: GraphDiff;
}

const props = defineProps<ChangesPanelProps>();
const emit = defineEmits<{ openPart: [id: string]; close: [] }>();
const text = computed(() => formatDiff(props.diff));
</script>

<template>
  <aside class="flex h-full flex-col overflow-hidden bg-white">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold text-slate-900">
          What the branch changed
        </h2>
        <p class="truncate text-xs text-slate-500">
          {{ diff.head.label }} against {{ diff.base.label }} ({{
            diff.base.sha.slice(0, 9)
          }})
        </p>
      </div>
      <button
        type="button"
        data-test-id="changes-close"
        class="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>
    <div class="flex-1 overflow-y-auto px-4 py-3 text-sm">
      <h3
        class="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase"
      >
        Parts touched
      </h3>
      <div class="mb-4 flex flex-wrap gap-1.5">
        <button
          v-for="part in diff.touchedParts"
          :key="part.part"
          type="button"
          :data-test-id="`changes-part-${part.part}`"
          class="rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-xs text-orange-900"
          @click="emit('openPart', part.part)"
        >
          {{ part.part }} ·
          {{ part.added.length + part.modified.length + part.removed.length }}
        </button>
      </div>
      <pre
        class="text-[11px] leading-snug whitespace-pre-wrap text-slate-800"
        >{{ text }}</pre
      >
    </div>
  </aside>
</template>
