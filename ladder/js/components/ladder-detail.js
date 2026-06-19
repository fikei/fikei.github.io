// job-detail — generic drilldown view for /ladder/history/{kind}/{slug}/.
// Reads ?kind= & ?slug= from the query, fetches the row from the
// job-entity edge fn (which reads job.{companies,projects,skills,wins}
// in Postgres), renders body_md with the wiki-link-aware renderer.
//
// Replaces the legacy KB read of /01-job-history/{kind}/{slug}.md so
// the last live kb-read caller is gone.
import { LitElement, html } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const { renderMarkdown } = await import('../markdown.js' + V);

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const FN_URL = `${SUPABASE_URL}/functions/v1/job-entity`;

const KIND_LABEL = {
  companies: 'Companies',
  projects:  'Projects',
  skills:    'Skills',
  wins:      'Wins',
};

export class JobDetail extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state: { state: true },
    error: { state: true },
    title: { state: true },
    body:  { state: true },
    kind:  { state: true },
    slug:  { state: true },
    updatedAt:   { state: true },
    frontmatter: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.title = '';
    this.body = '';
    this.updatedAt = '';
    this.frontmatter = null;
    const params = new URLSearchParams(location.search);
    this.kind = (params.get('kind') || '').toLowerCase();
    this.slug = (params.get('slug') || '').toLowerCase();

    // Restore the pretty URL captured in 404.html.
    const pretty = sessionStorage.getItem('job:prettyPath');
    if (pretty && /^\/ladder\/history\/[a-z]+\/[a-z0-9_-]+\/?$/.test(pretty)) {
      sessionStorage.removeItem('job:prettyPath');
      history.replaceState(null, '', pretty);
    } else if (this.kind && this.slug) {
      history.replaceState(null, '', `/ladder/history/${this.kind}/${this.slug}/`);
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

  async _supabaseToken() {
    const sb = window.CtrlAuth?.getSupabaseClient?.();
    return (await sb?.auth.getSession?.())?.data?.session?.access_token;
  }

  async _maybeLoad() {
    if (document.body.dataset.authState !== 'in') return;
    if (this.state === 'loading' || this.state === 'loaded') return;
    if (!KIND_LABEL[this.kind] || !this.slug) {
      this.state = 'error';
      this.error = `Unknown route. kind=${this.kind} slug=${this.slug}`;
      return;
    }
    this.state = 'loading';
    try {
      const token = await this._supabaseToken();
      const res = await fetch(`${FN_URL}?kind=${encodeURIComponent(this.kind)}&slug=${encodeURIComponent(this.slug)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Server ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const content = data.body_md || '';
      this.title = data.title || this.slug;
      this.frontmatter = data.frontmatter || null;
      this.updatedAt = data.updated_at || '';
      const stripped = content.replace(/^#\s+.+\n+/, '');
      this.body = renderMarkdown(stripped);
      document.title = `${this.title} — /ladder`;
      this.state = 'loaded';
    } catch (e) {
      this.state = 'error';
      this.error = String(e?.message || e);
    }
  }

  render() {
    const breadcrumb = html`
      <nav class="breadcrumb">
        <a href="/ladder/history/">History</a>
        <span>›</span>
        <span>${KIND_LABEL[this.kind] || this.kind}</span>
      </nav>
    `;

    if (this.state === 'idle' || this.state === 'loading') {
      return html`${breadcrumb}<div class="placeholder"><h2>Loading…</h2></div>`;
    }
    if (this.state === 'error') {
      return html`
        ${breadcrumb}
        <div class="placeholder" style="border-color:var(--error);color:var(--error);">
          <h2>Couldn't load this page</h2>
          <p style="font-family:var(--font-mono);font-size:13px;">${this.error}</p>
        </div>`;
    }
    return html`
      ${breadcrumb}
      <header class="page-header">
        <h1>${this.title}</h1>
      </header>
      <article class="kb-doc">${unsafeHTML(this.body)}</article>
    `;
  }
}

customElements.define('ladder-detail', JobDetail);
