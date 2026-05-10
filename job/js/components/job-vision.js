// job-vision — tabbed browser for fikei/job/02-goals-intents/.
//
// Layout:
//   [Narrative | Goals | Intents | Filters | Other]   ← only non-empty tabs
//   Grid of cards  (title · path · preview · word count · "Open")
//   Click a card  → expands inline (full-row) to render the markdown and
//                   expose Edit/Save/Cancel. Edits commit via kb-write with
//                   baseSha concurrency control.
//
// Filename → tab classification is a tolerant prefix/keyword match; anything
// unmatched lands in "Other". The /jobs skill reads the same files; nothing
// here changes what it sees on disk.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { writeFile }] = await Promise.all([
  import('../markdown.js' + V),
  import('../kbwrite.js' + V),
]);

const VISION_DIR = '02-goals-intents';

// Order matters — tabs render in this order; first match wins. The "All" tab
// is prepended automatically. Each entry maps to (label, predicate).
const CATEGORIES = [
  { id: 'narrative', label: 'Narrative',
    test: (n) => /^(narrative|voice|story|bio|about|arc)/.test(n) },
  { id: 'goals',     label: 'Goals',
    test: (n) => /^(goal|north|mission|vision|aim|ambition)/.test(n) },
  { id: 'intents',   label: 'Intents',
    test: (n) => /^(intent|target|seeking|looking|wants|preference)/.test(n) },
  { id: 'filters',   label: 'Filters',
    test: (n) => /^(criteria|filter|dealbreaker|anti|no-go|must|reject|exclud)/.test(n) },
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

// Plain-text preview: drop the H1, strip markdown syntax, collapse whitespace.
function previewFor(content) {
  const noH1 = (content || '').replace(/^#\s+.+\n+/, '');
  const stripped = noH1
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
  return stripped;
}

function wordCount(content) {
  return (content || '').trim().split(/\s+/).filter(Boolean).length;
}

export class JobVision extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state:    { state: true },
    error:    { state: true },
    files:    { state: true }, // [{ path, name, content, sha, category, editing, draft, saving, saveError }]
    activeTab:{ state: true }, // 'all' | category id
    openPath: { state: true }, // currently expanded file
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
      // Close any in-progress edit when collapsing.
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

  _renderCard(f) {
    const title = titleFromFile(f.name, f.content);
    const preview = previewFor(f.content);
    const words = wordCount(f.content);
    const isOpen = this.openPath === f.path;
    if (isOpen) return this._renderDetail(f, title);
    return html`
      <button type="button" class="vision-card" @click=${() => this._openCard(f.path)}>
        <h3 class="vision-card__title">${title}</h3>
        <div class="vision-card__meta">
          <span>${f.name}</span>
          <span>·</span>
          <span>${words} ${words === 1 ? 'word' : 'words'}</span>
        </div>
        <p class="vision-card__preview">${preview || '_(empty)_'}</p>
        <div class="vision-card__footer">
          <span class="vision-card__cta">Open →</span>
        </div>
      </button>
    `;
  }

  _renderDetail(f, title) {
    const stripped = (f.content || '').replace(/^#\s+.+\n+/, '');
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
        ` : html`
          <article class="kb-doc asset-doc">${unsafeHTML(renderMarkdown(stripped || f.content || '_(empty)_'))}</article>
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
          <h2>Couldn't load Vision</h2>
          <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
        </div>`;
    }
    if (!this.files.length) {
      return html`
        <div class="vision-empty">
          <h2 style="margin:0 0 var(--space-2);">No vision files yet</h2>
          <p style="margin:0;">Add markdown files to <code>${VISION_DIR}/</code> in fikei/job to see them here.</p>
        </div>`;
    }
    const tabs = this._visibleTabs();
    const filtered = this._filteredFiles();
    const totalWords = this.files.reduce((sum, f) => sum + wordCount(f.content), 0);
    return html`
      ${this._renderTabs(tabs)}
      <div class="vision-meta">
        <span>${filtered.length} ${filtered.length === 1 ? 'file' : 'files'}</span>
        <span>·</span>
        <span>${totalWords.toLocaleString()} words across all of Vision</span>
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
