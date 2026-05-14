// job-apply — full-screen Apply takeover. Steps the user through the
// application: general info → resume → cover letter (if required) →
// custom questions (one per page) → review.
//
// PR1 scope: takeover shell, step nav, draft persistence, stub bodies
// per step. Subsequent PRs:
//   PR2 — extract-application-fields edge fn → populates fields/questions
//   PR3 — General + Resume step bodies (reuse review tools)
//   PR4 — Cover letter step (reuse annotation UI)
//   PR5 — Custom questions step with AI annotated answers
//   PR6 — Auto-submit handoff
const VERSION = '0.6.0';
console.log(`[job-apply] v${VERSION} - + review & submit handoff (PR6)`);

import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';

const V = (new URL(import.meta.url)).search;
const [
  { readApplicationDraft, upsertApplicationDraft, extractApplicationFields, generateQuestionAnswer, STEPS, visibleSteps },
  { readRoleAsset },
  { renderMarkdown },
  { diffMarkdown, applyAIHighlights },
  { fetchCoverRationale },
] = await Promise.all([
  import('../apply.js' + V),
  import('../roleAsset.js' + V),
  import('../markdown.js' + V),
  import('../diff.js' + V),
  import('../pipeline.js' + V),
]);

const BASE_RESUME_SLUG = '__base__';

export class JobApply extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    open:       { type: Boolean, reflect: true },
    slug:       { type: String },
    role:       { state: true },
    draft:      { state: true },   // application_draft row
    step:       { state: true },   // current step id
    state:      { state: true },   // 'idle' | 'loading' | 'ready' | 'error'
    error:      { state: true },
    saving:     { state: true },
    extracting: { state: true },   // 'idle' | 'running' | 'error'
    extractErr: { state: true },
    profile:    { state: true },   // user_profile row
    resumeMd:   { state: true },   // tailored resume markdown
    baseMd:     { state: true },   // base resume markdown (for diff)
    showDiff:   { state: true },
    resumeState:{ state: true },   // 'idle'|'loading'|'ready'|'error'
    coverMd:    { state: true },   // tailored cover letter markdown
    analysisMd: { state: true },   // role analysis JSON (raw markdown blob)
    coverState: { state: true },   // 'idle'|'loading'|'ready'|'error'
    coverHi:    { state: true },   // { highlights, opportunities, loading, error }
    qIdx:       { state: true },   // active custom-question index
    qGen:       { state: true },   // { [qid]: 'idle'|'running'|'error' }
    qErr:       { state: true },   // { [qid]: error message }
  };

  constructor() {
    super();
    this.open    = false;
    this.slug    = '';
    this.role    = null;
    this.draft   = null;
    this.step    = 'general';
    this.state   = 'idle';
    this.error   = '';
    this.saving  = false;
    this.extracting = 'idle';
    this.extractErr = '';
    this.profile = null;
    this.resumeMd = '';
    this.baseMd = '';
    this.showDiff = true;
    this.resumeState = 'idle';
    this.coverMd = '';
    this.analysisMd = '';
    this.coverState = 'idle';
    this.coverHi = { highlights: [], opportunities: [], loading: false, error: '' };
    this.qIdx = 0;
    this.qGen = {};
    this.qErr = {};
    this._answerTimers = {};
  }

  // Public — called by the role detail page when the user clicks Apply.
  async launch({ slug, role }) {
    this.slug = slug;
    this.role = role || null;
    this.open = true;
    document.documentElement.style.overflow = 'hidden';
    this.state = 'loading';
    try {
      let d = await readApplicationDraft(slug);
      if (!d) {
        d = await upsertApplicationDraft(slug, {
          apply_url: role?.url || null,
          fields: {},
          answers: {},
          current_step: 'general',
          status: 'draft',
        });
      }
      this.draft = d;
      this.step  = d.current_step || 'general';
      this.state = 'ready';
      // Fire-and-forget side loads — profile drives prefill, resume
      // assets drive the Resume step diff.
      this._loadProfile();
      this._loadResumeAssets();
      this._loadCoverAssets();
      // Auto-extract on first launch (no extracted_at yet) when we have
      // a posting URL. The takeover stays usable during extraction —
      // step bodies that depend on `fields` show their own loading state.
      const haveFields = !!d?.extracted_at;
      if (!haveFields && (role?.url || d.apply_url)) {
        this._runExtraction(role?.url || d.apply_url);
      }
    } catch (e) {
      this.error = e.message || String(e);
      this.state = 'error';
    }
  }

  async _loadProfile() {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    if (!sb) return;
    try {
      const { data } = await sb.from('user_profile').select('identity, location, capability').maybeSingle();
      this.profile = data || null;
    } catch (e) {
      console.warn('[job-apply] user_profile load failed', e);
    }
  }

  async _loadResumeAssets() {
    this.resumeState = 'loading';
    try {
      const [tailored, base] = await Promise.all([
        readRoleAsset(this.slug, 'resume').catch(() => null),
        readRoleAsset(BASE_RESUME_SLUG, 'resume').catch(() => null),
      ]);
      this.resumeMd = tailored?.content_md || '';
      this.baseMd   = base?.content_md     || '';
      this.resumeState = 'ready';
    } catch (e) {
      this.resumeState = 'error';
      console.warn('[job-apply] resume load failed', e);
    }
  }

  async _loadCoverAssets() {
    this.coverState = 'loading';
    try {
      const [cover, analysis] = await Promise.all([
        readRoleAsset(this.slug, 'cover-letter').catch(() => null),
        readRoleAsset(this.slug, 'analysis').catch(() => null),
      ]);
      this.coverMd    = cover?.content_md    || '';
      this.analysisMd = analysis?.content_md || '';
      this.coverState = 'ready';
      if (this.coverMd && this.analysisMd) this._loadCoverRationale();
    } catch (e) {
      this.coverState = 'error';
      console.warn('[job-apply] cover load failed', e);
    }
  }

  _parseAnalysis(md) {
    if (!md) return null;
    const fence = md.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1] : md;
    try { return JSON.parse(body); } catch { return null; }
  }
  _coverSources() {
    const parsed = this._parseAnalysis(this.analysisMd);
    if (!parsed) return [];
    const out = [];
    if (parsed.suggestedAngle) out.push({ label: 'Suggested angle', text: parsed.suggestedAngle });
    if (parsed.whyFits)        out.push({ label: 'Why it fits',     text: parsed.whyFits });
    if (parsed.strengths)      out.push({ label: 'Strengths',       text: parsed.strengths });
    if (parsed.gaps)           out.push({ label: 'Gaps to address', text: parsed.gaps });
    return out;
  }
  async _loadCoverRationale() {
    const sources = this._coverSources();
    if (!this.coverMd || !sources.length) return;
    this.coverHi = { ...this.coverHi, loading: true, error: '' };
    try {
      const { highlights, opportunities } = await fetchCoverRationale(this.coverMd, sources);
      this.coverHi = { highlights, opportunities, loading: false, error: '' };
    } catch (e) {
      this.coverHi = { ...this.coverHi, loading: false, error: e.message || String(e) };
    }
  }

  async _runExtraction(url) {
    this.extracting = 'running';
    this.extractErr = '';
    try {
      const schema = await extractApplicationFields(this.slug, url);
      // Re-read the draft to pick up server-side merged state.
      const d = await readApplicationDraft(this.slug);
      this.draft = d;
      this.extracting = 'idle';
    } catch (e) {
      this.extracting = 'error';
      this.extractErr = e.message || String(e);
    }
  }

  close() {
    this.open = false;
    document.documentElement.style.overflow = '';
    // Notify the host page so it can clean up routing.
    this.dispatchEvent(new CustomEvent('apply:close', { bubbles: true, composed: true }));
  }

  // --- Step helpers --------------------------------------------------------
  _steps() {
    return visibleSteps(this.draft?.fields || {});
  }
  _stepIndex(id = this.step) {
    return this._steps().findIndex(s => s.id === id);
  }
  _go(id) {
    if (!id) return;
    this.step = id;
    this._persist({ current_step: id });
  }
  _next() {
    const steps = this._steps();
    const i = this._stepIndex();
    if (i < 0 || i >= steps.length - 1) return;
    this._go(steps[i + 1].id);
  }
  _prev() {
    const steps = this._steps();
    const i = this._stepIndex();
    if (i <= 0) return;
    this._go(steps[i - 1].id);
  }

  async _persist(patch) {
    if (!this.slug) return;
    this.saving = true;
    try {
      const updated = await upsertApplicationDraft(this.slug, patch);
      this.draft = updated;
    } catch (e) {
      console.warn('[job-apply] persist failed', e);
    } finally {
      this.saving = false;
    }
  }

  // --- Render --------------------------------------------------------------
  render() {
    if (!this.open) return nothing;
    return html`
      <div class="apply-takeover" role="dialog" aria-modal="true" aria-label="Apply">
        ${this._renderBar()}
        ${this._renderRail()}
        <div class="apply-body">
          ${this.state === 'loading' ? this._renderLoading()
            : this.state === 'error' ? this._renderError()
            : this._renderStep()}
        </div>
        ${this._renderActions()}
      </div>
    `;
  }

  _renderBar() {
    const r = this.role || {};
    return html`
      <header class="apply-bar">
        <div class="apply-bar__brand">/job ✨ <span style="color:var(--apply-ink-muted);font-weight:500;">Apply</span></div>
        <div class="apply-bar__role">
          <div class="apply-bar__role-title">${r.title || this.slug}</div>
          <div class="apply-bar__role-company">${r.company || ''}</div>
        </div>
        <div class="apply-bar__spacer"></div>
        ${this._renderExtractionPill()}
        ${r.url ? html`
          <a class="apply-btn apply-btn--ghost apply-btn--sm" href=${r.url} target="_blank" rel="noopener noreferrer">
            Open posting ↗
          </a>` : nothing}
        <button class="apply-bar__close" @click=${() => this.close()} aria-label="Close apply flow">
          Close ✕
        </button>
      </header>
    `;
  }

  _renderExtractionPill() {
    const d = this.draft;
    if (this.extracting === 'running') {
      return html`<span class="apply-pill apply-pill--info"><span class="apply-loading" style="color:inherit;"></span>Reading the application…</span>`;
    }
    if (this.extracting === 'error') {
      return html`<button class="apply-pill apply-pill--warn" @click=${() => this._runExtraction(this.role?.url || d?.apply_url)}
                          title=${this.extractErr}>Extraction failed — retry</button>`;
    }
    if (d?.extracted_at && d?.fields?.ats) {
      const ats = d.fields.ats;
      const qN = (d.fields.custom_questions || []).length;
      const cl = d.fields.requires?.cover_letter ? ' · cover letter' : '';
      return html`<span class="apply-pill apply-pill--ok" title="Detected via ${ats}">
        ${ats} · ${qN} question${qN === 1 ? '' : 's'}${cl}
      </span>`;
    }
    if (this.role?.url || d?.apply_url) {
      return html`<button class="apply-pill" @click=${() => this._runExtraction(this.role?.url || d?.apply_url)}>
        Detect application fields →
      </button>`;
    }
    return nothing;
  }

  _renderRail() {
    const steps = this._steps();
    const currentIdx = this._stepIndex();
    return html`
      <nav class="apply-rail" aria-label="Apply steps">
        ${steps.map((s, i) => html`
          ${i > 0 ? html`<span class="apply-rail__sep" aria-hidden="true"></span>` : nothing}
          <button class="apply-rail__step ${this.step === s.id ? 'is-active' : ''} ${i < currentIdx ? 'is-done' : ''}"
                  @click=${() => this._go(s.id)}>
            <span class="apply-rail__num">${i < currentIdx ? '✓' : s.num}</span>
            <span>${s.label}</span>
          </button>
        `)}
      </nav>
    `;
  }

  _renderLoading() {
    return html`
      <div class="apply-step">
        <div class="apply-loading">Loading your draft…</div>
      </div>
    `;
  }
  _renderError() {
    return html`
      <div class="apply-step">
        <h1 class="apply-step__title">Couldn't open this application</h1>
        <p class="apply-step__sub">${this.error}</p>
        <div><button class="apply-btn apply-btn--ghost" @click=${() => this.close()}>Close</button></div>
      </div>
    `;
  }

  _renderStep() {
    switch (this.step) {
      case 'general':   return this._renderGeneral();
      case 'resume':    return this._renderResume();
      case 'cover':     return this._renderCover();
      case 'questions': return this._renderQuestions();
      case 'review':    return this._renderReview();
      default:          return this._renderGeneral();
    }
  }

  _stepStub(eyebrow, title, sub, body) {
    return html`
      <section class="apply-step">
        <div class="apply-step__head">
          <div class="apply-step__eyebrow">${eyebrow}</div>
          <h1 class="apply-step__title">${title}</h1>
          ${sub ? html`<p class="apply-step__sub">${sub}</p>` : nothing}
        </div>
        ${body}
      </section>
    `;
  }

  // --- General info -------------------------------------------------------
  _profileValue(mapsTo) {
    const id   = this.profile?.identity || {};
    const loc  = this.profile?.location || {};
    switch (mapsTo) {
      case 'first_name': return id.firstName || id.first_name || (id.name || '').split(/\s+/)[0] || '';
      case 'last_name':  return id.lastName  || id.last_name  || (id.name || '').split(/\s+/).slice(1).join(' ') || '';
      case 'full_name':  return id.name || [id.firstName, id.lastName].filter(Boolean).join(' ') || '';
      case 'email':      return id.email || '';
      case 'phone':      return id.phone || '';
      case 'linkedin':   return id.linkedin || id.linkedinUrl || '';
      case 'github':     return id.github || id.githubUrl || '';
      case 'portfolio':  return id.website || id.portfolio || '';
      case 'location':   return loc.city ? `${loc.city}${loc.region ? ', ' + loc.region : ''}` : (loc.address || '');
      case 'work_auth':  return Array.isArray(loc.workAuth) ? loc.workAuth.join(', ') : (loc.workAuth || '');
      case 'sponsorship':return (loc.needsSponsorship === true) ? 'Yes' : (loc.needsSponsorship === false ? 'No' : '');
      case 'pronouns':   return id.pronouns || '';
      default:           return '';
    }
  }
  _answerFor(fieldId, fallback = '') {
    const a = this.draft?.answers?.[fieldId];
    return (a === undefined || a === null) ? fallback : a;
  }
  _setAnswer(fieldId, value) {
    const answers = { ...(this.draft?.answers || {}), [fieldId]: value };
    // Optimistic update so the input doesn't flicker.
    this.draft = { ...this.draft, answers };
    clearTimeout(this._answerTimers[fieldId]);
    this._answerTimers[fieldId] = setTimeout(() => this._persist({ answers }), 400);
  }

  _renderGeneral() {
    const fields = this.draft?.fields?.general || [];
    const extracted = !!this.draft?.extracted_at;
    return html`
      <section class="apply-step">
        <div class="apply-step__head">
          <div class="apply-step__eyebrow">Step 1 · General info</div>
          <h1 class="apply-step__title">Confirm your basics</h1>
          <p class="apply-step__sub">
            ${extracted
              ? html`We mapped the application's standard fields to your /job profile — skim, edit anything that's off, and continue.`
              : html`We'll pull these directly from your profile once we read the application form.`}
          </p>
        </div>

        ${!extracted ? html`
          <div class="apply-empty">
            ${this.extracting === 'running'
              ? html`<span class="apply-loading">Reading the application's form…</span>`
              : html`Waiting for field extraction to finish.`}
          </div>` : nothing}

        ${fields.length === 0 && extracted ? html`
          <div class="apply-empty">
            No standard fields detected for this application — head to the next step.
          </div>` : nothing}

        ${fields.length ? html`
          <div class="apply-card">
            <div class="apply-card__head">
              <h2 class="apply-card__title">From your profile</h2>
              <p class="apply-card__hint">${this._prefillStats(fields)}</p>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
              ${fields.map(f => this._renderGeneralField(f))}
            </div>
          </div>
        ` : nothing}
      </section>
    `;
  }
  _prefillStats(fields) {
    const total = fields.length;
    let filled = 0;
    for (const f of fields) {
      const v = this._answerFor(f.id, this._profileValue(f.maps_to));
      if (v) filled++;
    }
    return `${filled}/${total} prefilled`;
  }
  _renderGeneralField(f) {
    const profileVal = this._profileValue(f.maps_to);
    const v = this._answerFor(f.id, profileVal);
    const isLong = f.type === 'textarea';
    return html`
      <div class="apply-field" style=${isLong ? 'grid-column:1/-1;' : ''}>
        <label class="apply-field__label">
          ${f.label}${f.required ? html`<span class="apply-field__required">*</span>` : nothing}
          ${v && v === profileVal ? html`<span class="apply-pill apply-pill--ok" style="font-size:10px;padding:1px 6px;">from profile</span>` : nothing}
        </label>
        ${isLong
          ? html`<textarea class="apply-textarea" .value=${v} @input=${(e) => this._setAnswer(f.id, e.target.value)}></textarea>`
          : html`<input class="apply-input" type=${f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : 'text'}
                        .value=${v}
                        @input=${(e) => this._setAnswer(f.id, e.target.value)} />`}
        ${f.maps_to ? html`<div class="apply-field__hint">maps to ${f.maps_to.replace(/_/g, ' ')}</div>` : nothing}
      </div>
    `;
  }

  // --- Resume -------------------------------------------------------------
  _renderResume() {
    const md   = this.resumeMd;
    const base = this.baseMd;
    const showDiff = this.showDiff && !!base;
    const rendered = renderMarkdown(showDiff ? diffMarkdown(base, md) : md || '');
    return html`
      <section class="apply-step">
        <div class="apply-step__head">
          <div class="apply-step__eyebrow">Step 2 · Resume</div>
          <h1 class="apply-step__title">Your tailored resume</h1>
          <p class="apply-step__sub">
            ${base
              ? html`Side-by-side with your base resume — each addition is <ins class="d-add">highlighted</ins>, each cut is <del class="d-del">struck through</del>. Toggle off to read the clean tailored version.`
              : html`No base resume yet — saving one on the Career page enables diff review here.`}
          </p>
        </div>

        <div class="apply-card">
          <div class="apply-card__head">
            <h2 class="apply-card__title">${this.role?.company || 'Company'} · ${this.role?.title || 'Role'}</h2>
            <div style="display:flex;gap:8px;align-items:center;">
              ${base ? html`
                <button class="apply-btn apply-btn--ghost apply-btn--sm"
                        @click=${() => this.showDiff = !this.showDiff}>
                  ${this.showDiff ? 'Hide changes' : 'Show changes'}
                </button>` : nothing}
              <button class="apply-btn apply-btn--ghost apply-btn--sm"
                      @click=${() => this._openInTab('resume')}>Edit in full editor ↗</button>
            </div>
          </div>
          ${this.resumeState === 'loading' ? html`<div class="apply-loading">Loading resume…</div>` : nothing}
          ${this.resumeState === 'ready' && !md ? html`
            <div class="apply-empty">
              No tailored resume yet for this role.
              <div style="margin-top:12px;">
                <button class="apply-btn apply-btn--dark apply-btn--sm" @click=${() => this._openInTab('resume')}>Generate one →</button>
              </div>
            </div>` : nothing}
          ${md ? html`<article class="apply-resume-body apply-prose">${unsafeHTML(rendered)}</article>` : nothing}
        </div>
      </section>
    `;
  }

  _openInTab(tab) {
    // Close the takeover and switch the role detail page to the given tab.
    this.close();
    try {
      const u = new URL(location.href);
      u.searchParams.set('tab', tab);
      history.replaceState(null, '', u.toString());
      // Fire a tabchange event the host component can listen for; fall
      // back to a hard reload if no handler picks it up.
      const ev = new CustomEvent('apply:opentab', { detail: { tab }, bubbles: true, composed: true });
      window.dispatchEvent(ev);
      // Defensive — if the host doesn't react in 50ms, reload.
      setTimeout(() => {
        const sp = new URLSearchParams(location.search);
        if (sp.get('tab') === tab && !document.querySelector(`.asset-tabs__tab.is-active`)?.textContent?.toLowerCase().includes(tab === 'resume' ? 'resume' : tab)) {
          location.reload();
        }
      }, 50);
    } catch { location.reload(); }
  }
  _renderCover() {
    const md = this.coverMd;
    const { html: marked, comments } = (md && (this.coverHi.highlights.length || this.coverHi.opportunities.length))
      ? applyAIHighlights(md, this.coverHi.highlights, this.coverHi.opportunities)
      : { html: md || '', comments: [] };
    const rendered = renderMarkdown(marked);
    return html`
      <section class="apply-step" style="max-width:1080px;">
        <div class="apply-step__head">
          <div class="apply-step__eyebrow">Step 3 · Cover letter</div>
          <h1 class="apply-step__title">Your tailored cover letter</h1>
          <p class="apply-step__sub">
            Highlights tie each load-bearing phrase back to a piece of the analysis. Click a phrase or a comment to see them paired.
          </p>
        </div>

        <div class="apply-card apply-cover-card">
          <div class="apply-card__head">
            <h2 class="apply-card__title">${this.role?.company || 'Company'} · ${this.role?.title || 'Role'}</h2>
            <div style="display:flex;gap:8px;align-items:center;">
              ${this.coverHi.loading ? html`<span class="apply-loading">Annotating…</span>` : nothing}
              <button class="apply-btn apply-btn--ghost apply-btn--sm"
                      @click=${() => this._openInTab('cover-letter')}>Edit in full editor ↗</button>
            </div>
          </div>

          ${this.coverState === 'loading' ? html`<div class="apply-loading">Loading cover letter…</div>` : nothing}
          ${this.coverState === 'ready' && !md ? html`
            <div class="apply-empty">
              No tailored cover letter yet for this role.
              <div style="margin-top:12px;">
                <button class="apply-btn apply-btn--dark apply-btn--sm" @click=${() => this._openInTab('cover-letter')}>Generate one →</button>
              </div>
            </div>` : nothing}

          ${md ? html`
            <div class="apply-cover-split">
              <article class="apply-cover-body apply-prose" @click=${(e) => this._onCoverPhraseClick(e)}>
                ${unsafeHTML(rendered)}
              </article>
              <aside class="apply-cover-rail">
                <header class="apply-cover-rail__head">
                  <h4>Annotations</h4>
                  <span class="apply-cover-rail__count">${comments.length}</span>
                </header>
                ${comments.length === 0
                  ? html`<p class="apply-cover-rail__empty">${this.coverHi.loading ? 'Working on it…' : 'No load-bearing phrases yet — regenerate the cover letter on the editor tab to refresh annotations.'}</p>`
                  : html`<div class="apply-cover-rail__list">
                      ${comments.map(c => html`
                        <article class="apply-cover-comment ${c.kind === 'opportunity' ? 'is-op' : ''}"
                                 data-rationale-id=${c.id}
                                 @click=${() => this._scrollToPhrase(c.id)}>
                          <header>
                            <span class="apply-cover-comment__num">${c.kind === 'opportunity' ? '✦' : c.id}</span>
                            <span class="apply-cover-comment__label">${c.label}</span>
                          </header>
                          <div class="apply-cover-comment__body">${unsafeHTML(renderMarkdown(c.text || ''))}</div>
                          ${c.ask ? html`<p class="apply-cover-comment__ask">${c.ask}</p>` : nothing}
                        </article>
                      `)}
                    </div>`}
              </aside>
            </div>
          ` : nothing}
        </div>
      </section>
    `;
  }
  _onCoverPhraseClick(ev) {
    const m = ev.target?.closest?.('[data-rationale-id]');
    if (!m) return;
    this._scrollToPhrase(m.getAttribute('data-rationale-id'));
  }
  _scrollToPhrase(id) {
    const root = this.renderRoot;
    const card = root?.querySelector(`.apply-cover-comment[data-rationale-id="${id}"]`);
    const mark = root?.querySelector(`.apply-cover-body [data-rationale-id="${id}"]`);
    if (card) {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.add('is-flash');
      setTimeout(() => card.classList.remove('is-flash'), 1200);
    }
    if (mark) mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // --- Custom questions ---------------------------------------------------
  _qAnswer(qid) {
    const a = this.draft?.answers?.[qid];
    return (a && typeof a === 'object') ? a : null;
  }
  async _generateQuestion(q) {
    this.qGen = { ...this.qGen, [q.id]: 'running' };
    this.qErr = { ...this.qErr, [q.id]: '' };
    try {
      const result = await generateQuestionAnswer(this.slug, q);
      // Preserve user edits if they already changed the draft.
      const existing = this._qAnswer(q.id);
      const draft = (existing?.user_edited_draft && existing?.user_edited_draft !== existing?.draft)
        ? existing.user_edited_draft
        : result.draft;
      const answer = {
        question_id: q.id,
        intent: result.intent,
        standout: result.standout,
        stories: result.stories,
        draft: result.draft,
        user_edited_draft: draft,
        highlights: result.highlights,
        opportunities: result.opportunities,
        generated_at: result.generated_at,
      };
      const answers = { ...(this.draft?.answers || {}), [q.id]: answer };
      this.draft = { ...this.draft, answers };
      await this._persist({ answers });
      this.qGen = { ...this.qGen, [q.id]: 'idle' };
    } catch (e) {
      this.qGen = { ...this.qGen, [q.id]: 'error' };
      this.qErr = { ...this.qErr, [q.id]: e.message || String(e) };
    }
  }
  _setQuestionDraft(qid, value) {
    const prev = this._qAnswer(qid) || {};
    const next = { ...prev, question_id: qid, user_edited_draft: value };
    const answers = { ...(this.draft?.answers || {}), [qid]: next };
    this.draft = { ...this.draft, answers };
    clearTimeout(this._answerTimers[qid]);
    this._answerTimers[qid] = setTimeout(() => this._persist({ answers }), 500);
  }

  _renderQuestions() {
    const qs = this.draft?.fields?.custom_questions || [];
    if (!qs.length) {
      return this._stepStub(
        'Step 4',
        'Custom questions',
        'For each question on the application, we generate a draft with sourced stories and annotated rationale.',
        html`<div class="apply-card"><p class="apply-card__hint">No custom questions detected for this application.</p></div>`,
      );
    }
    const idx = Math.max(0, Math.min(this.qIdx, qs.length - 1));
    const q = qs[idx];
    const ans = this._qAnswer(q.id);
    const gen = this.qGen[q.id] || 'idle';
    const err = this.qErr[q.id] || '';

    const draftMd = ans?.user_edited_draft ?? ans?.draft ?? '';
    const { html: marked, comments } = (draftMd && ans && (ans.highlights?.length || ans.opportunities?.length))
      ? applyAIHighlights(draftMd, ans.highlights || [], ans.opportunities || [])
      : { html: draftMd || '', comments: [] };
    const renderedDraft = renderMarkdown(marked);
    const charCount = (draftMd || '').length;
    const overMax = q.max_length && charCount > q.max_length;
    const completed = qs.filter(qq => {
      const a = this._qAnswer(qq.id);
      return !!(a?.user_edited_draft || a?.draft);
    }).length;

    return html`
      <section class="apply-step" style="max-width:1080px;">
        <div class="apply-step__head">
          <div class="apply-step__eyebrow">Step 4 · Custom question ${idx + 1} of ${qs.length}</div>
          <h1 class="apply-step__title">${q.prompt}</h1>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:4px;">
            <span class="apply-pill">${q.type}</span>
            ${q.required ? html`<span class="apply-pill apply-pill--warn">required</span>` : nothing}
            ${q.max_length ? html`<span class="apply-pill ${overMax ? 'apply-pill--warn' : ''}">${charCount}/${q.max_length} chars</span>` : nothing}
            <span class="apply-pill apply-pill--info">${completed}/${qs.length} drafted</span>
          </div>
        </div>

        <!-- Pager -->
        <nav class="apply-qpager">
          <button class="apply-btn apply-btn--ghost apply-btn--sm" ?disabled=${idx === 0} @click=${() => this.qIdx = idx - 1}>← Previous</button>
          <div class="apply-qpager__dots">
            ${qs.map((qq, i) => html`
              <button class="apply-qpager__dot ${i === idx ? 'is-active' : ''} ${this._qAnswer(qq.id) ? 'is-done' : ''}"
                      title=${qq.prompt}
                      @click=${() => this.qIdx = i}>${i + 1}</button>
            `)}
          </div>
          <button class="apply-btn apply-btn--ghost apply-btn--sm" ?disabled=${idx === qs.length - 1} @click=${() => this.qIdx = idx + 1}>Next →</button>
        </nav>

        <!-- Intent + standout + stories -->
        <div class="apply-qbrief">
          <div class="apply-qbrief__col">
            <div class="apply-qbrief__eyebrow">What they're really asking</div>
            <div class="apply-qbrief__body">
              ${ans?.intent ? html`<p>${ans.intent}</p>`
                : gen === 'running' ? html`<span class="apply-loading">Thinking…</span>`
                : html`<p class="apply-card__hint">Generate a draft to see the intent breakdown.</p>`}
            </div>
          </div>
          <div class="apply-qbrief__col">
            <div class="apply-qbrief__eyebrow">A standout answer</div>
            <div class="apply-qbrief__body">
              ${ans?.standout ? html`<p>${ans.standout}</p>`
                : gen === 'running' ? html`<span class="apply-loading">Thinking…</span>`
                : html`<p class="apply-card__hint">—</p>`}
            </div>
          </div>
          <div class="apply-qbrief__col">
            <div class="apply-qbrief__eyebrow">Story matches</div>
            <div class="apply-qbrief__body">
              ${ans?.stories?.length ? html`
                <ul class="apply-qbrief__stories">
                  ${ans.stories.map(s => html`
                    <li>
                      <div class="apply-qbrief__story-title">${s.title}</div>
                      <div class="apply-qbrief__story-why">${s.why}</div>
                    </li>`)}
                </ul>`
                : gen === 'running' ? html`<span class="apply-loading">Sourcing…</span>`
                : html`<p class="apply-card__hint">—</p>`}
            </div>
          </div>
        </div>

        <!-- Draft + annotations -->
        <div class="apply-card apply-cover-card">
          <div class="apply-card__head">
            <h2 class="apply-card__title">Draft answer</h2>
            <div style="display:flex;gap:8px;align-items:center;">
              ${err ? html`<span class="apply-pill apply-pill--warn" title=${err}>Generation error</span>` : nothing}
              <button class="apply-btn ${ans ? 'apply-btn--ghost' : 'apply-btn--primary'} apply-btn--sm"
                      ?disabled=${gen === 'running'}
                      @click=${() => this._generateQuestion(q)}>
                ${gen === 'running' ? 'Generating…' : ans ? 'Regenerate' : 'Generate draft'}
              </button>
            </div>
          </div>

          ${!ans && gen !== 'running' ? html`
            <div class="apply-empty">
              Click <strong>Generate draft</strong> to source stories from your profile and write an annotated first pass.
            </div>` : nothing}

          ${ans ? html`
            <div class="apply-cover-split">
              <div style="display:flex;flex-direction:column;gap:0;">
                <textarea class="apply-textarea apply-qdraft"
                          .value=${ans?.user_edited_draft ?? ans?.draft ?? ''}
                          @input=${(e) => this._setQuestionDraft(q.id, e.target.value)}></textarea>
                <details class="apply-qdraft__preview">
                  <summary>Preview with annotations</summary>
                  <article class="apply-prose apply-cover-body" style="border-right:0;max-height:40vh;"
                           @click=${(e) => this._onCoverPhraseClick(e)}>
                    ${unsafeHTML(renderedDraft)}
                  </article>
                </details>
              </div>
              <aside class="apply-cover-rail">
                <header class="apply-cover-rail__head">
                  <h4>Annotations</h4>
                  <span class="apply-cover-rail__count">${comments.length}</span>
                </header>
                ${comments.length === 0
                  ? html`<p class="apply-cover-rail__empty">No annotations on this draft yet — try regenerating after edits.</p>`
                  : html`<div class="apply-cover-rail__list">
                      ${comments.map(c => html`
                        <article class="apply-cover-comment ${c.kind === 'opportunity' ? 'is-op' : ''}"
                                 data-rationale-id=${c.id}
                                 @click=${() => this._scrollToPhrase(c.id)}>
                          <header>
                            <span class="apply-cover-comment__num">${c.kind === 'opportunity' ? '✦' : c.id}</span>
                            <span class="apply-cover-comment__label">${c.label}</span>
                          </header>
                          <div class="apply-cover-comment__body">${unsafeHTML(renderMarkdown(c.text || ''))}</div>
                          ${c.ask ? html`<p class="apply-cover-comment__ask">${c.ask}</p>` : nothing}
                        </article>`)}
                    </div>`}
              </aside>
            </div>
          ` : nothing}
        </div>
      </section>
    `;
  }
  // --- Review + submit ----------------------------------------------------
  _buildPayload() {
    // Self-contained payload that an autofill companion (browser
    // extension / userscript) can read out of localStorage or
    // window.name. Mirrors application_draft.fields/.answers but in a
    // friendlier per-field shape with the resolved values.
    const f = this.draft?.fields || {};
    const general = (f.general || []).map(field => ({
      id: field.id,
      label: field.label,
      maps_to: field.maps_to || null,
      type: field.type,
      required: !!field.required,
      value: this._answerFor(field.id, this._profileValue(field.maps_to)),
    }));
    const questions = (f.custom_questions || []).map(q => {
      const a = this._qAnswer(q.id);
      return {
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        required: !!q.required,
        options: q.options || null,
        max_length: q.max_length || null,
        answer: a?.user_edited_draft ?? a?.draft ?? '',
      };
    });
    return {
      role: {
        slug: this.slug,
        company: this.role?.company || '',
        title:   this.role?.title   || '',
        url:     this.role?.url     || this.draft?.apply_url || '',
      },
      ats: this.draft?.ats || f.ats || null,
      requires: f.requires || { resume: true, cover_letter: false },
      general,
      questions,
      resume_md: this.resumeMd || '',
      cover_letter_md: this.coverMd || '',
      generated_at: new Date().toISOString(),
      schema_version: 1,
    };
  }

  async _copyPayload() {
    const json = JSON.stringify(this._buildPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this._toast('Copied — paste into your notes or pass it to an autofill companion');
    } catch (e) {
      console.warn('[job-apply] clipboard fail', e);
      this._toast('Copy failed — see console for the payload', 'warn');
      console.log('[job-apply] payload:', json);
    }
  }

  _openWithHandoff() {
    const payload = this._buildPayload();
    const url = payload.role.url;
    if (!url) { this._toast('No posting URL on this role.', 'warn'); return; }
    try {
      const key = `job:apply:payload:${this.slug}`;
      localStorage.setItem(key, JSON.stringify({ ...payload, key, written_at: Date.now() }));
      localStorage.setItem('job:apply:lastPayloadKey', key);
    } catch (e) {
      console.warn('[job-apply] localStorage write failed', e);
    }
    // Open in a new tab. We can't reliably reach into the new tab from
    // here, but a paired Chrome extension reads job:apply:payload:* from
    // the active tab on navigation. This is the public handshake.
    const w = window.open(url, '_blank', 'noopener');
    if (!w) this._toast('Popup blocked — allow popups for this site, then retry.', 'warn');
  }

  async _markSubmitted() {
    if (!confirm('Mark this application as submitted? You can still edit the draft afterwards.')) return;
    try {
      await this._persist({ status: 'submitted', submitted_at: new Date().toISOString() });
      this._toast('Marked as submitted.');
    } catch (e) {
      this._toast(`Couldn't mark as submitted: ${e.message}`, 'warn');
    }
  }

  _toast(msg, kind = 'ok') {
    const el = document.createElement('div');
    el.className = `apply-toast apply-toast--${kind}`;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-on'));
    setTimeout(() => {
      el.classList.remove('is-on');
      setTimeout(() => el.remove(), 220);
    }, 2600);
  }

  _renderReview() {
    const payload = this._buildPayload();
    const submitted = this.draft?.status === 'submitted';
    const reqCover = payload.requires?.cover_letter;
    const qs = payload.questions;
    const totalQ = qs.length;
    const draftedQ = qs.filter(q => q.answer && q.answer.trim()).length;
    const missing = [];
    for (const g of payload.general) if (g.required && !g.value) missing.push(g.label);
    if (payload.requires?.resume && !payload.resume_md) missing.push('Tailored resume');
    if (reqCover && !payload.cover_letter_md) missing.push('Cover letter');
    for (const q of qs) if (q.required && !q.answer) missing.push(`Question: ${q.prompt.slice(0, 60)}`);

    return html`
      <section class="apply-step" style="max-width:880px;">
        <div class="apply-step__head">
          <div class="apply-step__eyebrow">Final · Review</div>
          <h1 class="apply-step__title">Ready to apply${submitted ? ' (submitted)' : ''}</h1>
          <p class="apply-step__sub">
            Open the posting in a new tab — we've stashed your answers so a paired autofill companion can drop them in. Don't have one yet? Copy the payload or grab values per field.
          </p>
        </div>

        ${missing.length ? html`
          <div class="apply-card" style="border-color: var(--apply-warning); background: #fff8ec;">
            <h2 class="apply-card__title" style="color: var(--apply-warning);">${missing.length} item${missing.length === 1 ? '' : 's'} still missing</h2>
            <ul style="margin:0;padding-left:18px;font-size:14px;">
              ${missing.map(m => html`<li>${m}</li>`)}
            </ul>
          </div>` : html`
          <div class="apply-card" style="border-color: var(--apply-accent-soft); background: #f2fbeb;">
            <h2 class="apply-card__title" style="color: var(--apply-success);">Everything required is filled in ✓</h2>
            <p class="apply-card__hint" style="margin:0;">
              ${totalQ ? `${draftedQ}/${totalQ} custom questions answered. ` : ''}Resume ${payload.resume_md ? '✓' : '—'}${reqCover ? ` · Cover letter ${payload.cover_letter_md ? '✓' : '—'}` : ''}.
            </p>
          </div>`}

        <div class="apply-card">
          <div class="apply-card__head">
            <h2 class="apply-card__title">General info</h2>
            <span class="apply-pill">${payload.general.length} field${payload.general.length === 1 ? '' : 's'}</span>
          </div>
          ${payload.general.length === 0
            ? html`<p class="apply-card__hint">No general fields detected.</p>`
            : html`<dl class="apply-review-dl">
                ${payload.general.map(g => html`
                  <div>
                    <dt>${g.label}${g.required && !g.value ? html`<span class="apply-field__required"> *</span>` : nothing}</dt>
                    <dd>${g.value || html`<span class="apply-card__hint">—</span>`}</dd>
                  </div>`)}
              </dl>`}
        </div>

        <div class="apply-card">
          <div class="apply-card__head">
            <h2 class="apply-card__title">Resume & cover letter</h2>
            <div style="display:flex;gap:6px;">
              <span class="apply-pill ${payload.resume_md ? 'apply-pill--ok' : 'apply-pill--warn'}">Resume ${payload.resume_md ? '✓' : 'missing'}</span>
              ${reqCover ? html`<span class="apply-pill ${payload.cover_letter_md ? 'apply-pill--ok' : 'apply-pill--warn'}">Cover ${payload.cover_letter_md ? '✓' : 'missing'}</span>` : nothing}
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="apply-btn apply-btn--ghost apply-btn--sm" @click=${() => this._openInTab('resume')}>Edit resume ↗</button>
            ${reqCover ? html`<button class="apply-btn apply-btn--ghost apply-btn--sm" @click=${() => this._openInTab('cover-letter')}>Edit cover letter ↗</button>` : nothing}
          </div>
        </div>

        ${qs.length ? html`
          <div class="apply-card">
            <div class="apply-card__head">
              <h2 class="apply-card__title">Custom questions</h2>
              <span class="apply-pill ${draftedQ === totalQ ? 'apply-pill--ok' : ''}">${draftedQ}/${totalQ} drafted</span>
            </div>
            <ol class="apply-review-qlist">
              ${qs.map((q, i) => html`
                <li>
                  <div class="apply-review-qlist__head">
                    <button class="apply-review-qlist__num" @click=${() => { this.qIdx = i; this._go('questions'); }}>${i + 1}</button>
                    <span class="apply-review-qlist__prompt">${q.prompt}</span>
                    ${q.required ? html`<span class="apply-pill apply-pill--warn">required</span>` : nothing}
                  </div>
                  ${q.answer
                    ? html`<p class="apply-review-qlist__answer">${q.answer.length > 320 ? q.answer.slice(0, 320) + '…' : q.answer}</p>`
                    : html`<p class="apply-card__hint">— not drafted yet</p>`}
                </li>`)}
            </ol>
          </div>` : nothing}

        <div class="apply-card">
          <div class="apply-card__head">
            <h2 class="apply-card__title">Submit</h2>
            <span class="apply-card__hint">Auto-submit requires a paired browser companion — see notes</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="apply-btn apply-btn--primary" @click=${() => this._openWithHandoff()} ?disabled=${!payload.role.url}>
              Open posting & hand off ↗
            </button>
            <button class="apply-btn apply-btn--ghost" @click=${() => this._copyPayload()}>Copy answers (JSON)</button>
            <button class="apply-btn apply-btn--dark" @click=${() => this._markSubmitted()} ?disabled=${submitted}>
              ${submitted ? 'Marked as submitted ✓' : 'Mark as submitted'}
            </button>
          </div>
          <details class="apply-card__hint" style="margin:0;">
            <summary style="cursor:pointer;">How the autofill handoff works</summary>
            <div style="margin-top:8px;font-size:13px;color:var(--apply-ink-muted);line-height:1.5;">
              Clicking <strong>Open posting & hand off</strong> stashes your payload at <code>localStorage["job:apply:payload:${this.slug}"]</code> and opens the application in a new tab. A future browser extension (or userscript) reads that key on page load and autofills the form. Until then, use <strong>Copy answers</strong> and paste field-by-field.
            </div>
          </details>
        </div>
      </section>
    `;
  }

  _renderActions() {
    const steps = this._steps();
    const i = this._stepIndex();
    const atStart = i <= 0;
    const atEnd   = i >= steps.length - 1;
    const submitted = this.draft?.status === 'submitted';
    return html`
      <div class="apply-actions">
        <div class="apply-actions__status">
          ${this.saving ? html`<span class="apply-loading">Saving…</span>` : html`<span>Draft saved · ${this._dirtyTag()}</span>`}
          ${submitted ? html`<span class="apply-pill apply-pill--ok" style="margin-left:8px;">Submitted</span>` : nothing}
        </div>
        <div class="apply-actions__group">
          <button class="apply-btn apply-btn--ghost" ?disabled=${atStart} @click=${() => this._prev()}>← Back</button>
          ${atEnd
            ? html`<button class="apply-btn apply-btn--primary" @click=${() => this._openWithHandoff()} ?disabled=${!(this.role?.url || this.draft?.apply_url)}>
                Open posting & hand off ↗
              </button>`
            : html`<button class="apply-btn apply-btn--dark" @click=${() => this._next()}>Continue →</button>`}
        </div>
      </div>
    `;
  }
  _dirtyTag() {
    const ts = this.draft?.updated_at;
    if (!ts) return 'new draft';
    try { return `updated ${new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; }
    catch { return 'saved'; }
  }
}

customElements.define('job-apply', JobApply);
