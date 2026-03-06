// ============================================
// Force Simulation — 3D force-directed layout
// Supports proximity mode for similarity-driven placement
// ============================================

import type { GraphNode, GraphEdge } from './types';

export interface Simulation {
  tick: () => void;
  isSettled: () => boolean;
  nodes: GraphNode[];
}

export interface SimulationOptions {
  proximityMode?: boolean;
}

// Force configs — proximity mode tightens springs and weakens repulsion
// so cosine similarity becomes the dominant positioning force
const FORCE_CONFIG = {
  default:   { repel: 6000, spring: 0.08, center: 0.01, restBase: 200, restScale: 120 },
  proximity: { repel: 2500, spring: 0.15, center: 0.015, restBase: 120, restScale: 100 },
} as const;

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

/** Default placement: category-sector arcs on XY plane */
function placeNodesBySector(nodes: GraphNode[], width: number, height: number): void {
  const cx = width / 2;
  const cy = height / 2;
  const cz = 0;

  const categoryCount: Record<string, number> = {};
  const categoryIndex: Record<string, number> = {};
  for (const node of nodes) {
    const cat = node.cluster.dominantCategory ?? 'uncategorized';
    categoryCount[cat] = (categoryCount[cat] ?? 0) + 1;
  }

  const radius = Math.min(width, height) * 0.35;
  const zSpread = radius * 0.5;

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

/** Proximity placement: golden-angle spiral on a sphere — even distribution */
function placeNodesOnSphere(nodes: GraphNode[], width: number, height: number): void {
  const cx = width / 2;
  const cy = height / 2;
  const cz = 0;
  const radius = Math.min(width, height) * 0.3;
  const n = nodes.length;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.399963 radians

  for (let i = 0; i < n; i++) {
    // Fibonacci sphere: even distribution on a sphere surface
    const yNorm = 1 - (2 * i + 1) / n; // -1 to 1
    const ringRadius = Math.sqrt(1 - yNorm * yNorm);
    const theta = goldenAngle * i;

    nodes[i].x = cx + Math.cos(theta) * ringRadius * radius;
    nodes[i].y = cy + yNorm * radius;
    nodes[i].z = cz + Math.sin(theta) * ringRadius * radius;
    nodes[i].vx = 0;
    nodes[i].vy = 0;
    nodes[i].vz = 0;
  }
}

export function createSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  options?: SimulationOptions
): Simulation {
  const proximity = options?.proximityMode ?? false;
  const cfg = proximity ? FORCE_CONFIG.proximity : FORCE_CONFIG.default;

  // Place nodes in initial 3D positions
  if (proximity) {
    placeNodesOnSphere(nodes, width, height);
  } else {
    placeNodesBySector(nodes, width, height);
  }

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
        const force = cfg.repel / (dist * dist);
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
        const targetLen = cfg.restBase - weight * cfg.restScale;
        const displacement = dist - targetLen;
        const force = cfg.spring * displacement;
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
      fx[i] += (cx - nodes[i].x) * cfg.center;
      fy[i] += (cy - nodes[i].y) * cfg.center;
      fz[i] += (cz - nodes[i].z) * cfg.center;
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
