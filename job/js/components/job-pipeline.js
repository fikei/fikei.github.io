// job-pipeline — pipeline table view. Reads from jobs-pipe and renders
// rows sorted by Fit Score desc. Click a fit pill to see the breakdown.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { fetchPipeline, setStatus, generateAsset } from '../pipeline.js';

const STATUS_OPTIONS = ['', 'New', 'Apply', 'Talking', 'Applied', 'Pass', 'Rejected', 'Closed', 'Not Listed', 'Nudge / Network'];
const TERMINAL_STATUSES = new Set(['Pass', 'Rejected', 'Closed']);
const APPLIED_STATUSES = new Set(['Applied', 'Talking']);

const DIM_LABELS = {
  title:   { label: 'Title match',   max: 25, hint: 'Founding/Senior/Staff PM scores higher; below seniority hard-fails.' },
  stage:   { label: 'Stage',         max: 20, hint: 'Inferred from investors. Pre-seed → C scores high; public/mega-cap hard-fails.' },
  sector:  { label: 'Sector',        max: 20, hint: 'Health and EdTech are top; AI-native / SaaS / Fintech middle.' },
  geo:     { label: 'Geography',     max: 15, hint: 'Sheet has no geo column — neutral default for now.' },
  comp:    { label: 'Compensation',  max: 10, hint: 'Top of range ≥ $200k = full marks.' },
  source:  { label: 'Source',        max: 5,  hint: 'Network > LinkedIn Saved > LinkedIn Recommended > Company Pages > Manual.' },
  network: { label: 'Network',       max: 5,  hint: 'A named contact in the row gets +5.' },
};

export class JobPipeline extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    roles: { state: true },
    statusFilter: { state: true },
    sourceFilter: { state: true },
    minFit: { state: true },
    sectorQuery: { state: true },
    selectedRow: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.roles = [];
    this.statusFilter = new Set();
    this.sourceFilter = new Set();
    this.minFit = 0;
    this.sectorQuery = '';
    this.selectedRow = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    this._onKey = (e) => { if (e.key === 'Escape') this._closeFitModal(); };
    document.addEventListener('keydown', this._onKey);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('keydown', this._onKey);
    super.disconnectedCallback();
  }

  async _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    this.state = 'loading';
    try {
      const data = await fetchPipeline();
      this.roles = (data.roles || []).slice().sort((a, b) => b.score - a.score);
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  _toggleSet(set, value, prop) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    this[prop] = next;
    this.requestUpdate();
  }

  _filtered() {
    return this.roles.filter(r => {
      if (this.statusFilter.size && !this.statusFilter.has(r.status || '(blank)')) return false;
      if (this.sourceFilter.size && !this.sourceFilter.has(r.source || '(blank)')) return false;
      if (this.minFit && r.score < this.minFit) return false;
      if (this.sectorQuery && !(r.sector || '').toLowerCase().includes(this.sectorQuery.toLowerCase())) return false;
      return true;
    });
  }

  _statuses() {
    const s = new Set();
    this.roles.forEach(r => s.add(r.status || '(blank)'));
    return Array.from(s).sort();
  }
  _sources() {
    const s = new Set();
    this.roles.forEach(r => s.add(r.source || '(blank)'));
    return Array.from(s).sort();
  }

  _renderFilters() {
    return html`
      <div class="pipeline-filters">
        <div class="pipeline-filters__group">
          <label>Status</label>
          <div class="chip-row">
            ${this._statuses().map(s => html`
              <button class="chip ${this.statusFilter.has(s) ? 'chip--on' : ''}"
                @click=${() => this._toggleSet(this.statusFilter, s, 'statusFilter')}>${s}</button>
            `)}
          </div>
        </div>
        <div class="pipeline-filters__group">
          <label>Source</label>
          <div class="chip-row">
            ${this._sources().map(s => html`
              <button class="chip ${this.sourceFilter.has(s) ? 'chip--on' : ''}"
                @click=${() => this._toggleSet(this.sourceFilter, s, 'sourceFilter')}>${s}</button>
            `)}
          </div>
        </div>
        <div class="pipeline-filters__group">
          <label>Min fit ${this.minFit}</label>
          <input type="range" min="0" max="100" .value=${String(this.minFit)}
            @input=${(e) => { this.minFit = parseInt(e.target.value, 10); }}>
        </div>
        <div class="pipeline-filters__group">
          <label>Sector</label>
          <input type="text" placeholder="e.g. health, fintech"
            .value=${this.sectorQuery}
            @input=${(e) => { this.sectorQuery = e.target.value; }}>
        </div>
      </div>
    `;
  }

  _scoreClass(s) {
    if (s >= 70) return 'fit-pill fit-pill--strong';
    if (s >= 50) return 'fit-pill fit-pill--ok';
    if (s >= 30) return 'fit-pill fit-pill--weak';
    return 'fit-pill fit-pill--poor';
  }

  _openFitModal(r) { this.selectedRow = r; }
  _closeFitModal() { this.selectedRow = null; }

  async _changeStatus(r, status) {
    if (status === r.status) return;
    const prev = r.status;
    r.status = status;
    r._saving = true;
    this.requestUpdate();
    try {
      await setStatus(r.rowNumber, status);
      r._saving = false;
      r._error = '';
    } catch (e) {
      r.status = prev;
      r._saving = false;
      r._error = String(e);
    }
    this.requestUpdate();
  }

  async _onApplyClick(r) {
    // Open the posting in a new tab even if status update fails.
    if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer');
    if (!APPLIED_STATUSES.has(r.status) && !TERMINAL_STATUSES.has(r.status)) {
      await this._changeStatus(r, 'Applied');
    }
  }

  async _onGenerate(r, kind) {
    const flag = kind === 'resume' ? '_genResume' : '_genCover';
    if (r[flag]) return;
    r[flag] = true;
    this.requestUpdate();
    try {
      await generateAsset(r.rowNumber, kind);
      if (kind === 'resume') r.hasResume = true;
      else r.hasCoverLetter = true;
    } catch (e) {
      r._error = String(e);
    } finally {
      r[flag] = false;
      this.requestUpdate();
    }
  }

  _detailHref(r, tab) {
    return `/job/jobs/${r.slug}/?row=${r.rowNumber}&tab=${tab}`;
  }
  _onBackdropClick(e) {
    if (e.target.classList.contains('fit-modal__backdrop')) this._closeFitModal();
  }

  _renderApplyCell(r) {
    if (TERMINAL_STATUSES.has(r.status)) {
      return r.url
        ? html`<a class="link-subtle" href=${r.url} target="_blank" rel="noopener noreferrer">Posting ↗</a>`
        : html`<span class="muted">—</span>`;
    }
    if (APPLIED_STATUSES.has(r.status)) {
      return html`
        <div class="apply-cell apply-cell--applied">
          <span class="muted">Applied</span>
          ${r.url ? html`<a class="link-subtle" href=${r.url} target="_blank" rel="noopener noreferrer">Posting ↗</a>` : nothing}
        </div>
      `;
    }
    if (!r.url) return html`<span class="muted">—</span>`;
    return html`
      <button class="btn btn--sm btn--accent" @click=${() => this._onApplyClick(r)}>
        Apply ↗
      </button>
    `;
  }

  _renderAssetCell(r, kind) {
    const has = kind === 'resume' ? r.hasResume : r.hasCoverLetter;
    const generating = kind === 'resume' ? r._genResume : r._genCover;
    if (has) {
      return html`
        <a class="link-subtle" href=${this._detailHref(r, kind)} target="_blank" rel="noopener">
          View / Edit
        </a>
      `;
    }
    return html`
      <button class="btn btn--sm" ?disabled=${generating} @click=${() => this._onGenerate(r, kind)}>
        ${generating ? 'Generating…' : 'Create'}
      </button>
    `;
  }

  _renderRow(r) {
    return html`
      <tr>
        <td>
          <button
            class=${this._scoreClass(r.score) + ' fit-pill--button'}
            title="Tap to see the breakdown"
            @click=${() => this._openFitModal(r)}>
            ${r.score}
          </button>
        </td>
        <td class="status-cell">
          <select
            class="status-select ${r._saving ? 'is-saving' : ''}"
            ?disabled=${r._saving}
            .value=${r.status || ''}
            @change=${(e) => this._changeStatus(r, e.target.value)}>
            ${STATUS_OPTIONS.map(s => html`
              <option value=${s} ?selected=${(r.status || '') === s}>${s || '—'}</option>
            `)}
          </select>
          ${r._error ? html`<span class="status-cell__err" title=${r._error}>!</span>` : nothing}
        </td>
        <td><strong>${r.company}</strong></td>
        <td>${r.title}</td>
        <td>${this._renderApplyCell(r)}</td>
        <td>${this._renderAssetCell(r, 'resume')}</td>
        <td>${this._renderAssetCell(r, 'cover-letter')}</td>
        <td><span class="muted">${r.sector || ''}</span></td>
        <td><span class="muted">${r.salary || ''}</span></td>
        <td><span class="muted">${r.source || ''}</span></td>
      </tr>
    `;
  }

  _renderFitModal() {
    const r = this.selectedRow;
    if (!r) return nothing;
    const dims = Object.keys(DIM_LABELS);
    return html`
      <div class="fit-modal__backdrop" @click=${this._onBackdropClick}>
        <div class="fit-modal" role="dialog" aria-modal="true" aria-label="Fit score breakdown">
          <header class="fit-modal__head">
            <div>
              <p class="fit-modal__eyebrow">${r.company}</p>
              <h2>${r.title || 'Untitled role'}</h2>
            </div>
            <button class="fit-modal__close" @click=${this._closeFitModal} aria-label="Close">×</button>
          </header>

          <div class="fit-modal__score">
            <span class=${this._scoreClass(r.score)}>${r.score}</span>
            <div>
              <p class="fit-modal__score-label">Fit score</p>
              <p class="fit-modal__score-sub">Out of 100. Sum of seven weighted dimensions; hard fails cap at 30.</p>
            </div>
          </div>

          ${r.hardFails && r.hardFails.length ? html`
            <div class="fit-modal__fails">
              <strong>Hard fail${r.hardFails.length > 1 ? 's' : ''}:</strong>
              ${r.hardFails.join(', ')}. Score capped at 30.
            </div>
          ` : nothing}

          <ul class="fit-breakdown">
            ${dims.map(k => {
              const meta = DIM_LABELS[k];
              const v = (r.breakdown && r.breakdown[k]) || 0;
              const pct = Math.max(0, Math.min(100, (v / meta.max) * 100));
              return html`
                <li class="fit-breakdown__row">
                  <div class="fit-breakdown__head">
                    <span class="fit-breakdown__label">${meta.label}</span>
                    <span class="fit-breakdown__value">${v} / ${meta.max}</span>
                  </div>
                  <div class="fit-breakdown__bar">
                    <span style=${`width:${pct}%`}></span>
                  </div>
                  <p class="fit-breakdown__hint">${meta.hint}</p>
                </li>
              `;
            })}
          </ul>

          <footer class="fit-modal__foot">
            <p class="muted">Weights are fixed in v1. Tunable in v2 once Vision integration lands.</p>
          </footer>
        </div>
      </div>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`<div class="placeholder"><h2>Loading pipeline…</h2><p>Reading the Job Search sheet.</p></div>`;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder" style="border-color:var(--error);color:var(--error);">
        <h2>Couldn't load pipeline</h2>
        <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
      </div>`;
    }
    const rows = this._filtered();
    return html`
      ${this._renderFilters()}
      <div class="pipeline-meta">
        Showing <strong>${rows.length}</strong> of ${this.roles.length} roles, sorted by fit score.
      </div>
      <div class="pipeline-table-wrap">
        <table class="pipeline-table">
          <thead>
            <tr>
              <th>Fit</th>
              <th>Status</th>
              <th>Company</th>
              <th>Role</th>
              <th>Apply</th>
              <th>Resume</th>
              <th>Cover</th>
              <th>Sector</th>
              <th>Salary</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>${rows.map(r => this._renderRow(r))}</tbody>
        </table>
      </div>
      ${this._renderFitModal()}
    `;
  }
}

customElements.define('job-pipeline', JobPipeline);
