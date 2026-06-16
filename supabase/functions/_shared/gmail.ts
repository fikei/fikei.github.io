// Minimal Gmail API client for Phase 1 of the jobs pipe.
//
// What this provides:
//   - listSinceCursor:  fetch Gmail message IDs newer than a stored
//                       historyId (preferred) or ISO timestamp (fallback).
//   - getMessage:       fetch one message with headers + decoded text body.
//   - extractFields:    helpers to pull subject, sender, plain-text body,
//                       and the canonical Message-ID header for dedupe.
//
// Constraints:
//   - We never persist raw bodies. Callers extract structured fields and
//     either emit a recommendation row or log to gmail_skipped.
//   - We only request format=metadata or format=full as needed to keep
//     response size low.

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPayloadPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string };
  parts?: GmailPayloadPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPayloadPart;
}

export interface ListResult {
  messageIds: string[];
  nextHistoryId: string | null;
  // True when the caller should fall back to a fresh `q` query because
  // the historyId we sent was too old (Gmail expires history after ~7
  // days). Caller catches this and re-runs with the timestamp fallback.
  historyExpired: boolean;
  // True when the timestamp path hit its page cap and there were more
  // results — the oldest messages in the window were silently dropped.
  // Caller should log this so a long backfill is visible, not assumed
  // complete.
  truncated?: boolean;
}

// ---------- Listing ----------
//
// Two paths:
//   1. history.list when we have a stored historyId. Cheapest.
//   2. messages.list?q=…  fallback when there's no history (first run)
//      or history expired. Returns messages newer than `after:` epoch.

export async function listSinceCursor(
  accessToken: string,
  cursor: { historyId?: string | null; afterEpochSec?: number | null },
  query?: string,                                       // e.g. 'newer_than:7d category:updates'
): Promise<ListResult> {
  if (cursor.historyId) {
    const url = new URL(`${GMAIL_BASE}/history`);
    url.searchParams.set('startHistoryId', cursor.historyId);
    url.searchParams.set('historyTypes', 'messageAdded');
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status === 404 || r.status === 410) {
      // History expired. Caller should retry with the timestamp path.
      return { messageIds: [], nextHistoryId: null, historyExpired: true };
    }
    if (!r.ok) throw new Error(`gmail history.list ${r.status}: ${await r.text()}`);
    const data = await r.json() as { history?: Array<{ messagesAdded?: Array<{ message: GmailMessageRef }> }>; historyId?: string };
    const ids: string[] = [];
    for (const h of (data.history || [])) {
      for (const ma of (h.messagesAdded || [])) {
        if (ma.message?.id) ids.push(ma.message.id);
      }
    }
    return { messageIds: dedupe(ids), nextHistoryId: data.historyId || cursor.historyId || null, historyExpired: false };
  }

  // Timestamp path. Default to last 14 days if no cursor at all.
  const afterEpoch = cursor.afterEpochSec ?? Math.floor((Date.now() - 14 * 24 * 60 * 60 * 1000) / 1000);
  const q = [query || '', `after:${afterEpoch}`].filter(Boolean).join(' ');
  const ids: string[] = [];
  let pageToken: string | undefined;
  let truncated = false;
  // Cap pages so a runaway query can't burn the whole tick.
  const MAX_PAGES = 5;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${GMAIL_BASE}/messages`);
    url.searchParams.set('q', q);
    url.searchParams.set('maxResults', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw new Error(`gmail messages.list ${r.status}: ${await r.text()}`);
    const data = await r.json() as { messages?: GmailMessageRef[]; nextPageToken?: string };
    for (const m of (data.messages || [])) ids.push(m.id);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
    if (page === MAX_PAGES - 1) truncated = true;   // more pages remained
  }
  if (truncated) {
    console.warn(`[gmail] messages.list hit ${MAX_PAGES}-page cap for q="${q.slice(0, 120)}" — oldest results dropped this tick`);
  }
  // messages.list doesn't return historyId; caller should ask
  // getProfileHistoryId after a successful timestamp scan to seed the
  // history cursor for the next tick.
  return { messageIds: dedupe(ids), nextHistoryId: null, historyExpired: false, truncated };
}

// Fetch the user's profile to seed a historyId on first scan. Cheaper
// than walking the inbox just to learn what "now" is.
export async function getProfileHistoryId(accessToken: string): Promise<string | null> {
  const r = await fetch(`${GMAIL_BASE}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) return null;
  const data = await r.json() as { historyId?: string };
  return data.historyId || null;
}

// ---------- Single message ----------

export async function getMessage(
  accessToken: string,
  id: string,
  format: 'metadata' | 'full' = 'full',
): Promise<GmailMessage> {
  const url = new URL(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}`);
  url.searchParams.set('format', format);
  if (format === 'metadata') {
    for (const h of ['Subject', 'From', 'To', 'Date', 'Message-ID', 'List-Unsubscribe']) {
      url.searchParams.append('metadataHeaders', h);
    }
  }
  const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`gmail messages.get(${id}) ${r.status}: ${await r.text()}`);
  return await r.json() as GmailMessage;
}

// ---------- Extraction helpers ----------

export function getHeader(msg: GmailMessage, name: string): string | null {
  const headers = msg.payload?.headers || [];
  const lc = name.toLowerCase();
  const h = headers.find(h => h.name.toLowerCase() === lc);
  return h?.value ?? null;
}

// Walk the MIME tree, prefer text/plain, fall back to text/html stripped.
export function extractBody(msg: GmailMessage): string {
  const parts = flattenParts(msg.payload);
  const plain = parts.find(p => (p.mimeType || '').toLowerCase() === 'text/plain' && p.body?.data);
  if (plain) return decodeB64Url(plain.body!.data!);
  const html = parts.find(p => (p.mimeType || '').toLowerCase() === 'text/html' && p.body?.data);
  if (html) return stripHtml(decodeB64Url(html.body!.data!));
  // Top-level body for simple messages
  if (msg.payload?.body?.data) {
    const decoded = decodeB64Url(msg.payload.body.data);
    return (msg.payload.mimeType || '').toLowerCase().includes('html') ? stripHtml(decoded) : decoded;
  }
  return msg.snippet || '';
}

// Pull the angle-bracketed Message-ID for cross-run dedupe. Falls back
// to the Gmail API id if the header is missing (rare but possible on
// drafts / corrupted messages).
export function getMessageIdHeader(msg: GmailMessage): string {
  const raw = getHeader(msg, 'Message-ID') || getHeader(msg, 'Message-Id');
  if (raw) return raw.trim();
  return `gmail-id:${msg.id}`;
}

// ---------- private ----------

function flattenParts(part?: GmailPayloadPart): GmailPayloadPart[] {
  if (!part) return [];
  const out: GmailPayloadPart[] = [part];
  for (const p of (part.parts || [])) out.push(...flattenParts(p));
  return out;
}

function decodeB64Url(s: string): string {
  // Gmail uses URL-safe base64 with no padding.
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
  try {
    const bytes = Uint8Array.from(atob(norm + pad), c => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ---------- Labels ----------
//
// Every Gmail message the pipeline touches gets stamped with a label so
// the user can audit what we've used. Requires gmail.modify scope (a
// strict superset of gmail.readonly).

export interface GmailLabel {
  id: string;
  name: string;
  type?: 'user' | 'system';
}

// Idempotent: returns the existing label id when present, otherwise
// creates it. Cache the result per-process to avoid the list/create
// round-trip on every batch.
const _labelCache = new Map<string, string>();   // accessToken+name → labelId

export async function ensureLabel(accessToken: string, name: string): Promise<string> {
  const cacheKey = `${accessToken.slice(0, 24)}:${name}`;
  const cached = _labelCache.get(cacheKey);
  if (cached) return cached;

  // List existing labels. labels.list returns user + system labels.
  const listRes = await fetch(`${GMAIL_BASE}/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`labels.list ${listRes.status}: ${(await listRes.text()).slice(0, 200)}`);
  const list = await listRes.json() as { labels?: GmailLabel[] };
  const existing = (list.labels || []).find(l => l.name === name);
  if (existing) {
    _labelCache.set(cacheKey, existing.id);
    return existing.id;
  }

  // Create the label. labelListVisibility/messageListVisibility default
  // to visible — the user wants to see emails the pipeline has touched.
  const createRes = await fetch(`${GMAIL_BASE}/labels`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      labelListVisibility:    'labelShow',
      messageListVisibility:  'show',
    }),
  });
  if (!createRes.ok) throw new Error(`labels.create ${createRes.status}: ${(await createRes.text()).slice(0, 200)}`);
  const created = await createRes.json() as GmailLabel;
  _labelCache.set(cacheKey, created.id);
  return created.id;
}

// Apply a label to many Gmail messages in one round-trip. Gmail's
// batchModify accepts up to 1000 ids per call; we chunk just in case.
// No-ops on empty input. Failures are caught + logged, never thrown —
// labeling is a side-effect, not the critical path.
export async function batchAddLabel(
  accessToken: string,
  messageIds: string[],
  labelId: string,
): Promise<{ labeled: number; chunks: number; errors: string[] }> {
  const out = { labeled: 0, chunks: 0, errors: [] as string[] };
  if (!messageIds.length) return out;
  const unique = [...new Set(messageIds.filter(Boolean))];
  const CHUNK = 900;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const r = await fetch(`${GMAIL_BASE}/messages/batchModify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: chunk, addLabelIds: [labelId] }),
      });
      if (!r.ok) {
        const errBody = (await r.text()).slice(0, 200);
        out.errors.push(`batchModify ${r.status}: ${errBody}`);
        continue;
      }
      out.labeled += chunk.length;
      out.chunks++;
    } catch (e) {
      out.errors.push((e as Error).message);
    }
  }
  return out;
}

// Convenience: ensure label + apply in one call. Used by the live
// pipeline (gmail-jobs + application-scan) where we always want the
// same Ladder label applied to every touched message.
export async function ensureAndApplyLabel(
  accessToken: string,
  messageIds: string[],
  labelName: string,
): Promise<{ labelId: string | null; labeled: number; errors: string[] }> {
  if (!messageIds.length) return { labelId: null, labeled: 0, errors: [] };
  try {
    const labelId = await ensureLabel(accessToken, labelName);
    const res = await batchAddLabel(accessToken, messageIds, labelId);
    return { labelId, labeled: res.labeled, errors: res.errors };
  } catch (e) {
    return { labelId: null, labeled: 0, errors: [(e as Error).message] };
  }
}
