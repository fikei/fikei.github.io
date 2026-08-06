// ladder-gmail-scan — compact Gmail-scan status strip on the Inbox.
// Shows when the gmail-jobs source last ran, what the scan found today
// (recs + activity events + auto-created roles), and a "Scan now" button
// that force-runs the source and polls until the run completes. Data
// comes from the recommendations GET (sourceHealth + gmailStats) so the
// strip stays one cheap limit=1 fetch.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchRecommendations, refreshSources }] = await Promise.all([
  import('../pipeline.js' + V),
]);

// A pull run is ~30–90s. Poll on a slow cadence and give up (button
// re-enables) if the run never reports back — same tuning philosophy as
// the table's draining loader.
const SCAN_POLL_MS   = 8 * 1000;
const SCAN_MAX_MS    = 180 * 1000;

export class LadderGmailScan extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    stats:    { state: true },
    health:   { state: true },
    scanning: { state: true },
    state:    { state: true },
  };

  constructor() {
    super();
    this.stats = null;
    this.health = null;
    this.scanning = false;
    this.state = 'idle';
  }

  connectedCallback() {
    super.connectedCallback();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    this._maybeLoad();
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    if (this._pollTimer) clearInterval(this._pollTimer);
    super.disconnectedCallback();
  }

  _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    this._load();
  }

  async _load() {
    // Only the FIRST load gates rendering — refreshes (scan polling)
    // must not flip state away from 'loaded' or the strip unmounts for
    // the whole scan.
    const first = this.state !== 'loaded';
    if (first) this.state = 'loading';
    try {
      const d = await fetchRecommendations({ view: 'all', limit: 1 });
      this.health = (d.sourceHealth || []).find(s => s.type === 'gmail-jobs') || null;
      this.stats  = d.gmailStats || null;
      this.state = 'loaded';
    } catch (e) {
      console.warn('[gmail-scan] load failed', e);
      if (first) this.state = 'error';
    }
  }

  _foundToday() {
    const s = this.stats || {};
    return (s.recsToday || 0) + (s.eventsToday || 0);
  }

  _breakdownTitle() {
    const s = this.stats || {};
    return [
      `${s.recsToday || 0} role rec${s.recsToday === 1 ? '' : 's'}`,
      `${s.eventsToday || 0} activity update${s.eventsToday === 1 ? '' : 's'}`,
      `${s.rolesCreatedToday || 0} role${s.rolesCreatedToday === 1 ? '' : 's'} auto-created`,
      `${s.skippedToday || 0} email${s.skippedToday === 1 ? '' : 's'} skipped`,
    ].join(' · ');
  }

  _relTime(iso) {
    if (!iso) return 'never';
    const m = Math.floor((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  async _scanNow() {
    if (this.scanning) return;
    this.scanning = true;
    const kickAt = Date.now();
    try {
      await refreshSources({ force: true, sourceId: this.health?.id || null });
    } catch (e) {
      console.warn('[gmail-scan] kick failed', e);
    }
    const before = this._foundToday();
    // Poll until the source's lastRunAt advances past the kick (a run
    // completed), then re-read the counts once more.
    this._pollTimer = setInterval(async () => {
      try {
        await this._load();
        const ranAt = Date.parse(this.health?.lastRunAt || 0);
        const done = ranAt > kickAt;
        const timedOut = Date.now() - kickAt > SCAN_MAX_MS;
        if (done || timedOut) {
          clearInterval(this._pollTimer);
          this._pollTimer = null;
          this.scanning = false;
          if (done) {
            const delta = this._foundToday() - before;
            document.dispatchEvent(new CustomEvent('job:toast', {
              detail: { msg: delta > 0 ? `Scan complete — ${delta} new from Gmail` : 'Scan complete — nothing new from Gmail' },
            }));
            // Fresh recs/events may have landed; let open surfaces re-sync.
            document.dispatchEvent(new CustomEvent('job:pipeline:refresh'));
          }
        }
      } catch { /* keep polling until the cap */ }
    }, SCAN_POLL_MS);
  }

  render() {
    if (this.state !== 'loaded') return nothing;
    const lastRun = this.health?.lastRunAt || this.stats?.lastScanAt || null;
    const err = this.health?.lastError || this.stats?.lastError || null;
    const found = this._foundToday();
    return html`
      <section class="gmail-scan" aria-label="Gmail scan status">
        <strong>Gmail scan</strong>
        <span class="muted" title=${lastRun || 'never run'}>last run ${this._relTime(lastRun)}</span>
        <span class="muted" title=${this._breakdownTitle()}>·&nbsp; ${found} found today</span>
        ${err ? html`<span class="gmail-scan__err" title=${err}>⚠︎ ${err}</span>` : nothing}
        <button class="btn btn--sm" ?disabled=${this.scanning} @click=${() => this._scanNow()}>
          ${this.scanning ? 'Scanning…' : 'Scan now'}
        </button>
      </section>
    `;
  }
}

customElements.define('ladder-gmail-scan', LadderGmailScan);
