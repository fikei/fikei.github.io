// job-pipeline — pipeline table view. Reads from jobs-pipe and renders
// rows. Each column header is a sort toggle (3-state: none → asc → desc).
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const { fetchPipeline, updateRole, setArchived, deleteRole, stashRolePrefill, checkLiveness, addRole } = await import('../pipeline.js' + V);
const { logoSrc, logoInitial } = await import('../logo.js' + V);
// Mount the recommendations widget. It self-loads when the user is signed in.
import('./job-recommendations.js' + V);

// Status taxonomy (3-value). Bucket name → status name:
//   leads  → 'Saved'
//   active → 'Active'  (with sub-stage: drafting/applied/interviewing/offer)
//   archive→ 'Archive' (with exit_reason)
const STATUS_OPTIONS = ['Saved', 'Active', 'Archive'];

const STAGES = [
  { id: 'drafting',     label: 'Drafting' },
  { id: 'applied',      label: 'Applied' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer',        label: 'Offer' },
];

// Softer-language exit reasons. Order = "didn't apply" → "applied but
// didn't progress" → "circumstance" so the user sees the natural
// branching down the funnel.
const EXIT_REASONS = [
  { id: 'changed_mind',             label: "Read the JD again and changed my mind" },
  { id: 'wrong_comp',               label: "Comp wasn't what I'm looking for" },
  { id: 'wrong_sector_or_stage',    label: "Sector or stage felt off" },
  { id: 'wrong_location',           label: "Location or remote situation didn't work" },
  { id: 'applied_no_response',      label: "I applied but didn't hear back" },
  { id: 'rejected_after_screen',    label: "Didn't move forward after a screen" },
  { id: 'rejected_after_interview', label: "Didn't move forward after interviews" },
  { id: 'role_closed',              label: "Role was filled or closed before I applied" },
  { id: 'withdrew',                 label: "I stepped away mid-process" },
  { id: 'other',                    label: "Something else" },
];

function bucketFor(r) {
  switch (r.status) {
    case 'Active':  return 'active';
    case 'Archive': return 'archive';
    default:        return 'leads';
  }
}

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
const COLUMNS = [
  { id: 'fit',    label: 'Fit',    sortKey: 'score',   type: 'num',  defaultDir: 'desc' },
  { id: 'status', label: 'Status', sortKey: 'status',  type: 'text' },
  { id: 'role',   label: 'Role',   sortKey: 'title',   type: 'text' },
  { id: 'sector', label: 'Sector', sortKey: 'sector',  type: 'text' },
  { id: 'menu',   label: '',       sortKey: null },
];

// Manual ordering — user can drag rows in the Saved (leads) bucket. Order
// persists in localStorage as a per-bucket array of slugs. Any column sort
// overrides it; a "Use custom order" button restores it.
const MANUAL_ORDER_KEY = 'job:jobs:manualOrder';
function loadManualOrders() {
  try {
    const raw = localStorage.getItem(MANUAL_ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      leads:   Array.isArray(parsed.leads)   ? parsed.leads   : [],
      active:  Array.isArray(parsed.active)  ? parsed.active  : [],
      archive: Array.isArray(parsed.archive) ? parsed.archive : [],
    };
  } catch { return { leads: [], active: [], archive: [] }; }
}
function saveManualOrders(orders) {
  try { localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(orders)); } catch {}
}

// Drop rows without an apply link, and any Strava postings (out of scope).
function isVisibleRole(r) {
  if (!r.url) return false;
  const company = (r.company || '').toLowerCase();
  if (company === 'strava') return false;
  if (/(^|\.)strava\.com\b/i.test(r.url)) return false;
  return true;
}

function isArchived(r) { return !!r.archivedAt; }
function bucketFilter(r, bucket) {
  return bucketFor(r) === bucket;
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
    bucket: { state: true },         // 'leads' | 'active' | 'archive'
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
    // Active sub-stage tab filter. null = "All".
    activeStageFilter: { state: true },
    // Archive-flow modal state.
    archivingRow:    { state: true },
    archiveReason:   { state: true },
    archiveContext:  { state: true },
    archiveSaving:   { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.roles = [];
    this._manualOrders = loadManualOrders();
    this._dragSlug = null;
    this._dragOverSlug = null;
    this.selectedRow = null;
    const params = new URLSearchParams(location.search);
    const b = params.get('bucket');
    this.bucket = (b === 'leads' || b === 'active' || b === 'archive') ? b : 'leads';
    // Default to manual order in Saved if the user has dragged something
    // before; otherwise fall back to fit-score.
    if (this.bucket === 'leads' && this._manualOrders.leads.length) {
      this.sortKey = 'manual';
      this.sortDir = 'asc';
    } else {
      this.sortKey = 'score';
      this.sortDir = 'desc';
    }
    if (b !== this.bucket) {
      // Normalise URL so subnav highlight matches.
      const qs = new URLSearchParams(location.search);
      qs.set('bucket', this.bucket);
      history.replaceState(null, '', `${location.pathname}?${qs}`);
    }
    document.dispatchEvent(new CustomEvent('job:jobs:bucket', { detail: { bucket: this.bucket } }));
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
    const stageQ = params.get('stage');
    this.activeStageFilter = STAGES.some(s => s.id === stageQ) ? stageQ : null;
    this.archivingRow = null;
    this.archiveReason = null;
    this.archiveContext = '';
    this.archiveSaving = false;
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
    this._onPopState = () => {
      const b = new URLSearchParams(location.search).get('bucket') || 'leads';
      if (b !== this.bucket) {
        this.bucket = b;
        document.dispatchEvent(new CustomEvent('job:jobs:bucket', { detail: { bucket: b } }));
      }
    };
    window.addEventListener('popstate', this._onPopState);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('click', this._onDocClick);
    document.removeEventListener('job:pipeline:refresh', this._onRefresh);
    window.removeEventListener('popstate', this._onPopState);
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
    const arr = this.roles.filter(r => {
      if (!isVisibleRole(r) || !bucketFilter(r, this.bucket)) return false;
      // Active sub-tab filter: when set, only rows whose stage matches.
      if (this.bucket === 'active' && this.activeStageFilter) {
        return (r.stage || null) === this.activeStageFilter;
      }
      return true;
    });
    if (key === 'manual') {
      const order = this._manualOrders[this.bucket] || [];
      const idx = new Map(order.map((slug, i) => [slug, i]));
      arr.sort((a, b) => {
        const ai = idx.has(a.slug) ? idx.get(a.slug) : Infinity;
        const bi = idx.has(b.slug) ? idx.get(b.slug) : Infinity;
        if (ai !== bi) return ai - bi;
        // New (unordered) rows fall to the bottom, broken by fit desc.
        const av = a.score, bv = b.score;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
      return arr;
    }
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

  async _applyPatch(r, patch) {
    // Optimistic write — mutate local + UI, roll back on error.
    const prev = { status: r.status, stage: r.stage, exitReason: r.exitReason, exitContext: r.exitContext };
    if ('status' in patch)       r.status = patch.status;
    if ('stage' in patch)        r.stage = patch.stage;
    if ('exit_reason' in patch)  r.exitReason = patch.exit_reason;
    if ('exit_context' in patch) r.exitContext = patch.exit_context;
    // Auto-promote mirror (server does the canonical version).
    if (patch.stage) r.status = 'Active';
    r._saving = true;
    this.requestUpdate();
    try {
      const resp = await updateRole({ slug: r.slug }, patch);
      // Reflect server's canonical state.
      r.status      = resp.status      ?? r.status;
      r.stage       = resp.stage       ?? null;
      r.exitReason  = resp.exit_reason ?? null;
      r._saving = false;
      r._error = '';
      document.dispatchEvent(new CustomEvent('job:pipeline:refresh', { detail: { slug: r.slug } }));
    } catch (e) {
      r.status      = prev.status;
      r.stage       = prev.stage;
      r.exitReason  = prev.exitReason;
      r.exitContext = prev.exitContext;
      r._saving = false;
      r._error = String(e);
    }
    this.requestUpdate();
  }

  // Status-only change (used by 3-button status group on Active rows).
  async _changeStatus(r, status) {
    if (status === r.status) return;
    if (status === 'Archive') return this._openArchiveModal(r);
    // Saved or Active — clear stage when leaving Active, otherwise keep it.
    const patch = { status, stage: status === 'Active' ? r.stage : null };
    if (status !== 'Archive') patch.exit_reason = null;
    await this._applyPatch(r, patch);
  }

  _detailHref(r) { return `/job/jobs/${r.slug}/`; }

  _toggleMenu(slug, e) {
    e.stopPropagation();
    this.openMenuSlug = this.openMenuSlug === slug ? null : slug;
  }

  _switchBucket(bucket, e) {
    e.preventDefault();
    if (bucket === this.bucket) return;
    this.bucket = bucket;
    // Clear stage filter when leaving Active; it's a no-op elsewhere.
    if (bucket !== 'active') {
      this.activeStageFilter = null;
      const qs = new URLSearchParams(location.search);
      qs.delete('stage');
      history.replaceState(null, '', `${location.pathname}?${qs}`);
    }
    // On Saved, prefer manual order if the user has one; otherwise reset to
    // fit-desc. The other buckets always default to fit-desc.
    if (bucket === 'leads' && this._manualOrders.leads.length) {
      this.sortKey = 'manual';
      this.sortDir = 'asc';
    } else {
      this.sortKey = 'score';
      this.sortDir = 'desc';
    }
    const qs = new URLSearchParams(location.search);
    qs.set('bucket', bucket);
    history.pushState(null, '', `${location.pathname}?${qs}`);
    document.dispatchEvent(new CustomEvent('job:jobs:bucket', { detail: { bucket } }));
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

  // --- Drag-to-reorder (Saved bucket only) -----------------------------
  _canReorder() { return this.bucket === 'leads'; }

  _onDragStart(r, e) {
    if (!this._canReorder()) return;
    this._dragSlug = r.slug;
    try {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', r.slug);
    } catch {}
  }
  _onDragOver(r, e) {
    if (!this._canReorder() || !this._dragSlug) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this._dragOverSlug !== r.slug) {
      this._dragOverSlug = r.slug;
      this.requestUpdate();
    }
  }
  _onDragLeave(r) {
    if (this._dragOverSlug === r.slug) {
      this._dragOverSlug = null;
      this.requestUpdate();
    }
  }
  _onDragEnd() {
    this._dragSlug = null;
    this._dragOverSlug = null;
    this.requestUpdate();
  }
  _onDrop(r, e) {
    if (!this._canReorder()) return;
    e.preventDefault();
    e.stopPropagation();
    const from = this._dragSlug;
    this._dragSlug = null;
    this._dragOverSlug = null;
    if (!from || from === r.slug) { this.requestUpdate(); return; }

    // Compute new order from the currently displayed sequence so the move
    // is visually exact, regardless of which sort was active.
    const displayed = this._sorted().map(x => x.slug);
    const fromIdx = displayed.indexOf(from);
    const toIdx = displayed.indexOf(r.slug);
    if (fromIdx < 0 || toIdx < 0) { this.requestUpdate(); return; }
    displayed.splice(fromIdx, 1);
    displayed.splice(toIdx, 0, from);

    this._manualOrders = { ...this._manualOrders, [this.bucket]: displayed };
    saveManualOrders(this._manualOrders);
    this.sortKey = 'manual';
    this.sortDir = 'asc';
    this.requestUpdate();
  }

  _useCustomOrder() {
    // Seed with the current visible order so the user's new manual order
    // starts where they were looking (typically fit-desc).
    const displayed = this._sorted().map(x => x.slug);
    this._manualOrders = { ...this._manualOrders, [this.bucket]: displayed };
    saveManualOrders(this._manualOrders);
    this.sortKey = 'manual';
    this.sortDir = 'asc';
  }

  _renderMenuCell(r) {
    const menuOpen = this.openMenuSlug === r.slug;
    const cur = r.status || 'Saved';
    const curStage = r.stage || null;
    return html`
      <div class="row-menu">
        <button class="row-menu__trigger" aria-label="Row actions"
                aria-expanded=${menuOpen ? 'true' : 'false'}
                @click=${(e) => this._toggleMenu(r.slug, e)}>⋮</button>
        ${menuOpen ? html`
          <div class="row-menu__panel row-menu__panel--wide" role="menu" @click=${(e) => e.stopPropagation()}>
            <div class="row-menu__group-label">Move to</div>
            ${STATUS_OPTIONS.map(s => html`
              <button role="menuitem"
                      class=${'row-menu__item row-menu__item--status' + (cur === s ? ' is-current' : '')}
                      @click=${() => this._changeStatusFromMenu(r, s)}>
                <span class="row-menu__check" aria-hidden="true">${cur === s ? '✓' : ''}</span>
                <span>${s}</span>
              </button>
            `)}
            ${cur === 'Active' ? html`
              <div class="row-menu__divider" role="separator"></div>
              <div class="row-menu__group-label">Active stage</div>
              ${STAGES.map(s => html`
                <button role="menuitem"
                        class=${'row-menu__item row-menu__item--stage' + (curStage === s.id ? ' is-current' : '')}
                        @click=${() => this._setStageFromMenu(r, s.id)}>
                  <span class="row-menu__check" aria-hidden="true">${curStage === s.id ? '✓' : ''}</span>
                  <span>${s.label}</span>
                </button>
              `)}
            ` : nothing}
            <div class="row-menu__divider" role="separator"></div>
            <button role="menuitem" class="row-menu__item row-menu__item--danger" @click=${() => this._onDelete(r)}>
              Delete…
            </button>
          </div>
        ` : nothing}
      </div>
    `;
  }

  async _changeStatusFromMenu(r, status) {
    this.openMenuSlug = null;
    await this._changeStatus(r, status);
  }

  // Selecting a stage from the menu auto-promotes status to Active on
  // a Saved row (mirror of server-side rule). Re-selecting the same
  // stage clears it.
  async _setStageFromMenu(r, stage) {
    this.openMenuSlug = null;
    const next = r.stage === stage ? null : stage;
    await this._applyPatch(r, { stage: next, status: 'Active' });
  }

  _openArchiveModal(r) {
    this.openMenuSlug = null;
    this.archivingRow = r;
    this.archiveReason = null;
    this.archiveContext = '';
    this.archiveSaving = false;
  }

  _closeArchiveModal() {
    this.archivingRow = null;
    this.archiveReason = null;
    this.archiveContext = '';
    this.archiveSaving = false;
  }

  async _submitArchive() {
    const r = this.archivingRow;
    if (!r || !this.archiveReason) return;
    this.archiveSaving = true;
    this.requestUpdate();
    try {
      await this._applyPatch(r, {
        status: 'Archive',
        stage: null,
        exit_reason: this.archiveReason,
        exit_context: this.archiveContext.trim() || null,
      });
      this._closeArchiveModal();
    } catch {
      // _applyPatch already surfaces the error on the row; just stop the spinner.
      this.archiveSaving = false;
    }
  }

  _renderArchiveModal() {
    if (!this.archivingRow) return nothing;
    const r = this.archivingRow;
    return html`
      <div class="archive-modal-scrim" @click=${() => this._closeArchiveModal()}></div>
      <div class="archive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-modal-title">
        <header class="archive-modal__head">
          <h2 id="archive-modal-title">Why are you archiving this role?</h2>
          <p class="muted">No judgment — this helps tune your future recommendations.</p>
        </header>
        <ul class="archive-modal__reasons">
          ${EXIT_REASONS.map(opt => html`
            <li>
              <label class=${'archive-modal__reason' + (this.archiveReason === opt.id ? ' is-selected' : '')}>
                <input type="radio" name="archive-reason" value=${opt.id}
                       ?checked=${this.archiveReason === opt.id}
                       @change=${() => { this.archiveReason = opt.id; }}>
                <span>${opt.label}</span>
              </label>
            </li>
          `)}
        </ul>
        <label class="archive-modal__context">
          <span class="muted">Optional note (what specifically?)</span>
          <input type="text" maxlength="200" placeholder="Optional — one line"
                 .value=${this.archiveContext}
                 @input=${(e) => { this.archiveContext = e.target.value; }}>
        </label>
        <footer class="archive-modal__foot">
          <button class="btn btn--sm" @click=${() => this._closeArchiveModal()}>Cancel</button>
          <button class="btn btn--sm btn--accent"
                  ?disabled=${!this.archiveReason || this.archiveSaving}
                  @click=${() => this._submitArchive()}>
            ${this.archiveSaving ? 'Archiving…' : 'Archive role'}
          </button>
        </footer>
        <p class="archive-modal__caption muted">${r.title || ''} · ${r.company || ''}</p>
      </div>
    `;
  }

  _setStageFilter(stage, e) {
    e?.preventDefault?.();
    this.activeStageFilter = stage;
    const qs = new URLSearchParams(location.search);
    if (stage) qs.set('stage', stage);
    else qs.delete('stage');
    history.pushState(null, '', `${location.pathname}?${qs}`);
  }

  _renderActiveStageTabs(rows) {
    // Count Active rows per stage (including 'unset' bucket). Counts are
    // taken from this.roles (full set), not the filtered rows, so the
    // tabs always show totals even when one is active.
    const allActive = this.roles.filter(r => isVisibleRole(r) && bucketFor(r) === 'active');
    const counts = { all: allActive.length };
    for (const s of STAGES) counts[s.id] = allActive.filter(r => (r.stage || null) === s.id).length;
    const cur = this.activeStageFilter;
    void rows;
    return html`
      <nav class="stage-tabs" aria-label="Active stage filter">
        <button class=${'stage-tabs__tab' + (cur === null ? ' is-active' : '')}
                @click=${(e) => this._setStageFilter(null, e)}>
          All <span class="stage-tabs__count">${counts.all}</span>
        </button>
        ${STAGES.map(s => html`
          <button class=${'stage-tabs__tab' + (cur === s.id ? ' is-active' : '')}
                  @click=${(e) => this._setStageFilter(s.id, e)}>
            ${s.label} <span class="stage-tabs__count">${counts[s.id]}</span>
          </button>
        `)}
      </nav>
    `;
  }

  _renderStatusCell(r) {
    const s = r.status || 'Saved';
    const cls = 'status-pill status-pill--' + s.toLowerCase();
    const stageObj = r.stage ? STAGES.find(x => x.id === r.stage) : null;
    const exitObj = r.exitReason ? EXIT_REASONS.find(x => x.id === r.exitReason) : null;
    return html`
      <span class=${cls + (r._saving ? ' is-saving' : '')}>${s}</span>
      ${stageObj ? html`<span class="stage-chip" title="Sub-stage">${stageObj.label}</span>` : nothing}
      ${exitObj ? html`<span class="exit-chip" title=${exitObj.label}>${exitObj.label}</span>` : nothing}
      ${r._error ? html`<span class="status-cell__err" title=${r._error}>!</span>` : nothing}
    `;
  }

  _visibleColumns() {
    // Status column is meaningless on Leads (it's always New/empty there).
    return COLUMNS.filter(c => !(c.id === 'status' && this.bucket === 'leads'));
  }

  _renderHeader() {
    return html`
      <tr>
        ${this._visibleColumns().map(c => {
          const cls = `col col-${c.id}`;
          if (!c.sortKey) return html`<th class=${cls}>${c.label}</th>`;
          const active = this.sortKey === c.sortKey;
          const arrow = active ? (this.sortDir === 'asc' ? '↑' : '↓') : '↕';
          return html`
            <th class=${cls}>
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
    const showStatus = this.bucket !== 'leads';
    const reorder = this._canReorder();
    const cls = 'pipeline-row'
      + (r.status === 'Archive' ? ' is-archived' : '')
      + (reorder ? ' is-reorderable' : '')
      + (reorder && this._dragSlug === r.slug ? ' is-dragging' : '')
      + (reorder && this._dragOverSlug === r.slug && this._dragSlug && this._dragSlug !== r.slug ? ' is-drop-target' : '');
    return html`
      <tr class=${cls}
          draggable=${reorder ? 'true' : 'false'}
          @dragstart=${(e) => this._onDragStart(r, e)}
          @dragover=${(e) => this._onDragOver(r, e)}
          @dragleave=${() => this._onDragLeave(r)}
          @drop=${(e) => this._onDrop(r, e)}
          @dragend=${() => this._onDragEnd()}
          @click=${(e) => this._onRowClick(r, e)}>
        <td class="col col-fit" data-label="Fit">
          <button class=${this._scoreClass(r.score) + ' fit-pill--button'}
            title="Tap to see the breakdown" @click=${(e) => { e.stopPropagation(); this._openFitModal(r); }}>
            ${r.score == null ? '—' : r.score}
          </button>
        </td>
        ${showStatus ? html`<td class="col col-status status-cell" data-label="Status">${this._renderStatusCell(r)}</td>` : nothing}
        <td class="col col-role role-cell" data-label="Role">
          <div class="role-cell__inner">
            ${this._renderLogo(r, 'sm')}
            <div class="role-cell__text">
              <div class="role-cell__title">
                ${r.title || '(untitled)'}
                ${this.bucket === 'leads' && r.engagedAt
                  ? html`<span class="in-progress-pill" title="You've viewed or applied to this role">In progress</span>`
                  : nothing}
              </div>
              <div class="role-cell__company">${r.company || ''}</div>
            </div>
          </div>
        </td>
        <td class="col col-sector" data-label="Sector">${this._renderSectorCell(r)}</td>
        <td class="col col-menu">${this._renderMenuCell(r)}</td>
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
    const showStatus = this.bucket !== 'leads';
    return html`
      <tr class="skeleton-row">
        <td class="col col-fit"><span class="skeleton skeleton--pill" style="width:40px;height:24px;"></span></td>
        ${showStatus ? html`<td class="col col-status"><span class="skeleton skeleton--pill" style="width:120px;height:32px;"></span></td>` : nothing}
        <td class="col col-role">
          <span class="skeleton" style="width:80%;height:14px;display:block;margin-bottom:6px;"></span>
          <span class="skeleton" style="width:50%;height:11px;display:block;"></span>
        </td>
        <td class="col col-sector"><span class="skeleton" style="width:80px;height:16px;"></span></td>
        <td class="col col-menu"><span class="skeleton" style="width:32px;height:32px;border-radius:var(--radius-pill);"></span></td>
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
    const bucketLabel = { leads: 'Saved', active: 'Active', archive: 'Archive' }[this.bucket];
    return html`
      ${this.bucket === 'leads' ? html`<job-recommendations></job-recommendations>` : nothing}

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
        <strong>${rows.length}</strong> ${bucketLabel.toLowerCase()} ${rows.length === 1 ? 'role' : 'roles'},
        ${this.sortKey === 'manual'
          ? html`in your custom order. <span class="muted">Drag rows to rearrange.</span>`
          : html`sorted by ${this.sortKey} ${this.sortDir === 'asc' ? '↑' : '↓'}.`}
        ${this.bucket === 'leads' && this.sortKey !== 'manual' && this._manualOrders.leads.length ? html`
          <button class="btn btn--sm" @click=${() => this._useCustomOrder()}>Use my order</button>
        ` : nothing}
        ${this.bucket === 'leads' && this.sortKey !== 'manual' && !this._manualOrders.leads.length ? html`
          <button class="btn btn--sm" @click=${() => this._useCustomOrder()}>Arrange manually</button>
        ` : nothing}
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
      ${this.bucket === 'active' ? this._renderActiveStageTabs(rows) : nothing}
      <div class="pipeline-table-wrap">
        <table class="pipeline-table">
          <thead>${this._renderHeader()}</thead>
          <tbody>${rows.map(r => this._renderRow(r))}</tbody>
        </table>
      </div>
      ${this._renderArchiveModal()}

      ${rows.length === 0 ? html`
        <div class="placeholder" style="margin-top:var(--space-4);">
          <h2>No ${bucketLabel.toLowerCase()} ${rows.length === 1 ? 'role' : 'roles'} yet</h2>
          <p>${this.bucket === 'leads' ? 'Add a posting or wait for the crawler to find a fit.'
              : this.bucket === 'active' ? 'Pick a stage on a Saved role via the row menu — it moves here automatically.'
              : 'Archived roles land here, with the reason you gave.'}</p>
        </div>
      ` : nothing}

      ${this._renderFitModal()}
    `;
  }
}

customElements.define('job-pipeline', JobPipeline);
