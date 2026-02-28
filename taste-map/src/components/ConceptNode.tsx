// ConceptNode — individual concept circle in the taste graph
import type { GraphNode } from '../lib/types';

interface ConceptNodeProps {
  node: GraphNode;
  isExpanded: boolean;
  isDimmed: boolean;
  isHighlighted: boolean;
  onClick: () => void;
}

function truncateLabel(label: string, radius: number): string {
  const maxChars = Math.floor(radius / 4);
  if (label.length <= maxChars) return label;
  return label.slice(0, maxChars) + '…';
}

export function ConceptNode({ node, isExpanded, isDimmed, isHighlighted, onClick }: ConceptNodeProps) {
  const label = truncateLabel(node.cluster.label.toUpperCase(), node.radius);
  const pinCountLabel = String(node.cluster.pinCount);

  const classNames = [
    'tg-node',
    isExpanded ? 'tg-node--expanded' : '',
    isDimmed ? 'tg-node--dimmed' : '',
    isHighlighted ? 'tg-node--highlighted' : '',
  ].filter(Boolean).join(' ');

  return (
    <g
      className={classNames}
      onClick={onClick}
      style={{ cursor: 'pointer' }}
    >
      <circle
        cx={node.x}
        cy={node.y}
        r={node.radius}
        fill={isExpanded ? 'var(--fg)' : 'none'}
        stroke="var(--fg)"
        strokeWidth={2}
      />
      <text
        x={node.x}
        y={node.y - node.radius * 0.1}
        className="tg-label"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={Math.max(7, Math.min(10, node.radius * 0.28))}
        fill={isExpanded ? 'var(--bg)' : 'var(--fg)'}
        letterSpacing="0.08em"
        style={{ fontFamily: 'var(--font-mono)', pointerEvents: 'none', userSelect: 'none' }}
      >
        {label}
      </text>
      <text
        x={node.x}
        y={node.y + node.radius * 0.35}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={7}
        fill={isExpanded ? 'var(--bg)' : 'var(--fg)'}
        opacity={0.6}
        style={{ fontFamily: 'var(--font-mono)', pointerEvents: 'none', userSelect: 'none' }}
      >
        {pinCountLabel}
      </text>
    </g>
  );
}
