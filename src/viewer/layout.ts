import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { MapEdge, MapModel, MapNode } from './graphs';

export interface Point {
  x: number;
  y: number;
}

export interface PlacedNode extends MapNode {
  x: number;
  y: number;
}

export interface PlacedEdge extends MapEdge {
  points: Point[];
}

export interface PlacedGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placed {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  groups: PlacedGroup[];
  width: number;
  height: number;
}

const elk = new ELK();

const LAYERED = {
  'elk.algorithm': 'layered',
  'elk.edgeRouting': 'POLYLINE',
  'elk.layered.spacing.nodeNodeBetweenLayers': '70',
  'elk.spacing.nodeNode': '24',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
};

const center = (node: PlacedNode): Point => ({
  x: node.x + node.width / 2,
  y: node.y + node.height / 2,
});

/** Edges the overview draws itself, from card centre to card centre, since ELK packs the groups without them. */
export const straightPoints = (from: PlacedNode, to: PlacedNode): Point[] => [
  center(from),
  center(to),
];

export const layoutModel = async (
  model: MapModel,
  vertical: boolean
): Promise<Placed> => {
  const direction = vertical ? 'DOWN' : 'RIGHT';
  if (model.layout === 'grouped') {
    const root: ElkNode = {
      id: 'root',
      // Groups stack top to bottom; each packs its cards in rows that fit the screen.
      layoutOptions: {
        ...LAYERED,
        'elk.direction': 'DOWN',
        'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      },
      children: model.groups
        .map((group) => ({
          id: group.id,
          layoutOptions: {
            'elk.algorithm': 'rectpacking',
            'elk.aspectRatio': vertical ? '0.9' : '3.2',
            'elk.padding': '[top=40,left=16,bottom=16,right=16]',
            'elk.spacing.nodeNode': '14',
          },
          children: model.nodes
            .filter((node) => node.group === group.id)
            .map((node) => ({
              id: node.id,
              width: node.width,
              height: node.height,
            })),
        }))
        .filter((group) => group.children.length > 0),
      edges: (model.groupFlow ?? []).map(([from, to], position) => ({
        id: `flow${position}`,
        sources: [from],
        targets: [to],
      })),
    };
    root.edges = root.edges?.filter(
      (edge) =>
        root.children?.some((group) => group.id === edge.sources[0]) &&
        root.children.some((group) => group.id === edge.targets[0])
    );
    const result = await elk.layout(root);
    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    const nodes: PlacedNode[] = [];
    const groups: PlacedGroup[] = [];
    for (const group of result.children ?? []) {
      groups.push({
        id: group.id,
        label:
          model.groups.find((candidate) => candidate.id === group.id)?.label ??
          group.id,
        x: group.x ?? 0,
        y: group.y ?? 0,
        width: group.width ?? 0,
        height: group.height ?? 0,
      });
      for (const child of group.children ?? []) {
        const node = byId.get(child.id);
        if (node)
          nodes.push({
            ...node,
            x: (group.x ?? 0) + (child.x ?? 0),
            y: (group.y ?? 0) + (child.y ?? 0),
          });
      }
    }
    const placed = new Map(nodes.map((node) => [node.id, node]));
    const edges: PlacedEdge[] = model.edges.flatMap((edge) => {
      const from = placed.get(edge.from);
      const to = placed.get(edge.to);
      return from && to ? [{ ...edge, points: straightPoints(from, to) }] : [];
    });
    return {
      nodes,
      edges,
      groups,
      width: result.width ?? 0,
      height: result.height ?? 0,
    };
  }

  // Without links (plain folders and files) a flow has nothing to follow, so
  // the cards are packed into rows instead of one tall column.
  const input: ElkNode = {
    id: 'root',
    layoutOptions:
      model.edges.length > 0
        ? { ...LAYERED, 'elk.direction': direction }
        : {
            'elk.algorithm': 'rectpacking',
            'elk.aspectRatio': vertical ? '0.7' : '1.8',
            'elk.spacing.nodeNode': '14',
          },
    children: model.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
    })),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };
  const result = await elk.layout(input);
  const positions = new Map(
    (result.children ?? []).map((child) => [child.id, child])
  );
  const nodes = model.nodes.map((node) => ({
    ...node,
    x: positions.get(node.id)?.x ?? 0,
    y: positions.get(node.id)?.y ?? 0,
  }));
  const sections = new Map(
    (result.edges ?? []).map((edge) => [edge.id, edge.sections?.[0]])
  );
  const edges = model.edges.map((edge) => {
    const section = sections.get(edge.id);
    return {
      ...edge,
      points: section
        ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        : [],
    };
  });
  return {
    nodes,
    edges,
    groups: [],
    width: result.width ?? 0,
    height: result.height ?? 0,
  };
};
