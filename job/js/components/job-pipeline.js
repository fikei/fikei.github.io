// job-pipeline — pipeline table view. Reads from jobs-pipe and renders
// rows sorted by Fit Score desc. Per-column filters live in the header row.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const { fetchPipeline, setStatus, generateAsset } = await import('../pipeline.js' + V);

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

const EMPTY_FILTERS = () => ({
  minFit: 0,
  status: '',         // '' = any
  company: '',
  title: '',
  source: '',
  sector: '',
  salary: '',
  hasResume: 'any',   // 'any' | 'has' | 'missing'
  hasCover: 'any',
});

export class JobPipeline extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    roles: { state: true },
    filters: { state: true },
    selectedRow: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.roles = [];
    this.filters = EMPTY_FILTERS();
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
    await this._load(false);
  }

  async _load(sync) {
    this.state = 'loading';
    try {
      const data = await fetchPipeline({ sync });
      this.roles = (data.roles || []).slice();
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  async _onSync() { await this._load(true); }

  _setFilter(key, value) {
    this.filters = { ...this.filters, [key]: value };
  }
  _clearFilters() { this.filters = EMPTY_FILTERS(); }
  _activeFilterCount() {
    const f = this.filters;
    let n = 0;
    if (f.minFit) n++;
    if (f.status) n++;
    if (f.company) n++;
    if (f.title) n++;
    if (f.source) n++;
    if (f.sector) n++;
    if (f.salary) n++;
    if (f.hasResume !== 'any') n++;
    if (f.hasCover !== 'any') n++;
    return n;
  }

  _filtered() {
    const f = this.filters;
    const lc = (s) => (s || '').toLowerCase();
    const has = (haystack, needle) => !needle || lc(haystack).includes(lc(needle));
    return this.roles.filter(r => {
      if (f.minFit && (r.score == null || r.score < f.minFit)) return false;
      if (f.status && (r.status || '') !== f.status) return false;
      if (f.source && (r.source || '') !== f.source) return false;
      if (!has(r.company, f.company)) return false;
      if (!has(r.title, f.title)) return false;
      if (!has(r.sector, f.sector)) return false;
      if (!has(r.salary, f.salary)) return false;
      if (f.hasResume === 'has' && !r.hasResume) return false;
      if (f.hasResume === 'missing' && r.hasResume) return false;
      if (f.hasCover === 'has' && !r.hasCoverLetter) return false;
      if (f.hasCover === 'missing' && r.hasCoverLetter) return false;
      return true;
    });
  }

  _uniques(field) {
    const set = new Set();
    this.roles.forEach(r => set.add(r[field] || ''));
    return Array.from(set).filter(Boolean).sort();
  }

  _scoreClass(s) {
    if (s == null) return 'fit-pill fit-pill--poor';
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
      await setStatus({ slug: r.slug, rowNumber: r.rowNumber }, status);
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
      await generateAsset(r.slug, kind);
      if (kind === 'resume') r.hasResume = true;
      else r.hasCoverLetter = true;
    } catch (e) {
      r._error = String(e);
    } finally {
      r[flag] = false;
      this.requestUpdate();
    }
  }

  _detailHref(r, tab) { return `/job/jobs/${r.slug}/?tab=${tab}`; }
  _onBackdropClick(e) { if (e.target.classList.contains('fit-modal__backdrop')) this._closeFitModal(); }

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
    return html`<button class="btn btn--sm btn--accent" @click=${() => this._onApplyClick(r)}>Apply ↗</button>`;
  }

  _renderAssetCell(r, kind) {
    const has = kind === 'resume' ? r.hasResume : r.hasCoverLetter;
    const generating = kind === 'resume' ? r._genResume : r._genCover;
    if (has) {
      return html`
        <a class="link-subtle" href=${this._detailHref(r, kind)} target="_blank" rel="noopener">View / Edit</a>
      `;
    }
    return html`
      <button class="btn btn--sm" ?disabled=${generating} @click=${() => this._onGenerate(r, kind)}>
        ${generating ? 'Generating…' : 'Create'}
      </button>
    `;
  }

  _renderFilterRow() {
    const f = this.filters;
    const set = (k) => (e) => this._setFilter(k, e.target.value);
    return html`
      <tr class="pipeline-table__filters">
        <th>
          <input type="number" min="0" max="100" placeholder="min"
            class="col-filter col-filter--num"
            .value=${f.minFit ? String(f.minFit) : ''}
            @input=${(e) => this._setFilter('minFit', parseInt(e.target.value, 10) || 0)}>
        </th>
        <th>
          <select class="col-filter" .value=${f.status} @change=${set('status')}>
            <option value="">Any</option>
            ${this._uniques('status').map(s => html`<option value=${s} ?selected=${f.status===s}>${s}</option>`)}
          </select>
        </th>
        <th><input type="text" placeholder="filter…" class="col-filter" .value=${f.company} @input=${set('company')}></th>
        <th><input type="text" placeholder="filter…" class="col-filter" .value=${f.title} @input=${set('title')}></th>
        <th></th>
        <th>
          <select class="col-filter" .value=${f.hasResume} @change=${set('hasResume')}>
            <option value="any">Any</option>
            <option value="has" ?selected=${f.hasResume==='has'}>Has</option>
            <option value="missing" ?selected=${f.hasResume==='missing'}>Missing</option>
          </select>
        </th>
        <th>
          <select class="col-filter" .value=${f.hasCover} @change=${set('hasCover')}>
            <option value="any">Any</option>
            <option value="has" ?selected=${f.hasCover==='has'}>Has</option>
            <option value="missing" ?selected=${f.hasCover==='missing'}>Missing</option>
          </select>
        </th>
        <th><input type="text" placeholder="filter…" class="col-filter" .value=${f.sector} @input=${set('sector')}></th>
        <th><input type="text" placeholder="filter…" class="col-filter" .value=${f.salary} @input=${set('salary')}></th>
        <th>
          <select class="col-filter" .value=${f.source} @change=${set('source')}>
            <option value="">Any</option>
            ${this._uniques('source').map(s => html`<option value=${s} ?selected=${f.source===s}>${s}</option>`)}
          </select>
        </th>
      </tr>
    `;
  }

  _renderRow(r) {
    return html`
      <tr>
        <td>
          <button class=${this._scoreClass(r.score) + ' fit-pill--button'}
            title="Tap to see the breakdown" @click=${() => this._openFitModal(r)}>
            ${r.score == null ? '—' : r.score}
          </button>
        </td>
        <td class="status-cell">
          <select class="status-select ${r._saving ? 'is-saving' : ''}" ?disabled=${r._saving}
            .value=${r.status || ''} @change=${(e) => this._changeStatus(r, e.target.value)}>
            ${STATUS_OPTIONS.map(s => html`<option value=${s} ?selected=${(r.status || '') === s}>${s || '—'}</option>`)}
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
            <button class="fit-modal__close" @click=${() => this._closeFitModal()} aria-label="Close">×</button>
          </header>
          <div class="fit-modal__score">
            <span class=${this._scoreClass(r.score)}>${r.score == null ? '—' : r.score}</span>
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
                  <div class="fit-breakdown__bar"><span style=${`width:${pct}%`}></span></div>
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
    const nFilters = this._activeFilterCount();
    return html`
      <div class="pipeline-meta">
        Showing <strong>${rows.length}</strong> of ${this.roles.length} roles, sorted by fit score.
        ${nFilters > 0 ? html`
          <button class="btn btn--sm" style="margin-left:var(--space-3);" @click=${() => this._clearFilters()}>
            Clear ${nFilters} filter${nFilters > 1 ? 's' : ''}
          </button>
        ` : nothing}
        <button class="btn btn--sm" style="margin-left:var(--space-3);" @click=${() => this._onSync()}>
          Sync from sheet
        </button>
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
            ${this._renderFilterRow()}
          </thead>
          <tbody>${rows.map(r => this._renderRow(r))}</tbody>
        </table>
      </div>
      ${this._renderFitModal()}
    `;
  }
}

customElements.define('job-pipeline', JobPipeline);
