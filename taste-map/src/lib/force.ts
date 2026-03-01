// ============================================
// Force Simulation — 3D force-directed layout
// ============================================

import type { GraphNode, GraphEdge } from './types';

export interface Simulation {
  tick: () => void;
  isSettled: () => boolean;
  nodes: GraphNode[];
}

const K_REPEL = 6000;
const K_SPRING = 0.08;
const K_CENTER = 0.01;
const DAMPING = 0.85;
const MIN_DISTANCE = 1;
const SETTLED_THRESHOLD = 0.5;

// Category → angular sector mapping (on XY plane)
const CATEGORY_ANGLE_MAP: Record<string, [number, number]> = {
  listen: [-Math.PI, -Math.PI * 0.75],
  watch:  [-Math.PI * 0.75, -Math.PI / 2],
  read:   [-Math.PI / 2, -Math.PI / 4],
  follow: [-Math.PI / 4, 0],
  wear:   [0, Math.PI / 4],
  home:   [Math.PI / 4, Math.PI / 2],
  eat:    [Math.PI / 2, Math.PI * 0.75],
  go:     [Math.PI * 0.75, Math.PI],
};

function initialAngle(category: string, index: number, total: number): number {
  const sector = CATEGORY_ANGLE_MAP[category];
  if (sector) {
    const [min, max] = sector;
    const t = total > 1 ? index / (total - 1) : 0.5;
    return min + t * (max - min);
  }
  // use/uncategorized — scatter with golden angle
  return index * 2.399963;
}

function placeNodes(nodes: GraphNode[], width: number, height: number): void {
  const cx = width / 2;
  const cy = height / 2;
  const cz = 0;

  // Count how many nodes per category for arc distribution
  const categoryCount: Record<string, number> = {};
  const categoryIndex: Record<string, number> = {};
  for (const node of nodes) {
    const cat = node.cluster.dominantCategory ?? 'uncategorized';
    categoryCount[cat] = (categoryCount[cat] ?? 0) + 1;
  }

  const radius = Math.min(width, height) * 0.35;
  const zSpread = radius * 0.5; // flatter spread on z

  for (const node of nodes) {
    const cat = node.cluster.dominantCategory ?? 'uncategorized';
    const idx = categoryIndex[cat] ?? 0;
    categoryIndex[cat] = idx + 1;
    const total = categoryCount[cat];

    const angle = initialAngle(cat, idx, total);
    const r = radius + (Math.random() - 0.5) * 60;
    node.x = cx + Math.cos(angle) * r + (Math.random() - 0.5) * 30;
    node.y = cy + Math.sin(angle) * r + (Math.random() - 0.5) * 30;
    node.z = cz + (Math.random() - 0.5) * zSpread;
    node.vx = 0;
    node.vy = 0;
    node.vz = 0;
  }
}

export function createSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number
): Simulation {
  // Place nodes in initial 3D positions
  placeNodes(nodes, width, height);

  const cx = width / 2;
  const cy = height / 2;
  const cz = 0;

  // Build edge lookup by node id for O(E) spring pass
  const edgeMap = new Map<string, { targetId: string; weight: number }[]>();
  for (const edge of edges) {
    if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, []);
    if (!edgeMap.has(edge.target)) edgeMap.set(edge.target, []);
    edgeMap.get(edge.source)!.push({ targetId: edge.target, weight: edge.weight });
    edgeMap.get(edge.target)!.push({ targetId: edge.source, weight: edge.weight });
  }

  // Node id → index for fast lookup
  const nodeIndex = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    nodeIndex.set(nodes[i].id, i);
  }

  function tick(): void {
    const n = nodes.length;

    // Accumulate forces
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);
    const fz = new Float64Array(n);

    // 1. Repulsion — O(N^2) coulomb in 3D
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dz = nodes[j].z - nodes[i].z;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), MIN_DISTANCE);
        const force = K_REPEL / (dist * dist);
        const nx = (dx / dist) * force;
        const ny = (dy / dist) * force;
        const nz = (dz / dist) * force;
        fx[i] -= nx;
        fy[i] -= ny;
        fz[i] -= nz;
        fx[j] += nx;
        fy[j] += ny;
        fz[j] += nz;
      }
    }

    // 2. Spring attraction along edges — Hooke's law in 3D
    for (let i = 0; i < n; i++) {
      const links = edgeMap.get(nodes[i].id);
      if (!links) continue;
      for (const { targetId, weight } of links) {
        const j = nodeIndex.get(targetId);
        if (j === undefined || j <= i) continue; // process each edge once
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dz = nodes[j].z - nodes[i].z;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), MIN_DISTANCE);
        const targetLen = 200 - weight * 120;
        const displacement = dist - targetLen;
        const force = K_SPRING * displacement;
        const nx = (dx / dist) * force;
        const ny = (dy / dist) * force;
        const nz = (dz / dist) * force;
        fx[i] += nx;
        fy[i] += ny;
        fz[i] += nz;
        fx[j] -= nx;
        fy[j] -= ny;
        fz[j] -= nz;
      }
    }

    // 3. Centering force
    for (let i = 0; i < n; i++) {
      fx[i] += (cx - nodes[i].x) * K_CENTER;
      fy[i] += (cy - nodes[i].y) * K_CENTER;
      fz[i] += (cz - nodes[i].z) * K_CENTER;
    }

    // 4. Integrate with damping
    for (let i = 0; i < n; i++) {
      nodes[i].vx = (nodes[i].vx + fx[i]) * DAMPING;
      nodes[i].vy = (nodes[i].vy + fy[i]) * DAMPING;
      nodes[i].vz = (nodes[i].vz + fz[i]) * DAMPING;
      nodes[i].x += nodes[i].vx;
      nodes[i].y += nodes[i].vy;
      nodes[i].z += nodes[i].vz;
    }
  }

  function isSettled(): boolean {
    for (const node of nodes) {
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy + node.vz * node.vz);
      if (speed > SETTLED_THRESHOLD) return false;
    }
    return true;
  }

  return { tick, isSettled, nodes };
}
