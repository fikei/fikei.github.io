// Rodeo — Content script for ctrl.rodeo pages
// 1. Marks extension as installed (backward compat with boards/index.html detection)
// 2. Relays auth session to background service worker

document.documentElement.setAttribute('data-boards-extension', 'installed');

// Relay Supabase auth session to the background service worker
// so the extension can make authenticated API calls
const AUTH_KEY = 'sb-yfhudwakpgzswiylhfbh-auth-token';

function relayAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) {
      const session = JSON.parse(raw);
      chrome.runtime.sendMessage({ action: 'auth_token', session });
    }
  } catch {}
}

// Relay immediately and on storage changes
relayAuth();

window.addEventListener('storage', (e) => {
  if (e.key === AUTH_KEY) {
    relayAuth();
  }
});

// Re-relay periodically in case session was refreshed
// (Supabase auto-refresh updates localStorage without firing storage events
//  when the update happens in the same tab)
setInterval(relayAuth, 60000);
