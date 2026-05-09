// job-pipeline — pipeline table view. Reads from jobs-pipe and renders
// rows. Each column header is a sort toggle (3-state: none → asc → desc).
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const { fetchPipeline, setStatus, setArchived, deleteRole, stashRolePrefill, checkLiveness, addRole } = await import('../pipeline.js' + V);
const { logoSrc, logoInitial } = await import('../logo.js' + V);
// Mount the recommendations widget. It self-loads when the user is signed in.
import('./job-recommendations.js' + V);

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
// Role + Company collapsed into a single stacked cell: title row 1,
// company row 2. Header sort defaults to title (alphabetical).
const COLUMNS = [
  { id: 'fit',    label: 'Fit',    sortKey: 'score',   type: 'num',  defaultDir: 'desc' },
  { id: 'status', label: 'Status', sortKey: 'status',  type: 'text' },
  { id: 'role',   label: 'Role',   sortKey: 'title',   type: 'text' },
  { id: 'sector', label: 'Sector', sortKey: 'sector',  type: 'text' },
  { id: 'menu',   label: '',       sortKey: null },
];

// Drop rows without an apply link, and any Strava postings (out of scope).
function isVisibleRole(r) {
  if (!r.url) return false;
  const company = (r.company || '').toLowerCase();
  if (company === 'strava') return false;
  if (/(^|\.)strava\.com\b/i.test(r.url)) return false;
  return true;
}

function isArchived(r) { return !!r.archivedAt; }
function archiveFilter(r, view) {
  if (view === 'archived') return isArchived(r);
  if (view === 'all')      return true;
  return !isArchived(r); // 'active' default
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
    archivedView: { state: true },   // 'active' | 'all' | 'archived'
    openMenuSlug: { state: true },
    livenessChecking: { state: true },
    livenessResult: { state: true },
    livenessResultDismissed: { state: true },
    closedSinceLastVisit: { state: true },
    bannerDismissed: { state: true },
    pasteOpen: { state: true },
    pasteUrl: { state: true },
    pasteSaving: { state: true },
    pasteError: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.roles = [];
    this.sortKey = 'score';
    this.sortDir = 'desc';
    this.selectedRow = null;
    this.archivedView = 'active';
    this.openMenuSlug = null;
    this.livenessChecking = false;
    this.livenessResult = null;            // { checked, closed: [slug…] }
    this.livenessResultDismissed = false;
    this.closedSinceLastVisit = [];
    this.bannerDismissed = false;
    this.pasteOpen = false;
    this.pasteUrl = '';
    this.pasteSaving = false;
    this.pasteError = '';
    this._lastVisitAt = (() => {
      try { return localStorage.getItem('job:jobs:lastVisitAt') || null; } catch { return null; }
    })();
  }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    this._onKey = (e) => {
      if (e.key === 'Escape') { this._closeFitModal(); this.openMenuSlug = null; }
    };
    document.addEventListener('keydown', this._onKey);
    this._onDocClick = (e) => {
      if (!this.openMenuSlug) return;
      if (!e.target.closest('.row-menu')) this.openMenuSlug = null;
    };
    document.addEventListener('click', this._onDocClick);
    this._onRefresh = async () => {
      try {
        const data = await fetchPipeline();
        this.roles = (data.roles || []).slice();
      } catch {}
    };
    document.addEventListener('job:pipeline:refresh', this._onRefresh);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('click', this._onDocClick);
    document.removeEventListener('job:pipeline:refresh', this._onRefresh);
    super.disconnectedCallback();
  }

  async _onPasteSubmit(e) {
    e.preventDefault();
    if (!this.pasteUrl || this.pasteSaving) return;
    this.pasteSaving = true;
    this.pasteError = '';
    try {
      const r = await addRole({ url: this.pasteUrl });
      // refresh & close
      const data = await fetchPipeline();
      this.roles = (data.roles || []).slice();
      this.pasteOpen = false;
      this.pasteUrl = '';
      // Open the new role's detail page in a new tab so the user can flesh it out.
      window.open(`/job/jobs/${r.slug}/`, '_blank', 'noopener');
    } catch (err) {
      this.pasteError = String(err);
    } finally {
      this.pasteSaving = false;
    }
  }

  async _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    this.state = 'loading';
    try {
      const data = await fetchPipeline();
      this.roles = (data.roles || []).slice();
      this._computeClosedSinceLastVisit();
      // Stamp the visit AFTER reading lastVisit so the banner sticks for
      // this session.
      try { localStorage.setItem('job:jobs:lastVisitAt', new Date().toISOString()); } catch {}
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  _computeClosedSinceLastVisit() {
    const cutoff = this._lastVisitAt ? Date.parse(this._lastVisitAt) : 0;
    this.closedSinceLastVisit = this.roles.filter(r =>
      r.closedDetectedAt && Date.parse(r.closedDetectedAt) > cutoff
    );
  }

  async _onCheckLiveness() {
    if (this.livenessChecking) return;
    this.livenessChecking = true;
    this.livenessResult = null;
    this.livenessResultDismissed = false;
    this.requestUpdate();
    try {
      const res = await checkLiveness();
      const data = await fetchPipeline();
      this.roles = (data.roles || []).slice();
      this._computeClosedSinceLastVisit();
      this.livenessResult = {
        checked: res.checked || 0,
        closed: Array.isArray(res.closed) ? res.closed : [],
      };
      if (this.livenessResult.closed.length) this.bannerDismissed = false;
    } catch (e) {
      this.error = String(e);
    } finally {
      this.livenessChecking = false;
      this.requestUpdate();
    }
  }

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
    const arr = this.roles.filter(r => isVisibleRole(r) && archiveFilter(r, this.archivedView));
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

  _toggleMenu(slug, e) {
    e.stopPropagation();
    this.openMenuSlug = this.openMenuSlug === slug ? null : slug;
  }

  async _onArchive(r, archived) {
    this.openMenuSlug = null;
    const prev = r.archivedAt;
    r.archivedAt = archived ? new Date().toISOString() : null;
    this.requestUpdate();
    try {
      await setArchived(r.slug, archived);
    } catch (e) {
      r.archivedAt = prev;
      r._error = String(e);
      this.requestUpdate();
    }
  }

  async _onDelete(r) {
    this.openMenuSlug = null;
    const ok = window.confirm(
      `Delete "${r.title}" at ${r.company}?\n\n` +
      `The row disappears from the pipeline. We keep a record in the backend for continuity, but it won't show up in any view.`
    );
    if (!ok) return;
    // Optimistic: drop from local list.
    const idx = this.roles.findIndex(x => x.slug === r.slug);
    const removed = idx >= 0 ? this.roles.splice(idx, 1)[0] : null;
    this.requestUpdate();
    try {
      await deleteRole(r.slug);
    } catch (e) {
      // restore on failure
      if (removed) this.roles.splice(idx, 0, removed);
      r._error = String(e);
      this.requestUpdate();
    }
  }
  _onBackdropClick(e) { if (e.target.classList.contains('fit-modal__backdrop')) this._closeFitModal(); }

  _renderMenuCell(r) {
    const archived = isArchived(r);
    const menuOpen = this.openMenuSlug === r.slug;
    return html`
      <div class="row-menu">
        <button class="row-menu__trigger" aria-label="Row actions"
                aria-expanded=${menuOpen ? 'true' : 'false'}
                @click=${(e) => this._toggleMenu(r.slug, e)}>⋮</button>
        ${menuOpen ? html`
          <div class="row-menu__panel" role="menu">
            <button role="menuitem" class="row-menu__item" @click=${() => this._onArchive(r, !archived)}>
              ${archived ? 'Unarchive' : 'Archive'}
            </button>
            <button role="menuitem" class="row-menu__item row-menu__item--danger" @click=${() => this._onDelete(r)}>
              Delete…
            </button>
          </div>
        ` : nothing}
      </div>
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

  _onRowClick(r, e) {
    // Don't navigate when the click landed on an interactive child
    // (status select, fit pill, View button, triple-dot menu).
    if (e.target.closest('button, select, a, .row-menu, .fit-pill--button')) return;
    stashRolePrefill(r);
    window.open(this._detailHref(r), '_blank', 'noopener');
  }

  _renderRow(r) {
    return html`
      <tr class=${'pipeline-row' + (isArchived(r) ? ' is-archived' : '')}
          @click=${(e) => this._onRowClick(r, e)}>
        <td>
          <button class=${this._scoreClass(r.score) + ' fit-pill--button'}
            title="Tap to see the breakdown" @click=${(e) => { e.stopPropagation(); this._openFitModal(r); }}>
            ${r.score == null ? '—' : r.score}
          </button>
        </td>
        <td class="status-cell" @click=${(e) => e.stopPropagation()}>
          <select class="status-select ${r._saving ? 'is-saving' : ''}"
            data-status=${r.status || 'New'}
            ?disabled=${r._saving}
            .value=${r.status || ''} @change=${(e) => this._changeStatus(r, e.target.value)}>
            ${STATUS_OPTIONS.map(s => html`<option value=${s} ?selected=${(r.status || '') === s}>${s || '—'}</option>`)}
          </select>
          ${r._error ? html`<span class="status-cell__err" title=${r._error}>!</span>` : nothing}
        </td>
        <td class="role-cell">
          <div class="role-cell__inner">
            ${this._renderLogo(r, 'sm')}
            <div>
              <div class="role-cell__title">${r.title || '(untitled)'}</div>
              <div class="role-cell__company">${r.company || ''}</div>
            </div>
          </div>
        </td>
        <td>${this._renderSectorCell(r)}</td>
        <td>${this._renderMenuCell(r)}</td>
      </tr>
    `;
  }

  _renderLogo(r, size = 'sm') {
    const src = logoSrc(r);
    const cls = `company-logo company-logo--${size}`;
    if (!src) {
      return html`<span class=${cls + ' company-logo--placeholder'} aria-hidden="true">${logoInitial(r.company)}</span>`;
    }
    return html`
      <img class=${cls} src=${src} alt=""
           loading="lazy" decoding="async"
           @error=${(e) => {
             // Swap to placeholder when Clearbit returns 404.
             const span = document.createElement('span');
             span.className = cls + ' company-logo--placeholder';
             span.setAttribute('aria-hidden', 'true');
             span.textContent = logoInitial(r.company);
             e.target.replaceWith(span);
           }}/>
    `;
  }

  _renderSectorCell(r) {
    const tags = Array.isArray(r.sectorTags) ? r.sectorTags : [];
    if (!tags.length) {
      return r.sector ? html`<span class="muted">${r.sector}</span>` : html`<span class="muted">—</span>`;
    }
    return html`
      <ul class="tag-chips">
        ${tags.map(t => html`<li class="tag-chip">${t.name}</li>`)}
      </ul>
    `;
  }

  _renderSkeletonRow() {
    return html`
      <tr class="skeleton-row">
        <td><span class="skeleton skeleton--pill" style="width:40px;height:24px;"></span></td>
        <td><span class="skeleton skeleton--pill" style="width:120px;height:32px;"></span></td>
        <td>
          <span class="skeleton" style="width:80%;height:14px;display:block;margin-bottom:6px;"></span>
          <span class="skeleton" style="width:50%;height:11px;display:block;"></span>
        </td>
        <td><span class="skeleton" style="width:80px;height:16px;"></span></td>
        <td><span class="skeleton" style="width:32px;height:32px;border-radius:var(--radius-pill);"></span></td>
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
    const archivedCount = this.roles.filter(r => isVisibleRole(r) && isArchived(r)).length;
    return html`
      <job-recommendations></job-recommendations>

      ${this.livenessResult && !this.livenessResultDismissed ? html`
        <div class="liveness-banner ${this.livenessResult.closed.length ? 'liveness-banner--closed' : 'liveness-banner--clean'}" role="status">
          <div>
            ${this.livenessResult.closed.length
              ? html`
                <strong>${this.livenessResult.closed.length} of ${this.livenessResult.checked} ${this.livenessResult.checked === 1 ? 'role was' : 'roles were'} closed.</strong>
                Archived and moved to Closed. <span class="muted">Pipeline updated.</span>
              `
              : html`
                <strong>✓ All ${this.livenessResult.checked} ${this.livenessResult.checked === 1 ? 'role is' : 'roles are'} still live.</strong>
                <span class="muted">Last checked just now.</span>
              `}
          </div>
          <button class="row-menu__trigger" aria-label="Dismiss"
                  @click=${() => { this.livenessResultDismissed = true; }}>×</button>
        </div>
      ` : nothing}

      ${!this.bannerDismissed && this.closedSinceLastVisit.length ? html`
        <div class="closed-banner" role="status">
          <div>
            <strong>${this.closedSinceLastVisit.length}
            ${this.closedSinceLastVisit.length === 1 ? 'role was' : 'roles were'} closed since your last visit.</strong>
            They've been moved to Closed and archived.
            <span class="muted">${this.closedSinceLastVisit.slice(0, 4).map(r => r.company).join(', ')}${this.closedSinceLastVisit.length > 4 ? '…' : ''}</span>
          </div>
          <button class="row-menu__trigger" aria-label="Dismiss"
                  @click=${() => { this.bannerDismissed = true; }}>×</button>
        </div>
      ` : nothing}

      <div class="pipeline-meta">
        <strong>${rows.length}</strong> roles, sorted by ${this.sortKey} ${this.sortDir === 'asc' ? '↑' : '↓'}.
        <label class="pipeline-meta__filter">
          <span class="muted">View:</span>
          <select class="status-select" style="min-width:120px;"
                  .value=${this.archivedView}
                  @change=${(e) => { this.archivedView = e.target.value; }}>
            <option value="active"   ?selected=${this.archivedView==='active'}>Active</option>
            <option value="all"      ?selected=${this.archivedView==='all'}>All (incl. archived)</option>
            <option value="archived" ?selected=${this.archivedView==='archived'}>Archived only</option>
          </select>
        </label>
        <button class="btn btn--sm" ?disabled=${this.livenessChecking}
                @click=${() => this._onCheckLiveness()}>
          ${this.livenessChecking ? 'Checking…' : 'Check liveness'}
        </button>
        <button class="btn btn--sm btn--accent"
                @click=${() => { this.pasteOpen = !this.pasteOpen; this.pasteError = ''; }}>
          ${this.pasteOpen ? 'Cancel' : '＋ Add a role'}
        </button>
      </div>

      ${this.pasteOpen ? html`
        <form class="paste-row" @submit=${(e) => this._onPasteSubmit(e)}>
          <input type="url" required placeholder="Paste a job posting URL"
                 .value=${this.pasteUrl}
                 @input=${(e) => { this.pasteUrl = e.target.value; }}>
          <button type="submit" class="btn btn--sm btn--primary" ?disabled=${this.pasteSaving || !this.pasteUrl}>
            ${this.pasteSaving ? 'Adding…' : 'Add'}
          </button>
          ${this.pasteError ? html`<span class="muted" style="color:var(--error);font-size:var(--font-size-small);">${this.pasteError}</span>` : nothing}
        </form>
      ` : nothing}
      <div class="pipeline-table-wrap">
        <table class="pipeline-table">
          <thead>${this._renderHeader()}</thead>
          <tbody>${rows.map(r => this._renderRow(r))}</tbody>
        </table>
      </div>

      <div class="pipeline-foot">
        ${archivedCount > 0 ? html`
          <button class="btn btn--sm" @click=${() => {
            this.archivedView = this.archivedView === 'active' ? 'all' : 'active';
          }}>
            ${this.archivedView === 'active'
              ? `Show archived (${archivedCount})`
              : 'Hide archived'}
          </button>
        ` : html`<span class="muted">No archived roles yet.</span>`}
      </div>

      ${this._renderFitModal()}
    `;
  }
}

customElements.define('job-pipeline', JobPipeline);
