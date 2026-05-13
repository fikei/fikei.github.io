// job-chat-page — read-only browser for the user's chat threads at
// /job/chat/. Two-pane layout: thread list on the left, messages on
// the right. Pulls from public.chat_thread + public.chat_message
// (RLS-gated, so we just SELECT with the user's Supabase client).
//
// New conversations are still started via the floating drawer
// (<job-chat>). This page exists so the history is a real, browsable
// artifact — not just an ephemeral pop-up. Future: per-thread title
// rename + archive + delete + spin-up-new-thread from the drawer.

import { LitElement, html, nothing } from 'https://esm.run/lit@3';

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

export class JobChatPage extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    state:    { state: true },
    error:    { state: true },
    threads:  { state: true },
    selected: { state: true },
    messages: { state: true },
  };

  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.threads = [];
    this.selected = null;
    this.messages = [];
  }

  connectedCallback() {
    super.connectedCallback();
    this._onAuth = () => this._loadThreads();
    document.addEventListener('job:auth:ready', this._onAuth);
    if (document.body.dataset.authState === 'in') this._loadThreads();
  }
  disconnectedCallback() {
    document.removeEventListener('job:auth:ready', this._onAuth);
    super.disconnectedCallback();
  }

  _supabase() { return window.CtrlAuth?.getSupabaseClient?.(); }

  async _loadThreads() {
    if (this.state === 'loading' || this.state === 'loaded') return;
    const sb = this._supabase();
    if (!sb) return;
    this.state = 'loading';
    try {
      const { data, error } = await sb
        .from('chat_thread')
        .select('id, title, created_at, last_message_at, archived_at')
        .order('last_message_at', { ascending: false, nullsLast: true });
      if (error) throw error;
      this.threads = data || [];
      if (this.threads.length) {
        await this._selectThread(this.threads[0].id);
      }
      this.state = 'loaded';
    } catch (e) {
      this.error = String(e?.message || e);
      this.state = 'error';
    }
  }

  async _selectThread(threadId) {
    this.selected = threadId;
    this.messages = [];
    const sb = this._supabase();
    if (!sb) return;
    const { data, error } = await sb
      .from('chat_message')
      .select('id, role, body, tool_name, tool_payload, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) {
      this.error = String(error.message || error);
      return;
    }
    this.messages = data || [];
  }

  _renderEvent(m) {
    if (m.role === 'tool') {
      const summary = this._summarizeTool(m);
      return html`
        <div class="chat-tool" title=${new Date(m.created_at).toLocaleString()}>
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
      case 'read_preferences': {
        const len = (k) => (out?.[k]?.value || out?.[k] || []).length;
        return `blocked ${len('blocked_titles')} · must_have ${len('must_have_keywords')}`;
      }
      case 'search_pipeline':     return `"${input.query || ''}" → ${out.count ?? 0} matches`;
      case 'update_pipeline_row': return `${input.slug} · ${Object.entries(input).filter(([k]) => k !== 'slug').map(([k, v]) => `${k}=${v}`).join(', ')}`;
      case 'add_role_from_url':   return `${input.url}`;
      case 'update_preferences': {
        const b = Array.isArray(input.blocked) ? input.blocked.length : 0;
        const mh = Array.isArray(input.must_have) ? input.must_have.length : 0;
        return `blocked × ${b} · must_have × ${mh}`;
      }
      default: return '';
    }
  }

  render() {
    if (this.state === 'idle' || this.state === 'loading') {
      return html`<p class="muted">Loading…</p>`;
    }
    if (this.state === 'error') {
      return html`<div class="placeholder"><h2>Couldn't load chat</h2><p>${this.error}</p></div>`;
    }
    if (!this.threads.length) {
      return html`
        <div class="placeholder">
          <h2>No conversations yet</h2>
          <p>Open the chat drawer (✨ bottom-right) to start one — it'll show up here afterwards.</p>
        </div>
      `;
    }

    return html`
      <div class="chat-page">
        <aside class="chat-page__sidebar" aria-label="Threads">
          ${this.threads.map((t) => html`
            <button class="chat-page__thread${t.id === this.selected ? ' is-active' : ''}"
                    @click=${() => this._selectThread(t.id)}>
              <span class="chat-page__thread-title">${t.title}</span>
              <span class="chat-page__thread-time">${relTime(t.last_message_at)}</span>
            </button>
          `)}
        </aside>
        <section class="chat-page__thread-view">
          ${this.messages.length === 0 ? html`<p class="muted">No messages.</p>` :
            this.messages.map((m) => this._renderEvent(m))}
        </section>
      </div>
    `;
  }
}

customElements.define('job-chat-page', JobChatPage);
