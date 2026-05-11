// job-fit-modal — shared fit-score breakdown modal. Used by the pipeline
// table and the recommendations carousel/page so the tooltip is reachable
// everywhere a fit pill appears.
import { html, nothing } from 'https://esm.run/lit@3';

export const DIM_LABELS = {
  values:  { label: 'Values & impact',   max: 25, hint: 'Mission keywords + impact themes (healthcare outcomes, cost reduction, education access, AI ethics, civic / social good). Anti-themes (gambling, crypto, surveillance) zero this out. Allowed to dominate the score.' },
  culture: { label: 'Culture fit',       max: 15, hint: 'JD/About text matches your culture pool: AI-native, strong eng bar / principal engineer, autonomy / IC / player-coach, mission-led.' },
  role:    { label: 'Role match',        max: 25, hint: 'JD responsibilities vs your skills + interest tags (clinician experience, platform infra, behavioral loops, billing/cost reduction, public benefit). Claude Haiku grades JDs with full descriptions; regex fallback otherwise.' },
  domain:  { label: 'Domain experience', max: 15, hint: 'Posting sector overlaps with companies you have worked at — healthtech, edtech, consumer SaaS, civic.' },
  arc:     { label: 'Career arc',        max: 10, hint: 'Stage + scope coherence: founding at seed/A, scale-up at B+, IPO/acquisition language.' },
  stage:   { label: 'Stage',             max: 4,  hint: 'Tiebreaker only. Pre-seed → C scores high; public / mega-cap hard-fails.' },
  comp:    { label: 'Compensation',      max: 4,  hint: 'Top of range ≥ $200k = full marks. Floor signal, not a ranker.' },
  geo:     { label: 'Geography',         max: 2,  hint: 'Most geo filtering happens upstream — this is a small bonus.' },
};

export function scoreClass(s) {
  if (s == null) return 'fit-pill fit-pill--poor';
  if (s >= 70) return 'fit-pill fit-pill--strong';
  if (s >= 50) return 'fit-pill fit-pill--ok';
  if (s >= 30) return 'fit-pill fit-pill--weak';
  return 'fit-pill fit-pill--poor';
}

// Render the modal. `row` is the role-like object — expects { company, title,
// score, breakdown, hardFails }. `onClose` is called when the user dismisses.
// Returns a lit-html template (or `nothing` if row is null).
export function renderFitModal(row, onClose) {
  if (!row) return nothing;
  const score = row.score ?? row.fitScore ?? null;
  const breakdown = row.breakdown || row.fitBreakdown || {};
  // Per-bucket rationales generated at score-time. Falls back to the
  // dimension's generic hint when a rationale hasn't been computed yet
  // (older rows from before fit_rationales column existed).
  const rationales = row.rationales || row.fitRationales || {};
  const hardFails = row.hardFails || [];
  const dims = Object.keys(DIM_LABELS);
  const onBackdrop = (e) => { if (e.target.classList.contains('fit-modal__backdrop')) onClose(); };
  return html`
    <div class="fit-modal__backdrop" @click=${onBackdrop}>
      <div class="fit-modal" role="dialog" aria-modal="true" aria-label="Fit score breakdown">
        <header class="fit-modal__head">
          <div>
            <p class="fit-modal__eyebrow">${row.company}</p>
            <h2>${row.title || 'Untitled role'}</h2>
          </div>
          <button class="fit-modal__close" @click=${() => onClose()} aria-label="Close">×</button>
        </header>
        <div class="fit-modal__score">
          <span class=${scoreClass(score)}>${score == null ? '—' : score}</span>
          <div>
            <p class="fit-modal__score-label">Fit score</p>
            <p class="fit-modal__score-sub">Out of 100. Values & impact and Role match are the dominant signals; comp and stage are tiebreakers. Hard fails cap at 30.</p>
          </div>
        </div>
        ${hardFails.length ? html`
          <div class="fit-modal__fails">
            <strong>Hard fail${hardFails.length > 1 ? 's' : ''}:</strong>
            ${hardFails.join(', ')}. Score capped at 30.
          </div>
        ` : nothing}
        <ul class="fit-breakdown">
          ${dims.map(k => {
            const meta = DIM_LABELS[k];
            const v = (breakdown && breakdown[k]) || 0;
            const pct = Math.max(0, Math.min(100, (v / meta.max) * 100));
            return html`
              <li class="fit-breakdown__row">
                <div class="fit-breakdown__head">
                  <span class="fit-breakdown__label">${meta.label}</span>
                  <span class="fit-breakdown__value">${v} / ${meta.max}</span>
                </div>
                <div class="fit-breakdown__bar"><span style=${`width:${pct}%`}></span></div>
                <p class="fit-breakdown__hint">${rationales[k] || meta.hint}</p>
              </li>
            `;
          })}
        </ul>
        <footer class="fit-modal__foot">
          <p class="muted">v2 weights: mission/domain/skills/title weighted from your vision + work history.</p>
        </footer>
      </div>
    </div>
  `;
}
