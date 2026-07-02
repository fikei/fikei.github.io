// job-rail — left rail nav. Light DOM (uses global tokens/components.css).
// Theme toggle now lives in <ladder-footer> at the bottom of the page.
// Pages compose: <div class="app"><ladder-rail></ladder-rail><main class="app__main">…</main><ladder-footer></ladder-footer></div>
import { LitElement, html } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const [{ fetchPipeline, fetchRecommendations }] = await Promise.all([
  import('../pipeline.js' + V),
]);

// Bucket-assignment for pipeline rows — mirrors job-pipeline.js exactly.
// Kept in sync by hand. Status taxonomy is now 3 values.
function bucketFor(r) {
  switch (r.status) {
    case 'Active':  return 'active';
    case 'Archive': return 'archive';
    default:        return 'leads';
  }
}
function isVisibleRole(r) {
  if (!r.url) return false;
  const company = (r.company || '').toLowerCase();
  if (company === 'strava') return false;
  if (/(^|\.)strava\.com\b/i.test(r.url)) return false;
  return true;
}

// Each Jobs sub-item is either a bucket-filter on /ladder/jobs/ (matched
// by `bucket`) or a real sub-page (matched by `path` prefix). The
// renderer below uses `path ? prefix-match : bucket-equality` to decide
// aria-current — so when we're on a sub-page like /ladder/jobs/recommended/,
// none of the bucket items light up.
//
// `countKey` says which count to show; Archive deliberately omits it.
const ROUTES = [
  {
    href: '/ladder/jobs/',
    label: 'Jobs',
    match: /^\/ladder\/jobs\/?/,
    sub: [
      { href: '/ladder/jobs/recommended/',      label: 'For You',              path: '/ladder/jobs/recommended/', countKey: 'recommended' },
      { href: '/ladder/jobs/?bucket=leads',     label: 'Saved',                bucket: 'leads',                countKey: 'leads' },
      { href: '/ladder/jobs/?bucket=active',    label: 'Active',               bucket: 'active',               countKey: 'active' },
      { href: '/ladder/jobs/?bucket=archive',   label: 'Archive',              bucket: 'archive' },
    ],
  },
  { href: '/ladder/history/',  label: 'Your career', match: /^\/ladder\/history\/?/ },
  { href: '/ladder/vision/',   label: 'Search plan', match: /^\/ladder\/vision\/?/ },
  { href: '/ladder/settings/', label: 'Settings',    match: /^\/ladder\/settings\/?/ }
];

export class JobRail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    path:   { state: true },
    bucket: { state: true },
    counts: { state: true },        // { leads, active, recommended } or null
  };

  constructor() {
    super();
    this.path = location.pathname;
    this.bucket = new URLSearchParams(location.search).get('bucket') || 'leads';
    this.counts = null;
    this._onBucket = (e) => { this.bucket = e.detail.bucket; };
    this._onAuth = () => this._loadCounts();
    this._onRefresh = () => this._loadCounts({ force: true });
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('job:jobs:bucket', this._onBucket);
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    // Other components emit this after they add/dismiss a role; refresh
    // our counts so the sub-nav numbers stay truthful.
    document.addEventListener('job:pipeline:refresh', this._onRefresh);
    if (document.body.dataset.authState === 'in') this._loadCounts();
  }
  disconnectedCallback() {
    document.removeEventListener('job:jobs:bucket', this._onBucket);
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('job:pipeline:refresh', this._onRefresh);
    super.disconnectedCallback();
  }

  // Fetch both pipeline + active recs in parallel. Cheap (already cached
  // server-side for the pages that use them); the result drives the
  // count chips next to Saved / Active / Recommended for you.
  async _loadCounts({ force = false } = {}) {
    if (document.body.dataset.authState !== 'in') return;
    if (!force && this._loading) return;
    this._loading = true;
    try {
      const [pipe, recs] = await Promise.all([
        fetchPipeline().catch(() => null),
        // floor=1 so the badge matches what the For You page actually
        // shows by default (fit >= 50, strength >= 50, no hard fails).
        // limit:1 — we only need `total`, not a page of rows.
        fetchRecommendations({ view: 'all', floor: true, limit: 1 }).catch(() => null),
      ]);
      const roles = (pipe?.roles || []).filter(isVisibleRole);
      const leads  = roles.filter(r => bucketFor(r) === 'leads').length;
      const active = roles.filter(r => bucketFor(r) === 'active').length;
      // `total` is the true count of all matching recs; `count` is only the
      // returned page size (caps at the server's page limit, e.g. 100).
      const recommended = recs?.total ?? recs?.count ?? (recs?.recommendations?.length ?? 0);
      this.counts = { leads, active, recommended };
      // Broadcast so other mobile chrome (the segmented .subnav-bar in
      // app.js) can pull the same counts without re-fetching.
      document.dispatchEvent(new CustomEvent('job:rail:counts', { detail: this.counts }));
    } finally {
      this._loading = false;
    }
  }

  _renderCount(key) {
    if (!key) return '';
    if (!this.counts) return '';
    const n = this.counts[key];
    if (n == null) return '';
    return html`<span class="nav-count">${n}</span>`;
  }

  render() {
    return html`
      <aside class="app__rail">
        <a class="brand" href="/ladder/">
          <span class="brand__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="6.5" y1="2.5" x2="6.5" y2="21.5"/>
              <line x1="17.5" y1="2.5" x2="17.5" y2="21.5"/>
              <line x1="6.5" y1="7" x2="17.5" y2="7"/>
              <line x1="6.5" y1="12" x2="17.5" y2="12"/>
              <line x1="6.5" y1="17" x2="17.5" y2="17"/>
            </svg>
          </span>
          <span class="brand__text">Ladder</span>
        </a>
        <nav>
          <ul class="nav-list">
            ${ROUTES.map(r => {
              const active = r.match.test(this.path);
              return html`
                <li>
                  <a href=${r.href}
                     aria-current=${active ? 'page' : 'false'}>
                    ${r.label}
                  </a>
                  ${active && r.sub ? html`
                    <ul class="nav-sublist">
                      ${r.sub.map(s => {
                        // Path-based sub-items (real sub-pages) win out
                        // over bucket-based ones — when we're on
                        // /ladder/jobs/recommended/, no bucket should look
                        // active.
                        const onSubPath = r.sub.some(x => x.path && this.path.startsWith(x.path));
                        const subActive = s.path
                          ? this.path.startsWith(s.path)
                          : (!onSubPath && this.bucket === s.bucket);
                        return html`
                          <li>
                            <a href=${s.href} aria-current=${subActive ? 'page' : 'false'}>
                              <span class="nav-sub__label">${s.label}</span>
                              ${this._renderCount(s.countKey)}
                            </a>
                          </li>
                        `;
                      })}
                    </ul>
                  ` : ''}
                </li>
              `;
            })}
          </ul>
        </nav>
      </aside>
    `;
  }
}

customElements.define('ladder-rail', JobRail);
