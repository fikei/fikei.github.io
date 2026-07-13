// ladder-updates — the Updates queue as a standalone component, mounted at
// the top of the Inbox (/ladder/jobs/recommended/). Inbox is the de facto
// "Today" surface for the MVP: what the system did / what needs you on top,
// new roles to triage below.
//
// Feed assembly (one row per role, priority wins):
//   - server `updates` feed (application-events): auto-action records w/
//     Undo, offer/rejection prompts, reply-pending, stale
//   - calendar matches (next 48h) — client-side join
//   - role closures (liveness detected the posting gone; role already
//     auto-archived) — synthetic rows from pipeline closedDetectedAt,
//     replaces the old red closed-banner
//   - easy-apply digest — synthetic "N saved jobs are easy applies" row
//
// Dismissal: server-persisted (dismissed_at) for event rows; localStorage
// set `job:jobs:dismissedUpdates` for synthetic rows (closures, calendar,
// stale, digest). Mutations dispatch `job:pipeline:refresh` so any mounted
// pipeline table re-syncs.
import { LitElement, html, nothing } from 'https://esm.run/lit@3';
import { unsafeHTML } from 'https://esm.run/lit@3/directives/unsafe-html.js';
const V = (new URL(import.meta.url)).search;
const { fetchPipeline, bucketFor, isVisibleRole } = await import('../pipeline.js' + V);
const { ackEvent, loadUpdates, resolveEvent, undoEvent, dismissUpdate, updateKindMeta, roleMatchedEvents } = await import('../applicationEvents.js' + V);

const DISMISSED_KEY = 'job:jobs:dismissedUpdates';

export class LadderUpdates extends LitElement {
  createRenderRoot() { return this; }

  static properties = {
    updates:    { state: true },
    updateBusy: { state: true },
  };

  constructor() {
    super();
    this.updates = [];
    this.updateBusy = null;
    this._roles = [];
    this._localDismissed = (() => {
      try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); }
    })();
    this._lastVisitAt = (() => {
      try { return localStorage.getItem('job:jobs:lastVisitAt') || null; } catch { return null; }
    })();
  }

  connectedCallback() {
    super.connectedCallback();
    this._load();
    this._onAuth = () => this._load();
    document.addEventListener('ctrl:auth:signedin', this._onAuth);
    document.addEventListener('job:auth:ready', this._onAuth);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('ctrl:auth:signedin', this._onAuth);
    document.removeEventListener('job:auth:ready', this._onAuth);
  }

  async _load() {
    if (document.body.dataset.authState !== 'in') return;
    if (this._loading) return;
    this._loading = true;
    try {
      const [feedRes, calRes, pipeRes] = await Promise.allSettled([
        loadUpdates(),
        roleMatchedEvents({ windowHours: 48 }),
        fetchPipeline(),
      ]);

      let items = [];
      if (feedRes.status === 'fulfilled') items = feedRes.value.items || [];
      else console.warn('[ladder-updates] feed load failed:', feedRes.reason?.message);

      if (calRes.status === 'fulfilled') {
        for (const m of (calRes.value.matches || [])) {
          const hoursOut = (new Date(m.start).getTime() - Date.now()) / 3_600_000;
          if (hoursOut < 0) continue;
          const when = hoursOut < 2
            ? `in ${Math.max(1, Math.round(hoursOut * 60))}m`
            : hoursOut < 24 ? `today ${this._fmtTime(m.start)}` : `${this._fmtDay(m.start)} ${this._fmtTime(m.start)}`;
          items.push({
            kind: 'calendar_today', action: 'open_role', priority: 2,
            role_slug: m.role_slug, company: m.company, title: m.title,
            text: `${m.company} interview ${when}`, detail: m.summary || '',
            received_at: m.start,
          });
        }
      }

      if (pipeRes.status === 'fulfilled') {
        this._roles = (pipeRes.value.roles || []).slice();
        items.push(...this._closureRows());
        const digest = this._easyApplyDigest();
        if (digest) items.push(digest);
      }

      const byRole = new Map();
      for (const it of items) {
        const cur = byRole.get(it.role_slug);
        if (!cur || it.priority < cur.priority) byRole.set(it.role_slug, it);
      }
      this.updates = [...byRole.values()]
        .filter(it => it.event_id || !this._localDismissed.has(this._updateKey(it)))
        .sort((a, b) => a.priority - b.priority
          || new Date(b.received_at || 0).getTime() - new Date(a.received_at || 0).getTime());
    } finally {
      this._loading = false;
    }
  }

  // Role closures — the liveness sweep found the posting gone and already
  // archived the role; the queue row is the record of that (replaces the
  // old red closed-banner). Dismiss keys on the closure date, so a role
  // closed → dismissed → re-opened → re-closed months later re-surfaces.
  _closureRows() {
    const cutoff = this._lastVisitAt ? Date.parse(this._lastVisitAt) - 7 * 86_400_000 : 0;
    let seenThrough = 0;
    try { seenThrough = Number(localStorage.getItem('job:jobs:closedSeenThrough') || 0); } catch { /* legacy watermark */ }
    return this._roles
      .filter(r => r.closedDetectedAt
        && Date.parse(r.closedDetectedAt) > Math.max(cutoff, seenThrough)
        && Date.now() - Date.parse(r.closedDetectedAt) < 7 * 86_400_000)
      .map(r => ({
        kind: 'role_closed', action: 'open_role', priority: 4,
        role_slug: r.slug, company: r.company, title: r.title,
        text: `${r.company || r.slug} closed the posting`,
        detail: 'Archived automatically — the role is no longer listed',
        received_at: r.closedDetectedAt,
      }));
  }

  // Synthetic "N saved jobs are easy applies" digest (Phase 16.1).
  _easyApplyDigest() {
    const easies = this._roles.filter(r =>
      isVisibleRole(r) && bucketFor(r) === 'saved' && r.applyEase === 'easy' && !r.engagedAt);
    if (!easies.length) return null;
    const preview = easies.slice(0, 3).map(r => r.company).filter(Boolean).join(', ');
    const it = {
      kind: 'easy_apply', action: 'ease_filter', priority: 6,
      role_slug: 'easy-apply-digest',
      href: '/ladder/jobs/?bucket=saved&ease=easy',
      text: `${easies.length} saved ${easies.length === 1 ? 'job is an easy apply' : 'jobs are easy applies'} — no written questions`,
      detail: preview + (easies.length > 3 ? ` +${easies.length - 3} more` : ''),
      received_at: new Date().toISOString(),
    };
    if (this._localDismissed.has(this._updateKey(it))) return null;
    return it;
  }

  _updateKey(it) { return `${it.kind}:${it.role_slug}:${(it.received_at || '').slice(0, 10)}`; }

  _fmtTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
  }

  _fmtDay(iso) {
    try {
      const diff = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
      if (diff <= 0) return 'today';
      if (diff === 1) return 'tomorrow';
      return new Date(iso).toLocaleDateString([], { weekday: 'short' });
    } catch { return ''; }
  }

  _relTime(iso) {
    if (!iso) return '';
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    return `${days}d ago`;
  }

  _toastMsg(msg, extra = {}) {
    document.dispatchEvent(new CustomEvent('job:toast', { detail: { msg, ...extra } }));
  }

  async _refreshAfterMutation() {
    document.dispatchEvent(new CustomEvent('job:pipeline:refresh'));
    await this._load();
  }

  async _onUpdateAction(it) {
    const key = it.event_id || this._updateKey(it);
    switch (it.action) {
      case 'undo': {
        this.updateBusy = key;
        try {
          await undoEvent(it.event_id);
          this._toastMsg(`Restored ${it.company}`);
          await this._refreshAfterMutation();
        } catch (e) {
          this._toastMsg(`Undo failed: ${e.message}`);
        } finally { this.updateBusy = null; }
        break;
      }
      case 'stage_offer':
      case 'archive': {
        this.updateBusy = key;
        try {
          await resolveEvent(it.event_id, it.action,
            it.action === 'archive' ? { exit_reason: it.suggested_exit_reason } : {});
          this._toastMsg(
            it.action === 'archive' ? `Archived ${it.company}` : `Moved ${it.company} to Offer`,
            { action: 'Undo', onAction: () => this._undoById(it.event_id), duration: 8000 },
          );
          await this._refreshAfterMutation();
        } catch (e) {
          this._toastMsg(`Couldn't apply: ${e.message}`);
        } finally { this.updateBusy = null; }
        break;
      }
      case 'open_gmail': {
        const url = it.gmail_thread_id
          ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(it.gmail_thread_id)}`
          : 'https://mail.google.com';
        window.open(url, '_blank', 'noopener');
        if (it.event_id) { try { await ackEvent(it.event_id); } catch { /* best-effort */ } }
        break;
      }
      case 'ease_filter': {
        window.location.assign('/ladder/jobs/?bucket=saved&ease=easy');
        break;
      }
      case 'follow_up': {
        const q = encodeURIComponent(it.company || '');
        window.open(`https://mail.google.com/mail/u/0/#search/${q}`, '_blank', 'noopener');
        break;
      }
      case 'open_role':
      default: {
        if (it.event_id) { try { await ackEvent(it.event_id); } catch { /* best-effort */ } }
        window.location.assign(`/ladder/jobs/${it.role_slug}/`);
      }
    }
  }

  async _undoById(eventId) {
    try {
      await undoEvent(eventId);
      await this._refreshAfterMutation();
    } catch (e) {
      this._toastMsg(`Undo failed: ${e.message}`);
    }
  }

  async _onDismissUpdate(it) {
    this.updates = this.updates.filter(u => u !== it);
    this.requestUpdate();
    if (it.event_id) {
      try { await dismissUpdate(it.event_id); } catch (e) { console.warn('[ladder-updates] dismiss failed:', e.message); }
    } else {
      this._localDismissed.add(this._updateKey(it));
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...this._localDismissed])); } catch { /* */ }
    }
  }

  render() {
    const items = this.updates || [];
    if (!items.length) return nothing;
    return html`
      <section class="updates-queue" aria-label="Updates">
        <div class="updates-queue__header">
          <strong>Updates</strong>
          <span>${items.length} to resolve</span>
        </div>
        ${items.map(it => this._renderUpdateRow(it))}
      </section>
    `;
  }

  _renderUpdateRow(it) {
    const meta = updateKindMeta(it.kind);
    const busy = this.updateBusy === (it.event_id || this._updateKey(it));
    return html`
      <div class="updates-row" id=${`update-${it.role_slug}`}>
        <span class="updates-row__icon updates-row__icon--${meta.tint}" aria-hidden="true">${unsafeHTML(meta.icon)}</span>
        <div class="updates-row__body">
          <a class="updates-row__text" href=${it.href || `/ladder/jobs/${it.role_slug}/`}>
            <strong>${it.text}</strong>
            ${it.title ? html`<span class="muted"> · ${it.title}</span>` : nothing}
            ${it.received_at ? html`<span class="muted"> · ${this._relTime(it.received_at)}</span>` : nothing}
          </a>
          ${it.detail ? html`<span class="updates-row__detail muted">${it.detail}</span>` : nothing}
        </div>
        <button class="btn btn--sm updates-row__action" ?disabled=${busy}
                @click=${() => this._onUpdateAction(it)}>
          ${busy ? 'Working…' : meta.actionLabel}
        </button>
        <button class="updates-row__dismiss" aria-label="Dismiss"
                @click=${() => this._onDismissUpdate(it)}>×</button>
      </div>
    `;
  }
}

customElements.define('ladder-updates', LadderUpdates);
