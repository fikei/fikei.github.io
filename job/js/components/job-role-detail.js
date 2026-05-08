// job-role-detail — per-role detail page with Resume / Cover Letter tabs.
// Reads /job/jobs/{slug}/?row=&tab= and renders both assets from
// 03-jobs/{slug}/{kind}.md via kb-read; saves edits via kb-write.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { generateAsset }, { writeFile }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../kbwrite.js' + V),
]);

const TABS = [
  { id: 'resume', label: 'Resume', file: 'resume.md' },
  { id: 'cover-letter', label: 'Cover letter', file: 'cover-letter.md' },
];

export class JobRoleDetail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    slug: { state: true },
    rowNumber: { state: true },
    activeTab: { state: true },
    assets: { state: true },        // { 'resume': { content, sha, draft, mode, saving, dirty } }
    role: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    const params = new URLSearchParams(location.search);
    this.slug = (params.get('slug') || '').toLowerCase();
    this.rowNumber = Number(params.get('row')) || null;
    const tab = params.get('tab');
    this.activeTab = TABS.find(t => t.id === tab)?.id || 'resume';
    this.assets = { 'resume': null, 'cover-letter': null };
    this.role = null;

    const pretty = sessionStorage.getItem('job:prettyPath');
    if (pretty && /^\/job\/jobs\/[a-z0-9_-]+\/?$/.test(pretty)) {
      sessionStorage.removeItem('job:prettyPath');
      history.replaceState(null, '', pretty + (this.activeTab !== 'resume' ? `?tab=${this.activeTab}` : ''));
    } else if (this.slug) {
      history.replaceState(null, '', `/job/jobs/${this.slug}/${this.activeTab !== 'resume' ? `?tab=${this.activeTab}` : ''}`);
    }
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
    if (!this.slug) {
      this.state = 'error';
      this.error = 'Missing slug';
      return;
    }
    this.state = 'loading';
    try {
      // Load both assets in parallel; tolerate 404 (asset not yet generated).
      const [resume, cover] = await Promise.all([
        this._loadAsset('resume'),
        this._loadAsset('cover-letter'),
      ]);
      this.assets = { 'resume': resume, 'cover-letter': cover };
      this.state = 'loaded';
      document.title = `${this.slug} — /job`;
    } catch (e) {
      this.state = 'error';
      this.error = String(e);
    }
  }

  async _loadAsset(kind) {
    const file = TABS.find(t => t.id === kind).file;
    const path = `03-jobs/${this.slug}/${file}`;
    try {
      const r = await window.JobKB.readFile(path);
      return { path, content: r.content, sha: r.sha, draft: r.content, mode: 'view', saving: false, dirty: false, error: '' };
    } catch (e) {
      return { path, content: '', sha: '', draft: '', mode: 'empty', saving: false, dirty: false, error: '' };
    }
  }

  _switchTab(id) {
    this.activeTab = id;
    history.replaceState(null, '', `/job/jobs/${this.slug}/${id !== 'resume' ? `?tab=${id}` : ''}`);
  }

  async _onGenerate(kind) {
    if (!this.rowNumber) {
      this._setAssetError(kind, 'Missing row reference. Open this page from the pipeline.');
      return;
    }
    const a = this.assets[kind] || {};
    a.saving = true;
    a.error = '';
    this.assets = { ...this.assets, [kind]: { ...a } };
    try {
      const res = await generateAsset(this.rowNumber, kind);
      const file = TABS.find(t => t.id === kind).file;
      const path = `03-jobs/${this.slug}/${file}`;
      this.assets = {
        ...this.assets,
        [kind]: {
          path,
          content: res.content,
          sha: res.sha,
          draft: res.content,
          mode: 'view',
          saving: false,
          dirty: false,
          error: '',
        },
      };
    } catch (e) {
      this._setAssetError(kind, String(e));
    }
  }

  _setAssetError(kind, msg) {
    const a = this.assets[kind] || {};
    this.assets = { ...this.assets, [kind]: { ...a, saving: false, error: msg } };
  }

  _enterEdit(kind) {
    const a = this.assets[kind];
    this.assets = { ...this.assets, [kind]: { ...a, mode: 'edit', draft: a.content } };
  }

  _cancelEdit(kind) {
    const a = this.assets[kind];
    this.assets = { ...this.assets, [kind]: { ...a, mode: 'view', draft: a.content, dirty: false, error: '' } };
  }

  _onDraftInput(kind, e) {
    const a = this.assets[kind];
    this.assets = { ...this.assets, [kind]: { ...a, draft: e.target.value, dirty: e.target.value !== a.content } };
  }

  async _saveEdit(kind) {
    const a = this.assets[kind];
    if (!a.dirty) return;
    this.assets = { ...this.assets, [kind]: { ...a, saving: true, error: '' } };
    try {
      const res = await writeFile(a.path, a.draft, a.sha);
      this.assets = {
        ...this.assets,
        [kind]: { ...a, content: a.draft, sha: res.sha, mode: 'view', saving: false, dirty: false },
      };
    } catch (e) {
      this._setAssetError(kind, String(e));
    }
  }

  _renderTabBody(kind) {
    const a = this.assets[kind];
    if (!a) return html`<div class="placeholder"><h2>Loading…</h2></div>`;

    if (a.mode === 'empty') {
      return html`
        <div class="placeholder">
          <h2>No ${kind === 'resume' ? 'resume' : 'cover letter'} yet</h2>
          <p>Generate one tailored to this role using your career KB and voice rules.</p>
          <div style="margin-top:var(--space-4);display:flex;justify-content:center;gap:var(--space-3);">
            <button class="btn btn--primary" ?disabled=${a.saving} @click=${() => this._onGenerate(kind)}>
              ${a.saving ? 'Generating…' : `Generate ${kind === 'resume' ? 'resume' : 'cover letter'}`}
            </button>
          </div>
          ${a.error ? html`<p class="muted" style="color:var(--error);margin-top:var(--space-3);">${a.error}</p>` : nothing}
        </div>
      `;
    }

    return html`
      <div class="asset-toolbar">
        ${a.mode === 'view' ? html`
          <button class="btn btn--sm" @click=${() => this._enterEdit(kind)}>Edit</button>
          <button class="btn btn--sm" ?disabled=${a.saving} @click=${() => this._onGenerate(kind)}>
            ${a.saving ? 'Regenerating…' : 'Regenerate'}
          </button>
        ` : html`
          <button class="btn btn--sm btn--primary" ?disabled=${!a.dirty || a.saving} @click=${() => this._saveEdit(kind)}>
            ${a.saving ? 'Saving…' : 'Save'}
          </button>
          <button class="btn btn--sm" @click=${() => this._cancelEdit(kind)}>Cancel</button>
        `}
        ${a.error ? html`<span class="muted" style="color:var(--error);">${a.error}</span>` : nothing}
      </div>

      ${a.mode === 'edit'
        ? html`<textarea class="asset-editor" .value=${a.draft} @input=${(e) => this._onDraftInput(kind, e)}></textarea>`
        : html`<article class="kb-doc asset-doc">${unsafeHTML(renderMarkdown(a.content))}</article>`
      }
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`<div class="placeholder"><h2>Loading…</h2></div>`;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder" style="border-color:var(--error);color:var(--error);">
        <h2>Couldn't load this role</h2>
        <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
      </div>`;
    }

    return html`
      <nav class="breadcrumb">
        <a href="/job/jobs/">Jobs</a>
        <span>›</span>
        <span>${this.slug}</span>
      </nav>

      <header class="page-header">
        <h1>${this.slug}</h1>
        <p>Resume and cover letter for this role. Each draft is committed to fikei/job/03-jobs/${this.slug}/.</p>
      </header>

      <div class="asset-tabs">
        ${TABS.map(t => html`
          <button class="asset-tabs__tab ${this.activeTab === t.id ? 'is-active' : ''}"
                  @click=${() => this._switchTab(t.id)}>
            ${t.label}
          </button>
        `)}
      </div>

      <section class="asset-panel">
        ${this._renderTabBody(this.activeTab)}
      </section>
    `;
  }
}

customElements.define('job-role-detail', JobRoleDetail);
