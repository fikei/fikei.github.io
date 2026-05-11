// job-career — tabbed shell for the Your Career page.
//   Work History — full-width company cards (the previous History view).
//   Narratives  — narrative-arc + voice-rules pulled from job.vision,
//                 plus a horizontal carousel of skill-prompts derived from
//                 patterns in the live pipeline JDs.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { fetchPipeline, formatResumeText, fetchNarratives, saveNarrative, linkNarrative, deleteNarrative }, { readRoleAsset, writeRoleAsset }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../roleAsset.js' + V),
]);

const BASE_RESUME_SLUG = '__base__';

// File → string. .md/.txt are read as UTF-8 text. .pdf uses pdfjs-dist
// (loaded on first use) to extract text from each page. Anything else
// is read as text and best-effort.
async function readFileAsText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    return await readPdfAsText(file);
  }
  return await file.text();
}

let _pdfLib = null;
async function getPdfLib() {
  if (_pdfLib) return _pdfLib;
  // pdfjs-dist v4 requires a worker. Pin both main + worker to the same
  // version on jsdelivr so they stay in sync.
  const PDFJS_VERSION = '4.7.76';
  const mod = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.mjs`);
  mod.GlobalWorkerOptions.workerSrc =
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/pdf.worker.min.mjs`;
  _pdfLib = mod;
  return mod;
}

async function readPdfAsText(file) {
  const lib = await getPdfLib();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Re-flow text items into lines using their y coordinates.
    const lines = new Map();
    for (const item of tc.items) {
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push(item);
    }
    const ordered = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    pages.push(ordered.join('\n'));
  }
  return pages.join('\n\n').trim();
}

// Lazy-load the resume sub-component so the Work History tab doesn't
// pull markdown deps when only the Narratives tab is active.
import('./job-history-resume.js' + V);

const TABS = [
  { id: 'work',       label: 'Work history' },
  { id: 'narratives', label: 'Narratives' },
  { id: 'base',       label: 'Base resume' },
];

// Minimal seed of skill prompts. Real version derives prompts from JD
// patterns in pipeline_roles.title + sector tags. v1: hand-curated.
const FALLBACK_PROMPTS = [
  { tag: 'Platform thinking', prompt: 'Tell me about a time you protected shared infrastructure from a product team that wanted to fork.' },
  { tag: 'Healthcare',        prompt: 'Walk me through one decision in a regulated environment where the right product call clashed with compliance.' },
  { tag: 'Growth',            prompt: 'Describe an experiment that changed your gut about how the funnel actually worked.' },
  { tag: 'Zero-to-one',       prompt: 'Pick a feature you killed before launch. What signal told you to stop?' },
  { tag: 'Founding PM',       prompt: 'How do you decide what NOT to build when the company is pre-PMF?' },
  { tag: 'AI',                prompt: 'When does an AI feature need a hard guarantee, and when is "best effort" honest?' },
];

export class JobCareer extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    activeTab: { state: true },
    vision: { state: true },
    promptTags: { state: true },
    baseResume: { state: true },     // saved row: { content, missing, generating, error }
    baseDraft: { state: true },      // editing buffer: { text, status, error } — status in idle|reading|formatting|saving
    narrativeAdditions: { state: true }, // legacy: appended-blob fallback from older opportunity threads
    narratives: { state: true },         // [{ id, title, content_md, tags, linked_company_slug, needs_link, ... }]
    companies: { state: true },          // [{ slug, name, sector }] for the link picker
    composing: { state: true },          // { open, title, text, savedId, saving, error } | null
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    const tabParam = new URLSearchParams(location.search).get('tab');
    this.activeTab = TABS.find(t => t.id === tabParam)?.id || 'work';
    this.vision = null;
    this.promptTags = [];
    this.baseResume = { content: '', missing: true, generating: false, error: '' };
    this.baseDraft = { text: '', status: 'idle', error: '' };
    this.narrativeAdditions = '';
    this.narratives = [];
    this.companies = [];
    this.composing = null;
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
      // Pull the live pipeline so we can derive prompts from real JD tags.
      const data = await fetchPipeline();
      const tagCounts = new Map();
      for (const r of (data.roles || [])) {
        for (const t of (r.sectorTags || [])) {
          tagCounts.set(t.name, (tagCounts.get(t.name) || 0) + 1);
        }
      }
      // Top 8 tags by frequency become the carousel filter chips.
      this.promptTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));
      // Best-effort load of the base resume — fine if absent.
      try {
        const r = await readRoleAsset(BASE_RESUME_SLUG, 'resume');
        if (r?.content_md) this.baseResume = { content: r.content_md, missing: false, generating: false, error: '' };
      } catch { /* leave missing=true */ }
      // Best-effort load of narrative-additions for the Narratives tab.
      try {
        const n = await readRoleAsset('__narratives__', 'notes');
        if (n?.content_md) this.narrativeAdditions = n.content_md;
      } catch { /* leave empty */ }
      // Structured narratives + the company list for the link picker.
      try {
        const ns = await fetchNarratives();
        this.narratives = ns;
      } catch { this.narratives = []; }
      // Companies for the "Needs connection" dropdown — derived from the
      // pipeline tag space isn't enough; we want the actual work history.
      // For now, scrape unique companies from existing narratives' links
      // plus the roles' companies in pipeline (best-effort).
      const companies = new Map();
      for (const r of (data.roles || [])) {
        if (r.company) companies.set(r.company.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), { slug: r.company.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), name: r.company });
      }
      for (const n of this.narratives) {
        if (n.linked_company_slug && !companies.has(n.linked_company_slug)) {
          companies.set(n.linked_company_slug, { slug: n.linked_company_slug, name: n.linked_company_slug });
        }
      }
      this.companies = Array.from(companies.values()).sort((a, b) => a.name.localeCompare(b.name));
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  _switchTab(id) {
    this.activeTab = id;
    const qs = id === 'work' ? '' : `?tab=${id}`;
    history.replaceState(null, '', `/job/history/${qs}`);
  }

  // Upload: extract text, then automatically run it through Claude to
  // restore structure (headings, bullets) without changing any facts.
  // Result lands in the draft for review before save. The format-resume
  // prompt explicitly preserves every fact verbatim — only structure is
  // touched, so no text is lost. If the cleanup pass fails, fall back to
  // the raw extracted text so the user can save or retry manually.
  async _onBaseUpload(file) {
    if (!file) return;
    this.baseDraft = { text: '', status: 'reading', error: '' };
    let raw = '';
    try {
      raw = await readFileAsText(file);
      if (!raw || !raw.trim()) throw new Error('Empty file');
    } catch (e) {
      this.baseDraft = { text: '', status: 'idle', error: String(e?.message || e) };
      return;
    }
    this.baseDraft = { text: raw, status: 'formatting', error: '' };
    try {
      const cleaned = await formatResumeText(raw);
      this.baseDraft = { text: cleaned, status: 'idle', error: '' };
    } catch (e) {
      // Cleanup failed — keep the raw text and surface the error so the
      // user can retry the AI pass manually or just save as-is.
      this.baseDraft = { text: raw, status: 'idle', error: `AI cleanup failed (${String(e?.message || e)}). Showing raw text — click "Clean up with AI" to retry.` };
    }
  }

  _onDraftInput(e) {
    this.baseDraft = { ...this.baseDraft, text: e.target.value };
  }

  // Send the draft text through Claude to reformat into clean markdown.
  // Replaces the draft with the cleaned version on success.
  async _onCleanupDraft() {
    const text = (this.baseDraft.text || '').trim();
    if (!text) {
      this.baseDraft = { ...this.baseDraft, error: 'Paste or upload resume text first.' };
      return;
    }
    this.baseDraft = { ...this.baseDraft, status: 'formatting', error: '' };
    try {
      const cleaned = await formatResumeText(text);
      this.baseDraft = { text: cleaned, status: 'idle', error: '' };
    } catch (e) {
      this.baseDraft = { ...this.baseDraft, status: 'idle', error: String(e?.message || e) };
    }
  }

  async _onSaveDraft() {
    const text = (this.baseDraft.text || '').trim();
    if (!text) {
      this.baseDraft = { ...this.baseDraft, error: 'Nothing to save.' };
      return;
    }
    this.baseDraft = { ...this.baseDraft, status: 'saving', error: '' };
    try {
      await writeRoleAsset(BASE_RESUME_SLUG, 'resume', text);
      this.baseResume = { content: text, missing: false, generating: false, error: '' };
      this.baseDraft = { text: '', status: 'idle', error: '' };
    } catch (e) {
      this.baseDraft = { ...this.baseDraft, status: 'idle', error: String(e?.message || e) };
    }
  }

  _onBaseClear() {
    // Reveal the upload/edit zone again, seeded with the saved content so
    // the user can edit-in-place rather than starting from scratch.
    this.baseDraft = { text: this.baseResume.content || '', status: 'idle', error: '' };
    this.baseResume = { content: '', missing: true, generating: false, error: '' };
  }

  // Run the AI cleanup on the already-saved base resume in place. Useful
  // when the saved version came from a raw PDF extract and reads poorly.
  async _onCleanupSaved() {
    const text = (this.baseResume.content || '').trim();
    if (!text) return;
    this.baseResume = { ...this.baseResume, generating: true, error: '' };
    try {
      const cleaned = await formatResumeText(text);
      await writeRoleAsset(BASE_RESUME_SLUG, 'resume', cleaned);
      this.baseResume = { content: cleaned, missing: false, generating: false, error: '' };
    } catch (e) {
      this.baseResume = { ...this.baseResume, generating: false, error: String(e?.message || e) };
    }
  }

  _renderBase() {
    const b = this.baseResume;
    const d = this.baseDraft;
    if (this.state === 'loading') {
      return html`
        <div class="skeleton" style="width:100%;height:14px;display:block;margin-bottom:8px;"></div>
        <div class="skeleton" style="width:96%;height:14px;display:block;margin-bottom:8px;"></div>
        <div class="skeleton" style="width:80%;height:14px;display:block;"></div>
      `;
    }
    const hasContent = !!b.content;
    const busy = d.status !== 'idle';
    return html`
      <section class="narrative-block">
        <header style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);margin-bottom:var(--space-3);flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;">Base resume</h2>
            <p class="muted" style="margin:0;font-size:var(--font-size-small);">
              Upload or paste your canonical resume, then clean it up with AI before saving. Per-role tailoring diffs against this.
            </p>
          </div>
          ${hasContent ? html`
            <div style="display:flex;gap:var(--space-2);">
              <button class="btn btn--sm" ?disabled=${busy || b.generating} @click=${() => this._onCleanupSaved()}>
                ${b.generating ? 'Cleaning up…' : 'Clean up with AI'}
              </button>
              <button class="btn btn--sm" ?disabled=${busy || b.generating} @click=${() => this._onBaseClear()}>Replace</button>
            </div>
          ` : nothing}
        </header>

        ${!hasContent ? html`
          <div class="base-upload">
            <label class="base-upload__drop">
              <input type="file" accept=".md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf"
                     @change=${(e) => this._onBaseUpload(e.target.files?.[0])}
                     ?disabled=${busy}>
              <span class="base-upload__cta">
                ${d.status === 'reading' ? html`<span class="gen-shimmer">Reading file…</span>`
                  : d.status === 'formatting' ? html`<span class="gen-shimmer">Cleaning up with AI…</span>`
                  : 'Upload resume'}
              </span>
              <span class="muted" style="font-size:var(--font-size-small);">.md, .txt, or .pdf — auto-formatted on upload, no facts changed</span>
            </label>

            <textarea class="asset-editor" style="margin-top: var(--space-4); min-height: 320px;"
                      placeholder="# Your name&#10;&#10;Upload above, or paste markdown / plain text here. Then click Clean up with AI to fix structure, or Save to keep as-is."
                      .value=${d.text}
                      @input=${(e) => this._onDraftInput(e)}
                      ?disabled=${busy}></textarea>

            <div style="display:flex;gap:var(--space-3);margin-top:var(--space-3);align-items:center;flex-wrap:wrap;">
              <button class="btn btn--sm" ?disabled=${busy || !d.text.trim()} @click=${() => this._onCleanupDraft()}>
                ${d.status === 'formatting' ? html`<span class="gen-shimmer">Cleaning up…</span>` : 'Clean up with AI'}
              </button>
              <button class="btn btn--sm btn--primary" ?disabled=${busy || !d.text.trim()} @click=${() => this._onSaveDraft()}>
                ${d.status === 'saving' ? html`<span class="gen-shimmer">Saving…</span>` : 'Save'}
              </button>
              <span class="muted" style="font-size:var(--font-size-small);">
                AI rewrites structure (headings, bullets) without changing facts. Review before saving.
              </span>
            </div>
          </div>
        ` : nothing}

        ${d.error ? html`<p class="muted" style="color:var(--error);margin-top:var(--space-3);">${d.error}</p>` : nothing}
        ${b.error ? html`<p class="muted" style="color:var(--error);margin-top:var(--space-3);">${b.error}</p>` : nothing}

        ${hasContent
          ? html`<article class="kb-doc asset-doc" style="margin-top: var(--space-4);">${unsafeHTML(renderMarkdown(b.content))}</article>`
          : nothing}
      </section>
    `;
  }

  _renderTabs() {
    return html`
      <div class="asset-tabs">
        ${TABS.map(t => html`
          <button class="asset-tabs__tab ${this.activeTab === t.id ? 'is-active' : ''}"
                  @click=${() => this._switchTab(t.id)}>
            ${t.label}
          </button>
        `)}
      </div>
    `;
  }

  _renderWork() {
    return html`<job-history-resume></job-history-resume>`;
  }

  _renderNarratives() {
    if (this.state === 'loading') {
      return html`
        <section style="margin-bottom: var(--space-6);">
          <div class="skeleton" style="width:200px;height:18px;display:block;margin-bottom:var(--space-3);"></div>
          <div class="skeleton" style="width:100%;height:14px;display:block;margin-bottom:8px;"></div>
          <div class="skeleton" style="width:96%;height:14px;display:block;margin-bottom:8px;"></div>
          <div class="skeleton" style="width:80%;height:14px;display:block;"></div>
        </section>
      `;
    }

    const needsLink = (this.narratives || []).filter(n => n.needs_link);
    const linked = (this.narratives || []).filter(n => !n.needs_link);

    return html`
      <section class="narrative-block">
        <header style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);margin-bottom:var(--space-3);flex-wrap:wrap;">
          <div>
            <h2 style="margin:0;">Stories</h2>
            <p class="muted" style="margin:0;font-size:var(--font-size-small);">
              Discrete stories the cover-letter generator can draw from. Tags + work-history link are auto-set on save.
            </p>
          </div>
          <button class="btn btn--sm btn--primary" @click=${() => this._openCompose()}>New story</button>
        </header>

        ${this.composing?.open ? this._renderComposer() : nothing}

        ${needsLink.length ? html`
          <section class="narrative-needs">
            <h3 class="narrative-needs__title">
              <span class="narrative-needs__pill">✦ ${needsLink.length}</span>
              Stories that need a work-history connection
            </h3>
            <div class="narrative-grid">
              ${needsLink.map(n => this._renderNarrativeCard(n))}
            </div>
          </section>
        ` : nothing}

        ${linked.length ? html`
          <div class="narrative-grid">
            ${linked.map(n => this._renderNarrativeCard(n))}
          </div>
        ` : nothing}

        ${!this.narratives?.length ? html`
          <p class="muted" style="font-size:var(--font-size-small);">No stories yet. Click "New story" to capture one.</p>
        ` : nothing}
      </section>

      ${this.narrativeAdditions ? html`
        <section class="narrative-block">
          <details>
            <summary class="muted" style="cursor:pointer;font-size:var(--font-size-small);">
              Legacy additions (opportunity-thread blob)
            </summary>
            <article class="kb-doc" style="margin-top: var(--space-3);">${unsafeHTML(renderMarkdown(this.narrativeAdditions))}</article>
          </details>
        </section>
      ` : nothing}
    `;
  }

  _renderComposer() {
    const c = this.composing;
    return html`
      <article class="narrative-composer">
        <input class="narrative-composer__title" type="text" placeholder="Story title (e.g. Scaling Livongo eligibility infra)"
               .value=${c.title}
               @input=${(e) => this.composing = { ...this.composing, title: e.target.value }}>
        <textarea class="narrative-composer__text" placeholder="Write the story. Specific moments, decisions, outcomes."
                  .value=${c.text}
                  @input=${(e) => this.composing = { ...this.composing, text: e.target.value }}></textarea>
        ${c.error ? html`<p class="muted" style="color:var(--error);margin:0;">${c.error}</p>` : nothing}
        <div class="narrative-composer__actions">
          <button class="btn btn--sm btn--primary" ?disabled=${c.saving || !c.title.trim() || !c.text.trim()}
                  @click=${() => this._saveCompose()}>
            ${c.saving ? html`<span class="gen-shimmer">Saving</span>` : 'Save story'}
          </button>
          <button class="btn btn--sm" ?disabled=${c.saving} @click=${() => this.composing = null}>Cancel</button>
          <span class="muted" style="font-size:var(--font-size-small);">Tags and work-history link are inferred on save.</span>
        </div>
      </article>
    `;
  }

  _renderNarrativeCard(n) {
    const co = this.companies.find(c => c.slug === n.linked_company_slug);
    return html`
      <article class="narrative-card ${n.needs_link ? 'narrative-card--needs-link' : ''}">
        <header class="narrative-card__head">
          <h4 class="narrative-card__title">${n.title}</h4>
          <button class="narrative-card__del" title="Delete" @click=${() => this._deleteStory(n.id)}>×</button>
        </header>
        <div class="narrative-card__tags">
          ${(n.tags || []).map(t => html`<span class="tag-chip narrative-tag">${t}</span>`)}
        </div>
        ${n.needs_link ? html`
          <div class="narrative-card__link narrative-card__link--needs">
            <label class="muted" style="font-size:var(--font-size-caption);">Which work experience does this connect to?</label>
            <div class="narrative-card__link-row">
              <select @change=${(e) => this._linkStory(n.id, e.target.value || null)}>
                <option value="">Pick a company…</option>
                ${this.companies.map(c => html`<option value=${c.slug}>${c.name}</option>`)}
              </select>
              <button class="btn btn--sm" @click=${() => this._linkStory(n.id, null, { skip: true })}>Skip</button>
            </div>
          </div>
        ` : html`
          <div class="narrative-card__link">
            <span class="muted" style="font-size:var(--font-size-caption);">Linked to</span>
            <strong>${co?.name || n.linked_company_slug}</strong>
            <button class="narrative-card__unlink" @click=${() => this._linkStory(n.id, null)} title="Unlink">change</button>
          </div>
        `}
        <div class="narrative-card__body kb-doc">${unsafeHTML(renderMarkdown(this._truncate(n.content_md, 320)))}</div>
      </article>
    `;
  }

  _truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  _openCompose() {
    this.composing = { open: true, title: '', text: '', saving: false, error: '' };
  }

  async _saveCompose() {
    const c = this.composing;
    if (!c) return;
    this.composing = { ...c, saving: true, error: '' };
    try {
      const saved = await saveNarrative({ title: c.title, content_md: c.text });
      this.narratives = [saved, ...this.narratives.filter(n => n.id !== saved.id)];
      this.composing = null;
    } catch (e) {
      this.composing = { ...c, saving: false, error: String(e?.message || e) };
    }
  }

  async _linkStory(id, slug, opts = {}) {
    // skip=true means "don't show this needs-link prompt anymore, but
    // leave the link null". Implemented by setting linked_company_slug
    // to null with a special flag; here we just clear needs_link by
    // posting null (server treats that as "explicit skip" via slug='').
    // Simpler v1: send the chosen slug; if null + skip, send empty
    // string which the server clears + leaves needs_link=true. So we
    // patch the local state directly to mark "ignored".
    try {
      if (opts.skip) {
        // Mark locally only — no server change.
        this.narratives = this.narratives.map(n => n.id === id ? { ...n, needs_link: false } : n);
        return;
      }
      const updated = await linkNarrative(id, slug);
      this.narratives = this.narratives.map(n => n.id === id ? updated : n);
    } catch (e) {
      // Surface inline; UI keeps the prompt up.
      this.narratives = this.narratives.map(n => n.id === id ? { ...n, _error: String(e?.message || e) } : n);
    }
  }

  async _deleteStory(id) {
    if (!confirm('Delete this story?')) return;
    try {
      await deleteNarrative(id);
      this.narratives = this.narratives.filter(n => n.id !== id);
    } catch (e) {
      alert(`Delete failed: ${String(e?.message || e)}`);
    }
  }

  render() {
    return html`
      ${this._renderTabs()}
      ${this.activeTab === 'work' ? this._renderWork()
        : this.activeTab === 'narratives' ? this._renderNarratives()
        : this._renderBase()}
    `;
  }
}

customElements.define('job-career', JobCareer);
