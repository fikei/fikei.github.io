// ConceptDetail — expanded concept detail panel
import type { Cluster, Pin } from '../lib/types';

interface ConceptDetailProps {
  cluster: Cluster;
  pins: Pin[];
  totalPins: number;
  relatedClusters: Cluster[];
  onClose: () => void;
  onSelectCluster: (id: string | null) => void;
}

export function ConceptDetail({ cluster, pins, totalPins, relatedClusters, onClose, onSelectCluster }: ConceptDetailProps) {
  const clusterPins = pins.filter(p => cluster.pinIds.includes(p.id)).slice(0, 12);
  const pct = ((cluster.pinCount / totalPins) * 100).toFixed(0);

  return (
    <div className="tg-detail tg-detail--visible">
      <div className="tg-detail__header">
        <input
          className="tg-detail__label"
          defaultValue={cluster.label}
        />
        <span className="tg-detail__stat">{pct}% of saves</span>
        <button className="tg-btn tg-btn--close" onClick={onClose}>&times;</button>
      </div>

      <div className="tg-detail__pins">
        {clusterPins.map(pin => (
          pin.image ? (
            <img key={pin.id} className="tg-detail__pin-thumb" src={pin.image} alt={pin.title} />
          ) : (
            <div key={pin.id} className="tg-detail__pin-placeholder">
              {pin.domain}
            </div>
          )
        ))}
      </div>

      {relatedClusters.length > 0 && (
        <>
          <div className="tg-detail__section-header">RELATED</div>
          <div className="tg-detail__related">
            {relatedClusters.map(rc => (
              <button
                key={rc.id}
                className="tg-detail__related-tag"
                onClick={() => onSelectCluster(rc.id)}
              >
                {rc.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="tg-detail__actions">
        <button className="tg-btn tg-btn--action">Merge</button>
        <button className="tg-btn tg-btn--action">Split</button>
        <button className="tg-btn tg-btn--action">Mute</button>
      </div>
    </div>
  );
}
