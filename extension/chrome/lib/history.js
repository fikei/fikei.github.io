// Rodeo Extension — Browser history capture (privacy-first)
// Loaded via importScripts() in background.js
// Depends on: privacy.js, sanitize.js, auth.js, supabase.js, background.js (getOrCreateDeviceId)
//
// Privacy invariant: Raw URLs NEVER leave the device.
// Only url_hash (SHA-256), canonical_domain, truncated page_title,
// and referrer_domain are transmitted to the server.

const HISTORY_BUFFER_KEY = 'rodeo_history_buffer';
const HISTORY_SESSION_KEY = 'rodeo_history_session';
const FLUSH_INTERVAL_MS = 30_000;   // 30 seconds
const FLUSH_BATCH_SIZE = 50;        // auto-flush threshold
const SESSION_GAP_MS = 30 * 60_000; // 30 min inactivity → new session
const INGEST_ENDPOINT = '/functions/v1/ingest-history';

// Visit counting (per-page, local-only)
const VISIT_COUNT_KEY = 'rodeo_visit_counts';  // keyed by url_hash
const VISIT_URL_KEY = 'rodeo_visit_urls';      // keyed by canonical URL (for popup)
const VISIT_COUNT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const VISIT_COUNT_MAX_ENTRIES = 2000;

let _historyBuffer = [];
let _flushTimer = null;
let _sessionId = null;
let _lastEventTime = 0;

// ============================================
// Initialization (called once from background.js)
// ============================================
async function initHistoryCapture() {
  // Restore persisted buffer (MV3 service worker may have been suspended)
  try {
    const data = await chrome.storage.local.get([HISTORY_BUFFER_KEY, HISTORY_SESSION_KEY]);
    _historyBuffer = data[HISTORY_BUFFER_KEY] || [];
    _sessionId = data[HISTORY_SESSION_KEY] || crypto.randomUUID();
    _lastEventTime = Date.now();
  } catch {
    _historyBuffer = [];
    _sessionId = crypto.randomUUID();
  }

  // Load privacy settings into cache
  await getPrivacySettings();

  // Schedule periodic flush
  _scheduleFlush();

  // Flush any events left over from previous worker lifecycle
  if (_historyBuffer.length > 0) {
    flushBuffer();
  }

  console.log(`[rodeo] history capture initialized, buffer=${_historyBuffer.length}`);
}

// ============================================
// Record a Navigation Event
// ============================================
async function recordNavigation({ url, title, referrerUrl, tabId }) {
  // Check if history capture is enabled
  const settings = await getPrivacySettings();
  if (settings.historyEnabled === false) return;

  // Skip non-http(s) URLs
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return;

  // Skip incognito tabs
  if (tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.incognito) return;
    } catch {
      // Tab may have closed — skip
      return;
    }
  }

  // Extract and check domain
  const domain = extractDomain(url);
  if (isDomainBlocked(domain)) return;

  // Canonicalize URL and hash it
  const canonical = canonicalizeForHash(url);
  if (!canonical) return;
  const urlHash = await hashUrl(canonical);

  // Session management — new session after 30 min gap
  const now = Date.now();
  if (now - _lastEventTime > SESSION_GAP_MS) {
    _sessionId = crypto.randomUUID();
    chrome.storage.local.set({ [HISTORY_SESSION_KEY]: _sessionId }).catch(() => {});
  }
  _lastEventTime = now;

  // Build event
  const deviceId = await getOrCreateDeviceId();
  const event = {
    device_id: deviceId,
    visited_at: new Date(now).toISOString(),
    canonical_domain: domain.slice(0, 253),
    url_hash: urlHash,
    page_title: title ? title.slice(0, 100) : null,
    referrer_domain: referrerUrl ? extractDomain(referrerUrl).slice(0, 253) : null,
    session_id: _sessionId,
    source: 'navigation'
  };

  _historyBuffer.push(event);
  _persistBuffer();

  // Update local visit counter (per-page, dual-keyed)
  updateLocalVisitCount({ urlHash, canonicalUrl: canonical, title: title ? title.slice(0, 100) : '', domain });

  // Auto-flush at threshold
  if (_historyBuffer.length >= FLUSH_BATCH_SIZE) {
    flushBuffer();
  }
}

// ============================================
// Flush Buffer to Server
// ============================================
async function flushBuffer() {
  if (_historyBuffer.length === 0) return;

  const session = await getSession();
  if (!session || !session.access_token) {
    // Not authenticated — keep buffer, try later
    _scheduleFlush();
    return;
  }

  // Take current batch and clear buffer
  const batch = _historyBuffer.splice(0, 200);
  _persistBuffer();

  try {
    const res = await fetch(`${SUPABASE_URL}${INGEST_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ events: batch })
    });

    if (res.ok) {
      const result = await res.json();
      console.log(`[rodeo] history flush: inserted=${result.inserted} skipped=${result.skipped}`);
    } else if (res.status === 401 || res.status === 403) {
      // Token expired — re-queue events and clear session
      _historyBuffer.unshift(...batch);
      _persistBuffer();
      await clearCachedSession();
      console.warn('[rodeo] history flush auth failed, will retry');
    } else {
      // Server error — re-queue events
      _historyBuffer.unshift(...batch);
      _persistBuffer();
      console.warn(`[rodeo] history flush failed: ${res.status}`);
    }
  } catch (e) {
    // Network error — re-queue events
    _historyBuffer.unshift(...batch);
    _persistBuffer();
    console.warn('[rodeo] history flush network error:', e.message);
  }

  _scheduleFlush();
}

// ============================================
// Backfill from Chrome History API
// ============================================
async function runBackfill() {
  const settings = await getPrivacySettings();
  if (settings.historyEnabled === false) {
    return { error: 'History capture is paused' };
  }

  const days = settings.backfillDays || 30;
  const startTime = Date.now() - (days * 24 * 60 * 60 * 1000);

  let items;
  try {
    items = await chrome.history.search({
      text: '',
      startTime,
      maxResults: 10000
    });
  } catch (e) {
    console.error('[rodeo] backfill history.search failed:', e.message);
    return { error: 'Failed to read browser history' };
  }

  const deviceId = await getOrCreateDeviceId();
  let queued = 0;

  for (const item of items) {
    if (!item.url || (!item.url.startsWith('http://') && !item.url.startsWith('https://'))) continue;

    const domain = extractDomain(item.url);
    if (isDomainBlocked(domain)) continue;

    const canonical = canonicalizeForHash(item.url);
    if (!canonical) continue;

    const urlHash = await hashUrl(canonical);

    _historyBuffer.push({
      device_id: deviceId,
      visited_at: new Date(item.lastVisitTime || Date.now()).toISOString(),
      canonical_domain: domain.slice(0, 253),
      url_hash: urlHash,
      page_title: item.title ? item.title.slice(0, 100) : null,
      referrer_domain: null,
      session_id: 'backfill',
      source: 'history'
    });
    queued++;
  }

  _persistBuffer();
  console.log(`[rodeo] backfill queued ${queued} events from ${items.length} history items`);

  // Immediately start flushing
  flushBuffer();

  return { queued, total: items.length };
}

// ============================================
// Delete History
// ============================================
async function deleteHistoryInWindow(windowMs) {
  const session = await getSession();
  if (!session || !session.access_token) return { error: 'Not authenticated' };

  const cutoff = new Date(Date.now() - windowMs).toISOString();
  try {
    const res = await supabaseDelete(
      `/rest/v1/browsing_history?user_id=eq.${session.user.id}&visited_at=gte.${encodeURIComponent(cutoff)}`,
      session.access_token
    );
    if (!res.ok) {
      console.error('[rodeo] delete history failed:', res.status);
      return { error: 'Delete failed' };
    }
    return { success: true };
  } catch (e) {
    console.error('[rodeo] delete history error:', e.message);
    return { error: e.message };
  }
}

async function deleteAllHistory() {
  const session = await getSession();
  if (!session || !session.access_token) return { error: 'Not authenticated' };

  try {
    const res = await supabaseDelete(
      `/rest/v1/browsing_history?user_id=eq.${session.user.id}`,
      session.access_token
    );
    if (!res.ok) {
      console.error('[rodeo] delete all history failed:', res.status);
      return { error: 'Delete failed' };
    }
    // Also clear local buffer
    _historyBuffer = [];
    _persistBuffer();
    return { success: true };
  } catch (e) {
    console.error('[rodeo] delete all history error:', e.message);
    return { error: e.message };
  }
}

// ============================================
// Local Visit Counting (per-page, dual-keyed)
// ============================================
async function updateLocalVisitCount({ urlHash, canonicalUrl, title, domain }) {
  const now = Date.now();
  try {
    // Hash-keyed map (for content script lookups via background)
    const data = await chrome.storage.local.get(VISIT_COUNT_KEY);
    const counts = data[VISIT_COUNT_KEY] || {};
    const existing = counts[urlHash];

    counts[urlHash] = {
      count: (existing?.count || 0) + 1,
      lastVisit: now,
      title: title || (existing?.title || ''),
      domain: domain || (existing?.domain || '')
    };

    // Prune if over limit
    const keys = Object.keys(counts);
    if (keys.length > VISIT_COUNT_MAX_ENTRIES) {
      const cutoff = now - VISIT_COUNT_MAX_AGE_MS;
      for (const k of keys) {
        if (counts[k].lastVisit < cutoff) delete counts[k];
      }
      const remaining = Object.keys(counts);
      if (remaining.length > VISIT_COUNT_MAX_ENTRIES) {
        remaining
          .sort((a, b) => counts[a].lastVisit - counts[b].lastVisit)
          .slice(0, remaining.length - VISIT_COUNT_MAX_ENTRIES)
          .forEach(k => delete counts[k]);
      }
    }

    await chrome.storage.local.set({ [VISIT_COUNT_KEY]: counts });
  } catch (e) {
    console.warn('[rodeo] visit count update failed:', e.message);
  }

  // URL-keyed map (for popup lookups without crypto.subtle)
  if (canonicalUrl) {
    try {
      const urlData = await chrome.storage.local.get(VISIT_URL_KEY);
      const urlCounts = urlData[VISIT_URL_KEY] || {};
      urlCounts[canonicalUrl] = {
        count: (urlCounts[canonicalUrl]?.count || 0) + 1,
        lastVisit: now,
        urlHash
      };
      const urlKeys = Object.keys(urlCounts);
      if (urlKeys.length > VISIT_COUNT_MAX_ENTRIES) {
        urlKeys
          .sort((a, b) => urlCounts[a].lastVisit - urlCounts[b].lastVisit)
          .slice(0, urlKeys.length - VISIT_COUNT_MAX_ENTRIES)
          .forEach(k => delete urlCounts[k]);
      }
      await chrome.storage.local.set({ [VISIT_URL_KEY]: urlCounts });
    } catch {}
  }
}

// ============================================
// Internal Helpers
// ============================================
function _persistBuffer() {
  chrome.storage.local.set({ [HISTORY_BUFFER_KEY]: _historyBuffer }).catch(() => {});
}

function _scheduleFlush() {
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => flushBuffer(), FLUSH_INTERVAL_MS);
}
