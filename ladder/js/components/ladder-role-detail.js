// job-role-detail — per-role detail page with Details / Resume / Cover Letter
// tabs. The Details tab is the default landing and shows AI-generated cards
// (Why it fits / Risks / Candidate strength) plus role metadata. Apply button
// in the top-right opens the posting in a new tab.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';

// Lazy-loaded turndown — only imported when the user enters edit mode the
// first time. Used to roundtrip the contenteditable HTML back to markdown
// on save so we preserve the same on-disk format we render from.
let _turndown = null;
async function getTurndown() {
  if (_turndown) return _turndown;
  const mod = await import('https://esm.run/turndown@7');
  const T = mod.default || mod.Turndown || mod;
  const td = new T({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '_' });
  // Strip diff/highlight wrappers if any survive (they shouldn't — we
  // render plain markdown into edit mode — but belt-and-braces).
  td.addRule('stripDiff', {
    filter: ['mark', 'ins', 'del', 'sup'],
    replacement: (content) => content,
  });
  _turndown = td;
  return td;
}
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { generateAsset, fetchPipeline, readRolePrefill, fetchCoverRationale, applyCoverEdit, addNarrative, engageRole, rescoreRole, updateRole, applyEaseInfo }, { readRoleAsset, writeRoleAsset }, { logoSrc, logoInitial }, { diffMarkdown, highlightPhrases, applyAIHighlights }, { renderFitCardBody, renderCandidateCardBody }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../roleAsset.js' + V),
  import('../logo.js' + V),
  import('../diff.js' + V),
  import('./ladder-fit-modal.js' + V),
]);

const BASE_RESUME_SLUG = '__base__';

const TABS = [
  { id: 'details',      label: 'Role details' },
  { id: 'activity',     label: 'Activity' },
  { id: 'resume',       label: 'Resume' },
  { id: 'cover-letter', label: 'Cover letter' },
];

const KIND_BY_TAB = {
  details: 'analysis',
  activity: null,                  // Activity tab has no role_asset; fetched live.
  resume: 'resume',
  'cover-letter': 'cover-letter',
};

const { listEvents, ackEvent: ackApplicationEvent, eventTypeLabel,
        resolveEvent: resolveApplicationEvent, undoEvent: undoApplicationEvent } = await import('../applicationEvents.js' + V);
// Side-effect import — registers the <ladder-apply> custom element used by the
// "Apply with /ladder" launch button below.
await import('./ladder-apply.js' + V);

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
    baseResume: { state: true },     // { content } | null — canonical untargeted resume, source of truth for diff
    showChanges: { state: true },    // bool — toggle the diff/highlight overlay on resume + cover tabs
    coverRationale: { state: true }, // { sig, highlights, opportunities, loading, error } — AI cover-letter rationale cache
    activeRationale: { state: true }, // number | null — currently focused comment/highlight pair
    threads: { state: true },         // { [commentId]: { messages: [...], sending, error } } — chat-to-edit per comment
    coverUndo: { state: true },       // { content, label, expiresAt } | null — one-shot undo for last AI edit
    editingAnchor: { state: true },   // { kind: 'comment'|'selection', commentId?, phrase, instruction? } | null
    selectionPopover: { state: true },// { visible, x, y, text, savedRange } | null — floating "edit selection" UI
    coverHistory: { state: true },    // [{ id, ts, source, content, label, instruction? }] reverse-chrono
    genTick: { state: true },         // 0..n — drives the rotating-word label inside shimmer indicators
    // Phase 2.0 — Activity timeline.
    activityState:  { state: true },  // 'idle' | 'loading' | 'loaded' | 'error'
    activityEvents: { state: true },  // EventRow[]
    processOutline: { state: true },  // { rounds, expected_total_rounds, source, ... } | null
    editingCompany: { state: true },  // inline company-name edit in the header
    editingTitle:   { state: true },  // inline role-title edit in the header
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    const params = new URLSearchParams(location.search);
    this.slug = (params.get('slug') || '').toLowerCase();
    const tab = params.get('tab');
    this.activeTab = TABS.find(t => t.id === tab)?.id || 'details';
    // Pre-populate from sessionStorage if the user came from /ladder/jobs/.
    // Title/company/tags paint instantly; the network refresh fills in
    // analysis + resume + cover.
    this.role = this.slug ? readRolePrefill(this.slug) : null;
    this.assets = { 'resume': null, 'cover-letter': null, 'analysis': null };
    this.baseResume = null;
    this.showChanges = true;
    this.coverRationale = { sig: '', highlights: [], opportunities: [], loading: false, error: '' };
    this.activeRationale = null;
    this.threads = {};
    this.coverUndo = null;
    this.editingAnchor = null;
    this.selectionPopover = null;
    this.coverHistory = [];
    this.genTick = 0;
    this.activityState  = 'idle';
    this.activityEvents = [];
    this.processOutline = null;
    this.editingCompany = false;
    this.editingTitle = false;

    const pretty = sessionStorage.getItem('job:prettyPath');
    if (pretty && /^\/ladder\/jobs\/[a-z0-9-]+\/?$/.test(pretty)) {
      sessionStorage.removeItem('job:prettyPath');
      const qs = this.activeTab !== 'details' ? `?tab=${this.activeTab}` : '';
      history.replaceState(null, '', pretty.replace(/\/?$/, '/') + qs);
    } else if (this.slug) {
      const qs = this.activeTab !== 'details' ? `?tab=${this.activeTab}` : '';
      history.replaceState(null, '', `/ladder/jobs/${this.slug}/${qs}`);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._maybeLoad();
    this._onAuth = () => this._maybeLoad();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
    this._onSelectionChange = () => this._handleSelectionChange();
    document.addEventListener('selectionchange', this._onSelectionChange);
    // <ladder-apply> requests a deep-link into the Resume / Cover-letter tab
    // via this event when the user clicks "Edit in full editor ↗".
    this._onApplyOpenTab = (ev) => {
      const t = ev?.detail?.tab;
      if (t) this._switchTab(t);
    };
    window.addEventListener('apply:opentab', this._onApplyOpenTab);
  }
  disconnectedCallback() {
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
    document.removeEventListener('selectionchange', this._onSelectionChange);
    window.removeEventListener('apply:opentab', this._onApplyOpenTab);
    this._teardownBodyObserver();
    if (this._genTimer) { clearInterval(this._genTimer); this._genTimer = null; }
    // Flush pending autosaves on unmount.
    for (const k of ['resume', 'cover-letter']) {
      if (this._autosaveTimers?.[k]) {
        clearTimeout(this._autosaveTimers[k]);
        this._flushSave(k);
      }
    }
    super.disconnectedCallback();
  }

  async _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    if (!this.slug) { this.state = 'error'; this.error = 'Missing slug'; return; }
    this.state = 'loading';
    try {
      // Load the role row + all three asset rows + the base resume in parallel.
      const [pipeline, resume, cover, analysis, baseResume] = await Promise.all([
        fetchPipeline(),
        this._loadAsset('resume'),
        this._loadAsset('cover-letter'),
        this._loadAsset('analysis'),
        this._loadBaseResume(),
      ]);
      this.role = (pipeline.roles || []).find(r => r.slug === this.slug) || null;
      this.assets = { 'resume': resume, 'cover-letter': cover, 'analysis': analysis };
      this.baseResume = baseResume;
      this.state = 'loaded';
      // Passive engagement signal — opening the drill page counts as
      // "in progress." Fire-and-forget; the helper is idempotent so
      // re-opens are no-ops on the server.
      if (this.role) engageRole(this.slug);
      // Seed history with the loaded cover letter so the user has a
      // baseline to revert to even before they make any edits.
      if (cover?.content) {
        this.coverHistory = [{
          id: this._newId(),
          ts: Date.now(),
          source: 'initial',
          content: cover.content,
          label: 'Loaded version',
        }];
      }
      document.title = this.role
        ? `${this.role.company} — ${this.role.title} — /ladder`
        : `${this.slug} — /ladder`;
      // Phase 2.0 — fetch activity events + process_outline so the
      // process-tracker strip + Activity tab paint without waiting for
      // a tab switch. Fire-and-forget; failure is silent.
      this._loadActivity();
      // Now that base resume is in hand, fold the diff into the resume's
      // editable HTML so it shows up on first paint.
      queueMicrotask(() => this._refreshEditHtml('resume'));
      // Auto-generate any missing asset.
      this._autoGenerateMissing();
      // Auto-refresh stale analysis. If the role row was updated more
      // recently than the analysis asset (e.g. company/title/url got
      // patched after we generated a "(unknown company) / Careers"
      // analysis), regenerate from the current JD. The user gets a
      // refresh-banner; resume + cover stay untouched (those have user
      // edits; regenerating them silently is destructive).
      this._maybeRefreshStaleAnalysis();
    } catch (e) {
      this.state = 'error';
      this.error = String(e);
    }
  }

  async _loadAsset(kind) {
    try {
      const r = await readRoleAsset(this.slug, kind);
      if (!r) return this._emptyAsset(kind);
      const view = this._viewAsset(kind, r.content_md);
      // Stash generated_at / updated_at so the stale-check can compare
      // them against the role row's updated_at on load.
      view._generatedAt = r.generated_at || r.updated_at || null;
      return view;
    } catch (e) {
      return { ...this._emptyAsset(kind), error: String(e) };
    }
  }

  _emptyAsset(kind) {
    return {
      kind, content: '', editHtml: '', editHtmlKey: '',
      mode: 'empty', saveStatus: 'idle', savedAt: 0, saving: false, error: '',
    };
  }

  // Build a "view" asset record from saved content. editHtml is the
  // rendered HTML the contenteditable article binds to. We render plain
  // markdown here; diffs/comments are layered in via _refreshEditHtml
  // when rationale + base resume are ready.
  _viewAsset(kind, content) {
    const html = renderMarkdown(content || '');
    return {
      kind, content: content || '', editHtml: html, editHtmlKey: 'plain',
      mode: 'view', saveStatus: 'idle', savedAt: Date.now(), saving: false, error: '',
    };
  }

  async _loadBaseResume() {
    try {
      const r = await readRoleAsset(BASE_RESUME_SLUG, 'resume');
      if (!r) return { content: '', missing: true };
      return { content: r.content_md, missing: false };
    } catch {
      return { content: '', missing: true };
    }
  }

  // Open a stripped-down print window with just one asset rendered, then
  // call window.print(). Print CSS strips the diff/highlight markup so the
  // saved PDF is clean. User picks "Save as PDF" in the print dialog.
  _downloadAssetPdf(kind) {
    const a = this.assets[kind];
    if (!a || !a.content) return;
    const r = this.role || {};
    const docTitle = `IanFike_${kind === 'resume' ? 'Resume' : 'CoverLetter'}_${(r.company || 'role').replace(/\s+/g, '_')}`;
    const html = renderMarkdown(a.content); // clean — no diff markers
    const w = window.open('', '_blank', 'noopener');
    if (!w) return;
    w.document.write(`<!doctype html>
<html><head><meta charset="utf-8"><title>${docTitle}</title>
<style>
  body { font: 12pt/1.5 -apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif; color: #111; max-width: 740px; margin: 48px auto; padding: 0 32px; }
  h1 { font-size: 22pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  h2 { font-size: 11pt; text-transform: uppercase; letter-spacing: 0.08em; margin: 18pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 2pt; }
  h3 { font-size: 12pt; margin: 12pt 0 2pt; }
  p, li { font-size: 10.5pt; line-height: 1.5; }
  ul { padding-left: 18pt; margin: 4pt 0 8pt; }
  em { color: #555; }
  a { color: inherit; text-decoration: none; }
  /* Strip any diff markers that snuck through */
  ins, mark, del { all: unset; }
  del { display: none !important; }
  @page { size: letter; margin: 0.6in; }
  @media print { body { margin: 0; padding: 0; } }
</style></head>
<body>${html}
<script>
  window.addEventListener('load', () => { setTimeout(() => window.print(), 50); });
</script>
</body></html>`);
    w.document.close();
  }

  _toggleChanges() {
    this.showChanges = !this.showChanges;
    queueMicrotask(() => {
      this._refreshEditHtml('resume');
      this._refreshEditHtml('cover-letter');
    });
  }

  // For the cover-letter tab, pull source phrases out of the analysis JSON
  // for "what was tailored from the JD" highlighting. Returns labeled
  // sources so the comment rail can show which analysis field each
  // highlight came from.
  _coverHighlightSources() {
    const ana = this.assets['analysis'];
    if (!ana || ana.mode !== 'view') return [];
    const parsed = this._parseAnalysis(ana.content);
    if (!parsed) return [];
    const out = [];
    if (parsed.suggestedAngle) out.push({ label: 'Suggested angle', text: parsed.suggestedAngle });
    if (parsed.whyFits)        out.push({ label: 'Why it fits',     text: parsed.whyFits });
    if (parsed.strengths)      out.push({ label: 'Strengths',       text: parsed.strengths });
    if (parsed.gaps)           out.push({ label: 'Gaps to address', text: parsed.gaps });
    return out;
  }

  _autoGenerateMissing() {
    for (const kind of ['analysis', 'resume', 'cover-letter']) {
      const a = this.assets[kind];
      if (a && a.mode === 'empty' && !a.saving) this._onGenerate(kind);
    }
  }

  // Re-run analysis when the role row has been touched (URL / company /
  // title fix, manual edit, enrichment cycle) after the last analysis
  // was generated. Resume + cover are left alone because the user may
  // have hand-edited them; regenerating destroys edits.
  //
  // Threshold: 30s grace window — `engageRole` itself updates
  // `pipeline_roles.updated_at`, and we don't want to ping-pong a
  // regenerate every page open.
  async _maybeRefreshStaleAnalysis() {
    if (!this.role) return;
    const a = this.assets['analysis'];
    if (!a || a.mode === 'empty' || a.saving) return;     // empty path is handled by _autoGenerateMissing
    const roleUpdated = Date.parse(this.role.updatedAt || '');
    // generated_at sits on the asset row but isn't surfaced through
    // _viewAsset; we hold it on a._generatedAt when present via the
    // role-asset response.
    const assetGenerated = Date.parse(a._generatedAt || '');
    if (!isFinite(roleUpdated) || !isFinite(assetGenerated)) return;
    if (roleUpdated - assetGenerated < 30_000) return;
    console.log(`[role-detail] auto-refresh analysis (role +${Math.round((roleUpdated - assetGenerated)/1000)}s newer)`);
    this._analysisAutoRefreshing = true;
    this.requestUpdate();
    await this._onGenerate('analysis');
    this._analysisAutoRefreshing = false;
    this.requestUpdate();
  }

  _switchTab(id) {
    // Flush any pending autosaves so leaving the tab doesn't drop edits.
    for (const k of ['resume', 'cover-letter']) this._flushSave(k);
    this.activeTab = id;
    const qs = id !== 'details' ? `?tab=${id}` : '';
    history.replaceState(null, '', `/ladder/jobs/${this.slug}/${qs}`);
    // Phase 2.0 — lazy-load Activity timeline the first time it opens.
    if (id === 'activity' && this.activityState === 'idle') this._loadActivity();
  }

  async _loadActivity() {
    this.activityState = 'loading';
    try {
      const res = await listEvents(this.slug, { withReplyStatus: true });
      this.activityEvents = res.events || [];
      this.processOutline = res.process_outline || null;
      this.activityState = 'loaded';
    } catch (e) {
      this.error = (e && e.message) || String(e);
      this.activityState = 'error';
    }
  }

  async _onAckActivityEvent(ev, dom) {
    dom?.stopPropagation();
    try {
      await ackApplicationEvent(ev.id);
      this.activityEvents = this.activityEvents.map(e =>
        e.id === ev.id ? { ...e, needs_review: false, reviewed_at: new Date().toISOString() } : e
      );
    } catch (e) {
      console.warn('[role-detail] ack failed:', e.message);
    }
  }

  // One-click resolution for below-floor offer/rejection prompts —
  // mirrors the Updates queue: applies the role mutation + acks the event
  // server-side, with Undo via toast.
  async _onResolveActivityEvent(ev, resolution, dom) {
    dom?.stopPropagation();
    try {
      await resolveApplicationEvent(ev.id, resolution);
      document.dispatchEvent(new CustomEvent('job:toast', {
        detail: {
          msg: resolution === 'archive' ? 'Role archived' : 'Moved to Offer',
          action: 'Undo',
          duration: 8000,
          onAction: async () => {
            try {
              await undoApplicationEvent(ev.id);
              const pipeline = await fetchPipeline();
              this.role = (pipeline.roles || []).find(r => r.slug === this.slug) || this.role;
              await this._loadActivity();
            } catch (e) { console.warn('[role-detail] undo failed:', e.message); }
          },
        },
      }));
      await this._loadActivity();
    } catch (e) {
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: `Couldn't apply: ${e.message}` } }));
    }
  }

  async _onUndoActivityEvent(ev, dom) {
    dom?.stopPropagation();
    try {
      await undoApplicationEvent(ev.id);
      document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg: 'Restored' } }));
      await this._loadActivity();
    } catch (e) {
      console.warn('[role-detail] undo failed:', e.message);
    }
  }

  async _onGenerate(kind) {
    const a = this.assets[kind] || this._emptyAsset(kind);
    this.assets = { ...this.assets, [kind]: { ...a, saving: true, error: '' } };
    try {
      const res = await generateAsset(this.slug, kind);
      this.assets = { ...this.assets, [kind]: this._viewAsset(kind, res.content) };
      // Analysis carries the signals fit_score depends on (company,
      // title-match accuracy, sector inference). Trigger a per-slug
      // rescore so the breakdown picks up changes without waiting for
      // a manual ?rescore=1 sweep. Fire-and-forget; refresh role data
      // after it lands so the UI shows the new score.
      if (kind === 'analysis') this._rescoreAfterAnalysis();
    } catch (e) {
      this.assets = { ...this.assets, [kind]: { ...this.assets[kind], saving: false, error: String(e) } };
    }
  }

  async _rescoreAfterAnalysis() {
    try {
      const result = await rescoreRole(this.slug);
      if (!result?.ok) return;
      // Refresh the role row to pick up the new fit_score + breakdown.
      const pipeline = await fetchPipeline();
      const fresh = (pipeline.roles || []).find(r => r.slug === this.slug);
      if (fresh) {
        this.role = fresh;
        this.requestUpdate();
      }
    } catch (e) {
      console.warn('[role-detail] rescoreAfterAnalysis failed:', (e && e.message) || e);
    }
  }

  // Recompute the rendered HTML for the contenteditable article when
  // load-bearing inputs change (showChanges toggle, base resume arrival,
  // cover rationale arrival, or saved content). We do NOT call this on
  // every user keystroke — Lit's unsafeHTML only updates DOM when the
  // string changes, so as long as editHtml is stable across renders the
  // cursor sticks. We bump editHtml only via this method.
  _refreshEditHtml(kind) {
    const a = this.assets[kind];
    if (!a || !a.content) return;
    let html;
    let key;
    if (kind === 'resume' && this.showChanges && this.baseResume?.content) {
      html = renderMarkdown(diffMarkdown(this.baseResume.content, a.content));
      key = `diff:${this._fnv(this.baseResume.content)}:${this._fnv(a.content)}`;
    } else if (kind === 'cover-letter' && this.showChanges) {
      const { html: marked } = applyAIHighlights(a.content, this.coverRationale.highlights, this.coverRationale.opportunities);
      html = renderMarkdown(marked);
      key = `cover:${this._fnv(a.content)}:${this._fnv(JSON.stringify(this.coverRationale.highlights))}`;
    } else {
      html = renderMarkdown(a.content);
      key = `plain:${this._fnv(a.content)}`;
    }
    if (a.editHtmlKey === key) return;
    this.assets = { ...this.assets, [kind]: { ...a, editHtml: html, editHtmlKey: key } };
  }

  // Old textarea-based edit methods replaced by inline contenteditable —
  // see _enterEdit / _cancelEdit / _saveInlineEdit further down.

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
        suggestedAngle: sections['suggestedangle'] || sections['coverletterangle'] || sections['angle'] || '',
        resumeAngle: sections['resumeangle'] || sections['suggestedresumeangle'] || '',
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

  // Trim a prose blob to ~100 words at a sentence boundary so the fit
  // summary stays scannable. Falls back to the raw text if the source
  // is already short.
  _summaryFromWhyFits(text) {
    if (!text) return '';
    const flat = String(text).replace(/\s+/g, ' ').trim();
    const words = flat.split(' ');
    if (words.length <= 100) return flat;
    const truncated = words.slice(0, 100).join(' ');
    const lastStop = Math.max(truncated.lastIndexOf('. '), truncated.lastIndexOf('? '), truncated.lastIndexOf('! '));
    return (lastStop > 0 ? truncated.slice(0, lastStop + 1) : truncated + '…').trim();
  }

  // The v3 fit section: full modal-style card body — score block, the
  // static "what this measures" sub-explainer, hard-fail callout, and
  // bars-with-subcopy. The Haiku-generated fit_summary is exposed via
  // hover/click on the score pill if needed, not as page chrome.
  _renderFitSection(_parsed, status) {
    const r = this.role;
    if (!r) return nothing;
    return html`
      <article class="role-card role-card--fit fit-modal">
        <header class="role-card__head"><h3>Fit</h3></header>
        ${renderFitCardBody(r, { loading: status === 'loading' })}
      </article>
    `;
  }

  // Candidate-strength card — same component layout as Fit, different
  // data + dimensions. Answers "are you a good candidate for this role?
  // where are your strengths and weaknesses?" from the hiring manager's
  // lens. Driven by candidate_breakdown / candidate_rationales /
  // candidate_summary fields generated alongside the Haiku role-match call.
  _renderCandidateSection(status) {
    const r = this.role;
    if (!r) return nothing;
    return html`
      <article class="role-card role-card--fit fit-modal">
        <header class="role-card__head"><h3>Candidate strength</h3></header>
        ${renderCandidateCardBody(r, { loading: status === 'loading' })}
      </article>
    `;
  }

  _renderTwoColCard({ title, headerExtra, sections, status }) {
    return html`
      <article class="role-card">
        <header class="role-card__head role-card__head--with-extra">
          <h3>${title}</h3>
          ${headerExtra || nothing}
        </header>
        <div class="role-card__body">
          ${status === 'loading' ? html`<p class="muted">${this._genLabel()}</p>`
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

  // "People you may know here" — Ian's LinkedIn connections tied to this
  // role's company, joined in by jobs-pipe on r.connections. Split into
  // 1st-degree ("you know them directly" → warm intro/referral) and
  // high-quality 2nd-degree ("worth a connection request" → decision-makers
  // reachable through a mutual). Hidden when there are none.
  _renderConnections() {
    const conns = this.role?.connections || [];
    if (!conns.length) return nothing;
    const firsts  = conns.filter(c => c.degree !== '2nd');
    const seconds = conns.filter(c => c.degree === '2nd');
    return html`
      <article class="role-card role-connections">
        <header class="role-card__head"><h3>People you may know here</h3></header>
        <div class="role-card__body">
          ${firsts.length ? html`
            <p class="conn-group__label">
              <span class="conn-badge conn-badge--1st">1st</span>
              You're connected — ${firsts.length} direct contact${firsts.length === 1 ? '' : 's'} at ${this.role.company || 'this company'}. Ask for a warm intro or referral.
            </p>
            <ul class="conn-list">
              ${firsts.map(c => this._renderConnItem(c))}
            </ul>
          ` : nothing}
          ${seconds.length ? html`
            <p class="conn-group__label" style=${firsts.length ? 'margin-top:var(--space-4);' : ''}>
              <span class="conn-badge conn-badge--2nd">2nd</span>
              Worth a connection request — ${seconds.length} senior/decision-maker${seconds.length === 1 ? '' : 's'} reachable through a mutual.
            </p>
            <ul class="conn-list">
              ${seconds.map(c => this._renderConnItem(c))}
            </ul>
          ` : nothing}
        </div>
      </article>
    `;
  }

  _renderConnItem(c) {
    const isSecond = c.degree === '2nd';
    return html`
      <li class="conn-item">
        <a class="conn-link ${isSecond ? 'conn-link--2nd' : ''}" href=${c.profileUrl || '#'} target="_blank" rel="noopener">
          ${c.photoUrl
            ? html`<img class="conn-avatar" src=${c.photoUrl} alt="" loading="lazy" decoding="async"
                     @error=${(e) => { e.target.replaceWith(this._connInitialEl(c.name)); }}/>`
            : this._connInitial(c.name)}
          <span class="conn-text">
            <span class="conn-name">${c.name}</span>
            ${c.title ? html`<span class="conn-title">${c.title}</span>` : nothing}
            ${isSecond && c.mutuals ? html`<span class="conn-mutuals">${c.mutuals} mutual connection${c.mutuals === 1 ? '' : 's'}</span>` : nothing}
          </span>
        </a>
      </li>
    `;
  }

  _connInitial(name) {
    const ch = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return html`<span class="conn-avatar conn-avatar--placeholder" aria-hidden="true">${ch}</span>`;
  }
  _connInitialEl(name) {
    const span = document.createElement('span');
    span.className = 'conn-avatar conn-avatar--placeholder';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return span;
  }

  // --- Inline company-name edit (header subtitle) --------------------------
  // The crawler sometimes stores a mis-parsed company (e.g. the legal entity
  // "Care Delivery Systems" instead of the brand "Midi Health"). Clicking the
  // company name in the header turns it into an input; Enter/blur saves via
  // jobs-pipe (company_name only — company_slug is left intact so connections
  // and KB linkage keep working).
  _renderCompanyEditable(r) {
    const company = r?.company || '';
    if (this.editingCompany) {
      return html`<input class="company-edit-input" .value=${company}
                   placeholder="Company name" aria-label="Company name"
                   @keydown=${(e) => this._onCompanyKeydown(e)}
                   @blur=${(e) => this._saveCompany(e.target.value)}>`;
    }
    return html`<button class="company-edit-btn" title="Click to edit the company name"
                  @click=${() => this._startEditCompany()}>
                  <span class="company-edit-name">${company || 'Add company'}</span>
                </button>`;
  }

  _startEditCompany() {
    this.editingCompany = true;
    this.updateComplete.then(() => {
      const el = this.querySelector('.company-edit-input');
      if (el) { el.focus(); el.select(); }
    });
  }

  _onCompanyKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); this._companyCancel = true; this.editingCompany = false; }
  }

  async _saveCompany(value) {
    if (this._companyCancel) { this._companyCancel = false; this.editingCompany = false; return; }
    const name = (value || '').trim();
    this.editingCompany = false;
    if (!name || name === (this.role?.company || '')) return;
    const prev = this.role?.company;
    this.role = { ...this.role, company: name };
    document.title = `${name} — ${this.role?.title || this.slug} — /ladder`;
    try {
      await updateRole(this.slug, { company_name: name });
    } catch (e) {
      this.role = { ...this.role, company: prev };
      console.warn('[role-detail] company save failed:', (e && e.message) || e);
    }
  }

  // --- Inline role-title edit (header h1) ----------------------------------
  // Same pattern as the company edit: click the title to turn it into an
  // input; Enter/blur saves via jobs-pipe (title only).
  _renderTitleEditable(r) {
    const title = r?.title || '';
    if (this.editingTitle) {
      return html`<input class="title-edit-input" .value=${title}
                   placeholder="Role title" aria-label="Role title"
                   @keydown=${(e) => this._onTitleKeydown(e)}
                   @blur=${(e) => this._saveTitle(e.target.value)}>`;
    }
    return html`<button class="title-edit-btn" title="Click to edit the role title"
                  @click=${() => this._startEditTitle()}>
                  <span class="title-edit-name">${title || this.slug}</span>
                </button>`;
  }

  _startEditTitle() {
    this.editingTitle = true;
    this.updateComplete.then(() => {
      const el = this.querySelector('.title-edit-input');
      if (el) { el.focus(); el.select(); }
    });
  }

  _onTitleKeydown(e) {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); this._titleCancel = true; this.editingTitle = false; }
  }

  async _saveTitle(value) {
    if (this._titleCancel) { this._titleCancel = false; this.editingTitle = false; return; }
    const title = (value || '').trim();
    this.editingTitle = false;
    if (!title || title === (this.role?.title || '')) return;
    const prev = this.role?.title;
    this.role = { ...this.role, title };
    document.title = `${this.role?.company || ''} — ${title} — /ladder`;
    try {
      await updateRole(this.slug, { title });
    } catch (e) {
      this.role = { ...this.role, title: prev };
      console.warn('[role-detail] title save failed:', (e && e.message) || e);
    }
  }

  _renderDetails() {
    const a = this.assets['analysis'];
    const status = !a ? 'loading' : a.saving ? 'loading' : a.error ? 'error' : a.mode === 'empty' ? 'loading' : 'ok';
    const parsed = a && a.mode === 'view' ? this._parseAnalysis(a.content) : null;
    const roleFit = this._scoreFromAnalysis(parsed, 'roleFitScore');
    const candidate = this._scoreFromAnalysis(parsed, 'candidateScore');
    return html`
      ${this._renderMetaRow()}
      ${this._renderConnections()}
      ${parsed?.description ? html`
        <section class="role-summary">
          <div class="kb-doc">${unsafeHTML(renderMarkdown(parsed.description))}</div>
        </section>
      ` : status === 'loading' ? html`<p class="muted">Drafting summary…</p>` : nothing}

      <div class="role-cards role-cards--fit-candidate">
        ${this._renderFitSection(parsed, status)}
        ${this._renderCandidateSection(status)}
      </div>
      ${parsed?.risks ? html`
        <article class="role-card">
          <header class="role-card__head"><h3>Risks</h3></header>
          <div class="role-card__body">
            <div class="kb-doc">${unsafeHTML(renderMarkdown(parsed.risks))}</div>
          </div>
        </article>
      ` : nothing}

      ${a?.error ? html`<p class="muted" style="color:var(--error);">${a.error}</p>` : nothing}
      <div class="asset-toolbar" style="margin-top:var(--space-5);">
        <button class="btn btn--sm" ?disabled=${a?.saving} @click=${() => this._onGenerate('analysis')}>
          ${a?.saving ? 'Regenerating…' : 'Regenerate analysis'}
        </button>
      </div>
    `;
  }

  // --- Tailoring callout + change log -------------------------------------
  // For Cover letter: pull the analysis JSON's `suggestedAngle`.
  // For Resume:      derive a tailoring focus from `strengths` (what to lead
  //                  with given this role's emphasis). Falls back to a generic
  //                  prompt if the analysis hasn't generated yet.
  _renderTailoringCallout(kind) {
    const ana = this.assets['analysis'];
    const parsed = ana && ana.mode === 'view' ? this._parseAnalysis(ana.content) : null;
    let title, body;
    if (kind === 'cover-letter') {
      title = 'Suggested angle for the cover letter';
      body = parsed?.suggestedAngle || '';
    } else if (kind === 'resume') {
      title = 'Suggested angle for the resume';
      body = parsed?.resumeAngle || parsed?.strengths || '';
    } else {
      return nothing;
    }
    if (!body) {
      return html`
        <aside class="tailoring-callout">
          <header class="tailoring-callout__head">
            <h4 class="tailoring-callout__title">${title}</h4>
            <span class="tailoring-callout__pill">AI</span>
          </header>
          <p class="tailoring-empty">Generate the role analysis first to see a tailoring angle.</p>
        </aside>
      `;
    }
    return html`
      <aside class="tailoring-callout">
        <header class="tailoring-callout__head">
          <h4 class="tailoring-callout__title">${title}</h4>
          <span class="tailoring-callout__pill">AI</span>
        </header>
        <div class="kb-doc">${unsafeHTML(renderMarkdown(body))}</div>
      </aside>
    `;
  }

  // Derive a list of tailoring "comments" — what the AI emphasised when it
  // wrote this asset for this role. We bucket the analysis fields into a
  // change log: matched strengths, gaps to soften, and the role-specific
  // angle. User edits are layered on top via a localStorage diff (lightweight,
  // best-effort — keeps this client-side until we add a proper revisions table).
  _changeLogKey(kind) { return `job:changes:${this.slug}:${kind}`; }

  _readChangeLog(kind) {
    try {
      const raw = localStorage.getItem(this._changeLogKey(kind));
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  _renderChangeLog(kind) {
    const ana = this.assets['analysis'];
    const parsed = ana && ana.mode === 'view' ? this._parseAnalysis(ana.content) : null;

    const items = [];
    if (parsed?.strengths) {
      items.push(`Led with strengths that map to this role: ${this._firstSentence(parsed.strengths)}`);
    }
    if (parsed?.whyFits) {
      items.push(`Framed the opening around why this fits: ${this._firstSentence(parsed.whyFits)}`);
    }
    if (parsed?.gaps && kind === 'cover-letter') {
      items.push(`Acknowledged gaps directly: ${this._firstSentence(parsed.gaps)}`);
    }
    if (kind === 'cover-letter' && parsed?.suggestedAngle) {
      items.push(`Used the suggested angle: ${this._firstSentence(parsed.suggestedAngle)}`);
    }
    if (kind === 'resume' && (parsed?.resumeAngle || parsed?.strengths)) {
      items.push(`Reordered bullets to surface ${this._firstSentence(parsed.resumeAngle || parsed.strengths)}`);
    }

    const userEdits = this._readChangeLog(kind);
    for (const e of userEdits) items.push(`Manual edit (${e.at}): ${e.note}`);

    if (!items.length) {
      return html`
        <aside class="tailoring-callout">
          <header class="tailoring-callout__head">
            <h4 class="tailoring-callout__title">What changed for this role</h4>
            <span class="tailoring-callout__pill">${userEdits.length} edits</span>
          </header>
          <p class="tailoring-empty">No tailoring notes yet — regenerate to populate.</p>
        </aside>
      `;
    }
    return html`
      <aside class="tailoring-callout">
        <header class="tailoring-callout__head">
          <h4 class="tailoring-callout__title">What changed for this role</h4>
          <span class="tailoring-callout__pill">${items.length}</span>
        </header>
        <ul class="tailoring-list">
          ${items.map(i => html`<li>${i}</li>`)}
        </ul>
      </aside>
    `;
  }

  _firstSentence(s) {
    if (!s) return '';
    const cleaned = s.replace(/[#*`_>\[\]]/g, '').trim();
    const m = cleaned.match(/^(.{20,200}?[\.\!\?])\s/);
    return (m ? m[1] : cleaned.split('\n')[0]).slice(0, 200).trim();
  }

  // --- Resume / Cover-letter tab body -------------------------------------

  _renderAssetTab(kind) {
    const a = this.assets[kind];
    if (!a) return html`<div class="placeholder"><h2>Loading…</h2></div>`;
    if (a.saving && !a.content) {
      return html`<div class="placeholder">
        <h2>${this._genLabel(kind === 'resume' ? 'resume' : 'cover letter')}</h2>
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
              ${a.saving ? this._genLabel() : `Generate ${kind === 'resume' ? 'resume' : 'cover letter'}`}
            </button>
          </div>
          ${a.error ? html`<p class="muted" style="color:var(--error);margin-top:var(--space-3);">${a.error}</p>` : nothing}
        </div>
      `;
    }

    const isCover = kind === 'cover-letter';
    const canDiff = (kind === 'resume' || isCover);
    const showingChanges = canDiff && this.showChanges;

    // Cover letter rationale is fetched once analysis + cover content are
    // ready; comments derive from the AI highlights cached in state.
    let coverComments = [];
    let coverLoading = false;
    if (isCover && showingChanges) {
      const sig = this._coverSig();
      if (this.coverRationale.sig !== sig && !this.coverRationale.loading) {
        queueMicrotask(() => this._ensureCoverRationale());
      }
      coverLoading = this.coverRationale.loading;
      ({ comments: coverComments } = applyAIHighlights(a.content, this.coverRationale.highlights, this.coverRationale.opportunities));
    }

    return html`
      ${this._renderTailoringCallout(kind)}
      ${this._renderChangeLog(kind)}
      <div class="asset-toolbar">
        ${this._renderSaveStatus(a)}
        <span class="asset-toolbar__divider" aria-hidden="true"></span>
        <button class="btn btn--sm" ?disabled=${a.saving} @click=${() => this._onGenerate(kind)}>
          ${a.saving ? 'Regenerating…' : 'Regenerate'}
        </button>
        ${canDiff ? html`
          <button class="btn btn--sm ${this.showChanges ? 'btn--primary' : ''}" @click=${() => this._toggleChanges()}>
            ${this.showChanges ? (isCover ? 'Hide comments' : 'Hide changes') : (isCover ? 'Show comments' : 'Show changes')}
          </button>
        ` : nothing}
        <button class="btn btn--sm btn--accent" @click=${() => this._downloadAssetPdf(kind)}>
          Download clean PDF
        </button>
        ${kind === 'resume' && this.baseResume?.missing ? html`
          <span class="muted" style="font-size: var(--font-size-small);">
            No base resume yet — set one in <a href="/ladder/history/?tab=base">Career → Base resume</a>.
          </span>
        ` : nothing}
        ${a.error ? html`<span class="muted" style="color:var(--error);">${a.error}</span>` : nothing}
      </div>

      ${isCover && this.coverUndo ? html`
        <div class="cover-undo">
          <span>AI edit applied (${this.coverUndo.label}).</span>
          <button class="btn btn--sm" @click=${() => this._undoCoverEdit()}>Undo</button>
        </div>
      ` : nothing}

      ${isCover && this.selectionPopover?.visible ? this._renderSelectionPopover() : nothing}

      ${isCover && showingChanges
        ? html`
          <div class="cover-layout">
            <article class="kb-doc asset-doc asset-doc--editing cover-layout__body"
                     contenteditable="true"
                     spellcheck="true"
                     data-edit-kind=${kind}
                     data-active=${this.activeRationale ?? ''}
                     @input=${() => this._onContentEditableInput(kind)}
                     @click=${(e) => {
                       const m = e.target.closest('mark[data-rationale]');
                       if (m) this._activateRationale(Number(m.dataset.rationale));
                     }}
                     @keydown=${(e) => {
                       if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                         e.preventDefault();
                         this._flushSave(kind);
                       }
                     }}>${unsafeHTML(a.editHtml || '')}</article>
            <aside class="cover-layout__sidebar">
            <aside class="cover-layout__rail" aria-label="Comments">
              <header class="cover-rail__head">
                <h4 class="cover-rail__title">Comments</h4>
                ${coverLoading ? html`<span class="cover-rail__spin">${this._genLabel()}</span>` : nothing}
              </header>
              ${this.coverRationale.error ? html`
                <p class="muted" style="color:var(--error);padding:0 var(--space-3);">${this.coverRationale.error}</p>
              ` : nothing}
              ${!coverLoading && !coverComments.length && !this.coverRationale.error ? html`
                <p class="cover-rail__empty">No load-bearing phrases yet — try regenerating the cover letter.</p>
              ` : nothing}
              <div class="cover-rail__list" data-active=${this.activeRationale ?? ''}>
                ${coverComments.map(c => {
                  const thread = this._getThread(c.id);
                  const isActive = this.activeRationale === c.id;
                  const isOp = c.kind === 'opportunity';
                  const ph = isOp
                    ? (c.ask || 'Add the missing information…')
                    : (isActive ? 'How should this change?' : 'Direct an edit…');
                  return html`
                    <article class="cover-comment ${isOp ? 'cover-comment--op' : ''} ${isActive ? 'is-active' : ''}"
                             data-rationale-id=${c.id}
                             @mouseenter=${() => this._highlightRationale(c.id, true)}
                             @mouseleave=${() => this._highlightRationale(c.id, false)}>
                      <header class="cover-comment__head" @click=${() => { this._scrollToHighlight(c.id); }}>
                        <span class="cover-comment__num">${isOp ? '✦' : c.id}</span>
                        <span class="cover-comment__label">${c.label}</span>
                      </header>
                      <div class="cover-comment__body">${unsafeHTML(renderMarkdown(c.text))}</div>
                      ${isOp && c.ask ? html`<p class="cover-comment__ask">${c.ask}</p>` : nothing}

                      ${thread.messages.length ? html`
                        <ul class="cover-thread">
                          ${thread.messages.map(m => html`
                            <li class="cover-thread__msg cover-thread__msg--${m.role}">
                              ${unsafeHTML(renderMarkdown(m.text))}
                            </li>
                          `)}
                          ${thread.sending ? html`
                            <li class="cover-thread__msg cover-thread__msg--assistant">
                              ${this._genLabel(isOp ? 'and weaving in' : 'edit')}
                            </li>
                          ` : nothing}
                          ${thread.error ? html`
                            <li class="cover-thread__msg cover-thread__msg--error">${thread.error}</li>
                          ` : nothing}
                        </ul>
                      ` : nothing}

                      <form class="cover-thread__form" @submit=${(e) => {
                        e.preventDefault();
                        const input = e.currentTarget.querySelector('textarea');
                        const v = input.value;
                        input.value = '';
                        if (isOp) this._sendOpportunity(c, v);
                        else      this._sendCommentChat(c.id, v);
                      }}>
                        <textarea class="cover-thread__input"
                                  rows="1"
                                  placeholder=${ph}
                                  ?disabled=${thread.sending}
                                  @keydown=${(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      e.currentTarget.form.requestSubmit();
                                    }
                                  }}
                                  @input=${(e) => {
                                    e.target.style.height = 'auto';
                                    e.target.style.height = e.target.scrollHeight + 'px';
                                  }}></textarea>
                        <button class="cover-thread__send" type="submit" ?disabled=${thread.sending} aria-label="Send">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M8 13V3"/><path d="M3 8l5-5 5 5"/>
                          </svg>
                        </button>
                      </form>
                    </article>
                  `;
                })}
              </div>
            </aside>
            ${this._renderHistory()}
            </aside>
          </div>
        `
        : html`
          <article class="kb-doc asset-doc asset-doc--editing"
                   contenteditable="true"
                   spellcheck="true"
                   data-edit-kind=${kind}
                   @input=${() => this._onContentEditableInput(kind)}
                   @keydown=${(e) => {
                     if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                       e.preventDefault();
                       this._flushSave(kind);
                     }
                   }}>${unsafeHTML(a.editHtml || '')}</article>
        `}
    `;
  }

  // Floating popover that appears next to a non-empty selection inside
  // the cover body. Lets the user direct an edit on just that range.
  _renderSelectionPopover() {
    const p = this.selectionPopover;
    if (!p) return nothing;
    // Clamp so the popover doesn't overflow the viewport.
    const padding = 12;
    const halfW = 200;
    const cx = Math.max(padding + halfW, Math.min(window.innerWidth - padding - halfW, p.x));
    const cy = Math.min(window.innerHeight - 80, p.y);
    const style = `position:fixed; left:${cx}px; top:${cy}px; transform: translateX(-50%);`;
    return html`
      <div class="sel-popover" style=${style} @mousedown=${(e) => e.preventDefault()}>
        <form class="cover-thread__form sel-popover__form" @submit=${(e) => {
          e.preventDefault();
          const input = e.currentTarget.querySelector('textarea');
          this._sendSelectionChat(input.value);
        }}>
          <textarea class="cover-thread__input"
                    rows="1"
                    autofocus
                    placeholder="Direct an edit to selection…"
                    @keydown=${(e) => {
                      if (e.key === 'Escape') { this._closeSelectionPopover(); }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        e.currentTarget.form.requestSubmit();
                      }
                    }}></textarea>
          <button class="cover-thread__send" type="submit" aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M8 13V3"/><path d="M3 8l5-5 5 5"/>
            </svg>
          </button>
        </form>
        <button class="sel-popover__close" type="button" @click=${() => this._closeSelectionPopover()} aria-label="Close">×</button>
      </div>
    `;
  }

  _renderHistory() {
    const items = this.coverHistory || [];
    if (items.length === 0) return nothing;
    return html`
      <aside class="cover-history" aria-label="Edit history">
        <header class="cover-rail__head">
          <h4 class="cover-rail__title">History</h4>
          <span class="cover-rail__spin">${items.length} version${items.length === 1 ? '' : 's'}</span>
        </header>
        <ol class="cover-history__list">
          ${items.map((h, i) => html`
            <li class="cover-history__item ${i === 0 ? 'cover-history__item--current' : ''}">
              <button class="cover-history__btn" ?disabled=${i === 0} @click=${() => this._restoreHistory(h.id)} title=${h.instruction || ''}>
                <span class="cover-history__icon" data-source=${h.source}>${this._historyIcon(h.source)}</span>
                <span class="cover-history__meta">
                  <span class="cover-history__label">${h.label || this._historyDefaultLabel(h.source)}</span>
                  ${h.instruction ? html`<span class="cover-history__inst">${this._truncate(h.instruction, 80)}</span>` : nothing}
                </span>
                <span class="cover-history__ts">${this._timeAgo(h.ts)}</span>
              </button>
            </li>
          `)}
        </ol>
      </aside>
    `;
  }

  _historyIcon(source) {
    if (source === 'ai-comment' || source === 'ai-selection' || source === 'pre-ai') return '✨';
    if (source === 'manual') return '✎';
    if (source === 'restore' || source === 'pre-restore') return '↻';
    return '·';
  }
  _historyDefaultLabel(source) {
    if (source === 'manual') return 'Manual edit';
    if (source === 'ai-comment') return 'AI edit (comment)';
    if (source === 'ai-selection') return 'AI edit (selection)';
    if (source === 'initial') return 'Loaded version';
    if (source === 'pre-ai') return 'Pre-AI snapshot';
    if (source === 'pre-restore') return 'Pre-restore snapshot';
    if (source === 'restore') return 'Restored version';
    return source;
  }

  // Save-status pill in the toolbar — green dot for "Saved", amber for
  // "Editing", spinner for "Saving", red for "Error".
  _renderSaveStatus(a) {
    const status = a.saveStatus || 'idle';
    let label = 'Saved';
    let cls = 'save-status--saved';
    if (status === 'dirty')   { label = 'Editing'; cls = 'save-status--dirty'; }
    if (status === 'saving')  { return html`<span class="save-status save-status--saving"><span class="save-status__dot" aria-hidden="true"></span>${this._genLabel('save')}</span>`; }
    if (status === 'error')   { label = 'Save failed'; cls = 'save-status--error'; }
    if (status === 'saved' || status === 'idle') {
      const ago = a.savedAt ? this._timeAgo(a.savedAt) : '';
      label = ago ? `Saved ${ago}` : 'Saved';
    }
    return html`<span class="save-status ${cls}" title=${a.error || ''}>
      <span class="save-status__dot" aria-hidden="true"></span>
      <span class="save-status__label">${label}</span>
    </span>`;
  }

  _timeAgo(t) {
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return `${sec}s ago`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return `${h}h ago`;
  }

  // ----- Shared "generating" indicator: shimmer + rotating word -----------
  // GEN_WORDS cycle on a single timer driven by genTick; every shimmer label
  // in the component reads the same index so the page hums in lockstep.

  static get GEN_WORDS() {
    return ['Generating', 'Drafting', 'Composing', 'Polishing', 'Refining'];
  }

  // True if anything that should display a shimmer is currently running.
  _isAnyGenerating() {
    if (Object.values(this.assets || {}).some(a => a?.saving)) return true;
    if (this.coverRationale?.loading) return true;
    if (this.editingAnchor) return true;
    if (Object.values(this.threads || {}).some(t => t?.sending)) return true;
    return false;
  }

  _ensureGenTimer() {
    const active = this._isAnyGenerating();
    if (active && !this._genTimer) {
      this._genTimer = setInterval(() => {
        this.genTick = (this.genTick + 1) % JobRoleDetail.GEN_WORDS.length;
      }, 1500);
    } else if (!active && this._genTimer) {
      clearInterval(this._genTimer);
      this._genTimer = null;
      this.genTick = 0;
    }
  }

  // Returns a Lit fragment: "<prefix> <word>…" with shimmer text styling.
  // `prefix` is the static part (e.g. "Generating resume" → omit prefix and
  // pass just the kind label like "resume", or skip it entirely).
  _genLabel(suffix = '') {
    const word = JobRoleDetail.GEN_WORDS[this.genTick % JobRoleDetail.GEN_WORDS.length];
    return html`<span class="gen-shimmer">${word}${suffix ? ' ' + suffix : ''}…</span>`;
  }

  // Build a stable signature for "this cover letter + these analysis sources"
  // so we re-fetch the AI rationale only when content changes.
  _coverSig() {
    const cover = this.assets['cover-letter']?.content || '';
    const sources = this._coverHighlightSources();
    const srcKey = sources.map(s => `${s.label}\n${s.text}`).join('\n---\n');
    return `${cover.length}|${this._fnv(cover)}|${this._fnv(srcKey)}`;
  }

  _fnv(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }

  // Lazy fetch — runs when the cover-letter tab is showing comments and
  // the current cache signature doesn't match the live cover/sources.
  async _ensureCoverRationale() {
    const sig = this._coverSig();
    if (this.coverRationale.sig === sig && !this.coverRationale.error) return;
    if (this.coverRationale.loading && this.coverRationale.sig === sig) return;
    const cover = this.assets['cover-letter']?.content || '';
    const sources = this._coverHighlightSources();
    if (!cover || sources.length === 0) {
      this.coverRationale = { sig, highlights: [], opportunities: [], loading: false, error: '' };
      return;
    }
    this.coverRationale = { sig, highlights: [], opportunities: [], loading: true, error: '' };
    try {
      const { highlights, opportunities } = await fetchCoverRationale(cover, sources);
      if (this._coverSig() === sig) {
        this.coverRationale = { sig, highlights, opportunities, loading: false, error: '' };
        this._refreshEditHtml('cover-letter');
      }
    } catch (e) {
      if (this._coverSig() === sig) {
        this.coverRationale = { sig, highlights: [], opportunities: [], loading: false, error: String(e?.message || e) };
      }
    }
  }

  // ----- Edit history (cover letter) ----------------------------------------

  _newId() { return Math.random().toString(36).slice(2, 10); }

  _pushHistory(entry) {
    // Skip if content didn't actually change from the most recent entry.
    const last = this.coverHistory[0];
    if (last && last.content === entry.content) return;
    this.coverHistory = [{ id: this._newId(), ts: Date.now(), ...entry }, ...this.coverHistory].slice(0, 50);
  }

  async _restoreHistory(id) {
    const entry = this.coverHistory.find(h => h.id === id);
    if (!entry) return;
    const a = this.assets['cover-letter'];
    if (!a) return;
    // Snapshot the current state into history as a "before restore" entry
    // so we can come back to it via the same UI.
    this._pushHistory({ source: 'pre-restore', content: a.content, label: 'Before restore' });
    try {
      await writeRoleAsset(this.slug, 'cover-letter', entry.content);
      this.assets = {
        ...this.assets,
        'cover-letter': { ...a, content: entry.content, saveStatus: 'saved', savedAt: Date.now() },
      };
      this._refreshEditHtml('cover-letter');
      this._pushHistory({ source: 'restore', content: entry.content, label: `Restored: ${entry.label || this._truncate(entry.instruction, 60) || 'version'}` });
      this._flashCoverEdit();
    } catch (e) {
      this.assets = { ...this.assets, 'cover-letter': { ...a, error: `restore failed: ${String(e?.message || e)}` } };
    }
  }

  _truncate(s, n) {
    if (!s) return '';
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  // ----- Selection-based edit ----------------------------------------------

  // Watch document selection; if the user has selected non-empty text
  // inside the cover body, show a floating "Edit with AI" popover near
  // the selection end. Selection inside the chat composer / comment rail
  // doesn't trigger.
  _handleSelectionChange() {
    if (this.activeTab !== 'cover-letter' || !this.showChanges) {
      if (this.selectionPopover) this.selectionPopover = null;
      return;
    }
    const sel = window.getSelection();
    // Empty / collapsed selection: only auto-clear when the popover is
    // not currently open. Once open, only an explicit close (×, Escape,
    // submit) dismisses — so clicking into the popover input doesn't
    // race against selection collapse and hide the UI.
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      if (!this.selectionPopover) return;
      const inPopover = document.activeElement?.closest?.('.sel-popover');
      if (inPopover) return;
      // Slight grace period right after first show so the click that
      // sets focus doesn't kill the popover before it mounts.
      if (this.selectionPopover.shownAt && Date.now() - this.selectionPopover.shownAt < 300) return;
      this.selectionPopover = null;
      return;
    }
    const range = sel.getRangeAt(0);
    const body = this.querySelector('.cover-layout__body');
    if (!body || !body.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().trim();
    if (text.length < 3) return;
    const rect = range.getBoundingClientRect();
    this.selectionPopover = {
      visible: true,
      x: rect.left + rect.width / 2,
      y: rect.bottom + 8,
      text,
      savedRange: range.cloneRange(),
      shownAt: Date.now(),
    };
  }

  _closeSelectionPopover() { this.selectionPopover = null; }

  async _sendSelectionChat(instruction) {
    const sp = this.selectionPopover;
    if (!sp || !instruction.trim()) return;
    const phrase = sp.text;
    this.selectionPopover = null;
    await this._applyCoverEdit({
      anchorPhrase: phrase,
      instruction: instruction.trim(),
      source: 'ai-selection',
      label: this._truncate(phrase, 40),
      thread: null,
    });
  }

  // ----- Shared apply pipeline for AI edits ---------------------------------

  // One method drives every AI edit (comment-anchored or selection-based)
  // so shimmer, history, undo, and post-apply refresh stay consistent.
  async _applyCoverEdit({ anchorPhrase, anchorCommentLabel = '', anchorRationale = '', instruction, source, label, commentIdForThread = null }) {
    const a = this.assets['cover-letter'];
    if (!a || !a.content) return;

    this.editingAnchor = { kind: source === 'ai-comment' ? 'comment' : 'selection', commentId: commentIdForThread, phrase: anchorPhrase };
    if (commentIdForThread != null) {
      const prev = this._getThread(commentIdForThread);
      this._setThread(commentIdForThread, {
        messages: [...prev.messages, { role: 'user', text: instruction }],
        sending: true, error: '',
      });
    }
    try {
      const newContent = await applyCoverEdit({
        coverText: a.content,
        instruction,
        comment: { label: anchorCommentLabel || 'User selection', anchor_phrase: anchorPhrase, rationale: anchorRationale },
      });

      // History entry for the version we're replacing (before-state).
      this._pushHistory({ source: 'pre-ai', content: a.content, label: 'Before AI edit', instruction });
      // Undo snapshot pointing to the pre-AI content.
      this.coverUndo = { content: a.content, label, expiresAt: Date.now() + 30_000 };

      await writeRoleAsset(this.slug, 'cover-letter', newContent);
      this.assets = {
        ...this.assets,
        'cover-letter': { ...this.assets['cover-letter'], content: newContent, saveStatus: 'saved', savedAt: Date.now() },
      };
      this._refreshEditHtml('cover-letter');
      this._pushHistory({ source, content: newContent, label, instruction });
      this._flashCoverEdit();

      if (commentIdForThread != null) {
        const cur = this._getThread(commentIdForThread);
        this._setThread(commentIdForThread, {
          messages: [...cur.messages, { role: 'assistant', text: 'Edit applied. Undo available for 30s.' }],
          sending: false, error: '',
        });
      }

      setTimeout(() => { if (this.coverUndo && this.coverUndo.expiresAt <= Date.now()) this.coverUndo = null; }, 30_200);
    } catch (e) {
      if (commentIdForThread != null) {
        const cur = this._getThread(commentIdForThread);
        this._setThread(commentIdForThread, { messages: cur.messages, sending: false, error: String(e?.message || e) });
      } else {
        this.assets = { ...this.assets, 'cover-letter': { ...this.assets['cover-letter'], error: String(e?.message || e) } };
      }
    } finally {
      this.editingAnchor = null;
    }
  }

  // ----- Chat-to-edit on cover-letter comments -----------------------------

  _threadKey(commentId) { return `cover:${commentId}`; }

  _getThread(commentId) {
    return this.threads[this._threadKey(commentId)] || { messages: [], sending: false, error: '' };
  }

  _setThread(commentId, t) {
    this.threads = { ...this.threads, [this._threadKey(commentId)]: t };
  }

  // Opportunity threads do double duty: persist the user's new info to
  // job.global_assets (narrative-additions) AND weave it into the cover
  // letter via the cover-edit pipeline. Both happen in parallel; the
  // user sees the edit immediately and the narrative addition syncs to
  // the Career → Narratives tab.
  async _sendOpportunity(comment, userText) {
    const text = String(userText || '').trim();
    if (!text) return;
    const prev = this._getThread(comment.id);
    this._setThread(comment.id, {
      messages: [...prev.messages, { role: 'user', text }],
      sending: true, error: '',
    });
    const sourceRole = this.role ? `${this.role.company} — ${this.role.title}` : this.slug;
    // Fire the narrative-add in the background; persist failure shouldn't
    // block the cover edit.
    addNarrative({ snippet: text, sourceRole, ask: comment.ask || '' }).catch(() => {});
    try {
      await this._applyCoverEdit({
        anchorPhrase: comment.phrase,
        anchorCommentLabel: 'Opportunity',
        anchorRationale: comment.ask || comment.text || '',
        instruction: `Weave in this new information from the candidate, naturally and concisely: ${text}`,
        source: 'ai-comment',
        label: `Opportunity: ${this._truncate(text, 50)}`,
        commentIdForThread: comment.id,
      });
      // _applyCoverEdit replaces thread messages on success — append a
      // small "saved to narratives" note so the user knows it persisted.
      const cur = this._getThread(comment.id);
      this._setThread(comment.id, {
        messages: [...cur.messages, { role: 'assistant', text: 'Also saved to your narratives.' }],
        sending: false, error: '',
      });
    } catch (e) {
      // _applyCoverEdit already set thread error if commentIdForThread
      // was passed — leave it.
    }
  }

  // Send a chat message anchored to a comment. Thin wrapper around the
  // shared _applyCoverEdit pipeline so shimmer, history, and undo behave
  // identically regardless of where the edit was triggered from.
  async _sendCommentChat(commentId, instruction) {
    const trimmed = String(instruction || '').trim();
    if (!trimmed) return;
    const comment = (this.coverRationale.highlights || []).find((_h, i) => i + 1 === commentId);
    if (!comment) return;
    return this._applyCoverEdit({
      anchorPhrase: comment.phrase,
      anchorCommentLabel: comment.label,
      anchorRationale: comment.rationale,
      instruction: trimmed,
      source: 'ai-comment',
      label: `${comment.label}: ${this._truncate(trimmed, 50)}`,
      commentIdForThread: commentId,
    });
  }

  // Briefly flash the cover-letter body to show that a chat edit just
  // landed. Pure visual cue — no diff overlay (the rationale rail will
  // refresh on its own and surface what's now load-bearing).
  _flashCoverEdit() {
    const body = this.querySelector('.cover-layout__body');
    if (!body) return;
    body.classList.remove('cover-flash');
    // Force reflow so the animation restarts if it was already applied.
    void body.offsetWidth;
    body.classList.add('cover-flash');
    setTimeout(() => body.classList.remove('cover-flash'), 1600);
  }

  async _undoCoverEdit() {
    if (!this.coverUndo) return;
    const { content } = this.coverUndo;
    this.coverUndo = null;
    try {
      await writeRoleAsset(this.slug, 'cover-letter', content);
      this.assets = {
        ...this.assets,
        'cover-letter': {
          ...this.assets['cover-letter'],
          content,
          saveStatus: 'saved',
          savedAt: Date.now(),
        },
      };
      this._refreshEditHtml('cover-letter');
    } catch (e) {
      // Surface the error inline; user can retry or hand-edit.
      this.assets = {
        ...this.assets,
        'cover-letter': { ...this.assets['cover-letter'], error: `undo failed: ${String(e?.message || e)}` },
      };
    }
  }

  // Visual link between a comment card and its highlights — toggle a class
  // on every <mark> with the matching data-rationale id when the card is
  // hovered, so the user can see which sentences a rationale anchors to.
  _highlightRationale(id, on) {
    const root = this.querySelector('.cover-layout__body');
    if (!root) return;
    root.querySelectorAll(`mark[data-rationale="${id}"]`).forEach(el => {
      el.classList.toggle('is-focused', on);
    });
  }

  // Click on a highlight or comment activates the pair — selected highlight
  // gets a deeper background, selected card gets a left bar; everything
  // else dims so the active pair stands out (Google-Docs-style).
  _activateRationale(id) {
    this.activeRationale = (this.activeRationale === id) ? null : id;
    if (this.activeRationale) {
      // Scroll the matching card into view in the rail.
      const card = this.querySelector(`.cover-comment[data-rationale-id="${id}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  _scrollToHighlight(id) {
    const root = this.querySelector('.cover-layout__body');
    const mark = root?.querySelector(`mark[data-rationale="${id}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      this.activeRationale = id;
    }
  }

  // After every render, re-position the comment cards so each one sits at
  // the same vertical offset as its first highlight. Mimics Google Docs
  // marginalia. Cards that would collide stack downward by a small gap.
  _alignComments() {
    const layout = this.querySelector('.cover-layout');
    if (!layout) return;
    const body = layout.querySelector('.cover-layout__body');
    const rail = layout.querySelector('.cover-layout__rail');
    if (!body || !rail) return;
    const cards = Array.from(rail.querySelectorAll('.cover-comment'));
    if (!cards.length) return;
    const layoutTop = layout.getBoundingClientRect().top;
    const positions = [];
    for (const card of cards) {
      const id = card.dataset.rationaleId;
      const mark = body.querySelector(`mark[data-rationale="${id}"]`);
      if (!mark) { card.style.top = ''; continue; }
      const wantedTop = mark.getBoundingClientRect().top - layoutTop;
      // Avoid overlap with previous card.
      const prev = positions[positions.length - 1];
      const minTop = prev ? prev.bottom + 8 : 0;
      const top = Math.max(wantedTop, minTop);
      card.style.top = `${top}px`;
      positions.push({ top, bottom: top + card.offsetHeight });
    }
  }

  updated(changed) {
    super.updated?.(changed);
    this._alignComments();
    this._applyEditingShimmer();
    this._ensureBodyObserver();
    this._ensureGenTimer();
    // Focus the popover input the first time it appears, so the user
    // can start typing without an extra click.
    if (this.selectionPopover?.visible && !this._popoverFocused) {
      const ta = this.querySelector('.sel-popover textarea');
      if (ta) { try { ta.focus(); this._popoverFocused = true; } catch {} }
    }
    if (!this.selectionPopover?.visible && this._popoverFocused) this._popoverFocused = false;
  }

  // Reflow comment cards whenever the body's height changes (window
  // resize, image load, content paste — anything that can shift marks
  // without going through Lit's render cycle).
  _ensureBodyObserver() {
    const body = this.querySelector('.cover-layout__body');
    if (!body) { this._teardownBodyObserver(); return; }
    if (this._bodyObserved === body) return;
    this._teardownBodyObserver();
    this._bodyObserver = new ResizeObserver(() => this._alignComments());
    this._bodyObserver.observe(body);
    this._bodyObserved = body;
  }
  _teardownBodyObserver() {
    if (this._bodyObserver) { try { this._bodyObserver.disconnect(); } catch {} }
    this._bodyObserver = null;
    this._bodyObserved = null;
  }

  // Paint a shimmer + sparkle overlay on whichever <mark> (or first text
  // substring) matches editingAnchor.phrase while an AI edit is in flight.
  _applyEditingShimmer() {
    const body = this.querySelector('.cover-layout__body');
    if (!body) return;
    body.querySelectorAll('.ai-shimmer').forEach(el => el.classList.remove('ai-shimmer'));
    const anchor = this.editingAnchor;
    if (!anchor || !anchor.phrase) return;
    // Comment-anchored: target the mark by data-rationale id when we
    // can map phrase → id.
    if (anchor.kind === 'comment' && anchor.commentId != null) {
      const m = body.querySelector(`mark[data-rationale="${anchor.commentId}"]`);
      if (m) { m.classList.add('ai-shimmer'); return; }
    }
    // Otherwise: best-effort first-substring match across text nodes.
    const phrase = anchor.phrase.toLowerCase();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.nodeValue.toLowerCase().indexOf(phrase);
      if (idx < 0) continue;
      try {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + phrase.length);
        const span = document.createElement('span');
        span.className = 'ai-shimmer ai-shimmer--inline';
        range.surroundContents(span);
      } catch { /* range may cross element boundaries — skip silently */ }
      return;
    }
  }

  // ----- Always-on inline editing + autosave --------------------------------

  // Per-kind autosave debounce timers. Not in component state — they're
  // imperative DOM-side concerns.
  _autosaveTimers = { resume: null, 'cover-letter': null };
  AUTOSAVE_DELAY_MS = 1500;

  // Fires on every keystroke in a contenteditable article. Mark dirty,
  // schedule an autosave for AUTOSAVE_DELAY_MS from now. Don't touch
  // editHtml — we want the DOM (including the user's edits) to remain
  // untouched until the next explicit refresh.
  _onContentEditableInput(kind) {
    const a = this.assets[kind];
    if (!a || a.mode !== 'view') return;
    if (a.saveStatus !== 'dirty') {
      this.assets = { ...this.assets, [kind]: { ...a, saveStatus: 'dirty', error: '' } };
    }
    if (this._autosaveTimers[kind]) clearTimeout(this._autosaveTimers[kind]);
    this._autosaveTimers[kind] = setTimeout(() => this._autosave(kind), this.AUTOSAVE_DELAY_MS);
    // Comment cards anchor to mark positions inside the body — typing
    // moves those marks, so re-align on every keystroke. The cards are
    // absolutely positioned with a CSS transition, so this stays smooth.
    if (kind === 'cover-letter') this._alignComments();
  }

  async _autosave(kind) {
    const a = this.assets[kind];
    if (!a) return;
    const article = this.querySelector(`article[data-edit-kind="${kind}"]`);
    if (!article) return;
    if (a.saveStatus !== 'dirty') return;
    this.assets = { ...this.assets, [kind]: { ...a, saveStatus: 'saving', error: '' } };
    try {
      const td = await getTurndown();
      const md = td.turndown(article.innerHTML).trim();
      if (!md) throw new Error('empty content');
      await writeRoleAsset(this.slug, kind, md);
      // Persist content but NOT editHtml — DOM stays as the user typed it.
      // Highlights refresh next time the user toggles Show comments,
      // regenerates, or navigates back to the tab.
      const cur = this.assets[kind];
      // Skip the commit if the user typed again while saving — we'll
      // catch up on the next debounce.
      if (cur.saveStatus === 'saving') {
        this.assets = { ...this.assets, [kind]: { ...cur, content: md, saveStatus: 'saved', savedAt: Date.now() } };
      } else {
        this.assets = { ...this.assets, [kind]: { ...cur, content: md } };
      }
      // Track manual edits in cover-letter history so the user can flip
      // back to any prior version (theirs or the AI's).
      if (kind === 'cover-letter') {
        this._pushHistory({ source: 'manual', content: md, label: 'Manual edit' });
      }
    } catch (e) {
      this.assets = { ...this.assets, [kind]: { ...this.assets[kind], saveStatus: 'error', error: String(e?.message || e) } };
    }
  }

  // Manual save (Cmd/Ctrl+S) — flushes the debounce immediately.
  _flushSave(kind) {
    if (this._autosaveTimers[kind]) {
      clearTimeout(this._autosaveTimers[kind]);
      this._autosaveTimers[kind] = null;
    }
    const a = this.assets[kind];
    if (a?.saveStatus === 'dirty') return this._autosave(kind);
  }

  _renderChromeFromPrefill() {
    const r = this.role;
    if (!r) return null;
    return html`
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/ladder/jobs/">Jobs</a>
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
            <h1>${this._renderTitleEditable(r)}</h1>
            <p class="role-header__sub">${this._renderCompanyEditable(r)}${r.sector ? html`<span class="role-header__sub-sep"> · ${r.sector}</span>` : nothing}</p>
          </div>
        </div>
        <div class="role-header__actions">
          ${r.sourceEmailUrl ? html`
            <a class="btn btn--sm" href=${r.sourceEmailUrl} target="_blank" rel="noopener noreferrer"
               title="Open the originating email in Gmail">📧 Source email</a>
          ` : nothing}
          ${r.url ? html`
            <button class="btn apply-launch-btn" @click=${() => this._launchApply()}>
              Apply with /ladder ✨
            </button>
            <a class="btn btn--sm" href=${r.url} target="_blank" rel="noopener noreferrer"
               @click=${() => engageRole(this.slug)} title="Open the posting in a new tab">Posting ↗</a>
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
    // <ladder-apply> always renders so the launch button on every state
    // path can reach it. Lit reuses the element across re-renders so
    // its internal state survives state transitions.
    const takeover = html`<ladder-apply id="apply-takeover" @apply:close=${() => this._onApplyClose()}></ladder-apply>`;

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
          ${takeover}
        `;
      }
      return html`
        <div class="skeleton" style="width:140px;height:14px;margin-bottom:var(--space-3);display:block;"></div>
        <div class="skeleton" style="width:60%;height:36px;margin-bottom:var(--space-2);display:block;"></div>
        <div class="skeleton" style="width:40%;height:18px;margin-bottom:var(--space-5);display:block;"></div>
        ${this._renderShimmerBody()}
        ${takeover}
      `;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder" style="border-color:var(--error);color:var(--error);">
        <h2>Couldn't load this role</h2>
        <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
      </div>${takeover}`;
    }
    const r = this.role;
    return html`
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="/ladder/jobs/">Jobs</a>
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
            <h1>${this._renderTitleEditable(r)}</h1>
            <p class="role-header__sub">${this._renderCompanyEditable(r)}${r?.sector ? html`<span class="role-header__sub-sep"> · ${r.sector}</span>` : nothing}</p>
            ${this._renderApplyRequirements(r)}
          </div>
        </div>
        <div class="role-header__actions">
          ${r?.sourceEmailUrl ? html`
            <a class="btn btn--sm" href=${r.sourceEmailUrl} target="_blank" rel="noopener noreferrer"
               title="Open the originating email in Gmail">📧 Source email</a>
          ` : nothing}
          ${r?.url ? html`
            <button class="btn apply-launch-btn" @click=${() => this._launchApply()}>
              Apply with /ladder ✨
            </button>
            <a class="btn btn--sm" href=${r.url} target="_blank" rel="noopener noreferrer"
               @click=${() => engageRole(this.slug)} title="Open the posting in a new tab">
              Posting ↗
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

      ${this._renderProcessTracker()}

      <section class="asset-panel">
        ${this.activeTab === 'details'  ? this._renderDetails()
        : this.activeTab === 'activity' ? this._renderActivityTab()
        : this._renderAssetTab(this.activeTab)}
      </section>

      ${takeover}
    `;
  }

  // "Application requirements" line (Phase 16.1) — the ease tier chip plus a
  // one-line breakdown of what the form actually asks for, so the user knows
  // whether this is a 2-minute submit before opening anything.
  _renderApplyRequirements(r) {
    const info = applyEaseInfo(r);
    if (!info) return nothing;
    const m = r?.applyEaseMeta || {};
    const bits = [];
    if (m.requires_resume) bits.push('resume');
    if (m.requires_cover_letter) bits.push('cover letter');
    if (typeof m.questions === 'number' && m.questions > 0) {
      const auto = m.questions - (m.required_essays || 0) - (m.short_answers || 0);
      if (auto > 0) bits.push(`${auto} quick question${auto === 1 ? '' : 's'}`);
    }
    if (m.short_answers > 0) bits.push(`${m.short_answers} short answer${m.short_answers === 1 ? '' : 's'}`);
    if (m.required_essays > 0) bits.push(`${m.required_essays} essay${m.required_essays === 1 ? '' : 's'}`);
    return html`
      <p class="role-header__apply-req">
        <span class="ease-chip ease-chip--${info.tier}" title=${info.title}>${info.label}</span>
        ${bits.length ? html`<span class="muted">Application asks for: ${bits.join(', ')}.</span>` : nothing}
        ${info.tier === 'easy' ? html`<span class="muted">~2 min with your saved details.</span>` : nothing}
      </p>
    `;
  }

  _launchApply() {
    // Engagement signal — same as the "Posting ↗" outbound click.
    try { engageRole(this.slug); } catch { /* silent */ }
    const el = this.renderRoot.querySelector('#apply-takeover');
    if (!el) {
      console.warn('[job-role-detail] apply takeover element missing');
      return;
    }
    el.launch({ slug: this.slug, role: this.role });
    // Reflect in URL so back-button closes the takeover instead of leaving the page.
    try {
      const u = new URL(location.href);
      u.searchParams.set('apply', '1');
      history.pushState({ apply: true }, '', u.toString());
    } catch { /* ignore */ }
  }
  _onApplyClose() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('apply')) {
        u.searchParams.delete('apply');
        history.replaceState(null, '', u.toString());
      }
    } catch { /* ignore */ }
  }

  _renderProcessTracker() {
    const po = this.processOutline;
    if (!po || !Array.isArray(po.rounds) || !po.rounds.length) return nothing;
    const rounds = po.rounds.slice().sort((a, b) => a.order - b.order);
    return html`
      <div class="process-tracker" title="Source: ${po.source || 'unknown'}">
        ${rounds.map((r, i) => html`
          ${i > 0 ? html`<span class="process-tracker__sep">→</span>` : nothing}
          <span class="process-tracker__pill ${r.completed ? 'process-tracker__pill--done' : ''}">
            ${r.label}${r.completed ? ' ✓' : ''}
          </span>
        `)}
        <span class="process-tracker__source">${po.source ? po.source.replace(/_/g, ' ') : ''}</span>
      </div>
    `;
  }

  _renderActivityTab() {
    if (this.activityState === 'loading' || this.activityState === 'idle') {
      return html`<div class="placeholder"><p class="muted">Loading activity…</p></div>`;
    }
    if (this.activityState === 'error') {
      return html`<div class="placeholder"><p class="muted">Couldn't load activity timeline.</p></div>`;
    }
    if (!this.activityEvents.length) {
      return html`
        <div class="placeholder">
          <h2>No activity yet</h2>
          <p>Emails from this company on a Gmail thread linked to this role will appear here once classified.</p>
        </div>
      `;
    }
    return html`
      <div class="activity-timeline">
        ${this.activityEvents.map(ev => this._renderActivityEvent(ev))}
      </div>
    `;
  }

  _renderActivityEvent(ev) {
    const cls = 'activity-event'
      + (ev.auto_applied ? ' activity-event--auto' : '')
      + (ev.needs_review && !ev.reviewed_at ? ' activity-event--review' : '');
    const when = fmtRelativeTime(ev.received_at);
    const gmailUrl = ev.gmail_api_id
      ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(ev.gmail_thread_id || ev.gmail_api_id)}`
      : null;
    return html`
      <article class=${cls}>
        <span class="activity-event__rail" aria-hidden="true"></span>
        <div>
          <div class="activity-event__head">
            <span class="activity-event__type">${eventTypeLabel(ev.event_type)}</span>
            ${ev.round_label ? html`<span class="activity-event__round">${ev.round_label}${ev.round_n ? ` · round ${ev.round_n}` : ''}</span>` : nothing}
            <span class="activity-event__time" title=${ev.received_at}>${when}</span>
          </div>
          <div class="activity-event__summary">${ev.summary || '(no summary)'}</div>
          <div class="activity-event__meta">
            ${this._activityAutoActionLabel(ev)}
            ${ev.needs_user_reply ? html`<span class="activity-event__reply-flag">You haven't replied yet</span>` : nothing}
            ${gmailUrl ? html`<a href=${gmailUrl} target="_blank" rel="noopener noreferrer">Source email</a>` : nothing}
            ${ev.confidence != null ? html`<span class="muted">Confidence ${(ev.confidence * 100).toFixed(0)}%</span>` : nothing}
            ${this._activityActions(ev)}
          </div>
        </div>
      </article>
    `;
  }

  // What the system did for this event (undo-able), or nothing.
  _activityAutoActionLabel(ev) {
    if (ev.undone_at) return html`<span class="muted">Undone</span>`;
    switch (ev.auto_action) {
      case 'stage_offer':    return html`<span class="muted">Moved to Offer automatically</span>`;
      case 'archived':       return html`<span class="muted">Archived automatically</span>`;
      case 'archived_stale': return html`<span class="muted">Archived — no response in 30 days</span>`;
      case 'stage_advance':  return html`<span class="muted">Auto-advanced to ${ev.detected_stage || '—'}</span>`;
      default:
        return ev.auto_applied ? html`<span class="muted">Auto-advanced to ${ev.detected_stage || '—'}</span>` : nothing;
    }
  }

  // Single action per event, mirroring the Updates queue: Undo for
  // auto-actions, one-click resolve for below-floor prompts, Mark as seen
  // for everything else still unreviewed.
  _activityActions(ev) {
    if (ev.auto_action && !ev.undone_at) {
      return html`
        <button class="activity-event__ack" @click=${(e) => this._onUndoActivityEvent(ev, e)}>Undo</button>`;
    }
    if (ev.needs_review && !ev.reviewed_at) {
      if (ev.event_type === 'offer_received') {
        return html`
          <button class="activity-event__ack" @click=${(e) => this._onResolveActivityEvent(ev, 'stage_offer', e)}>Move to offer</button>`;
      }
      if (ev.event_type === 'rejection_any_stage') {
        return html`
          <button class="activity-event__ack" @click=${(e) => this._onResolveActivityEvent(ev, 'archive', e)}>Archive role</button>`;
      }
      return html`
        <button class="activity-event__ack" @click=${(e) => this._onAckActivityEvent(ev, e)}>Mark as seen</button>`;
    }
    return nothing;
  }
}

function fmtRelativeTime(iso) {
  if (!iso) return '';
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 14) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch { return ''; }
}

customElements.define('ladder-role-detail', JobRoleDetail);
