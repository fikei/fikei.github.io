// job-rail — left rail nav. Light DOM (uses global tokens/components.css).
// Theme toggle now lives in <job-footer> at the bottom of the page.
// Pages compose: <div class="app"><job-rail></job-rail><main class="app__main">…</main><job-footer></job-footer></div>
import { LitElement, html } from 'https://esm.run/lit@3';

// Each Jobs sub-item is either a bucket-filter on /job/jobs/ (matched
// by `bucket`) or a real sub-page (matched by `path` prefix). The
// renderer below uses `path ? prefix-match : bucket-equality` to decide
// aria-current — so when we're on a sub-page like /job/jobs/recommended/,
// none of the bucket items light up.
const ROUTES = [
  {
    href: '/job/jobs/',
    label: 'Jobs',
    match: /^\/job\/jobs\/?/,
    sub: [
      { href: '/job/jobs/?bucket=leads',     label: 'Saved',                bucket: 'leads' },
      { href: '/job/jobs/?bucket=active',    label: 'Active',               bucket: 'active' },
      { href: '/job/jobs/?bucket=archive',   label: 'Archive',              bucket: 'archive' },
      { href: '/job/jobs/recommended/',      label: 'Recommended for you',  path: '/job/jobs/recommended/' },
    ],
  },
  { href: '/job/history/', label: 'Your career', match: /^\/job\/history\/?/ },
  { href: '/job/vision/',  label: 'Search plan', match: /^\/job\/vision\/?/ }
];

export class JobRail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    path:  { state: true },
    bucket: { state: true },
  };

  constructor() {
    super();
    this.path = location.pathname;
    this.bucket = new URLSearchParams(location.search).get('bucket') || 'leads';
    this._onBucket = (e) => { this.bucket = e.detail.bucket; };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('job:jobs:bucket', this._onBucket);
  }
  disconnectedCallback() {
    document.removeEventListener('job:jobs:bucket', this._onBucket);
    super.disconnectedCallback();
  }

  render() {
    return html`
      <aside class="app__rail">
        <div class="brand">
          ctrl.rodeo
          <span class="brand__sub">/ job</span>
        </div>
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
                        // /job/jobs/recommended/, no bucket should look
                        // active.
                        const onSubPath = r.sub.some(x => x.path && this.path.startsWith(x.path));
                        const subActive = s.path
                          ? this.path.startsWith(s.path)
                          : (!onSubPath && this.bucket === s.bucket);
                        return html`
                          <li>
                            <a href=${s.href} aria-current=${subActive ? 'page' : 'false'}>
                              ${s.label}
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

customElements.define('job-rail', JobRail);
