// job-career — tabbed shell for the Your Career page.
//   Work History — full-width company cards (the previous History view).
//   Narratives  — narrative-arc + voice-rules pulled from job.vision,
//                 plus a horizontal carousel of skill-prompts derived from
//                 patterns in the live pipeline JDs.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const [{ renderMarkdown }, { fetchPipeline }] = await Promise.all([
  import('../markdown.js' + V),
  import('../pipeline.js' + V),
]);

// Lazy-load the resume sub-component so the Work History tab doesn't
// pull markdown deps when only the Narratives tab is active.
import('./job-history-resume.js' + V);

const TABS = [
  { id: 'work',       label: 'Work history' },
  { id: 'narratives', label: 'Narratives' },
];

// Minimal seed of skill prompts. Real version derives prompts from JD
// patterns in pipeline_roles.title + sector tags. v1: hand-curated.
const FALLBACK_PROMPTS = [
  { tag: 'Platform thinking', prompt: 'Tell me about a time you protected shared infrastructure from a product team that wanted to fork.' },
  { tag: 'Healthcare',        prompt: 'Walk me through one decision in a regulated environment where the right product call clashed with compliance.' },
  { tag: 'Growth',            prompt: 'Describe an experiment that changed your gut about how the funnel actually worked.' },
  { tag: 'Zero-to-one',       prompt: 'Pick a feature you killed before launch. What signal told you to stop?' },
  { tag: 'Founding PM',       prompt: 'How do you decide what NOT to build when the company is pre-PMF?' },
  { tag: 'AI',                prompt: 'When does an AI feature need a hard guarantee, and when is "best effort" honest?' },
];

export class JobCareer extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    activeTab: { state: true },
    vision: { state: true },
    promptTags: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.activeTab = (new URLSearchParams(location.search).get('tab') === 'narratives') ? 'narratives' : 'work';
    this.vision = null;
    this.promptTags = [];
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
      // Pull the live pipeline so we can derive prompts from real JD tags.
      const data = await fetchPipeline();
      const tagCounts = new Map();
      for (const r of (data.roles || [])) {
        for (const t of (r.sectorTags || [])) {
          tagCounts.set(t.name, (tagCounts.get(t.name) || 0) + 1);
        }
      }
      // Top 8 tags by frequency become the carousel filter chips.
      this.promptTags = Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e);
      this.state = 'error';
    }
  }

  _switchTab(id) {
    this.activeTab = id;
    const qs = id === 'narratives' ? '?tab=narratives' : '';
    history.replaceState(null, '', `/job/history/${qs}`);
  }

  _renderTabs() {
    return html`
      <div class="asset-tabs">
        ${TABS.map(t => html`
          <button class="asset-tabs__tab ${this.activeTab === t.id ? 'is-active' : ''}"
                  @click=${() => this._switchTab(t.id)}>
            ${t.label}
          </button>
        `)}
      </div>
    `;
  }

  _renderWork() {
    return html`<job-history-resume></job-history-resume>`;
  }

  _renderNarratives() {
    if (this.state === 'loading') {
      return html`
        <section style="margin-bottom: var(--space-6);">
          <div class="skeleton" style="width:200px;height:18px;display:block;margin-bottom:var(--space-3);"></div>
          <div class="skeleton" style="width:100%;height:14px;display:block;margin-bottom:8px;"></div>
          <div class="skeleton" style="width:96%;height:14px;display:block;margin-bottom:8px;"></div>
          <div class="skeleton" style="width:80%;height:14px;display:block;"></div>
        </section>
      `;
    }
    return html`
      <section class="narrative-block">
        <h2>Narrative arc</h2>
        <p class="muted">The one-paragraph version Ian tells. Sourced from <code>02-goals-intents/narrative-arc.md</code>.</p>
        <div class="kb-doc">
          <p><em>Open the Vision tab to read or edit the live narrative. (Direct fetch lands with the Vision page rebuild.)</em></p>
        </div>
      </section>

      <section class="narrative-block">
        <header style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--space-3);margin-bottom:var(--space-3);">
          <div>
            <h2 style="margin:0;">Skill prompts</h2>
            <p class="muted" style="margin:0;font-size:var(--font-size-small);">Quick-fire prompts for filling in evidence. Tagged by themes that show up most in your live pipeline.</p>
          </div>
          ${this.promptTags.length ? html`
            <span class="muted" style="font-size:var(--font-size-caption);">Top tags: ${this.promptTags.slice(0, 5).map(t => t.name).join(' · ')}</span>
          ` : nothing}
        </header>
        <div class="prompt-carousel" role="list">
          ${FALLBACK_PROMPTS.map(p => html`
            <article class="prompt-card" role="listitem">
              <span class="tag-chip" style="margin-bottom:var(--space-3);">${p.tag}</span>
              <p>${p.prompt}</p>
              <button class="btn btn--sm" disabled title="Drafting capture lands with the next pass.">Capture story</button>
            </article>
          `)}
        </div>
      </section>
    `;
  }

  render() {
    return html`
      ${this._renderTabs()}
      ${this.activeTab === 'work' ? this._renderWork() : this._renderNarratives()}
    `;
  }
}

customElements.define('job-career', JobCareer);
