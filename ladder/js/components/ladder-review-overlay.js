// ladder-review-overlay — full-screen, one-role-at-a-time review flow for
// For You. The inbox list opens this instead of exposing accept/reject on
// every row: progress dots across the queue, a summarized role card with
// qualitative verdicts, and exactly two decisions — "Not for me" / "Save".
//
// The parent (<ladder-recommendations-table>) owns the queue. This component
// dispatches review-save / review-dismiss / review-close / review-watch /
// review-block events and lets the parent mutate `items`; when the current
// item is removed the next one slides into `index` automatically.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { fetchRecommendation }, { logoSrc, logoInitial }, { renderVerdicts, renderScoreModal, scoreClass }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../logo.js' + V),
  import('./ladder-fit-modal.js' + V),
]);

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  const d = Math.floor(ms / 86400000);
  if (d < 1) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7); if (w < 5) return `${w}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export class LadderReviewOverlay extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    items:  { attribute: false },
    index:  { attribute: false },
    _full:      { state: true },
    _scoreOpen: { state: true },
    _menuOpen:  { state: true },
  };

  constructor() {
    super();
    this.items = [];
    this.index = 0;
    this._full = null;       // fetchRecommendation result for the current rec
    this._fullFor = null;    // rec id the fetch belongs to
    this._scoreOpen = null;  // 'fit' | 'candidate' | null
    this._menuOpen = false;
    this._baseUrl = null;    // URL to restore (rec param stripped) on close
    this._onKey = (e) => {
      // Don't hijack keys while typing; let the score modal own its own keys.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Escape') { this._close(); return; }
      if (this._scoreOpen) return;
      // Left/Right walk the queue without deciding (matches the Skip button).
      if (e.key === 'ArrowRight') { e.preventDefault(); this._go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this._go(-1); }
    };
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this._onKey);
    document.body.style.overflow = 'hidden';
    // Remember where we opened from (without any stale ?rec=) so closing the
    // viewer restores a clean URL; while open, the current rec's id is
    // reflected into the URL by _syncUrl() so the role is shareable and
    // survives a refresh.
    try {
      const u = new URL(location.href);
      u.searchParams.delete('rec');
      this._baseUrl = u.pathname + u.search + u.hash;
    } catch { this._baseUrl = null; }
  }
  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
    document.body.style.overflow = '';
    if (this._baseUrl != null) { try { history.replaceState(history.state, '', this._baseUrl); } catch { /* */ } }
    super.disconnectedCallback();
  }

  get rec() { return this.items?.[this.index] || null; }

  willUpdate() {
    const rec = this.rec;
    if (rec && this._fullFor !== rec.id) {
      this._fullFor = rec.id;
      this._full = null;
      this._scoreOpen = null;
      this._menuOpen = false;
      this._syncUrl(rec.id);
      fetchRecommendation(rec.id)
        .then(full => { if (this._fullFor === rec.id) this._full = full; })
        .catch(() => { /* base row data is enough to decide */ });
      // New card — scroll its body back to the top.
      requestAnimationFrame(() => { this.querySelector('.review__scroll')?.scrollTo(0, 0); });
    }
  }

  // Reflect the current rec's unique id into the URL (?rec=<id>) without a
  // navigation, so the open role is shareable, survives a refresh, and the
  // arrow-key / Skip traversal keeps the address bar in sync.
  _syncUrl(id) {
    try {
      const u = new URL(location.href);
      if (id) u.searchParams.set('rec', id); else u.searchParams.delete('rec');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch { /* history unavailable — non-critical */ }
  }

  // Walk the queue without acting on the current role (Skip / arrow keys).
  // Clamped to the queue bounds; keeps the parent's index in sync so a later
  // save/dismiss re-render doesn't snap us back.
  _go(delta) {
    const n = this.items?.length || 0;
    if (!n) return;
    const next = Math.min(n - 1, Math.max(0, this.index + delta));
    if (next === this.index) return;
    this.index = next;
    this.dispatchEvent(new CustomEvent('review-index', { detail: { index: next }, bubbles: true }));
  }

  _close()  { this.dispatchEvent(new CustomEvent('review-close', { bubbles: true })); }
  _emit(type) {
    const rec = this.rec;
    if (!rec) return;
    this.dispatchEvent(new CustomEvent(type, { detail: { rec }, bubbles: true }));
  }

  _renderDots() {
    const n = this.items.length;
    if (n <= 1) return nothing;
    if (n > 12) {
      return html`<span class="review__counter">${this.index + 1} of ${n}</span>`;
    }
    return html`
      <div class="review__dots" aria-label=${`Role ${this.index + 1} of ${n}`}>
        ${this.items.map((_, i) => html`
          <span class=${'review__dot' + (i === this.index ? ' is-current' : '')}></span>
        `)}
      </div>
    `;
  }

  _renderLogo(rec) {
    const src = (this._full?.logoUrl) || logoSrc(rec);
    if (!src) return html`<div class="review__logo review__logo--placeholder" aria-hidden="true">${logoInitial(rec.company)}</div>`;
    return html`<img class="review__logo" src=${src} alt="" loading="lazy"
                     @error=${(e) => {
                       const d = document.createElement('div');
                       d.className = 'review__logo review__logo--placeholder';
                       d.textContent = logoInitial(rec.company);
                       e.target.replaceWith(d);
                     }}>`;
  }

  render() {
    const rec = this.rec;
    if (!rec) {
      // Queue drained mid-review — brief done state.
      return html`
        <div class="review" role="dialog" aria-modal="true" aria-label="Review roles">
          <header class="review__bar">
            <span></span>
            <button class="review__close" aria-label="Close" @click=${() => this._close()}>×</button>
          </header>
          <div class="review__scroll"><div class="review__done">
            <h2>All caught up</h2>
            <p class="muted">No more roles to review.</p>
          </div></div>
        </div>
      `;
    }
    const full = this._full;
    const meta = [rec.company, rec.location || full?.location].filter(Boolean).join(' • ');
    const salary = full?.salary || rec.salary || '';
    const posting = full?.canonicalUrl || full?.url || rec.url;
    const bullets = Array.isArray(full?.matchBullets) ? full.matchBullets : [];
    const summary = full?.fitSummary || '';
    const description = full?.description || '';
    const fit = rec.fitScore ?? null;
    const cand = rec.candidateScore ?? null;
    const companyDescription = full?.companyDescription || rec.companyDescription || '';
    const scoreRow = { ...rec, ...(full || {}), score: fit };
    return html`
      <div class="review" role="dialog" aria-modal="true" aria-label="Review role">
        <header class="review__bar">
          ${this._renderDots()}
          <div class="review__bar-actions">
            <div class="row-menu">
              <button class="row-menu__trigger review__more" aria-label="More actions"
                      @click=${(e) => { e.stopPropagation(); this._menuOpen = !this._menuOpen; }}>⋯</button>
              ${this._menuOpen ? html`
                <div class="row-menu__pop" @click=${(e) => e.stopPropagation()}>
                  <button class="row-menu__item" @click=${() => { this._menuOpen = false; this._emit('review-watch'); }}>
                    Watch ${rec.company || 'this company'}
                  </button>
                  <button class="row-menu__item" @click=${() => { this._menuOpen = false; this._emit('review-block'); }}>
                    Don't recommend ${rec.company || 'this company'}
                  </button>
                </div>
              ` : nothing}
            </div>
            <button class="review__close" aria-label="Close" @click=${() => this._close()}>×</button>
          </div>
        </header>

        <div class="review__scroll" @click=${() => { this._menuOpen = false; }}>
          <section class="review__card">
            <header class="review__head">
              ${this._renderLogo(rec)}
              <div class="review__head-text">
                <h2 class="review__title">${rec.title || '(untitled)'}</h2>
                ${meta ? html`<p class="review__meta">${meta}</p>` : nothing}
                <div class="review__scores">
                  <button class=${scoreClass(fit) + ' fit-pill--button review__score'}
                          title="Fit score — tap for the full breakdown"
                          @click=${() => { this._scoreOpen = 'fit'; }}>
                    ${fit ?? '—'}<span class="review__score-label">fit</span>
                  </button>
                  <button class=${scoreClass(cand) + ' fit-pill--button review__score'}
                          title="Candidate strength — tap for the full breakdown"
                          @click=${() => { this._scoreOpen = 'candidate'; }}>
                    ${cand ?? '—'}<span class="review__score-label">strength</span>
                  </button>
                </div>
                ${salary ? html`<p class="review__salary">${salary}</p>` : nothing}
                ${companyDescription ? html`<p class="review__company-desc">${companyDescription}</p>` : nothing}
                <p class="review__sub muted">
                  ${rec.suggestedAt ? `Surfaced ${relTime(rec.suggestedAt)}` : ''}
                  ${full?.sourceLabel ? ` • via ${full.sourceLabel}` : ''}
                  ${posting ? html` • <a href=${posting} target="_blank" rel="noopener">Open posting ↗</a>` : nothing}
                </p>
              </div>
            </header>
          </section>

          ${bullets.length ? html`
            <section class="review__section">
              <h3 class="review__section-title">Why it surfaced</h3>
              <ul class="review__bullets">
                ${bullets.map(b => html`<li>${unsafeHTML(renderMarkdown(String(b).replace(/^\s*[•\-\*]\s*/, '')))}</li>`)}
              </ul>
            </section>
          ` : summary ? html`
            <section class="review__section">
              <h3 class="review__section-title">The read</h3>
              <p class="review__summary">${summary}</p>
            </section>
          ` : nothing}

          <section class="review__section">
            ${renderVerdicts(rec)}
          </section>

          ${description ? html`
            <details class="jd-collapse">
              <summary>Original posting text</summary>
              <div class="kb-doc jd-collapse__body">${unsafeHTML(renderMarkdown(description))}</div>
            </details>
          ` : nothing}
        </div>

        <footer class="review__foot">
          <button class="btn review__btn review__btn--dismiss" @click=${() => this._emit('review-dismiss')}>
            Not for me
          </button>
          <button class="btn review__btn review__btn--skip" @click=${() => this._go(1)}
                  ?disabled=${this.index >= this.items.length - 1}
                  title="Skip for now (→) — stays in your queue">
            Skip
          </button>
          <button class="btn btn--accent review__btn" @click=${() => this._emit('review-save')}>
            Save
          </button>
        </footer>

        ${this._scoreOpen ? renderScoreModal(scoreRow, () => { this._scoreOpen = null; }, this._scoreOpen) : nothing}
      </div>
    `;
  }
}

customElements.define('ladder-review-overlay', LadderReviewOverlay);
