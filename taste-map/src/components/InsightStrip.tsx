// InsightStrip — bottom insight bar with motifs and bridge info
import type { Insights } from '../lib/types';

interface InsightStripProps {
  insights: Insights;
  highlightedMotif: string | null;
  onHighlightMotif: (motif: string | null) => void;
}

export function InsightStrip({ insights, highlightedMotif, onHighlightMotif }: InsightStripProps) {
  const bridge = insights.bridges[0];

  return (
    <div className="tg-insight-strip">
      {insights.motifs.length > 0 && (
        <div className="tg-insight-strip__motifs">
          <span className="tg-insight-strip__label">MOTIFS</span>
          {insights.motifs.map(motif => (
            <button
              key={motif}
              className={`tg-motif ${highlightedMotif === motif ? 'tg-motif--active' : ''}`}
              onClick={() => onHighlightMotif(highlightedMotif === motif ? null : motif)}
            >
              {motif}
            </button>
          ))}
        </div>
      )}

      {bridge && (
        <span className="tg-bridge-label">
          BRIDGE: {bridge.clusterA} ↔ {bridge.clusterB}
        </span>
      )}
    </div>
  );
}
