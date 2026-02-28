// Stub — will be implemented by graph-engine agent
import type { GraphNode } from '../lib/types';

interface ConceptNodeProps {
  node: GraphNode;
  isExpanded: boolean;
  isDimmed: boolean;
  isHighlighted: boolean;
  onClick: () => void;
}

export function ConceptNode({ node, onClick }: ConceptNodeProps) {
  return (
    <g onClick={onClick} className="tg-node">
      <circle
        cx={node.x}
        cy={node.y}
        r={node.radius}
        fill="none"
        stroke="#fff"
        strokeWidth={2}
      />
      <text
        x={node.x}
        y={node.y}
        className="tg-label"
      >
        {node.cluster.label}
      </text>
    </g>
  );
}
