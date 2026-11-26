<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Verb } from '../../model';
import type { MapIndex, Mode } from '../mapIndex';
import { linesWithVerb, overviewModel, plural, verbsUsed } from '../overview';
import AreaTalks from './AreaTalks.vue';
import ClaimList from './ClaimList.vue';
import LineList from './LineList.vue';

const props = defineProps<{ index: MapIndex; mode: Mode }>();
defineEmits<{ openArea: [id: string]; openAreaByName: [name: string]; openFile: [id: string]; allParts: [] }>();

const model = computed(() => overviewModel(props.index, props.mode));
const verb = ref<Verb | null>(null);
const verbs = computed(() => verbsUsed(model.value.lines));
const lines = computed(() => linesWithVerb(model.value.lines, verb.value));
const max = computed(() => Math.max(1, ...model.value.lines.map((line) => line.count)));
const fmt = (n: number) => n.toLocaleString('en-US');
const source = computed(() => props.index.graph.source);
</script>

<template>
  <div class="page" data-test-id="overview">
    <p v-if="model.draftAreas + model.draftClaims > 0" class="note">
      <span class="chip">Draft</span>
      {{
        [model.draftAreas ? plural(model.draftAreas, 'area') : '', model.draftClaims ? plural(model.draftClaims, 'claim') : '']
          .filter(Boolean)
          .join(' and ')
      }}
      on this page {{ model.draftAreas + model.draftClaims === 1 ? 'is' : 'are' }} an agent’s draft, not yet confirmed. To confirm one, delete its
      <code>draft: true</code> in <code>.sinopia/map.mjs</code>.
    </p>
    <p v-if="model.byFolder" class="note plain">
      This map names no areas yet, so its parts are grouped by top folder. Areas in <code>.sinopia/map.mjs</code> group them by what they do
      (<code>sinopia map docs</code>).
    </p>
    <div class="intro">
      <h1>{{ model.title }}</h1>
      <p v-if="model.text" class="lead">{{ model.text }}</p>
      <p class="facts">
        <b>{{ plural(model.areas.length, 'area') }}</b> and <b>{{ plural(model.lines.length, 'named line') }}</b>, instead of
        {{ fmt(model.facts.parts) }} part cards and {{ fmt(model.facts.partPairs) }} unnamed part-to-part lines.
        {{ plural(model.facts.files, 'file') }}.
      </p>
    </div>

    <ClaimList
      :index="index"
      :claims="model.claims"
      :mode="mode"
      title="Claims"
      sub="What the code promises, checked by the scan. Tap one."
      @open-file="(id) => $emit('openFile', id)"
    />

    <section>
      <div class="sh">
        <h2>Areas</h2>
        <span class="sub">Tap an area to see its parts and what it talks to.</span>
      </div>
      <div class="areas">
        <button
          v-for="card in model.areas"
          :key="card.area.id"
          type="button"
          class="area"
          :data-test-id="`area-${card.area.id}`"
          @click="$emit('openArea', card.area.id)"
        >
          <span class="name"
            >{{ card.area.name }}<span v-if="card.area.draft" class="chip draft" title="Written by an agent, not yet confirmed">draft</span
            ><span class="go">Open ›</span></span
          >
          <span v-if="card.why" class="why">{{ card.why }}</span>
          <span class="meta"
            >{{ plural(card.area.parts.length, 'part') }} · {{ plural(card.area.files, 'file')
            }}<template v-if="card.area.serverCalls"> · {{ plural(card.area.serverCalls, 'server call') }}</template></span
          >
          <AreaTalks :talks="card.talks" />
        </button>
      </div>
    </section>

    <section>
      <div class="sh">
        <h2>How the areas connect</h2>
        <span class="sub">One line per pair of areas and kind of link. Tap a line for real examples.</span>
      </div>
      <div v-if="verbs.length > 1" class="filters" role="group" aria-label="Filter by verb">
        <button type="button" :aria-pressed="!verb" data-test-id="verb-all" @click="verb = null">
          All<span class="n">{{ model.lines.length }}</span>
        </button>
        <button
          v-for="entry in verbs"
          :key="entry.verb"
          type="button"
          :aria-pressed="verb === entry.verb"
          :data-test-id="`verb-${entry.verb}`"
          @click="verb = entry.verb"
        >
          {{ entry.verb }}<span class="n">{{ entry.lines }}</span>
        </button>
      </div>
      <LineList
        :key="verb ?? 'all'"
        :index="index"
        :lines="lines"
        :mode="mode"
        :limit="12"
        :max="max"
        @open-area="(name) => $emit('openAreaByName', name)"
        @open-file="(id) => $emit('openFile', id)"
      />
    </section>

    <footer>
      <p>
        Scanned {{ source.label }}<template v-if="source.sha">
          at <code>{{ source.sha.slice(0, 9) }}</code></template
        >
        on {{ index.graph.generatedAt.slice(0, 16).replace('T', ' ') }} UTC. {{ plural(model.facts.links, 'file link') }} folded into
        {{ plural(model.lines.length, 'area line') }}.
      </p>
      <p>
        <button type="button" data-test-id="all-parts" @click="$emit('allParts')">
          See all {{ fmt(model.facts.parts) }} parts as cards ›
        </button>
      </p>
    </footer>
  </div>
</template>
