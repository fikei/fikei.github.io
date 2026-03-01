// ============================================
// Drill Manager — pure functions for drill-down navigation
// ============================================

import type { Pin, Cluster, GraphEdge, DrillFrame } from './types';
import { buildSubClusters, buildEdges } from './clustering';

export function buildRootFrame(
  pins: Pin[],
  clusters: Cluster[],
  edges: GraphEdge[]
): DrillFrame {
  return {
    depth: 0,
    parentClusterId: null,
    parentLabel: 'ROOT',
    pinIds: pins.map(p => p.id),
    clusters,
    edges,
  };
}

export function createDrillFrame(
  depth: number,
  parentClusterId: string,
  parentLabel: string,
  pins: Pin[]
): DrillFrame {
  const subClusters = buildSubClusters(pins, parentClusterId);
  const subEdges = buildEdges(subClusters);

  return {
    depth,
    parentClusterId,
    parentLabel,
    pinIds: pins.map(p => p.id),
    clusters: subClusters,
    edges: subEdges,
  };
}
