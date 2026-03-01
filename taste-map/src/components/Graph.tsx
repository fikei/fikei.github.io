// Graph — 3D force-directed graph with R3F Canvas
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Cluster, GraphEdge, GraphNode, Pin, Insights } from '../lib/types';
import { createSimulation } from '../lib/force';
import { Node3D } from './Node3D';

interface GraphProps {
  clusters: Cluster[];
  edges: GraphEdge[];
  pins: Pin[];
  insights: Insights;
  onSelectCluster: (id: string | null) => void;
  selectedCluster: string | null;
  highlightedMotif: string | null;
  onDrillIn: (clusterId: string) => void;
  onSelectEdge: (edge: GraphEdge | null, screenPos: { x: number; y: number } | null) => void;
}

function clustersToNodes(clusters: Cluster[]): GraphNode[] {
  return clusters.map(cluster => ({
    id: cluster.id,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: Math.max(18, Math.min(60, Math.sqrt(cluster.pinCount) * 4)),
    cluster,
  }));
}

function isMotifMatch(cluster: Cluster, motif: string): boolean {
  const lower = motif.toLowerCase();
  if (cluster.label.toLowerCase().includes(lower)) return true;
  return cluster.topTokens.some(t => t.toLowerCase().includes(lower));
}

// Inner scene component — has access to R3F context
function GraphScene({
  clusters,
  edges,
  insights: _insights,
  onSelectCluster,
  selectedCluster,
  highlightedMotif,
  onDrillIn,
  onSelectEdge,
}: Omit<GraphProps, 'pins'>) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const simRef = useRef<ReturnType<typeof createSimulation> | null>(null);
  const { camera, gl } = useThree();

  // Run force simulation
  useEffect(() => {
    if (clusters.length === 0) return;

    const width = 800;
    const height = 600;
    const graphNodes = clustersToNodes(clusters);
    const sim = createSimulation(graphNodes, edges, width, height);
    simRef.current = sim;

    // Center the sim around origin for Three.js (shift by -cx, -cy)
    const cx = width / 2;
    const cy = height / 2;

    let frame = 0;
    const maxFrames = 200;
    let raf: number;

    function step() {
      sim.tick();
      frame++;

      // Shift to origin-centered coordinates for 3D
      const centered = sim.nodes.map(n => ({
        ...n,
        x: n.x - cx,
        y: -(n.y - cy), // flip Y for Three.js (Y-up)
      }));

      setNodes(centered);

      if (!sim.isSettled() && frame < maxFrames) {
        raf = requestAnimationFrame(step);
      }
    }

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [clusters, edges]);

  // Build node lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  // Edge click handler: project midpoint to screen
  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) return;

    const mid = new THREE.Vector3(
      (source.x + target.x) / 2,
      (source.y + target.y) / 2,
      (source.z + target.z) / 2
    );
    mid.project(camera);

    const rect = gl.domElement.getBoundingClientRect();
    const screenX = ((mid.x + 1) / 2) * rect.width + rect.left;
    const screenY = ((-mid.y + 1) / 2) * rect.height + rect.top;

    onSelectEdge(edge, { x: screenX, y: screenY });
  }, [nodeMap, camera, gl, onSelectEdge]);

  return (
    <>
      <color attach="background" args={['#000000']} />
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        rotateSpeed={0.5}
        panSpeed={0.8}
        zoomSpeed={0.8}
        minDistance={100}
        maxDistance={1200}
      />

      {/* Edges */}
      {edges.map(edge => {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) return null;

        const points: [number, number, number][] = [
          [source.x, source.y, source.z],
          [target.x, target.y, target.z],
        ];

        const opacity = 0.08 + edge.weight * 0.3;

        return (
          <group key={`${edge.source}-${edge.target}`}>
            {/* Visible edge */}
            <Line
              points={points}
              color="white"
              lineWidth={1}
              opacity={opacity}
              transparent
            />
            {/* Invisible hit target */}
            <Line
              points={points}
              color="white"
              lineWidth={12}
              opacity={0}
              transparent
              onClick={() => handleEdgeClick(edge)}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = '';
              }}
            />
          </group>
        );
      })}

      {/* Nodes */}
      {nodes.map(node => {
        const isSelected = selectedCluster === node.id;
        const isDimmed = highlightedMotif != null && !isMotifMatch(node.cluster, highlightedMotif);
        const isHighlighted = highlightedMotif != null && isMotifMatch(node.cluster, highlightedMotif);

        return (
          <Node3D
            key={node.id}
            node={node}
            isSelected={isSelected}
            isDimmed={isDimmed}
            isHighlighted={isHighlighted}
            onClick={() => onSelectCluster(isSelected ? null : node.id)}
            onDoubleClick={() => {
              if (node.cluster.drillable) {
                onDrillIn(node.id);
              }
            }}
          />
        );
      })}
    </>
  );
}

export function Graph(props: GraphProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 500], fov: 50, near: 1, far: 5000 }}
      style={{ width: '100%', height: '100%' }}
      onPointerMissed={() => {
        props.onSelectCluster(null);
        props.onSelectEdge(null, null);
      }}
    >
      <GraphScene
        clusters={props.clusters}
        edges={props.edges}
        insights={props.insights}
        onSelectCluster={props.onSelectCluster}
        selectedCluster={props.selectedCluster}
        highlightedMotif={props.highlightedMotif}
        onDrillIn={props.onDrillIn}
        onSelectEdge={props.onSelectEdge}
      />
    </Canvas>
  );
}
