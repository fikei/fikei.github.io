// job-history-resume — top-level resume view: list of companies pulled from
// fikei/job/01-job-history/companies/ via kb-read.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { renderMarkdown } from '../markdown.js';

const COMPANIES_DIR = '01-job-history/companies/';

// Pull a small set of fields from the markdown front-block.
// The KB convention: H1 then a list of "**Field:** value" lines.
function parseHeader(md) {
  const out = { title: '', fields: {} };
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    if (!out.title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) { out.title = h1[1].trim(); continue; }
    }
    const m = line.match(/^\*\*([^*:]+):\*\*\s*(.+)$/);
    if (m) out.fields[m[1].trim()] = m[2].trim();
    if (line.startsWith('## ')) break; // first section starts → stop scanning
  }
  return out;
}

export class JobHistoryResume extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    companies: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.companies = [];
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
    this.state = 'loading';
    try {
      const { entries } = await window.JobKB.listDir(COMPANIES_DIR);
      const files = entries.filter(e => e.type === 'file' && e.name.endsWith('.md'));
      const loaded = await Promise.all(files.map(async f => {
        try {
          const { content } = await window.JobKB.readFile(f.path);
          return { ...f, ...parseHeader(content), content };
        } catch (e) {
          return { ...f, title: f.name.replace(/\.md$/, ''), fields: {}, content: '', error: String(e) };
        }
      }));
      // Sort: those with a tenure-end of 'Present' first, then by tenure-start desc, then by name.
      loaded.sort((a, b) => {
        const aPresent = /Present/i.test(a.fields['My tenure'] || a.fields['Tenure'] || '');
        const bPresent = /Present/i.test(b.fields['My tenure'] || b.fields['Tenure'] || '');
        if (aPresent !== bPresent) return aPresent ? -1 : 1;
        return (b.fields['My tenure'] || '').localeCompare(a.fields['My tenure'] || '');
      });
      this.companies = loaded;
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  _renderCard(c) {
    const slug = c.name.replace(/\.md$/, '');
    const tenure = c.fields['My tenure'] || c.fields['Tenure'] || '';
    const sector = c.fields['Sector'] || '';
    const stage = c.fields['Stage at the time of joining'] || c.fields['Stage of clients'] || c.fields['Stage at the time'] || '';
    const location = c.fields['Location'] || '';
    return html`
      <a class="company-card" href="/job/history/companies/${slug}/">
        <div class="company-card__head">
          <h3>${c.title}</h3>
          ${tenure ? html`<span class="company-card__tenure">${tenure}</span>` : nothing}
        </div>
        <dl class="company-card__meta">
          ${sector ? html`<div><dt>Sector</dt><dd>${sector}</dd></div>` : nothing}
          ${stage ? html`<div><dt>Stage</dt><dd>${stage}</dd></div>` : nothing}
          ${location ? html`<div><dt>Location</dt><dd>${location}</dd></div>` : nothing}
        </dl>
      </a>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`<div class="placeholder"><h2>Loading resume…</h2><p>Reading from fikei/job via kb-read.</p></div>`;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder" style="border-color:var(--error);color:var(--error);">
        <h2>Couldn't load companies</h2>
        <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
      </div>`;
    }
    if (!this.companies.length) {
      return html`<div class="placeholder"><h2>No companies found</h2><p>Expected files in ${COMPANIES_DIR}</p></div>`;
    }
    return html`
      <section class="company-grid">
        ${this.companies.map(c => this._renderCard(c))}
      </section>
    `;
  }
}

customElements.define('job-history-resume', JobHistoryResume);
