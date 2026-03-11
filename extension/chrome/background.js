// Rodeo — Save & Discover
// Service worker: context menus, message routing, pin save flow

importScripts('lib/sanitize.js', 'lib/supabase.js', 'lib/auth.js', 'lib/privacy.js', 'lib/history.js');

const BOARDS_URL = 'https://ctrl.rodeo/boards/';

// ============================================
// Device ID (stable per install)
// ============================================
async function getOrCreateDeviceId() {
  const data = await chrome.storage.local.get('rodeo_device_id');
  if (data.rodeo_device_id) return data.rodeo_device_id;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ rodeo_device_id: id });
  return id;
}

// ============================================
// Context Menu Setup
// ============================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-rodeo',
    title: 'Save to Rodeo',
    contexts: ['page', 'link', 'selection']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'save-to-rodeo') return;

  let url, title, selectedText, source;

  if (info.selectionText) {
    // Text selection — save current page with the selected text
    url = tab.url;
    title = tab.title;
    selectedText = info.selectionText.trim().slice(0, 2000);
    source = 'text_selection';
  } else if (info.linkUrl) {
    // Right-click on a link — save the link URL
    url = info.linkUrl;
    title = info.linkUrl; // will be enriched later
    selectedText = null;
    source = 'context_menu';
  } else {
    // Right-click on page — save current page
    url = tab.url;
    title = tab.title;
    selectedText = null;
    source = 'context_menu';
  }

  const result = await savePin({ url, title, selectedText, source });

  // Show badge feedback
  if (result.success) {
    showBadge(tab.id, 'OK', '#0f0');
  } else if (result.error === 'duplicate') {
    showBadge(tab.id, 'DUP', '#f90');
  } else if (result.error === 'not_authenticated') {
    showBadge(tab.id, '!', '#c00');
  } else {
    showBadge(tab.id, 'ERR', '#c00');
  }
});

// ============================================
// History Capture (Phase 2+3)
// ============================================
initHistoryCapture();

chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Main frame only
  if (details.frameId !== 0) return;
  // Skip chrome:// and extension pages
  if (!details.url || !details.url.startsWith('http')) return;

  try {
    const tab = await chrome.tabs.get(details.tabId);
    if (tab.incognito) return;
    recordNavigation({
      url: details.url,
      title: tab.title || '',
      referrerUrl: null,
      tabId: details.tabId
    });
  } catch {
    // Tab may have closed
  }
});

// ============================================
// Badge Feedback (context menu saves)
// ============================================
function showBadge(tabId, text, color) {
  chrome.action.setBadgeText({ text, tabId });
  chrome.action.setBadgeBackgroundColor({ color, tabId });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }, 2000);
}

// ============================================
// Message Routing
// ============================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'auth_token') {
    // Content script on ctrl.rodeo relaying auth session
    handleAuthRelay(msg.session);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'save') {
    // Popup requesting a save
    savePin(msg.data)
      .then(sendResponse)
      .catch(e => {
        console.error('[rodeo] save crashed:', e.message);
        sendResponse({ error: 'save_failed', detail: e.message });
      });
    return true; // async response
  }

  if (msg.action === 'get_session') {
    // Popup checking auth state
    getSession()
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }

  if (msg.action === 'get_tab_info') {
    // Popup requesting current tab info
    chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      const tab = tabs[0];
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        sendResponse({ error: 'unsupported_page' });
      } else {
        sendResponse({
          url: tab.url,
          title: tab.title || '',
          domain: extractDomain(tab.url),
          tabId: tab.id
        });
      }
    }).catch(() => sendResponse({ error: 'unsupported_page' }));
    return true;
  }

  if (msg.action === 'selection_update') {
    // Content script reporting text selection
    chrome.storage.session.set({
      rodeo_selection: msg.text,
      rodeo_selection_url: msg.url,
      rodeo_selection_at: Date.now()
    });
    return false;
  }

  if (msg.action === 'get_selection') {
    // Popup checking for recent text selection
    chrome.storage.session.get(
      ['rodeo_selection', 'rodeo_selection_url', 'rodeo_selection_at']
    ).then(data => {
      // Only return selection if it's recent (< 30s) and from the same URL
      if (data.rodeo_selection && data.rodeo_selection_at &&
          Date.now() - data.rodeo_selection_at < 30000 &&
          data.rodeo_selection_url === msg.url) {
        sendResponse({ text: data.rodeo_selection });
      } else {
        sendResponse({ text: null });
      }
    });
    return true;
  }

  if (msg.action === 'open_boards') {
    chrome.tabs.create({ url: BOARDS_URL });
    return false;
  }

  // --- History / Privacy handlers ---

  if (msg.action === 'get_privacy_settings') {
    getPrivacySettings()
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }

  if (msg.action === 'save_privacy_settings') {
    savePrivacySettings(msg.settings)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.action === 'start_backfill') {
    runBackfill()
      .then(sendResponse)
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.action === 'delete_history') {
    const handler = msg.window === 'all'
      ? deleteAllHistory()
      : deleteHistoryInWindow(msg.window);
    handler
      .then(sendResponse)
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.action === 'flush_history') {
    flushBuffer()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ error: e.message }));
    return true;
  }

  // --- Tab lifecycle handlers ---

  if (msg.action === 'close_tab') {
    if (msg.tabId) {
      chrome.tabs.remove(msg.tabId).catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'check_domain_blocked') {
    getPrivacySettings().then(() => {
      sendResponse({ blocked: isDomainBlocked(msg.domain) });
    }).catch(() => sendResponse({ blocked: false }));
    return true;
  }

  if (msg.action === 'get_nudge_settings') {
    getPrivacySettings().then(settings => {
      sendResponse({ nudgeEnabled: settings.nudgeEnabled !== false });
    }).catch(() => sendResponse({ nudgeEnabled: true }));
    return true;
  }

  if (msg.action === 'get_visit_data_for_url') {
    (async () => {
      try {
        const canonical = canonicalizeForHash(msg.url);
        if (!canonical) { sendResponse(null); return; }
        const urlHash = await hashUrl(canonical);
        const data = await chrome.storage.local.get(VISIT_COUNT_KEY);
        const counts = data[VISIT_COUNT_KEY] || {};
        sendResponse(counts[urlHash] || null);
      } catch { sendResponse(null); }
    })();
    return true;
  }

  if (msg.action === 'get_all_visit_counts') {
    chrome.storage.local.get(VISIT_URL_KEY).then(data => {
      sendResponse(data[VISIT_URL_KEY] || {});
    }).catch(() => sendResponse({}));
    return true;
  }

  if (msg.action === 'get_all_tabs') {
    (async () => {
      try {
        const allTabs = await chrome.tabs.query({ incognito: false });

        // Get tab groups
        let groups = {};
        try {
          const tabGroups = await chrome.tabGroups.query({});
          for (const g of tabGroups) {
            groups[g.id] = { title: g.title || '', color: g.color || 'grey', id: g.id };
          }
        } catch {
          // tabGroups API not available — continue without groups
        }

        // Filter: keep only http/https tabs that aren't blocked
        await getPrivacySettings();
        const saveable = allTabs.filter(t => {
          if (!t.url) return false;
          if (!t.url.startsWith('http://') && !t.url.startsWith('https://')) return false;
          const domain = extractDomain(t.url);
          if (isDomainBlocked(domain)) return false;
          if (t.url.startsWith('https://ctrl.rodeo/')) return false;
          return true;
        });

        const TAB_GROUP_ID_NONE = -1;
        const result = saveable.map(t => ({
          id: t.id,
          url: t.url,
          title: t.title || t.url,
          domain: extractDomain(t.url),
          favIconUrl: t.favIconUrl || null,
          groupId: (t.groupId !== undefined && t.groupId !== TAB_GROUP_ID_NONE) ? t.groupId : null,
          groupInfo: (t.groupId !== undefined && t.groupId !== TAB_GROUP_ID_NONE && groups[t.groupId]) ? groups[t.groupId] : null,
          windowId: t.windowId
        }));

        sendResponse({ tabs: result, groups });
      } catch (e) {
        sendResponse({ error: e.message, tabs: [], groups: {} });
      }
    })();
    return true;
  }

  if (msg.action === 'bulk_save') {
    (async () => {
      const { tabData } = msg;
      let saved = 0, duplicates = 0, failed = 0;
      const closeable = [];

      for (const t of tabData) {
        try {
          const result = await savePin({
            url: t.url,
            title: t.title,
            selectedText: null,
            source: 'triage'
          });
          if (result.success) {
            saved++;
            closeable.push(t.id);
          } else if (result.error === 'duplicate') {
            duplicates++;
            closeable.push(t.id);
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      if (closeable.length > 0) {
        try {
          await chrome.tabs.remove(closeable);
        } catch (e) {
          console.warn('[rodeo] triage: failed to close some tabs:', e.message);
        }
      }

      sendResponse({ saved, duplicates, failed });
    })();
    return true;
  }
});

// ============================================
// Save Pin Flow
// ============================================
async function savePin({ url, title, selectedText, source }) {
  // Validate URL
  const canonical = normalizeUrl(url);
  if (!canonical) return { error: 'invalid_url' };

  // Get auth
  const session = await getSession();
  if (!session || !session.access_token || !session.user) {
    return { error: 'not_authenticated' };
  }

  const accessToken = session.access_token;
  const userId = session.user.id;

  // Check for duplicate (GET /rest/v1/links?url=eq.<url>&user_id=eq.<id>&select=id)
  try {
    const checkRes = await supabaseGet(
      `/rest/v1/links?url=eq.${encodeURIComponent(canonical)}&user_id=eq.${userId}&select=id`,
      accessToken
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length > 0) {
        return { error: 'duplicate', pinId: existing[0].id };
      }
    }
  } catch (e) {
    console.warn('[rodeo] dedup check failed, proceeding with save:', e.message);
  }

  // Build payload (matches syncLinkToSupabase shape)
  const deviceId = await getOrCreateDeviceId();
  const pinId = crypto.randomUUID();
  const domain = extractDomain(canonical);
  const pinTitle = title || titleFromUrl(canonical);

  const payload = {
    id: pinId,
    user_id: userId,
    url: canonical,
    title: pinTitle,
    description: '',
    domain: domain,
    category: 'uncategorized',
    confidence: 0,
    source: source || 'explicit',
    selected_text: selectedText || null,
    device_id: deviceId,
    created_at: new Date().toISOString()
  };

  // Insert with merge-duplicates (same Prefer header as boards/index.html:12441)
  let res;
  try {
    res = await supabasePost('/rest/v1/links', payload, accessToken, {
      'Prefer': 'resolution=merge-duplicates'
    });
  } catch (e) {
    console.error('[rodeo] save network error:', e.message);
    return { error: 'save_failed', detail: e.message };
  }

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[rodeo] save failed:', res.status, errBody);

    // 401/403 = token expired — clear cached session so next attempt re-auths
    if (res.status === 401 || res.status === 403) {
      await clearCachedSession();
      try { await chrome.storage.local.remove(SESSION_CACHE_KEY); } catch {}
      return { error: 'not_authenticated' };
    }

    // If a column is unrecognized (schema cache), retry without it (up to 5)
    let schemaRetries = 0;
    if (errBody.includes('schema cache')) {
      while (schemaRetries < 5) {
        const colMatch = errBody.match(/Could not find the '(\w+)' column/);
        if (!colMatch) break;
        delete payload[colMatch[1]];
        schemaRetries++;
        try {
          const retry = await supabasePost('/rest/v1/links', payload, accessToken, {
            'Prefer': 'resolution=merge-duplicates'
          });
          if (retry.ok) {
            triggerEnrichment({ url: canonical, title: pinTitle, linkId: pinId });
            return { success: true, pinId };
          }
        } catch (e) {
          console.error('[rodeo] retry network error:', e.message);
          return { error: 'save_failed', detail: e.message };
        }
      }
    }
    return { error: 'save_failed', status: res.status };
  }

  // Fire-and-forget enrichment
  triggerEnrichment({ url: canonical, title: pinTitle, linkId: pinId });

  return { success: true, pinId };
}
