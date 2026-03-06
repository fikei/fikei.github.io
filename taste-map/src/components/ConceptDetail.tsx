// ConceptDetail — right-side panel with story-length descriptions + pin links
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
  drillDepth,
  onClose,
  onDrillIn,
}: ConceptDetailProps) {
  const pct = ((cluster.pinCount / totalPins) * 100).toFixed(0);
  const depthMarker = Array.from({ length: drillDepth + 1 }, () => '//').join('');

  // Get actual pin objects for this cluster, sorted by title
  const clusterPins = pins
    .filter(p => cluster.pinIds.includes(p.id))
    .sort((a, b) => a.title.localeCompare(b.title))
    .slice(0, 10);

  return (
    <div className="tg-detail tg-detail--visible">
      <div className="tg-detail__depth">{depthMarker}</div>
      <div className="tg-detail__label">{cluster.label.toUpperCase()}</div>

      {/* Three-part description (story-length) */}
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

      {/* Pins */}
      {clusterPins.length > 0 && (
        <>
          <div className="tg-detail__section-header">{'\u2500\u2500'} PINS</div>
          {clusterPins.map(pin => (
            <a
              key={pin.id}
              href={pin.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tg-detail__pin"
            >
              <span className="tg-detail__pin-title">{pin.title}</span>
              <span className="tg-detail__pin-domain">{pin.domain}</span>
            </a>
          ))}
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
