<script setup lang="ts">
import { computed } from 'vue';
import type { Area } from '../../model';
import type { MapIndex, Mode } from '../mapIndex';
import { areaModel, plural } from '../overview';
import AreaTalks from './AreaTalks.vue';
import ClaimList from './ClaimList.vue';
import LineList from './LineList.vue';

const props = defineProps<{ index: MapIndex; area: Area; mode: Mode }>();
defineEmits<{ back: []; openAreaByName: [name: string]; openPart: [id: string]; openFile: [id: string] }>();

const model = computed(() => areaModel(props.index, props.area, props.mode));
const max = computed(() => Math.max(1, ...(props.index.graph.areaLinks ?? []).map((line) => line.count)));
const source = computed(() => props.index.graph.source);
</script>

<template>
  <div class="page" :data-test-id="`area-page-${area.id}`">
    <div class="back">
      <button type="button" data-test-id="area-back" @click="$emit('back')">‹ Overview</button>
    </div>
    <div class="intro">
      <h1>
        {{ area.name
        }}<span v-if="area.draft" class="chip draft" title="Written by an agent, not yet confirmed: delete draft: true in .sinopia/map.mjs to confirm it"
          >draft</span
        >
      </h1>
      <p v-if="model.why" class="lead">{{ model.why }}</p>
      <p class="facts">
        <b>{{ plural(area.parts.length, 'part') }}</b> · {{ plural(area.files, 'file')
        }}<template v-if="area.tests"> ({{ area.tests }} tests)</template> · {{ plural(area.internalLinks, 'link') }} inside the
        area<template v-if="area.serverCalls">
          · {{ plural(area.serverCalls, 'server call') }} ({{ area.serverOps }} different)</template
        >
      </p>
      <p v-if="mode === 'dev' && area.folders.length" class="facts">
        folders:
        <template v-for="(folder, i) in area.folders" :key="folder"
          ><template v-if="i">, </template><code>{{ folder }}</code></template
        >
      </p>
    </div>

    <ClaimList
      :index="index"
      :claims="model.claims"
      :mode="mode"
      :title="`Claims about ${area.name}`"
      @open-file="(id) => $emit('openFile', id)"
    />

    <section>
      <div class="sh">
        <h2>Out: what {{ area.name }} does to other areas</h2>
        <span class="sub">{{ plural(model.out.length, 'named line') }}, biggest first. Tap one for examples.</span>
      </div>
      <LineList
        :index="index"
        :lines="model.out"
        :mode="mode"
        :limit="10"
        :max="max"
        :here="area.name"
        @open-area="(name) => $emit('openAreaByName', name)"
        @open-file="(id) => $emit('openFile', id)"
      />
    </section>
    <section>
      <div class="sh">
        <h2>In: what other areas do to {{ area.name }}</h2>
        <span class="sub">{{ plural(model.in.length, 'named line') }}</span>
      </div>
      <LineList
        :index="index"
        :lines="model.in"
        :mode="mode"
        :limit="10"
        :max="max"
        :here="area.name"
        @open-area="(name) => $emit('openAreaByName', name)"
        @open-file="(id) => $emit('openFile', id)"
      />
    </section>

    <section>
      <div class="sh">
        <h2>Parts</h2>
        <span class="sub">{{ area.parts.length }}, biggest first. Tap one to see its files.</span>
      </div>
      <div class="panel">
        <ul>
          <li v-for="part in model.parts" :key="part.id" class="part">
            <button type="button" class="row" :data-test-id="`part-${part.id}`" @click="$emit('openPart', part.id)">
              <span class="pbody">
                <span class="ptitle"
                  ><code v-if="mode === 'dev'">{{ part.title }}</code
                  ><template v-else>{{ part.title }}</template></span
                >
                <span v-if="part.sub && part.sub !== part.title" class="pid">{{ part.sub }}</span>
                <span v-if="part.text" class="pdesc">{{ part.text }}</span>
                <span class="pmeta"
                  >{{ plural(part.files, 'file') }}<template v-if="part.tests"> ({{ part.tests }} tests)</template> ·
                  <b>{{ part.outTotal.toLocaleString('en-US') }}</b> links to other areas · <b>{{ part.inTotal.toLocaleString('en-US') }}</b> from
                  them</span
                >
                <AreaTalks :talks="[...part.out.slice(0, 2), ...part.in.slice(0, 2)]" />
              </span>
              <span class="go">Open ›</span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <footer>
      <p>
        Scanned {{ source.label }}<template v-if="source.sha">
          at <code>{{ source.sha.slice(0, 9) }}</code></template
        >
        on {{ index.graph.generatedAt.slice(0, 16).replace('T', ' ') }} UTC.
      </p>
    </footer>
  </div>
</template>
