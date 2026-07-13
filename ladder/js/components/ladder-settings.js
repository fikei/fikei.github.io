// job-settings — minimal settings page.
//
// MVP scope: show the current user's profile (read from public.user_profile,
// RLS-scoped to them) and give an entry point into the onboarding flow in
// demo mode so they can re-walk it without overwriting their live profile.
//
// Out of scope here (lives elsewhere): editing structured fields is done in
// <ladder-vision>'s tabbed editor on the markdown KB. This page is the
// router/launcher.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';
const V = (new URL(import.meta.url)).search;
const { answersList, answersUpsert } = await import('../apply.js' + V);
await import('./ladder-easy-apply-setup.js' + V);   // registers <ladder-easy-apply-setup>

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const MCP_TOKENS_URL = `${SUPABASE_URL}/functions/v1/job-mcp-tokens`;
const MCP_ENDPOINT_URL = `${SUPABASE_URL}/functions/v1/job-mcp`;

export class JobSettings extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    profile: { state: true },
    loading: { state: true },
    email:   { state: true },
    mcpTokens:     { state: true },
    mcpMinting:    { state: true },
    mcpNewLabel:   { state: true },
    mcpFreshToken: { state: true },   // raw token shown once after creation
    mcpFreshLabel: { state: true },
    // Easy Apply answer bank mirror (16.2b).
    easyAnswers:   { state: true },   // null | {key: {value, source, updated_at}}
    easyRegistry:  { state: true },
    easyEditKey:   { state: true },   // key currently being edited inline
    easyEditVal:   { state: true },
  };

  constructor() {
    super();
    this.profile = null;
    this.loading = true;
    this.email = '';
    this.mcpTokens = [];
    this.mcpMinting = false;
    this.mcpNewLabel = '';
    this.mcpFreshToken = '';
    this.mcpFreshLabel = '';
    this.easyAnswers = null;
    this.easyRegistry = [];
    this.easyEditKey = null;
    this.easyEditVal = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._onReady = () => this._load();
    document.addEventListener('job:auth:ready', this._onReady);
    this._onEaseDone = () => this._loadEasyAnswers();
    document.addEventListener('job:easyapply:setup-done', this._onEaseDone);
  }
  disconnectedCallback() {
    document.removeEventListener('job:auth:ready', this._onReady);
    document.removeEventListener('job:easyapply:setup-done', this._onEaseDone);
    super.disconnectedCallback();
  }

  async _token() {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    return (await sb?.auth.getSession?.())?.data?.session?.access_token;
  }

  async _load() {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    if (!sb) return;
    this.loading = true;
    try {
      const { data: { user } } = await sb.auth.getUser();
      this.email = user?.email || '';
      const { data, error } = await sb
        .from('user_profile')
        .select('*')
        .maybeSingle();
      if (error) { console.warn('[settings] profile fetch failed', error); }
      this.profile = data;
      await this._loadMcpTokens();
      this._loadEasyAnswers();       // fire-and-forget; card shows its own state
    } finally {
      this.loading = false;
    }
  }

  async _loadEasyAnswers() {
    try {
      const res = await answersList();
      this.easyAnswers = res.answers || {};
      this.easyRegistry = res.registry || [];
    } catch (e) {
      console.warn('[settings] easy-apply answers fetch failed', e.message);
      this.easyAnswers = {};
      this.easyRegistry = [];
    }
  }

  _easyValueLabel(v) {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (typeof v === 'object') {
      if (Array.isArray(v.metros)) return `${v.metros.join(', ')}${v.max_days_per_week != null ? ` · ≤${v.max_days_per_week}d/wk office` : ''}`;
      if (v.base_floor != null || v.total_floor != null) return `$${(v.base_floor ?? v.total_floor).toLocaleString?.() ?? v.base_floor} (${v.policy || 'floor'})`;
      return JSON.stringify(v);
    }
    return String(v);
  }

  async _saveEasyEdit(key) {
    const reg = (this.easyRegistry || []).find(c => c.key === key);
    let value = this.easyEditVal;
    if (reg?.kind === 'boolean') value = /^(y|yes|true)$/i.test(value);
    else if (reg?.kind === 'number') value = Number(value) || 0;
    try {
      await answersUpsert([{ key, value, source: 'onboarding' }]);
      this.easyEditKey = null;
      await this._loadEasyAnswers();
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    }
  }

  _renderEasyApplyCard() {
    const answers = this.easyAnswers;
    const reg = this.easyRegistry || [];
    return html`
      <div class="onboard-card">
        <h2 class="onboard-card__title">Easy Apply</h2>
        <p class="onboard__hint">
          Saved answers used to prefill application forms. Demographic answers are only ever
          submitted from what you set here; legal checkboxes always require a tap at submit time.
        </p>
        <div class="onboard-card__row" style="margin-bottom:var(--space-3);">
          <button class="btn btn--sm btn--primary"
                  @click=${() => this.renderRoot.querySelector('#ease-setup-settings')?.launch()}>
            ${answers && Object.keys(answers).length ? 'Re-run setup' : '⚡ Set up Easy Apply'}
          </button>
        </div>
        ${answers == null ? html`<p class="onboard__hint">Loading…</p>` : nothing}
        ${answers && Object.keys(answers).length ? html`
          <div class="eas-settings-list">
            ${reg.filter(c => answers[c.key] !== undefined).map(c => html`
              <div class="eas-settings-row">
                <span class="eas-settings-row__label">${c.label}</span>
                ${this.easyEditKey === c.key ? html`
                  <input type="text" .value=${this.easyEditVal}
                         @input=${(e) => { this.easyEditVal = e.target.value; }}
                         @keydown=${(e) => { if (e.key === 'Enter') this._saveEasyEdit(c.key); if (e.key === 'Escape') this.easyEditKey = null; }}>
                  <button class="btn btn--sm btn--accent" @click=${() => this._saveEasyEdit(c.key)}>Save</button>
                ` : html`
                  <span class="eas-settings-row__value">${this._easyValueLabel(answers[c.key]?.value)}</span>
                  <span class="eas-settings-row__source muted">${answers[c.key]?.source}</span>
                  ${c.kind === 'json' ? nothing : html`
                    <button class="btn btn--sm" @click=${() => {
                      this.easyEditKey = c.key;
                      const v = answers[c.key]?.value;
                      this.easyEditVal = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v ?? '');
                    }}>Edit</button>`}
                `}
              </div>
            `)}
          </div>
        ` : nothing}
        <ladder-easy-apply-setup id="ease-setup-settings"></ladder-easy-apply-setup>
      </div>
    `;
  }

  async _loadMcpTokens() {
    const token = await this._token();
    if (!token) return;
    try {
      const res = await fetch(MCP_TOKENS_URL, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const data = await res.json();
      this.mcpTokens = data.tokens || [];
    } catch (e) {
      console.warn('[settings] mcp tokens fetch failed', e);
    }
  }

  async _createMcpToken() {
    const label = (this.mcpNewLabel || '').trim();
    if (!label || this.mcpMinting) return;
    this.mcpMinting = true;
    try {
      const token = await this._token();
      const res = await fetch(MCP_TOKENS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      this.mcpFreshToken = data.token;
      this.mcpFreshLabel = data.label;
      this.mcpNewLabel = '';
      await this._loadMcpTokens();
    } catch (e) {
      alert(`Couldn't create token: ${e.message || e}`);
    } finally {
      this.mcpMinting = false;
    }
  }

  async _revokeMcpToken(id, label) {
    if (!confirm(`Revoke MCP token "${label}"? Any client using this token will stop working immediately.`)) return;
    try {
      const token = await this._token();
      const res = await fetch(MCP_TOKENS_URL, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      await this._loadMcpTokens();
    } catch (e) {
      alert(`Couldn't revoke: ${e.message || e}`);
    }
  }

  _copyFreshToken() {
    if (!this.mcpFreshToken) return;
    navigator.clipboard?.writeText(this.mcpFreshToken).then(() => {}, () => {});
  }

  _dismissFreshToken() {
    this.mcpFreshToken = '';
    this.mcpFreshLabel = '';
  }

  _relTime(iso) {
    if (!iso) return '—';
    const dt = Date.now() - new Date(iso).getTime();
    if (dt < 60_000) return 'just now';
    if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
    if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
    if (dt < 30 * 86_400_000) return `${Math.floor(dt / 86_400_000)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  async _restartOnboarding(demo = true) {
    if (demo) {
      window.location.href = '/ladder/onboarding/?demo=1';
      return;
    }
    if (!confirm('Re-run onboarding for real? This will overwrite your saved profile when you commit at the end.')) return;
    window.location.href = '/ladder/onboarding/';
  }

  render() {
    if (this.loading) return html`<p class="onboard__hint">Loading…</p>`;
    const p = this.profile || {};
    const completed = !!p.onboarding_complete_at;
    return html`
      <div class="onboard" style="max-width:760px;">
        <div class="onboard-card">
          <h2 class="onboard-card__title">Account</h2>
          <div class="onboard-card__row">
            <label>Email</label>
            <span class="read-only">${this.email || '—'}</span>
          </div>
          <div class="onboard-card__row">
            <label>Status</label>
            <span class="read-only">
              ${completed
                ? `Onboarded ${new Date(p.onboarding_complete_at).toLocaleDateString()}`
                : 'Onboarding incomplete'}
            </span>
          </div>
        </div>

        ${this._renderEasyApplyCard()}

        <div class="onboard-card">
          <h2 class="onboard-card__title">Test the onboarding flow</h2>
          <p class="onboard__hint">Demo mode walks you through the full flow without touching your live profile. Nothing is committed.</p>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">
            <button class="btn btn--primary" @click=${() => this._restartOnboarding(true)}>Open onboarding (demo)</button>
            <button class="btn" @click=${() => this._restartOnboarding(false)}>Re-run for real</button>
          </div>
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">MCP tokens</h2>
          <p class="onboard__hint">
            Personal access tokens for the <a href="${MCP_ENDPOINT_URL}" target="_blank" rel="noopener">/ladder MCP endpoint</a>.
            Use one in Claude Desktop / Cursor / Claude Code config so the agent can read your pipeline and update your preferences without you re-pasting a fresh JWT every hour.
            Tokens don't expire — revoke from this page when you're done.
          </p>

          ${this.mcpFreshToken ? html`
            <div class="mcp-fresh">
              <p class="mcp-fresh__title">New token created: <strong>${this.mcpFreshLabel}</strong></p>
              <p class="mcp-fresh__warn">Copy this now. It won't be shown again. If you lose it, mint another.</p>
              <code class="mcp-fresh__value">${this.mcpFreshToken}</code>
              <div class="mcp-fresh__actions">
                <button class="btn btn--sm btn--primary" @click=${() => this._copyFreshToken()}>Copy</button>
                <button class="btn btn--sm" @click=${() => this._dismissFreshToken()}>Done</button>
              </div>
              <details class="mcp-fresh__howto">
                <summary>How to add this to Claude Desktop / Cursor / Claude Code</summary>
                <pre>// Claude Desktop — claude_desktop_config.json
{
  "mcpServers": {
    "ctrl-rodeo-job": {
      "url": "${MCP_ENDPOINT_URL}",
      "headers": { "Authorization": "Bearer ${this.mcpFreshToken}" }
    }
  }
}

// Claude Code
claude mcp add ctrl-rodeo-job ${MCP_ENDPOINT_URL} \\
  --transport http \\
  --header "Authorization: Bearer ${this.mcpFreshToken}"
</pre>
              </details>
            </div>
          ` : nothing}

          <form class="mcp-create" @submit=${(e) => { e.preventDefault(); this._createMcpToken(); }}>
            <input type="text" placeholder="Label (e.g. Claude Desktop)" maxlength="80"
                   .value=${this.mcpNewLabel}
                   @input=${(e) => { this.mcpNewLabel = e.target.value; }}
                   ?disabled=${this.mcpMinting}>
            <button class="btn btn--primary" type="submit" ?disabled=${this.mcpMinting || !this.mcpNewLabel.trim()}>
              ${this.mcpMinting ? 'Creating…' : '+ Create token'}
            </button>
          </form>

          ${this.mcpTokens.length === 0 ? html`
            <p class="onboard__hint" style="margin-top:var(--space-3);">No active tokens.</p>
          ` : html`
            <table class="mcp-table">
              <thead>
                <tr>
                  <th>Label</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${this.mcpTokens.map((t) => html`
                  <tr>
                    <td><strong>${t.label}</strong></td>
                    <td><code>mcp_${t.prefix}…</code></td>
                    <td>${this._relTime(t.created_at)}</td>
                    <td>${this._relTime(t.last_used_at)}</td>
                    <td><button class="btn btn--sm" @click=${() => this._revokeMcpToken(t.id, t.label)}>Revoke</button></td>
                  </tr>
                `)}
              </tbody>
            </table>
          `}
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Your profile</h2>
          <p class="onboard__hint">Read-only view. Edit structured fields on <a href="/ladder/vision/">Search plan</a>.</p>
          <div class="onboard-preview">
            <pre>${JSON.stringify({
              identity: p.identity,
              location: p.location,
              targeting: p.targeting,
              values_seed: p.values_seed,
              capability: p.capability,
              preferences: p.preferences,
              wins: p.wins,
            }, null, 2)}</pre>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('ladder-settings', JobSettings);
