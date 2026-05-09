// job-rail — left rail nav. Light DOM (uses global tokens/components.css).
// Theme toggle now lives in <job-footer> at the bottom of the page.
// Pages compose: <div class="app"><job-rail></job-rail><main class="app__main">…</main><job-footer></job-footer></div>
import { LitElement, html } from 'https://esm.run/lit@3';

const ROUTES = [
  { href: '/job/jobs/',    label: 'Jobs',        match: /^\/job\/jobs\/?/ },
  { href: '/job/history/', label: 'Your career', match: /^\/job\/history\/?/ },
  { href: '/job/vision/',  label: 'Vision',      match: /^\/job\/vision\/?/ }
];

export class JobRail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    path:  { state: true }
  };

  constructor() {
    super();
    this.path = location.pathname;
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
            ${ROUTES.map(r => html`
              <li>
                <a href=${r.href}
                   aria-current=${r.match.test(this.path) ? 'page' : 'false'}>
                  ${r.label}
                </a>
              </li>
            `)}
          </ul>
        </nav>
      </aside>
    `;
  }
}

customElements.define('job-rail', JobRail);
