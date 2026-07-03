// job-vision — structured editor for job.vision_field. Each preference
// is its own row in Postgres (see migration 074); this page is a typed
// form over that table, replacing the old KB-backed tree-of-markdown-
// files UI.
//
// Reads:  GET  /functions/v1/vision-field → { fields: { [name]: {...} } }
// Writes: POST /functions/v1/vision-field { updates: [{name,value}] }
//
// Auth: standard /ladder bearer token. The edge fn marks every write as
// `source: 'user'` so the agent-driven 'agent' edits are visually
// distinguishable in the metadata footer of each field.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const FN_URL = `${SUPABASE_URL}/functions/v1/vision-field`;

// Search-plan taxonomy (v2.18): four subpages switched by ?section=,
// reusing the Jobs ?bucket= pattern. Landing (no param) is a summary view
// with a plan-strength chip and one tappable digest row per section.
//   Targets — what a good role looks like (facts)
//   Signals — what the grader rewards (taste)
//   Rules   — hard gates that auto-drop a role
//   Sources — where roles come from (watched companies + Gmail)
// Story fields (narrative_arc, voice_rules_md) live on Profile → Narratives,
// not here; Advanced (score_weights, raw_md) collapses at the bottom of
// Signals. Unknown fields fall into that same Advanced fold.
const TABS = [
  { id: 'targets', label: 'Targets',
    hint: 'What a good role looks like — titles, stage, sector, geography, comp.',
    names: ['target_titles', 'target_stages', 'target_sectors', 'target_geographies', 'comp_floor_base', 'comp_floor_total'] },
  { id: 'signals', label: 'Signals',
    hint: 'What the recommendation grader rewards — mission, culture, interests.',
    names: ['mission_keywords', 'mission_required', 'anti_mission_terms', 'culture_keywords', 'interest_tags', 'impact_themes'] },
  { id: 'rules', label: 'Rules',
    hint: 'Hard gates — anything here auto-drops a role.',
    names: ['deal_breakers', 'blocked_titles', 'must_have_keywords'] },
  { id: 'sources', label: 'Sources',
    hint: 'Where roles come from — watched companies and Gmail scanning.',
    names: [] },
];
const ADVANCED_FIELDS = ['score_weights', 'raw_md'];
// Story lives on Profile — never render these here.
const STORY_FIELDS = ['narrative_arc', 'voice_rules_md'];

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const dt = Date.now() - t;
  if (dt < 60_000) return 'just now';
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
  if (dt < 30 * 86_400_000) return `${Math.floor(dt / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const SOURCE_LABEL = {
  user: 'you',
  agent: 'the chat agent',
  'migrate-job': 'the initial KB import',
  import: 'an import',
};

export class JobVision extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state:   { state: true },     // 'idle' | 'loading' | 'loaded' | 'error'
    error:   { state: true },
    fields:  { state: true },     // { [name]: row }
    drafts:  { state: true },     // { [name]: draft value } — edit-in-progress
    saving:  { state: true },     // Set<name>
    flash:   { state: true },     // { [name]: 'saved' | 'error' }
    section: { state: true },     // active tab id or null (summary landing)
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.fields = {};
    this.drafts = {};
    this.saving = new Set();
    this.flash = {};
    const s = new URLSearchParams(location.search).get('section');
    this.section = TABS.some(t => t.id === s) ? s : null;
  }

  _setSection(id) {
    this.section = id;
    const url = new URL(location.href);
    if (id) url.searchParams.set('section', id);
    else url.searchParams.delete('section');
    history.replaceState(null, '', url.pathname + url.search);
  }

  connectedCallback() {
    super.connectedCallback();
    this._authReady = () => this._load();
    document.addEventListener('job:auth:ready', this._authReady);
    if (document.body.dataset.authState === 'in') this._load();
  }
  disconnectedCallback() {
    document.removeEventListener('job:auth:ready', this._authReady);
    super.disconnectedCallback();
  }

  _supabase() { return window.CtrlAuth?.getSupabaseClient?.(); }

  async _token() {
    const sb = this._supabase();
    return (await sb?.auth.getSession?.())?.data?.session?.access_token;
  }

  async _load() {
    if (this.state === 'loading' || this.state === 'loaded') return;
    this.state = 'loading';
    this.error = '';
    try {
      const token = await this._token();
      const res = await fetch(FN_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Server ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      this.fields = data.fields || {};
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e?.message || e);
      this.state = 'error';
    }
  }

  _draftFor(name) {
    if (Object.prototype.hasOwnProperty.call(this.drafts, name)) return this.drafts[name];
    return this._currentValue(name);
  }

  _currentValue(name) {
    const v = this.fields[name]?.value;
    if (v === undefined || v === null) {
      const kind = this.fields[name]?.kind;
      if (kind === 'string_array') return [];
      if (kind === 'text_md')      return '';
      if (kind === 'number')       return null;
      if (kind === 'bool')         return false;
      return null;
    }
    return v;
  }

  _setDraft(name, value) {
    this.drafts = { ...this.drafts, [name]: value };
  }

  _hasChanges(name) {
    if (!Object.prototype.hasOwnProperty.call(this.drafts, name)) return false;
    const a = JSON.stringify(this.drafts[name]);
    const b = JSON.stringify(this._currentValue(name));
    return a !== b;
  }

  _cancel(name) {
    const { [name]: _, ...rest } = this.drafts;
    this.drafts = rest;
    const { [name]: _f, ...rf } = this.flash;
    this.flash = rf;
  }

  async _save(name) {
    if (!this._hasChanges(name) || this.saving.has(name)) return;
    this.saving = new Set([...this.saving, name]);
    this.flash = { ...this.flash, [name]: '' };
    try {
      const token = await this._token();
      const value = this.drafts[name];
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ updates: [{ name, value }] }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      if (data.errors?.length) throw new Error(data.errors[0].reason);
      // Refresh just this field's metadata
      const updated_at = data.updated?.[0]?.updated_at || new Date().toISOString();
      this.fields = {
        ...this.fields,
        [name]: { ...this.fields[name], value, updated_at, source: 'user', source_detail: null },
      };
      const { [name]: _, ...rest } = this.drafts;
      this.drafts = rest;
      this.flash = { ...this.flash, [name]: 'saved' };
      setTimeout(() => { const { [name]: _x, ...r } = this.flash; this.flash = r; }, 1800);
    } catch (e) {
      this.flash = { ...this.flash, [name]: `error: ${String(e.message || e).slice(0, 120)}` };
    } finally {
      const s = new Set(this.saving); s.delete(name); this.saving = s;
    }
  }

  // ── Renderers per kind ───────────────────────────────────────────────

  _renderStringArray(name) {
    const value = this._draftFor(name) || [];
    return html`
      <div class="vf-chips">
        ${value.map((v, i) => html`
          <span class="vf-chip">
            ${v}
            <button class="vf-chip__x" aria-label="Remove"
                    @click=${() => this._setDraft(name, value.filter((_, idx) => idx !== i))}>×</button>
          </span>
        `)}
        <input type="text" class="vf-chip-input" placeholder="Add term + Enter"
               @keydown=${(e) => {
                 if (e.key === 'Enter') {
                   e.preventDefault();
                   const t = e.target.value.trim();
                   if (!t) return;
                   if (value.includes(t)) { e.target.value = ''; return; }
                   this._setDraft(name, [...value, t]);
                   e.target.value = '';
                 } else if (e.key === 'Backspace' && !e.target.value && value.length) {
                   this._setDraft(name, value.slice(0, -1));
                 }
               }}>
      </div>
    `;
  }

  _renderTextMd(name) {
    const value = this._draftFor(name) || '';
    const rows = Math.min(20, Math.max(3, value.split('\n').length + 1));
    return html`
      <textarea class="vf-textarea" rows=${rows}
                .value=${value}
                @input=${(e) => this._setDraft(name, e.target.value)}></textarea>
    `;
  }

  _renderNumber(name) {
    const value = this._draftFor(name);
    return html`
      <input type="number" class="vf-input" .value=${value == null ? '' : String(value)}
             @input=${(e) => this._setDraft(name, e.target.value === '' ? null : Number(e.target.value))}>
    `;
  }

  _renderBool(name) {
    const value = !!this._draftFor(name);
    return html`
      <label class="vf-toggle">
        <input type="checkbox" .checked=${value}
               @change=${(e) => this._setDraft(name, e.target.checked)}>
        <span>${value ? 'On' : 'Off'}</span>
      </label>
    `;
  }

  _renderJson(name) {
    const raw = this._draftFor(name);
    const value = raw == null ? '' : JSON.stringify(raw, null, 2);
    return html`
      <textarea class="vf-textarea vf-textarea--mono" rows="8" spellcheck="false"
                .value=${value}
                @input=${(e) => {
                  const t = e.target.value;
                  try { this._setDraft(name, t.trim() === '' ? null : JSON.parse(t)); }
                  catch (_) { this._setDraft(name, t); /* leave as string until valid */ }
                }}></textarea>
    `;
  }

  _renderEditor(name) {
    const kind = this.fields[name]?.kind;
    switch (kind) {
      case 'string_array': return this._renderStringArray(name);
      case 'text_md':      return this._renderTextMd(name);
      case 'number':       return this._renderNumber(name);
      case 'bool':         return this._renderBool(name);
      case 'json':         return this._renderJson(name);
      default:             return html`<em class="vf-empty">Unknown kind: ${kind}</em>`;
    }
  }

  _renderFieldCard(name) {
    const f = this.fields[name];
    if (!f) return nothing;
    const dirty = this._hasChanges(name);
    const saving = this.saving.has(name);
    const flash = this.flash[name];
    const updatedBy = SOURCE_LABEL[f.source] || f.source;
    return html`
      <article class="vf-card" data-kind=${f.kind}>
        <header class="vf-card__head">
          <div class="vf-card__title-wrap">
            <h3 class="vf-card__title">${f.display_name || name}</h3>
            <span class="vf-card__name">${name}</span>
          </div>
          <div class="vf-card__meta">
            <span class="vf-card__updated" title=${new Date(f.updated_at).toLocaleString()}>
              Updated ${relTime(f.updated_at)} by ${updatedBy}
            </span>
          </div>
        </header>
        ${f.description ? html`<p class="vf-card__desc">${f.description}</p>` : nothing}
        <div class="vf-card__editor">${this._renderEditor(name)}</div>
        ${dirty || flash ? html`
          <footer class="vf-card__foot">
            ${flash === 'saved'
              ? html`<span class="vf-saved">✓ Saved</span>`
              : flash
                ? html`<span class="vf-error">${flash}</span>`
                : nothing}
            ${dirty ? html`
              <button class="btn btn--sm" ?disabled=${saving}
                      @click=${() => this._cancel(name)}>Cancel</button>
              <button class="btn btn--sm btn--primary" ?disabled=${saving}
                      @click=${() => this._save(name)}>
                ${saving ? 'Saving…' : 'Save'}
              </button>
            ` : nothing}
          </footer>
        ` : nothing}
      </article>
    `;
  }

  // ── Summary landing + tabs ───────────────────────────────────────────

  _isFilled(name) {
    const v = this.fields[name]?.value;
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'string') return v.trim().length > 0;
    if (typeof v === 'boolean') return true;
    return true;
  }

  // Plan strength = completeness across the core (non-Sources) fields.
  _strength() {
    const core = TABS.flatMap(t => t.names).filter(n => this.fields[n] && this.fields[n].kind !== 'bool');
    if (!core.length) return { label: 'Getting started', pct: 0 };
    const filled = core.filter(n => this._isFilled(n)).length;
    const pct = filled / core.length;
    const label = pct >= 0.8 ? 'Strong' : pct >= 0.5 ? 'Good' : 'Getting started';
    return { label, pct };
  }

  _arr(name) {
    const v = this.fields[name]?.value;
    return Array.isArray(v) ? v : [];
  }

  _digest(tab) {
    if (tab.id === 'targets') {
      const bits = [];
      const titles = this._arr('target_titles');
      if (titles.length) bits.push(titles.slice(0, 3).join(', ') + (titles.length > 3 ? ` +${titles.length - 3}` : ''));
      const stages = this._arr('target_stages');
      if (stages.length) bits.push(stages.slice(0, 3).join(' / '));
      const floor = this.fields.comp_floor_base?.value;
      if (floor) bits.push(`$${Math.round(floor / 1000)}k+ base`);
      return bits.join(' · ') || tab.hint;
    }
    if (tab.id === 'signals') {
      const bits = [];
      const m = this._arr('mission_keywords').length;   if (m) bits.push(`${m} mission`);
      const c = this._arr('culture_keywords').length;   if (c) bits.push(`${c} culture`);
      const i = this._arr('interest_tags').length;      if (i) bits.push(`${i} interests`);
      return bits.length ? bits.join(' · ') + ' keywords' : tab.hint;
    }
    if (tab.id === 'rules') {
      const bits = [];
      if (this._isFilled('deal_breakers')) bits.push('Deal-breakers set');
      const b = this._arr('blocked_titles').length;     if (b) bits.push(`${b} blocked titles`);
      const mh = this._arr('must_have_keywords').length; if (mh) bits.push(`${mh} must-haves`);
      return bits.join(' · ') || tab.hint;
    }
    return tab.hint;
  }

  _renderSummary() {
    const s = this._strength();
    return html`
      <div class="vf-summary">
        <div class="vf-summary__strength">
          <span class="vf-summary__label">Plan strength: <strong>${s.label}</strong></span>
          <span class="vf-summary__bar"><span style=${`width:${Math.round(s.pct * 100)}%`}></span></span>
        </div>
        <ul class="vf-summary__list" role="list">
          ${TABS.map(t => html`
            <li>
              <button class="vf-summary__row" @click=${() => this._setSection(t.id)}>
                <span class="vf-summary__row-text">
                  <span class="vf-summary__row-label">${t.label}</span>
                  <span class="vf-summary__row-digest">${this._digest(t)}</span>
                </span>
                <span class="vf-summary__row-arrow" aria-hidden="true">→</span>
              </button>
            </li>
          `)}
        </ul>
      </div>
    `;
  }

  _renderTabs() {
    return html`
      <div class="vf-tabs" role="tablist" aria-label="Search plan sections">
        <button class="subnav-bar__item" aria-current=${this.section == null ? 'page' : 'false'}
                @click=${() => this._setSection(null)}>Overview</button>
        ${TABS.map(t => html`
          <button class="subnav-bar__item" aria-current=${this.section === t.id ? 'page' : 'false'}
                  @click=${() => this._setSection(t.id)}>${t.label}</button>
        `)}
      </div>
    `;
  }

  // Advanced fold — score weights, raw markdown, plus any field the
  // taxonomy doesn't know about (so nothing silently disappears).
  _advancedNames() {
    const known = new Set([...TABS.flatMap((t) => t.names), ...STORY_FIELDS]);
    const others = Object.keys(this.fields).filter((n) => !known.has(n) && !ADVANCED_FIELDS.includes(n)).sort();
    return [...ADVANCED_FIELDS.filter((n) => this.fields[n]), ...others];
  }

  _renderTab(tab) {
    if (tab.id === 'sources') {
      return html`
        <section class="vf-section">
          <p class="vf-section__hint muted">${tab.hint}</p>
          <ladder-watched-companies></ladder-watched-companies>
        </section>
      `;
    }
    const present = tab.names.filter((n) => this.fields[n]);
    return html`
      <section class="vf-section">
        <p class="vf-section__hint muted">${tab.hint}</p>
        <div class="vf-section__grid">
          ${present.map((n) => this._renderFieldCard(n))}
        </div>
        ${tab.id === 'signals' ? this._renderAdvanced() : nothing}
      </section>
    `;
  }

  _renderAdvanced() {
    const names = this._advancedNames();
    if (!names.length) return nothing;
    return html`
      <details class="jd-collapse vf-advanced">
        <summary>Advanced — score weights & raw plan</summary>
        <div class="jd-collapse__body">
          <div class="vf-section__grid">
            ${names.map((n) => this._renderFieldCard(n))}
          </div>
        </div>
      </details>
    `;
  }

  render() {
    if (this.state === 'loading' || this.state === 'idle') {
      return html`<p class="muted">Loading…</p>`;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder"><h2>Couldn't load</h2><p>${this.error}</p></div>`;
    }
    const tab = TABS.find(t => t.id === this.section) || null;
    return html`
      <div class="vf">
        ${this._renderTabs()}
        ${tab ? this._renderTab(tab) : this._renderSummary()}
        ${!tab ? html`
          <p class="vf-story-note muted">
            Your story — narrative arc and voice rules — lives on
            <a href="/ladder/history/?tab=narratives">Profile → Narratives</a>.
          </p>
        ` : nothing}
      </div>
    `;
  }
}

customElements.define('ladder-vision', JobVision);
