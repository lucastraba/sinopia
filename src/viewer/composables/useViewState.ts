import { reactive, watch } from 'vue';
import type { SelectionKind } from '../graphs';
import type { Mode } from '../mapIndex';

export interface ViewState {
  view: 'map' | 'screens';
  part: string | null;
  screen: string | null;
  depth: number;
  mode: Mode;
  changes: boolean;
  selection: { kind: SelectionKind; id: string } | null;
}

const SELECTION_KINDS: SelectionKind[] = [
  'part',
  'file',
  'operation',
  'subgraph',
];

const read = (): ViewState => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const [kind, ...rest] = (params.get('sel') ?? '').split(':');
  const selectionKind = SELECTION_KINDS.find((candidate) => candidate === kind);
  return {
    view: params.get('view') === 'screens' ? 'screens' : 'map',
    part: params.get('part'),
    screen: params.get('screen'),
    depth: Number(params.get('depth') ?? 3) || 3,
    mode: params.get('mode') === 'dev' ? 'dev' : 'plain',
    changes: params.get('changes') !== '0',
    selection:
      selectionKind && rest.length > 0
        ? { kind: selectionKind, id: rest.join(':') }
        : null,
  };
};

const write = (state: ViewState) => {
  const params = new URLSearchParams();
  params.set('view', state.view);
  if (state.part) params.set('part', state.part);
  if (state.screen) params.set('screen', state.screen);
  if (state.depth !== 3) params.set('depth', String(state.depth));
  params.set('mode', state.mode);
  if (!state.changes) params.set('changes', '0');
  if (state.selection)
    params.set('sel', `${state.selection.kind}:${state.selection.id}`);
  const hash = `#${params.toString()}`;
  if (hash !== window.location.hash) window.history.pushState(null, '', hash);
};

/** What the map shows, kept in the URL hash so the back button and shared links work. */
export const useViewState = () => {
  const state = reactive<ViewState>(read());
  watch(state, write, { deep: true });
  window.addEventListener('popstate', () => Object.assign(state, read()));
  return state;
};
