// ladder-easy-apply-setup — feature-level onboarding for Easy Apply (16.2b).
//
// A 4-step takeover launched from a role's "Set up Easy Apply" CTA or from
// Settings. Prefill-first: step 1 renders what seeding already derived as
// confirm-cards, not blank inputs. Steps:
//   1 confirm — Tier 1 (contact, work auth, links), seeded from data on record
//   2 details — Tier 2 (onsite metros + days, comp, start date, how-heard)
//   3 privacy — Tier 3 EEOC consent card (default: decline everywhere)
//   4 policies — cover letter / daily cap; review-always is stated, not asked
// A resume-upload branch appears on step 1 when seeding found little.
//
// Every save goes through application-answers upsert with source
// 'onboarding'; completion sets localStorage job:easyApplySetupDone and
// fires 'job:easyapply:setup-done'.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const { answersList, answersUpsert, answersSeed, answersFromResume } = await import('../apply.js' + V);
const { readFileAsText } = await import('../pdf-extract.js' + V);

export const SETUP_DONE_KEY = 'job:easyApplySetupDone';
export function easyApplySetupDone() {
  try { return localStorage.getItem(SETUP_DONE_KEY) === '1'; } catch { return false; }
}

// Step-1 confirm fields (Tier 1) in display order.
const TIER1 = [
  { key: 'legal_name',    label: 'Legal name',          placeholder: 'As on your ID' },
  { key: 'preferred_name',label: 'Preferred name',      placeholder: 'Optional' },
  { key: 'email',         label: 'Email',               placeholder: 'you@example.com' },
  { key: 'phone',         label: 'Phone',               placeholder: '+1 …' },
  { key: 'location',      label: 'Current location',    placeholder: 'City, State' },
  { key: 'linkedin_url',  label: 'LinkedIn',            placeholder: 'https://linkedin.com/in/…' },
  { key: 'portfolio_url', label: 'Portfolio / website', placeholder: 'Optional' },
];

const EEOC_FIELDS = [
  { key: 'eeoc_gender',      label: 'Gender' },
  { key: 'eeoc_race',        label: 'Race / ethnicity' },
  { key: 'eeoc_veteran',     label: 'Veteran status' },
  { key: 'eeoc_disability',  label: 'Disability status' },
];

export class LadderEasyApplySetup extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    open:     { state: true },
    step:     { state: true },   // 1..4
    loading:  { state: true },
    saving:   { state: true },
    error:    { state: true },
    values:   { state: true },   // {key: value} working copy
    seeded:   { state: true },   // keys that came from seeding (confirm styling)
    eeocMode: { state: true },   // 'decline' | 'provide'
    resumeBusy: { state: true },
  };

  constructor() {
    super();
    this.open = false;
    this.step = 1;
    this.loading = false;
    this.saving = false;
    this.error = '';
    this.values = {};
    this.seeded = new Set();
    this.eeocMode = 'decline';
    this.resumeBusy = false;
  }

  async launch() {
    this.open = true;
    this.step = 1;
    this.error = '';
    this.loading = true;
    document.body.style.overflow = 'hidden';
    try {
      // Prefill-first: seed from data on record, then load the whole bank.
      const res = await answersSeed();
      const answers = res.answers || {};
      const values = {};
      for (const [k, v] of Object.entries(answers)) values[k] = v.value;
      this.values = values;
      this.seeded = new Set(Object.entries(answers)
        .filter(([, v]) => v.source === 'derived' || v.source === 'resume_extract')
        .map(([k]) => k));
      if (values.eeoc_gender || values.eeoc_race) this.eeocMode = 'provide';
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  _close() {
    this.open = false;
    document.body.style.overflow = '';
  }

  _set(key, value) {
    this.values = { ...this.values, [key]: value };
  }

  async _saveStep(keys, { finish = false } = {}) {
    this.saving = true;
    this.error = '';
    try {
      const answers = keys
        .filter(k => this.values[k] !== undefined && this.values[k] !== '')
        .map(k => ({ key: k, value: this.values[k], source: 'onboarding' }));
      if (answers.length) await answersUpsert(answers);
      if (finish) {
        try { localStorage.setItem(SETUP_DONE_KEY, '1'); } catch { /* */ }
        document.dispatchEvent(new CustomEvent('job:easyapply:setup-done'));
        document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: 'Easy Apply is set up — easy-tier roles can now prefill end to end.' } }));
        this._close();
      } else {
        this.step += 1;
      }
    } catch (e) {
      this.error = e.message;
    } finally {
      this.saving = false;
    }
  }

  async _onResumeUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    this.resumeBusy = true;
    this.error = '';
    try {
      const text = await readFileAsText(file);
      const res = await answersFromResume(text);
      const values = { ...this.values };
      for (const [k, v] of Object.entries(res.answers || {})) {
        if (values[k] === undefined) values[k] = v.value;
      }
      // Resume-extracted values override still-empty fields for confirmation.
      for (const [k, v] of Object.entries(res.seeded || {})) values[k] = v;
      this.values = values;
      this.seeded = new Set([...this.seeded, ...Object.keys(res.seeded || {})]);
    } catch (err) {
      this.error = `Resume read failed: ${err.message}`;
    } finally {
      this.resumeBusy = false;
      e.target.value = '';
    }
  }

  _input(key, placeholder = '') {
    const seeded = this.seeded.has(key) && this.values[key];
    return html`
      <input type="text" .value=${this.values[key] ?? ''} placeholder=${placeholder}
             class=${seeded ? 'is-prefilled' : ''}
             @input=${(e) => this._set(key, e.target.value)}>
    `;
  }

  // ---- steps ----
  _renderStep1() {
    const filled = TIER1.filter(f => this.values[f.key]).length;
    return html`
      <p class="eas__lead">
        ${filled >= 4
          ? html`Here's what I already know from your profile and career history — confirm or fix, don't retype.`
          : html`I found less on record than I'd like. Fill these in — or upload a resume and I'll pull most of it.`}
      </p>
      ${filled < 4 ? html`
        <label class="eas__resume-drop">
          ${this.resumeBusy ? 'Reading resume…' : '⇧ Upload a resume to prefill (PDF or text)'}
          <input type="file" accept=".pdf,.md,.txt" hidden ?disabled=${this.resumeBusy}
                 @change=${(e) => this._onResumeUpload(e)}>
        </label>
      ` : nothing}
      <div class="eas__grid">
        ${TIER1.map(f => html`
          <label class="eas__field">
            <span>${f.label}${this.seeded.has(f.key) && this.values[f.key] ? html` <em class="eas__seeded">found</em>` : nothing}</span>
            ${this._input(f.key, f.placeholder)}
          </label>
        `)}
        <label class="eas__field">
          <span>Authorized to work in the US?</span>
          ${this._yesNo('work_auth')}
        </label>
        <label class="eas__field">
          <span>Will you ever need visa sponsorship?</span>
          ${this._yesNo('sponsorship')}
        </label>
      </div>
    `;
  }

  _yesNo(key) {
    const v = this.values[key];
    return html`
      <div class="eas__yn">
        <button class="btn btn--sm ${v === true ? 'btn--accent' : ''}"  @click=${() => this._set(key, true)}>Yes</button>
        <button class="btn btn--sm ${v === false ? 'btn--accent' : ''}" @click=${() => this._set(key, false)}>No</button>
      </div>
    `;
  }

  _renderStep2() {
    const onsite = this.values.onsite_willingness || {};
    const comp = this.values.comp_expectation || {};
    return html`
      <p class="eas__lead">Forms constantly gate on logistics — answer once, reuse everywhere.</p>
      <div class="eas__grid">
        <label class="eas__field eas__field--wide">
          <span>Metros you can work from (comma-separated)</span>
          <input type="text" .value=${(onsite.metros || []).join(', ')}
                 placeholder="San Francisco, New York"
                 @input=${(e) => this._set('onsite_willingness', { ...onsite, metros: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}>
        </label>
        <label class="eas__field">
          <span>Max days/week in office</span>
          <input type="number" min="0" max="5" .value=${onsite.max_days_per_week ?? ''}
                 @input=${(e) => this._set('onsite_willingness', { ...onsite, max_days_per_week: e.target.value === '' ? null : Number(e.target.value) })}>
        </label>
        <label class="eas__field">
          <span>Base salary expectation (USD)</span>
          <input type="number" .value=${comp.base_floor ?? ''}
                 @input=${(e) => this._set('comp_expectation', { ...comp, base_floor: e.target.value === '' ? null : Number(e.target.value) })}>
        </label>
        <label class="eas__field">
          <span>How to phrase it</span>
          <select @change=${(e) => this._set('comp_expectation', { ...comp, policy: e.target.value })}>
            ${['floor', 'range', 'flexible'].map(p => html`<option value=${p} ?selected=${(comp.policy || 'floor') === p}>${p === 'floor' ? 'At least my number' : p === 'range' ? 'Give a range' : '“Flexible / market”'}</option>`)}
          </select>
        </label>
        <label class="eas__field">
          <span>When can you start?</span>
          ${this._input('start_date', 'e.g. 2 weeks after offer')}
        </label>
        <label class="eas__field">
          <span>"How did you hear about us" default</span>
          ${this._input('hear_about', 'LinkedIn')}
        </label>
        <label class="eas__field">
          <span>Years of product experience</span>
          <input type="number" min="0" .value=${this.values.years_experience_pm ?? ''}
                 @input=${(e) => this._set('years_experience_pm', e.target.value === '' ? null : Number(e.target.value))}>
        </label>
      </div>
    `;
  }

  _renderStep3() {
    return html`
      <p class="eas__lead">
        Most US applications end with a voluntary demographic survey (EEOC).
        I only ever answer these from what you choose here — never inferred.
      </p>
      <div class="eas__eeoc-choice">
        <label class="eas__radio">
          <input type="radio" name="eeoc" ?checked=${this.eeocMode === 'decline'}
                 @change=${() => { this.eeocMode = 'decline'; }}>
          <span><strong>Decline everywhere</strong> — answer every survey "decline to self-identify" (default)</span>
        </label>
        <label class="eas__radio">
          <input type="radio" name="eeoc" ?checked=${this.eeocMode === 'provide'}
                 @change=${() => { this.eeocMode = 'provide'; }}>
          <span><strong>Use my answers</strong> — save specific responses and use them on every survey</span>
        </label>
      </div>
      ${this.eeocMode === 'provide' ? html`
        <div class="eas__grid">
          ${EEOC_FIELDS.map(f => html`
            <label class="eas__field">
              <span>${f.label}</span>
              ${this._input(f.key, 'Exactly as you want it submitted')}
            </label>
          `)}
        </div>
      ` : nothing}
    `;
  }

  _renderStep4() {
    return html`
      <p class="eas__lead">Last one — how the automation should behave.</p>
      <div class="eas__grid">
        <label class="eas__field">
          <span>Cover letters</span>
          <select @change=${(e) => this._set('policy_cover_letter', e.target.value)}>
            ${[['when_required', 'Only when the form requires one'], ['never', 'Never attach one'], ['auto_generate', 'Auto-generate for every application']]
              .map(([v, l]) => html`<option value=${v} ?selected=${(this.values.policy_cover_letter || 'when_required') === v}>${l}</option>`)}
          </select>
        </label>
        <label class="eas__field">
          <span>Max submissions per day</span>
          <input type="number" min="1" max="25" .value=${this.values.policy_daily_cap ?? 5}
                 @input=${(e) => this._set('policy_daily_cap', Number(e.target.value) || 5)}>
        </label>
      </div>
      <p class="eas__note">
        Every submission gets a full review screen before anything is sent —
        legal checkboxes (arbitration, privacy) always need your explicit tap,
        and nothing is ever submitted silently.
      </p>
    `;
  }

  _stepKeys() {
    switch (this.step) {
      case 1: return [...TIER1.map(f => f.key), 'work_auth', 'sponsorship'];
      case 2: return ['onsite_willingness', 'comp_expectation', 'start_date', 'hear_about', 'years_experience_pm'];
      case 3: return EEOC_FIELDS.map(f => f.key);
      case 4: return ['policy_cover_letter', 'policy_daily_cap', 'policy_review_mode'];
      default: return [];
    }
  }

  _next() {
    if (this.step === 3 && this.eeocMode === 'decline') {
      for (const f of EEOC_FIELDS) this.values[f.key] = 'decline';
      this.values = { ...this.values };
    }
    if (this.step === 4) {
      this.values = { ...this.values, policy_review_mode: 'always', policy_cover_letter: this.values.policy_cover_letter || 'when_required', policy_daily_cap: this.values.policy_daily_cap ?? 5 };
    }
    this._saveStep(this._stepKeys(), { finish: this.step === 4 });
  }

  render() {
    if (!this.open) return nothing;
    const titles = { 1: 'Confirm what I know', 2: 'Logistics & comp', 3: 'Demographic surveys', 4: 'Automation policies' };
    return html`
      <div class="eas-overlay" @click=${(e) => { if (e.target === e.currentTarget) this._close(); }}>
        <div class="eas" role="dialog" aria-modal="true" aria-label="Easy Apply setup">
          <header class="eas__head">
            <div>
              <h2>Easy Apply setup</h2>
              <span class="muted">Step ${this.step} of 4 — ${titles[this.step]}</span>
            </div>
            <button class="eas__close" aria-label="Close" @click=${() => this._close()}>×</button>
          </header>

          ${this.loading ? html`<p class="eas__lead">Checking what's already on record…</p>` : html`
            ${this.step === 1 ? this._renderStep1() : nothing}
            ${this.step === 2 ? this._renderStep2() : nothing}
            ${this.step === 3 ? this._renderStep3() : nothing}
            ${this.step === 4 ? this._renderStep4() : nothing}
          `}

          ${this.error ? html`<p class="eas__error">${this.error}</p>` : nothing}

          <footer class="eas__foot">
            ${this.step > 1 ? html`<button class="btn btn--sm" ?disabled=${this.saving} @click=${() => { this.step -= 1; }}>Back</button>` : html`<span></span>`}
            <button class="btn btn--accent" ?disabled=${this.saving || this.loading} @click=${() => this._next()}>
              ${this.saving ? 'Saving…' : this.step === 4 ? 'Finish setup' : 'Save & continue'}
            </button>
          </footer>
        </div>
      </div>
    `;
  }
}

customElements.define('ladder-easy-apply-setup', LadderEasyApplySetup);
