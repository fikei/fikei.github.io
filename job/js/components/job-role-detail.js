// job-role-detail — per-role detail page with Details / Resume / Cover Letter
// tabs. The Details tab is the default landing and shows AI-generated cards
// (Why it fits / Risks / Candidate strength) plus role metadata. Apply button
// in the top-right opens the posting in a new tab.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { generateAsset, fetchPipeline, readRolePrefill }, { readRoleAsset, writeRoleAsset }, { logoSrc, logoInitial }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../roleAsset.js' + V),
  import('../logo.js' + V),
]);

const TABS = [
  { id: 'details',      label: 'Details' },
  { id: 'resume',       label: 'Resume' },
  { id: 'cover-letter', label: 'Cover letter' },
];

const KIND_BY_TAB = {
  details: 'analysis',
  resume: 'resume',
  'cover-letter': 'cover-letter',
};

function fmtDate(s) {
  if (!s) return '—';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
}

function fitClass(s) {
  if (s == null) return 'fit-pill fit-pill--poor';
  if (s >= 70) return 'fit-pill fit-pill--strong';
  if (s >= 50) return 'fit-pill fit-pill--ok';
  if (s >= 30) return 'fit-pill fit-pill--weak';
  return 'fit-pill fit-pill--poor';
}

export class JobRoleDetail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    slug: { state: true },
    activeTab: { state: true },
    role: { state: true },
    assets: { state: true },         // { resume, cover-letter, analysis } each: {content, draft, mode, saving, dirty, error}
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    const params = new URLSearchParams(location.search);
    this.slug = (params.get('slug') || '').toLowerCase();
    const tab = params.get('tab');
    this.activeTab = TABS.find(t => t.id === tab)?.id || 'details';
    // Pre-populate from sessionStorage if the user came from /job/jobs/.
    // Title/company/tags paint instantly; the network refresh fills in
    // analysis + resume + cover.
    this.role = this.slug ? readRolePrefill(this.slug) : null;
    this.assets = { 'resume': null, 'cover-letter': null, 'analysis': null };

    const pretty = sessionStorage.getItem('job:prettyPath');
    if (pretty && /^\/job\/jobs\/[a-z0-9-]+\/?$/.test(pretty)) {
      sessionStorage.removeItem('job:prettyPath');
      const qs = this.activeTab !== 'details' ? `?tab=${this.activeTab}` : '';
      history.replaceState(null, '', pretty.replace(/\/?$/, '/') + qs);
    } else if (this.slug) {
      const qs = this.activeTab !== 'details' ? `?tab=${this.activeTab}` : '';
      history.replaceState(null, '', `/job/jobs/${this.slug}/${qs}`);
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
    if (!this.slug) { this.state = 'error'; this.error = 'Missing slug'; return; }
    this.state = 'loading';
    try {
      // Load the role row + all three asset rows in parallel.
      const [pipeline, resume, cover, analysis] = await Promise.all([
        fetchPipeline(),
        this._loadAsset('resume'),
        this._loadAsset('cover-letter'),
        this._loadAsset('analysis'),
      ]);
      this.role = (pipeline.roles || []).find(r => r.slug === this.slug) || null;
      this.assets = { 'resume': resume, 'cover-letter': cover, 'analysis': analysis };
      this.state = 'loaded';
      document.title = this.role
        ? `${this.role.company} — ${this.role.title} — /job`
        : `${this.slug} — /job`;
      // Auto-generate any missing asset.
      this._autoGenerateMissing();
    } catch (e) {
      this.state = 'error';
      this.error = String(e);
    }
  }

  async _loadAsset(kind) {
    try {
      const r = await readRoleAsset(this.slug, kind);
      if (!r) return { kind, content: '', draft: '', mode: 'empty', saving: false, dirty: false, error: '' };
      return { kind, content: r.content_md, draft: r.content_md, mode: 'view', saving: false, dirty: false, error: '' };
    } catch (e) {
      return { kind, content: '', draft: '', mode: 'empty', saving: false, dirty: false, error: String(e) };
    }
  }

  _autoGenerateMissing() {
    for (const kind of ['analysis', 'resume', 'cover-letter']) {
      const a = this.assets[kind];
      if (a && a.mode === 'empty' && !a.saving) this._onGenerate(kind);
    }
  }

  _switchTab(id) {
    this.activeTab = id;
    const qs = id !== 'details' ? `?tab=${id}` : '';
    history.replaceState(null, '', `/job/jobs/${this.slug}/${qs}`);
  }

  async _onGenerate(kind) {
    const a = this.assets[kind] || { kind };
    this.assets = { ...this.assets, [kind]: { ...a, saving: true, error: '' } };
    try {
      const res = await generateAsset(this.slug, kind);
      this.assets = {
        ...this.assets,
        [kind]: { kind, content: res.content, draft: res.content, mode: 'view', saving: false, dirty: false, error: '' },
      };
    } catch (e) {
      this.assets = { ...this.assets, [kind]: { ...this.assets[kind], saving: false, error: String(e) } };
    }
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
      await writeRoleAsset(this.slug, kind, a.draft);
      this.assets = { ...this.assets, [kind]: { ...a, content: a.draft, mode: 'view', saving: false, dirty: false } };
    } catch (e) {
      this.assets = { ...this.assets, [kind]: { ...a, saving: false, error: String(e) } };
    }
  }

  // --- Details tab ---------------------------------------------------------

  _parseAnalysis(content) {
    if (!content) return null;
    // Tolerate bare JSON or JSON inside ```json fences. Backwards-compatible
    // with the v0.18 shape (no roleFitScore/candidateScore/strengths/gaps).
    const stripped = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    let obj = null;
    try {
      const parsed = JSON.parse(stripped);
      if (parsed && typeof parsed === 'object') obj = parsed;
    } catch { /* fall back below */ }

    if (!obj) {
      // Old "## Section" markdown fallback.
      const sections = {};
      const lines = content.split(/\r?\n/);
      let cur = null;
      let buf = [];
      const flush = () => { if (cur) sections[cur] = buf.join('\n').trim(); buf = []; };
      for (const line of lines) {
        const m = line.match(/^##\s+(.+)$/);
        if (m) { flush(); cur = m[1].toLowerCase().replace(/\s+/g, ''); }
        else buf.push(line);
      }
      flush();
      obj = {
        description: sections['briefdescription'] || sections['description'] || content,
        whyFits: sections['whyitfits'] || sections['whyfits'] || '',
        risks: sections['risks'] || '',
        strengths: sections['strengths'] || sections['candidatestrength'] || '',
        gaps: sections['gaps'] || '',
        suggestedAngle: sections['suggestedangle'] || sections['angle'] || '',
      };
    }

    // Normalize: in the previous shape, `candidateStrength` carried strengths
    // text. Promote it into `strengths` if `strengths` is empty.
    if (!obj.strengths && obj.candidateStrength) obj.strengths = obj.candidateStrength;

    return obj;
  }

  _scoreFromAnalysis(parsed, key) {
    const v = (parsed && parsed[key] || '').toString().toLowerCase().trim();
    if (!v) return null;
    if (/^(strong|strong fit|high)/.test(v)) return 'strong';
    if (/^(mid|mixed|medium|moderate|ok)/.test(v)) return 'mid';
    if (/^(weak|stretch|low|poor)/.test(v)) return 'weak';
    return v.includes('strong') ? 'strong' : v.includes('weak') || v.includes('stretch') ? 'weak' : 'mid';
  }

  _renderMetaRow() {
    const r = this.role;
    if (!r) return nothing;
    const items = [
      ['Fit', html`<span class=${fitClass(r.score)} style="padding:2px var(--space-2);font-size:var(--font-size-small);">${r.score == null ? '—' : r.score}</span>`],
      ['Status', r.status || '—'],
      ['Sector', r.sector || '—'],
      ['Compensation', r.salary || '—'],
      ['Source', r.source || '—'],
      ['Added', fmtDate(r.first_seen || r.applied_at)],
      ['Last seen', fmtDate(r.last_seen || r.status_changed_at)],
    ];
    return html`
      <dl class="role-meta">
        ${items.map(([k, v]) => html`
          <div class="role-meta__item">
            <dt>${k}</dt>
            <dd>${v}</dd>
          </div>
        `)}
      </dl>
    `;
  }

  _renderStoplight(score) {
    if (!score) return nothing;
    const labels = { strong: 'Strong fit', mid: 'Mixed fit', weak: 'Weak fit' };
    return html`<span class="stoplight stoplight--${score}">${labels[score] || score}</span>`;
  }
  _renderCandidateStoplight(score) {
    if (!score) return nothing;
    const labels = { strong: 'Strong candidate', mid: 'Mid candidate', weak: 'Stretch candidate' };
    return html`<span class="stoplight stoplight--${score}">${labels[score] || score}</span>`;
  }

  _renderTwoColCard({ title, headerExtra, sections, status }) {
    return html`
      <article class="role-card">
        <header class="role-card__head role-card__head--with-extra">
          <h3>${title}</h3>
          ${headerExtra || nothing}
        </header>
        <div class="role-card__body">
          ${status === 'loading' ? html`<p class="muted"><span class="dots-anim">Generating</span></p>`
            : status === 'error'  ? html`<p class="muted" style="color:var(--error);">Couldn't load</p>`
            : html`
              <div class="role-card__split">
                ${sections.map(([heading, body]) => html`
                  <section class="role-card__section">
                    <h4>${heading}</h4>
                    ${body
                      ? html`<div class="kb-doc">${unsafeHTML(renderMarkdown(body))}</div>`
                      : html`<p class="muted">—</p>`}
                  </section>
                `)}
              </div>
            `}
        </div>
      </article>
    `;
  }

  _renderDetails() {
    const a = this.assets['analysis'];
    const status = !a ? 'loading' : a.saving ? 'loading' : a.error ? 'error' : a.mode === 'empty' ? 'loading' : 'ok';
    const parsed = a && a.mode === 'view' ? this._parseAnalysis(a.content) : null;
    const roleFit = this._scoreFromAnalysis(parsed, 'roleFitScore');
    const candidate = this._scoreFromAnalysis(parsed, 'candidateScore');
    return html`
      ${this._renderMetaRow()}
      ${parsed?.description ? html`
        <section class="role-summary">
          <div class="kb-doc">${unsafeHTML(renderMarkdown(parsed.description))}</div>
        </section>
      ` : status === 'loading' ? html`<p class="muted">Drafting summary…</p>` : nothing}

      <div class="role-cards">
        ${this._renderTwoColCard({
          title: 'Role fit',
          headerExtra: this._renderStoplight(roleFit),
          sections: [
            ['Why it fits', parsed?.whyFits],
            ['Risks',       parsed?.risks],
          ],
          status,
        })}
        ${this._renderTwoColCard({
          title: 'Candidate strength',
          headerExtra: this._renderCandidateStoplight(candidate),
          sections: [
            ['Strengths', parsed?.strengths],
            ['Gaps',      parsed?.gaps],
          ],
          status,
        })}
      </div>

      ${parsed?.suggestedAngle ? html`
        <aside class="role-callout">
          <h4>Suggested angle for the cover letter</h4>
          <div class="kb-doc">${unsafeHTML(renderMarkdown(parsed.suggestedAngle))}</div>
        </aside>
      ` : nothing}

      ${a?.error ? html`<p class="muted" style="color:var(--error);">${a.error}</p>` : nothing}
      <div class="asset-toolbar" style="margin-top:var(--space-5);">
        <button class="btn btn--sm" ?disabled=${a?.saving} @click=${() => this._onGenerate('analysis')}>
          ${a?.saving ? 'Regenerating…' : 'Regenerate analysis'}
        </button>
      </div>
    `;
  }

  // --- Resume / Cover-letter tab body -------------------------------------

  _renderAssetTab(kind) {
    const a = this.assets[kind];
    if (!a) return html`<div class="placeholder"><h2>Loading…</h2></div>`;
    if (a.saving && !a.content) {
      return html`<div class="placeholder">
        <h2><span class="dots-anim">Generating ${kind === 'resume' ? 'resume' : 'cover letter'}</span></h2>
        <p>Pulling Ian's KB + voice rules. ~10–20s.</p>
      </div>`;
    }
    if (a.mode === 'empty') {
      return html`
        <div class="placeholder">
          <h2>No ${kind === 'resume' ? 'resume' : 'cover letter'} yet</h2>
          <p>Generate one tailored to this role using the career KB and voice rules.</p>
          <div style="margin-top:var(--space-4);display:flex;justify-content:center;">
            <button class="btn btn--primary" ?disabled=${a.saving} @click=${() => this._onGenerate(kind)}>
              ${a.saving ? html`<span class="dots-anim">Generating</span>` : `Generate ${kind === 'resume' ? 'resume' : 'cover letter'}`}
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
        : html`<article class="kb-doc asset-doc">${unsafeHTML(renderMarkdown(a.content))}</article>`}
    `;
  }

  _renderChromeFromPrefill() {
    const r = this.role;
    if (!r) return null;
    return html`
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/job/jobs/">Jobs</a>
        ${r.company ? html`<span>›</span><span>${r.company}</span>` : nothing}
        <span>›</span>
        <span>${r.title || this.slug}</span>
      </nav>
      <header class="role-header">
        <div class="role-header__lead">
          ${(() => {
            const src = logoSrc(r);
            return src
              ? html`<img class="company-logo company-logo--lg" src=${src} alt=""
                          loading="lazy" decoding="async"
                          @error=${(e) => {
                            const span = document.createElement('span');
                            span.className = 'company-logo company-logo--lg company-logo--placeholder';
                            span.setAttribute('aria-hidden', 'true');
                            span.textContent = logoInitial(r.company);
                            e.target.replaceWith(span);
                          }}/>`
              : html`<span class="company-logo company-logo--lg company-logo--placeholder" aria-hidden="true">${logoInitial(r.company)}</span>`;
          })()}
          <div class="role-header__title">
            <h1>${r.title || this.slug}</h1>
            <p class="role-header__sub">${r.company || ''}${r.sector ? ` · ${r.sector}` : ''}</p>
          </div>
        </div>
        <div class="role-header__actions">
          ${r.url ? html`
            <a class="btn btn--accent" href=${r.url} target="_blank" rel="noopener noreferrer">Apply ↗</a>
          ` : nothing}
        </div>
      </header>
      ${Array.isArray(r.sectorTags) && r.sectorTags.length ? html`
        <ul class="tag-chips" style="margin: 0 0 var(--space-5);">
          ${r.sectorTags.map(t => html`<li class="tag-chip">${t.name}</li>`)}
        </ul>
      ` : nothing}
    `;
  }

  _renderShimmerBody() {
    return html`
      <dl class="role-meta">
        ${Array.from({ length: 6 }).map(() => html`
          <div class="role-meta__item">
            <dt><span class="skeleton" style="width:48px;height:11px;display:inline-block;"></span></dt>
            <dd><span class="skeleton" style="width:80%;height:14px;display:inline-block;"></span></dd>
          </div>
        `)}
      </dl>
      <div class="skeleton" style="width:100%;height:48px;border-radius:var(--radius-md);margin-bottom:var(--space-5);"></div>
      <div class="role-cards">
        ${Array.from({ length: 2 }).map(() => html`
          <div class="role-card">
            <div class="skeleton" style="width:140px;height:18px;display:inline-block;"></div>
            <div class="role-card__split" style="margin-top:var(--space-3);">
              ${Array.from({ length: 2 }).map(() => html`
                <section>
                  <div class="skeleton" style="width:80px;height:11px;display:block;margin-bottom:var(--space-2);"></div>
                  <div class="skeleton" style="width:100%;height:12px;display:block;margin-bottom:6px;"></div>
                  <div class="skeleton" style="width:90%;height:12px;display:block;margin-bottom:6px;"></div>
                  <div class="skeleton" style="width:70%;height:12px;display:block;"></div>
                </section>
              `)}
            </div>
          </div>
        `)}
      </div>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      // If the user came from the pipeline we already have title/company/tags
      // in sessionStorage — paint that instantly with a shimmer body below.
      if (this.role) {
        return html`
          ${this._renderChromeFromPrefill()}
          <div class="asset-tabs">
            ${TABS.map(t => html`
              <button class="asset-tabs__tab ${this.activeTab === t.id ? 'is-active' : ''}"
                      @click=${() => this._switchTab(t.id)}>
                ${t.label}
              </button>
            `)}
          </div>
          <section class="asset-panel">
            ${this._renderShimmerBody()}
          </section>
        `;
      }
      return html`
        <div class="skeleton" style="width:140px;height:14px;margin-bottom:var(--space-3);display:block;"></div>
        <div class="skeleton" style="width:60%;height:36px;margin-bottom:var(--space-2);display:block;"></div>
        <div class="skeleton" style="width:40%;height:18px;margin-bottom:var(--space-5);display:block;"></div>
        ${this._renderShimmerBody()}
      `;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder" style="border-color:var(--error);color:var(--error);">
        <h2>Couldn't load this role</h2>
        <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
      </div>`;
    }
    const r = this.role;
    return html`
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/job/jobs/">Jobs</a>
        ${r?.company ? html`<span>›</span><span>${r.company}</span>` : nothing}
        <span>›</span>
        <span>${r?.title || this.slug}</span>
      </nav>

      <header class="role-header">
        <div class="role-header__lead">
          ${(() => {
            const src = logoSrc(r);
            return src
              ? html`<img class="company-logo company-logo--lg" src=${src} alt=""
                          loading="lazy" decoding="async"
                          @error=${(e) => {
                            const span = document.createElement('span');
                            span.className = 'company-logo company-logo--lg company-logo--placeholder';
                            span.setAttribute('aria-hidden', 'true');
                            span.textContent = logoInitial(r?.company);
                            e.target.replaceWith(span);
                          }}/>`
              : html`<span class="company-logo company-logo--lg company-logo--placeholder" aria-hidden="true">${logoInitial(r?.company)}</span>`;
          })()}
          <div class="role-header__title">
            <h1>${r?.title || this.slug}</h1>
            <p class="role-header__sub">${r?.company || ''}${r?.sector ? ` · ${r.sector}` : ''}</p>
          </div>
        </div>
        <div class="role-header__actions">
          ${r?.url ? html`
            <a class="btn btn--accent" href=${r.url} target="_blank" rel="noopener noreferrer">
              Apply ↗
            </a>
          ` : nothing}
        </div>
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
        ${this.activeTab === 'details' ? this._renderDetails() : this._renderAssetTab(this.activeTab)}
      </section>
    `;
  }
}

customElements.define('job-role-detail', JobRoleDetail);
