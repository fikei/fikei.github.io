// job-home — mobile-only hub page. Renders at /job/ (root) and gives the
// user a directory of the app: Jobs (with For You carousel + counts),
// Career, Search plan, Settings. Replaces the drawer pattern on phones —
// instead of opening a slide-out nav, the user navigates by tapping a
// big section card. Desktop is unaffected; app.js redirects /job/ → /jobs/
// for non-mobile viewports.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchPipeline, fetchRecommendations }] = await Promise.all([
  import('../pipeline.js' + V),
]);

function isVisibleRole(r) {
  if (!r.url) return false;
  const company = (r.company || '').toLowerCase();
  if (company === 'strava') return false;
  if (/(^|\.)strava\.com\b/i.test(r.url)) return false;
  return true;
}
function bucketOf(r) {
  if (r.status === 'Active') return 'active';
  if (r.status === 'Archive') return 'archive';
  return 'leads';
}

export class JobHome extends LitElement {
  createRenderRoot() { return this; }
  static properties = {
    counts: { state: true },
    topRecs: { state: true },
  };

  constructor() {
    super();
    this.counts = null;
    this.topRecs = null;
    this._onAuth = () => this._loadAll();
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    if (document.body.dataset.authState === 'in') this._loadAll();
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    super.disconnectedCallback();
  }

  async _loadAll() {
    if (document.body.dataset.authState !== 'in') return;
    if (this._loading) return;
    this._loading = true;
    try {
      const [pipe, recs] = await Promise.all([
        fetchPipeline().catch(() => null),
        fetchRecommendations({ view: 'top' }).catch(() => null),
      ]);
      const roles = (pipe?.roles || []).filter(isVisibleRole);
      const leads  = roles.filter(r => bucketOf(r) === 'leads').length;
      const active = roles.filter(r => bucketOf(r) === 'active').length;
      const recommended = recs?.count ?? (recs?.recommendations?.length ?? 0);
      this.counts = { leads, active, recommended };
      this.topRecs = (recs?.recommendations || []).slice(0, 5);
    } finally {
      this._loading = false;
    }
  }

  _renderRecCard(rec) {
    const initial = (rec.company || '·').slice(0, 1).toUpperCase();
    return html`
      <a class="home-rec" href="/job/jobs/recommended/">
        <div class="home-rec__logo" aria-hidden="true">${initial}</div>
        <div class="home-rec__body">
          <span class="home-rec__title">${rec.title || 'Untitled role'}</span>
          <span class="home-rec__sub">${rec.company || ''}${rec.location ? ` · ${rec.location}` : ''}</span>
        </div>
        <span class="home-rec__fit">${Number.isFinite(rec.fit) ? rec.fit : ''}</span>
      </a>
    `;
  }

  render() {
    const c = this.counts || { leads: '—', active: '—', recommended: '—' };
    return html`
      <section class="home">
        <h1 class="home__title">/ job</h1>
        <p class="home__sub">Ian's career knowledge base.</p>

        <a class="home-card home-card--jobs" href="/job/jobs/">
          <div class="home-card__head">
            <h2>Jobs</h2>
            <span class="home-card__arrow" aria-hidden="true">→</span>
          </div>
          <div class="home-card__metrics">
            <span><strong>${c.recommended}</strong> for you</span>
            <span><strong>${c.leads}</strong> saved</span>
            <span><strong>${c.active}</strong> active</span>
          </div>
          ${this.topRecs && this.topRecs.length ? html`
            <div class="home-card__list">
              ${this.topRecs.map(r => this._renderRecCard(r))}
            </div>
          ` : nothing}
        </a>

        <a class="home-card" href="/job/history/">
          <div class="home-card__head">
            <h2>Your career</h2>
            <span class="home-card__arrow" aria-hidden="true">→</span>
          </div>
          <p class="home-card__hint">Companies, roles, and the narratives that go in your résumé.</p>
        </a>

        <a class="home-card" href="/job/vision/">
          <div class="home-card__head">
            <h2>Search plan</h2>
            <span class="home-card__arrow" aria-hidden="true">→</span>
          </div>
          <p class="home-card__hint">Goals and intents that shape the recommendations.</p>
        </a>

        <a class="home-card" href="/job/settings/">
          <div class="home-card__head">
            <h2>Settings</h2>
            <span class="home-card__arrow" aria-hidden="true">→</span>
          </div>
          <p class="home-card__hint">Theme, profile, onboarding.</p>
        </a>
      </section>
    `;
  }
}

customElements.define('job-home', JobHome);
