// job-recommendations — horizontal carousel of recommended roles above
// the Jobs table. Each card matches the ratecard mockup: logo, title,
// company · location · salary, posted, source, and 3 markdown bullets
// explaining why it matches. "Add to pipeline" sends to add-role.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { fetchRecommendations, dismissRecommendation, addRole }, { logoSrc, logoInitial }, { renderFitModal }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
  import('../logo.js' + V),
  import('./job-fit-modal.js' + V),
]);

function relTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7)  return `${d}d ago`;
  const w = Math.floor(d / 7);  if (w < 5)  return `${w}w ago`;
  const mo = Math.floor(d / 30); return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export class JobRecommendations extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    items: { state: true },
    error: { state: true },
    addingId: { state: true },
    selectedRec: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.items = [];
    this.error = '';
    this.addingId = null;
    this.selectedRec = null;
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
    this.state = 'loading';
    try {
      const data = await fetchRecommendations();
      this.items = data.recommendations || [];
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  async _onDismiss(id) {
    this.items = this.items.filter(r => r.id !== id);
    try { await dismissRecommendation(id); } catch {}
  }

  async _onAdd(rec) {
    if (this.addingId) return;
    this.addingId = rec.id;
    try {
      const r = await addRole({
        url: rec.url,
        title: rec.title,
        company: rec.company,
        sector: rec.sourceLabel === 'Web-sourced' ? '' : '',
        source: 'Network',
        fromRecommendationId: rec.id,
      });
      // Optimistic: pop from the carousel.
      this.items = this.items.filter(x => x.id !== rec.id);
      // Invite the pipeline to refresh.
      document.dispatchEvent(new CustomEvent('job:pipeline:refresh', { detail: { slug: r.slug } }));
    } catch (e) {
      console.warn('[recommendations] add failed', e);
    } finally {
      this.addingId = null;
    }
  }

  _openFitModal(rec) {
    this.selectedRec = {
      company:   rec.company,
      title:     rec.title,
      score:     rec.fitScore,
      breakdown: rec.breakdown || rec.fitBreakdown || {},
      hardFails: rec.hardFails || [],
    };
  }
  _closeFitModal() { this.selectedRec = null; }

  _fitClass(s) {
    if (s == null) return 'fit-pill fit-pill--poor';
    if (s >= 70) return 'fit-pill fit-pill--strong';
    if (s >= 50) return 'fit-pill fit-pill--ok';
    if (s >= 30) return 'fit-pill fit-pill--weak';
    return 'fit-pill fit-pill--poor';
  }

  _renderCard(rec) {
    const meta = [rec.company, rec.location, rec.salary].filter(Boolean).join('  •  ');
    const bullets = Array.isArray(rec.matchBullets) ? rec.matchBullets : [];
    return html`
      <article class="rec-card" role="listitem">
        <header class="rec-card__head">
          ${(() => {
            const src = rec.logoUrl || logoSrc(rec);
            return src
              ? html`<img class="rec-card__logo" src=${src} alt="" loading="lazy" decoding="async"
                          @error=${(e) => {
                            const div = document.createElement('div');
                            div.className = 'rec-card__logo rec-card__logo--placeholder';
                            div.setAttribute('aria-hidden', 'true');
                            div.textContent = logoInitial(rec.company);
                            e.target.replaceWith(div);
                          }}/>`
              : html`<div class="rec-card__logo rec-card__logo--placeholder" aria-hidden="true">${logoInitial(rec.company)}</div>`;
          })()}
          <div class="rec-card__title-block">
            <div class="rec-card__title-row">
              <h3 class="rec-card__title">${rec.title || '(untitled)'}</h3>
              ${rec.fitScore != null
                ? html`<button class=${this._fitClass(rec.fitScore) + ' fit-pill--button'}
                          title="Tap to see the breakdown"
                          @click=${(e) => { e.stopPropagation(); this._openFitModal(rec); }}>
                          ${rec.fitScore}
                        </button>`
                : nothing}
            </div>
            ${meta ? html`<p class="rec-card__meta">${meta}</p>` : nothing}
            <p class="rec-card__source">
              ${rec.postedAt ? html`Posted ${relTime(rec.postedAt)}` : nothing}
              ${rec.postedAt && rec.sourceLabel ? html` <span aria-hidden="true"> · </span> ` : nothing}
              ${rec.sourceLabel ? html`
                <span class="rec-card__source-icon" aria-hidden="true">🌐</span>
                <a href=${rec.url} target="_blank" rel="noopener" class="link-subtle">${rec.sourceLabel}</a>
              ` : nothing}
              ${rec.enrichmentStatus === 'unresolved' ? html`
                <span class="enrichment-badge" title="Still resolving the canonical posting on the company's ATS. Link points to the aggregator for now.">verifying source</span>
              ` : nothing}
              ${rec.sourceEmailUrl ? html`
                <span aria-hidden="true"> · </span>
                <a href=${rec.sourceEmailUrl} target="_blank" rel="noopener" class="link-subtle" title="Open the originating email in Gmail">📧 source email</a>
              ` : nothing}
            </p>
          </div>
        </header>

        <footer class="rec-card__foot">
          <button class="btn btn--sm btn--accent" ?disabled=${this.addingId === rec.id}
                  @click=${() => this._onAdd(rec)}>
            ${this.addingId === rec.id ? 'Saving…' : 'Save role'}
          </button>
          <button class="link-subtle" @click=${() => this._onDismiss(rec.id)}>Dismiss</button>
        </footer>
      </article>
    `;
  }

  _renderEmpty() {
    return html`
      <div class="rec-empty">
        <strong>No recommendations yet.</strong>
        <span class="muted">Once the LinkedIn pull worker runs, fresh roles tagged with why they match will surface here.</span>
      </div>
    `;
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`
        <div class="rec-shell">
          <div class="rec-row">
            ${Array.from({ length: 3 }).map(() => html`
              <div class="rec-card">
                <div class="rec-card__head">
                  <div class="skeleton" style="width:36px;height:36px;border-radius:var(--radius-sm);"></div>
                  <div style="flex:1;">
                    <div class="skeleton" style="width:80%;height:14px;display:block;margin-bottom:6px;"></div>
                    <div class="skeleton" style="width:60%;height:11px;display:block;"></div>
                  </div>
                </div>
              </div>
            `)}
          </div>
        </div>
      `;
    }
    if (this.state === 'error' || !this.items.length) {
      return html`<div class="rec-shell">${this._renderEmpty()}</div>`;
    }
    // Show only the top 5 by fit score on the widget; full list lives
    // on /job/jobs/recommended/. Items already arrive sorted by
    // fit_score desc from the recommendations function.
    const top = this.items.slice(0, 5);
    const total = this.items.length;
    return html`
      <section class="rec-shell" aria-label="Recommendations">
        <header class="rec-shell__head">
          <h2>For You</h2>
          <span class="muted">
            Top ${top.length} of ${total} ${total === 1 ? 'role' : 'roles'}
          </span>
        </header>
        <div class="rec-row" role="list">
          ${top.map(r => this._renderCard(r))}
        </div>
        <footer class="rec-shell__foot">
          <a class="link-subtle" href="/job/jobs/recommended/">
            See all recommendations →
          </a>
        </footer>
        ${renderFitModal(this.selectedRec, () => this._closeFitModal())}
      </section>
    `;
  }
}

customElements.define('job-recommendations', JobRecommendations);
