// ladder-watched-companies — the green-lit watched company strip on the
// For You page. Add a company by name (server resolves the careers
// backend), pick how its roles surface via the per-company filter mode,
// disable or remove a watch. Also listens for job:watch:added events so
// the recs-table "Watch <company>" menu action refreshes the strip.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchWatchedCompanies, watchCompany, updateWatchedCompany, unwatchCompany }] = await Promise.all([
  import('../pipeline.js' + V),
]);

const FILTER_MODES = [
  { value: 'all',         label: 'Any role',        hint: 'Every role the watch pulls, regardless of score' },
  { value: 'role_level',  label: 'My role & level', hint: 'Roles that match your role and seniority — no fit-score floor' },
  { value: 'good_fits',   label: 'Good fits',       hint: 'Standard For You gates (fit ≥50, strength ≥30)' },
  { value: 'exceptional', label: 'Exceptional only', hint: 'Only roles graded 60+ candidate strength' },
];

export class LadderWatchedCompanies extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    watches:  { state: true },
    state:    { state: true },
    adding:   { state: true },
    newName:  { state: true },
    error:    { state: true },
  };

  constructor() {
    super();
    this.watches = [];
    this.state = 'idle';
    this.adding = false;
    this.newName = '';
    this.error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    this._onWatchAdded = () => this._load();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    document.addEventListener('job:watch:added', this._onWatchAdded);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('job:watch:added', this._onWatchAdded);
    super.disconnectedCallback();
  }

  _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    this._load();
  }

  async _load() {
    this.state = 'loading';
    try {
      this.watches = await fetchWatchedCompanies();
      this.state = 'loaded';
    } catch (e) {
      console.warn('[watched-companies] load failed', e);
      this.state = 'error';
    }
  }

  async _onAdd(e) {
    e.preventDefault();
    const company = this.newName.trim();
    if (!company || this.adding) return;
    this.adding = true;
    this.error = '';
    try {
      await watchCompany({ company });
      this.newName = '';
      await this._load();
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: `Watching ${company} — roles land on the next pull` } }));
    } catch (err) {
      this.error = err.message || String(err);
    } finally {
      this.adding = false;
    }
  }

  async _onModeChange(w, mode) {
    const prev = w.filterMode;
    w.filterMode = mode;
    this.requestUpdate();
    try {
      await updateWatchedCompany(w.id, { filterMode: mode });
    } catch (e) {
      w.filterMode = prev;
      this.requestUpdate();
      console.warn('[watched-companies] mode update failed', e);
    }
  }

  async _onRemove(w) {
    if (!confirm(`Stop watching ${w.company}? Its active recommendations will be dismissed.`)) return;
    this.watches = this.watches.filter(x => x.id !== w.id);
    try { await unwatchCompany(w.id); } catch (e) { console.warn('[watched-companies] remove failed', e); this._load(); }
  }

  _relTime(iso) {
    if (!iso) return 'never';
    const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (m < 60) return `${Math.max(1, m)}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  render() {
    if (this.state === 'idle' || this.state === 'error') return nothing;
    return html`
      <section class="watched-strip" aria-label="Watched companies">
        <header class="watched-strip__head">
          <h2>Watched companies</h2>
          <span class="muted">Roles pulled straight from each company's careers page</span>
        </header>
        <div class="watched-strip__row">
          ${this.watches.map(w => html`
            <div class="watched-chip ${w.enabled ? '' : 'watched-chip--off'}">
              <div class="watched-chip__main">
                <strong>${w.company}</strong>
                <span class="muted watched-chip__meta"
                      title=${w.lastError ? `Last error: ${w.lastError}` : `Last pulled ${this._relTime(w.lastPulledAt)}`}>
                  ${w.lastError ? '⚠︎' : ''} ${w.activeRecs ?? 0} active · ${this._relTime(w.lastPulledAt)}
                </span>
              </div>
              <select class="watched-chip__mode" .value=${w.filterMode}
                      title=${FILTER_MODES.find(m => m.value === w.filterMode)?.hint || ''}
                      @change=${(e) => this._onModeChange(w, e.target.value)}>
                ${FILTER_MODES.map(m => html`
                  <option value=${m.value} ?selected=${m.value === w.filterMode} title=${m.hint}>${m.label}</option>
                `)}
              </select>
              <button class="watched-chip__remove" aria-label=${`Stop watching ${w.company}`}
                      title="Stop watching" @click=${() => this._onRemove(w)}>×</button>
            </div>
          `)}
          <form class="watched-add" @submit=${(e) => this._onAdd(e)}>
            <input type="text" placeholder="Watch a company…" maxlength="60"
                   .value=${this.newName}
                   @input=${(e) => { this.newName = e.target.value; this.error = ''; }}
                   ?disabled=${this.adding}>
            <button class="btn btn--sm" type="submit" ?disabled=${this.adding || !this.newName.trim()}>
              ${this.adding ? 'Resolving…' : '+ Watch'}
            </button>
          </form>
        </div>
        ${this.error ? html`<p class="watched-strip__error">${this.error}</p>` : nothing}
      </section>
    `;
  }
}

customElements.define('ladder-watched-companies', LadderWatchedCompanies);
