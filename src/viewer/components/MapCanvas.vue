<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import { usePanZoom } from '../composables/usePanZoom';
import type { MapNode, Tone } from '../graphs';
import type { Placed, Point } from '../layout';

interface MapCanvasProps {
  placed: Placed | null;
  selectedId: string | null;
  showChanges: boolean;
  /** On the overview, only links of the selected card (and new ones) are drawn. */
  edgesOnSelection: boolean;
}

const props = defineProps<MapCanvasProps>();
const emit = defineEmits<{
  select: [node: MapNode];
  open: [node: MapNode];
  clear: [];
}>();

const container = useTemplateRef<HTMLElement>('container');
const {
  transform,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  fit,
  centerOn,
  wasDrag,
  zoomAt,
} = usePanZoom(container);

const TONES: Record<Tone, string> = {
  feature: 'border-sky-300 bg-sky-50',
  poc: 'border-violet-300 bg-violet-50',
  core: 'border-slate-300 bg-white',
  app: 'border-stone-300 bg-stone-50',
  subgraph: 'border-teal-500 bg-teal-50',
  query: 'border-emerald-300 bg-emerald-50',
  mutation: 'border-amber-300 bg-amber-50',
  view: 'border-sky-400 bg-sky-50',
  component: 'border-slate-300 bg-white',
  logic: 'border-indigo-200 bg-indigo-50',
  external: 'border-dashed border-slate-400 bg-slate-100',
};

const CHANGE_LABEL = {
  added: 'new',
  modified: 'changed',
  removed: 'removed',
} as const;

const connected = computed(() => {
  const ids = new Set<string>();
  if (!props.placed || !props.selectedId) return ids;
  for (const edge of props.placed.edges) {
    if (edge.from === props.selectedId) ids.add(edge.to);
    if (edge.to === props.selectedId) ids.add(edge.from);
  }
  return ids;
});

const visibleEdges = computed(() =>
  (props.placed?.edges ?? []).filter((edge) => {
    const touchesSelection =
      edge.from === props.selectedId || edge.to === props.selectedId;
    if (!props.edgesOnSelection) return true;
    return touchesSelection || (props.showChanges && edge.highlight);
  })
);

const pathOf = (points: Point[], curved: boolean): string => {
  const [first, ...rest] = points;
  if (!first) return '';
  const last = rest[rest.length - 1];
  if (curved && last && rest.length === 1) {
    const midX = (first.x + last.x) / 2;
    return `M${first.x},${first.y} C${midX},${first.y} ${midX},${last.y} ${last.x},${last.y}`;
  }
  return `M${first.x},${first.y} ${rest.map((point) => `L${point.x},${point.y}`).join(' ')}`;
};

const edgeClass = (from: string, to: string, highlight: boolean) => {
  if (props.showChanges && highlight) return 'stroke-orange-500';
  if (from === props.selectedId) return 'stroke-blue-600';
  if (to === props.selectedId) return 'stroke-fuchsia-600';
  return 'stroke-slate-300';
};

const nodeOpacity = (id: string) =>
  props.selectedId &&
  props.edgesOnSelection &&
  id !== props.selectedId &&
  !connected.value.has(id)
    ? 'opacity-60'
    : '';

const onNodeClick = (node: MapNode) => {
  if (!wasDrag()) emit('select', node);
};

const onBackgroundClick = () => {
  if (!wasDrag()) emit('clear');
};

const refit = () => {
  if (props.placed) fit(props.placed.width, props.placed.height);
};

// A new layout opens on the selected card when there is one, so a big part
// doesn't open as an unreadable thumbnail.
watch(
  () => props.placed,
  async () => {
    await nextTick();
    const selected = props.placed?.nodes.find(
      (node) => node.id === props.selectedId
    );
    if (selected && !props.edgesOnSelection) {
      centerOn(selected);
    } else {
      refit();
    }
  }
);

const zoom = (factor: number) => {
  const rect = container.value?.getBoundingClientRect();
  if (rect)
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
};
</script>

<template>
  <div
    ref="container"
    class="relative h-full w-full touch-none overflow-hidden bg-slate-50 select-none"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
  >
    <svg class="h-full w-full" @click.self="onBackgroundClick">
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" class="fill-slate-400" />
        </marker>
      </defs>
      <g
        :transform="`translate(${transform.x},${transform.y}) scale(${transform.scale})`"
      >
        <g v-for="group in placed?.groups ?? []" :key="group.id">
          <rect
            :x="group.x"
            :y="group.y"
            :width="group.width"
            :height="group.height"
            rx="12"
            class="fill-white stroke-slate-200"
            @click="onBackgroundClick"
          />
          <text
            :x="group.x + 16"
            :y="group.y + 26"
            class="fill-slate-500 text-sm font-medium"
          >
            {{ group.label }}
          </text>
        </g>
        <path
          v-for="edge in visibleEdges"
          :key="edge.id"
          :d="pathOf(edge.points, edgesOnSelection)"
          fill="none"
          :class="edgeClass(edge.from, edge.to, edge.highlight)"
          :stroke-width="
            edge.from === selectedId || edge.to === selectedId ? 2 : 1.2
          "
          :stroke-dasharray="edge.dashed ? '6 4' : undefined"
          marker-end="url(#arrow)"
        />
      </g>
    </svg>
    <!--
      Cards are HTML in their own layer, moved with a CSS transform that matches
      the SVG one. In WebKit (iPhone Safari) HTML inside <foreignObject> ignores
      the ancestor SVG transform, so cards stayed put while edges panned.
    -->
    <div
      class="pointer-events-none absolute top-0 left-0 origin-top-left"
      :style="{
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
      }"
    >
      <button
        v-for="node in placed?.nodes ?? []"
        :key="node.id"
        type="button"
        :data-test-id="`map-node-${node.id}`"
        class="pointer-events-auto absolute flex cursor-pointer flex-col justify-center overflow-hidden rounded-lg border px-2.5 text-left shadow-xs"
        :class="[
          showChanges && node.change
            ? 'border-2 border-orange-500 bg-orange-50'
            : TONES[node.tone],
          node.id === selectedId ? 'ring-3 ring-blue-600 ring-inset' : '',
          nodeOpacity(node.id),
        ]"
        :style="{
          left: `${node.x}px`,
          top: `${node.y}px`,
          width: `${node.width}px`,
          height: `${node.height}px`,
        }"
        @click.stop="onNodeClick(node)"
        @dblclick.stop="emit('open', node)"
      >
        <span
          class="line-clamp-2 text-[13px] leading-tight font-medium text-slate-900"
        >
          {{ node.label }}
        </span>
        <span class="truncate text-[11px] text-slate-500">{{
          node.sublabel
        }}</span>
        <span
          v-if="showChanges && node.change"
          class="absolute top-0.5 right-1 rounded bg-orange-500 px-1 text-[10px] text-white"
        >
          {{ CHANGE_LABEL[node.change] }}
        </span>
        <span
          v-if="node.badge"
          class="absolute right-1 bottom-0.5 rounded bg-slate-700 px-1 text-[10px] text-white"
        >
          {{ node.badge }}
        </span>
      </button>
    </div>
    <div class="absolute right-3 bottom-3 flex flex-col gap-1">
      <button
        v-for="control in [
          { label: '+', action: () => zoom(1.25), id: 'zoom-in' },
          { label: '−', action: () => zoom(0.8), id: 'zoom-out' },
          { label: 'Fit', action: refit, id: 'zoom-fit' },
        ]"
        :key="control.id"
        type="button"
        :data-test-id="`map-${control.id}`"
        class="h-9 min-w-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 shadow-sm"
        @click="control.action"
      >
        {{ control.label }}
      </button>
    </div>
  </div>
</template>
