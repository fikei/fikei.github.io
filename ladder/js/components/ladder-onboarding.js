// job-onboarding — five-stage onboarding for /ladder.
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
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
const ONBOARD_FN_URL = `${SUPABASE_URL}/functions/v1/onboard`;
const DRAFT_KEY = 'job:onboarding:draft';

const STAGES = [
  { id: 0, label: 'Welcome' },
  { id: 1, label: 'Upload' },
  { id: 2, label: 'Insights' },
  { id: 3, label: 'Questions' },
  { id: 4, label: 'Tailor' },
];

// Conversational defaults. Haiku rewrites these in the moment so each
// question flows from the prior answer — see modeExtract in the onboard
// edge function. Intent stays fixed; wording can drift.
//
// Ordering follows apt's warm-up → stories → boundaries → specifics arc:
//   1. intent      — why are you here (gentle opener)
//   2. mission     — what's pulling at you (taste)
//   3. energy      — how you recharge (personality)
//   4. self        — felt most yourself (story)
//   5. win         — proud-of moment (story + number)
//   6. aspiration  — zero-constraint role (the real wish)
//   7. walkaway    — would-pass criteria (boundary)
//   8. hardyes     — non-negotiables (boundary)
//   9. titles      — next-role specifics
const QUESTIONS = [
  { id: 'q_intent',
    label: 'What\'s bringing you here — actively looking, just exploring, or somewhere in between?',
    placeholder: 'No wrong answer. Casual is fine.' },
  { id: 'q1_mission',
    label: 'What kind of work has been pulling at you lately?',
    placeholder: 'A problem you keep thinking about, a kind of team you want to be on…' },
  { id: 'q_energy',
    label: 'When you\'ve had a long week, do you recharge around people or with time to yourself?',
    placeholder: 'How you reset says a lot about how you work.' },
  { id: 'q2_self',
    label: 'Tell me about a stretch of work where you felt most yourself.',
    placeholder: 'A team, a project, a few months — when did the work feel right?' },
  { id: 'q3_win',
    label: 'Something you\'re still kind of proud of — bonus points if there\'s a number attached.',
    placeholder: 'A result, a launch, a shift you made happen…' },
  { id: 'q_aspiration',
    label: 'If there were zero constraints — no hiring filters, no practicality — what\'s the role you\'d love to try just for the sake of it?',
    placeholder: 'The role you\'d try if no one was watching.' },
  { id: 'q4_walkaway',
    label: 'What kind of company or team would make you pass — even on a great role?',
    placeholder: 'Industries, leadership styles, working cultures you\'d want to avoid…' },
  { id: 'q_hardyes',
    label: 'Two or three things that would feel non-negotiable for you to say yes to a role?',
    placeholder: 'The must-haves. Where you\'d walk if they weren\'t there.' },
  { id: 'q5_titles',
    label: 'What does the role you\'d love to be in next actually look like, day to day?',
    placeholder: 'Title aside — who are you working with, what are you spending your time on?' },
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
      // chatLog: ordered list of turns.
      //   { role: 'ai',   qid, content: string, fresh?: true }
      //   { role: 'user', qid, text: string }
      // The latest AI turn carries the active question. Seeded lazily.
      chatLog: [],
      // followupDepth[qid] tracks how many deeper follow-ups have been
      // asked on this slot before the next-canonical advance. Cap = 1.
      followupDepth: {},
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

// Call the onboard edge function. Picks the right Authorization header:
// signed-in user's access token if available; otherwise the anon key. The
// edge fn accepts anon for parse/bundle/insights/extract (Haiku-only) and
// requires a real user only for finalize.
async function callOnboard(body) {
  let token = SUPABASE_ANON_KEY;
  try {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data?.session?.access_token) token = data.session.access_token;
    }
  } catch { /* fall back to anon */ }
  const res = await fetch(ONBOARD_FN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`onboard ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}
// Returns true when a real user session is present (not just anon key).
async function hasUserSession() {
  try {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    if (!sb) return false;
    const { data } = await sb.auth.getSession();
    return !!data?.session?.access_token;
  } catch { return false; }
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
    // When the user finishes the sign-in modal (popped by _finalize), the
    // ctrl:auth:signedin event fires; auto-resume the commit.
    this._onSignedIn = () => {
      if (this.draft?._meta?.pendingFinalize) {
        setTimeout(() => this._finalize(), 300);
      }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('ctrl:auth:signedin', this._onSignedIn);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onSignedIn);
    super.disconnectedCallback();
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

  // -------- Stage 1: resume upload (single file) --------
  //
  // The resume is the bones — we always parse it first and generate insights
  // from it alone. Supporting docs are layered on AFTER the insight card
  // renders, via _handleSupportingUpload (called from Stage 2).

  async _handleResumeUpload(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    this.error = '';
    this.busy = true; this.busyLabel = 'Reading your resume';
    try {
      // Prefer the largest file as the resume if multiple were dropped;
      // fallback to the only file. Anything else gets ignored here — the
      // supporting-docs uploader on Stage 2 picks up additional files.
      const named = [];
      for (const f of files) {
        const text = await readFileAsText(f);
        named.push({ name: f.name, size: text.length, text });
      }
      const resume = named.slice().sort((a, b) => b.size - a.size)[0];
      this.draft._meta.uploadedFiles = [{ name: resume.name, size: resume.size, isResume: true }];
      this._commit();

      this.busyLabel = 'Pulling out the bones';
      const parseRes = await callOnboard({ mode: 'parse', text: resume.text });
      const draftIncoming = parseRes.draft || {};

      this.draft.identity = { ...this.draft.identity, ...draftIncoming.identity };
      this.draft.location = { ...this.draft.location, ...draftIncoming.location };
      if (draftIncoming.capability) {
        this.draft.capability.skills      = draftIncoming.capability.skills      || this.draft.capability.skills;
        this.draft.capability.pastSectors = draftIncoming.capability.pastSectors || this.draft.capability.pastSectors;
        this.draft.capability.arcTags     = draftIncoming.capability.arcTags     || this.draft.capability.arcTags;
        this.draft.capability.history     = draftIncoming.capability.history     || this.draft.capability.history;
      }

      // Generate insights from resume alone — the celebration card.
      this.busyLabel = 'Mapping where this experience travels';
      const profileForInsights = {
        identity: this.draft.identity,
        location: this.draft.location,
        capability: this.draft.capability,
      };
      const insightsRes = await callOnboard({ mode: 'insights', profile: profileForInsights });
      this.draft.insights = insightsRes.insights || null;

      this._setStage(2);
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
    }
  }

  // -------- Stage 2: supporting-docs upload (optional, layered on top) --------
  //
  // Runs bundle on the new docs to extract voice + values + dream signals,
  // merges into the existing draft, then regenerates the insight card so
  // the user sees the depth grow.

  async _handleSupportingUpload(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    this.error = '';
    this.busy = true; this.busyLabel = `Reading ${files.length} more file${files.length > 1 ? 's' : ''}`;
    try {
      const named = [];
      for (const f of files) {
        const text = await readFileAsText(f);
        named.push({ name: f.name, size: text.length, text });
      }
      // Track these as additional uploaded files (resume stays flagged).
      const meta = this.draft._meta.uploadedFiles || [];
      this.draft._meta.uploadedFiles = [
        ...meta,
        ...named.map(f => ({ name: f.name, size: f.size, isResume: false })),
      ];
      this._commit();

      this.busyLabel = 'Listening for the voice';
      const bundleText = named.map(f => `--- ${f.name} ---\n${f.text}`).join('\n\n');
      const bundleRes = await callOnboard({ mode: 'bundle', text: bundleText });
      const bundle = bundleRes.bundle || {};

      // Merge into draft.bundle (concat-merge for arrays).
      const cur = this.draft.bundle || {};
      this.draft.bundle = {
        voiceSample: bundle.voiceSample || cur.voiceSample || '',
        values:            [...new Set([...(cur.values || []),            ...(bundle.values || [])])],
        projects:          [...(cur.projects || []), ...(bundle.projects || [])],
        dreamRoleSignals:  [...new Set([...(cur.dreamRoleSignals || []),  ...(bundle.dreamRoleSignals || [])])],
        wins:              [...(cur.wins || []),     ...(bundle.wins || [])],
      };
      this._mergeArr('values_seed.cultureKeywords', bundle.values);
      this._mergeArr('targeting.targetRoles',        bundle.dreamRoleSignals);
      if (Array.isArray(bundle.wins)) for (const w of bundle.wins) this.draft.wins.push(w);

      // Regenerate insights with the deeper context — the celebration card
      // grows as the user gives us more material.
      this.busyLabel = 'Re-mapping with the deeper read';
      const profileForInsights = {
        identity: this.draft.identity,
        location: this.draft.location,
        capability: this.draft.capability,
        bundle: this.draft.bundle,
      };
      const insightsRes = await callOnboard({ mode: 'insights', profile: profileForInsights });
      if (insightsRes.insights) this.draft.insights = insightsRes.insights;
      this._commit();
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
    }
  }

  async _skipUpload() {
    // Manual start — no insights to show; the cold-start branch of
    // _renderInsights handles the no-resume case.
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
      // First turn has no prior answer to acknowledge — just the question,
      // bolded so it carries weight on the hero.
      this.draft._meta.chatLog.push({
        role: 'ai',
        qid: QUESTIONS[0].id,
        content: `**${QUESTIONS[0].label}**`,
      });
      this.draft._meta.questionIdx = 0;
      this._commit();
    }
  }

  // The active question is the most recent AI turn's qid.
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
          content: next ? `Got it — let's switch gears. **${next.label}**` : 'Got it — let\'s wrap up.',
          fresh: true,
        });
        if (next) this.draft._meta.questionIdx = i + 1;
        this._commit();
        if (!next) this._setStage(4);
        return;
      }

      const depthSpent = (this.draft._meta.followupDepth?.[active.qid]) || 0;
      const { tags, content, goDeeper } = await callOnboard({
        mode: 'extract',
        questionId: active.qid,
        answer: userText,
        nextQuestionLabel: next?.label || null,
        priorTurns: this._priorTurnsForExtract(),
        depthSpent,
      });
      this.draft._meta.extractions[active.qid] = tags;
      if (tags) this._applyExtraction(active.qid, tags);

      // Two branches:
      //   goDeeper=true → stay on the same qid; the AI's bolded question
      //                   is a follow-up probe of the same theme. Increment
      //                   followupDepth so the next extract is forced to
      //                   advance.
      //   goDeeper=false → advance to the next canonical question.
      if (goDeeper && depthSpent < 1) {
        this.draft._meta.followupDepth = this.draft._meta.followupDepth || {};
        this.draft._meta.followupDepth[active.qid] = depthSpent + 1;
        this.draft._meta.chatLog.push({
          role: 'ai',
          qid: active.qid,             // stays on this slot
          content: content || null,
          fresh: true,
        });
      } else {
        this.draft._meta.chatLog.push({
          role: 'ai',
          qid: next ? next.id : active.qid,
          content: content || (next ? `**${next.label}**` : null),
          fresh: true,
        });
        if (next) this.draft._meta.questionIdx = i + 1;
      }
      this._commit();
      const advanced = !(goDeeper && depthSpent < 1);
      if (advanced && !next) this._setStage(4);
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
      // Rephrase replays the same slot; force-advance budget so the new
      // turn isn't an even-deeper rabbit hole. We just want a different
      // angle on the existing reflection.
      const { tags, content } = await callOnboard({
        mode: 'extract',
        questionId: userTurn.qid,
        answer: userTurn.text,
        nextQuestionLabel: next?.label || null,
        priorTurns: this._priorTurnsForExtract(),
        depthSpent: 1,
      });
      this.draft._meta.extractions[userTurn.qid] = tags;
      // Replace the AI turn in place.
      aiTurn.content = content || (next ? `**${next.label}**` : null);
      delete aiTurn.reflection;
      delete aiTurn.question;
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
    if (qid === 'q_intent') {
      if (tags.intent) this._patch('targeting.intent', tags.intent);
    } else if (qid === 'q1_mission') {
      this._mergeArr('values_seed.missionKeywords', tags.missionKeywords);
      this._mergeArr('values_seed.impactThemes', tags.impactThemes);
      this._mergeArr('targeting.targetSectors', tags.targetSectors);
    } else if (qid === 'q_energy') {
      if (tags.energyStyle) this._patch('values_seed.energyStyle', tags.energyStyle);
      this._mergeArr('values_seed.cultureKeywords', tags.cultureKeywords);
    } else if (qid === 'q2_self') {
      this._mergeArr('values_seed.cultureKeywords', tags.cultureKeywords);
      this._mergeArr('capability.arcTags', tags.arcTags);
      if (tags.narrativeMd) this.draft.narratives.push({ title: tags.narrativeTitle || 'A time I felt myself', content_md: tags.narrativeMd, source_question: qid });
    } else if (qid === 'q3_win') {
      if (tags.headline) this.draft.wins.push({ headline: tags.headline, metric: tags.metric || null });
      if (tags.narrativeMd) this.draft.narratives.push({ title: tags.narrativeTitle || 'A win', content_md: tags.narrativeMd, source_question: qid });
    } else if (qid === 'q_aspiration') {
      this._mergeArr('targeting.dreamRoles', tags.dreamRoles);
      this._mergeArr('values_seed.aspirationalSignals', tags.aspirationalSignals);
    } else if (qid === 'q4_walkaway') {
      this._mergeArr('targeting.antiMissionTerms', tags.antiMissionTerms);
      this._mergeArr('values_seed.antiCulture', tags.antiCulture);
    } else if (qid === 'q_hardyes') {
      this._mergeArr('targeting.hardYes', tags.hardYes);
    } else if (qid === 'q5_titles') {
      this._mergeArr('targeting.targetRoles', tags.targetRoles);
      this._mergeArr('targeting.stagePreference', tags.stagePreference);
    }
    this._commit();
  }

  // Build the priorTurns array Haiku uses for quote-back. Pull the last few
  // {question, answer} pairs from the chat log.
  _priorTurnsForExtract() {
    const log = this.draft._meta.chatLog || [];
    const out = [];
    for (let i = 0; i < log.length; i++) {
      const turn = log[i];
      if (turn.role !== 'ai') continue;
      // Strip markdown from the question text we send up.
      const question = (turn.content || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
      const next = log[i + 1];
      if (next && next.role === 'user' && next.text) {
        out.push({ q: question.slice(0, 240), a: next.text.slice(0, 600) });
      }
    }
    return out.slice(-5);
  }

  // Auto-scroll to bottom of chat after re-render.
  _afterRender() {
    const log = this.querySelector('.chat__log');
    if (log) log.scrollTop = log.scrollHeight;
  }

  // Mid-flow attach handler — treats new files as supporting docs (resume
  // is already parsed by now). Bundle pass + insights refresh; routes back
  // to chat afterwards with the same questionIdx so the user resumes.
  async _handleAttach(fileList) {
    const idxBefore = this.draft._meta.questionIdx;
    await this._handleSupportingUpload(fileList);
    // Stay on the chat stage; inject a soft AI ack of the attach.
    const resumeQ = QUESTIONS[idxBefore] || QUESTIONS[0];
    this.draft._meta.chatLog.push({
      role: 'ai',
      qid: resumeQ.id,
      content: `Thanks — I pulled what I could from that. Picking back up: **${resumeQ.label}**`,
    });
    this._commit();
  }

  // -------- Stage 4: tailor --------

  async _finalize() {
    this.error = '';
    // Live mode requires a signed-in user (finalize writes to user_profile).
    // Demo mode commits to nothing and works pre-auth.
    if (!this.demoMode) {
      const signedIn = await hasUserSession();
      if (!signedIn) {
        // Stash a pending-finalize flag so _onSignedIn can resume the
        // commit automatically when the user comes back from sign-in.
        this.draft._meta.pendingFinalize = true;
        this._commit();
        this.busyLabel = 'One last thing — sign in to save your profile.';
        this.busy = true;
        this.requestUpdate();
        try { window.CtrlAuth.openLoginModal(); }
        catch { this.error = 'Sign-in is unavailable right now. Try refreshing.'; this.busy = false; }
        return;
      }
    }
    this.busy = true; this.busyLabel = this.demoMode ? 'Building demo preview' : 'Saving your profile';
    try {
      const { _meta, ...profile } = this.draft;
      const result = await callOnboard({ mode: 'finalize', profile, demo: this.demoMode });
      this.finalized = result;
      if (!this.demoMode && result.ok) {
        delete this.draft._meta.pendingFinalize;
        // Live-finalize success → don't route immediately. Show the
        // optional "deeper" continuation prompt; user picks "add one more
        // story" or "send me in" and we route either way.
        this.draft._meta.stage = 5;
        this._commit();
      }
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false; this.busyLabel = '';
    }
  }

  // Persist the deeper story as a narrative + re-finalize so the new
  // entry lands in user_profile. Then route to recommended.
  async _saveDeeperStoryAndRoute(prompt, answer) {
    this.error = '';
    this.busy = true; this.busyLabel = 'Adding that to your profile';
    try {
      if (answer && answer.trim()) {
        this.draft.narratives.push({
          title: prompt.label.slice(0, 60),
          content_md: answer.trim(),
          source_question: prompt.id,
        });
        const { _meta, ...profile } = this.draft;
        await callOnboard({ mode: 'finalize', profile, demo: false });
      }
      clearDraft();
      window.location.href = '/ladder/jobs/recommended/';
    } catch (e) {
      this.error = e.message;
      this.busy = false; this.busyLabel = '';
    }
  }

  _skipDeeperAndRoute() {
    clearDraft();
    window.location.href = '/ladder/jobs/recommended/';
  }

  // -------- Stage 5: post-finalize continuation --------
  //
  // After live-finalize succeeds we land here. Optional: pick one of a
  // short list of deeper story prompts (or skip). What the user types
  // gets saved as a narrative + re-finalized before we route them to
  // /ladder/jobs/recommended/.

  _deeperPrompts() {
    return [
      { id: 'q_deeper_mind',
        label: 'Tell me about a time you changed your mind about something important at work.',
        placeholder: 'What you used to think, what changed it, what you think now.' },
      { id: 'q_deeper_least_proud',
        label: 'A piece of work you\'re least proud of — what did it teach you?',
        placeholder: 'No need to be performative. The lesson is what we want.' },
      { id: 'q_deeper_feedback',
        label: 'A piece of feedback that landed and stuck. From who, about what.',
        placeholder: 'Real critique, not flattery.' },
    ];
  }

  _renderDeeper() {
    const prompts = this._deeperPrompts();
    const chosenId = this.draft._meta.deeperChosen;
    const chosen = prompts.find(p => p.id === chosenId);
    return html`
      <section class="onboard__stage">
        <h1>You're in.</h1>
        <p class="lede">Profile saved. Before I send you in — one optional story makes the cover-letter writing meaningfully better. Pick one, or skip and head to your recs.</p>

        ${chosen ? html`
          <div class="chat__ai" style="align-self:flex-start;">
            <p class="chat__ai-turn"><strong>${chosen.label}</strong></p>
          </div>
          <div class="dropzone" style="border:none;background:transparent;padding:0;">
            <textarea id="deeper-input" rows="4" placeholder=${chosen.placeholder}
                      style="width:100%;padding:var(--space-3) var(--space-4);border:1px solid var(--border);border-radius:24px;background:var(--bg);color:var(--fg);font:inherit;line-height:var(--lh-body);resize:vertical;"></textarea>
          </div>
          <div class="onboard__nav">
            <button class="btn btn--ghost" @click=${() => { this.draft._meta.deeperChosen = null; this._commit(); }}>Pick a different one</button>
            <span>
              <button class="btn btn--ghost" @click=${() => this._skipDeeperAndRoute()}>Skip — send me in</button>
              <button class="btn btn--primary" ?disabled=${this.busy} @click=${() => {
                const ta = this.querySelector('#deeper-input');
                this._saveDeeperStoryAndRoute(chosen, ta?.value || '');
              }}>Save and send me in</button>
            </span>
          </div>
        ` : html`
          <ul class="deeper-prompt-list">
            ${prompts.map(p => html`
              <li>
                <button class="deeper-prompt" @click=${() => { this.draft._meta.deeperChosen = p.id; this._commit(); }}>
                  ${p.label}
                </button>
              </li>
            `)}
          </ul>
          <div class="onboard__nav">
            <span></span>
            <button class="btn btn--ghost" @click=${() => this._skipDeeperAndRoute()}>Skip — send me in</button>
          </div>
        `}
      </section>
    `;
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
        ${stage === 5 ? this._renderDeeper() : nothing}
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
      <section class="onboard__stage onboard__stage--welcome">
        <h1>Your career operating system.</h1>
        <p class="lede">Upload what you've already written, answer a few open questions, and we'll start pulling roles that match what you actually want — and draft the cover letters too.</p>
        <p class="onboard__hint">Takes about 8 minutes. You can leave and come back; we'll save where you left off.</p>
        <div class="onboard__nav onboard__nav--welcome">
          <button class="btn onboard__btn-signin" @click=${() => this._openSignIn()}>
            Have an account? <strong>Sign in</strong>
          </button>
          <button class="btn btn--primary" @click=${() => this._setStage(1)}>Get started</button>
        </div>
      </section>
    `;
  }

  // Open the sign-in modal directly. Existing users with a completed
  // profile will be auto-redirected to /ladder/jobs/recommended/ by
  // applySignedInState in app.js once the session lands.
  _openSignIn() {
    try { window.CtrlAuth.openLoginModal(); }
    catch { this.error = 'Sign-in is unavailable right now. Try refreshing.'; }
  }

  _renderUpload() {
    const files = this.draft._meta.uploadedFiles || [];
    return html`
      <section class="onboard__stage">
        <h1>Start with your resume.</h1>
        <p class="lede">We'll pull the bones — companies, titles, skills, where you've been — and use them to ask better questions. You can layer in other docs next.</p>
        <label class="dropzone dropzone--multi" for="resume-file"
               @dragover=${(e) => { e.preventDefault(); e.currentTarget.classList.add('dropzone--active'); }}
               @dragleave=${(e) => e.currentTarget.classList.remove('dropzone--active')}
               @drop=${(e) => { e.preventDefault(); e.currentTarget.classList.remove('dropzone--active'); this._handleResumeUpload(e.dataTransfer.files); }}>
          <div class="dropzone__title">Drop your resume — PDF, .md, or .txt</div>
          <div class="dropzone__hint">Or click to choose. One file is plenty here.</div>
          <input id="resume-file" type="file" accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
                 style="display:none" @change=${(e) => this._handleResumeUpload(e.target.files)}/>
          ${files.length ? html`
            <ul class="dropzone__files">
              ${files.map(f => html`<li><strong>${f.name}</strong></li>`)}
            </ul>` : nothing}
        </label>
        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._skipUpload()}>Skip — I'll start from scratch</button>
          <span></span>
        </div>
      </section>
    `;
  }

  // Bulleted list of high-value supporting-doc examples. Rendered inside
  // the insight stage to invite a deeper read.
  _supportingDocExamples() {
    return [
      { label: 'A past cover letter you liked',           uses: 'seeds the voice your cover-letter agent will write in' },
      { label: 'Writing samples — Substack, internal memos, anything in your voice', uses: 'pulls voice + thinking patterns' },
      { label: 'A performance review you held onto',      uses: 'third-party language about your strengths' },
      { label: 'Project case studies or decks',           uses: 'depth on specific wins beyond resume bullets' },
      { label: 'Dream JDs you\'ve bookmarked',            uses: 'reverse-engineers what you actually want' },
      { label: 'A LinkedIn About blurb or short bio',     uses: 'how you already position yourself' },
    ];
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
        ${this._renderSupportingDocsCard()}

        <div class="onboard__nav">
          <button class="btn btn--ghost" @click=${() => this._setStage(1)}>Back</button>
          <button class="btn btn--primary" @click=${() => this._setStage(3)}>Looks right — keep going</button>
        </div>
      </section>
    `;
  }

  // Supporting-docs card — invites the user to deepen the read after they've
  // seen the resume-only insight. Bulleted examples make the ask concrete.
  _renderSupportingDocsCard() {
    const meta = this.draft._meta.uploadedFiles || [];
    const supporting = meta.filter(f => !f.isResume);
    return html`
      <div class="insight-deepen">
        <h2 class="insight-deepen__title">Want me to go deeper?</h2>
        <p class="insight-deepen__lede">Resume tells me what you've done. Drop in anything else you've written and I can read for voice, taste, and the texture between the lines.</p>
        <ul class="insight-deepen__examples">
          ${this._supportingDocExamples().map(ex => html`
            <li>
              <span class="insight-deepen__example-label">${ex.label}</span>
              <span class="insight-deepen__example-use">${ex.uses}</span>
            </li>
          `)}
        </ul>
        <label class="dropzone dropzone--multi dropzone--compact" for="supporting-files"
               @dragover=${(e) => { e.preventDefault(); e.currentTarget.classList.add('dropzone--active'); }}
               @dragleave=${(e) => e.currentTarget.classList.remove('dropzone--active')}
               @drop=${(e) => { e.preventDefault(); e.currentTarget.classList.remove('dropzone--active'); this._handleSupportingUpload(e.dataTransfer.files); }}>
          <div class="dropzone__title">Drop one or more — PDF, .md, .txt</div>
          <div class="dropzone__hint">Or click to choose. I'll re-read everything and refresh the insight above.</div>
          <input id="supporting-files" type="file" multiple accept=".pdf,.md,.txt,application/pdf,text/markdown,text/plain"
                 style="display:none" @change=${(e) => this._handleSupportingUpload(e.target.files)}/>
          ${supporting.length ? html`
            <ul class="dropzone__files">
              ${supporting.map(f => html`<li><strong>${f.name}</strong></li>`)}
            </ul>` : nothing}
        </label>
        <p class="onboard__hint">Totally optional — keep going if you'd rather skip.</p>
      </div>
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
            <div class="onboard__hint">Need to fix career or skills? Open <a href="/ladder/history/">Your career</a> after onboarding — it edits the same fields.</div>
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
        <p class="chat__hero-question">${unsafeHTML(tinyMd(ai.content || ai.question || ''))}</p>
      </div>
    `;
  }

  _renderAiTurn(turn) {
    // Prefer the combined block (new schema). Fall back to the legacy
    // reflection + question pair so old localStorage drafts still render.
    const content = turn.content || [turn.reflection, turn.question ? `**${turn.question}**` : ''].filter(Boolean).join(' ');
    return html`
      <div class="chat__ai ${turn.fresh ? 'chat__ai--fresh' : ''}">
        <p class="chat__ai-turn">${unsafeHTML(tinyMd(content))}</p>
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

customElements.define('ladder-onboarding', JobOnboarding);
