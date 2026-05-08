// job-pipeline — pipeline table view. Reads from jobs-pipe and renders
// rows sorted by Fit Score desc.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { fetchPipeline } from '../pipeline.js';

const STATUS_OPTIONS = ['', 'New', 'Apply', 'Talking', 'Applied', 'Pass', 'Rejected', 'Closed', 'Not Listed', 'Nudge / Network'];

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
  }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
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
          <label>Min Fit ${this.minFit}</label>
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

  _renderRow(r) {
    return html`
      <tr>
        <td><span class=${this._scoreClass(r.score)} title=${r.hardFails.length ? 'Hard fails: ' + r.hardFails.join(', ') : ''}>${r.score}</span></td>
        <td>${r.status || html`<span class="muted">—</span>`}</td>
        <td><strong>${r.company}</strong></td>
        <td>${r.title}</td>
        <td><span class="muted">${r.sector || ''}</span></td>
        <td><span class="muted">${r.salary || ''}</span></td>
        <td><span class="muted">${r.source || ''}</span></td>
        <td>
          ${r.url ? html`<a href=${r.url} target="_blank" rel="noopener noreferrer">↗</a>` : nothing}
        </td>
      </tr>
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
        Showing <strong>${rows.length}</strong> of ${this.roles.length} roles, sorted by Fit Score.
      </div>
      <div class="pipeline-table-wrap">
        <table class="pipeline-table">
          <thead>
            <tr>
              <th>Fit</th>
              <th>Status</th>
              <th>Company</th>
              <th>Role</th>
              <th>Sector</th>
              <th>Salary</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows.map(r => this._renderRow(r))}</tbody>
        </table>
      </div>
    `;
  }
}

customElements.define('job-pipeline', JobPipeline);
