// Rodeo — Save & Discover
// Service worker: context menus, message routing, pin save flow

importScripts('lib/sanitize.js', 'lib/supabase.js', 'lib/auth.js');

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
          domain: extractDomain(tab.url)
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
