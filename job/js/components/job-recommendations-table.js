// job-recommendations-table — full sortable list for /job/jobs/recommended/.
// Pulls the ?view=all variant so it includes recs below the carousel's
// fit-score floor. Records persist in the DB regardless of what shows;
// this view is the audit trail.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchRecommendations, dismissRecommendation, addRole }] = await Promise.all([
  import('../pipeline.js' + V),
]);

const COLUMNS = [
  { key: 'fitScore',    label: 'Fit',      align: 'right', sortable: true, numeric: true },
  { key: 'title',       label: 'Title',    align: 'left',  sortable: true },
  { key: 'company',     label: 'Company',  align: 'left',  sortable: true },
  { key: 'location',    label: 'Location', align: 'left',  sortable: true },
  { key: 'source',      label: 'Source',   align: 'left',  sortable: true },
  { key: 'sourceLabel', label: 'Detail',   align: 'left',  sortable: true },
  { key: 'suggestedAt', label: 'Added',    align: 'left',  sortable: true, date: true },
  { key: 'actions',     label: '',         align: 'right', sortable: false },
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
    state:   { state: true },
    items:   { state: true },
    error:   { state: true },
    sortKey: { state: true },
    sortDir: { state: true },         // 'asc' | 'desc'
    addingId: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.items = [];
    this.error = '';
    // Default sort: fit score desc — same order as the widget.
    this.sortKey = 'fitScore';
    this.sortDir = 'desc';
    this.addingId = null;
  }

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

  _onSort(col) {
    if (!col.sortable) return;
    if (this.sortKey === col.key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = col.key;
      // Numeric and date columns default to desc (highest/newest first);
      // text columns default to asc (A→Z).
      this.sortDir = (col.numeric || col.date) ? 'desc' : 'asc';
    }
  }

  _sorted() {
    const col = COLUMNS.find(c => c.key === this.sortKey);
    if (!col) return this.items;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    const get = (r) => {
      const v = r[col.key];
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
    } catch (e) {
      console.warn('[recs-table] add failed', e);
    } finally {
      this.addingId = null;
    }
  }

  _renderHeader() {
    return html`
      <tr>
        ${COLUMNS.map(c => {
          const sorted = this.sortKey === c.key;
          const ariaSort = sorted ? (this.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
          return html`
            <th
              style=${`text-align:${c.align}`}
              ?data-sortable=${c.sortable}
              aria-sort=${ariaSort}
              @click=${() => this._onSort(c)}>
              ${c.label}
            </th>
          `;
        })}
      </tr>
    `;
  }

  _renderRow(r) {
    return html`
      <tr>
        <td style="text-align:right">
          ${r.fitScore != null
            ? html`<span class=${fitClass(r.fitScore)} title="Fit score">${r.fitScore}</span>`
            : html`<span class="muted">—</span>`}
        </td>
        <td class="recs-table__title">
          <a href=${r.url} target="_blank" rel="noopener">${r.title || '(untitled)'}</a>
        </td>
        <td>${r.company || ''}</td>
        <td>${r.location || ''}</td>
        <td class="recs-table__source">${r.source || ''}</td>
        <td class="recs-table__source">${r.sourceLabel || ''}</td>
        <td>${r.suggestedAt ? relTime(r.suggestedAt) : ''}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn--sm btn--accent"
                  ?disabled=${this.addingId === r.id}
                  @click=${() => this._onAdd(r)}>
            ${this.addingId === r.id ? 'Saving…' : 'Save'}
          </button>
          <button class="link-subtle" @click=${() => this._onDismiss(r)}>Dismiss</button>
        </td>
      </tr>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`<p class="muted">Loading recommendations…</p>`;
    }
    if (this.state === 'error') {
      return html`<p class="muted">Couldn't load recommendations: ${this.error}</p>`;
    }
    const rows = this._sorted();
    return html`
      <header class="recs-page__head">
        <h1>Recommended for you</h1>
        <span class="muted">${rows.length} ${rows.length === 1 ? 'role' : 'roles'}</span>
      </header>
      ${rows.length === 0
        ? html`<div class="recs-table__empty">No recommendations yet. New ones land here as soon as the workers pull fresh roles.</div>`
        : html`
            <div class="recs-table-wrap">
              <table class="recs-table">
                <thead>${this._renderHeader()}</thead>
                <tbody>${rows.map(r => this._renderRow(r))}</tbody>
              </table>
            </div>
          `}
    `;
  }
}

customElements.define('job-recommendations-table', JobRecommendationsTable);
