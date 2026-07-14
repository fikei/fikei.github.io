// job-pipeline — pipeline table view. Reads from jobs-pipe and renders
// rows. Each column header is a sort toggle (3-state: none → asc → desc).
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const { fetchPipeline, updateRole, setArchived, deleteRole, stashRolePrefill, checkLiveness, addRole, refreshSources,
        STAGES, STAGE_IDS, BUCKETS, BUCKET_LABELS, bucketFor, normalizeBucket, isVisibleRole, applyEaseInfo,
        classifyApplyEaseForSlug } = await import('../pipeline.js' + V);
const { logoSrc, logoInitial } = await import('../logo.js' + V);
const { renderScoreModal, renderScorePair, scoreClass: sharedScoreClass } = await import('./ladder-fit-modal.js' + V);
const { loadUpdates, updateKindMeta, roleMatchedEvents } = await import('../applicationEvents.js' + V);
const { renderLocation } = await import('../format.js' + V);

// Bucket taxonomy (STAGES / BUCKETS / BUCKET_LABELS / bucketFor / isVisibleRole)
// is imported from ../pipeline.js — the single source of truth shared with the
// rail and mobile home. The six buckets are Saved · Drafting · Applied ·
// Interviewing · Offer · Archive, derived from status (Saved/Active/Archive) +
// stage. The "Move to" menu offers all six flat; picking a stage promotes the
// row to Active with that stage, Saved clears the stage, Archive opens the
// exit-reason modal.

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
  { id: 'rejected_no_interview',    label: "Rejected without an interview" },
  { id: 'role_closed',              label: "Role was filled or closed before I applied" },
  { id: 'withdrew',                 label: "I stepped away mid-process" },
  { id: 'other',                    label: "Something else" },
];

// Easy Apply chip icons — same line-icon style as the Updates queue set.
const EASE_SVG_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const EASE_ICONS = {
  easy:         `<svg ${EASE_SVG_ATTRS}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>`,
  short_answer: `<svg ${EASE_SVG_ATTRS}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  essay:        `<svg ${EASE_SVG_ATTRS}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>`,
  special:      `<svg ${EASE_SVG_ATTRS}><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>`,
  portal:       `<svg ${EASE_SVG_ATTRS}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
};

// Fit modal labels + render helper live in ./ladder-fit-modal.js so the
// recommendations carousel can reuse the same tooltip.

// Each column entry: { id, label, sortKey | null, type: 'num'|'text'|'bool' }.
// sortKey null → header isn't clickable.
const COLUMNS = [
  { id: 'fit',      label: 'Fit',      sortKey: 'score',          type: 'num', defaultDir: 'desc' },
  { id: 'strength', label: 'Strength', sortKey: 'candidateScore',  type: 'num', defaultDir: 'desc' },
  { id: 'role',   label: 'Role',   sortKey: 'title',   type: 'text' },
  { id: 'signal', label: '',       sortKey: null },
  { id: 'connections', label: 'Network', sortKey: 'connections', type: 'num', defaultDir: 'desc' },
  { id: 'sector', label: 'Sector', sortKey: 'sector',  type: 'text' },
  { id: 'status', label: 'Status', sortKey: 'status',  type: 'text' },
  { id: 'menu',   label: '',       sortKey: null },
];

// Manual ordering — user can drag rows within a bucket. Order persists in
// localStorage as a per-bucket array of slugs (one key per bucket). Any column
// sort overrides it; a "Use custom order" button restores it.
const MANUAL_ORDER_KEY = 'job:jobs:manualOrder';
function loadManualOrders() {
  const empty = () => Object.fromEntries(BUCKETS.map(b => [b, []]));
  try {
    const raw = localStorage.getItem(MANUAL_ORDER_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const out = empty();
    for (const b of BUCKETS) if (Array.isArray(parsed[b])) out[b] = parsed[b];
    // Legacy migration: the old 3-bucket shape stored 'leads' (→ saved). The
    // old 'active' order spanned all stages, so it can't be split cleanly —
    // drop it and let each stage page re-establish its own order.
    if (Array.isArray(parsed.leads) && !out.saved.length) out.saved = parsed.leads;
    return out;
  } catch { return empty(); }
}
function saveManualOrders(orders) {
  try { localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(orders)); } catch {}
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
    selectedRow:          { state: true },
    selectedScoreWhich:   { state: true },
    bucket: { state: true },         // saved | drafting | applied | interviewing | offer | archive
    openMenuSlug: { state: true },
    livenessChecking: { state: true },
    livenessResult: { state: true },
    livenessResultDismissed: { state: true },
    pasteOpen: { state: true },
    pasteUrl: { state: true },
    pasteSaving: { state: true },
    pasteError: { state: true },
    // "N new jobs added" banner. Accumulates entries dispatched via
    // job:pipeline:added until the user dismisses it.
    addedBanner: { state: true },
    // Archive-flow modal state.
    archivingRow:    { state: true },
    archiveReason:   { state: true },
    archiveContext:  { state: true },
    archiveSaving:   { state: true },
    // Table Signal chips — one item per role from the updates feed +
    // calendar. The Updates queue itself is <ladder-updates> on the Inbox.
    roleSignals:     { state: true },
    // Hover-card state for the Network column: { conns, x, y } | null.
    hoverConns:      { state: true },
    // Hover-card state for the ease chip: { info, x, y } | null.
    hoverEase:       { state: true },
    // "⚡ Easy apply" quick filter (Saved + Drafting). Mirrored in ?ease=easy.
    easeFilter:      { state: true },
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
    this.hoverConns = null;
    this.hoverEase = null;
    const params = new URLSearchParams(location.search);
    const b = params.get('bucket');
    const stageQ = params.get('stage');
    // Six buckets now (Saved · 4 stages · Archive). Normalize legacy names:
    // leads→saved, active→drafting, and the old ?bucket=active&stage=<X> form
    // collapses to the <X> stage page.
    let resolved = normalizeBucket(b);
    if (b === 'active' && STAGE_IDS.includes(stageQ)) resolved = stageQ;
    this.bucket = resolved || 'saved';
    this.easeFilter = params.get('ease') === 'easy';
    // Default to fit-score (desc) on every bucket, including Saved. A saved
    // manual drag order is still one click away via "Use my order".
    this.sortKey = 'score';
    this.sortDir = 'desc';
    if (b !== this.bucket || stageQ != null) {
      // Normalise URL so nav highlight matches and the legacy stage param drops.
      const qs = new URLSearchParams(location.search);
      qs.set('bucket', this.bucket);
      qs.delete('stage');
      history.replaceState(null, '', `${location.pathname}?${qs}`);
    }
    document.dispatchEvent(new CustomEvent('job:jobs:bucket', { detail: { bucket: this.bucket } }));
    this.openMenuSlug = null;
    this.livenessChecking = false;
    this.livenessResult = null;            // { checked, closed: [slug…] }
    this.livenessResultDismissed = false;
    this.pasteOpen = false;
    this.pasteUrl = '';
    this.pasteSaving = false;
    this.pasteError = '';
    this.addedBanner = { roles: [], dismissed: false };
    this.archivingRow = null;
    this.archiveReason = null;
    this.archiveContext = '';
    this.archiveSaving = false;
    this.roleSignals = new Map();
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
    // Surface added jobs (paste-URL, recs, future batch import) via a
    // dismissible banner at the top of the table. Accumulates entries
    // until the user dismisses or navigates away.
    this._onAdded = (e) => {
      const role = e.detail?.role;
      const roles = e.detail?.roles;
      const next = Array.isArray(roles) ? roles : (role ? [role] : []);
      if (!next.length) return;
      // De-dupe by slug so re-fires don't double-count.
      const existing = new Map((this.addedBanner.roles || []).map(r => [r.slug, r]));
      for (const r of next) if (r?.slug) existing.set(r.slug, r);
      this.addedBanner = { roles: Array.from(existing.values()), dismissed: false };
      // Classify the new arrivals' apply-ease in the background so the badge
      // shows up on this visit, not after the next sweep tick.
      for (const r of next) if (r?.slug) classifyApplyEaseForSlug(r.slug);
      // Confirmation info, not state — auto-dismiss; the roles are visible
      // in the list itself. Timer resets while adds keep arriving.
      clearTimeout(this._addedHideTimer);
      this._addedHideTimer = setTimeout(() => {
        this.addedBanner = { ...this.addedBanner, dismissed: true };
      }, 12000);
    };
    document.addEventListener('job:pipeline:added', this._onAdded);
    this._onPopState = () => {
      const b = normalizeBucket(new URLSearchParams(location.search).get('bucket')) || 'saved';
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
    document.removeEventListener('job:pipeline:added', this._onAdded);
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
      // Surface the new role via a banner rather than navigating away.
      // Dispatch globally so other components (recs table, future batch
      // import) feed the same banner.
      document.dispatchEvent(new CustomEvent('job:pipeline:added', {
        detail: { role: { slug: r.slug, company: r.company, title: r.title } },
      }));
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
      // Visit stamp — <ladder-updates> reads this to window closure rows.
      try { localStorage.setItem('job:jobs:lastVisitAt', new Date().toISOString()); } catch {}
      this.state = 'loaded';
      // Phase 2.0 — load signals after the table renders so the page
      // isn't blocked on Gmail/Calendar fetches. Re-render on completion.
      this._loadSignals();
      // Kick a sources refresh in the background. Server-side gates by
      // schedule_cron + last_run_at, so frequent kicks are no-ops when
      // nothing is due. Client-side throttle in refreshSources() avoids
      // tab-hop hammering.
      refreshSources({ silent: true });
      // Saved bucket: auto-check liveness of every saved role in the
      // background. Debounced via localStorage so we don't hammer ATSes
      // on every page load. Replaces the explicit "Check liveness"
      // button — list reflects whatever's still posted at the URL.
      if (this._isSaved) this._maybeAutoLiveness();
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  // 1h debounce for the Saved-bucket auto-liveness sweep. Stored as ISO
  // string in localStorage; treat parse failures as "stale, run now".
  _autoLivenessDue() {
    try {
      const last = Number(localStorage.getItem('job:lastLivenessAt') || 0);
      return Date.now() - last > 60 * 60 * 1000;
    } catch { return true; }
  }

  async _maybeAutoLiveness() {
    if (!this._autoLivenessDue()) return;
    if (this.livenessChecking) return;
    this.livenessChecking = true;
    this.livenessResult = null;
    this.livenessResultDismissed = false;
    this.requestUpdate();
    try {
      const res = await checkLiveness();
      const data = await fetchPipeline();
      this.roles = (data.roles || []).slice();
      // Only show the banner when something actually flipped to closed —
      // silent runs shouldn't pop a "✓ all live" toast on every load.
      const closed = Array.isArray(res?.closed) ? res.closed : [];
      if (closed.length) {
        this.livenessResult = { checked: res.checked || 0, closed };
        // Auto-expire — the closed roles are already reflected in the list;
        // the banner is a heads-up, not a permanent fixture.
        clearTimeout(this._livenessHideTimer);
        this._livenessHideTimer = setTimeout(() => {
          this.livenessResultDismissed = true;
          this.requestUpdate();
        }, 20000);
      }
      try { localStorage.setItem('job:lastLivenessAt', String(Date.now())); } catch {}
    } catch (e) {
      console.warn('[pipeline] auto-liveness failed:', e?.message || e);
    } finally {
      this.livenessChecking = false;
      this.requestUpdate();
    }
  }

  // Table Signal chips only — the Updates queue itself lives in
  // <ladder-updates> at the top of the Inbox. Chips mirror the same feed
  // (server updates + calendar); one item per role, priority wins.
  async _loadSignals() {
    let items = [];
    try {
      const res = await loadUpdates();
      items = res.items || [];
    } catch (e) {
      console.warn('[job-pipeline] updates load failed:', e.message);
    }
    try {
      const cal = await roleMatchedEvents({ windowHours: 48 });
      for (const m of (cal.matches || [])) {
        const hoursOut = (new Date(m.start).getTime() - Date.now()) / 3_600_000;
        if (hoursOut < 0) continue;
        items.push({
          kind: 'calendar_today', priority: 2,
          role_slug: m.role_slug, company: m.company, title: m.title,
          text: `${m.company} interview: ${m.summary || ''}`,
          received_at: m.start,
        });
      }
    } catch (e) {
      console.warn('[job-pipeline] calendar matches failed:', e.message);
    }

    const byRole = new Map();
    for (const it of items) {
      const cur = byRole.get(it.role_slug);
      if (!cur || it.priority < cur.priority) byRole.set(it.role_slug, it);
    }
    this.roleSignals = byRole;
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
    const arr = this.roles.filter(r => isVisibleRole(r) && bucketFilter(r, this.bucket)
      && (!this.easeFilter || r.applyEase === 'easy'));
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
    const valFor = (r) => key === 'connections' ? this._connScore(r) : r[key];
    arr.sort((a, b) => {
      const av = valFor(a);
      const bv = valFor(b);
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

  // Single score pill (Fit or Strength), mirroring the For You table so the
  // two views read identically. null score → em dash. Click opens the
  // breakdown modal.
  _scorePill(score, onClick, title) {
    const cls = this._scoreClass(score) + ' fit-pill--button';
    return html`
      <button class=${cls} title=${title}
              @click=${(e) => { e.stopPropagation(); onClick(); }}>
        ${score == null ? '—' : Math.round(score)}
      </button>`;
  }

  _openFitModal(r)       { this.selectedRow = r; this.selectedScoreWhich = 'fit'; }
  _openCandidateModal(r) { this.selectedRow = r; this.selectedScoreWhich = 'candidate'; }
  _closeFitModal()       { this.selectedRow = null; this.selectedScoreWhich = null; }

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

  // "Move to <bucket>" — the single flat action behind every menu option.
  // Saved / a stage / Archive all live at the same level; a stage promotes the
  // row to Active with that stage (the server mirrors the auto-promote rule),
  // Saved clears the stage, Archive opens the exit-reason modal.
  async _moveToBucket(r, bucket) {
    this.openMenuSlug = null;
    if (bucket === bucketFor(r)) return;                       // already there
    if (bucket === 'archive') return this._openArchiveModal(r);
    if (bucket === 'saved')   return this._applyPatch(r, { status: 'Saved', stage: null, exit_reason: null });
    // A stage bucket → Active + that stage.
    return this._applyPatch(r, { status: 'Active', stage: bucket, exit_reason: null });
  }

  _detailHref(r) { return `/ladder/jobs/${r.slug}/`; }

  _toggleMenu(slug, e) {
    e.stopPropagation();
    this.openMenuSlug = this.openMenuSlug === slug ? null : slug;
  }

  // Bucket-shape helpers used across render/column logic.
  get _isStageBucket() { return STAGE_IDS.includes(this.bucket); }
  get _isSaved()       { return this.bucket === 'saved'; }

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
  _canReorder() { return this._isSaved; }

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
    const cur = bucketFor(r);
    return html`
      <div class="row-menu">
        <button class="row-menu__trigger" aria-label="Row actions"
                aria-expanded=${menuOpen ? 'true' : 'false'}
                @click=${(e) => this._toggleMenu(r.slug, e)}>⋮</button>
        ${menuOpen ? html`
          <div class="row-menu__panel row-menu__panel--wide" role="menu" @click=${(e) => e.stopPropagation()}>
            <div class="row-menu__group-label">Move to</div>
            ${BUCKETS.map(b => html`
              <button role="menuitem"
                      class=${'row-menu__item row-menu__item--status' + (cur === b ? ' is-current' : '')}
                      @click=${() => this._moveToBucket(r, b)}>
                <span class="row-menu__check" aria-hidden="true">${cur === b ? '✓' : ''}</span>
                <span>${BUCKET_LABELS[b]}</span>
              </button>
            `)}
            <div class="row-menu__divider" role="separator"></div>
            <button role="menuitem" class="row-menu__item row-menu__item--danger" @click=${() => this._onDelete(r)}>
              Delete…
            </button>
          </div>
        ` : nothing}
      </div>
    `;
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

  _renderStatusCell(r) {
    const s = r.status || 'Saved';
    const bucket = bucketFor(r);
    const stageObj = STAGES.find(x => x.id === bucket);
    const exitObj = r.exitReason ? EXIT_REASONS.find(x => x.id === r.exitReason) : null;

    // On a stage page the useful information is which step the role is at, so
    // the stage is the primary pill (reusing the existing stage pill classes).
    if (stageObj) {
      const stageCls = 'status-pill status-pill--stage-' + stageObj.id;
      return html`
        <span class=${stageCls + (r._saving ? ' is-saving' : '')}>${stageObj.label}</span>
        ${r._error ? html`<span class="status-cell__err" title=${r._error}>!</span>` : nothing}
      `;
    }

    const cls = 'status-pill status-pill--' + s.toLowerCase();
    return html`
      <span class=${cls + (r._saving ? ' is-saving' : '')}>${s}</span>
      ${stageObj ? html`<span class="stage-chip" title="Sub-stage">${stageObj.label}</span>` : nothing}
      ${exitObj ? html`<span class="exit-chip" title=${exitObj.label}>${exitObj.label}</span>` : nothing}
      ${r._error ? html`<span class="status-cell__err" title=${r._error}>!</span>` : nothing}
    `;
  }

  _visibleColumns() {
    // Status column is meaningless on Leads (it's always New/empty there).
    // On the Active bucket the column shows the interview stage, so the
    // header reads "Stage" rather than "Status".
    // 'connections' (warm-intro avatars) only appears on the Saved bucket —
    // that's where Ian is deciding whether to pursue, so "who do I know
    // here?" is most actionable. It replaces the Status column there (Status
    // is meaningless on Saved anyway). On a stage page the Status column shows
    // the stage.
    return COLUMNS
      .filter(c => !(c.id === 'status' && this._isSaved))
      .filter(c => !(c.id === 'connections' && !this._isSaved))
      .map(c => (c.id === 'status' && this._isStageBucket) ? { ...c, label: 'Stage', sortKey: 'stage' } : c);
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
    // Cmd/Ctrl-click or middle-click → new tab (browser standard);
    // plain click → in-page navigation.
    stashRolePrefill(r);
    const href = this._detailHref(r);
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      window.open(href, '_blank', 'noopener');
    } else {
      window.location.assign(href);
    }
  }

  _renderRow(r) {
    const showStatus = !this._isSaved;
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
          ${this._scorePill(r.score, () => this._openFitModal(r), 'Fit score — tap for breakdown')}
        </td>
        <td class="col col-strength" data-label="Strength">
          ${this._scorePill(r.candidateScore, () => this._openCandidateModal(r), 'Candidate strength — tap for breakdown')}
        </td>
        <td class="col col-role role-cell" data-label="Role">
          <div class="role-cell__inner">
            ${this._renderLogo(r, 'sm')}
            <div class="role-cell__text">
              <div class="role-cell__title">
                <span class="role-cell__title-text">${r.title || '(untitled)'}</span>
                ${this._isSaved && r.engagedAt
                  ? html`<span class="in-progress-pill" title="You've viewed or applied to this role">In progress</span>`
                  : nothing}
                ${this._renderEaseChip(r)}
              </div>
              <div class="role-cell__company">${r.company || ''}</div>
              ${renderLocation(r.location)}
            </div>
          </div>
        </td>
        <td class="col col-signal" data-label="">${this._renderSignalCell(r)}</td>
        ${this._isSaved ? html`<td class="col col-connections" data-label="Network">${this._renderConnectionsCell(r)}</td>` : nothing}
        <td class="col col-sector" data-label="Sector">${this._renderSectorCell(r)}</td>
        ${showStatus ? html`<td class="col col-status status-cell" data-label="Status">${this._renderStatusCell(r)}</td>` : nothing}
        <td class="col col-menu">${this._renderMenuCell(r)}</td>
      </tr>
    `;
  }

  // ---- Easy Apply badge (Phase 16.1) ----
  // Chip taxonomy lives in pipeline.js (applyEaseInfo); the icon set matches
  // the Updates-queue line-icon style (no emoji, per DESIGN.md). Only Saved
  // and Drafting badge — later stages have already been applied to.
  _renderEaseChip(r) {
    if (!(this._isSaved || this.bucket === 'drafting')) return nothing;
    const info = applyEaseInfo(r);
    if (!info) return nothing;
    // When we have the actual question text, a styled hover card replaces the
    // native title (which can only show counts) and lists the prompts.
    const hasCard = Array.isArray(info.prompts) && info.prompts.length > 0;
    return html`<span class="ease-chip ease-chip--${info.tier}${info.ready ? ' ease-chip--ready' : ''}"
        title=${hasCard ? '' : info.title}
        tabindex=${hasCard ? '0' : '-1'}
        @mouseenter=${(e) => hasCard && this._showEaseTip(info, e)}
        @mouseleave=${() => this._hideEaseTip()}
        @focus=${(e) => hasCard && this._showEaseTip(info, e)}
        @blur=${() => this._hideEaseTip()}>
      <span class="ease-chip__icon" aria-hidden="true">${unsafeHTML(EASE_ICONS[info.tier] || EASE_ICONS.essay)}</span>${info.label}
    </span>`;
  }

  _showEaseTip(info, e) {
    const rect = e.currentTarget.getBoundingClientRect();
    this.hoverEase = { info, x: rect.left, y: rect.bottom + 6 };
  }
  _hideEaseTip() { this.hoverEase = null; }

  _renderEaseTip() {
    const h = this.hoverEase;
    if (!h) return nothing;
    const { info } = h;
    const m = info.meta || {};
    const bits = [];
    if (m.ats && m.ats !== 'unknown') bits.push(m.ats);
    if (typeof m.questions === 'number') bits.push(`${m.questions} question${m.questions === 1 ? '' : 's'}`);
    if (m.requires_cover_letter) bits.push('cover letter required');
    const width = 320;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, h.x));
    const top = Math.min(window.innerHeight - 20, h.y);
    const essays = info.prompts.filter(p => p.kind === 'essay');
    const shorts = info.prompts.filter(p => p.kind === 'short_answer');
    const group = (heading, items) => items.length ? html`
      <div class="ease-tip__group">
        <div class="ease-tip__head">${heading}</div>
        <ul class="ease-tip__list">${items.map(p => html`<li>${p.text}</li>`)}</ul>
      </div>` : nothing;
    return html`
      <div class="ease-tip" style=${`left:${left}px;top:${top}px;width:${width}px;`}>
        <div class="ease-tip__title">${info.label}</div>
        ${bits.length ? html`<div class="ease-tip__meta">${bits.join(' · ')}</div>` : nothing}
        ${group(essays.length === 1 ? 'Essay question' : 'Essay questions', essays)}
        ${group(shorts.length === 1 ? 'Short answer' : 'Short answers', shorts)}
      </div>`;
  }

  _toggleEaseFilter() {
    this.easeFilter = !this.easeFilter;
    const qs = new URLSearchParams(location.search);
    if (this.easeFilter) qs.set('ease', 'easy'); else qs.delete('ease');
    history.replaceState(null, '', `${location.pathname}?${qs}`);
  }

  // (The "N saved jobs are easy applies" digest row moved to
  // <ladder-updates> on the Inbox, with the rest of the Updates queue.)

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

  // Weighted "network strength" score for sorting the Network column. Direct
  // (1st-degree) contacts dominate (×100) so a lead where Ian knows someone
  // outranks one with only 2nd-degree; 2nd-degree adds 1 + its mutual count
  // as a tiebreaker. 0 when there are no connections.
  _connScore(r) {
    const conns = r.connections || [];
    let s = 0;
    for (const c of conns) s += (c.degree === '2nd' ? 1 + (c.mutuals || 0) : 100);
    return s;
  }

  // Avatar stack of Ian's LinkedIn connections tied to this lead's company
  // (r.connections, joined in by jobs-pipe; ordered 1st-degree then 2nd).
  // 1st-degree faces are solid; high-quality 2nd-degree (worth an intro) get
  // a dashed ring. Shows up to 4 faces + an overflow count. Clicking the row
  // opens the detail page where the grouped list + intro hints live.
  _renderConnectionsCell(r) {
    const conns = r.connections || [];
    if (!conns.length) return nothing;
    const firstN = conns.filter(c => c.degree !== '2nd').length;
    const shown = conns.slice(0, 4);
    const extra = conns.length - shown.length;
    const aria = firstN
      ? `${firstN} direct, ${conns.length - firstN} second-degree connection(s) here`
      : `${conns.length} second-degree connection(s) here`;
    return html`
      <span class="conn-stack" aria-label=${aria}
            @mouseenter=${(e) => this._showConnTip(conns, e)}
            @mouseleave=${() => this._hideConnTip()}>
        ${shown.map(c => {
          const cls = 'conn-stack__avatar' + (c.degree === '2nd' ? ' conn-stack__avatar--2nd' : '');
          return c.photoUrl
            ? html`<img class=${cls} src=${c.photoUrl} alt=${c.name}
                     loading="lazy" decoding="async"
                     @error=${(e) => {
                       const span = document.createElement('span');
                       span.className = cls + ' conn-stack__avatar--placeholder';
                       span.textContent = (c.name || '?').trim().charAt(0).toUpperCase() || '?';
                       e.target.replaceWith(span);
                     }}/>`
            : html`<span class=${cls + ' conn-stack__avatar--placeholder'}>${(c.name || '?').trim().charAt(0).toUpperCase() || '?'}</span>`;
        })}
        ${extra > 0 ? html`<span class="conn-stack__more">+${extra}</span>` : nothing}
      </span>
    `;
  }

  // Hover card for the Network column — anchored to the hovered avatar
  // stack, shows the full connection list (grouped 1st / 2nd degree) so Ian
  // can eyeball who's there without opening the detail page. Fixed-position
  // so it escapes the table's horizontal scroll container.
  _showConnTip(conns, e) {
    const rect = e.currentTarget.getBoundingClientRect();
    this.hoverConns = { conns, x: rect.left, y: rect.bottom + 6 };
  }
  _hideConnTip() { this.hoverConns = null; }

  _renderConnTip() {
    const h = this.hoverConns;
    if (!h) return nothing;
    const conns = h.conns || [];
    const firsts  = conns.filter(c => c.degree !== '2nd');
    const seconds = conns.filter(c => c.degree === '2nd');
    // Clamp to viewport so the card never spills off-screen.
    const width = 300;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, h.x));
    const top = Math.min(window.innerHeight - 20, h.y);
    const row = (c) => html`
      <li class="conn-tip__item">
        ${c.photoUrl
          ? html`<img class="conn-tip__avatar ${c.degree === '2nd' ? 'conn-tip__avatar--2nd' : ''}" src=${c.photoUrl} alt="" loading="lazy"
                   @error=${(e) => {
                     const s = document.createElement('span');
                     s.className = 'conn-tip__avatar conn-tip__avatar--ph';
                     s.textContent = (c.name || '?').trim().charAt(0).toUpperCase();
                     e.target.replaceWith(s);
                   }}/>`
          : html`<span class="conn-tip__avatar conn-tip__avatar--ph">${(c.name || '?').trim().charAt(0).toUpperCase()}</span>`}
        <span class="conn-tip__text">
          <span class="conn-tip__name">${c.name}</span>
          ${c.title ? html`<span class="conn-tip__title">${c.title}</span>` : nothing}
          ${c.degree === '2nd' && c.mutuals ? html`<span class="conn-tip__mutuals">${c.mutuals} mutual</span>` : nothing}
        </span>
      </li>`;
    return html`
      <div class="conn-tip" style=${`left:${left}px;top:${top}px;width:${width}px;`}>
        ${firsts.length ? html`
          <div class="conn-tip__group">
            <div class="conn-tip__head"><span class="conn-badge conn-badge--1st">1st</span> You're connected</div>
            <ul class="conn-tip__list">${firsts.map(row)}</ul>
          </div>` : nothing}
        ${seconds.length ? html`
          <div class="conn-tip__group">
            <div class="conn-tip__head"><span class="conn-badge conn-badge--2nd">2nd</span> Worth a connection request</div>
            <ul class="conn-tip__list">${seconds.map(row)}</ul>
          </div>` : nothing}
      </div>
    `;
  }

  // One chip taxonomy everywhere: the row chip mirrors the role's Updates
  // row (icon + short label). Clicking it jumps to the queue row instead
  // of navigating away.
  _renderSignalCell(r) {
    const s = this.roleSignals?.get(r.slug);
    if (!s) return nothing;
    const meta = updateKindMeta(s.kind);
    const cls = meta.tint === 'gray' ? 'signal-chip' : `signal-chip signal-chip--${meta.tint}`;
    return html`
      <button class="${cls} signal-chip--btn" title=${s.text || ''}
              @click=${(e) => this._onChipClick(s, e)}>
        <span class="signal-chip__icon" aria-hidden="true">${unsafeHTML(meta.icon)}</span>${meta.chip}
      </button>`;
  }

  _onChipClick(s, e) {
    e.stopPropagation();
    e.preventDefault();
    const el = document.getElementById(`update-${s.role_slug}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('is-highlighted');
      setTimeout(() => el.classList.remove('is-highlighted'), 1600);
    } else {
      window.location.assign(`/ladder/jobs/${s.role_slug}/`);
    }
  }

  // Update the skeleton row too — silent here, just leave it empty.
  _renderSkeletonSignalCell() {
    return html`<td class="col col-signal"></td>`;
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
    const showStatus = !this._isSaved;
    return html`
      <tr class="skeleton-row">
        <td class="col col-fit"><span class="skeleton skeleton--pill" style="width:40px;height:24px;"></span></td>
        <td class="col col-strength"><span class="skeleton skeleton--pill" style="width:40px;height:24px;"></span></td>
        <td class="col col-role">
          <span class="skeleton" style="width:80%;height:14px;display:block;margin-bottom:6px;"></span>
          <span class="skeleton" style="width:50%;height:11px;display:block;"></span>
        </td>
        <td class="col col-signal"></td>
        ${this._isSaved ? html`<td class="col col-connections"><span class="skeleton skeleton--pill" style="width:64px;height:28px;"></span></td>` : nothing}
        <td class="col col-sector"><span class="skeleton" style="width:80px;height:16px;"></span></td>
        ${showStatus ? html`<td class="col col-status"><span class="skeleton skeleton--pill" style="width:120px;height:32px;"></span></td>` : nothing}
        <td class="col col-menu"><span class="skeleton" style="width:32px;height:32px;border-radius:var(--radius-pill);"></span></td>
      </tr>
    `;
  }

  _renderFitModal() {
    return renderScoreModal(this.selectedRow, () => this._closeFitModal(), this.selectedScoreWhich || 'fit');
  }

  // "N new jobs added" banner. Pluralizes correctly, links the most
  // recent N entries inline (cap 3) and shows a "+M more" tail. Click
  // a role link → in-page nav to its detail page.
  _renderAddedBanner(roles) {
    const total = roles.length;
    const preview = roles.slice(-3);     // most recent at the end
    const moreCount = Math.max(0, total - preview.length);
    return html`
      <div class="added-banner" role="status">
        <div class="added-banner__body">
          <strong>${total} new job${total === 1 ? '' : 's'} added.</strong>
          <span class="added-banner__roles">
            ${preview.map((r, i) => html`${i > 0 ? ' · ' : ''}<a href=${`/ladder/jobs/${r.slug}/`} @click=${(e) => this._onAddedClick(r, e)}>${r.company ? `${r.company}` : r.slug}${r.title ? ` — ${r.title}` : ''}</a>`)}
            ${moreCount > 0 ? html` <span class="muted">+${moreCount} more</span>` : nothing}
          </span>
        </div>
        <button class="added-banner__close" @click=${() => this.addedBanner = { roles: [], dismissed: true }} aria-label="Dismiss">×</button>
      </div>
    `;
  }

  _onAddedClick(r, e) {
    if (e.metaKey || e.ctrlKey || e.button === 1) return; // standard new-tab
    e.preventDefault();
    stashRolePrefill({ slug: r.slug, company: r.company, title: r.title });
    window.location.assign(`/ladder/jobs/${r.slug}/`);
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
    const bucketLabel = BUCKET_LABELS[this.bucket] || 'Saved';
    const added = this.addedBanner?.roles || [];
    const showAddedBanner = added.length > 0 && !this.addedBanner.dismissed;

    return html`
      ${showAddedBanner ? this._renderAddedBanner(added) : nothing}

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

      <div class="pipeline-meta">
        <strong>${rows.length}</strong> ${bucketLabel.toLowerCase()} ${rows.length === 1 ? 'role' : 'roles'},
        ${this.sortKey === 'manual'
          ? html`in your custom order. <span class="muted">Drag rows to rearrange.</span>`
          : html`sorted by ${this.sortKey} ${this.sortDir === 'asc' ? '↑' : '↓'}.`}
        ${(this._isSaved || this.bucket === 'drafting')
          && (this.easeFilter || this.roles.some(r => isVisibleRole(r) && bucketFilter(r, this.bucket) && r.applyEase === 'easy')) ? html`
          <button class="btn btn--sm ease-filter-pill ${this.easeFilter ? 'is-active' : ''}"
                  title="Show only roles with no written application questions"
                  @click=${() => this._toggleEaseFilter()}>
            <span class="ease-chip__icon" aria-hidden="true">${unsafeHTML(EASE_ICONS.easy)}</span>
            Easy apply${this.easeFilter ? ' ✕' : ''}
          </button>
        ` : nothing}
        ${this._isSaved && this.sortKey !== 'manual' && this._manualOrders.saved.length ? html`
          <button class="btn btn--sm" @click=${() => this._useCustomOrder()}>Use my order</button>
        ` : nothing}
        ${this._isSaved && this.sortKey !== 'manual' && !this._manualOrders.saved.length ? html`
          <button class="btn btn--sm" @click=${() => this._useCustomOrder()}>Arrange manually</button>
        ` : nothing}
        <button class="btn btn--sm btn--accent"
                @click=${() => { this.pasteOpen = !this.pasteOpen; this.pasteError = ''; }}>
          ${this.pasteOpen ? 'Cancel' : '＋ Add a role'}
        </button>
        ${this.livenessChecking ? html`<span class="muted" style="margin-left:var(--space-3);font-size:var(--font-size-caption);">Checking which roles are still live…</span>` : nothing}
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
      ${this._renderConnTip()}
      ${this._renderEaseTip()}
      ${this._renderArchiveModal()}

      ${rows.length === 0 ? html`
        <div class="placeholder" style="margin-top:var(--space-4);">
          <h2>No ${bucketLabel.toLowerCase()} ${rows.length === 1 ? 'role' : 'roles'} yet</h2>
          <p>${this._isSaved ? 'Add a posting or wait for the crawler to find a fit.'
              : this._isStageBucket ? `Use a role's row menu → Move to → ${bucketLabel} to bring it here.`
              : 'Archived roles land here, with the reason you gave.'}</p>
        </div>
      ` : nothing}

      ${this._renderFitModal()}
    `;
  }
}

customElements.define('ladder-pipeline', JobPipeline);
