// job-settings — minimal settings page.
//
// MVP scope: show the current user's profile (read from public.user_profile,
// RLS-scoped to them) and give an entry point into the onboarding flow in
// demo mode so they can re-walk it without overwriting their live profile.
//
// Out of scope here (lives elsewhere): editing structured fields is done in
// <job-vision>'s tabbed editor on the markdown KB. This page is the
// router/launcher.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';

export class JobSettings extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    profile: { state: true },
    loading: { state: true },
    email:   { state: true },
  };

  constructor() {
    super();
    this.profile = null;
    this.loading = true;
    this.email = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._onReady = () => this._load();
    document.addEventListener('job:auth:ready', this._onReady);
  }
  disconnectedCallback() {
    document.removeEventListener('job:auth:ready', this._onReady);
    super.disconnectedCallback();
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
    } finally {
      this.loading = false;
    }
  }

  async _restartOnboarding(demo = true) {
    if (demo) {
      window.location.href = '/job/onboarding/?demo=1';
      return;
    }
    if (!confirm('Re-run onboarding for real? This will overwrite your saved profile when you commit at the end.')) return;
    window.location.href = '/job/onboarding/';
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

        <div class="onboard-card">
          <h2 class="onboard-card__title">Test the onboarding flow</h2>
          <p class="onboard__hint">Demo mode walks you through the full flow without touching your live profile. Nothing is committed.</p>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">
            <button class="btn btn--primary" @click=${() => this._restartOnboarding(true)}>Open onboarding (demo)</button>
            <button class="btn" @click=${() => this._restartOnboarding(false)}>Re-run for real</button>
          </div>
        </div>

        <div class="onboard-card">
          <h2 class="onboard-card__title">Your profile</h2>
          <p class="onboard__hint">Read-only view. Edit structured fields on <a href="/job/vision/">Search plan</a>.</p>
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

customElements.define('job-settings', JobSettings);
