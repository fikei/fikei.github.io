// ladder-apply-review — Easy Apply review-then-submit takeover (Phase 16.2c).
//
// launch(slug) → calls submit-application `prepare`, which maps the role's
// form onto the answer bank and returns itemized rows. The user sees exactly
// what will be sent, fills any gaps, ticks every legal/consent box by hand,
// and taps Submit. Submit routes through the server transport when the
// SUBMIT_ENABLED flag is on (Greenhouse in v1); otherwise — and whenever the
// board enforces a CAPTCHA or rejects the POST — it returns
// `assisted_required` and we show the assisted-apply panel: a deep link plus
// every prepared answer laid out to copy into the real form. Nothing is ever
// submitted without the explicit Submit tap, and there is no undo after.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const { prepareApplication, submitApplication } = await import('../apply.js' + V);

export class LadderApplyReview extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    open:      { state: true },
    phase:     { state: true },   // 'loading' | 'review' | 'assisted' | 'done' | 'error'
    review:    { state: true },   // prepare payload
    consents:  { state: true },   // Set of ticked consent ids
    overrides: { state: true },   // { rowId: value }
    submitting:{ state: true },
    error:     { state: true },
    assisted:  { state: true },   // { reason } when server hands off
  };

  constructor() {
    super();
    this.open = false;
    this.phase = 'loading';
    this.review = null;
    this.consents = new Set();
    this.overrides = {};
    this.submitting = false;
    this.error = '';
    this.assisted = null;
  }

  async launch({ slug } = {}) {
    if (!slug) return;
    this.slug = slug;
    this.open = true;
    this.phase = 'loading';
    this.review = null;
    this.consents = new Set();
    this.overrides = {};
    this.assisted = null;
    this.error = '';
    document.body.style.overflow = 'hidden';
    try {
      this.review = await prepareApplication(slug);
      this.phase = 'review';
    } catch (e) {
      this.error = e.message;
      this.phase = 'error';
    }
  }

  _close() {
    this.open = false;
    document.body.style.overflow = '';
  }

  _setOverride(id, value) { this.overrides = { ...this.overrides, [id]: value }; }
  _toggleConsent(id) {
    const next = new Set(this.consents);
    next.has(id) ? next.delete(id) : next.add(id);
    this.consents = next;
  }

  _answerText(row) {
    const v = this.overrides[row.id] !== undefined ? this.overrides[row.id] : row.answer;
    if (v === true) return 'Yes';
    if (v === false) return 'No';
    return v ?? '';
  }

  async _submit() {
    // Client guard mirrors the server: every consent ticked, no missing rows.
    const consentRows = (this.review.rows || []).filter(r => r.kind === 'consent');
    const unticked = consentRows.filter(r => !this.consents.has(r.id));
    if (unticked.length) { this.error = 'Tick every acknowledgement box to continue.'; return; }
    const stillMissing = (this.review.rows || []).filter(r => r.kind === 'missing'
      && !(this.overrides[r.id] && String(this.overrides[r.id]).trim()));
    if (stillMissing.length) { this.error = `Fill the ${stillMissing.length} missing answer${stillMissing.length === 1 ? '' : 's'} first.`; return; }

    this.submitting = true;
    this.error = '';
    try {
      const res = await submitApplication(this.slug, { consents: [...this.consents], overrides: this.overrides });
      switch (res.status) {
        case 'submitted':
          this.phase = 'done';
          document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: `Applied to ${this.review.role.company} — moved to Applied.` } }));
          document.dispatchEvent(new CustomEvent('job:pipeline:refresh'));
          break;
        case 'assisted_required':
          this.assisted = { reason: res.reason };
          this.phase = 'assisted';
          break;
        case 'consent_required':
          this.error = 'The application needs every acknowledgement ticked.';
          break;
        case 'incomplete':
          this.error = `Still missing: ${(res.missing || []).join('; ')}`;
          break;
        case 'capped':
          this.error = res.reason || 'Daily submission cap reached.';
          break;
        default:
          this.error = `Unexpected response: ${res.status}`;
      }
    } catch (e) {
      this.error = e.message;
    } finally {
      this.submitting = false;
    }
  }

  _copyAll() {
    const lines = (this.review.rows || [])
      .filter(r => r.kind !== 'consent')
      .map(r => `${r.prompt}\n${this._answerText(r) || '—'}`);
    const text = lines.join('\n\n');
    navigator.clipboard?.writeText(text).then(
      () => document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: 'Answers copied — paste them into the form.' } })),
      () => { this.error = 'Copy failed — select the text manually.'; },
    );
  }

  // ---- render ----
  _renderRow(r) {
    if (r.kind === 'consent') {
      return html`
        <label class="ar-row ar-row--consent">
          <input type="checkbox" .checked=${this.consents.has(r.id)} @change=${() => this._toggleConsent(r.id)}>
          <span class="ar-consent-text">${r.prompt}</span>
        </label>`;
    }
    if (r.kind === 'missing') {
      return html`
        <div class="ar-row ar-row--missing">
          <div class="ar-prompt">${r.prompt} <em>needs an answer</em></div>
          <input type="text" placeholder="Type your answer"
                 .value=${this.overrides[r.id] ?? ''}
                 @input=${(e) => this._setOverride(r.id, e.target.value)}>
        </div>`;
    }
    return html`
      <div class="ar-row">
        <div class="ar-prompt">${r.prompt}</div>
        <div class="ar-answer">
          <span>${this._answerText(r) || html`<em class="muted">— blank —</em>`}</span>
          <button class="ar-edit" title="Edit for this application"
                  @click=${() => this._setOverride(r.id, this._answerText(r))}>edit</button>
        </div>
        ${this.overrides[r.id] !== undefined ? html`
          <input type="text" class="ar-override" .value=${this.overrides[r.id]}
                 @input=${(e) => this._setOverride(r.id, e.target.value)}>` : nothing}
      </div>`;
  }

  _renderReview() {
    const rows = this.review.rows || [];
    const fields = rows.filter(r => r.kind === 'field');
    const missing = rows.filter(r => r.kind === 'missing');
    const consents = rows.filter(r => r.kind === 'consent');
    return html`
      <div class="ar-body">
        <p class="ar-lead">
          Review everything before it's sent to <strong>${this.review.role.company}</strong>.
          This is submitted as-is — there's no undo once it's in.
        </p>
        ${this.review.resume_available
          ? html`<div class="ar-resume">📄 Resume attached — your ${this.review.role.apply_ease === 'easy' ? 'saved' : 'tailored'} resume.</div>`
          : html`<div class="ar-resume ar-resume--warn">No resume on file — add one before submitting.</div>`}

        ${missing.length ? html`
          <div class="ar-group">
            <h3 class="ar-group__title ar-group__title--warn">${missing.length} answer${missing.length === 1 ? '' : 's'} still needed</h3>
            ${missing.length >= 3 ? html`
              <p class="ar-setup-hint">
                Set up Easy Apply once and these autofill from your saved answers next time.
                <button class="btn btn--sm" @click=${() => document.dispatchEvent(new CustomEvent('job:easyapply:launch-setup'))}>⚡ Set up Easy Apply</button>
              </p>` : nothing}
            ${missing.map(r => this._renderRow(r))}
          </div>` : nothing}

        <div class="ar-group">
          <h3 class="ar-group__title">Answers (${fields.length})</h3>
          ${fields.map(r => this._renderRow(r))}
        </div>

        ${consents.length ? html`
          <div class="ar-group">
            <h3 class="ar-group__title">Acknowledgements — tick each yourself</h3>
            ${consents.map(r => this._renderRow(r))}
          </div>` : nothing}
      </div>
      ${this.error ? html`<p class="ar-error">${this.error}</p>` : nothing}
      <footer class="ar-foot">
        <button class="btn btn--sm" @click=${() => this._copyAll()}>Copy answers</button>
        <button class="btn btn--accent" ?disabled=${this.submitting} @click=${() => this._submit()}>
          ${this.submitting ? 'Submitting…' : 'Submit application'}
        </button>
      </footer>`;
  }

  _renderAssisted() {
    return html`
      <div class="ar-body">
        <p class="ar-lead">
          This one finishes on the company's site — ${this.assisted?.reason || 'it needs a step only you can complete'}.
          Everything's prepared: open the form, paste your answers, and submit there.
        </p>
        <div class="ar-assist-actions">
          <a class="btn btn--accent" href=${this.review.role.apply_url} target="_blank" rel="noopener noreferrer">Open the application ↗</a>
          <button class="btn btn--sm" @click=${() => this._copyAll()}>Copy all answers</button>
        </div>
        <div class="ar-group">
          <h3 class="ar-group__title">Your prepared answers</h3>
          ${(this.review.rows || []).filter(r => r.kind !== 'consent').map(r => html`
            <div class="ar-row ar-row--static">
              <div class="ar-prompt">${r.prompt}</div>
              <div class="ar-answer"><span>${this._answerText(r) || html`<em class="muted">— blank —</em>`}</span></div>
            </div>`)}
        </div>
        <p class="ar-note">Legal acknowledgements aren't pre-ticked — read and accept those on the company's form yourself.</p>
      </div>
      <footer class="ar-foot">
        <button class="btn btn--sm" @click=${() => this._close()}>Done</button>
      </footer>`;
  }

  _renderDone() {
    return html`
      <div class="ar-body ar-body--center">
        <div class="ar-done-mark">✓</div>
        <h3>Application sent</h3>
        <p class="muted">${this.review.role.title} at ${this.review.role.company} moved to Applied. We'll track the reply for you.</p>
      </div>
      <footer class="ar-foot"><button class="btn btn--accent" @click=${() => this._close()}>Done</button></footer>`;
  }

  render() {
    if (!this.open) return nothing;
    return html`
      <div class="ar-overlay" @click=${(e) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="ar" role="dialog" aria-modal="true" aria-label="Review and submit application">
          <header class="ar-head">
            <div>
              <h2>${this.phase === 'assisted' ? 'Finish on the company site' : this.phase === 'done' ? 'Done' : 'Review & submit'}</h2>
              ${this.review?.role ? html`<span class="muted">${this.review.role.title} · ${this.review.role.company}</span>` : nothing}
            </div>
            <button class="ar-close" aria-label="Close" @click=${() => this._close()}>×</button>
          </header>
          ${this.phase === 'loading' ? html`<div class="ar-body"><p class="ar-lead">Assembling your application…</p></div>` : nothing}
          ${this.phase === 'error' ? html`<div class="ar-body"><p class="ar-error">${this.error}</p></div>
            <footer class="ar-foot"><button class="btn btn--sm" @click=${() => this._close()}>Close</button></footer>` : nothing}
          ${this.phase === 'review' ? this._renderReview() : nothing}
          ${this.phase === 'assisted' ? this._renderAssisted() : nothing}
          ${this.phase === 'done' ? this._renderDone() : nothing}
        </div>
      </div>`;
  }
}

customElements.define('ladder-apply-review', LadderApplyReview);
