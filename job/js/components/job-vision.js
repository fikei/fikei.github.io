// job-vision — structured editor for job.vision_field. Each preference
// is its own row in Postgres (see migration 074); this page is a typed
// form over that table, replacing the old KB-backed tree-of-markdown-
// files UI.
//
// Reads:  GET  /functions/v1/vision-field → { fields: { [name]: {...} } }
// Writes: POST /functions/v1/vision-field { updates: [{name,value}] }
//
// Auth: standard /job bearer token. The edge fn marks every write as
// `source: 'user'` so the agent-driven 'agent' edits are visually
// distinguishable in the metadata footer of each field.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const FN_URL = `${SUPABASE_URL}/functions/v1/vision-field`;

// Field grouping. Each section lists the canonical field names that
// belong to it. Anything not listed below falls into 'Other'.
const SECTIONS = [
  { id: 'narrative', label: 'Narrative + voice',
    names: ['narrative_arc', 'voice_rules_md'] },
  { id: 'targets', label: 'Targets',
    names: ['target_titles', 'target_stages', 'target_sectors', 'target_geographies'] },
  { id: 'mission', label: 'Mission + culture',
    names: ['mission_keywords', 'mission_required', 'anti_mission_terms', 'culture_keywords', 'interest_tags', 'impact_themes'] },
  { id: 'comp', label: 'Compensation',
    names: ['comp_floor_base', 'comp_floor_total'] },
  { id: 'filters', label: 'Filters',
    names: ['deal_breakers', 'blocked_titles', 'must_have_keywords'] },
  { id: 'advanced', label: 'Advanced',
    names: ['score_weights', 'raw_md'] },
];

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
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.fields = {};
    this.drafts = {};
    this.saving = new Set();
    this.flash = {};
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

  _renderSection(section) {
    const present = section.names.filter((n) => this.fields[n]);
    if (!present.length) return nothing;
    return html`
      <section class="vf-section">
        <h2 class="vf-section__title">${section.label}</h2>
        <div class="vf-section__grid">
          ${present.map((n) => this._renderFieldCard(n))}
        </div>
      </section>
    `;
  }

  _renderOtherSection() {
    const known = new Set(SECTIONS.flatMap((s) => s.names));
    const others = Object.keys(this.fields).filter((n) => !known.has(n)).sort();
    if (!others.length) return nothing;
    return html`
      <section class="vf-section">
        <h2 class="vf-section__title">Other</h2>
        <div class="vf-section__grid">
          ${others.map((n) => this._renderFieldCard(n))}
        </div>
      </section>
    `;
  }

  render() {
    if (this.state === 'loading' || this.state === 'idle') {
      return html`<p class="muted">Loading…</p>`;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder"><h2>Couldn't load</h2><p>${this.error}</p></div>`;
    }
    return html`
      <div class="vf">
        ${SECTIONS.map((s) => this._renderSection(s))}
        ${this._renderOtherSection()}
      </div>
    `;
  }
}

customElements.define('job-vision', JobVision);
