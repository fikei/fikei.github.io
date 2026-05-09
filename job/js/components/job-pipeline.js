// job-pipeline — pipeline table view. Reads from jobs-pipe and renders
// rows. Each column header is a sort toggle (3-state: none → asc → desc).
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const { fetchPipeline, setStatus } = await import('../pipeline.js' + V);

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

// Each column entry: { id, label, sortKey | null, type: 'num'|'text'|'bool' }.
// sortKey null → header isn't clickable.
// Resume + Cover, Source + Salary all live on the detail page now.
const COLUMNS = [
  { id: 'fit',     label: 'Fit',     sortKey: 'score',   type: 'num',  defaultDir: 'desc' },
  { id: 'status',  label: 'Status',  sortKey: 'status',  type: 'text' },
  { id: 'company', label: 'Company', sortKey: 'company', type: 'text' },
  { id: 'role',    label: 'Role',    sortKey: 'title',   type: 'text' },
  { id: 'sector',  label: 'Sector',  sortKey: 'sector',  type: 'text' },
  { id: 'view',    label: '',        sortKey: null },
];

// Drop rows without an apply link, and any Strava postings (out of scope).
function isVisibleRole(r) {
  if (!r.url) return false;
  const company = (r.company || '').toLowerCase();
  if (company === 'strava') return false;
  if (/(^|\.)strava\.com\b/i.test(r.url)) return false;
  return true;
}

export class JobPipeline extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    roles: { state: true },
    sortKey: { state: true },
    sortDir: { state: true },
    selectedRow: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.roles = [];
    this.sortKey = 'score';
    this.sortDir = 'desc';
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

  _onSortClick(col) {
    if (!col.sortKey) return;
    if (this.sortKey !== col.sortKey) {
      this.sortKey = col.sortKey;
      this.sortDir = col.defaultDir || (col.type === 'num' || col.type === 'bool' ? 'desc' : 'asc');
      return;
    }
    // 3-state cycle: asc → desc → none.
    if (this.sortDir === 'asc') {
      this.sortDir = 'desc';
    } else if (this.sortDir === 'desc') {
      this.sortKey = 'score';     // reset to default
      this.sortDir = 'desc';
    }
  }

  _sorted() {
    const key = this.sortKey;
    const dir = this.sortDir === 'desc' ? -1 : 1;
    const arr = this.roles.filter(isVisibleRole);
    arr.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      // null/undefined always sorted to bottom regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' || typeof bv === 'number') return (av - bv) * dir;
      if (typeof av === 'boolean' || typeof bv === 'boolean') return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
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

  _detailHref(r) { return `/job/jobs/${r.slug}/`; }
  _onBackdropClick(e) { if (e.target.classList.contains('fit-modal__backdrop')) this._closeFitModal(); }

  _renderViewCell(r) {
    return html`
      <a class="btn btn--sm btn--accent" href=${this._detailHref(r)} target="_blank" rel="noopener">
        View
      </a>
    `;
  }

  _renderHeader() {
    return html`
      <tr>
        ${COLUMNS.map(c => {
          if (!c.sortKey) return html`<th>${c.label}</th>`;
          const active = this.sortKey === c.sortKey;
          const arrow = active ? (this.sortDir === 'asc' ? '↑' : '↓') : '↕';
          return html`
            <th>
              <button class="th-sort ${active ? 'is-active' : ''}" @click=${() => this._onSortClick(c)}>
                <span>${c.label}</span>
                <span class="th-sort__arrow">${arrow}</span>
              </button>
            </th>
          `;
        })}
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
          <select class="status-select ${r._saving ? 'is-saving' : ''}"
            data-status=${r.status || 'New'}
            ?disabled=${r._saving}
            .value=${r.status || ''} @change=${(e) => this._changeStatus(r, e.target.value)}>
            ${STATUS_OPTIONS.map(s => html`<option value=${s} ?selected=${(r.status || '') === s}>${s || '—'}</option>`)}
          </select>
          ${r._error ? html`<span class="status-cell__err" title=${r._error}>!</span>` : nothing}
        </td>
        <td><strong>${r.company}</strong></td>
        <td>${r.title}</td>
        <td><span class="muted">${r.sector || ''}</span></td>
        <td>${this._renderViewCell(r)}</td>
      </tr>
    `;
  }

  _renderSkeletonRow() {
    return html`
      <tr class="skeleton-row">
        <td><span class="skeleton skeleton--pill" style="width:40px;height:24px;"></span></td>
        <td><span class="skeleton skeleton--pill" style="width:120px;height:32px;"></span></td>
        <td><span class="skeleton" style="width:100px;height:16px;"></span></td>
        <td><span class="skeleton" style="width:60%;height:16px;"></span></td>
        <td><span class="skeleton" style="width:80px;height:16px;"></span></td>
        <td><span class="skeleton skeleton--pill" style="width:64px;height:32px;"></span></td>
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
      // Render the same shell that the loaded view will use, with skeleton
      // rows in place of real content so the table doesn't visually jolt
      // into existence on load.
      return html`
        <div class="pipeline-meta">
          <span class="skeleton" style="width:160px;height:14px;display:inline-block;"></span>
        </div>
        <div class="pipeline-table-wrap">
          <table class="pipeline-table">
            <thead>${this._renderHeader()}</thead>
            <tbody>${Array.from({ length: 8 }).map(() => this._renderSkeletonRow())}</tbody>
          </table>
        </div>
      `;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder" style="border-color:var(--error);color:var(--error);">
        <h2>Couldn't load pipeline</h2>
        <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
      </div>`;
    }
    const rows = this._sorted();
    return html`
      <div class="pipeline-meta">
        <strong>${rows.length}</strong> roles, sorted by ${this.sortKey} ${this.sortDir === 'asc' ? '↑' : '↓'}.
        <button class="btn btn--sm" style="margin-left:var(--space-3);" @click=${() => this._onSync()}>
          Sync from sheet
        </button>
      </div>
      <div class="pipeline-table-wrap">
        <table class="pipeline-table">
          <thead>${this._renderHeader()}</thead>
          <tbody>${rows.map(r => this._renderRow(r))}</tbody>
        </table>
      </div>
      ${this._renderFitModal()}
    `;
  }
}

customElements.define('job-pipeline', JobPipeline);
