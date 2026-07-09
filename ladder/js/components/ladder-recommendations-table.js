// ladder-recommendations-table — the Inbox at /ladder/jobs/recommended/.
// New roles arrive in small date-stamped batches (Today / Yesterday / Jun 12),
// one "Review" affordance per row, and every decision happens inside the
// full-screen <ladder-review-overlay> — no inline accept/reject, no numeric
// score chips, no sort machinery in the reading flow. Pipeline plumbing
// (quality-floor toggle, source refresh) lives behind a single ⋯ menu;
// watched-company config moved to /ladder/vision/ (Search plan).
//
// Pulls the ?view=all variant so it includes recs below the carousel's
// fit-score floor. Records persist in the DB regardless of what shows here.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchRecommendations, dismissRecommendation, blockCompany, watchCompany, addRole, refreshSources }, { logoSrc, logoInitial }, { renderScoreModal, renderScorePair, weakestFitDims }, { roleSlug }] = await Promise.all([
  import('../pipeline.js' + V),
  import('../logo.js' + V),
  import('./ladder-fit-modal.js' + V),
  import('../slug.js' + V),
]);
import('./ladder-review-overlay.js' + V);

// Page size for the infinite-scroll fetch. Server caps at 200; 100 keeps
// each round-trip light while filling a tall viewport in one or two pages.
const PAGE_SIZE = 100;
// Draining loader tuning. A single pull run is ~30–90s; cap the loader so it
// can never stick if a run dies. Poll cadence balances responsiveness vs load.
const DRAIN_MAX_MS   = 150 * 1000;
const DRAIN_POLL_MS  = 8 * 1000;
const PULL_KICK_KEY  = 'job:lastPullKickAt';   // shared with pipeline.js refreshSources

function fitClass(s) {
  if (s == null) return 'fit-pill fit-pill--poor';
  if (s >= 70) return 'fit-pill fit-pill--strong';
  if (s >= 50) return 'fit-pill fit-pill--ok';
  if (s >= 30) return 'fit-pill fit-pill--weak';
  return 'fit-pill fit-pill--poor';
}

// Group label for an ISO timestamp: Today / Yesterday / "Jun 12" (+ year
// when it isn't the current one). Grouping is by local calendar day.
function dayLabel(iso) {
  if (!iso) return 'Earlier';
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

export class JobRecommendationsTable extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state:    { state: true },
    items:    { state: true },
    error:    { state: true },
    _menuOpen:  { state: true },
    addingId: { state: true },
    selectedRec:         { state: true },
    selectedScoreWhich:  { state: true },
    _refreshing:         { state: true },
    _refreshFeedback:    { state: true },
    _health:             { state: true },
    _reconnecting:       { state: true },
    _draining:           { state: true },
    _total:              { state: true },
    _loadingMore:        { state: true },
    _hasMore:            { state: true },
    _recentlyExpired:    { state: true },
    _wildcards:          { state: true },
    _floorOn:            { state: true },
    _reviewIndex:        { state: true },
    _below:              { state: true },
    _expandedDays:       { state: true },
    _reviewBelowDay:     { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.items = [];
    this.error = '';
    this._menuOpen = false;
    this.addingId = null;
    this.selectedRec = null;
    this._refreshing = false;
    this._refreshFeedback = '';
    this._health = [];
    this._reconnecting = false;
    // Draining = a scan the backend is actively working. Set when we kick a
    // pull (manual refresh, Gmail reconnect) and cleared when the gmail-jobs
    // source's lastRunAt advances past the kick, or after DRAIN_MAX_MS.
    this._draining = false;
    this._drainKickAt = 0;   // ms epoch of the kick we're waiting on
    this._drainPoll = null;  // setInterval handle
    this._total = 0;
    this._offset = 0;
    this._loadingMore = false;
    this._hasMore = false;
    this._recentlyExpired = 0;
    this._wildcards = [];
    // Quality floors (fit >= 50, strength >= 50, no hard fails) apply by
    // default; the ⋯ menu toggle flips to the unfiltered audit view.
    this._floorOn = true;
    // Index into items while the review overlay is open; null = closed.
    this._reviewIndex = null;
    // Below-your-bar drawer: graded roles that fail the quality floors,
    // grouped per day behind a "See more" expander at the bottom of each
    // daily card. Loaded lazily after the main list (never blocks it).
    this._below = null;
    this._expandedDays = new Set();
    // When set (a day label), the review overlay walks that day's
    // below-bar queue instead of the main inbox.
    this._reviewBelowDay = null;
  }

  // ----- Source health banner ------------------------------------------
  // The recommendations GET returns sourceHealth rows. Anything with
  // needsReauth (dead Gmail token) or a lastError gets surfaced above the
  // list — "no new recs" and "a source is blind" must look different.

  _healthIssues() {
    if (!Array.isArray(this._health)) return [];
    return this._health.filter(s => s.enabled !== false && (s.needsReauth || s.lastError));
  }

  // Banner lifecycle: dismiss snoozes THIS error signature for 6h (persisted).
  // A new/different error resurfaces immediately; the same one comes back
  // after the snooze if the server still reports it. The banner also clears
  // naturally when a successful scan wipes last_error server-side.
  static HEALTH_SNOOZE_MS = 6 * 60 * 60 * 1000;
  _healthSignature(issues) {
    return issues.map(s => `${s.type}:${s.needsReauth ? 'reauth' : (s.lastError || '').slice(0, 80)}`).sort().join('|');
  }
  _healthSnoozed(issues) {
    try {
      const raw = JSON.parse(localStorage.getItem('job:healthBannerSnooze') || 'null');
      return raw && raw.sig === this._healthSignature(issues)
        && (Date.now() - raw.at) < JobRecommendationsTable.HEALTH_SNOOZE_MS;
    } catch { return false; }
  }
  _snoozeHealth() {
    const issues = this._healthIssues();
    try {
      localStorage.setItem('job:healthBannerSnooze',
        JSON.stringify({ sig: this._healthSignature(issues), at: Date.now() }));
    } catch { /* */ }
    this.requestUpdate();
  }

  async _onReconnectGmail() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    try {
      const supabase = window.CtrlAuth?.getSupabaseClient?.();
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const r = await fetch('https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/gmail-auth', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auth-url' }),
      });
      const j = await r.json();
      if (j.url) { window.location.assign(j.url); return; }
      console.warn('[recs-table] reconnect: no auth url', j);
    } catch (e) {
      console.warn('[recs-table] reconnect failed', e);
    } finally {
      this._reconnecting = false;
    }
  }

  _renderHealthBanner() {
    const issues = this._healthIssues();
    if (!issues.length) return nothing;
    if (this._healthSnoozed(issues)) return nothing;
    const gmailDead = issues.find(s => s.type === 'gmail-jobs' && s.needsReauth);
    return html`
      <div class="recs-health-banner" role="alert">
        ${gmailDead ? html`
          <span class="recs-health-banner__msg">
            <strong>Gmail is disconnected</strong> — new job-alert emails aren't being scanned.
          </span>
          <button class="btn btn--sm btn--accent" ?disabled=${this._reconnecting}
                  @click=${() => this._onReconnectGmail()}>
            ${this._reconnecting ? 'Opening…' : 'Reconnect Gmail'}
          </button>
        ` : html`
          <span class="recs-health-banner__msg">
            <strong>Source issue:</strong>
            ${issues.map(s => `${s.type}: ${s.lastError || 'needs attention'}`).join(' · ')}
          </span>
        `}
        <button class="recs-health-banner__close" aria-label="Dismiss for now"
                title="Dismiss — comes back if the issue is still present in 6 hours"
                @click=${() => this._snoozeHealth()}>×</button>
      </div>
    `;
  }

  // ----- Draining loader -------------------------------------------------
  // "Draining" means the backend is actively scanning Gmail for this user.
  // We know a scan is in flight because we (or a prior page, via the shared
  // localStorage kick timestamp) just fired one; it's done when the
  // gmail-jobs source's lastRunAt advances past the kick we're waiting on.

  _gmailHealth() {
    return (this._health || []).find(s => s.type === 'gmail-jobs') || null;
  }

  // Has the gmail-jobs source completed a run since `kickAt`?
  _drainDoneFor(kickAt) {
    const g = this._gmailHealth();
    if (!g || !g.lastRunAt) return false;
    return new Date(g.lastRunAt).getTime() >= kickAt - 1000;   // 1s clock slack
  }

  // Begin/refresh the draining indicator for the run kicked at `kickAt`.
  // Idempotent: re-kicking (e.g. a second refresh) just extends the wait.
  _startDraining(kickAt) {
    this._drainKickAt = kickAt || Date.now();
    this._draining = true;
    this.requestUpdate();
    if (this._drainPoll) return;   // already polling
    this._drainPoll = setInterval(() => this._pollDrain(), DRAIN_POLL_MS);
  }

  _stopDraining() {
    this._draining = false;
    if (this._drainPoll) { clearInterval(this._drainPoll); this._drainPoll = null; }
    this.requestUpdate();
  }

  async _pollDrain() {
    // Timed out — clear so the loader can never wedge on a dead run.
    if (Date.now() - this._drainKickAt > DRAIN_MAX_MS) { this._stopDraining(); return; }
    // Re-fetch to pick up fresh recs AND updated sourceHealth.lastRunAt.
    await this._fetchPage({ reset: true });
    if (this._drainDoneFor(this._drainKickAt)) this._stopDraining();
    this.requestUpdate();
  }

  // On (re)mount, resume the loader if a recent kick hasn't completed yet —
  // survives navigation and the Gmail-reconnect OAuth round-trip.
  _resumeDrainingIfPending() {
    let kickAt = 0;
    try { kickAt = Number(localStorage.getItem(PULL_KICK_KEY) || 0); } catch { /* ignore */ }
    if (!kickAt) return;
    if (Date.now() - kickAt > DRAIN_MAX_MS) return;   // stale kick, ignore
    if (this._drainDoneFor(kickAt)) return;           // already finished
    this._startDraining(kickAt);
  }

  _renderDrainingBanner() {
    if (!this._draining) return nothing;
    return html`
      <div class="recs-draining" role="status" aria-live="polite">
        <span class="recs-draining__spinner" aria-hidden="true"></span>
        <span class="recs-draining__msg">Scanning Gmail for new roles… new matches appear here automatically.</span>
      </div>
    `;
  }

  async _onRefresh() {
    if (this._refreshing) return;
    this._refreshing = true;
    this.requestUpdate();
    try {
      // Force-run the gmail-jobs source by id (bypasses the server is-due gate)
      // so an explicit Refresh always scans and the loader clears on real
      // completion; keep the client throttle so the button can't be spammed.
      const gmailId = (this._gmailHealth() || {}).id || null;
      const r = await refreshSources({ sourceId: gmailId });
      if (r.throttled) {
        this._refreshFeedback = 'Recently refreshed — try again in a few minutes.';
        setTimeout(() => { this._refreshFeedback = ''; this.requestUpdate(); }, 10000);
      } else {
        // Real kick → show the persistent draining loader until it completes.
        this._startDraining(r.kickAt || Date.now());
      }
    } finally {
      this._refreshing = false;
      this.requestUpdate();
    }
  }

  _openFitModal(rec)       { this._setSelected(rec); this.selectedScoreWhich = 'fit'; }
  _openCandidateModal(rec) { this._setSelected(rec); this.selectedScoreWhich = 'candidate'; }
  _closeFitModal()         { this.selectedRec = null; this.selectedScoreWhich = null; }
  _setSelected(rec) {
    // Forward the full row so renderScoreModal can read either the Fit
    // or Candidate fields.
    this.selectedRec = {
      company:             rec.company,
      title:               rec.title,
      score:               rec.fitScore,
      breakdown:           rec.breakdown || rec.fitBreakdown || {},
      rationales:          rec.rationales || rec.fitRationales || {},
      hardFails:           rec.hardFails || [],
      candidateScore:      rec.candidateScore ?? null,
      candidateBreakdown:  rec.candidateBreakdown || {},
      candidateRationales: rec.candidateRationales || {},
      compAcceptable:      rec.compAcceptable ?? null,
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    // Gmail just reconnected (app.js fires this after a successful token
    // exchange) → hide the disconnected banner optimistically without
    // waiting for the next scan to clear last_error server-side.
    this._onGmailConnected = async () => {
      // Capture the source id before we drop the row from _health.
      const gmailId = (this._gmailHealth() || {}).id || null;
      // Optimistically clear the disconnected banner without waiting for the
      // next scan to clear last_error server-side.
      this._health = (this._health || []).filter(s => s.type !== 'gmail-jobs');
      this.requestUpdate();
      // Reconnect is a high-signal trigger: force an immediate scan (bypass the
      // client throttle AND the server is-due gate) and show the draining
      // loader until it completes, instead of waiting up to 15 min for cron.
      try {
        const r = await refreshSources({ force: true, sourceId: gmailId });
        if (r.kicked) this._startDraining(r.kickAt || Date.now());
      } catch (e) { console.warn('[recs-table] post-reconnect kick failed', e); }
    };
    document.addEventListener('job:gmail:connected', this._onGmailConnected);
    // While a health issue is showing, revalidate every 5 minutes so the
    // banner clears itself once the source recovers — no reload needed.
    this._healthTimer = setInterval(async () => {
      if (!this._healthIssues().length) return;
      try {
        const d = await fetchRecommendations({ view: 'all', floor: true, limit: 1 });
        if (Array.isArray(d?.sourceHealth)) this._health = d.sourceHealth;
      } catch { /* keep the current banner */ }
    }, 5 * 60 * 1000);
    // Infinite scroll: when the viewport nears the bottom of the document,
    // pull the next page. A plain scroll listener is more reliable across
    // layouts than an IntersectionObserver on a 1px sentinel.
    this._onScroll = () => {
      if (!this._hasMore || this._loadingMore) return;
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 900;
      if (nearBottom) this._loadMore();
    };
    window.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onScroll, { passive: true });
    // Close the header ⋯ menu on an outside click.
    this._onDocClick = () => { if (this._menuOpen) this._menuOpen = false; };
    document.addEventListener('click', this._onDocClick);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('job:gmail:connected', this._onGmailConnected);
    clearInterval(this._healthTimer);
    if (this._drainPoll) { clearInterval(this._drainPoll); this._drainPoll = null; }
    document.removeEventListener('click', this._onDocClick);
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('resize', this._onScroll);
    super.disconnectedCallback();
  }

  // After each render, if the page isn't tall enough to scroll yet there
  // are more rows, pull another page so a short first page can't strand
  // the rest (no scroll event would ever fire).
  updated() {
    if (this._hasMore && !this._loadingMore &&
        document.body.scrollHeight <= window.innerHeight + 100) {
      this._loadMore();
    }
  }

  async _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    this.state = 'loading';
    await this._fetchPage({ reset: true });
    if (this.state === 'loading') this.state = 'loaded';
    // If a scan was kicked recently (this session or just before an OAuth
    // reconnect round-trip) and hasn't finished, resume the draining loader.
    this._resumeDrainingIfPending();
    // Wildcards strip loads after the list — never block or fail the
    // page over it.
    try {
      const wc = await fetchRecommendations({ view: 'wildcard' });
      this._wildcards = Array.isArray(wc?.recommendations) ? wc.recommendations : [];
    } catch { this._wildcards = []; }
    // Below-your-bar rows for the per-day drawers. 200 newest covers the
    // visible date range; older groups simply don't show a drawer.
    try {
      const bl = await fetchRecommendations({ view: 'all', floor: 'below', limit: 200, sort: 'suggestedAt', dir: 'desc' });
      this._below = Array.isArray(bl?.recommendations) ? bl.recommendations : [];
    } catch { this._below = []; }
  }

  // Fetch one page from the server. Inbox order: newest batch first —
  // the server's date sort keeps groups contiguous. reset=true starts a
  // fresh list at offset 0; otherwise appends for infinite scroll.
  async _fetchPage({ reset = false } = {}) {
    if (reset) { this._offset = 0; this._hasMore = false; }
    try {
      const data = await fetchRecommendations({
        view:   'all',
        floor:  this._floorOn,
        limit:  PAGE_SIZE,
        offset: this._offset,
        sort:   'suggestedAt',
        dir:    'desc',
      });
      const page = Array.isArray(data?.recommendations) ? data.recommendations : [];
      this.items   = reset ? page : [...this.items, ...page];
      this._offset = this.items.length;
      this._total  = Number.isFinite(data?.total) ? data.total : this.items.length;
      this._hasMore = !!data?.hasMore;
      if (reset && Array.isArray(data?.sourceHealth)) this._health = data.sourceHealth;
      if (reset) this._recentlyExpired = Number.isFinite(data?.recentlyExpired) ? data.recentlyExpired : 0;
    } catch (e) {
      if (reset) { this.error = String(e); this.state = 'error'; }
      // append failures are non-fatal — keep what we have, allow retry
    }
  }

  async _toggleFloor() {
    this._floorOn = !this._floorOn;
    this.state = 'loading';
    this.requestUpdate();
    await this._fetchPage({ reset: true });
    this.state = 'loaded';
  }

  async _loadMore() {
    if (this._loadingMore || !this._hasMore) return;
    this._loadingMore = true;
    this.requestUpdate();
    try { await this._fetchPage({ reset: false }); }
    finally { this._loadingMore = false; this.requestUpdate(); }
  }

  async _onDismiss(rec) {
    this.items = this.items.filter(r => r.id !== rec.id);
    this._wildcards = this._wildcards.filter(r => r.id !== rec.id);
    if (this._below) this._below = this._below.filter(r => r.id !== rec.id);
    try { await dismissRecommendation(rec.id); } catch {}
  }

  async _onAdd(rec) {
    if (this.addingId) return;
    this.addingId = rec.id;
    // Optimistic removal — the review flow advances instantly; the server
    // save completes in the background (failures are logged and toasted).
    this.items = this.items.filter(x => x.id !== rec.id);
    this._wildcards = this._wildcards.filter(x => x.id !== rec.id);
    if (this._below) this._below = this._below.filter(x => x.id !== rec.id);
    try {
      const r = await addRole({
        url: rec.url,
        title: rec.title,
        company: rec.company,
        location: rec.location,
        source: 'Network',
        fromRecommendationId: rec.id,
      });
      document.dispatchEvent(new CustomEvent('job:pipeline:refresh', { detail: { slug: r.slug } }));
      document.dispatchEvent(new CustomEvent('job:pipeline:added', {
        detail: { role: { slug: r.slug, company: r.company || rec.company, title: r.title || rec.title } },
      }));
    } catch (e) {
      console.warn('[recs-table] add failed', e);
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: `Couldn't save ${rec.title || 'role'} — try again from Show all` } }));
    } finally {
      this.addingId = null;
    }
  }

  // "Watch <company>" — green-light the company as a direct source. The
  // server resolves the careers backend (major-tech registry or an ATS
  // board probe); unsupported companies surface the server's message.
  async _onWatchCompany(r) {
    const company = r.company;
    if (!company) return;
    try {
      await watchCompany({ company });
      document.dispatchEvent(new CustomEvent('job:watch:added', { detail: { company } }));
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: `Watching ${company} — its careers page feeds your Inbox now` } }));
    } catch (e) {
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: e.message || `Couldn't watch ${company}` } }));
      console.warn('[recs-table] watchCompany failed', e);
    }
  }

  async _onBlockCompany(r) {
    const company = r.company;
    if (!company) return;
    // Optimistic: drop every loaded row from this company immediately.
    const norm = company.toLowerCase().trim();
    this.items = this.items.filter(x => (x.company || '').toLowerCase().trim() !== norm);
    if (this._below) this._below = this._below.filter(x => (x.company || '').toLowerCase().trim() !== norm);
    this.requestUpdate();
    try {
      await blockCompany(company);
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: `Won't recommend ${company} anymore` } }));
    } catch (e) {
      console.warn('[recs-table] blockCompany failed', e);
    }
  }

  // ----- Review overlay --------------------------------------------------

  _openReview(index) { this._reviewBelowDay = null; this._reviewIndex = index; }
  _openBelowReview(day, index) { this._reviewBelowDay = day; this._reviewIndex = index; }
  _closeReview()     { this._reviewIndex = null; this._reviewBelowDay = null; }

  _renderReview() {
    if (this._reviewIndex == null) return nothing;
    // Below-bar reviews walk that day's drawer queue; otherwise the inbox.
    const rows = this._reviewBelowDay != null
      ? (this._belowByDay().get(this._reviewBelowDay) || [])
      : this._sorted();
    // Items removed out from under the overlay (save/dismiss/block) shift
    // the queue; clamp, and close when it's drained.
    if (!rows.length) { return nothing; }
    const index = Math.min(this._reviewIndex, rows.length - 1);
    return html`
      <ladder-review-overlay
        .items=${rows}
        .index=${index}
        @review-close=${() => this._closeReview()}
        @review-save=${(e) => this._onAdd(e.detail.rec)}
        @review-dismiss=${(e) => this._onDismiss(e.detail.rec)}
        @review-watch=${(e) => this._onWatchCompany(e.detail.rec)}
        @review-block=${(e) => this._onBlockCompany(e.detail.rec)}
      ></ladder-review-overlay>
    `;
  }

  // ----- Inbox list --------------------------------------------------------

  _sorted() {
    return Array.isArray(this.items) ? this.items : [];
  }

  // Below-bar rows grouped by the same day labels as the inbox groups.
  _belowByDay() {
    const map = new Map();
    for (const r of (this._below || [])) {
      const label = dayLabel(r.suggestedAt);
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(r);
    }
    return map;
  }

  _toggleDay(label) {
    const s = new Set(this._expandedDays);
    s.has(label) ? s.delete(label) : s.add(label);
    this._expandedDays = s;
  }

  _groups() {
    const rows = this._sorted();
    const groups = [];
    const byLabel = new Map();
    rows.forEach((r, i) => {
      const label = dayLabel(r.suggestedAt);
      let g = byLabel.get(label);
      if (!g) { g = { label, rows: [] }; byLabel.set(label, g); groups.push(g); }
      g.rows.push({ rec: r, index: i });
    });
    return groups;
  }

  _renderLogo(r) {
    const src = logoSrc(r);
    const cls = 'company-logo company-logo--sm';
    if (!src) {
      return html`<span class=${cls + ' company-logo--placeholder'} aria-hidden="true">${logoInitial(r.company)}</span>`;
    }
    return html`
      <img class=${cls} src=${src} alt=""
           loading="lazy" decoding="async"
           @error=${(e) => {
             const span = document.createElement('span');
             span.className = cls + ' company-logo--placeholder';
             span.setAttribute('aria-hidden', 'true');
             span.textContent = logoInitial(r.company);
             e.target.replaceWith(span);
           }}>
    `;
  }

  _renderInboxRow({ rec, index }, { belowDay = null } = {}) {
    const sub = [rec.company, rec.location].filter(Boolean).join(' · ');
    const open = () => belowDay != null ? this._openBelowReview(belowDay, index) : this._openReview(index);
    return html`
      <li class=${'inbox-row' + (belowDay != null ? ' inbox-row--below' : '')} role="listitem">
        <button class="inbox-row__main" @click=${open}>
          ${this._renderLogo(rec)}
          <span class="inbox-row__text">
            <span class="inbox-row__title">${rec.title || '(untitled)'}</span>
            ${sub ? html`<span class="inbox-row__sub">${sub}</span>` : nothing}
          </span>
        </button>
        <div class="inbox-row__actions">
          <button class="inbox-row__dismiss" title="Not for me"
                  aria-label=${'Dismiss ' + (rec.title || 'this role')}
                  @click=${() => this._onDismiss(rec)}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
              <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor"
                    stroke-width="1.75" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="btn btn--sm inbox-row__review" @click=${open}>
            Review <span aria-hidden="true">→</span>
          </button>
        </div>
      </li>
    `;
  }

  // "See more"-style drawer at the bottom of a daily card: graded roles
  // that didn't clear the quality floors ("below your bar" — same language
  // as the verdict cards' hard-fail copy).
  _renderBelowDrawer(label) {
    const rows = this._belowByDay().get(label) || [];
    if (!rows.length) return nothing;
    const open = this._expandedDays.has(label);
    return html`
      ${open ? rows.map((rec, i) => this._renderInboxRow({ rec, index: i }, { belowDay: label })) : nothing}
      <li class="inbox-more" role="listitem">
        <button class="inbox-more__btn" aria-expanded=${open ? 'true' : 'false'}
                @click=${() => this._toggleDay(label)}>
          ${open
            ? 'Show fewer'
            : `Show ${rows.length} below your bar`}
          <span class="inbox-more__chevron" aria-hidden="true">${open ? '▴' : '▾'}</span>
        </button>
      </li>
    `;
  }

  _renderGroups() {
    const groups = this._groups();
    return html`
      ${groups.map(g => html`
        <section class="inbox-group">
          <header class="inbox-group__head">
            <h2 class="inbox-group__label">${g.label}</h2>
            <span class="inbox-group__count muted">${g.rows.length} ${g.rows.length === 1 ? 'role' : 'roles'}</span>
          </header>
          <ul class="inbox-card" role="list">
            ${g.rows.map(row => this._renderInboxRow(row))}
            ${this._renderBelowDrawer(g.label)}
          </ul>
        </section>
      `)}
    `;
  }

  // Header ⋯ menu: the operational controls (refresh, floor toggle,
  // expiry info) that used to crowd the page header.
  _renderHeaderMenu() {
    return html`
      <div class="row-menu page-menu">
        <button class="row-menu__trigger" aria-label="List options" title="List options"
                @click=${(e) => { e.stopPropagation(); this._menuOpen = !this._menuOpen; }}>⋯</button>
        ${this._menuOpen ? html`
          <div class="row-menu__pop" @click=${(e) => e.stopPropagation()}>
            <button class="row-menu__item" ?disabled=${this._refreshing}
                    @click=${() => { this._menuOpen = false; this._onRefresh(); }}>
              ${this._refreshing ? 'Scanning…' : 'Refresh sources'}
            </button>
            <button class="row-menu__item" @click=${() => { this._menuOpen = false; this._toggleFloor(); }}>
              ${this._floorOn ? 'Show below-floor roles' : 'Re-apply quality floors'}
            </button>
            ${this._recentlyExpired > 0 ? html`
              <div class="row-menu__info muted">${this._recentlyExpired} expired removed this week</div>
            ` : nothing}
          </div>
        ` : nothing}
      </div>
    `;
  }

  // --- Wildcards strip -------------------------------------------------
  // High candidate-strength / low stated-criteria-fit roles (view=wildcard).
  // Leads with WHY the fit is low — the strip exists to pressure-test the
  // search criteria, not to list more of the same.
  _wildcardDetailUrl(r) {
    return `/ladder/jobs/${roleSlug(r.company, r.title)}/?rec=${r.id}`;
  }

  _renderWildcardCard(rec) {
    const weak = weakestFitDims(rec, 2);
    const fails = rec.hardFails || [];
    // Just the reasons — the strip header already explains the concept,
    // so the card copy stays light. Lead with the weakest dimension label
    // for scannability; the full rationale lives in the fit modal.
    const why = [...fails.map(f => `Hard fail: ${f}`),
                 ...weak.map(w => w.rationale || `Weak ${w.label.toLowerCase()}`)].slice(0, 2).join(' · ');
    return html`
      <article class="rec-card rec-card--wildcard" role="listitem">
        <header class="rec-card__head">
          <div class="rec-card__title-block">
            <div class="rec-card__title-row">
              <h3 class="rec-card__title">
                <a class="rec-card__title-link" href=${this._wildcardDetailUrl(rec)} target="_blank" rel="noopener"
                   title="Open role details in a new tab">${rec.title || '(untitled)'}</a>
              </h3>
              ${renderScorePair(rec, {
                onFit:       (row) => this._openFitModal(row),
                onCandidate: (row) => this._openCandidateModal(row),
                fitClass:    (s) => fitClass(s),
                candClass:   (s) => fitClass(s),
              })}
            </div>
            <p class="rec-card__meta">${[rec.company, rec.location].filter(Boolean).join('  •  ')}</p>
            ${why ? html`<p class="rec-card__wildcard-why">${why}</p>` : nothing}
          </div>
        </header>
        <footer class="rec-card__foot">
          <button class="btn btn--sm btn--accent" ?disabled=${this.addingId === rec.id}
                  @click=${() => this._onAdd(rec)}>
            ${this.addingId === rec.id ? 'Saving…' : 'Save role'}
          </button>
          <button class="link-subtle" @click=${() => this._onDismiss(rec)}>Dismiss</button>
        </footer>
      </article>
    `;
  }

  _renderWildcards() {
    if (!this._wildcards.length) return nothing;
    return html`
      <section class="rec-wildcards" aria-label="Wildcards">
        <header class="rec-shell__head rec-wildcards__head">
          <h2>Wildcards</h2>
          <span class="muted">Roles where you'd likely be a standout candidate — but that flunk your stated criteria. A litmus test for the litmus.</span>
        </header>
        <div class="rec-row rec-row--wildcards" role="list">
          ${this._wildcards.map(r => this._renderWildcardCard(r))}
        </div>
      </section>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`
        <header class="recs-page__head">
          <h1>Inbox</h1>
        </header>
        <section class="inbox-group" aria-hidden="true">
          <header class="inbox-group__head">
            <span class="skeleton" style="width:96px;height:20px;display:inline-block;"></span>
          </header>
          <ul class="inbox-card" role="list">
            ${Array.from({ length: 5 }).map(() => html`
              <li class="inbox-row inbox-row--skeleton">
                <span class="skeleton" style="width:44px;height:44px;border-radius:12px;"></span>
                <span class="inbox-row__text">
                  <span class="skeleton" style="width:60%;height:16px;display:inline-block;"></span>
                  <span class="skeleton" style="width:40%;height:12px;display:inline-block;"></span>
                </span>
              </li>
            `)}
          </ul>
        </section>
      `;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder" style="border-color:var(--error);color:var(--error);">
        <h2>Couldn't load recommendations</h2>
        <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
      </div>`;
    }
    const rows = this._sorted();
    return html`
      <header class="recs-page__head">
        <h1>Inbox</h1>
        <span class="muted">${this._total > rows.length
          ? `${rows.length} of ${this._total} roles`
          : `${rows.length} ${rows.length === 1 ? 'role' : 'roles'}`}</span>
        ${!this._floorOn ? html`
          <button class="link-subtle recs-page__floor-toggle" @click=${() => this._toggleFloor()}>
            Showing all · apply floors
          </button>
        ` : nothing}
        ${this._refreshFeedback ? html`<span class="muted recs-page__refresh-status">${this._refreshFeedback}</span>` : nothing}
        ${this._renderHeaderMenu()}
      </header>
      ${this._renderDrainingBanner()}
      ${this._renderHealthBanner()}
      ${rows.length === 0 ? html`
        <div class="placeholder">
          <h2>All caught up</h2>
          <p>New roles land here as soon as the workers pull them.</p>
        </div>
      ` : html`
        <div class="inbox">
          ${this._renderGroups()}
          ${this._hasMore ? html`
            <div class="recs-sentinel" aria-hidden="true"></div>
            <div class="recs-loadmore muted">${this._loadingMore ? 'Loading more…' : ''}</div>
          ` : nothing}
        </div>
      `}
      ${this._renderWildcards()}
      ${this._renderReview()}
      ${renderScoreModal(this.selectedRec, () => this._closeFitModal(), this.selectedScoreWhich || 'fit')}
    `;
  }
}

customElements.define('ladder-recommendations-table', JobRecommendationsTable);
