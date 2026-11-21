<script setup lang="ts">
import { computed } from 'vue';
import type { Gap } from '../../model';

interface GapsPanelProps {
  gaps: Gap[];
}

const props = defineProps<GapsPanelProps>();
const emit = defineEmits<{ openFile: [id: string]; close: [] }>();
const LEVELS = ['error', 'warning', 'info'] as const;
const byLevel = computed(() =>
  LEVELS.map((level) => ({
    level,
    gaps: props.gaps.filter((gap) => gap.level === level),
  })).filter((group) => group.gaps.length > 0)
);
</script>

<template>
  <aside class="flex h-full flex-col overflow-hidden bg-white">
    <div class="flex items-start gap-2 border-b border-slate-200 px-4 py-3">
      <div class="min-w-0 flex-1">
        <h2 class="text-base font-semibold text-slate-900">
          What the scan could not follow
        </h2>
        <p class="text-xs text-slate-500">
          Links the map can't draw from the code alone, and checks that failed.
        </p>
      </div>
      <button
        type="button"
        data-test-id="gaps-close"
        class="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
        @click="emit('close')"
      >
        ✕
      </button>
    </div>
    <div class="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
      <section v-for="group in byLevel" :key="group.level">
        <h3
          class="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase"
        >
          {{ group.level }} ({{ group.gaps.length }})
        </h3>
        <ul class="space-y-1.5">
          <li
            v-for="(gap, position) in group.gaps"
            :key="position"
            class="text-xs text-slate-700"
          >
            <span class="font-mono text-slate-400">{{ gap.kind }}</span>
            {{ gap.detail }}
            <button
              v-if="gap.file && gap.file.endsWith('.vue')"
              type="button"
              :data-test-id="`gaps-open-${position}`"
              class="text-blue-700 underline"
              @click="gap.file && emit('openFile', gap.file)"
            >
              show
            </button>
          </li>
        </ul>
      </section>
    </div>
  </aside>
</template>
