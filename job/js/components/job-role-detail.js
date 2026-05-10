// job-role-detail — per-role detail page with Details / Resume / Cover Letter
// tabs. The Details tab is the default landing and shows AI-generated cards
// (Why it fits / Risks / Candidate strength) plus role metadata. Apply button
// in the top-right opens the posting in a new tab.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { generateAsset, fetchPipeline, readRolePrefill }, { readRoleAsset, writeRoleAsset }, { logoSrc, logoInitial }, { diffMarkdown, highlightPhrases }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../roleAsset.js' + V),
  import('../logo.js' + V),
  import('../diff.js' + V),
]);

const BASE_RESUME_SLUG = '__base__';

const TABS = [
  { id: 'details',      label: 'Role details' },
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
    baseResume: { state: true },     // { content } | null — canonical untargeted resume, source of truth for diff
    showChanges: { state: true },    // bool — toggle the diff/highlight overlay on resume + cover tabs
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
    this.baseResume = null;
    this.showChanges = true;

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

  _toggleChanges() { this.showChanges = !this.showChanges; }

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
    const canDiff = (kind === 'resume' || kind === 'cover-letter') && a.mode === 'view';
    const showingChanges = canDiff && this.showChanges;

    let bodyHtml = '';
    let coverComments = [];
    if (a.mode === 'view') {
      if (kind === 'resume' && showingChanges && this.baseResume?.content) {
        bodyHtml = renderMarkdown(diffMarkdown(this.baseResume.content, a.content));
      } else if (kind === 'cover-letter' && showingChanges) {
        const { html: marked, comments } = highlightPhrases(a.content, this._coverHighlightSources());
        bodyHtml = renderMarkdown(marked);
        coverComments = comments;
      } else {
        bodyHtml = renderMarkdown(a.content);
      }
    }

    const isCover = kind === 'cover-letter';

    return html`
      ${(kind === 'resume' || kind === 'cover-letter') ? this._renderTailoringCallout(kind) : nothing}
      ${(kind === 'resume' || kind === 'cover-letter') ? this._renderChangeLog(kind) : nothing}
      <div class="asset-toolbar">
        ${a.mode === 'view' ? html`
          <button class="btn btn--sm" @click=${() => this._enterEdit(kind)}>Edit</button>
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
              No base resume yet — set one in <a href="/job/history/?tab=base">Career → Base resume</a>.
            </span>
          ` : nothing}
        ` : html`
          <button class="btn btn--sm btn--primary" ?disabled=${!a.dirty || a.saving} @click=${() => this._saveEdit(kind)}>
            ${a.saving ? 'Saving…' : 'Save'}
          </button>
          <button class="btn btn--sm" @click=${() => this._cancelEdit(kind)}>Cancel</button>
        `}
        ${a.error ? html`<span class="muted" style="color:var(--error);">${a.error}</span>` : nothing}
      </div>
      ${a.mode === 'edit'
        ? html`<textarea class="asset-editor asset-editor--inline" .value=${a.draft} @input=${(e) => this._onDraftInput(kind, e)} @blur=${() => a.dirty && this._saveEdit(kind)}></textarea>`
        : (isCover && coverComments.length
          ? html`
            <div class="cover-layout">
              <article class="kb-doc asset-doc cover-layout__body">${unsafeHTML(bodyHtml)}</article>
              <aside class="cover-layout__rail" aria-label="Rationale">
                <h4 class="cover-rail__title">Rationale</h4>
                <p class="muted cover-rail__hint">Why each highlighted phrase is here.</p>
                ${coverComments.map(c => html`
                  <article class="cover-comment" data-rationale-id=${c.id}
                           @mouseenter=${() => this._highlightRationale(c.id, true)}
                           @mouseleave=${() => this._highlightRationale(c.id, false)}>
                    <header class="cover-comment__head">
                      <span class="cover-comment__num">${c.id}</span>
                      <span class="cover-comment__label">${c.label}</span>
                    </header>
                    <div class="cover-comment__body">${unsafeHTML(renderMarkdown(c.text))}</div>
                  </article>
                `)}
              </aside>
            </div>
          `
          : html`<article class="kb-doc asset-doc">${unsafeHTML(bodyHtml)}</article>`)}
    `;
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
