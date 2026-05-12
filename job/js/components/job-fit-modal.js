// job-fit-modal — shared fit-score breakdown modal. Used by the pipeline
// table and the recommendations carousel/page so the tooltip is reachable
// everywhere a fit pill appears.
import { html, nothing } from 'https://esm.run/lit@3';

// Fit-side: "Is this company a good fit for me?" — driven by user's
// stated needs (mission, culture, interests, etc.).
export const DIM_LABELS = {
  values:  { label: 'Values & impact',   max: 25, hint: 'Mission keywords + impact themes (healthcare outcomes, cost reduction, education access, AI ethics, civic / social good). Anti-themes (gambling, crypto, surveillance) zero this out. Allowed to dominate the score.' },
  culture: { label: 'Culture fit',       max: 15, hint: 'JD/About text matches your culture pool: AI-native, strong eng bar / principal engineer, autonomy / IC / player-coach, mission-led.' },
  role:    { label: 'Role match',        max: 25, hint: 'JD responsibilities vs your skills + interest tags (clinician experience, platform infra, behavioral loops, billing/cost reduction, public benefit). Claude Haiku grades JDs with full descriptions; regex fallback otherwise.' },
  domain:  { label: 'Domain experience', max: 15, hint: 'Posting sector overlaps with companies you have worked at — healthtech, edtech, consumer SaaS, civic.' },
  arc:     { label: 'Career arc',        max: 10, hint: 'Stage + scope coherence: founding at seed/A, scale-up at B+, IPO/acquisition language.' },
  stage:   { label: 'Stage',             max: 4,  hint: 'Tiebreaker only. Pre-seed → C scores high; public / mega-cap hard-fails.' },
  comp:    { label: 'Compensation',      max: 4,  hint: 'Top of range ≥ $200k = full marks. Floor signal, not a ranker.' },
  geo:     { label: 'Geography',         max: 2,  hint: 'Most geo filtering happens upstream — this is a small bonus.', binary: true },
};

// Candidate-side: "Am I a strong candidate for this role?" — biased
// toward "can you do the job" and "is this a reach in either direction".
export const CANDIDATE_DIM_LABELS = {
  skills:  { label: 'Job-ready skills',    max: 25, hint: 'Share of the day-1 work executable without ramp vs. needing learning.' },
  scope:   { label: 'Scope readiness',     max: 20, hint: 'Team size, ownership, and decision scale relative to what you have operated at.' },
  outcome: { label: 'Outcome track record', max: 15, hint: 'Have you shipped the kind of outcome this role hires for — growth, platform, 0→1, scale?' },
  domain:  { label: 'Domain familiarity',  max: 15, hint: 'Worked in their sector before or domain on-ramp.' },
  stretch: { label: 'Stretch level',       max: 15, hint: 'Healthy stretch vs. comfort zone vs. risky reach.' },
  reach:   { label: 'Reach factors',       max: 10, hint: 'Specific things a hiring manager could push on — missing specialty, gaps, overqualification.' },
  comp:    { label: 'Compensation',        max: 1,  hint: 'No money-mismatch risk — range clears your floor.', binary: true },
};

export function scoreClass(s) {
  if (s == null) return 'fit-pill fit-pill--poor';
  if (s >= 70) return 'fit-pill fit-pill--strong';
  if (s >= 50) return 'fit-pill fit-pill--ok';
  if (s >= 30) return 'fit-pill fit-pill--weak';
  return 'fit-pill fit-pill--poor';
}

// Score-card-body: shared between Fit and Candidate-Strength views.
// opts.which selects which dimension set + data fields to render.
//   'fit'       → DIM_LABELS,           row.score / breakdown / rationales
//   'candidate' → CANDIDATE_DIM_LABELS, row.candidateScore / candidateBreakdown / candidateRationales
const VIEWS = {
  fit: {
    dims:        DIM_LABELS,
    label:       'Fit score',
    sub:         'Out of 100. Values & impact and Role match are the dominant signals; comp and stage are tiebreakers. Hard fails cap at 30.',
    scoreOf:     (row) => row.score ?? row.fitScore ?? null,
    breakdownOf: (row) => row.breakdown || row.fitBreakdown || {},
    rationalesOf:(row) => row.rationales || row.fitRationales || {},
    hardFailsOf: (row) => row.hardFails || [],
    binaryOf:    (row, k) => k === 'geo' ? ((row.breakdown || {})[k] || 0) >= 1 : null,
  },
  candidate: {
    dims:        CANDIDATE_DIM_LABELS,
    label:       'Candidate strength',
    sub:         'Out of 100. Can you do this job day-1? How much of a reach is it in either direction? Bars answer the questions a hiring manager actually asks.',
    scoreOf:     (row) => row.candidateScore ?? null,
    breakdownOf: (row) => row.candidateBreakdown || {},
    rationalesOf:(row) => row.candidateRationales || {},
    hardFailsOf: (_row) => [],
    binaryOf:    (row, k) => k === 'comp' ? Boolean(row.compAcceptable) : null,
  },
};

export function renderFitCardBody(row, opts = {}) {
  return renderScoreCardBody(row, { which: 'fit', ...opts });
}

export function renderCandidateCardBody(row, opts = {}) {
  return renderScoreCardBody(row, { which: 'candidate', ...opts });
}

// The common body. `summary` replaces the static sub-explainer when set.
// `loading` shows a placeholder line when true and no summary provided.
export function renderScoreCardBody(row, opts = {}) {
  if (!row) return nothing;
  const which = opts.which || 'fit';
  const view = VIEWS[which];
  const score = view.scoreOf(row);
  const hardFails = view.hardFailsOf(row);
  const { summary = null, loading = false } = opts;
  const sub = summary
    ? html`<div class="fit-modal__score-sub">${summary}</div>`
    : loading
      ? html`<p class="fit-modal__score-sub muted">Drafting summary…</p>`
      : html`<p class="fit-modal__score-sub">${view.sub}</p>`;
  return html`
    <div class="fit-modal__score">
      <span class=${scoreClass(score)}>${score == null ? '—' : score}</span>
      <div>
        <p class="fit-modal__score-label">${view.label}</p>
        ${sub}
      </div>
    </div>
    ${hardFails.length ? html`
      <div class="fit-modal__fails">
        <strong>Hard fail${hardFails.length > 1 ? 's' : ''}:</strong>
        ${hardFails.join(', ')}. Score capped at 30.
      </div>
    ` : nothing}
    ${renderBreakdown(row, which)}
  `;
}

// Map a bucket's % of cap to a color tier. The strong/ok/weak class names
// match the same scale used on fit pills.
function tierClass(pct) {
  if (pct >= 70) return 'fit-breakdown__bar--strong';
  if (pct >= 40) return 'fit-breakdown__bar--ok';
  return 'fit-breakdown__bar--weak';
}

// Render just the bars + subcopy list for either view. `which` selects
// the dimension set. Dimensions flagged `binary: true` (or specifically
// `geo` on the Fit view, `comp` on the Candidate view) render as a ✓ / ✗
// check chip; the rest render as colored bars.
export function renderBreakdown(row, which = 'fit') {
  if (!row) return nothing;
  const view = VIEWS[which];
  const dims = view.dims;
  const breakdown = view.breakdownOf(row);
  const rationales = view.rationalesOf(row);
  return html`
    <ul class="fit-breakdown">
      ${Object.keys(dims).map(k => {
        const meta = dims[k];
        const v = (breakdown && breakdown[k]) || 0;
        const binary = meta.binary === true;
        const binaryMet = binary ? Boolean(view.binaryOf(row, k)) : null;
        const pct = Math.max(0, Math.min(100, (v / meta.max) * 100));
        if (binary) {
          return html`
            <li class="fit-breakdown__row fit-breakdown__row--binary">
              <div class="fit-breakdown__head">
                <span class="fit-breakdown__label">${meta.label}</span>
                <span class=${'fit-breakdown__check ' + (binaryMet ? 'fit-breakdown__check--met' : 'fit-breakdown__check--unmet')}
                      aria-label=${binaryMet ? 'Met' : 'Not met'}>${binaryMet ? '✓' : '✗'}</span>
              </div>
              <p class="fit-breakdown__hint">${rationales[k] || meta.hint}</p>
            </li>
          `;
        }
        return html`
          <li class="fit-breakdown__row">
            <div class="fit-breakdown__head">
              <span class="fit-breakdown__label">${meta.label}</span>
              <span class="fit-breakdown__value">${v} / ${meta.max}</span>
            </div>
            <div class=${'fit-breakdown__bar ' + tierClass(pct)}><span style=${`width:${pct}%`}></span></div>
            <p class="fit-breakdown__hint">${rationales[k] || meta.hint}</p>
          </li>
        `;
      })}
    </ul>
  `;
}

// Backwards-compat: existing callers import renderFitBreakdown.
export function renderFitBreakdown(row) {
  return renderBreakdown(row, 'fit');
}

// Render the modal. `row` is the role-like object — expects { company, title,
// score, breakdown, hardFails }. `onClose` is called when the user dismisses.
// Returns a lit-html template (or `nothing` if row is null).
// `which` selects between the Fit and Candidate Strength views. Both
// modals share the same chrome; only the body differs.
export function renderScoreModal(row, onClose, which = 'fit') {
  if (!row) return nothing;
  const onBackdrop = (e) => { if (e.target.classList.contains('fit-modal__backdrop')) onClose(); };
  const ariaLabel = which === 'candidate' ? 'Candidate strength breakdown' : 'Fit score breakdown';
  const foot = which === 'candidate'
    ? html`<p class="muted">Hiring manager's lens — can the candidate do the job, and how much of a reach is it?</p>`
    : html`<p class="muted">v3 weights: values/culture/role-match drive the score; mission can dominate.</p>`;
  const body = which === 'candidate' ? renderCandidateCardBody(row) : renderFitCardBody(row);
  return html`
    <div class="fit-modal__backdrop" @click=${onBackdrop}>
      <div class="fit-modal" role="dialog" aria-modal="true" aria-label=${ariaLabel}>
        <header class="fit-modal__head">
          <div>
            <p class="fit-modal__eyebrow">${row.company}</p>
            <h2>${row.title || 'Untitled role'}</h2>
          </div>
          <button class="fit-modal__close" @click=${() => onClose()} aria-label="Close">×</button>
        </header>
        ${body}
        <footer class="fit-modal__foot">${foot}</footer>
      </div>
    </div>
  `;
}

// Backwards-compat wrapper. Existing callers pass (row, onClose).
export function renderFitModal(row, onClose) {
  return renderScoreModal(row, onClose, 'fit');
}

// Stacked pair of clickable score pills — Fit on top, Candidate below.
// Used everywhere a job appears in a list (pipeline table, recommended
// table, carousel card). Each pill opens its own modal. The pair stops
// propagation so row clicks still work for cells around it.
export function renderScorePair(row, opts) {
  const { onFit, onCandidate, fitClass, candClass, fitTitle = 'Tap to see the Fit breakdown', candTitle = 'Tap to see the Candidate Strength breakdown' } = opts;
  const fit = row.score ?? row.fitScore ?? null;
  const cand = row.candidateScore ?? null;
  return html`
    <div class="score-pair">
      <button class=${fitClass(fit) + ' fit-pill--button score-pair__fit'}
              title=${fitTitle}
              @click=${(e) => { e.stopPropagation(); onFit(row); }}>
        ${fit == null ? '—' : fit}
      </button>
      ${cand == null
        ? html`<span class="score-pair__cand score-pair__cand--empty" title="Candidate strength not graded yet">—</span>`
        : html`<button class=${candClass(cand) + ' fit-pill--button score-pair__cand'}
                       title=${candTitle}
                       @click=${(e) => { e.stopPropagation(); onCandidate(row); }}>
                 ${cand}
               </button>`}
    </div>
  `;
}
