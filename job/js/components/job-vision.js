// job-vision — render & edit the goals/intents corpus that the /jobs skill
// reads for relevance scoring. Lists 02-goals-intents/ via kb-read, renders
// each .md file, and commits edits back through kb-write (with baseSha
// concurrency control).
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { writeFile }] = await Promise.all([
  import('../markdown.js' + V),
  import('../kbwrite.js' + V),
]);

const VISION_DIR = '02-goals-intents';

function titleFromFile(name, content) {
  const m = (content || '').match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return name.replace(/\.md$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export class JobVision extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    files: { state: true }, // [{ path, name, content, sha, editing, draft, saving, saveError }]
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.files = [];
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
          return { path: e.path, name: e.name, content, sha,
                   editing: false, draft: '', saving: false, saveError: '' };
        } catch (err) {
          return { path: e.path, name: e.name, content: '', sha: '',
                   editing: false, draft: '', saving: false,
                   saveError: String(err?.message || err) };
        }
      }));
      this.files = files;
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e?.message || e);
      this.state = 'error';
    }
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

  _renderFile(f) {
    const title = titleFromFile(f.name, f.content);
    const stripped = (f.content || '').replace(/^#\s+.+\n+/, '');
    return html`
      <section class="narrative-block">
        <header style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);margin-bottom:var(--space-3);flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;">${title}</h2>
            <p class="muted" style="margin:0;font-size:var(--font-size-small);font-family:var(--font-mono);">${f.path}</p>
          </div>
          ${f.editing ? html`
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn--sm" ?disabled=${f.saving} @click=${() => this._cancelEdit(f.path)}>Cancel</button>
              <button class="btn btn--sm btn--primary" ?disabled=${f.saving} @click=${() => this._save(f.path)}>
                ${f.saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          ` : html`
            <button class="btn btn--sm" @click=${() => this._startEdit(f.path)}>Edit</button>
          `}
        </header>

        ${f.saveError ? html`
          <p class="muted" style="color:var(--error);margin:0 0 var(--space-3);">${f.saveError}</p>
        ` : nothing}

        ${f.editing ? html`
          <textarea class="asset-editor" style="min-height: 320px;"
                    .value=${f.draft}
                    @input=${(e) => this._onDraftInput(f.path, e.target.value)}></textarea>
        ` : html`
          <article class="kb-doc">${unsafeHTML(renderMarkdown(stripped || f.content || '_(empty)_'))}</article>
        `}
      </section>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`
        <section class="narrative-block">
          <div class="skeleton" style="width:240px;height:18px;display:block;margin-bottom:var(--space-3);"></div>
          <div class="skeleton" style="width:100%;height:14px;display:block;margin-bottom:8px;"></div>
          <div class="skeleton" style="width:96%;height:14px;display:block;margin-bottom:8px;"></div>
          <div class="skeleton" style="width:80%;height:14px;display:block;"></div>
        </section>
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
        <div class="placeholder">
          <h2>No vision files yet</h2>
          <p>Add markdown files to <code>${VISION_DIR}/</code> in fikei/job to see them here.</p>
        </div>`;
    }
    return html`${this.files.map(f => this._renderFile(f))}`;
  }
}

customElements.define('job-vision', JobVision);
