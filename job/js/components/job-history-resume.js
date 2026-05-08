// job-history-resume — top-level resume view: list of companies pulled from
// fikei/job/01-job-history/companies/ via kb-read.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';

const COMPANIES_DIR = '01-job-history/companies/';

// Strip wiki-link / markdown link / bold syntax for plain-text snippets.
function plainify(s) {
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

// Pull title, "**Field:** value" header, and a 1-2 sentence summary
// (first prose paragraph; prefers the body of "## Context" if present).
function parseDoc(md) {
  const out = { title: '', fields: {}, summary: '' };
  const lines = md.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!out.title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) { out.title = h1[1].trim(); continue; }
    }
    const m = line.match(/^\*\*([^*:]+):\*\*\s*(.+)$/);
    if (m) { out.fields[m[1].trim()] = m[2].trim(); continue; }
    if (line.startsWith('## ')) break;
  }

  // Find "## Context" first, otherwise first non-heading paragraph after metadata.
  let bodyStart = -1;
  for (let j = i; j < lines.length; j++) {
    if (/^##\s+Context\b/i.test(lines[j])) { bodyStart = j + 1; break; }
  }
  if (bodyStart === -1) bodyStart = i;

  const para = [];
  for (let j = bodyStart; j < lines.length; j++) {
    const line = lines[j].trim();
    if (!line) {
      if (para.length) break;
      continue;
    }
    if (line.startsWith('#')) {
      if (para.length) break;
      continue;
    }
    if (/^\*\*[^*]+:\*\*/.test(line)) continue;
    para.push(line);
  }
  out.summary = plainify(para.join(' '));
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
    document.addEventListener('job:auth:ready', this._onAuth);
  }

  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
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
          return { ...f, ...parseDoc(content), content };
        } catch (e) {
          return { ...f, title: f.name.replace(/\.md$/, ''), fields: {}, summary: '', content: '', error: String(e) };
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
    const operating = c.fields['Operating mode'] || '';
    const rolesHeld = c.fields['Roles held'] || '';
    const subline = operating || rolesHeld
      ? plainify(operating || rolesHeld)
      : '';

    const chips = [sector, stage, location].filter(Boolean);

    return html`
      <a class="company-card" href="/job/history/companies/${slug}/">
        <div class="company-card__top">
          <div class="company-card__title">
            <h3>${c.title}</h3>
            ${subline ? html`<p class="company-card__sub">${subline}</p>` : nothing}
          </div>
          ${tenure ? html`<span class="company-card__tenure">${tenure}</span>` : nothing}
        </div>
        ${c.summary ? html`<p class="company-card__summary">${c.summary}</p>` : nothing}
        ${chips.length ? html`
          <ul class="company-card__chips">
            ${chips.map(t => html`<li>${t}</li>`)}
          </ul>
        ` : nothing}
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
