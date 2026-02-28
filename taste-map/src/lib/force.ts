// ============================================
// Force Simulation — vanilla force-directed layout
// Will be implemented by graph-engine agent
// ============================================

import type { GraphNode, GraphEdge } from './types';

export interface Simulation {
  tick: () => void;
  isSettled: () => boolean;
  nodes: GraphNode[];
}

export function createSimulation(
  _nodes: GraphNode[],
  _edges: GraphEdge[],
  _width: number,
  _height: number
): Simulation {
  return {
    tick: () => {},
    isSettled: () => true,
    nodes: [],
  }; // TODO: implement
}
