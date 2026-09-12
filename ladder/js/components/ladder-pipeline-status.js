// ladder-pipeline-status — permanent rail element showing email-scan
// state in plain language. Essentials only: an indicator dot, one label,
// and a progress count/bar while catching up. Light DOM (global tokens).
//
// States (derived from sourceHealth's gmail-jobs row):
//   catching-up   backlogLeft > 0                → live dot, "Catching up", X of Y + bar
//   paused-auth   needsReauth                    → error dot, "Paused — reconnect Gmail"
//   paused-funds  lastError matches credit sig   → error dot, "Paused — add AI credits"
//   attention     any other lastError            → warning dot, "Needs attention"
//   idle          none of the above              → subtle dot, "Up to date"
//
// The whole element links to the Inbox, where the banner carries the
// fix-it action — the rail never repeats the CTA, just the state.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchSourceHealth }] = await Promise.all([
  import('../pipeline.js' + V),
]);

const CREDIT_SIG = /credit balance is too low|AI extraction temporarily unavailable/i;
const POLL_IDLE_MS   = 60_000;
const POLL_ACTIVE_MS = 12_000;

export class LadderPipelineStatus extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    _gmail: { state: true },   // gmail-jobs sourceHealth row or null
  };

  constructor() {
    super();
    this._gmail = null;
    this._timer = null;
    this._onRefresh = () => this._load();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('job:pipeline:refresh', this._onRefresh);
    document.addEventListener('ctrl:auth:signedin', this._onRefresh);
    if (document.body.dataset.authState === 'in') this._load();
  }
  disconnectedCallback() {
    document.removeEventListener('job:pipeline:refresh', this._onRefresh);
    document.removeEventListener('ctrl:auth:signedin', this._onRefresh);
    if (this._timer) clearTimeout(this._timer);
    super.disconnectedCallback();
  }

  async _load() {
    if (document.body.dataset.authState !== 'in') return;
    try {
      const health = await fetchSourceHealth();
      this._gmail = health.find(s => s.type === 'gmail-jobs') || null;
    } catch { /* keep last known state */ }
    if (this._timer) clearTimeout(this._timer);
    const active = this._state().id !== 'idle';
    this._timer = setTimeout(() => this._load(), active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
  }

  _state() {
    const g = this._gmail;
    if (!g) return { id: 'idle', label: 'Up to date' };
    const left  = Number(g.backlogLeft || 0);
    const total = Number(g.backlogTotal || 0);
    if (g.needsReauth)                    return { id: 'paused', label: 'Paused — reconnect Gmail' };
    if (CREDIT_SIG.test(g.lastError || '')) return { id: 'paused', label: 'Paused — add AI credits' };
    if (left > 0 && total > 0)            return { id: 'active', label: 'Catching up', done: total - left, total };
    if (g.lastError)                      return { id: 'attention', label: 'Needs attention' };
    return { id: 'idle', label: 'Up to date' };
  }

  render() {
    const s = this._state();
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    return html`
      <a class="rail-status" data-state=${s.id} href="/ladder/jobs/recommended/"
         aria-label=${`Email scan: ${s.label}`}>
        <span class="rail-status__dot" aria-hidden="true"></span>
        <span class="rail-status__label">${s.label}</span>
        ${s.total ? html`<span class="rail-status__count">${s.done} of ${s.total}</span>` : nothing}
        ${s.total ? html`
          <span class="rail-status__bar" role="progressbar"
                aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100">
            <i style="width:${pct}%"></i>
          </span>` : nothing}
      </a>
    `;
  }
}

customElements.define('ladder-pipeline-status', LadderPipelineStatus);
