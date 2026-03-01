// ConceptDetail — right-side panel with three-part Co-Star descriptions
import type { Cluster, Pin } from '../lib/types';

interface ConceptDetailProps {
  cluster: Cluster;
  pins: Pin[];
  totalPins: number;
  relatedClusters: Cluster[];
  drillDepth: number;
  onClose: () => void;
  onSelectCluster: (id: string | null) => void;
  onDrillIn: (clusterId: string) => void;
}

export function ConceptDetail({
  cluster,
  pins,
  totalPins,
  relatedClusters,
  drillDepth,
  onClose,
  onSelectCluster,
  onDrillIn,
}: ConceptDetailProps) {
  const pct = ((cluster.pinCount / totalPins) * 100).toFixed(0);
  const depthMarker = Array.from({ length: drillDepth + 1 }, () => '//').join('');

  // Sample titles from cluster pins
  const clusterPins = pins.filter(p => cluster.pinIds.includes(p.id));
  const sampleTitles = cluster.sampleTitles.length > 0
    ? cluster.sampleTitles
    : clusterPins.slice(0, 5).map(p => p.title);

  return (
    <div className="tg-detail tg-detail--visible">
      <div className="tg-detail__depth">{depthMarker}</div>
      <div className="tg-detail__label">{cluster.label.toUpperCase()}</div>

      {/* Three-part Co-Star description */}
      {cluster.description && (
        <>
          <div className="tg-detail__section-header">{'\u2500\u2500'} WHAT IT IS</div>
          <div className="tg-detail__description">{cluster.description.whatItIs}</div>

          <div className="tg-detail__section-header">{'\u2500\u2500'} WHY YOU</div>
          <div className="tg-detail__description">{cluster.description.whyYou}</div>

          <div className="tg-detail__section-header">{'\u2500\u2500'} HOW IT CHANGED</div>
          <div className="tg-detail__description">{cluster.description.howItChanged}</div>
        </>
      )}

      <div className="tg-detail__stat">
        {cluster.pinCount} ITEMS &middot; {pct}% OF SAVES
      </div>

      {/* Tokens */}
      {cluster.topTokens.length > 0 && (
        <>
          <div className="tg-detail__section-header">{'\u2500\u2500'} TOKENS</div>
          <div className="tg-detail__chips">
            {cluster.topTokens.slice(0, 8).map(token => (
              <span key={token} className="tg-chip tg-chip--token">{token}</span>
            ))}
          </div>
        </>
      )}

      {/* Sample saves */}
      {sampleTitles.length > 0 && (
        <>
          <div className="tg-detail__section-header">{'\u2500\u2500'} SAMPLE SAVES</div>
          {sampleTitles.slice(0, 5).map((title, i) => (
            <div key={i} className="tg-detail__sample">{title}</div>
          ))}
        </>
      )}

      {/* Connected clusters */}
      {relatedClusters.length > 0 && (
        <>
          <div className="tg-detail__section-header">{'\u2500\u2500'} CONNECTED</div>
          <div className="tg-detail__chips">
            {relatedClusters.map(rc => (
              <button
                key={rc.id}
                className="tg-chip tg-chip--related"
                onClick={() => onSelectCluster(rc.id)}
              >
                {rc.label.toUpperCase()}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Drill in button */}
      {cluster.drillable && (
        <button
          className="tg-btn tg-btn--drill"
          onClick={() => onDrillIn(cluster.id)}
        >
          {'\u21B3'} DRILL IN [{cluster.pinCount} ITEMS]
        </button>
      )}

      <button className="tg-detail__close" onClick={onClose}>&times;</button>
    </div>
  );
}
