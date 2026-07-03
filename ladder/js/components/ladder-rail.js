// job-rail — left rail nav. Light DOM (uses global tokens/components.css).
// J&J-style: line icons (primary nav only — DESIGN.md rule 7 amendment),
// 48px rows, right-aligned count badges, user identity pinned at the bottom.
// Pages compose: <div class="app"><ladder-rail></ladder-rail><main class="app__main">…</main><ladder-footer></ladder-footer></div>
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
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

// Primary-nav line icons — 20px, 1.8 stroke, inherit currentColor.
// The ONLY place icons are allowed (DESIGN.md rule 7). Keep in sync with
// the mobile drawer copy in app.js.
export const NAV_ICONS = {
  inbox: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`,
  jobs: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  profile: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  plan: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};

// Nav taxonomy: Inbox is top-level (the daily loop shouldn't hide under
// Jobs); Jobs holds the pipeline buckets. Sub-items are either a
// bucket-filter on /ladder/jobs/ (matched by `bucket`) or a real sub-page
// (matched by `path` prefix). `countKey` says which count to show.
// Bucket VALUES ('active') are the data model; labels are display-only.
const ROUTES = [
  { href: '/ladder/jobs/recommended/', label: 'Inbox', icon: 'inbox',
    match: /^\/ladder\/jobs\/recommended\/?/, countKey: 'recommended' },
  {
    href: '/ladder/jobs/',
    label: 'Jobs',
    icon: 'jobs',
    match: /^\/ladder\/jobs(?!\/recommended)\/?/,
    sub: [
      { href: '/ladder/jobs/?bucket=leads',     label: 'Saved',       bucket: 'leads',   countKey: 'leads' },
      { href: '/ladder/jobs/?bucket=active',    label: 'In progress', bucket: 'active',  countKey: 'active' },
      { href: '/ladder/jobs/?bucket=archive',   label: 'Archive',     bucket: 'archive' },
    ],
  },
  { href: '/ladder/history/',  label: 'Profile',     icon: 'profile',  match: /^\/ladder\/history\/?/ },
  { href: '/ladder/vision/',   label: 'Search plan', icon: 'plan',     match: /^\/ladder\/vision\/?/ },
  { href: '/ladder/settings/', label: 'Settings',    icon: 'settings', match: /^\/ladder\/settings\/?/ }
];

export class JobRail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    path:   { state: true },
    bucket: { state: true },
    counts: { state: true },        // { leads, active, recommended } or null
    email:  { state: true },
  };

  constructor() {
    super();
    this.path = location.pathname;
    this.bucket = new URLSearchParams(location.search).get('bucket') || 'leads';
    this.counts = null;
    this.email = window.CtrlAuth?.getUser?.()?.email || '';
    this._onBucket = (e) => { this.bucket = e.detail.bucket; };
    this._onAuth = (e) => {
      this.email = e?.detail?.email || window.CtrlAuth?.getUser?.()?.email || this.email;
      this._loadCounts();
    };
    this._onRefresh = () => this._loadCounts({ force: true });
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('job:jobs:bucket', this._onBucket);
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    // Other components emit this after they add/dismiss a role; refresh
    // our counts so the nav numbers stay truthful.
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
  // count chips next to Inbox / Saved / In progress.
  async _loadCounts({ force = false } = {}) {
    if (document.body.dataset.authState !== 'in') return;
    if (!force && this._loading) return;
    this._loading = true;
    try {
      const [pipe, recs] = await Promise.all([
        fetchPipeline().catch(() => null),
        // floor=1 so the badge matches what the Inbox actually shows by
        // default (fit >= 50, strength >= 50, no hard fails).
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
      // Broadcast so other mobile chrome (the drawer + segmented .subnav-bar
      // in app.js) can pull the same counts without re-fetching.
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
    // A path-anchored top-level route (Inbox) wins over prefix routes
    // (Jobs) so both never light up at once.
    const inboxActive = ROUTES[0].match.test(this.path);
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
            ${ROUTES.map((r, i) => {
              const active = r.match.test(this.path) && !(i > 0 && inboxActive);
              return html`
                <li>
                  <a href=${r.href}
                     aria-current=${active ? 'page' : 'false'}>
                    ${r.icon ? html`<span class="nav-icon" aria-hidden="true">${unsafeHTML(NAV_ICONS[r.icon])}</span>` : nothing}
                    <span class="nav-label">${r.label}</span>
                    ${this._renderCount(r.countKey)}
                  </a>
                  ${active && r.sub ? html`
                    <ul class="nav-sublist">
                      ${r.sub.map(s => {
                        const subActive = this.bucket === s.bucket;
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
        ${this.email ? html`
          <div class="rail-user">
            <span class="rail-user__dot" aria-hidden="true"></span>
            <span class="rail-user__email">${this.email}</span>
          </div>
        ` : nothing}
      </aside>
    `;
  }
}

customElements.define('ladder-rail', JobRail);
