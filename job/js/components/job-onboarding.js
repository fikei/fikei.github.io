// job-onboarding — six-stage onboarding flow for /job.
//
//   0  Pitch         — value prop + Get started
//   1  Upload        — paste resume text (file drop is post-MVP)
//   2  Confirm       — You / Location / Career / Skills cards (editable)
//   3  Questions     — five freeform prompts, one per screen, with
//                      Haiku tag extraction surfacing between screens
//   4  Fast knobs    — structured chips/sliders/toggles
//   5  Preview       — diff of the staged profile + commit
//
// State lives in localStorage under `job:onboarding:draft` so users can
// step away and come back. ?demo=1 switches Stage 5 to a non-committing
// preview so existing users (Ian) can test without losing their profile.
//
// Talks to the `onboard` edge function in three modes:
//   { mode: 'parse',    text }
//   { mode: 'extract',  questionId, answer }
//   { mode: 'finalize', profile, demo }

import { LitElement, html, nothing } from 'https://esm.run/lit@3';

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const ONBOARD_FN_URL = `${SUPABASE_URL}/functions/v1/onboard`;
const DRAFT_KEY = 'job:onboarding:draft';

const STAGES = [
  { id: 0, label: 'Welcome' },
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Confirm' },
  { id: 3, label: 'Questions' },
  { id: 4, label: 'Knobs' },
  { id: 5, label: 'Preview' },
];

const QUESTIONS = [
  { id: 'q1_mission',   label: 'What problem do you want to spend the next five years on?',
    placeholder: 'e.g. I want to make public services feel like apps people actually want to use…',
    help: 'Tell us what you\'d work on if no one was watching.' },
  { id: 'q2_self',      label: 'Describe a time at work where you felt most yourself. What were you doing, and what made it click?',
    placeholder: 'e.g. Six months at a tiny civic-tech team — I was rebuilding a benefits-eligibility tool from scratch with two engineers and a research partner…',
    help: 'The story matters; we\'ll use it for the cover-letter voice too.' },
  { id: 'q3_win',       label: 'A win you\'re proud of — ideally with a number attached.',
    placeholder: 'e.g. Took our retention from 41% to 67% in eight months by rebuilding the first-week experience.',
    help: 'Numbers make this fly. We extract them for cover letters.' },
  { id: 'q4_walkaway',  label: 'What kind of company or team would make you walk away from a great offer?',
    placeholder: 'e.g. Anything in surveillance, defense, or with a return-to-office mandate. Also no patience for hustle-culture leadership.',
    help: 'Be specific — these become hard filters.' },
  { id: 'q5_titles',    label: 'What roles and titles should we be hunting for? Anything off-limits?',
    placeholder: 'e.g. Head of Product, Founding PM, VP Product at seed-to-series-A startups. No people-manager-only roles.',
    help: 'Title patterns + stage preference.' },
];

const SECTORS_PALETTE = ['climate', 'civic-tech', 'healthtech', 'fintech', 'edtech', 'consumer-social', 'developer-tools', 'AI-infrastructure', 'biotech', 'space', 'public-benefit'];
const STAGE_PALETTE   = ['pre-seed', 'seed', 'series-a', 'series-b', 'growth', 'public'];
const DEALBREAKER_PALETTE = ['defense', 'gambling', 'crypto', 'adtech', 'surveillance', 'fossil-fuels'];
const WORK_AUTH_PALETTE = ['US-citizen', 'US-permanent-resident', 'US-TN-eligible', 'CA-citizen', 'EU-citizen', 'UK-citizen', 'requires-sponsorship'];
const ARC_PALETTE     = ['zero-to-one', 'scale-up', 'turnaround', 'ic-to-manager', 'founder', 'scaling-team', 'scaling-revenue'];

function emptyDraft() {
  return {
    identity: {},
    location: { remotePreference: 'any', willingToRelocate: [], workAuth: [] },
    capability: { skills: [], pastSectors: [], arcTags: [], history: [] },
    values_seed: { missionKeywords: [], impactThemes: [], cultureKeywords: [], antiCulture: [] },
    targeting: { targetRoles: [], targetSectors: [], stagePreference: [], antiMissionTerms: [], missionRequired: false },
    preferences: { compFloor: null, remotePreference: 'any', missionRequired: false },
    wins: [],
    narratives: [],
    _meta: { stage: 0, questionIdx: 0, answers: {}, extractions: {} },
  };
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw);
    return { ...emptyDraft(), ...parsed, _meta: { ...emptyDraft()._meta, ...(parsed._meta || {}) } };
  } catch {
    return emptyDraft();
  }
}
function saveDraft(d) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
}

async function callOnboard(token, body) {
  const res = await fetch(ONBOARD_FN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`onboard ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

export class JobOnboarding extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    draft:       { state: true },
    busy:        { state: true },
    busyLabel:   { state: true },
    error:       { state: true },
    finalized:   { state: true },
    demoMode:    { state: true },
  };

  constructor() {
    super();
    this.draft = loadDraft();
    this.busy = false;
    this.busyLabel = '';
    this.error = '';
    this.finalized = null;
    this.demoMode = new URLSearchParams(location.search).get('demo') === '1';
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('ctrl:auth:signedin', this._authPing = () => this.requestUpdate());
    document.addEventListener('job:auth:ready', this._authReady = () => this.requestUpdate());
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._authPing);
    document.removeEventListener('job:auth:ready', this._authReady);
    super.disconnectedCallback();
  }

  _token() {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    if (!sb) return null;
    // Synchronous-ish: the session lives in localStorage so getSession resolves fast.
    return sb.auth.getSession().then(({ data }) => data?.session?.access_token || null);
  }

  _commit() { saveDraft(this.draft); this.requestUpdate(); }
  _setStage(stage) { this.draft._meta.stage = stage; this._commit(); }
  _patch(path, value) {
    const segs = path.split('.');
    let o = this.draft;
    for (let i = 0; i < segs.length - 1; i++) {
      o[segs[i]] = o[segs[i]] || {};
      o = o[segs[i]];
    }
    o[segs[segs.length - 1]] = value;
    this._commit();
  }
  _toggleInArr(path, value) {
    const segs = path.split('.');
    let o = this.draft;
    for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]] = o[segs[i]] || {};
    const arr = o[segs[segs.length - 1]] = o[segs[segs.length - 1]] || [];
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
    this._commit();
  }

  // ---- Stage 1: parse uploaded resume text ----
  async _parseResume() {
    const text = this.shadowRoot ? null : this.querySelector('#resume-text')?.value || '';
    if (!text.trim()) { this.error = 'Paste your resume text first.'; return; }
    this.error = '';
    this.busy = true; this.busyLabel = 'Reading your resume…';
    try {
      const token = await this._token();
      if (!token) throw new Error('Not signed in.');
      const { draft } = await callOnboard(token, { mode: 'parse', text });
      // Merge parsed into draft (don't clobber any user-entered values).
      this.draft.identity = { ...this.draft.identity, ...draft.identity };
      this.draft.location = { ...this.draft.location, ...draft.location };
      if (draft.capability) {
        this.draft.capability.skills      = draft.capability.skills      || this.draft.capability.skills;
        this.draft.capability.pastSectors = draft.capability.pastSectors || this.draft.capability.pastSectors;
        this.draft.capability.arcTags     = draft.capability.arcTags     || this.draft.capability.arcTags;
        this.draft.capability.history     = draft.capability.history     || this.draft.capability.history;
      }
      this._setStage(2);
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
    }
  }

  // ---- Stage 3: extract tags from a freeform answer ----
  async _submitAnswer(question) {
    const answer = this.querySelector(`#answer-${question.id}`)?.value || '';
    if (!answer.trim()) {
      // Allow skip
      this._nextQuestion();
      return;
    }
    this.draft._meta.answers[question.id] = answer;
    this._commit();
    this.error = '';
    this.busy = true; this.busyLabel = 'Pulling out the signal…';
    try {
      const token = await this._token();
      if (!token) throw new Error('Not signed in.');
      const { tags } = await callOnboard(token, { mode: 'extract', questionId: question.id, answer });
      this.draft._meta.extractions[question.id] = tags;
      this._applyExtraction(question.id, tags);
      this._nextQuestion();
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
    }
  }

  _applyExtraction(qid, tags) {
    const merge = (path, incoming) => {
      const segs = path.split('.');
      let o = this.draft;
      for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]] = o[segs[i]] || {};
      const k = segs[segs.length - 1];
      const cur = new Set(o[k] || []);
      for (const v of (incoming || [])) cur.add(v);
      o[k] = [...cur];
    };
    if (qid === 'q1_mission') {
      merge('values_seed.missionKeywords', tags.missionKeywords);
      merge('values_seed.impactThemes', tags.impactThemes);
      merge('targeting.targetSectors', tags.targetSectors);
    } else if (qid === 'q2_self') {
      merge('values_seed.cultureKeywords', tags.cultureKeywords);
      merge('capability.arcTags', tags.arcTags);
      if (tags.narrativeMd) {
        this.draft.narratives.push({ title: tags.narrativeTitle || 'A time I felt myself', content_md: tags.narrativeMd, source_question: qid });
      }
    } else if (qid === 'q3_win') {
      if (tags.headline) this.draft.wins.push({ headline: tags.headline, metric: tags.metric || null });
      if (tags.narrativeMd) {
        this.draft.narratives.push({ title: tags.narrativeTitle || 'A win', content_md: tags.narrativeMd, source_question: qid });
      }
    } else if (qid === 'q4_walkaway') {
      merge('targeting.antiMissionTerms', tags.antiMissionTerms);
      merge('values_seed.antiCulture', tags.antiCulture);
    } else if (qid === 'q5_titles') {
      merge('targeting.targetRoles', tags.targetRoles);
      merge('targeting.stagePreference', tags.stagePreference);
    }
    this._commit();
  }

  _nextQuestion() {
    const i = this.draft._meta.questionIdx;
    if (i < QUESTIONS.length - 1) {
      this.draft._meta.questionIdx = i + 1;
      this._commit();
    } else {
      this._setStage(4);
    }
  }
  _prevQuestion() {
    const i = this.draft._meta.questionIdx;
    if (i > 0) {
      this.draft._meta.questionIdx = i - 1;
      this._commit();
    } else {
      this._setStage(2);
    }
  }

  // ---- Stage 5: commit ----
  async _finalize() {
    this.error = '';
    this.busy = true; this.busyLabel = this.demoMode ? 'Building demo preview…' : 'Saving your profile…';
    try {
      const token = await this._token();
      if (!token) throw new Error('Not signed in.');
      // Strip _meta from what we send up.
      const { _meta, ...profile } = this.draft;
      const result = await callOnboard(token, { mode: 'finalize', profile, demo: this.demoMode });
      this.finalized = result;
      if (!this.demoMode && result.ok) {
        clearDraft();
      }
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
    }
  }

  _reset() {
    if (!confirm('Throw away your current onboarding draft?')) return;
    clearDraft();
    this.draft = emptyDraft();
    this.requestUpdate();
  }

  // ---------- render ----------

  render() {
    const stage = this.draft._meta.stage || 0;
    return html`
      <div class="onboard">
        ${this._renderStepper(stage)}
        ${this.demoMode ? html`
          <div class="onboard__demo-banner">
            Demo mode — nothing you do here will overwrite your live profile. Drop <code>?demo=1</code> to commit for real.
          </div>` : nothing}
        ${this.error ? html`<div class="onboard__demo-banner" style="border-color: var(--error); background: rgba(168,32,13,0.10);">${this.error}</div>` : nothing}
        ${this.busy ? html`<div class="onboard__hint">${this.busyLabel}</div>` : nothing}
        ${stage === 0 ? this._renderPitch() : nothing}
        ${stage === 1 ? this._renderUpload() : nothing}
        ${stage === 2 ? this._renderConfirm() : nothing}
        ${stage === 3 ? this._renderQuestions() : nothing}
        ${stage === 4 ? this._renderKnobs() : nothing}
        ${stage === 5 ? this._renderPreview() : nothing}
      </div>
    `;
  }

  _renderStepper(stage) {
    return html`
      <div class="stepper">
        ${STAGES.map((s, i) => html`
          <span class="stepper__item ${s.id === stage ? 'stepper__item--current' : s.id < stage ? 'stepper__item--complete' : ''}">
            <span class="stepper__dot"></span>
            ${s.label}
          </span>
          ${i < STAGES.length - 1 ? html`<span class="stepper__sep"></span>` : ''}
        `)}
      </div>
    `;
  }

  _renderPitch() {
    return html`
      <section class="onboard__stage">
        <h1>Your career operating system.</h1>
        <p class="lede">Upload what you've already written, answer a few open questions, and we'll start pulling roles that match what you actually want — and draft the cover letters too.</p>
        <p class="onboard__hint">Takes about 8 minutes. You can leave and come back; we'll save where you left off.</p>
        <div class="onboard__nav">
          <span></span>
          <button class="btn btn--primary" @click=${() => this._setStage(1)}>Get started</button>
        </div>
      </section>
    `;
  }

  _renderUpload() {
    return html`
      <section class="onboard__stage">
        <h1>Drop in what you've got.</h1>
        <p class="lede">Paste your resume below. We'll pull out the bones (companies, titles, skills, location) so you don't retype them. Skip if you'd rather start from scratch.</p>
        <div class="dropzone">
          <div class="dropzone__title">Paste your resume</div>
          <div class="dropzone__hint">PDF parsing is coming. For now, paste the text — copying from your resume usually works.</div>
          <textarea id="resume-text" placeholder="Paste resume text here…"></textarea>
        </div>
        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._setStage(2)}>Skip — I'll fill it in</button>
          <button class="btn btn--primary" ?disabled=${this.busy} @click=${() => this._parseResume()}>Parse and continue</button>
        </div>
      </section>
    `;
  }

  _renderConfirm() {
    const id = this.draft.identity || {};
    const loc = this.draft.location || {};
    const cap = this.draft.capability || {};
    return html`
      <section class="onboard__stage">
        <h1>Here's what we found.</h1>
        <p class="lede">Fix anything that's off. Empty cards mean we didn't have enough to pull from your upload — fill what you can.</p>

        <div class="onboard-card">
          <h2 class="onboard-card__title">You</h2>
          ${this._row('Name', 'identity.name', id.name)}
          ${this._row('Email', 'identity.email', id.email)}
          ${this._row('Phone', 'identity.phone', id.phone)}
          ${this._row('LinkedIn', 'identity.linkedin', id.linkedin)}
          ${this._row('Portfolio', 'identity.portfolio', id.portfolio)}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Location</h2>
          ${this._row('City', 'location.city', loc.city)}
          <div class="onboard-card__row">
            <label>Region</label>
            <span class="read-only">${[loc.region, loc.country].filter(Boolean).join(' · ') || '—'}${loc.timezone ? ` · ${loc.timezone}` : ''}</span>
          </div>
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Career</h2>
          ${(cap.history || []).length === 0
            ? html`<p class="onboard__hint">No history pulled. Skip — you can come back to this.</p>`
            : html`
              <ul style="display:flex;flex-direction:column;gap:var(--space-3);list-style:none;padding:0;margin:0;">
                ${cap.history.map((h, i) => html`
                  <li style="display:flex;flex-direction:column;gap:2px;">
                    <strong>${h.title || '—'}</strong>
                    <span class="onboard__hint">${h.company || ''} · ${h.start || ''}${h.end ? `–${h.end}` : ''}</span>
                    ${h.scope ? html`<span class="onboard__hint">${h.scope}</span>` : ''}
                  </li>
                `)}
              </ul>`}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Skills we spotted</h2>
          <div class="chip-row">
            ${(cap.skills || []).map(s => html`
              <span class="chip chip--editable chip--on">
                ${s.name}${s.years ? html` · ${s.years}y` : ''}
                <button @click=${() => { this.draft.capability.skills = cap.skills.filter(x => x !== s); this._commit(); }}>×</button>
              </span>
            `)}
          </div>
          ${this._chipAdd('Add a skill', (v) => {
            this.draft.capability.skills.push({ name: v, years: null }); this._commit();
          })}
        </div>

        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._setStage(1)}>Back</button>
          <button class="btn btn--primary" @click=${() => this._setStage(3)}>Continue</button>
        </div>
      </section>
    `;
  }

  _row(label, path, value) {
    return html`
      <div class="onboard-card__row">
        <label>${label}</label>
        <input type="text" .value=${value || ''}
               @change=${(e) => this._patch(path, e.target.value)}/>
      </div>
    `;
  }
  _chipAdd(label, onAdd) {
    return html`
      <div class="chip-palette__add">
        <input type="text" placeholder=${label}
               @keydown=${(e) => {
                 if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) { onAdd(v); e.target.value = ''; } }
               }}/>
      </div>
    `;
  }

  _renderQuestions() {
    const i = this.draft._meta.questionIdx || 0;
    const q = QUESTIONS[i];
    const prevAnswer = this.draft._meta.answers[q.id] || '';
    const lastExtraction = i > 0 ? this.draft._meta.extractions[QUESTIONS[i - 1].id] : null;
    return html`
      <section class="onboard__stage">
        <div class="onboard__hint">Question ${i + 1} of ${QUESTIONS.length}</div>
        ${lastExtraction ? this._renderExtractionEcho(QUESTIONS[i - 1].id, lastExtraction) : nothing}
        <div class="chat-prompt">
          <div class="chat-prompt__label">${q.label}</div>
          <p class="chat-prompt__help">${q.help}</p>
          <textarea id="answer-${q.id}" placeholder=${q.placeholder} .value=${prevAnswer}></textarea>
        </div>
        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._prevQuestion()}>Back</button>
          <span>
            <button class="btn btn--ghost" @click=${() => this._nextQuestion()}>Skip for now</button>
            <button class="btn btn--primary" ?disabled=${this.busy} @click=${() => this._submitAnswer(q)}>Continue</button>
          </span>
        </div>
      </section>
    `;
  }

  _renderExtractionEcho(qid, tags) {
    const rows = [];
    if (qid === 'q1_mission') {
      if (tags.missionKeywords?.length) rows.push(['Mission', tags.missionKeywords]);
      if (tags.impactThemes?.length) rows.push(['Impact', tags.impactThemes]);
      if (tags.targetSectors?.length) rows.push(['Sectors', tags.targetSectors]);
    } else if (qid === 'q2_self') {
      if (tags.cultureKeywords?.length) rows.push(['Culture', tags.cultureKeywords]);
      if (tags.arcTags?.length) rows.push(['Arc', tags.arcTags]);
    } else if (qid === 'q3_win') {
      if (tags.headline) rows.push(['Win', [tags.headline + (tags.metric ? ` · ${tags.metric}` : '')]]);
    } else if (qid === 'q4_walkaway') {
      if (tags.antiMissionTerms?.length) rows.push(['Dealbreakers', tags.antiMissionTerms]);
      if (tags.antiCulture?.length) rows.push(['Anti-culture', tags.antiCulture]);
    } else if (qid === 'q5_titles') {
      if (tags.targetRoles?.length) rows.push(['Titles', tags.targetRoles]);
      if (tags.stagePreference?.length) rows.push(['Stages', tags.stagePreference]);
    }
    if (!rows.length) return nothing;
    return html`
      <div class="chat-prompt__extracted">
        <div class="chat-prompt__extracted-title">We heard:</div>
        ${rows.map(([label, items]) => html`
          <div class="chat-prompt__row">
            <span class="chat-prompt__row-label">${label}</span>
            ${items.map(t => html`<span class="chip chip--on">${t}</span>`)}
          </div>
        `)}
      </div>
    `;
  }

  _renderKnobs() {
    const t = this.draft.targeting || {};
    const p = this.draft.preferences || {};
    const loc = this.draft.location || {};
    const c = this.draft.capability || {};
    return html`
      <section class="onboard__stage">
        <h1>The fast knobs.</h1>
        <p class="lede">Things that are easier to click than to write.</p>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Target sectors</h2>
          ${this._palette(SECTORS_PALETTE, t.targetSectors || [], 'targeting.targetSectors')}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Stage preference</h2>
          ${this._palette(STAGE_PALETTE, t.stagePreference || [], 'targeting.stagePreference')}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Arc tags</h2>
          <p class="onboard__hint">Stage/role-shape you want next.</p>
          ${this._palette(ARC_PALETTE, c.arcTags || [], 'capability.arcTags')}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Dealbreakers</h2>
          ${this._palette(DEALBREAKER_PALETTE, t.antiMissionTerms || [], 'targeting.antiMissionTerms')}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Work authorization</h2>
          ${this._palette(WORK_AUTH_PALETTE, loc.workAuth || [], 'location.workAuth')}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Remote / hybrid / onsite</h2>
          <div class="segmented">
            ${['remote', 'hybrid', 'onsite', 'any'].map(opt => html`
              <button aria-pressed=${(p.remotePreference || 'any') === opt ? 'true' : 'false'}
                      @click=${() => { this._patch('preferences.remotePreference', opt); this._patch('location.remotePreference', opt); }}>${opt}</button>
            `)}
          </div>
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Comp floor (base, USD)</h2>
          <input type="range" min="0" max="400000" step="5000"
                 .value=${String(p.compFloor ?? 150000)}
                 @input=${(e) => this._patch('preferences.compFloor', Number(e.target.value))}/>
          <div class="onboard__hint">${(p.compFloor ?? 150000).toLocaleString()} minimum</div>
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Mission alignment</h2>
          <label style="display:flex;gap:var(--space-3);align-items:center;cursor:pointer;">
            <input type="checkbox" .checked=${!!p.missionRequired}
                   @change=${(e) => { this._patch('preferences.missionRequired', e.target.checked); this._patch('targeting.missionRequired', e.target.checked); }}/>
            <span>Mission alignment is a hard requirement</span>
          </label>
        </div>

        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._setStage(3)}>Back</button>
          <button class="btn btn--primary" @click=${() => this._setStage(5)}>See preview</button>
        </div>
      </section>
    `;
  }

  _palette(options, selected, path) {
    const sel = new Set(selected);
    return html`
      <div class="chip-palette">
        <div class="chip-palette__chips">
          ${options.map(opt => html`
            <button class="chip ${sel.has(opt) ? 'chip--on' : ''}"
                    @click=${() => this._toggleInArr(path, opt)}>${opt}</button>
          `)}
          ${[...sel].filter(v => !options.includes(v)).map(opt => html`
            <span class="chip chip--editable chip--on">${opt}
              <button @click=${() => this._toggleInArr(path, opt)}>×</button>
            </span>
          `)}
        </div>
        ${this._chipAdd('Add custom…', (v) => { if (!sel.has(v)) this._toggleInArr(path, v); })}
      </div>
    `;
  }

  _renderPreview() {
    if (this.finalized) {
      return html`
        <section class="onboard__stage">
          <h1>${this.demoMode ? 'Demo preview' : 'You\'re in.'}</h1>
          <p class="lede">${this.demoMode
            ? 'Nothing was saved — this is what would have been written.'
            : 'Your profile is saved. /job is unlocked.'}</p>
          <div class="onboard-preview">
            <pre>${JSON.stringify(this.finalized, null, 2)}</pre>
          </div>
          <div class="onboard__nav">
            ${this.demoMode
              ? html`<button class="btn btn--ghost" @click=${() => this._reset()}>Start over</button>`
              : html`<span></span>`}
            <a class="btn btn--primary" href="/job/jobs/recommended/">Open /job</a>
          </div>
        </section>
      `;
    }
    const { _meta, ...profile } = this.draft;
    return html`
      <section class="onboard__stage">
        <h1>Look right?</h1>
        <p class="lede">${this.demoMode
          ? 'You\'re in demo mode. Hit commit and we\'ll show what would be written.'
          : 'Hit commit and we\'ll save this and start pulling roles.'}</p>
        <div class="onboard-preview">
          <pre>${JSON.stringify(profile, null, 2)}</pre>
        </div>
        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._setStage(4)}>Back to tweak</button>
          <button class="btn btn--primary" ?disabled=${this.busy} @click=${() => this._finalize()}>${this.demoMode ? 'Show demo result' : 'Commit and open /job'}</button>
        </div>
      </section>
    `;
  }
}

customElements.define('job-onboarding', JobOnboarding);
