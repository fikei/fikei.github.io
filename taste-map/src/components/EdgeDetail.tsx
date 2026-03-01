// EdgeDetail — HTML overlay tooltip at screen-projected edge midpoint
import type { GraphEdge, Cluster, Insights } from '../lib/types';

interface EdgeDetailProps {
  edge: GraphEdge;
  screenPos: { x: number; y: number };
  clusters: Cluster[];
  insights: Insights;
  onClose: () => void;
}

export function EdgeDetail({ edge, screenPos, clusters, insights, onClose }: EdgeDetailProps) {
  const sourceCluster = clusters.find(c => c.id === edge.source);
  const targetCluster = clusters.find(c => c.id === edge.target);
  if (!sourceCluster || !targetCluster) return null;

  const similarity = Math.round(edge.weight * 100);

  // Find shared tokens
  const sourceTokens = new Set(sourceCluster.topTokens);
  const shared = targetCluster.topTokens.filter(t => sourceTokens.has(t)).slice(0, 4);

  // Check if this is a bridge
  const bridge = insights.bridges.find(
    b =>
      (b.clusterA === sourceCluster.label && b.clusterB === targetCluster.label) ||
      (b.clusterB === sourceCluster.label && b.clusterA === targetCluster.label)
  );

  return (
    <div
      className="tg-edge-detail"
      style={{
        left: `${screenPos.x}px`,
        top: `${screenPos.y}px`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <button className="tg-edge-detail__close" onClick={onClose}>&times;</button>
      <div className="tg-edge-detail__title">
        {sourceCluster.label.toUpperCase()} &mdash;&mdash; {targetCluster.label.toUpperCase()}
      </div>
      <div className="tg-edge-detail__stat">
        SIMILARITY: {similarity}%
      </div>
      {shared.length > 0 && (
        <div className="tg-edge-detail__stat">
          SHARED: {shared.join(', ').toUpperCase()}
        </div>
      )}
      {bridge && (
        <div className="tg-edge-detail__reason">
          {bridge.reason}
        </div>
      )}
    </div>
  );
}
