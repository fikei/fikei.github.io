// Stub — will be implemented by graph-engine agent
import type { Cluster, GraphEdge, Pin } from '../lib/types';

interface GraphProps {
  clusters: Cluster[];
  edges: GraphEdge[];
  pins: Pin[];
  onSelectCluster: (id: string | null) => void;
  selectedCluster: string | null;
  highlightedMotif: string | null;
}

export function Graph({ clusters }: GraphProps) {
  return (
    <svg>
      <text x="50%" y="50%" textAnchor="middle" fill="#666" fontSize="11">
        {clusters.length} clusters — graph rendering coming soon
      </text>
    </svg>
  );
}
