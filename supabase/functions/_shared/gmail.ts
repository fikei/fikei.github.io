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
  // Cap pages so a runaway query can't burn the whole tick.
  for (let page = 0; page < 5; page++) {
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
  }
  // messages.list doesn't return historyId; caller should ask
  // getProfileHistoryId after a successful timestamp scan to seed the
  // history cursor for the next tick.
  return { messageIds: dedupe(ids), nextHistoryId: null, historyExpired: false };
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
