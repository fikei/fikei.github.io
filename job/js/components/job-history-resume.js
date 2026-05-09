// job-history-resume — LinkedIn-style work history. Each company card holds
// company-level metadata, a summary, and a nested list of roles with key
// achievements. Roles + achievements are parsed from the company markdown's
// `## Roles` section (one role per `### Role title` heading) plus an optional
// `## Key achievements` block. The page degrades gracefully when a company
// markdown only has the legacy fields/summary shape.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';

const COMPANIES_DIR = '01-job-history/companies/';

// Strip wiki-link / markdown link / bold / weird typographic chars for plain
// text. Also normalises smart quotes, em/en dashes, and stray bullet glyphs
// that occasionally leak in from PDF / docx pastes.
function plainify(s) {
  if (!s) return '';
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    // Normalise typography
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/–|—/g, '–')
    .replace(/ /g, ' ')
    // Strip stray bullet glyphs at start of lines
    .replace(/^[\s•●▪◦\-•·–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull title, "**Field:** value" header, summary paragraph, nested roles, and
// key-achievement bullets from a company markdown.
function parseDoc(md) {
  const out = {
    title: '',
    fields: {},
    summary: '',
    roles: [],          // [{ title, dates, location, achievements: [str] }]
    achievements: [],   // company-level fallback
  };
  const lines = md.split(/\r?\n/);

  // ---- Header (title + **Field:** values) ----
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!out.title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) { out.title = plainify(h1[1]); continue; }
    }
    const m = line.match(/^\*\*([^*:]+):\*\*\s*(.+)$/);
    if (m) { out.fields[m[1].trim()] = plainify(m[2]); continue; }
    if (line.startsWith('## ')) break;
  }

  // ---- Summary: prefer "## Context" body, else first paragraph after header
  let bodyStart = -1;
  for (let j = i; j < lines.length; j++) {
    if (/^##\s+Context\b/i.test(lines[j])) { bodyStart = j + 1; break; }
  }
  if (bodyStart === -1) bodyStart = i;
  const para = [];
  for (let j = bodyStart; j < lines.length; j++) {
    const line = lines[j].trim();
    if (!line) { if (para.length) break; continue; }
    if (line.startsWith('#')) { if (para.length) break; continue; }
    if (/^\*\*[^*]+:\*\*/.test(line)) continue;
    para.push(line);
  }
  out.summary = plainify(para.join(' '));

  // ---- Roles (## Roles → ### Title — dates → fields + bullets) ----
  const findSection = (re) => {
    for (let j = 0; j < lines.length; j++) {
      if (re.test(lines[j])) return j;
    }
    return -1;
  };
  const sectionEnd = (start) => {
    for (let j = start + 1; j < lines.length; j++) {
      if (/^##\s+/.test(lines[j])) return j;
    }
    return lines.length;
  };

  const rolesStart = findSection(/^##\s+Roles?\b/i);
  if (rolesStart !== -1) {
    const end = sectionEnd(rolesStart);
    let cur = null;
    const flush = () => { if (cur) out.roles.push(cur); };
    for (let j = rolesStart + 1; j < end; j++) {
      const line = lines[j];
      const h3 = line.match(/^###\s+(.+)$/);
      if (h3) {
        flush();
        // Parse "Title — dates" or "Title (dates)" patterns.
        let raw = plainify(h3[1]);
        let title = raw, dates = '';
        const dash = raw.match(/^(.+?)\s+[–—–-]\s+(.+)$/);
        const paren = raw.match(/^(.+?)\s+\(([^)]+)\)\s*$/);
        if (dash) { title = dash[1].trim(); dates = dash[2].trim(); }
        else if (paren) { title = paren[1].trim(); dates = paren[2].trim(); }
        cur = { title, dates, location: '', achievements: [] };
        continue;
      }
      if (!cur) continue;
      const meta = line.match(/^\*\*([^*:]+):\*\*\s*(.+)$/);
      if (meta) {
        const key = meta[1].trim().toLowerCase();
        const val = plainify(meta[2]);
        if (key === 'location') cur.location = val;
        else if (key === 'dates' || key === 'tenure') cur.dates = cur.dates || val;
        else cur[key] = val;
        continue;
      }
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      if (bullet) { cur.achievements.push(plainify(bullet[1])); continue; }
    }
    flush();
  }

  // ---- Company-level fallback achievements ----
  const achStart = findSection(/^##\s+(Key achievements|Highlights|Wins)\b/i);
  if (achStart !== -1) {
    const end = sectionEnd(achStart);
    for (let j = achStart + 1; j < end; j++) {
      const bullet = lines[j].match(/^\s*[-*+]\s+(.+)$/);
      if (bullet) out.achievements.push(plainify(bullet[1]));
    }
  }

  return out;
}

function tenureSortKey(field) {
  // Sort companies by their start year (descending). Field examples:
  //  "Mar 2022 – Present", "2018–2021", "Jan 2015 - Dec 2017".
  if (!field) return 0;
  const m = field.match(/(19|20)\d{2}/g);
  if (!m) return 0;
  return parseInt(m[0], 10);
}

export class JobHistoryResume extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    companies: { state: true },
    expanded: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.companies = [];
    this.expanded = new Set();
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
          return { ...f, title: f.name.replace(/\.md$/, ''), fields: {}, summary: '', roles: [], achievements: [], content: '', error: String(e) };
        }
      }));
      loaded.sort((a, b) => {
        const aTen = a.fields['My tenure'] || a.fields['Tenure'] || '';
        const bTen = b.fields['My tenure'] || b.fields['Tenure'] || '';
        const aPresent = /Present/i.test(aTen);
        const bPresent = /Present/i.test(bTen);
        if (aPresent !== bPresent) return aPresent ? -1 : 1;
        const ay = tenureSortKey(aTen);
        const by = tenureSortKey(bTen);
        if (ay !== by) return by - ay;
        return aTen.localeCompare(bTen);
      });
      this.companies = loaded;
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  _toggle(slug) {
    const next = new Set(this.expanded);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    this.expanded = next;
  }

  _renderRole(role) {
    return html`
      <li class="wh-role">
        <div class="wh-role__bullet" aria-hidden="true"></div>
        <div class="wh-role__body">
          <header class="wh-role__head">
            <h4 class="wh-role__title">${role.title}</h4>
            ${role.dates ? html`<span class="wh-role__dates">${role.dates}</span>` : nothing}
          </header>
          ${role.location ? html`<p class="wh-role__loc">${role.location}</p>` : nothing}
          ${role.achievements.length ? html`
            <ul class="wh-role__ach">
              ${role.achievements.map(a => html`<li>${a}</li>`)}
            </ul>
          ` : nothing}
        </div>
      </li>
    `;
  }

  _renderCompany(c) {
    const slug = c.name.replace(/\.md$/, '');
    const tenure = c.fields['My tenure'] || c.fields['Tenure'] || '';
    const sector = c.fields['Sector'] || '';
    const stage = c.fields['Stage at the time of joining'] || c.fields['Stage of clients'] || c.fields['Stage at the time'] || '';
    const location = c.fields['Location'] || '';
    const operating = c.fields['Operating mode'] || '';
    const rolesHeld = c.fields['Roles held'] || '';
    const initial = (c.title || slug).trim().charAt(0).toUpperCase();

    const chips = [sector, stage, location, operating].filter(Boolean);

    const hasRoles = c.roles && c.roles.length > 0;
    const hasAch = c.achievements && c.achievements.length > 0;
    const expanded = this.expanded.has(slug);
    const expandable = hasRoles || hasAch || c.summary;

    return html`
      <article class="wh-company ${expanded ? 'is-expanded' : ''}">
        <button class="wh-company__head"
                type="button"
                aria-expanded=${expanded ? 'true' : 'false'}
                @click=${() => expandable && this._toggle(slug)}>
          <span class="wh-company__logo" aria-hidden="true">${initial}</span>
          <span class="wh-company__title">
            <span class="wh-company__name">${c.title}</span>
            ${rolesHeld ? html`<span class="wh-company__roles">${rolesHeld}</span>` : nothing}
            ${chips.length ? html`
              <span class="wh-company__chips">
                ${chips.map(t => html`<span class="wh-chip">${t}</span>`)}
              </span>
            ` : nothing}
          </span>
          <span class="wh-company__meta">
            ${tenure ? html`<span class="wh-company__tenure">${tenure}</span>` : nothing}
            ${expandable ? html`
              <span class="wh-company__caret" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
            ` : nothing}
          </span>
        </button>

        ${expanded ? html`
          <div class="wh-company__body">
            ${c.summary ? html`<p class="wh-company__summary">${c.summary}</p>` : nothing}

            ${hasRoles ? html`
              <ul class="wh-roles">
                ${c.roles.map(r => this._renderRole(r))}
              </ul>
            ` : nothing}

            ${!hasRoles && hasAch ? html`
              <h5 class="wh-section-h">Key achievements</h5>
              <ul class="wh-role__ach wh-role__ach--flat">
                ${c.achievements.map(a => html`<li>${a}</li>`)}
              </ul>
            ` : nothing}

            <div class="wh-company__footer">
              <a class="wh-company__link" href="/job/history/companies/${slug}/">Open full entry →</a>
            </div>
          </div>
        ` : nothing}
      </article>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`
        <section class="wh-list">
          ${Array.from({ length: 4 }).map(() => html`
            <div class="wh-company">
              <div class="wh-company__head" style="cursor:default;">
                <div class="skeleton" style="width:48px;height:48px;border-radius:50%;flex-shrink:0;"></div>
                <div style="flex:1;min-width:0;">
                  <div class="skeleton" style="width:50%;height:18px;display:block;margin-bottom:6px;"></div>
                  <div class="skeleton" style="width:40%;height:13px;display:block;"></div>
                </div>
                <div class="skeleton" style="width:120px;height:14px;"></div>
              </div>
            </div>
          `)}
        </section>
      `;
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
      <section class="wh-list">
        ${this.companies.map(c => this._renderCompany(c))}
      </section>
    `;
  }
}

customElements.define('job-history-resume', JobHistoryResume);
