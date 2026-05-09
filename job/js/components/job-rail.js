// job-rail — left rail nav. Light DOM (uses global tokens/components.css).
// Theme toggle now lives in <job-footer> at the bottom of the page.
// Pages compose: <div class="app"><job-rail></job-rail><main class="app__main">…</main><job-footer></job-footer></div>
import { LitElement, html } from 'https://esm.run/lit@3';

const ROUTES = [
  {
    href: '/job/jobs/',
    label: 'Jobs',
    match: /^\/job\/jobs\/?/,
    sub: [
      { href: '/job/jobs/?bucket=leads',   label: 'Leads',   bucket: 'leads' },
      { href: '/job/jobs/?bucket=active',  label: 'Active',  bucket: 'active' },
      { href: '/job/jobs/?bucket=archive', label: 'Archive', bucket: 'archive' },
    ],
  },
  { href: '/job/history/', label: 'Your career', match: /^\/job\/history\/?/ },
  { href: '/job/vision/',  label: 'Vision',      match: /^\/job\/vision\/?/ }
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
                      ${r.sub.map(s => html`
                        <li>
                          <a href=${s.href}
                             aria-current=${this.bucket === s.bucket ? 'page' : 'false'}>
                            ${s.label}
                          </a>
                        </li>
                      `)}
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
