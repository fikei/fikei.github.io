// Stub — will be implemented by graph-engine agent
import type { Insights } from '../lib/types';

interface InsightStripProps {
  insights: Insights;
  highlightedMotif: string | null;
  onHighlightMotif: (motif: string | null) => void;
}

export function InsightStrip({ insights, highlightedMotif, onHighlightMotif }: InsightStripProps) {
  return (
    <div className="tg-insight-strip">
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
  );
}
