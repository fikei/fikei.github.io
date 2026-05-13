// job-chat — global chat surface. FAB at bottom-right of every /job page;
// tap to open a bottom drawer with a chat thread. Mounted by app.js after
// auth so the data exchange is always user-scoped.
//
// P0 scope:
//   - one rolling thread per user
//   - non-streaming POST to /functions/v1/ask-job-agent
//   - assistant has NO tools yet — it can answer questions and acknowledge
//     requests but cannot mutate anything
//   - history fetched directly from public.chat_message (RLS-gated)
//
// P1 will swap the request to the agent SDK with tools + streaming + sub-
// agents per the locked design recommendations.

import { LitElement, html, css, nothing } from 'https://esm.run/lit@3';

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const FN_URL = `${SUPABASE_URL}/functions/v1/ask-job-agent`;

const QUICK_PROMPTS = [
  'What can you do?',
  'Summarize my pipeline',
  'I don\'t want to see engineering roles',
  'Add a role: ',
];

export class JobChat extends LitElement {
  // Light DOM so it inherits global tokens + can be styled from components.css.
  createRenderRoot() { return this; }

  static properties = {
    open:     { state: true },
    messages: { state: true },
    sending:  { state: true },
    error:    { state: true },
    draft:    { state: true },
  };

  constructor() {
    super();
    this.open = false;
    this.messages = [];
    this.sending = false;
    this.error = '';
    this.draft = '';
    this._loaded = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Wait until auth is resolved before fetching history. app.js mounts
    // this component after applySignedInState() so we can usually fetch
    // immediately, but guard anyway.
    if (document.body.dataset.authState === 'in') this._loadHistory();
  }

  _supabase() { return window.CtrlAuth?.getSupabaseClient?.(); }

  async _loadHistory() {
    if (this._loaded) return;
    const sb = this._supabase();
    if (!sb) return;
    const { data, error } = await sb
      .from('chat_message')
      .select('id, role, body, tool_name, tool_payload, created_at')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) {
      console.warn('[job-chat] history fetch failed', error);
      return;
    }
    this.messages = (data || []).map((m) => ({ ...m, kind: 'persisted' }));
    this._loaded = true;
  }

  async _send() {
    const text = (this.draft || '').trim();
    if (!text || this.sending) return;
    this.error = '';
    this.sending = true;

    // Optimistic local insert so the thread updates instantly.
    const optimisticId = `tmp-${Date.now()}`;
    this.messages = [
      ...this.messages,
      { id: optimisticId, role: 'user', body: text, kind: 'optimistic' },
    ];
    this.draft = '';
    this._scrollToBottom();

    const sb = this._supabase();
    const token = (await sb?.auth.getSession?.())?.data?.session?.access_token;
    if (!token) {
      this.error = 'Not signed in.';
      this.sending = false;
      return;
    }

    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': window.CtrlAuth?.config?.supabaseAnonKey || '',
        },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server ${res.status}: ${errText.slice(0, 240)}`);
      }
      const data = await res.json();
      // New response shape is { events: ChatEvent[] } where ChatEvent may be
      // role 'user' | 'assistant' | 'tool'. Replace the optimistic user
      // message and append the full event trace in order.
      const events = (data.events || []).filter(Boolean).map((m) => ({ ...m, kind: 'persisted' }));
      this.messages = this.messages
        .filter((m) => m.id !== optimisticId)
        .concat(events);
      this._scrollToBottom();
    } catch (err) {
      console.error('[job-chat] send failed', err);
      this.error = String(err.message || err);
      // Leave the optimistic user message in place so the user can retry.
    } finally {
      this.sending = false;
    }
  }

  _scrollToBottom() {
    requestAnimationFrame(() => {
      const el = this.querySelector('.chat-drawer__thread');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  _onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  _toggle() {
    this.open = !this.open;
    if (this.open) {
      this._loadHistory();
      requestAnimationFrame(() => this.querySelector('.chat-drawer__input')?.focus());
      this._scrollToBottom();
    }
  }

  _useQuickPrompt(p) {
    this.draft = p;
    this.querySelector('.chat-drawer__input')?.focus();
  }

  _renderEvent(m) {
    if (m.role === 'tool') {
      const summary = this._summarizeTool(m);
      return html`
        <div class="chat-tool">
          <span class="chat-tool__icon" aria-hidden="true">⚙</span>
          <span class="chat-tool__name">${m.tool_name}</span>
          <span class="chat-tool__summary">${summary}</span>
        </div>
      `;
    }
    return html`
      <div class="chat-msg chat-msg--${m.role}">
        <div class="chat-msg__body">${m.body}</div>
      </div>
    `;
  }

  _summarizeTool(m) {
    const input = m.tool_payload?.input || {};
    const out = m.tool_payload?.output || {};
    switch (m.tool_name) {
      case 'read_preferences':
        return `blocked: ${(out.blocked_titles || []).length} · must_have: ${(out.must_have_keywords || []).length}`;
      case 'search_pipeline':
        return `${input.query || '(all)'} → ${out.count ?? 0} matches`;
      case 'update_pipeline_row': {
        const fields = Object.entries(input).filter(([k]) => k !== 'slug').map(([k, v]) => `${k}=${v}`).join(', ');
        return `${input.slug} · ${fields || 'no-op'}`;
      }
      case 'add_role_from_url':
        return `${input.url} → ${out.ok === false ? 'failed' : (out.role?.title || out.slug || 'saved')}`;
      case 'update_preferences': {
        const asArr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
        const b = asArr(input.blocked);
        const mh = asArr(input.must_have);
        const bits = [];
        if (b.length)  bits.push(`blocked × ${b.length}`);
        if (mh.length) bits.push(`must_have × ${mh.length}`);
        return bits.join(' · ') || 'noted';
      }
      default:
        return '';
    }
  }

  render() {
    return html`
      <button class="chat-fab"
              aria-label=${this.open ? 'Close chat' : 'Open chat'}
              aria-expanded=${this.open ? 'true' : 'false'}
              @click=${() => this._toggle()}>
        <span class="chat-fab__icon" aria-hidden="true">${this.open ? '×' : '✨'}</span>
      </button>

      ${this.open ? html`
        <div class="chat-scrim" @click=${() => this._toggle()} aria-hidden="true"></div>
        <aside class="chat-drawer" role="dialog" aria-label="Job chat">
          <header class="chat-drawer__head">
            <span class="chat-drawer__title">Ask /job</span>
            <button class="chat-drawer__close" aria-label="Close" @click=${() => this._toggle()}>×</button>
          </header>

          <div class="chat-drawer__thread">
            ${this.messages.length === 0 ? html`
              <div class="chat-empty">
                <p>I'm the /job agent. Ask me about your pipeline, paste a role to save, change a stage, or steer your preferences.</p>
              </div>
            ` : this.messages.map((m) => this._renderEvent(m))}
            ${this.sending ? html`
              <div class="chat-msg chat-msg--assistant chat-msg--pending">
                <div class="chat-msg__body"><span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span></div>
              </div>
            ` : nothing}
            ${this.error ? html`<div class="chat-error">${this.error}</div>` : nothing}
          </div>

          ${this.messages.length === 0 ? html`
            <div class="chat-drawer__chips">
              ${QUICK_PROMPTS.map((p) => html`
                <button class="chat-chip" @click=${() => this._useQuickPrompt(p)}>${p}</button>
              `)}
            </div>
          ` : nothing}

          <form class="chat-drawer__composer" @submit=${(e) => { e.preventDefault(); this._send(); }}>
            <textarea class="chat-drawer__input"
                      placeholder="Ask anything…"
                      rows="1"
                      .value=${this.draft}
                      ?disabled=${this.sending}
                      @input=${(e) => { this.draft = e.target.value; }}
                      @keydown=${this._onKeyDown}></textarea>
            <button class="chat-drawer__send btn btn--primary"
                    type="submit"
                    aria-label="Send"
                    ?disabled=${this.sending || !this.draft.trim()}>
              ↑
            </button>
          </form>
        </aside>
      ` : nothing}
    `;
  }
}

customElements.define('job-chat', JobChat);
