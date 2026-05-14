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
const VERSION = '0.2.0';
console.log(`[job-apply] v${VERSION} - + field extraction (PR2)`);

import { LitElement, html, nothing } from 'https://esm.run/lit@3';

const V = (new URL(import.meta.url)).search;
const [{ readApplicationDraft, upsertApplicationDraft, extractApplicationFields, STEPS, visibleSteps }] = await Promise.all([
  import('../apply.js' + V),
]);

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

  _renderGeneral() {
    return this._stepStub(
      'Step 1',
      'General information',
      'We\'ll use what you already have. Skim and confirm — anything we don\'t know, you can fill in below.',
      html`<div class="apply-card"><p class="apply-card__hint">General-info form arrives in the next PR — this step pulls name, email, location, work auth, and links from your /job profile and lets you confirm or override per application.</p></div>`,
    );
  }
  _renderResume() {
    return this._stepStub(
      'Step 2',
      'Resume',
      'Tailored for this role, side-by-side with your base resume so you can see every change.',
      html`<div class="apply-card"><p class="apply-card__hint">Resume review tools land in the next PR — same diff/highlight system as the Resume tab on the role page, embedded directly here.</p></div>`,
    );
  }
  _renderCover() {
    return this._stepStub(
      'Step 3',
      'Cover letter',
      'Drafted, annotated with rationale, with one-click edits per highlight.',
      html`<div class="apply-card"><p class="apply-card__hint">Cover-letter step arrives in PR4 — reuses the existing annotation UI (load-bearing phrases + opportunities) from the role page.</p></div>`,
    );
  }
  _renderQuestions() {
    const qs = this.draft?.fields?.custom_questions || [];
    return this._stepStub(
      'Step 4',
      `Custom questions${qs.length ? ` · ${qs.length}` : ''}`,
      'For each question on the application, we generate a draft with sourced stories and annotated rationale.',
      qs.length
        ? html`
            <ol class="apply-card" style="margin:0;padding:24px 24px 24px 44px;display:block;">
              ${qs.map(q => html`
                <li style="margin-bottom:14px;">
                  <div style="font-weight:600;">${q.prompt}</div>
                  <div style="font-size:12px;color:var(--apply-ink-subtle);">
                    ${q.type}${q.required ? ' · required' : ''}${q.options?.length ? ` · ${q.options.length} options` : ''}
                  </div>
                </li>
              `)}
            </ol>
            <p class="apply-card__hint" style="margin:0;">PR5 wraps each of these in its own page with AI intent + annotated draft answers.</p>`
        : html`<div class="apply-card"><p class="apply-card__hint">No custom questions detected yet — extraction either hasn't run or this ATS has none.</p></div>`,
    );
  }
  _renderReview() {
    return this._stepStub(
      'Final',
      'Review and submit',
      'One last pass. Submit goes through our autofill agent (handoff coming in PR6).',
      html`<div class="apply-card"><p class="apply-card__hint">Review + auto-submit handoff arrives in PR6.</p></div>`,
    );
  }

  _renderActions() {
    const steps = this._steps();
    const i = this._stepIndex();
    const atStart = i <= 0;
    const atEnd   = i >= steps.length - 1;
    return html`
      <div class="apply-actions">
        <div class="apply-actions__status">
          ${this.saving ? html`<span class="apply-loading">Saving…</span>` : html`<span>Draft saved · ${this._dirtyTag()}</span>`}
        </div>
        <div class="apply-actions__group">
          <button class="apply-btn apply-btn--ghost" ?disabled=${atStart} @click=${() => this._prev()}>← Back</button>
          ${atEnd
            ? html`<button class="apply-btn apply-btn--primary" disabled title="Submit lands in PR6">Submit application</button>`
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
