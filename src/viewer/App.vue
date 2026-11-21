<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import ChangesPanel from './components/ChangesPanel.vue';
import DetailPanel from './components/DetailPanel.vue';
import GapsPanel from './components/GapsPanel.vue';
import { cycleTheme, theme } from './theme';
import MapCanvas from './components/MapCanvas.vue';
import SearchBox from './components/SearchBox.vue';
import { useMapData } from './composables/useMapData';
import { useViewState } from './composables/useViewState';
import {
  appModel,
  type MapModel,
  type MapNode,
  partModel,
  screenModel,
  type SelectionKind,
} from './graphs';
import { layoutModel, type Placed } from './layout';
import { partLabel, textOf } from './mapIndex';

const { index, error, load } = useMapData();
const state = useViewState();
const placed = shallowRef<Placed | null>(null);
const panel = ref<'detail' | 'changes' | 'gaps'>('detail');
const isNarrow = window.innerWidth < 768;

onMounted(load);
watch(index, (value) => {
  if (value) document.title = value.graph.meta.title;
});

const route = computed(() =>
  state.screen
    ? (index.value?.graph.routes.find(
        (candidate) => candidate.path === state.screen
      ) ?? null)
    : null
);

const screens = computed(() =>
  (index.value?.graph.routes ?? [])
    .filter((candidate) => candidate.component)
    .map((candidate) => ({
      route: candidate,
      title: candidate.component
        ? (index.value?.descriptions.files[candidate.component]?.title ??
          candidate.path)
        : candidate.path,
    }))
    .sort((a, b) => a.route.path.localeCompare(b.route.path))
);

const model = computed<MapModel | null>(() => {
  if (!index.value) return null;
  if (state.view === 'screens') {
    return route.value
      ? screenModel(index.value, route.value, state.depth, state.mode)
      : null;
  }
  return state.part
    ? partModel(index.value, state.part, state.mode)
    : appModel(index.value, state.mode);
});

let layoutRun = 0;
watch(
  model,
  async (next) => {
    const run = (layoutRun += 1);
    if (!next) {
      placed.value = null;
      return;
    }
    const result = await layoutModel(next, isNarrow);
    if (run === layoutRun) placed.value = result;
  },
  { immediate: true }
);

const selectedId = computed(() =>
  state.selection ? `${state.selection.kind}:${state.selection.id}` : null
);
const hasDiff = computed(() => !!index.value?.diff);
const loudGaps = computed(
  () =>
    index.value?.graph.gaps.filter((gap) => gap.level !== 'info').length ?? 0
);

const select = (selection: { kind: SelectionKind; id: string }) => {
  state.selection = selection;
  panel.value = 'detail';
};

const openPart = (id: string) => {
  state.view = 'map';
  state.part = id;
  state.selection = { kind: 'part', id };
  panel.value = 'detail';
};

const openScreen = (path: string) => {
  state.view = 'screens';
  state.screen = path;
  const component = index.value?.graph.routes.find(
    (candidate) => candidate.path === path
  )?.component;
  state.selection = component ? { kind: 'file', id: component } : null;
  panel.value = 'detail';
};

const onOpen = (node: MapNode) => {
  if (node.select.kind === 'part') return openPart(node.select.id);
  if (node.select.kind === 'file') {
    const screen = index.value?.routesByComponent
      .get(node.select.id)
      ?.find((candidate) => candidate.component === node.select.id);
    if (screen) return openScreen(screen.path);
  }
  select(node.select);
};

const onPick = (result: { kind: SelectionKind | 'screen'; id: string }) => {
  if (result.kind === 'screen') return openScreen(result.id);
  if (result.kind === 'part') return openPart(result.id);
  const part =
    result.kind === 'file'
      ? index.value?.files.get(result.id)?.part
      : result.kind === 'operation'
        ? index.value?.operations.get(result.id)?.part
        : undefined;
  if (part && state.view === 'map') state.part = part;
  select({ kind: result.kind, id: result.id });
};

const goHome = () => {
  state.view = 'map';
  state.part = null;
  state.selection = null;
};

const showPanel = computed(
  () => panel.value !== 'detail' || !!state.selection || !isNarrow
);
</script>

<template>
  <div class="flex h-dvh flex-col text-slate-900">
    <header
      class="z-30 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2"
    >
      <button
        type="button"
        data-test-id="map-home"
        class="text-base font-semibold"
        @click="goHome"
      >
        {{ index?.graph.meta.title ?? 'Map' }}
      </button>
      <nav class="flex min-w-0 items-center gap-1 text-sm text-slate-500">
        <template v-if="state.view === 'map' && state.part && index">
          <span>›</span>
          <span class="truncate text-slate-800">{{
            partLabel(index, state.part, state.mode)
          }}</span>
        </template>
        <template v-if="state.view === 'screens' && route && index">
          <span>›</span>
          <span class="truncate font-mono text-xs text-slate-800">{{
            route.path
          }}</span>
        </template>
      </nav>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <div
          v-if="index?.graph.routes.length"
          class="flex overflow-hidden rounded-md border border-slate-300 text-xs"
        >
          <button
            v-for="view in ['map', 'screens'] as const"
            :key="view"
            type="button"
            :data-test-id="`map-view-${view}`"
            class="px-2.5 py-1"
            :class="
              state.view === view
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-700'
            "
            @click="state.view = view"
          >
            {{ view === 'map' ? 'Parts' : 'Screens' }}
          </button>
        </div>
        <div
          class="flex overflow-hidden rounded-md border border-slate-300 text-xs"
        >
          <button
            v-for="mode in ['plain', 'dev'] as const"
            :key="mode"
            type="button"
            :data-test-id="`map-mode-${mode}`"
            class="px-2.5 py-1"
            :class="
              state.mode === mode
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-700'
            "
            @click="state.mode = mode"
          >
            {{ mode === 'plain' ? 'Plain' : 'Developer' }}
          </button>
        </div>
        <button
          v-if="hasDiff"
          type="button"
          data-test-id="map-changes"
          class="rounded-md border px-2.5 py-1 text-xs"
          :class="
            state.changes
              ? 'border-orange-400 bg-orange-50 text-orange-900'
              : 'border-slate-300 bg-white text-slate-700'
          "
          @click="
            state.changes = !state.changes;
            panel = state.changes ? 'changes' : 'detail';
          "
        >
          Changes {{ state.changes ? 'on' : 'off' }}
        </button>
        <button
          v-if="index"
          type="button"
          data-test-id="map-gaps"
          class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700"
          @click="panel = 'gaps'"
        >
          {{ index.graph.gaps.length }} scan notes<span
            v-if="loudGaps"
            class="text-red-700"
          >
            ({{ loudGaps }} to fix)</span
          >
        </button>
        <button
          type="button"
          data-test-id="map-theme"
          class="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700"
          :title="`Theme: ${theme}. Tap to switch.`"
          @click="cycleTheme"
        >
          {{ { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' }[theme] }}
        </button>
      </div>
      <div v-if="index" class="w-full md:order-none md:ml-4 md:w-80">
        <SearchBox :index="index" :mode="state.mode" @pick="onPick" />
      </div>
    </header>

    <p v-if="error" class="p-6 text-sm text-red-700">{{ error }}</p>

    <main v-else-if="index" class="relative flex min-h-0 flex-1">
      <aside
        v-if="state.view === 'screens'"
        class="w-full overflow-y-auto border-r border-slate-200 bg-white md:w-72"
        :class="route ? 'hidden md:block' : ''"
      >
        <p class="px-3 pt-3 pb-1 text-xs text-slate-500">
          Every page of the app, with what it needs to be visible.
        </p>
        <button
          v-for="screen in screens"
          :key="screen.route.path"
          type="button"
          :data-test-id="`screen-${screen.route.path}`"
          class="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-sky-50"
          :class="screen.route.path === state.screen ? 'bg-sky-50' : ''"
          @click="openScreen(screen.route.path)"
        >
          <span class="block text-sm text-slate-900">{{ screen.title }}</span>
          <span class="block font-mono text-[11px] text-slate-500">{{
            screen.route.path
          }}</span>
          <span class="block text-[11px] text-slate-400">
            {{
              screen.route.feature
                ? `needs ${screen.route.feature}`
                : 'open to all'
            }}{{
              screen.route.flags.length
                ? ` · flag ${screen.route.flags.join(', ')}`
                : ''
            }}
          </span>
        </button>
      </aside>

      <section
        v-if="state.view === 'map' || route"
        class="relative min-w-0 flex-1"
      >
        <div
          v-if="state.view === 'screens' && route"
          class="absolute top-2 left-2 z-10 flex items-center gap-2 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-xs"
        >
          <button
            type="button"
            data-test-id="screen-back"
            class="md:hidden"
            @click="state.screen = null"
          >
            ‹ Screens
          </button>
          <label class="flex items-center gap-1">
            Depth
            <input
              v-model.number="state.depth"
              type="range"
              min="1"
              max="8"
              data-test-id="screen-depth"
              class="w-20"
            />
            {{ state.depth }}
          </label>
        </div>
        <MapCanvas
          :placed="placed"
          :selected-id="selectedId"
          :show-changes="state.changes && hasDiff"
          :edges-on-selection="state.view === 'map' && !state.part"
          @select="(node) => select(node.select)"
          @open="onOpen"
          @clear="state.selection = null"
        />
      </section>

      <div
        v-if="showPanel"
        class="absolute inset-x-0 bottom-0 z-20 h-[55%] border-t border-slate-200 shadow-xl md:static md:h-auto md:w-96 md:border-t-0 md:border-l md:shadow-none"
      >
        <ChangesPanel
          v-if="panel === 'changes' && index.diff"
          :diff="index.diff"
          @open-part="openPart"
          @close="panel = 'detail'"
        />
        <GapsPanel
          v-else-if="panel === 'gaps'"
          :gaps="index.graph.gaps"
          @open-file="(id) => onPick({ kind: 'file', id })"
          @close="panel = 'detail'"
        />
        <DetailPanel
          v-else-if="state.selection"
          :index="index"
          :selection="state.selection"
          :mode="state.mode"
          @select="select"
          @open-part="openPart"
          @open-screen="openScreen"
          @close="state.selection = null"
        />
        <aside v-else class="h-full overflow-y-auto bg-white px-4 py-3 text-sm">
          <h2 class="text-base font-semibold">
            {{ index.descriptions.app?.title ?? index.graph.meta.title }}
          </h2>
          <p class="mt-2 leading-relaxed text-slate-800">
            {{ textOf(index.descriptions.app, state.mode) }}
          </p>
          <h3
            class="mt-4 mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase"
          >
            How to read the map
          </h3>
          <ul class="list-disc space-y-1 pl-4 text-slate-700">
            <li>
              Each card on the overview is a part of the app. Tap one to read
              what it does and see what it connects to; tap "Open this part" to
              see inside.
            </li>
            <li v-if="index.graph.routes.length">
              "Screens" starts from a page of the app and shows what it is built
              from, the server calls it makes and the backend services that
              answer them.
            </li>
            <li>
              "Developer" switches to file names and technical descriptions.
            </li>
            <li v-if="hasDiff">
              "Changes" outlines what the last checked branch touched ({{
                index.diff?.head.label
              }}).
            </li>
          </ul>
          <p class="mt-4 text-xs text-slate-500">
            Scanned {{ index.graph.source.label }} at
            {{ index.graph.source.sha?.slice(0, 9)
            }}<template v-if="index.graph.backend"
              >, backend from {{ index.graph.backend.label }}</template
            >. Descriptions written by Claude; the structure comes from the
            code.
          </p>
        </aside>
      </div>
    </main>
    <p v-else class="p-6 text-sm text-slate-500">Loading the map…</p>
  </div>
</template>
