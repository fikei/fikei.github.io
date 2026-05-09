// job-footer — global page footer with theme toggle + version.
// Lives at the bottom of the .app grid (grid-area: footer).
import { LitElement, html } from 'https://esm.run/lit@3';

const THEMES = [
  { value: 'generic-light', label: 'Generic · Light' },
  { value: 'generic-dark',  label: 'Generic · Dark' },
  { value: 'ctrl-light',    label: 'CTRL · Light' },
  { value: 'ctrl-dark',     label: 'CTRL · Dark' }
];

export class JobFooter extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    theme: { state: true },
  };

  constructor() {
    super();
    this.theme = window.JobTheme?.get() || 'generic-light';
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
      <footer class="app__footer">
        <div>
          <span class="footer__brand">ctrl.rodeo / job</span>
          ${window.JOB_VERSION ? html`<span class="footer__version" style="margin-left:var(--space-3);">${window.JOB_VERSION}</span>` : ''}
        </div>
        <div class="footer__controls">
          <label class="theme-toggle">
            Theme
            <select @change=${this._setTheme}>
              ${THEMES.map(t => html`
                <option value=${t.value} ?selected=${t.value === this.theme}>${t.label}</option>
              `)}
            </select>
          </label>
        </div>
      </footer>
    `;
  }
}

customElements.define('job-footer', JobFooter);
