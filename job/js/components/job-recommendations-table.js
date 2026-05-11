// job-recommendations-table — full sortable list for /job/jobs/recommended/.
// Mirrors the pipeline-table look (col-fit / role-cell / company-logo /
// th-sort) so this page reads as a peer of the pipeline view, not a
// separate widget.
//
// Pulls the ?view=all variant so it includes recs below the carousel's
// fit-score floor. Records persist in the DB regardless of what shows
// here; this view is the full audit trail.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchRecommendations, dismissRecommendation, addRole }, { logoSrc, logoInitial }, { renderFitModal }] = await Promise.all([
  import('../pipeline.js' + V),
  import('../logo.js' + V),
  import('./job-fit-modal.js' + V),
]);

// Column shape mirrors job-pipeline's COLUMNS: id drives the col class,
// sortKey gates sortability, label is what the header shows.
const COLUMNS = [
  { id: 'fit',      label: 'Fit',      sortKey: 'fitScore',    numeric: true },
  { id: 'role',     label: 'Role',     sortKey: 'title' },
  { id: 'location', label: 'Location', sortKey: 'location' },
  { id: 'sector',   label: 'Source',   sortKey: 'source' },
  { id: 'added',    label: 'Added',    sortKey: 'suggestedAt', date: true },
  { id: 'menu',     label: '',         sortKey: null },
];

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
    sortKey:  { state: true },
    sortDir:  { state: true },
    addingId: { state: true },
    selectedRec: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.items = [];
    this.error = '';
    // Default: same order as the widget (fit score desc).
    this.sortKey = 'fitScore';
    this.sortDir = 'desc';
    this.addingId = null;
    this.selectedRec = null;
  }

  _openFitModal(rec) {
    this.selectedRec = {
      company:   rec.company,
      title:     rec.title,
      score:     rec.fitScore,
      breakdown: rec.breakdown || rec.fitBreakdown || {},
      hardFails: rec.hardFails || [],
    };
  }
  _closeFitModal() { this.selectedRec = null; }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    super.disconnectedCallback();
  }

  async _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    this.state = 'loading';
    try {
      const data = await fetchRecommendations({ view: 'all' });
      this.items = data.recommendations || [];
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  _onSortClick(c) {
    if (!c.sortKey) return;
    if (this.sortKey === c.sortKey) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = c.sortKey;
      // Numeric / date default to desc (highest/newest first), text asc.
      this.sortDir = (c.numeric || c.date) ? 'desc' : 'asc';
    }
  }

  _sorted() {
    const col = COLUMNS.find(c => c.sortKey === this.sortKey);
    if (!col) return this.items;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const get = (r) => {
      const v = r[col.sortKey];
      if (v == null) return col.numeric ? -Infinity : '';
      if (col.numeric) return Number(v);
      if (col.date) return Date.parse(v) || 0;
      return String(v).toLowerCase();
    };
    return [...this.items].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return  1 * dir;
      return 0;
    });
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
    return html`
      <tr>
        ${COLUMNS.map(c => {
          const cls = `col col-${c.id}`;
          if (!c.sortKey) return html`<th class=${cls}>${c.label}</th>`;
          const active = this.sortKey === c.sortKey;
          const arrow = active ? (this.sortDir === 'asc' ? '↑' : '↓') : '↕';
          return html`
            <th class=${cls}>
              <button class=${'th-sort' + (active ? ' is-active' : '')}
                      @click=${() => this._onSortClick(c)}>
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
          <button class=${fitClass(r.fitScore) + ' fit-pill--button'}
                  title="Tap to see the breakdown"
                  @click=${(e) => { e.stopPropagation(); this._openFitModal(r); }}>
            ${r.fitScore == null ? '—' : r.fitScore}
          </button>
        </td>
        <td class="col col-role role-cell" data-label="Role">
          <div class="role-cell__inner">
            ${this._renderLogo(r)}
            <div class="role-cell__text">
              <div class="role-cell__title">${r.title || '(untitled)'}</div>
              <div class="role-cell__company">${r.company || ''}</div>
            </div>
          </div>
        </td>
        <td class="col col-location" data-label="Location">
          ${r.location ? r.location : html`<span class="muted">—</span>`}
        </td>
        <td class="col col-sector" data-label="Source">
          <span class="rec-source">${r.sourceLabel || r.source || ''}</span>
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
                    ?disabled=${this.addingId === r.id}
                    @click=${() => this._onAdd(r)}>
              ${this.addingId === r.id ? 'Saving…' : 'Save'}
            </button>
            <button class="btn-dismiss" aria-label="Dismiss recommendation"
                    title="Dismiss"
                    @click=${() => this._onDismiss(r)}>×</button>
          </div>
        </td>
      </tr>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`
        <header class="recs-page__head">
          <h1>For You</h1>
        </header>
        <div class="pipeline-table-wrap">
          <table class="pipeline-table">
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
        <h1>Recommended for you</h1>
        <span class="muted">${rows.length} ${rows.length === 1 ? 'role' : 'roles'}</span>
      </header>
      ${rows.length === 0 ? html`
        <div class="placeholder">
          <h2>No recommendations yet</h2>
          <p>New ones land here as soon as the workers pull fresh roles.</p>
        </div>
      ` : html`
        <div class="pipeline-table-wrap">
          <table class="pipeline-table">
            <thead>${this._renderHeader()}</thead>
            <tbody>${rows.map(r => this._renderRow(r))}</tbody>
          </table>
        </div>
      `}
      ${renderFitModal(this.selectedRec, () => this._closeFitModal())}
    `;
  }
}

customElements.define('job-recommendations-table', JobRecommendationsTable);
