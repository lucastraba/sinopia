<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import type { AreaLink } from '../../model';
import { type MapIndex, type Mode, partLabel } from '../mapIndex';
import { kindWord, namesTarget, plural, topParts } from '../overview';
import LinkExamples from './LinkExamples.vue';

const props = defineProps<{
  index: MapIndex;
  lines: AreaLink[];
  mode: Mode;
  /** How many show before "Show the other N lines". */
  limit: number;
  /** The biggest line on the map: bars are drawn against it. */
  max: number;
  /** The area whose page this is: its own name drops out of the sentences. */
  here?: string | null;
}>();
defineEmits<{ openArea: [name: string]; openFile: [id: string] }>();

const open = reactive<Record<string, boolean>>({});
const all = ref(false);
const shown = computed(() => (all.value ? props.lines : props.lines.slice(0, props.limit)));
const fmt = (n: number) => n.toLocaleString('en-US');
const verbClass = (verb: string) => `v-${verb.replace(/[^a-z]+/g, '-')}`;
const bar = (count: number) => {
  const r = Math.sqrt(count / Math.max(1, props.max));
  return { width: `${Math.max(2, Math.round(100 * r))}%`, height: `${2 + Math.round(7 * r)}px` };
};
const parts = (counts: Record<string, number>) => {
  const { ids, more } = topParts(counts, 3);
  return ids.map(([id, n]) => `${partLabel(props.index, id, props.mode)} ${fmt(n)}`).join(', ') + (more ? `, and ${more} more` : '');
};
</script>

<template>
  <div class="panel">
    <ul>
      <li v-if="!lines.length" class="empty">No links.</li>
      <li v-for="line in shown" :key="line.id" class="conn" :class="open[line.id] ? 'open' : ''">
        <button
          type="button"
          class="row"
          :class="verbClass(line.verb)"
          :aria-expanded="!!open[line.id]"
          data-test-id="area-line"
          @click="open[line.id] = !open[line.id]"
        >
          <span class="sent">
            <template v-if="here === line.from">
              <span class="verb" :class="verbClass(line.verb)">{{ line.verb }}</span>
              <template v-if="namesTarget(line.verb, line.to)">
                <span v-if="line.viaQueries" class="via"> with queries from</span>
                {{ ' ' }}<span class="an">{{ line.to }}</span>
              </template>
            </template>
            <template v-else-if="here === line.to">
              <span class="an">{{ line.from }}</span>{{ ' ' }}
              <span class="verb" :class="verbClass(line.verb)">{{ line.verb }}</span>{{ ' ' }}
              <span v-if="namesTarget(line.verb, line.to)" class="via">{{ line.viaQueries ? 'with its queries' : 'it' }}</span>
            </template>
            <template v-else>
              <span class="an">{{ line.from }}</span>{{ ' ' }}
              <span class="verb" :class="verbClass(line.verb)">{{ line.verb }}</span>
              <template v-if="namesTarget(line.verb, line.to)">
                <span v-if="line.viaQueries" class="via"> with queries from</span>
                {{ ' ' }}<span class="an">{{ line.to }}</span>
              </template>
            </template>
          </span>
          <span class="count">{{ fmt(line.count) }}</span>
          <span class="chev" aria-hidden="true">›</span>
          <span class="barline"><i :style="bar(line.count)" /></span>
        </button>
        <div v-if="open[line.id]" class="detail">
          <p>
            {{ plural(line.count, 'link') }} from {{ plural(line.files, 'file')
            }}<template v-if="Object.keys(line.kinds).length > 1 || mode === 'dev'">
              ·
              {{
                Object.entries(line.kinds)
                  .map(([kind, n]) => `${kindWord(kind, mode)} ${fmt(n)}`)
                  .join(', ')
              }}</template
            >.
          </p>
          <p><span class="hint">From</span> {{ parts(line.fromParts) }}</p>
          <p><span class="hint">To</span> {{ parts(line.toParts) }}</p>
          <h4>Examples</h4>
          <LinkExamples :index="index" :examples="line.examples" :mode="mode" @open-file="(id) => $emit('openFile', id)" />
          <p v-if="here">
            <button type="button" class="btn" data-test-id="line-open-area" @click="$emit('openArea', here === line.from ? line.to : line.from)">
              Open {{ here === line.from ? line.to : line.from }} ›
            </button>
          </p>
        </div>
      </li>
    </ul>
    <button v-if="lines.length > limit" type="button" class="showmore" data-test-id="lines-more" @click="all = !all">
      {{ all ? `Show only the ${limit} biggest` : `Show the other ${lines.length - limit} lines` }}
    </button>
  </div>
</template>
