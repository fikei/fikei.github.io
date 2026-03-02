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
  error: document.getElementById('state-error')
};

// Current page data (set during init)
let currentTab = null;
let currentSelection = null;

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
    showState('saved');
    return;
  }

  if (result.error === 'duplicate') {
    showState('duplicate');
    return;
  }

  if (result.error === 'not_authenticated') {
    showState('auth');
    return;
  }

  showError(result.error === 'save_failed'
    ? `Save failed (${result.status})`
    : result.error || 'Unknown error');
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
  chrome.tabs.create({ url: BOARDS_URL });
  window.close();
});

document.getElementById('btn-view-dup').addEventListener('click', () => {
  chrome.tabs.create({ url: BOARDS_URL });
  window.close();
});

document.getElementById('btn-retry').addEventListener('click', () => {
  handleSave();
});

// ============================================
// Messaging Helper
// ============================================
function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => {
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
// Start
// ============================================
init();
