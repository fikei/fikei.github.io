// Rodeo Extension — Auth session management
// Reads Supabase session from ctrl.rodeo localStorage via content script relay

const AUTH_STORAGE_KEY = 'sb-yfhudwakpgzswiylhfbh-auth-token';
const SESSION_CACHE_KEY = 'rodeo_session';
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Get the cached session from chrome.storage.session (fast, in-memory)
async function getCachedSession() {
  try {
    const data = await chrome.storage.session.get([SESSION_CACHE_KEY, 'rodeo_session_at']);
    if (!data[SESSION_CACHE_KEY]) return null;

    // Check TTL
    const cachedAt = data.rodeo_session_at || 0;
    if (Date.now() - cachedAt > SESSION_TTL_MS) return null;

    return data[SESSION_CACHE_KEY];
  } catch {
    return null;
  }
}

// Cache a session in chrome.storage.session
async function cacheSession(session) {
  try {
    await chrome.storage.session.set({
      [SESSION_CACHE_KEY]: session,
      rodeo_session_at: Date.now()
    });
  } catch (e) {
    console.warn('[rodeo] failed to cache session:', e.message);
  }
}

// Clear the cached session
async function clearCachedSession() {
  try {
    await chrome.storage.session.remove([SESSION_CACHE_KEY, 'rodeo_session_at']);
  } catch {}
}

// Try to read auth from a ctrl.rodeo tab via scripting API
async function readSessionFromTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://ctrl.rodeo/*' });
    if (tabs.length === 0) return null;

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: (key) => {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      },
      args: [AUTH_STORAGE_KEY]
    });

    return result?.result || null;
  } catch (e) {
    console.warn('[rodeo] failed to read session from tab:', e.message);
    return null;
  }
}

// Get a valid session — checks cache first, then tries tab injection
async function getSession() {
  // 1. Check cache
  const cached = await getCachedSession();
  if (cached) return cached;

  // 2. Check chrome.storage.local (set by content script relay)
  try {
    const local = await chrome.storage.local.get(SESSION_CACHE_KEY);
    if (local[SESSION_CACHE_KEY]) {
      const session = local[SESSION_CACHE_KEY];
      // Validate token is not expired (JWT exp claim)
      if (isTokenValid(session.access_token)) {
        await cacheSession(session);
        return session;
      }
    }
  } catch {}

  // 3. Try reading from an open ctrl.rodeo tab
  const tabSession = await readSessionFromTab();
  if (tabSession) {
    await cacheSession(tabSession);
    // Also persist to local storage for future use
    try {
      await chrome.storage.local.set({ [SESSION_CACHE_KEY]: tabSession });
    } catch {}
    return tabSession;
  }

  return null;
}

// Basic JWT expiry check (decode payload, check exp)
function isTokenValid(token) {
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // Allow 30s buffer
    return payload.exp && (payload.exp * 1000) > (Date.now() - 30000);
  } catch {
    return false;
  }
}

// Handle auth token relayed from content script on ctrl.rodeo
async function handleAuthRelay(session) {
  if (!session) return;
  await cacheSession(session);
  await chrome.storage.local.set({ [SESSION_CACHE_KEY]: session });
}
