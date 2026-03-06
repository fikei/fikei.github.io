// Node3D — 3D chip label rendered via drei <Html> billboard
import { Html } from '@react-three/drei';
import type { GraphNode } from '../lib/types';

interface Node3DProps {
  node: GraphNode;
  isSelected: boolean;
  isDimmed: boolean;
  isHighlighted: boolean;
  isYoutubeOnly: boolean;
  hasMixedSources: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

export function Node3D({
  node,
  isSelected,
  isDimmed,
  isHighlighted,
  isYoutubeOnly,
  hasMixedSources,
  onClick,
  onDoubleClick,
}: Node3DProps) {
  const cls = [
    'tg-3d-label',
    isSelected && 'tg-3d-label--selected',
    isDimmed && 'tg-3d-label--dimmed',
    isHighlighted && 'tg-3d-label--highlighted',
    isYoutubeOnly && 'tg-3d-label--youtube-only',
    hasMixedSources && 'tg-3d-label--mixed-sources',
  ].filter(Boolean).join(' ');

  const drillIndicator = node.cluster.drillable ? ' \u21B3' : '';
  const sourceIndicator = isYoutubeOnly ? ' [YT]' : hasMixedSources ? ' [+YT]' : '';

  return (
    <group position={[node.x, node.y, node.z]}>
      <Html
        center
        distanceFactor={300}
        style={{ pointerEvents: 'auto' }}
        zIndexRange={[10, 0]}
      >
        <div
          className={cls}
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
        >
          <span className="tg-3d-label__name">
            {node.cluster.label.toUpperCase()}
          </span>
          <span className="tg-3d-label__count">
            {'\u2500\u2500 '}{node.cluster.pinCount} ITEMS{drillIndicator}{sourceIndicator}
          </span>
        </div>
      </Html>
    </group>
  );
}
