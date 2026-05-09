// job-rail — left rail nav + theme toggle. Light DOM (uses global tokens/components.css).
// Pages compose: <div class="app"><job-rail></job-rail><main class="app__main">…</main></div>
import { LitElement, html } from 'https://esm.run/lit@3';

const ROUTES = [
  { href: '/job/jobs/',    label: 'Jobs',        match: /^\/job\/jobs\/?/ },
  { href: '/job/history/', label: 'Your career', match: /^\/job\/history\/?/ },
  { href: '/job/vision/',  label: 'Vision',      match: /^\/job\/vision\/?/ }
];

const THEMES = [
  { value: 'generic-light', label: 'Generic · Light' },
  { value: 'generic-dark',  label: 'Generic · Dark' },
  { value: 'ctrl-light',    label: 'CTRL · Light' },
  { value: 'ctrl-dark',     label: 'CTRL · Dark' }
];

export class JobRail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    theme: { state: true },
    path:  { state: true }
  };

  constructor() {
    super();
    this.theme = window.JobTheme?.get() || 'generic-light';
    this.path = location.pathname;
    this._onTheme = (e) => { this.theme = e.detail.theme; };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('job:theme:changed', this._onTheme);
  }
  disconnectedCallback() {
    document.removeEventListener('job:theme:changed', this._onTheme);
    super.disconnectedCallback();
  }

  _setTheme(e) { window.JobTheme?.set(e.target.value); }

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
        <div class="rail-foot">
          <label class="theme-toggle">
            Theme
            <select @change=${this._setTheme} .value=${this.theme}>
              ${THEMES.map(t => html`
                <option value=${t.value} ?disabled=${t.disabled}>${t.label}</option>
              `)}
            </select>
          </label>
          <div style="font-size:var(--font-size-caption);color:var(--fg-subtle);">${window.JOB_VERSION || ''}</div>
        </div>
      </aside>
    `;
  }
}

customElements.define('job-rail', JobRail);
