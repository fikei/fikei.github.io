// Rodeo Extension — Popup controller
// Manages UI state: loading → auth → save → saving → saved

const BOARDS_URL = 'https://ctrl.rodeo/boards/';

// UI elements
const states = {
  loading: document.getElementById('state-loading'),
  auth: document.getElementById('state-auth'),
  unsupported: document.getElementById('state-unsupported'),
  save: document.getElementById('state-save'),
  saving: document.getElementById('state-saving'),
  saved: document.getElementById('state-saved'),
  duplicate: document.getElementById('state-duplicate'),
  error: document.getElementById('state-error'),
  settings: document.getElementById('state-settings')
};

// Current page data (set during init)
let currentTab = null;
let currentSelection = null;
let lastPinId = null;

// ============================================
// State Management
// ============================================
function showState(name) {
  Object.entries(states).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

// ============================================
// Init — runs when popup opens
// ============================================
async function init() {
  showState('loading');

  // Get current tab info + auth session in parallel
  const [tabInfo, session] = await Promise.all([
    sendMessage({ action: 'get_tab_info' }),
    sendMessage({ action: 'get_session' })
  ]);

  // Check tab
  if (!tabInfo || tabInfo.error) {
    showState('unsupported');
    return;
  }

  currentTab = tabInfo;

  // Check auth
  if (!session || !session.access_token || !session.user) {
    showState('auth');
    return;
  }

  // Check for text selection on this page
  const selResult = await sendMessage({
    action: 'get_selection',
    url: tabInfo.url
  });

  if (selResult && selResult.text) {
    currentSelection = selResult.text;
  }

  // Show tab bar (user is authenticated)
  document.getElementById('tab-bar').hidden = false;

  // Populate save state
  document.getElementById('save-domain').textContent = tabInfo.domain;
  document.getElementById('save-title').textContent = tabInfo.title || tabInfo.url;

  if (currentSelection) {
    document.getElementById('selection-text').textContent = currentSelection;
    document.getElementById('selection-preview').hidden = false;
  }

  showState('save');
}

// ============================================
// Save Flow
// ============================================
async function handleSave() {
  showState('saving');

  const result = await sendMessage({
    action: 'save',
    data: {
      url: currentTab.url,
      title: currentTab.title,
      selectedText: currentSelection,
      source: currentSelection ? 'text_selection' : 'explicit'
    }
  });

  if (!result) {
    showError('No response from extension');
    return;
  }

  if (result.success) {
    lastPinId = result.pinId;
    showState('saved');
    return;
  }

  if (result.error === 'duplicate') {
    lastPinId = result.pinId;
    showState('duplicate');
    return;
  }

  if (result.error === 'not_authenticated') {
    showState('auth');
    return;
  }

  if (result.error === 'save_failed') {
    showError(result.detail || `Save failed (${result.status})`);
  } else {
    showError(result.error || 'Unknown error');
  }
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  showState('error');
}

// ============================================
// Event Listeners
// ============================================
document.getElementById('btn-signin').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'open_boards' });
  window.close();
});

document.getElementById('btn-save').addEventListener('click', handleSave);

document.getElementById('btn-view').addEventListener('click', () => {
  const url = lastPinId ? `${BOARDS_URL}?pin=${lastPinId}` : BOARDS_URL;
  chrome.tabs.create({ url });
  window.close();
});

document.getElementById('btn-view-dup').addEventListener('click', () => {
  const url = lastPinId ? `${BOARDS_URL}?pin=${lastPinId}` : BOARDS_URL;
  chrome.tabs.create({ url });
  window.close();
});

document.getElementById('btn-retry').addEventListener('click', () => {
  handleSave();
});

// ============================================
// Messaging Helper
// ============================================
function sendMessage(msg, timeoutMs = 15000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      console.warn('[rodeo popup] message timed out:', msg.action);
      resolve(null);
    }, timeoutMs);

    chrome.runtime.sendMessage(msg, response => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        console.warn('[rodeo popup]', chrome.runtime.lastError.message);
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// ============================================
// Tab Bar
// ============================================
let activeTab = 'save';

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    if (tab === activeTab) return;
    activeTab = tab;

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (tab === 'settings') {
      loadSettings();
      showState('settings');
    } else {
      showState('save');
    }
  });
});

// ============================================
// Settings Tab
// ============================================
async function loadSettings() {
  const settings = await sendMessage({ action: 'get_privacy_settings' });
  if (!settings) return;

  document.getElementById('toggle-history').checked = settings.historyEnabled !== false;
  document.getElementById('blocklist-input').value =
    (settings.userBlocklist || []).join('\n');
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const historyEnabled = document.getElementById('toggle-history').checked;
  const raw = document.getElementById('blocklist-input').value;
  const userBlocklist = raw.split('\n')
    .map(d => d.trim().toLowerCase())
    .filter(d => d.length > 0);

  const result = await sendMessage({
    action: 'save_privacy_settings',
    settings: { historyEnabled, userBlocklist }
  });

  const status = document.getElementById('settings-status');
  if (result && result.ok) {
    status.textContent = 'Settings saved';
    status.className = 'settings-status settings-status--ok';
  } else {
    status.textContent = 'Failed to save';
    status.className = 'settings-status settings-status--err';
  }
  status.hidden = false;
  setTimeout(() => { status.hidden = true; }, 3000);
});

document.getElementById('btn-backfill').addEventListener('click', async () => {
  const status = document.getElementById('backfill-status');
  status.textContent = 'Importing...';
  status.className = 'settings-status';
  status.hidden = false;

  const result = await sendMessage({ action: 'start_backfill' }, 60000);
  if (result && result.queued !== undefined) {
    status.textContent = `Imported ${result.queued} of ${result.total} pages`;
    status.className = 'settings-status settings-status--ok';
  } else {
    status.textContent = result?.error || 'Import failed';
    status.className = 'settings-status settings-status--err';
  }
  setTimeout(() => { status.hidden = true; }, 5000);
});

document.getElementById('btn-delete-hour').addEventListener('click', async () => {
  if (!confirm('Delete browsing history from the last hour?')) return;
  await sendMessage({ action: 'delete_history', window: 60 * 60 * 1000 });
});

document.getElementById('btn-delete-day').addEventListener('click', async () => {
  if (!confirm('Delete browsing history from the last 24 hours?')) return;
  await sendMessage({ action: 'delete_history', window: 24 * 60 * 60 * 1000 });
});

document.getElementById('btn-delete-all').addEventListener('click', async () => {
  if (!confirm('Delete ALL browsing history? This cannot be undone.')) return;
  await sendMessage({ action: 'delete_history', window: 'all' });
});

// ============================================
// Start
// ============================================
init();
