// job-vision — tabbed browser for fikei/job/02-goals-intents/.
//
// Layout:
//   [Narrative | Goals | Intents | Filters | Other]   ← only non-empty tabs
//   Single-column list of cards (title · facts/bullets preview · "Open")
//   Click a card  → expands inline to render structured fields + markdown
//                   body, plus Edit/Save/Cancel. Edits commit via kb-write
//                   with baseSha concurrency control.
//
// Structure on disk: the same `**Label:** value` convention used elsewhere
// in fikei/job (see migrate-job's parseDoc). Fields live between the H1 and
// the first H2 / non-field line. We lift those into a "facts strip" so the
// UI matches how /jobs already consumes the data, while editing stays raw
// markdown — no schema lock-in.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { writeFile }] = await Promise.all([
  import('../markdown.js' + V),
  import('../kbwrite.js' + V),
]);

const VISION_DIR = '02-goals-intents';

const CATEGORIES = [
  { id: 'narrative', label: 'Narrative',
    test: (n) => /^(narrative|voice|story|bio|about|arc)/.test(n) },
  { id: 'goals',     label: 'Goals',
    test: (n) => /^(goal|north|mission|vision|aim|ambition)/.test(n) },
  { id: 'intents',   label: 'Intents',
    test: (n) => /^(intent|target|seeking|looking|wants|preference|stage|sector|role|geo|comp|salary|location)/.test(n) },
  { id: 'filters',   label: 'Filters',
    test: (n) => /^(criteria|filter|dealbreaker|deal-breaker|anti|no-go|must|reject|exclud)/.test(n) },
  { id: 'other',     label: 'Other', test: () => true },
];

function categoryFor(name) {
  const base = name.replace(/\.md$/, '').toLowerCase();
  for (const c of CATEGORIES) if (c.test(base)) return c.id;
  return 'other';
}

function titleFromFile(name, content) {
  const m = (content || '').match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return name.replace(/\.md$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function wordCount(content) {
  return (content || '').trim().split(/\s+/).filter(Boolean).length;
}

// Parse `**Label:** value` lines between the H1 and the first H2 / non-field
// content. Mirrors migrate-job's parseDoc. Anything we couldn't pull out as a
// field stays in the body for normal markdown rendering.
function parseDoc(content) {
  const out = { title: '', fields: [], body: '' };
  const lines = (content || '').split(/\r?\n/);
  let i = 0;
  let inHeader = true;
  const bodyStart = () => lines.slice(i).join('\n').trim();
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!out.title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) { out.title = h1[1].trim(); continue; }
    }
    if (inHeader) {
      if (line.startsWith('## ')) { inHeader = false; break; }
      const f = line.match(/^\*\*([^*:]+):\*\*\s*(.*)$/);
      if (f) { out.fields.push({ label: f[1].trim(), value: f[2].trim() }); continue; }
      if (!line.trim()) continue;
      // First non-field, non-blank line ends the header section.
      inHeader = false;
      break;
    }
  }
  out.body = bodyStart();
  return out;
}

// A value is treated as a list if it has 2+ items separated by `,` or `;`
// or ` / `. Returns null otherwise. We use this to pick chip vs. inline.
function splitList(value) {
  if (!value) return null;
  const parts = value.split(/\s*(?:,|;| \/ )\s*/).map(s => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

// Field labels that should render as money. Values are passed through —
// we don't reformat (Ian might write "$180k base + 0.5% equity").
const MONEY_LABELS = /^(base|base floor|salary|salary floor|cash|total comp|total comp target|fractional|fractional rate|day rate|hourly|equity|equity expectation|equity target|all-in|total)/i;

function isMoney(label) { return MONEY_LABELS.test(label); }

// First non-field, non-heading bullet line from the body — used as a card
// preview when the file is bullet-heavy (deal-breakers, voice rules, etc.).
function firstBullets(body, max = 3) {
  if (!body) return [];
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
    if (m) out.push(m[1]);
    if (out.length >= max) break;
  }
  return out;
}

// Plain-text fallback preview if the file has no fields and no bullets.
function prosePreview(body) {
  return (body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, s, l) => (l || s))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[#>*\-+\s]+/gm, '')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/_+([^_]+)_+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export class JobVision extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state:    { state: true },
    error:    { state: true },
    files:    { state: true },
    activeTab:{ state: true },
    openPath: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.files = [];
    const params = new URLSearchParams(location.search);
    this.activeTab = params.get('tab') || 'all';
    this.openPath = params.get('open') || '';
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
      const { entries = [] } = await window.JobKB.listDir(VISION_DIR);
      const mdEntries = entries
        .filter(e => e.type === 'file' && e.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name));
      const files = await Promise.all(mdEntries.map(async (e) => {
        try {
          const { content, sha } = await window.JobKB.readFile(e.path);
          return {
            path: e.path, name: e.name, content, sha,
            category: categoryFor(e.name),
            editing: false, draft: '', saving: false, saveError: '',
          };
        } catch (err) {
          return {
            path: e.path, name: e.name, content: '', sha: '',
            category: categoryFor(e.name),
            editing: false, draft: '', saving: false,
            saveError: String(err?.message || err),
          };
        }
      }));
      this.files = files;
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e?.message || e);
      this.state = 'error';
    }
  }

  _writeUrl() {
    const qs = new URLSearchParams();
    if (this.activeTab && this.activeTab !== 'all') qs.set('tab', this.activeTab);
    if (this.openPath) qs.set('open', this.openPath);
    const search = qs.toString();
    history.replaceState(null, '', '/job/vision/' + (search ? `?${search}` : ''));
  }

  _switchTab(id) {
    this.activeTab = id;
    if (this.openPath) {
      const open = this.files.find(f => f.path === this.openPath);
      if (open && id !== 'all' && open.category !== id) this.openPath = '';
    }
    this._writeUrl();
  }

  _openCard(path) {
    this.openPath = this.openPath === path ? '' : path;
    if (!this.openPath) {
      this._updateFile(path, { editing: false, draft: '', saveError: '' });
    }
    this._writeUrl();
  }

  _updateFile(path, patch) {
    this.files = this.files.map(f => f.path === path ? { ...f, ...patch } : f);
  }

  _startEdit(path) {
    const f = this.files.find(x => x.path === path);
    if (!f) return;
    this._updateFile(path, { editing: true, draft: f.content, saveError: '' });
  }
  _cancelEdit(path) {
    this._updateFile(path, { editing: false, draft: '', saveError: '' });
  }
  _onDraftInput(path, value) {
    this._updateFile(path, { draft: value });
  }

  async _save(path) {
    const f = this.files.find(x => x.path === path);
    if (!f) return;
    const next = (f.draft ?? '').trimEnd() + '\n';
    if (next === (f.content ?? '')) {
      this._updateFile(path, { editing: false, draft: '', saveError: '' });
      return;
    }
    this._updateFile(path, { saving: true, saveError: '' });
    try {
      const res = await writeFile(path, next, f.sha);
      this._updateFile(path, {
        content: next,
        sha: res?.sha || f.sha,
        editing: false,
        draft: '',
        saving: false,
        saveError: '',
      });
    } catch (e) {
      this._updateFile(path, {
        saving: false,
        saveError: String(e?.message || e),
      });
    }
  }

  _visibleTabs() {
    const counts = new Map([['all', this.files.length]]);
    for (const f of this.files) counts.set(f.category, (counts.get(f.category) || 0) + 1);
    const tabs = [{ id: 'all', label: 'All', count: counts.get('all') || 0 }];
    for (const c of CATEGORIES) {
      const n = counts.get(c.id) || 0;
      if (n > 0) tabs.push({ id: c.id, label: c.label, count: n });
    }
    return tabs;
  }

  _filteredFiles() {
    if (this.activeTab === 'all') return this.files;
    return this.files.filter(f => f.category === this.activeTab);
  }

  _renderTabs(tabs) {
    return html`
      <div class="asset-tabs">
        ${tabs.map(t => html`
          <button class="asset-tabs__tab ${this.activeTab === t.id ? 'is-active' : ''}"
                  @click=${() => this._switchTab(t.id)}>
            ${t.label} <span class="muted" style="font-weight:400;">${t.count}</span>
          </button>
        `)}
      </div>
    `;
  }

  // Render one field row. Lists become chips; money labels render as the
  // value emphasized; everything else is plain text.
  _renderField(field) {
    const items = splitList(field.value);
    const money = isMoney(field.label);
    return html`
      <div class="facts__row">
        <dt class="facts__label">${field.label}</dt>
        <dd class="facts__value ${money ? 'facts__value--money' : ''}">
          ${items
            ? html`<div class="chip-row">${items.map(x => html`<span class="tag-chip">${x}</span>`)}</div>`
            : (field.value || html`<span class="muted">—</span>`)}
        </dd>
      </div>
    `;
  }

  _renderFacts(doc, { compact = false } = {}) {
    if (!doc.fields.length) return nothing;
    const fields = compact ? doc.fields.slice(0, 4) : doc.fields;
    return html`
      <dl class="facts ${compact ? 'facts--compact' : ''}">
        ${fields.map(f => this._renderField(f))}
      </dl>
    `;
  }

  _renderCardPreview(doc) {
    if (doc.fields.length) return this._renderFacts(doc, { compact: true });
    const bullets = firstBullets(doc.body, 3);
    if (bullets.length) {
      return html`
        <ul class="card-bullets">
          ${bullets.map(b => html`<li>${b}</li>`)}
        </ul>
      `;
    }
    const prose = prosePreview(doc.body);
    return html`<p class="vision-card__preview">${prose || html`<span class="muted">_(empty)_</span>`}</p>`;
  }

  _renderCard(f) {
    const doc = parseDoc(f.content);
    const title = doc.title || titleFromFile(f.name, f.content);
    const words = wordCount(f.content);
    const isOpen = this.openPath === f.path;
    if (isOpen) return this._renderDetail(f, doc, title);
    return html`
      <button type="button" class="vision-card" @click=${() => this._openCard(f.path)}>
        <header class="vision-card__head">
          <h3 class="vision-card__title">${title}</h3>
          <span class="vision-card__cta">Open →</span>
        </header>
        <div class="vision-card__meta">
          <span>${f.name}</span>
          <span>·</span>
          <span>${words} ${words === 1 ? 'word' : 'words'}</span>
          ${doc.fields.length ? html`<span>·</span><span>${doc.fields.length} field${doc.fields.length === 1 ? '' : 's'}</span>` : nothing}
        </div>
        ${this._renderCardPreview(doc)}
      </button>
    `;
  }

  _renderDetail(f, doc, title) {
    return html`
      <section class="vision-detail">
        <header class="vision-detail__head">
          <div>
            <h2 class="vision-detail__title">${title}</h2>
            <p class="muted" style="margin:0;font-size:var(--font-size-small);font-family:var(--font-mono);">${f.path}</p>
          </div>
          <div class="vision-detail__actions">
            ${f.editing ? html`
              <button class="btn btn--sm" ?disabled=${f.saving} @click=${() => this._cancelEdit(f.path)}>Cancel</button>
              <button class="btn btn--sm btn--primary" ?disabled=${f.saving} @click=${() => this._save(f.path)}>
                ${f.saving ? 'Saving…' : 'Save'}
              </button>
            ` : html`
              <button class="btn btn--sm" @click=${() => this._startEdit(f.path)}>Edit</button>
              <button class="btn btn--sm" @click=${() => this._openCard(f.path)}>Close</button>
            `}
          </div>
        </header>

        ${f.saveError ? html`
          <p class="muted" style="color:var(--error);margin:0 0 var(--space-3);">${f.saveError}</p>
        ` : nothing}

        ${f.editing ? html`
          <textarea class="asset-editor" style="min-height: 360px;"
                    .value=${f.draft}
                    @input=${(e) => this._onDraftInput(f.path, e.target.value)}></textarea>
          <p class="muted" style="font-size:var(--font-size-small);margin:var(--space-3) 0 0;">
            Tip: header fields use <code>**Label:** value</code>. Commas in a value become chips
            (e.g. <code>**Primary sectors:** healthtech, edtech</code>). The /jobs skill reads
            the same fields.
          </p>
        ` : html`
          ${this._renderFacts(doc)}
          ${doc.body ? html`
            <article class="kb-doc asset-doc">${unsafeHTML(renderMarkdown(doc.body))}</article>
          ` : (doc.fields.length ? nothing : html`<p class="muted">_(empty)_</p>`)}
        `}
      </section>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`
        <div class="vision-grid">
          ${[0,1,2,3].map(() => html`
            <div class="vision-card" style="cursor:default;">
              <div class="skeleton" style="width:60%;height:18px;display:block;margin-bottom:8px;"></div>
              <div class="skeleton" style="width:90%;height:12px;display:block;margin-bottom:6px;"></div>
              <div class="skeleton" style="width:80%;height:12px;display:block;"></div>
            </div>
          `)}
        </div>
      `;
    }
    if (this.state === 'error') {
      return html`
        <div class="placeholder" style="border-color:var(--error);color:var(--error);">
          <h2>Couldn't load Search plan</h2>
          <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
        </div>`;
    }
    if (!this.files.length) {
      return html`
        <div class="vision-empty">
          <h2 style="margin:0 0 var(--space-2);">No files yet</h2>
          <p style="margin:0;">Add markdown files to <code>${VISION_DIR}/</code> in fikei/job to see them here.</p>
        </div>`;
    }
    const tabs = this._visibleTabs();
    const filtered = this._filteredFiles();
    const totalFields = this.files.reduce((sum, f) => sum + parseDoc(f.content).fields.length, 0);
    return html`
      ${this._renderTabs(tabs)}
      <div class="vision-meta">
        <span>${filtered.length} ${filtered.length === 1 ? 'file' : 'files'}</span>
        <span>·</span>
        <span>${totalFields} structured field${totalFields === 1 ? '' : 's'} across Search plan</span>
      </div>
      <div class="vision-grid">
        ${filtered.length === 0
          ? html`<div class="vision-empty" style="grid-column: 1 / -1;">Nothing in this category yet.</div>`
          : filtered.map(f => this._renderCard(f))}
      </div>
    `;
  }
}

customElements.define('job-vision', JobVision);
