// ladder-rec-detail — pre-save detail page for a recommended role.
// Reached from For You via /ladder/jobs/<slug>/?rec=<id> (the 404 rewrite
// lands on /ladder/jobs/drill/?slug=…&rec=… and app.js mounts this instead
// of <ladder-role-detail> when ?rec= is present). Shows everything we know
// about the rec — fit + candidate-strength breakdowns, summaries, match
// bullets, JD — so the save/skip decision happens before it enters the
// pipeline. Saving hands off to the normal role detail page.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { fetchRecommendation, addRole, dismissRecommendation }, { logoSrc, logoInitial }, { renderFitCardBody, renderCandidateCardBody, scoreClass, weakestFitDims }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../logo.js' + V),
  import('./ladder-fit-modal.js' + V),
]);

// Wildcard band — keep in sync with the recommendations function's
// WILDCARD_MIN_STRENGTH / WILDCARD_MAX_FIT.
export function isWildcardRec(rec) {
  return rec?.candidateScore != null && rec.candidateScore >= 65
    && rec.fitScore != null && rec.fitScore < 50;
}

export class LadderRecDetail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state:  { state: true },
    error:  { state: true },
    rec:    { state: true },
    saving: { state: true },
    dismissed: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.rec = null;
    this.saving = false;
    this.dismissed = false;
    const params = new URLSearchParams(location.search);
    this.recId = params.get('rec') || '';
    this.slug = (params.get('slug') || '').toLowerCase();

    // Restore the pretty path the 404 rewrite stashed, keeping ?rec so a
    // reload routes back here instead of into the pipeline role detail.
    const pretty = sessionStorage.getItem('job:prettyPath');
    if (pretty && /^\/ladder\/jobs\/[a-z0-9-]+\/?$/.test(pretty)) {
      sessionStorage.removeItem('job:prettyPath');
      history.replaceState(null, '', pretty.replace(/\/?$/, '/') + `?rec=${this.recId}`);
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
    if (!this.recId) { this.state = 'error'; this.error = 'Missing rec id'; return; }
    this.state = 'loading';
    try {
      this.rec = await fetchRecommendation(this.recId);
      this.dismissed = Boolean(this.rec?.dismissedAt);
      this.state = 'loaded';
      if (this.rec) document.title = `${this.rec.company} — ${this.rec.title} — /ladder`;
    } catch (e) {
      this.state = 'error';
      this.error = String(e);
    }
  }

  async _onSave() {
    const rec = this.rec;
    if (!rec || this.saving) return;
    this.saving = true;
    try {
      const r = await addRole({
        url: rec.url,
        title: rec.title,
        company: rec.company,
        source: 'Network',
        fromRecommendationId: rec.id,
      });
      // Hand off to the full pipeline detail page for the saved role.
      window.location.assign(`/ladder/jobs/${r.slug}/`);
    } catch (e) {
      console.warn('[rec-detail] save failed', e);
      this.error = `Save failed: ${e.message || e}`;
      this.saving = false;
    }
  }

  async _onDismiss() {
    if (!this.rec) return;
    this.dismissed = true;
    try { await dismissRecommendation(this.rec.id); } catch {}
  }

  _renderBanner() {
    const rec = this.rec;
    if (rec.addedToPipelineSlug) {
      return html`<div class="rec-detail__banner">
        Already in your pipeline —
        <a href=${`/ladder/jobs/${rec.addedToPipelineSlug}/`}>open the saved role →</a>
      </div>`;
    }
    if (rec.closedAt) {
      return html`<div class="rec-detail__banner rec-detail__banner--warn">
        This posting looks closed (${rec.closureReason || 'expired'}). The link may no longer work.
      </div>`;
    }
    if (this.dismissed) {
      return html`<div class="rec-detail__banner">
        Dismissed. <a href="/ladder/jobs/recommended/">Back to For You →</a>
      </div>`;
    }
    return nothing;
  }

  _renderWildcardCallout() {
    const rec = this.rec;
    if (!isWildcardRec(rec)) return nothing;
    const weak = weakestFitDims(rec);
    return html`
      <aside class="rec-detail__wildcard">
        <strong>🃏 Wildcard</strong> — you'd likely be a standout candidate
        (strength ${rec.candidateScore}), but it scores low on your stated
        criteria (fit ${rec.fitScore}).
        <ul>
          ${weak.map(w => html`<li><strong>${w.label}:</strong> ${w.rationale || 'weak signal'}</li>`)}
          ${(rec.hardFails || []).map(f => html`<li><strong>Hard fail:</strong> ${f}</li>`)}
        </ul>
        Worth asking whether the criteria or the role is wrong.
      </aside>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`<div class="rec-detail"><div class="skeleton" style="width:60%;height:28px;"></div></div>`;
    }
    if (this.state === 'error' || !this.rec) {
      return html`<div class="rec-detail">
        <p class="muted">Couldn't load this recommendation. ${this.error}</p>
        <a href="/ladder/jobs/recommended/">Back to For You →</a>
      </div>`;
    }
    const rec = this.rec;
    const meta = [rec.company, rec.location, rec.salary].filter(Boolean).join('  •  ');
    const posting = rec.canonicalUrl || rec.url;
    const bullets = Array.isArray(rec.matchBullets) ? rec.matchBullets : [];
    const logo = rec.logoUrl || logoSrc(rec);
    return html`
      <div class="rec-detail">
        ${this._renderBanner()}
        <header class="rec-detail__head">
          ${logo
            ? html`<img class="rec-detail__logo" src=${logo} alt="" loading="lazy"
                        @error=${(e) => { e.target.style.display = 'none'; }}/>`
            : html`<div class="rec-detail__logo rec-detail__logo--placeholder" aria-hidden="true">${logoInitial(rec.company)}</div>`}
          <div class="rec-detail__title-block">
            <h1>${rec.title || '(untitled)'}</h1>
            ${meta ? html`<p class="rec-detail__meta">${meta}</p>` : nothing}
            <p class="rec-detail__source muted">
              ${rec.sourceLabel ? html`via ${rec.sourceLabel}` : nothing}
              ${rec.sourceEmailUrl ? html` · <a href=${rec.sourceEmailUrl} target="_blank" rel="noopener">📧 source email</a>` : nothing}
              ${rec.enrichmentStatus === 'unresolved' ? html` · <span class="enrichment-badge">verifying source</span>` : nothing}
            </p>
          </div>
          <div class="rec-detail__scores">
            <span class=${scoreClass(rec.fitScore)} title="Fit score">${rec.fitScore ?? '—'}</span>
            <span class=${scoreClass(rec.candidateScore)} title="Candidate strength">${rec.candidateScore ?? '—'}</span>
          </div>
        </header>

        <div class="rec-detail__actions">
          <button class="btn btn--accent" ?disabled=${this.saving || Boolean(rec.addedToPipelineSlug)}
                  @click=${() => this._onSave()}>
            ${this.saving ? 'Saving…' : 'Save role'}
          </button>
          ${posting ? html`
            <a class="btn" href=${posting} target="_blank" rel="noopener">Open posting ↗</a>
          ` : nothing}
          ${!this.dismissed && !rec.addedToPipelineSlug ? html`
            <button class="link-subtle" @click=${() => this._onDismiss()}>Dismiss</button>
          ` : nothing}
        </div>

        ${this._renderWildcardCallout()}

        ${bullets.length ? html`
          <article class="role-card">
            <header class="role-card__head"><h3>Why it surfaced</h3></header>
            <ul class="rec-detail__bullets">
              ${bullets.map(b => html`<li>${unsafeHTML(renderMarkdown(String(b)))}</li>`)}
            </ul>
          </article>
        ` : nothing}

        <div class="rec-detail__cards">
          <article class="role-card role-card--fit fit-modal">
            <header class="role-card__head"><h3>Fit</h3></header>
            ${renderFitCardBody(rec, { summary: rec.fitSummary || null })}
          </article>
          <article class="role-card role-card--fit fit-modal">
            <header class="role-card__head"><h3>Candidate strength</h3></header>
            ${renderCandidateCardBody(rec, { summary: rec.candidateSummary || null })}
          </article>
        </div>

        ${rec.description ? html`
          <article class="role-card">
            <header class="role-card__head"><h3>Job description</h3></header>
            <div class="kb-doc rec-detail__jd">${unsafeHTML(renderMarkdown(rec.description))}</div>
          </article>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('ladder-rec-detail', LadderRecDetail);
