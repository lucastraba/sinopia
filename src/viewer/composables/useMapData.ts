import { shallowRef } from 'vue';
import type { Descriptions, Graph, GraphDiff } from '../../model';
import { buildIndex, type MapIndex } from '../mapIndex';

const fetchJson = async <T>(name: string): Promise<T | null> => {
  const response = await fetch(`data/${name}`, { cache: 'no-store' });
  return response.ok ? ((await response.json()) as T) : null;
};

/** Loads the scan, the descriptions and the last `pnpm map diff` from the viewer server. */
export const useMapData = () => {
  const index = shallowRef<MapIndex | null>(null);
  const error = shallowRef<string | null>(null);

  const load = async () => {
    const [graph, descriptions, diff] = await Promise.all([
      fetchJson<Graph>('graph.json'),
      fetchJson<Descriptions>('descriptions.json'),
      fetchJson<GraphDiff>('diff.json'),
    ]);
    if (!graph) {
      error.value = 'No scan yet: run the scan command for this map.';
      return;
    }
    index.value = buildIndex(
      graph,
      descriptions ?? {
        app: null,
        parts: {},
        files: {},
        operations: {},
        runs: [],
      },
      diff
    );
  };

  return { index, error, load };
};
