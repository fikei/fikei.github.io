// job-recommendations-table — full sortable list for /ladder/jobs/recommended/.
// Mirrors the pipeline-table look (col-fit / role-cell / company-logo /
// th-sort) so this page reads as a peer of the pipeline view, not a
// separate widget.
//
// Pulls the ?view=all variant so it includes recs below the carousel's
// fit-score floor. Records persist in the DB regardless of what shows
// here; this view is the full audit trail.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchRecommendations, dismissRecommendation, blockCompany, addRole, refreshSources }, { logoSrc, logoInitial }, { renderScoreModal, renderScorePair }, { renderLocation, renderSource }] = await Promise.all([
  import('../pipeline.js' + V),
  import('../logo.js' + V),
  import('./ladder-fit-modal.js' + V),
  import('../format.js' + V),
]);

// Column shape mirrors job-pipeline's COLUMNS: id drives the col class,
// sortKey gates sortability, label is what the header shows.
// Location is nested under Role (no standalone column) — sort still offered.
const COLUMNS = [
  { id: 'fit',      label: 'Fit',      sortKey: 'fitScore',       numeric: true },
  { id: 'strength', label: 'Strength', sortKey: 'candidateScore', numeric: true },
  { id: 'role',     label: 'Role',     sortKey: 'title' },
  { id: 'source',   label: 'Source',   sortKey: 'source' },
  { id: 'added',    label: 'Added',    sortKey: 'suggestedAt', date: true },
  { id: 'menu',     label: '',         sortKey: null },
];

// Page size for the infinite-scroll fetch. Server caps at 200; 100 keeps
// each round-trip light while filling a tall viewport in one or two pages.
const PAGE_SIZE = 100;

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7)  return `${d}d ago`;
  const w = Math.floor(d / 7);  if (w < 5)  return `${w}w ago`;
  const mo = Math.floor(d / 30); return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

function fitClass(s) {
  if (s == null) return 'fit-pill fit-pill--poor';
  if (s >= 70) return 'fit-pill fit-pill--strong';
  if (s >= 50) return 'fit-pill fit-pill--ok';
  if (s >= 30) return 'fit-pill fit-pill--weak';
  return 'fit-pill fit-pill--poor';
}


export class JobRecommendationsTable extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state:    { state: true },
    items:    { state: true },
    error:    { state: true },
    _sortLayers: { state: true },
    _menuOpenId: { state: true },
    addingId: { state: true },
    selectedRec:         { state: true },
    selectedScoreWhich:  { state: true },
    _refreshing:         { state: true },
    _refreshFeedback:    { state: true },
    _health:             { state: true },
    _reconnecting:       { state: true },
    _total:              { state: true },
    _loadingMore:        { state: true },
    _hasMore:            { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.items = [];
    this.error = '';
    // Multi-level sort stack (Google-Sheets style): most-significant layer
    // first. Empty → the server's "best overall match" blended ranking.
    // Clicking a header pushes/toggles that column to the front; earlier
    // layers become tiebreakers.
    this._sortLayers = [];
    this._menuOpenId = null;
    this.addingId = null;
    this.selectedRec = null;
    this._refreshing = false;
    this._refreshFeedback = '';
    this._health = [];
    this._reconnecting = false;
    this._total = 0;
    this._offset = 0;
    this._loadingMore = false;
    this._hasMore = false;
  }

  // ----- Source health banner ------------------------------------------
  // The recommendations GET returns sourceHealth rows. Anything with
  // needsReauth (dead Gmail token) or a lastError gets surfaced above the
  // table — "no new recs" and "a source is blind" must look different.

  _healthIssues() {
    if (!Array.isArray(this._health)) return [];
    return this._health.filter(s => s.enabled !== false && (s.needsReauth || s.lastError));
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
      </div>
    `;
  }

  async _onRefresh() {
    if (this._refreshing) return;
    this._refreshing = true;
    this.requestUpdate();
    try {
      const r = await refreshSources();
      this._refreshFeedback = r.throttled
        ? 'Recently refreshed — try again in a few minutes.'
        : 'Scanning Gmail for new roles…';
      setTimeout(async () => {
        await this._fetchPage({ reset: true });
        this.requestUpdate();
      }, 8000);
    } finally {
      this._refreshing = false;
      this.requestUpdate();
      setTimeout(() => { this._refreshFeedback = ''; this.requestUpdate(); }, 10000);
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
    this._onGmailConnected = () => {
      this._health = (this._health || []).filter(s => s.type !== 'gmail-jobs');
      this.requestUpdate();
    };
    document.addEventListener('job:gmail:connected', this._onGmailConnected);
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
    // Close any open row menu on an outside click.
    this._onDocClick = () => { if (this._menuOpenId) this._menuOpenId = null; };
    document.addEventListener('click', this._onDocClick);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('job:gmail:connected', this._onGmailConnected);
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
  }

  // Fetch one page from the server (server-side sorted). reset=true starts
  // a fresh list at offset 0 (initial load, sort change, refresh); otherwise
  // appends the next page for infinite scroll.
  async _fetchPage({ reset = false } = {}) {
    if (reset) { this._offset = 0; this._hasMore = false; }
    try {
      const layers = this._sortLayers;
      const data = await fetchRecommendations({
        view:   'all',
        limit:  PAGE_SIZE,
        offset: this._offset,
        // Multi-level: comma-joined keys + dirs, most-significant first.
        // Empty stack → 'best' blended default on the server.
        sort:   layers.length ? layers.map(l => l.key).join(',') : 'best',
        dir:    layers.length ? layers.map(l => l.dir).join(',') : 'desc',
      });
      const page = Array.isArray(data?.recommendations) ? data.recommendations : [];
      this.items   = reset ? page : [...this.items, ...page];
      this._offset = this.items.length;
      this._total  = Number.isFinite(data?.total) ? data.total : this.items.length;
      this._hasMore = !!data?.hasMore;
      if (reset && Array.isArray(data?.sourceHealth)) this._health = data.sourceHealth;
    } catch (e) {
      if (reset) { this.error = String(e); this.state = 'error'; }
      // append failures are non-fatal — keep what we have, allow retry
    }
  }

  async _loadMore() {
    if (this._loadingMore || !this._hasMore) return;
    this._loadingMore = true;
    this.requestUpdate();
    try { await this._fetchPage({ reset: false }); }
    finally { this._loadingMore = false; this.requestUpdate(); }
  }

  // Max sort layers kept. 3 is plenty (primary + two tiebreakers) and keeps
  // the header indicators readable.
  static SORT_DEPTH = 3;

  _layerIndex(key) {
    return this._sortLayers.findIndex(l => l.key === key);
  }

  _onSortClick(c) {
    if (!c.sortKey) return;
    const key = c.sortKey;
    const defaultDir = (c.numeric || c.date) ? 'desc' : 'asc';
    const layers = [...this._sortLayers];
    const idx = layers.findIndex(l => l.key === key);
    if (idx === 0) {
      // Re-clicking the current primary toggles its direction.
      layers[0] = { key, dir: layers[0].dir === 'asc' ? 'desc' : 'asc' };
    } else {
      // Promote this column to primary; previous layers slide down as
      // tiebreakers. Pull it from its old position first if present.
      if (idx > 0) layers.splice(idx, 1);
      layers.unshift({ key, dir: defaultDir });
    }
    this._sortLayers = layers.slice(0, JobRecommendationsTable.SORT_DEPTH);
    // Server-side sort — re-fetch from offset 0 in the new (layered) order.
    this._fetchPage({ reset: true });
  }

  // Shift-click (or the header's reset affordance) clears the stack back to
  // the default "best" ranking.
  _clearSort() {
    this._sortLayers = [];
    this._fetchPage({ reset: true });
  }

  // Rows are returned already sorted by the server; this is just an
  // array guard so a transient bad state can't crash render.
  _sorted() {
    return Array.isArray(this.items) ? this.items : [];
  }

  async _onDismiss(rec) {
    this.items = this.items.filter(r => r.id !== rec.id);
    try { await dismissRecommendation(rec.id); } catch {}
  }

  async _onAdd(rec) {
    if (this.addingId) return;
    this.addingId = rec.id;
    try {
      const r = await addRole({
        url: rec.url,
        title: rec.title,
        company: rec.company,
        location: rec.location,
        source: 'Network',
        fromRecommendationId: rec.id,
      });
      this.items = this.items.filter(x => x.id !== rec.id);
      document.dispatchEvent(new CustomEvent('job:pipeline:refresh', { detail: { slug: r.slug } }));
      document.dispatchEvent(new CustomEvent('job:pipeline:added', {
        detail: { role: { slug: r.slug, company: r.company || rec.company, title: r.title || rec.title } },
      }));
    } catch (e) {
      console.warn('[recs-table] add failed', e);
    } finally {
      this.addingId = null;
    }
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

  _renderHeader() {
    const multi = this._sortLayers.length > 1;
    return html`
      <tr>
        ${COLUMNS.map(c => {
          const cls = `col col-${c.id}`;
          if (!c.sortKey) return html`<th class=${cls}>${c.label}</th>`;
          const idx = this._layerIndex(c.sortKey);
          const layer = idx >= 0 ? this._sortLayers[idx] : null;
          const arrow = layer ? (layer.dir === 'asc' ? '↑' : '↓') : '↕';
          return html`
            <th class=${cls}>
              <button class=${'th-sort' + (layer ? ' is-active' : '')}
                      title=${layer ? `Sort layer ${idx + 1} — click to toggle / re-prioritize` : 'Click to sort; click another column to layer'}
                      @click=${() => this._onSortClick(c)}>
                <span>${c.label}</span>
                <span class="th-sort__arrow">${arrow}</span>
                ${layer && multi ? html`<span class="th-sort__rank">${idx + 1}</span>` : nothing}
              </button>
            </th>
          `;
        })}
      </tr>
    `;
  }

  _onRowClick(r, e) {
    if (e.target.closest('button, a, .row-menu, .fit-pill--button')) return;
    if (!r.url) return;
    // Plain click → in-page; Cmd/Ctrl/middle → new tab (browser standard).
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      window.open(r.url, '_blank', 'noopener');
    } else {
      window.location.assign(r.url);
    }
  }

  _renderRow(r) {
    return html`
      <tr class="pipeline-row" @click=${(e) => this._onRowClick(r, e)}>
        <td class="col col-fit" data-label="Fit">
          ${this._scorePill(r.fitScore, () => this._openFitModal(r), 'Fit score — tap for breakdown')}
        </td>
        <td class="col col-strength" data-label="Strength">
          ${this._scorePill(r.candidateScore, () => this._openCandidateModal(r), 'Candidate strength — tap for breakdown')}
        </td>
        <td class="col col-role role-cell" data-label="Role">
          <div class="role-cell__inner">
            ${this._renderLogo(r)}
            <div class="role-cell__text">
              <div class="role-cell__title">${r.title || '(untitled)'}</div>
              <div class="role-cell__company">${r.company || ''}</div>
              ${renderLocation(r.location)}
            </div>
          </div>
        </td>
        <td class="col col-source" data-label="Source">
          ${renderSource(r)}
          ${r.enrichmentStatus === 'unresolved' ? html`
            <span class="enrichment-badge" title="Still resolving the canonical posting. Aggregator URL in the meantime.">verifying</span>
          ` : nothing}
          ${r.sourceEmailUrl ? html`
            <a class="rec-source-email" href=${r.sourceEmailUrl} target="_blank" rel="noopener"
               title="Open the originating email in Gmail" @click=${(e) => e.stopPropagation()}>📧</a>
          ` : nothing}
        </td>
        <td class="col col-added" data-label="Added">
          <span class="muted">${r.suggestedAt ? relTime(r.suggestedAt) : ''}</span>
        </td>
        <td class="col col-menu">
          <div class="rec-actions">
            <button class="btn btn--sm btn--accent"
                    aria-label=${this.addingId === r.id ? 'Saving' : 'Save role'}
                    title=${this.addingId === r.id ? 'Saving…' : 'Save role'}
                    ?disabled=${this.addingId === r.id}
                    @click=${() => this._onAdd(r)}>
              <span class="btn-icon" aria-hidden="true">${this.addingId === r.id ? '…' : '✓'}</span>
              <span class="btn-label">${this.addingId === r.id ? 'Saving…' : 'Save'}</span>
            </button>
            <button class="btn-dismiss" aria-label="Dismiss recommendation"
                    title="Dismiss"
                    @click=${() => this._onDismiss(r)}>×</button>
            <div class="row-menu">
              <button class="row-menu__trigger" aria-label="More actions" title="More"
                      @click=${(e) => this._toggleMenu(r.id, e)}>⋯</button>
              ${this._menuOpenId === r.id ? html`
                <div class="row-menu__pop" @click=${(e) => e.stopPropagation()}>
                  <button class="row-menu__item" @click=${() => this._onBlockCompany(r)}>
                    Don't recommend ${r.company || 'this company'}
                  </button>
                  <button class="row-menu__item" @click=${() => { this._onDismiss(r); this._menuOpenId = null; }}>
                    Dismiss this role
                  </button>
                </div>
              ` : nothing}
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  // Single score pill (Fit or Strength). null score renders an em dash.
  _scorePill(score, onClick, title) {
    const cls = fitClass(score) + ' fit-pill--button';
    return html`
      <button class=${cls} title=${title}
              @click=${(e) => { e.stopPropagation(); onClick(); }}>
        ${score == null ? '—' : Math.round(score)}
      </button>`;
  }

  _toggleMenu(id, e) {
    e.stopPropagation();
    this._menuOpenId = this._menuOpenId === id ? null : id;
  }

  async _onBlockCompany(r) {
    const company = r.company;
    this._menuOpenId = null;
    if (!company) return;
    // Optimistic: drop every loaded row from this company immediately.
    const norm = company.toLowerCase().trim();
    this.items = this.items.filter(x => (x.company || '').toLowerCase().trim() !== norm);
    this.requestUpdate();
    try {
      await blockCompany(company);
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: `Won't recommend ${company} anymore` } }));
    } catch (e) {
      console.warn('[recs-table] blockCompany failed', e);
    }
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`
        <header class="recs-page__head">
          <h1>For You</h1>
        </header>
        <div class="pipeline-table-wrap">
          <table class="pipeline-table pipeline-table--recs">
            <thead>${this._renderHeader()}</thead>
            <tbody>
              ${Array.from({ length: 6 }).map(() => html`
                <tr class="skeleton-row">
                  ${COLUMNS.map(c => html`<td class=${`col col-${c.id}`}><span class="skeleton" style="width:80%;height:14px;display:inline-block;"></span></td>`)}
                </tr>
              `)}
            </tbody>
          </table>
        </div>
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
        <h1>For You</h1>
        <span class="muted">${this._total > rows.length
          ? `${rows.length} of ${this._total} roles`
          : `${rows.length} ${rows.length === 1 ? 'role' : 'roles'}`}</span>
        <button class="btn btn--sm recs-page__refresh" ?disabled=${this._refreshing}
                title="Scan Gmail for new role alerts and application updates"
                @click=${() => this._onRefresh()}>
          ${this._refreshing ? 'Scanning…' : '↻ Refresh'}
        </button>
        ${this._refreshFeedback ? html`<span class="muted recs-page__refresh-status">${this._refreshFeedback}</span>` : nothing}
        ${this._sortLayers.length ? html`
          <button class="btn btn--sm recs-page__clearsort" title="Back to best-match order"
                  @click=${() => this._clearSort()}>
            Sorted by ${this._sortLayers.map(l => l.key === 'candidateScore' ? 'Strength' : l.key === 'fitScore' ? 'Fit' : l.key === 'suggestedAt' ? 'Date' : l.key).join(' › ')} · reset
          </button>
        ` : nothing}
      </header>
      ${this._renderHealthBanner()}
      ${rows.length === 0 ? html`
        <div class="placeholder">
          <h2>No recommendations yet</h2>
          <p>New ones land here as soon as the workers pull fresh roles.</p>
        </div>
      ` : html`
        <div class="pipeline-table-wrap">
          <table class="pipeline-table pipeline-table--recs">
            <thead>${this._renderHeader()}</thead>
            <tbody>${rows.map(r => this._renderRow(r))}</tbody>
          </table>
          ${this._hasMore ? html`
            <div class="recs-sentinel" aria-hidden="true"></div>
            <div class="recs-loadmore muted">${this._loadingMore ? 'Loading more…' : ''}</div>
          ` : nothing}
        </div>
      `}
      ${renderScoreModal(this.selectedRec, () => this._closeFitModal(), this.selectedScoreWhich || 'fit')}
    `;
  }
}

customElements.define('ladder-recommendations-table', JobRecommendationsTable);
