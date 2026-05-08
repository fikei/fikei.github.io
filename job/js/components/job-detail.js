// job-detail — generic drilldown view for /job/history/{kind}/{slug}/.
// Reads ?kind= & ?slug= from the query, fetches the corresponding markdown
// from fikei/job, renders with the wiki-link-aware renderer, and restores
// the pretty URL via history.replaceState.
import { LitElement, html } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
import { renderMarkdown } from '../markdown.js';

const KIND_DIR = {
  companies: '01-job-history/companies',
  projects:  '01-job-history/projects',
  skills:    '01-job-history/skills',
  wins:      '01-job-history/wins',
  roles:     '01-job-history/roles',
};

const KIND_LABEL = {
  companies: 'Companies',
  projects:  'Projects',
  skills:    'Skills',
  wins:      'Wins',
  roles:     'Roles',
};

export class JobDetail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    title: { state: true },
    body:  { state: true },
    kind:  { state: true },
    slug:  { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.title = '';
    this.body = '';
    const params = new URLSearchParams(location.search);
    this.kind = (params.get('kind') || '').toLowerCase();
    this.slug = (params.get('slug') || '').toLowerCase();

    // Restore the pretty URL captured in 404.html.
    const pretty = sessionStorage.getItem('job:prettyPath');
    if (pretty && /^\/job\/history\/[a-z]+\/[a-z0-9_-]+\/?$/.test(pretty)) {
      sessionStorage.removeItem('job:prettyPath');
      history.replaceState(null, '', pretty);
    } else if (this.kind && this.slug) {
      history.replaceState(null, '', `/job/history/${this.kind}/${this.slug}/`);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    super.disconnectedCallback();
  }

  async _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    if (!KIND_DIR[this.kind] || !this.slug) {
      this.state = 'error';
      this.error = `Unknown route. kind=${this.kind} slug=${this.slug}`;
      return;
    }
    this.state = 'loading';
    try {
      const path = `${KIND_DIR[this.kind]}/${this.slug}.md`;
      const { content } = await window.JobKB.readFile(path);
      this.title = (content.match(/^#\s+(.+)$/m) || [, ''])[1].trim();
      // Render the body without the leading H1 (we render that in our header).
      const stripped = content.replace(/^#\s+.+\n+/, '');
      this.body = renderMarkdown(stripped);
      document.title = `${this.title} — /job`;
      this.state = 'loaded';
    } catch (e) {
      this.state = 'error';
      this.error = String(e);
    }
  }

  render() {
    const breadcrumb = html`
      <nav class="breadcrumb">
        <a href="/job/history/">History</a>
        <span>›</span>
        <span>${KIND_LABEL[this.kind] || this.kind}</span>
      </nav>
    `;

    if (this.state === 'idle' || this.state === 'loading') {
      return html`${breadcrumb}<div class="placeholder"><h2>Loading…</h2></div>`;
    }
    if (this.state === 'error') {
      return html`
        ${breadcrumb}
        <div class="placeholder" style="border-color:var(--error);color:var(--error);">
          <h2>Couldn't load this page</h2>
          <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
        </div>`;
    }
    return html`
      ${breadcrumb}
      <header class="page-header">
        <h1>${this.title}</h1>
      </header>
      <article class="kb-doc">${unsafeHTML(this.body)}</article>
    `;
  }
}

customElements.define('job-detail', JobDetail);
