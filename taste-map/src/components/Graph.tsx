// Graph — Main SVG force-directed graph with pan/zoom
import { useEffect, useRef, useState, useCallback } from 'react';
import type { Cluster, GraphEdge, GraphNode, Pin } from '../lib/types';
import { createSimulation } from '../lib/force';
import { ConceptNode } from './ConceptNode';

interface GraphProps {
  clusters: Cluster[];
  edges: GraphEdge[];
  pins: Pin[];
  onSelectCluster: (id: string | null) => void;
  selectedCluster: string | null;
  highlightedMotif: string | null;
}

function clustersToNodes(clusters: Cluster[]): GraphNode[] {
  return clusters.map(cluster => ({
    id: cluster.id,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: Math.max(18, Math.min(60, Math.sqrt(cluster.pinCount) * 4)),
    cluster,
  }));
}

function isMotifMatch(cluster: Cluster, motif: string): boolean {
  const lower = motif.toLowerCase();
  if (cluster.label.toLowerCase().includes(lower)) return true;
  return cluster.topTokens.some(t => t.toLowerCase().includes(lower));
}

export function Graph({
  clusters,
  edges,
  pins,
  onSelectCluster,
  selectedCluster,
  highlightedMotif,
}: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [, forceUpdate] = useState(0);

  // Pan state
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const panRef = useRef({ dragging: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });

  // Run force simulation
  useEffect(() => {
    if (clusters.length === 0) return;

    const width = 800;
    const height = 600;
    const graphNodes = clustersToNodes(clusters);
    const sim = createSimulation(graphNodes, edges, width, height);

    let frame = 0;
    const maxFrames = 200;
    let raf: number;

    function step() {
      sim.tick();
      frame++;
      setNodes([...sim.nodes]);
      forceUpdate(f => f + 1);

      if (!sim.isSettled() && frame < maxFrames) {
        raf = requestAnimationFrame(step);
      }
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [clusters, edges]);

  // Compute viewBox
  const width = 800;
  const height = 600;
  const vbX = -viewOffset.x / zoom;
  const vbY = -viewOffset.y / zoom;
  const vbW = width / zoom;
  const vbH = height / zoom;

  // Pan handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: viewOffset.x,
      startOffsetY: viewOffset.y,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }, [viewOffset]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!panRef.current.dragging) return;
    const dx = e.clientX - panRef.current.startX;
    const dy = e.clientY - panRef.current.startY;
    setViewOffset({
      x: panRef.current.startOffsetX + dx,
      y: panRef.current.startOffsetY + dy,
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    panRef.current.dragging = false;
  }, []);

  // Zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.3, Math.min(3, z * delta)));
  }, []);

  // Build a node lookup for edge rendering
  const nodeMap = new Map<string, GraphNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Expanded cluster pins (orbital layout)
  const selectedNode = selectedCluster ? nodeMap.get(selectedCluster) : null;
  const selectedPins = selectedNode
    ? pins.filter(p => selectedNode.cluster.pinIds.includes(p.id)).slice(0, 24)
    : [];

  return (
    <svg
      ref={svgRef}
      className="tg-svg"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      style={{ width: '100%', height: '100%', touchAction: 'none' }}
    >
      {/* Edges */}
      <g className="tg-edges">
        {edges.map(edge => {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);
          if (!source || !target) return null;
          return (
            <line
              key={`${edge.source}-${edge.target}`}
              className="tg-edge"
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke="var(--fg)"
              strokeWidth={1}
              opacity={0.1 + edge.weight * 0.5}
            />
          );
        })}
      </g>

      {/* Nodes */}
      <g className="tg-nodes">
        {nodes.map(node => {
          const isExpanded = selectedCluster === node.id;
          const isDimmed = highlightedMotif != null && !isMotifMatch(node.cluster, highlightedMotif);
          const isHighlighted = highlightedMotif != null && isMotifMatch(node.cluster, highlightedMotif);

          return (
            <ConceptNode
              key={node.id}
              node={node}
              isExpanded={isExpanded}
              isDimmed={isDimmed}
              isHighlighted={isHighlighted}
              onClick={() => onSelectCluster(isExpanded ? null : node.id)}
            />
          );
        })}
      </g>

      {/* Expanded cluster: pin dots in orbital layout */}
      {selectedNode && selectedPins.length > 0 && (
        <g className="tg-pin-orbits">
          {selectedPins.map((pin, i) => {
            const angle = (2 * Math.PI * i) / selectedPins.length;
            const orbitR = selectedNode.radius + 25;
            const px = selectedNode.x + Math.cos(angle) * orbitR;
            const py = selectedNode.y + Math.sin(angle) * orbitR;
            return (
              <g key={pin.id}>
                <circle
                  cx={px}
                  cy={py}
                  r={5}
                  fill="var(--fg)"
                  opacity={0.7}
                  style={{ cursor: 'pointer' }}
                />
                <title>{pin.title}</title>
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
