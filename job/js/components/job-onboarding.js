// job-onboarding — five-stage onboarding for /job.
//
//   0  Welcome   — pitch + Get started
//   1  Upload    — multi-file dropzone (resume + supporting docs); pdf
//                  extraction runs client-side via shared pdf-extract.js
//   2  Insights  — celebration narrative with three translation tracks
//                  (Domains / Work areas / Skills) + collapsible edit panel
//   3  Questions — chat-style UI (tryapt pattern, Wise tokens)
//   4  Tailor    — "How we'll tailor your search" — four grouped sections
//                  with "you said:" excerpts + commit CTA at the bottom
//
//   debug       — hidden JSON dump, mounted only when ?debug=1 is set.
//                 Kept for QA, never shown in the live flow.
//
// State lives in localStorage under `job:onboarding:draft`. ?demo=1 switches
// the commit step to a non-writing preview so existing users can re-walk
// without losing their live profile.
//
// Talks to the `onboard` edge function in five modes: parse, bundle,
// insights, extract, finalize.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';

const V = (new URL(import.meta.url)).search;
const { readFileAsText } = await import('../pdf-extract.js' + V);

// Tiny markdown renderer for the chat surface — *emphasis* and **strong**
// only. Escapes everything else so we never inject raw HTML from Haiku.
// Anything fancier (links, lists) doesn't belong in the chat copy.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function tinyMd(s) {
  let out = escapeHtml(s || '');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return out;
}

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const ONBOARD_FN_URL = `${SUPABASE_URL}/functions/v1/onboard`;
const DRAFT_KEY = 'job:onboarding:draft';

const STAGES = [
  { id: 0, label: 'Welcome' },
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Insights' },
  { id: 3, label: 'Questions' },
  { id: 4, label: 'Tailor' },
];

// Question copy is intentionally short and direct. Haiku may rewrite the
// label as `nextQuestionCopy` (via extract mode) so it flows from the prior
// reflection — but the substance stays fixed.
const QUESTIONS = [
  { id: 'q1_mission',
    label: 'What problem do you want to spend the next five years on?',
    placeholder: 'I want to make public services feel less like waiting rooms…' },
  { id: 'q2_self',
    label: 'Describe a time at work where you felt most yourself.',
    placeholder: 'Six months at a tiny civic-tech team rebuilding a benefits tool…' },
  { id: 'q3_win',
    label: 'A win you\'re proud of — ideally with a number attached.',
    placeholder: 'Took retention from 41% to 67% in eight months by rebuilding the first-week experience.' },
  { id: 'q4_walkaway',
    label: 'What would make you walk away from a great offer?',
    placeholder: 'Anything in surveillance or defense. No patience for hustle-culture leadership.' },
  { id: 'q5_titles',
    label: 'What roles and titles should we be hunting for? Anything off-limits?',
    placeholder: 'Head of Product, Founding PM, VP Product at seed-to-A startups. No people-manager-only roles.' },
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
    preferences: { compFloor: 150000, remotePreference: 'any', missionRequired: false },
    wins: [],
    narratives: [],
    insights: null,
    bundle: null,
    _meta: {
      stage: 0,
      questionIdx: 0,
      answers: {},
      extractions: {},
      uploadedFiles: [],
      editOpen: false,
      // Chat log: ordered list of turns. Each turn is either:
      //   { role: 'ai',   reflection?: string, question: string, qid: string }
      //   { role: 'user', text: string, qid: string }
      // The latest AI turn carries the active question. We add the first AI
      // turn lazily when the chat stage mounts.
      chatLog: [],
    },
  };
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return emptyDraft();
    const parsed = JSON.parse(raw);
    return { ...emptyDraft(), ...parsed, _meta: { ...emptyDraft()._meta, ...(parsed._meta || {}) } };
  } catch { return emptyDraft(); }
}
function saveDraft(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* */ } }
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ } }

async function callOnboard(token, body) {
  const res = await fetch(ONBOARD_FN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`onboard ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

export class JobOnboarding extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    draft:      { state: true },
    busy:       { state: true },
    busyLabel:  { state: true },
    error:      { state: true },
    finalized:  { state: true },
    demoMode:   { state: true },
    debugMode:  { state: true },
  };

  constructor() {
    super();
    this.draft = loadDraft();
    this.busy = false; this.busyLabel = ''; this.error = '';
    this.finalized = null;
    const params = new URLSearchParams(location.search);
    this.demoMode  = params.get('demo')  === '1';
    this.debugMode = params.get('debug') === '1';
  }

  async _token() {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data?.session?.access_token || null;
  }

  _commit() { saveDraft(this.draft); this.requestUpdate(); }
  _setStage(stage) { this.draft._meta.stage = stage; this._commit(); }
  _patch(path, value) {
    const segs = path.split('.'); let o = this.draft;
    for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]] = o[segs[i]] || {};
    o[segs[segs.length - 1]] = value;
    this._commit();
  }
  _toggleInArr(path, value) {
    const segs = path.split('.'); let o = this.draft;
    for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]] = o[segs[i]] || {};
    const arr = o[segs[segs.length - 1]] = o[segs[segs.length - 1]] || [];
    const idx = arr.indexOf(value);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(value);
    this._commit();
  }
  _mergeArr(path, incoming) {
    const segs = path.split('.'); let o = this.draft;
    for (let i = 0; i < segs.length - 1; i++) o = o[segs[i]] = o[segs[i]] || {};
    const k = segs[segs.length - 1];
    const cur = new Set(o[k] || []);
    for (const v of (incoming || [])) cur.add(v);
    o[k] = [...cur];
  }

  // -------- Stage 1: multi-file ingest --------

  async _handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    this.error = '';
    this.busy = true; this.busyLabel = `Reading ${files.length} file${files.length > 1 ? 's' : ''}…`;
    try {
      // Classify by filename: anything with "resume" or "cv" is the primary
      // resume; everything else is bundle context. If no name match, the
      // largest file (likely the resume) wins.
      const named = [];
      for (const f of files) {
        const text = await readFileAsText(f);
        named.push({ name: f.name, size: text.length, text });
      }
      const resumeMatch = named.find(f => /(^|[\s_-])(resume|cv)/i.test(f.name));
      const resume = resumeMatch || named.slice().sort((a, b) => b.size - a.size)[0];
      const others = named.filter(f => f !== resume);

      this.draft._meta.uploadedFiles = named.map(f => ({ name: f.name, size: f.size, isResume: f === resume }));
      this._commit();

      const token = await this._token();
      if (!token) throw new Error('Not signed in.');

      // Two passes in parallel: parse resume → structured profile; bundle
      // everything else (or the same resume if it's the only doc) → voice
      // + values + projects + dream signals.
      const bundleText = (others.length ? others : [resume]).map(f => `--- ${f.name} ---\n${f.text}`).join('\n\n');
      this.busyLabel = 'Pulling out the bones (resume) and the voice (everything else)…';

      const [parseRes, bundleRes] = await Promise.all([
        callOnboard(token, { mode: 'parse',  text: resume.text }),
        callOnboard(token, { mode: 'bundle', text: bundleText }),
      ]);
      const draftIncoming = parseRes.draft || {};
      const bundle = bundleRes.bundle || {};

      // Merge parse output.
      this.draft.identity = { ...this.draft.identity, ...draftIncoming.identity };
      this.draft.location = { ...this.draft.location, ...draftIncoming.location };
      if (draftIncoming.capability) {
        this.draft.capability.skills      = draftIncoming.capability.skills      || this.draft.capability.skills;
        this.draft.capability.pastSectors = draftIncoming.capability.pastSectors || this.draft.capability.pastSectors;
        this.draft.capability.arcTags     = draftIncoming.capability.arcTags     || this.draft.capability.arcTags;
        this.draft.capability.history     = draftIncoming.capability.history     || this.draft.capability.history;
      }

      // Merge bundle output.
      this.draft.bundle = bundle;
      this._mergeArr('values_seed.cultureKeywords', bundle.values);
      this._mergeArr('targeting.targetRoles', bundle.dreamRoleSignals);
      if (Array.isArray(bundle.wins)) {
        for (const w of bundle.wins) this.draft.wins.push(w);
      }

      // Now generate insights for Stage 2.
      this.busyLabel = 'Mapping where this experience travels…';
      const profileForInsights = {
        identity: this.draft.identity,
        location: this.draft.location,
        capability: this.draft.capability,
        bundle: this.draft.bundle,
      };
      const insightsRes = await callOnboard(token, { mode: 'insights', profile: profileForInsights });
      this.draft.insights = insightsRes.insights || null;

      this._setStage(2);
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
    }
  }

  async _skipUpload() {
    // Manual start — no insights to show, but we still need an insights card.
    this.draft.insights = null;
    this._setStage(2);
  }

  // -------- Stage 2: insight hero --------

  _toggleEdit() { this.draft._meta.editOpen = !this.draft._meta.editOpen; this._commit(); }

  // -------- Stage 3: chat questions --------
  //
  // Chat log model: every AI turn carries the active question; every user
  // turn carries their answer (or a synthetic "let's skip this one" message).
  // We re-render the full log every update; latest turn auto-scrolls into
  // view via _afterRender. The fixed QUESTIONS list still drives the slot
  // sequence — Haiku just generates the reflection + (optional) question
  // rewrite on top of it.

  _ensureChatSeeded() {
    if ((this.draft._meta.chatLog || []).length === 0) {
      this.draft._meta.chatLog.push({
        role: 'ai',
        qid: QUESTIONS[0].id,
        question: QUESTIONS[0].label,
      });
      this.draft._meta.questionIdx = 0;
      this._commit();
    }
  }

  _activeQuestion() {
    const log = this.draft._meta.chatLog || [];
    // The last AI turn is always the active question.
    for (let i = log.length - 1; i >= 0; i--) if (log[i].role === 'ai') return log[i];
    return null;
  }

  async _submitAnswer(opts = {}) {
    const isSkip = !!opts.skip;
    const ta = this.querySelector('#chat-input');
    const typed = (ta?.value || '').trim();
    const active = this._activeQuestion();
    if (!active) return;

    // Synthetic skip message keeps the conversation continuous.
    const userText = isSkip
      ? (typed || "Let's skip this one.")
      : typed;
    if (!userText) return; // empty + not skip = no-op

    // Append user turn.
    this.draft._meta.chatLog.push({ role: 'user', qid: active.qid, text: userText });
    if (!isSkip) this.draft._meta.answers[active.qid] = userText;
    if (ta) { ta.value = ''; this._autoSize(ta); }
    this.error = '';
    this.busy = true;
    // Status text rotates while we wait. The CSS adds animated ellipsis,
    // so the strings don't include "…" themselves.
    this.busyLabel = 'Saving';
    this._commit();
    this._busyTimer = setTimeout(() => {
      if (this.busy) { this.busyLabel = 'Reading between the lines'; this.requestUpdate(); }
    }, 900);

    // Look up the next question label (so the AI can rewrite it inline).
    const i = QUESTIONS.findIndex(q => q.id === active.qid);
    const next = QUESTIONS[i + 1] || null;

    try {
      // Skip: post a soft AI ack and pivot. Don't call extract.
      if (isSkip) {
        // Tiny pause so the saving pill is visible (otherwise skip feels
        // instant and the chat jumps without grounding).
        await new Promise(r => setTimeout(r, 350));
        this.draft._meta.chatLog.push({
          role: 'ai',
          qid: next ? next.id : active.qid,
          reflection: 'Got it — we can switch gears.',
          question: next ? next.label : null,
          fresh: true,
        });
        if (next) this.draft._meta.questionIdx = i + 1;
        this._commit();
        if (!next) this._setStage(4);
        return;
      }

      const token = await this._token();
      if (!token) throw new Error('Not signed in.');
      const { tags, reflection, nextQuestionCopy } = await callOnboard(token, {
        mode: 'extract',
        questionId: active.qid,
        answer: userText,
        nextQuestionLabel: next?.label || null,
      });
      this.draft._meta.extractions[active.qid] = tags;
      if (tags) this._applyExtraction(active.qid, tags);

      // Append AI turn (fresh flag triggers the fade-in animation).
      this.draft._meta.chatLog.push({
        role: 'ai',
        qid: next ? next.id : active.qid,
        reflection: reflection || null,
        question: next ? (nextQuestionCopy || next.label) : null,
        fresh: true,
      });
      if (next) this.draft._meta.questionIdx = i + 1;
      this._commit();
      if (!next) this._setStage(4);
    } catch (e) {
      this.error = e.message;
      // Roll back the user turn so they can retry.
      this.draft._meta.chatLog.pop();
      this._commit();
    } finally {
      clearTimeout(this._busyTimer);
      this.busy = false; this.busyLabel = '';
      this._afterRender();
      // Strip the `fresh` flag on the next tick so the fade-in animation
      // only plays once per turn.
      setTimeout(() => {
        const log = this.draft._meta.chatLog;
        for (const t of log) if (t.fresh) delete t.fresh;
        this._commit();
      }, 600);
    }
  }

  // Rephrase the last AI turn — re-run the extract with the same user
  // answer and replace the reflection + question. Lets users get a
  // different angle if the first reflection didn't land.
  async _rephrase() {
    const log = this.draft._meta.chatLog || [];
    // Find the most recent user turn and the AI turn that follows it.
    let userIdx = -1;
    for (let i = log.length - 1; i >= 0; i--) if (log[i].role === 'user') { userIdx = i; break; }
    if (userIdx < 0 || userIdx + 1 >= log.length) return;
    const userTurn = log[userIdx];
    const aiTurn = log[userIdx + 1];

    const qIdx = QUESTIONS.findIndex(q => q.id === userTurn.qid);
    const next = QUESTIONS[qIdx + 1] || null;

    this.busy = true; this.busyLabel = 'Trying another angle';
    this.requestUpdate();
    try {
      const token = await this._token();
      if (!token) throw new Error('Not signed in.');
      const { tags, reflection, nextQuestionCopy } = await callOnboard(token, {
        mode: 'extract',
        questionId: userTurn.qid,
        answer: userTurn.text,
        nextQuestionLabel: next?.label || null,
      });
      this.draft._meta.extractions[userTurn.qid] = tags;
      // Replace the AI turn in place.
      aiTurn.reflection = reflection || null;
      aiTurn.question = next ? (nextQuestionCopy || next.label) : null;
      aiTurn.fresh = true;
      this._commit();
      setTimeout(() => { delete aiTurn.fresh; this._commit(); }, 600);
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
      this._afterRender();
    }
  }

  _applyExtraction(qid, tags) {
    if (qid === 'q1_mission') {
      this._mergeArr('values_seed.missionKeywords', tags.missionKeywords);
      this._mergeArr('values_seed.impactThemes', tags.impactThemes);
      this._mergeArr('targeting.targetSectors', tags.targetSectors);
    } else if (qid === 'q2_self') {
      this._mergeArr('values_seed.cultureKeywords', tags.cultureKeywords);
      this._mergeArr('capability.arcTags', tags.arcTags);
      if (tags.narrativeMd) this.draft.narratives.push({ title: tags.narrativeTitle || 'A time I felt myself', content_md: tags.narrativeMd, source_question: qid });
    } else if (qid === 'q3_win') {
      if (tags.headline) this.draft.wins.push({ headline: tags.headline, metric: tags.metric || null });
      if (tags.narrativeMd) this.draft.narratives.push({ title: tags.narrativeTitle || 'A win', content_md: tags.narrativeMd, source_question: qid });
    } else if (qid === 'q4_walkaway') {
      this._mergeArr('targeting.antiMissionTerms', tags.antiMissionTerms);
      this._mergeArr('values_seed.antiCulture', tags.antiCulture);
    } else if (qid === 'q5_titles') {
      this._mergeArr('targeting.targetRoles', tags.targetRoles);
      this._mergeArr('targeting.stagePreference', tags.stagePreference);
    }
    this._commit();
  }

  // Auto-scroll to bottom of chat after re-render.
  _afterRender() {
    const log = this.querySelector('.chat__log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  // Mid-flow attach handler. Reuses upload path; routes back to chat
  // afterwards with the same questionIdx so the user resumes where they were.
  async _handleAttach(fileList) {
    const idxBefore = this.draft._meta.questionIdx;
    const stageBefore = this.draft._meta.stage;
    await this._handleFiles(fileList);
    // _handleFiles set stage=2. If they were in chat, route them back.
    if (stageBefore === 3) {
      this.draft._meta.stage = 3;
      this.draft._meta.questionIdx = idxBefore;
      // Inject a synthetic AI turn acknowledging the attach.
      this.draft._meta.chatLog.push({
        role: 'ai',
        qid: this._activeQuestion()?.qid || QUESTIONS[idxBefore].id,
        reflection: 'Thanks — I pulled what I could from that. Picking back up:',
        question: this._activeQuestion()?.question || QUESTIONS[idxBefore].label,
      });
      this._commit();
    }
  }

  // -------- Stage 4: tailor --------

  async _finalize() {
    this.error = '';
    this.busy = true; this.busyLabel = this.demoMode ? 'Building demo preview…' : 'Saving your profile…';
    try {
      const token = await this._token();
      if (!token) throw new Error('Not signed in.');
      const { _meta, ...profile } = this.draft;
      const result = await callOnboard(token, { mode: 'finalize', profile, demo: this.demoMode });
      this.finalized = result;
      if (!this.demoMode && result.ok) {
        clearDraft();
        // Live mode: route to recommended.
        setTimeout(() => { window.location.href = '/job/jobs/recommended/'; }, 600);
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

  // ============================================================
  // Render
  // ============================================================

  render() {
    const stage = this.draft._meta.stage || 0;
    const showDebug = this.debugMode && stage > 0;
    return html`
      <div class="onboard">
        ${this._renderStepper(stage)}
        ${this.demoMode ? html`
          <div class="onboard__demo-banner">
            Demo mode — nothing you do here will overwrite your live profile.
          </div>` : nothing}
        ${this.error ? html`<div class="onboard__demo-banner" style="border-color: var(--error); background: rgba(168,32,13,0.10);">${this.error}</div>` : nothing}
        ${this.busy ? html`<div class="onboard__busy">${this.busyLabel}</div>` : nothing}
        ${stage === 0 ? this._renderPitch() : nothing}
        ${stage === 1 ? this._renderUpload() : nothing}
        ${stage === 2 ? this._renderInsights() : nothing}
        ${stage === 3 ? this._renderChat() : nothing}
        ${stage === 4 ? this._renderTailor() : nothing}
        ${showDebug ? this._renderDebug() : nothing}
      </div>
    `;
  }

  _renderStepper(stage) {
    return html`
      <div class="stepper">
        ${STAGES.map((s, i) => html`
          <span class="stepper__item ${s.id === stage ? 'stepper__item--current' : s.id < stage ? 'stepper__item--complete' : ''}">
            <span class="stepper__dot"></span>${s.label}
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
    const files = this.draft._meta.uploadedFiles || [];
    return html`
      <section class="onboard__stage">
        <h1>Drop in everything you've already got.</h1>
        <p class="lede">Resume is the headline. Cover letters, writing samples, LLM career docs, project descriptions, dream JDs — anything you've already written that shows your shape. We'll pull the bones from the resume and the voice from the rest.</p>
        <label class="dropzone dropzone--multi" for="resume-file"
               @dragover=${(e) => { e.preventDefault(); e.currentTarget.classList.add('dropzone--active'); }}
               @dragleave=${(e) => e.currentTarget.classList.remove('dropzone--active')}
               @drop=${(e) => { e.preventDefault(); e.currentTarget.classList.remove('dropzone--active'); this._handleFiles(e.dataTransfer.files); }}>
          <div class="dropzone__title">Drag in PDFs, .md, or .txt — or click to choose</div>
          <div class="dropzone__hint">Anything with "resume" or "cv" in the name is treated as the primary resume. The rest become voice/values context.</div>
          <input id="resume-file" type="file" multiple accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
                 style="display:none" @change=${(e) => this._handleFiles(e.target.files)}/>
          ${files.length ? html`
            <ul class="dropzone__files">
              ${files.map(f => html`<li><strong>${f.name}</strong> ${f.isResume ? html`<span class="chip chip--on" style="font-size:var(--font-size-caption);">resume</span>` : ''}</li>`)}
            </ul>` : nothing}
        </label>
        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._skipUpload()}>Skip — I'll start from scratch</button>
          <span></span>
        </div>
      </section>
    `;
  }

  _renderInsights() {
    const ins = this.draft.insights;
    const hasResume = (this.draft._meta.uploadedFiles || []).length > 0;
    if (!hasResume || !ins) {
      // Cold-start path — no upload, no insights.
      return html`
        <section class="onboard__stage">
          <h1>Let's start with the basics.</h1>
          <p class="lede">No upload, no problem. We'll get what we need from the next few questions.</p>
          <div class="onboard-card">
            <h2 class="onboard-card__title">Your name and city</h2>
            ${this._row('Name', 'identity.name', this.draft.identity.name)}
            ${this._row('Email', 'identity.email', this.draft.identity.email)}
            ${this._row('City', 'location.city', this.draft.location.city)}
          </div>
          <div class="onboard__nav">
            <button class="btn btn--ghost" @click=${() => this._setStage(1)}>Back</button>
            <button class="btn btn--primary" @click=${() => this._setStage(3)}>Continue</button>
          </div>
        </section>
      `;
    }
    return html`
      <section class="onboard__stage">
        <h1>Here's where your experience travels.</h1>
        <div class="insight-hero">${ins.hero || ''}</div>
        ${this._renderTrack('Domains you know', 'industries / verticals → adjacent verticals that hire you', ins.domains || [])}
        ${this._renderTrack('Work areas you\'ve shipped', 'problems and flows you\'ve actually built → what those ship into next', ins.workAreas || [])}
        ${this._renderTrack('Craft you bring', 'product / IC skills → role shapes this unlocks', ins.skills || [])}

        ${this._renderEditFooter()}

        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._setStage(1)}>Back</button>
          <button class="btn btn--primary" @click=${() => this._setStage(3)}>Looks right — keep going</button>
        </div>
      </section>
    `;
  }

  _renderTrack(title, sub, items) {
    if (!items.length) return nothing;
    return html`
      <div class="insight-track">
        <div class="insight-track__head">
          <h2>${title}</h2>
          <p class="onboard__hint">${sub}</p>
        </div>
        <ul class="insight-track__rows">
          ${items.map(it => html`
            <li>
              <span class="insight-track__have">${it.have}</span>
              <span class="insight-track__arrow">→</span>
              <span class="insight-track__to">
                ${(it.translatesTo || []).map(t => html`<span class="chip chip--on">${t}</span>`)}
              </span>
            </li>
          `)}
        </ul>
      </div>
    `;
  }

  _renderEditFooter() {
    const id = this.draft.identity || {};
    const loc = this.draft.location || {};
    const cap = this.draft.capability || {};
    const open = !!this.draft._meta.editOpen;
    const summary = [
      id.name || '—',
      loc.city || '—',
      `${(cap.history || []).length} roles`,
      `${(cap.skills || []).length} skills`,
    ].join(' · ');
    return html`
      <div class="insight-edit">
        <button class="insight-edit__toggle" @click=${() => this._toggleEdit()}>
          Got the basics right? <strong>${summary}</strong> · ${open ? 'close' : 'edit'}
        </button>
        ${open ? html`
          <div class="insight-edit__panel">
            ${this._row('Name', 'identity.name', id.name)}
            ${this._row('City', 'location.city', loc.city)}
            ${this._row('Email', 'identity.email', id.email)}
            ${this._row('LinkedIn', 'identity.linkedin', id.linkedin)}
            <div class="onboard__hint">Need to fix career or skills? Open <a href="/job/history/">Your career</a> after onboarding — it edits the same fields.</div>
          </div>
        ` : nothing}
      </div>
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

  // -------- Stage 3: chat (minimal, ChatGPT-inspired) --------
  //
  // Two states:
  //   - landing: no user turn yet → composer + first question centered
  //     vertically (ChatGPT empty-state pattern).
  //   - active:  any user turn exists → composer pinned bottom, log scrolls
  //     above it.

  _renderChat() {
    this._ensureChatSeeded();
    const log = this.draft._meta.chatLog || [];
    const hasUserTurn = log.some(t => t.role === 'user');
    const totalSlots = QUESTIONS.length;
    const answeredCount = Object.keys(this.draft._meta.answers || {}).length;
    // Current is the next unanswered slot (0-indexed). On the landing
    // state nothing is answered yet so current=0 ("1 of 5").
    const current = Math.min(totalSlots - 1, answeredCount);
    const dots = Array.from({ length: totalSlots }, (_, i) => {
      if (i < answeredCount) return 'is-done';
      if (i === current)     return 'is-current';
      return '';
    });

    return html`
      <section class="onboard__stage chat ${hasUserTurn ? 'chat--active' : 'chat--landing'}">
        <div class="chat__progress" aria-label="Question ${current + 1} of ${totalSlots}">
          <span class="chat__progress-dots">
            ${dots.map(cls => html`<span class=${cls}></span>`)}
          </span>
          <span>${current + 1} of ${totalSlots}</span>
        </div>

        <div class="chat__log">
          ${hasUserTurn
            ? log.map(turn => turn.role === 'ai' ? this._renderAiTurn(turn) : this._renderUserTurn(turn))
            : this._renderLandingHero(log)}
          ${this.busy && hasUserTurn ? html`
            <div class="chat__saving" role="status" aria-live="polite">
              <span class="chat__saving-dot"></span>
              <span class="chat__saving-label">${this.busyLabel || 'Saving…'}</span>
            </div>` : nothing}
        </div>

        <div class="chat__composer-wrap">
          <div class="chat__composer">
            <label for="chat-attach" class="chat__attach" title="Attach a resume or writing sample">+</label>
            <input id="chat-attach" type="file" multiple accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
                   style="display:none" @change=${(e) => this._handleAttach(e.target.files)}/>
            <textarea id="chat-input" rows="1" placeholder="Type your answer…"
                      autocomplete="off" autocorrect="off" spellcheck="true"
                      data-form-type="other"
                      @input=${(e) => this._autoSize(e.target)}
                      @keydown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); this._submitAnswer(); } }}></textarea>
            <button class="chat__send" ?disabled=${this.busy} @click=${() => this._submitAnswer()}
                    aria-label="Send">↑</button>
          </div>
          <div class="chat__composer-row">
            <div class="chat__composer-pills">
              ${hasUserTurn ? html`<button class="chat__pill" ?disabled=${this.busy} @click=${() => this._rephrase()} title="Re-ask this one a different way">Rephrase</button>` : nothing}
              <button class="chat__pill" ?disabled=${this.busy} @click=${() => this._submitAnswer({ skip: true })}>Skip</button>
            </div>
            <span class="chat__composer-hint">⌘+Enter to send</span>
          </div>
        </div>
      </section>
    `;
  }

  _renderLandingHero(log) {
    // Pre-first-turn: render the seeded question centered as the hero.
    const ai = log.find(t => t.role === 'ai');
    if (!ai) return nothing;
    return html`
      <div class="chat__hero">
        ${ai.reflection ? html`<p class="chat__ai-reflection">${unsafeHTML(tinyMd(ai.reflection))}</p>` : nothing}
        <p class="chat__hero-question">${unsafeHTML(tinyMd(ai.question || ''))}</p>
      </div>
    `;
  }

  _renderAiTurn(turn) {
    return html`
      <div class="chat__ai ${turn.fresh ? 'chat__ai--fresh' : ''}">
        ${turn.reflection ? html`<p class="chat__ai-reflection">${unsafeHTML(tinyMd(turn.reflection))}</p>` : nothing}
        ${turn.question ? html`<p class="chat__ai-question">${unsafeHTML(tinyMd(turn.question))}</p>` : nothing}
      </div>
    `;
  }
  _renderUserTurn(turn) {
    return html`<div class="chat__user">${turn.text}</div>`;
  }

  _autoSize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
  }

  updated() {
    this._afterRender();
    // Autofocus the input whenever the chat stage renders. Mobile-friendly:
    // helps the keyboard come up immediately on first arrival.
    if (this.draft._meta.stage === 3) {
      const ta = this.querySelector('#chat-input');
      if (ta && document.activeElement !== ta) {
        // Only focus on first mount of the stage to avoid stealing focus on
        // every re-render. Track via a data attr.
        if (!ta.dataset.autofocused) {
          ta.dataset.autofocused = '1';
          ta.focus();
        }
      }
    }
  }

  // -------- Stage 4: tailor --------

  _renderTailor() {
    const t = this.draft.targeting || {};
    const p = this.draft.preferences || {};
    const loc = this.draft.location || {};
    const c = this.draft.capability || {};
    const v = this.draft.values_seed || {};
    const ans = this.draft._meta.answers || {};
    return html`
      <section class="onboard__stage">
        <h1>How we'll tailor your search.</h1>
        <p class="lede">We've prepopulated this from your resume, your voice samples, and what you told us. Tweak anything that's off.</p>

        <div class="tailor-group">
          <div class="tailor-group__head">
            <h2>What you're looking for</h2>
            ${ans.q5_titles ? html`<p class="tailor-group__excerpt">You said: "${this._truncate(ans.q5_titles, 160)}"</p>` : ''}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Target roles</span>
            ${this._chipList(t.targetRoles || [], 'targeting.targetRoles')}
            ${this._chipAdd('Add a role…', (val) => { if (!(t.targetRoles || []).includes(val)) this._toggleInArr('targeting.targetRoles', val); })}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Target sectors</span>
            ${this._palette(SECTORS_PALETTE, t.targetSectors || [], 'targeting.targetSectors')}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Stage</span>
            ${this._palette(STAGE_PALETTE, t.stagePreference || [], 'targeting.stagePreference')}
          </div>
        </div>

        <div class="tailor-group">
          <div class="tailor-group__head">
            <h2>What you bring</h2>
            ${ans.q2_self ? html`<p class="tailor-group__excerpt">You said: "${this._truncate(ans.q2_self, 160)}"</p>` : ''}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Arc</span>
            ${this._palette(ARC_PALETTE, c.arcTags || [], 'capability.arcTags')}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Past sectors</span>
            <div class="chip-row">
              ${(c.pastSectors || []).map(s => html`<span class="chip chip--editable chip--on">${s}<button @click=${() => this._toggleInArr('capability.pastSectors', s)}>×</button></span>`)}
            </div>
            ${this._chipAdd('Add a sector…', (val) => this._toggleInArr('capability.pastSectors', val))}
          </div>
        </div>

        <div class="tailor-group">
          <div class="tailor-group__head">
            <h2>Where & when</h2>
            <p class="tailor-group__excerpt">Based in ${loc.city || '—'}${loc.region ? `, ${loc.region}` : ''}${loc.country ? ` · ${loc.country}` : ''}</p>
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Remote</span>
            <div class="segmented">
              ${['remote', 'hybrid', 'onsite', 'any'].map(opt => html`
                <button aria-pressed=${(p.remotePreference || 'any') === opt ? 'true' : 'false'}
                        @click=${() => { this._patch('preferences.remotePreference', opt); this._patch('location.remotePreference', opt); }}>${opt}</button>
              `)}
            </div>
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Willing to relocate</span>
            <div class="chip-row">
              ${(loc.willingToRelocate || []).map(s => html`<span class="chip chip--editable chip--on">${s}<button @click=${() => this._toggleInArr('location.willingToRelocate', s)}>×</button></span>`)}
            </div>
            ${this._chipAdd('Add a city or region…', (val) => this._toggleInArr('location.willingToRelocate', val))}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Comp floor</span>
            <input type="range" min="0" max="400000" step="5000"
                   .value=${String(p.compFloor ?? 150000)}
                   @input=${(e) => this._patch('preferences.compFloor', Number(e.target.value))}/>
            <span class="onboard__hint">$${(p.compFloor ?? 150000).toLocaleString()} minimum base</span>
          </div>
        </div>

        <div class="tailor-group">
          <div class="tailor-group__head">
            <h2>Hard limits</h2>
            ${ans.q4_walkaway ? html`<p class="tailor-group__excerpt">You said: "${this._truncate(ans.q4_walkaway, 160)}"</p>` : ''}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Dealbreakers</span>
            ${this._palette(DEALBREAKER_PALETTE, t.antiMissionTerms || [], 'targeting.antiMissionTerms')}
          </div>
          <div class="tailor-group__field">
            <span class="tailor-group__label">Work auth</span>
            ${this._palette(WORK_AUTH_PALETTE, loc.workAuth || [], 'location.workAuth')}
          </div>
          <div class="tailor-group__field">
            <label style="display:flex;gap:var(--space-3);align-items:center;cursor:pointer;">
              <input type="checkbox" .checked=${!!p.missionRequired}
                     @change=${(e) => { this._patch('preferences.missionRequired', e.target.checked); this._patch('targeting.missionRequired', e.target.checked); }}/>
              <span>Mission alignment is a hard requirement</span>
            </label>
          </div>
        </div>

        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._setStage(3)}>Back to questions</button>
          <button class="btn btn--primary" ?disabled=${this.busy} @click=${() => this._finalize()}>
            ${this.demoMode ? 'Show me what we\'d save' : 'Save and start hunting'}
          </button>
        </div>

        ${this.finalized && this.demoMode ? html`
          <div class="onboard-card" style="margin-top:var(--space-4);">
            <h2 class="onboard-card__title">Demo preview</h2>
            <p class="onboard__hint">Nothing was written. This is what would have committed.</p>
            <div class="onboard-preview"><pre>${JSON.stringify(this.finalized.preview?.wouldWrite || this.finalized, null, 2)}</pre></div>
          </div>` : nothing}
      </section>
    `;
  }

  _truncate(s, n) { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }

  _chipList(items, path) {
    if (!items.length) return html`<span class="onboard__hint">No targets yet.</span>`;
    return html`<div class="chip-row">
      ${items.map(s => html`<span class="chip chip--editable chip--on">${s}<button @click=${() => this._toggleInArr(path, s)}>×</button></span>`)}
    </div>`;
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
            <span class="chip chip--editable chip--on">${opt}<button @click=${() => this._toggleInArr(path, opt)}>×</button></span>
          `)}
        </div>
        ${this._chipAdd('Add custom…', (v) => { if (!sel.has(v)) this._toggleInArr(path, v); })}
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

  _renderDebug() {
    const { _meta, ...profile } = this.draft;
    return html`
      <section class="onboard-card" style="margin-top:var(--space-6);">
        <h2 class="onboard-card__title">Debug — staged profile (live JSON)</h2>
        <p class="onboard__hint">Only visible with <code>?debug=1</code>.</p>
        <div class="onboard-preview"><pre>${JSON.stringify(profile, null, 2)}</pre></div>
      </section>
    `;
  }
}

customElements.define('job-onboarding', JobOnboarding);
