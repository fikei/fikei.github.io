// Rodeo Extension — Popup controller
// Manages UI state: loading → auth → save → saving → saved
// Tab bar: Save | Triage | Settings

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
  triage: document.getElementById('state-triage'),
  settings: document.getElementById('state-settings')
};

// Current page data (set during init)
let currentTab = null;
let currentSelection = null;
let lastPinId = null;

// Triage state
let triageTabs = [];
let triageVisitCounts = {};
let triageSelected = new Set();

// ============================================
// State Management
// ============================================
function showState(name) {
  Object.entries(states).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  // Body class for triage max-height
  document.body.classList.toggle('triage-open', name === 'triage');
}

// Escape HTML for safe insertion
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
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
async function handleSave(shouldClose) {
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
    if (shouldClose) {
      setTimeout(() => {
        sendMessage({ action: 'close_tab', tabId: currentTab.tabId });
        window.close();
      }, 1500);
    }
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

document.getElementById('btn-save-close').addEventListener('click', () => handleSave(true));
document.getElementById('btn-save').addEventListener('click', () => handleSave(false));

document.getElementById('btn-close-after-save').addEventListener('click', () => {
  if (currentTab && currentTab.tabId) {
    sendMessage({ action: 'close_tab', tabId: currentTab.tabId });
  }
  window.close();
});

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
  handleSave(false);
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
    } else if (tab === 'triage') {
      loadTriage();
      showState('triage');
    } else {
      showState('save');
    }
  });
});

// ============================================
// Triage Tab
// ============================================
async function loadTriage() {
  const triageList = document.getElementById('triage-list');
  triageList.innerHTML = '<div style="text-align:center;padding:24px 0;"><div class="loading-spinner" style="margin:0 auto;"></div></div>';

  // Fetch tabs and visit counts in parallel
  const [tabResult, visitCounts] = await Promise.all([
    sendMessage({ action: 'get_all_tabs' }),
    sendMessage({ action: 'get_all_visit_counts' })
  ]);

  if (!tabResult || !tabResult.tabs) {
    triageList.innerHTML = '<div style="text-align:center;padding:24px 0;color:#666;">Could not load tabs</div>';
    return;
  }

  triageTabs = tabResult.tabs;
  triageVisitCounts = visitCounts || {};

  // All selected by default
  triageSelected = new Set(triageTabs.map(t => t.id));

  // Update tab count badge
  const badge = document.getElementById('triage-tab-count');
  if (triageTabs.length > 0) {
    badge.textContent = triageTabs.length;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }

  renderTriageList();
  updateTriageButton();
}

function renderTriageList() {
  const list = document.getElementById('triage-list');

  if (triageTabs.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:24px 0;color:#666;">No saveable tabs open</div>';
    return;
  }

  // Group tabs: grouped first, then ungrouped
  const grouped = {};
  const ungrouped = [];

  for (const tab of triageTabs) {
    if (tab.groupId && tab.groupInfo) {
      if (!grouped[tab.groupId]) {
        grouped[tab.groupId] = { info: tab.groupInfo, tabs: [] };
      }
      grouped[tab.groupId].tabs.push(tab);
    } else {
      ungrouped.push(tab);
    }
  }

  let html = '';

  // Render grouped tabs
  for (const [groupId, group] of Object.entries(grouped)) {
    const allChecked = group.tabs.every(t => triageSelected.has(t.id));
    const color = group.info.color || 'grey';
    const name = group.info.title || 'Group';
    html += `<div class="triage-group triage-group--${esc(color)}" data-group-id="${esc(String(groupId))}">
      <div class="triage-group__dot"></div>
      <div class="triage-group__name">${esc(name)}</div>
      <div class="triage-group__count">${group.tabs.length}</div>
      <input type="checkbox" class="triage-group__checkbox" ${allChecked ? 'checked' : ''} data-group-id="${esc(String(groupId))}">
    </div>`;
    for (const tab of group.tabs) {
      html += buildTabRow(tab);
    }
  }

  // Render ungrouped tabs
  for (const tab of ungrouped) {
    html += buildTabRow(tab);
  }

  list.innerHTML = html;

  // Bind row click → toggle checkbox
  list.querySelectorAll('.triage-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      const cb = row.querySelector('.triage-row__checkbox');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });

  // Bind individual checkboxes
  list.querySelectorAll('.triage-row__checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const tabId = parseInt(cb.dataset.tabId, 10);
      if (cb.checked) {
        triageSelected.add(tabId);
      } else {
        triageSelected.delete(tabId);
      }
      updateGroupCheckboxes();
      updateTriageButton();
      updateSelectAllText();
    });
  });

  // Bind group checkboxes
  list.querySelectorAll('.triage-group__checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const groupId = cb.dataset.groupId;
      const group = grouped[groupId];
      if (!group) return;
      for (const tab of group.tabs) {
        if (cb.checked) {
          triageSelected.add(tab.id);
        } else {
          triageSelected.delete(tab.id);
        }
      }
      // Update individual checkboxes in this group
      list.querySelectorAll(`.triage-row__checkbox`).forEach(tcb => {
        const tid = parseInt(tcb.dataset.tabId, 10);
        const inGroup = group.tabs.some(t => t.id === tid);
        if (inGroup) tcb.checked = cb.checked;
      });
      updateTriageButton();
      updateSelectAllText();
    });
  });

  // Bind group row click → toggle group checkbox
  list.querySelectorAll('.triage-group').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      const cb = row.querySelector('.triage-group__checkbox');
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
  });
}

function buildTabRow(tab) {
  const checked = triageSelected.has(tab.id) ? 'checked' : '';
  const favicon = tab.favIconUrl
    ? `<img class="triage-row__favicon" src="${esc(tab.favIconUrl)}" onerror="this.style.display='none'">`
    : '<div class="triage-row__favicon"></div>';

  // Visit count badge
  let badge = '';
  const visitData = triageVisitCounts[tab.url];
  if (visitData && visitData.count > 1) {
    badge = `<span class="triage-row__badge">${visitData.count}x</span>`;
  }

  return `<div class="triage-row" data-tab-id="${tab.id}">
    <input type="checkbox" class="triage-row__checkbox" data-tab-id="${tab.id}" ${checked}>
    ${favicon}
    <div class="triage-row__info">
      <div class="triage-row__title">${esc(tab.title)}</div>
      <div class="triage-row__domain">${esc(tab.domain)}</div>
    </div>
    ${badge}
  </div>`;
}

function updateGroupCheckboxes() {
  document.querySelectorAll('.triage-group__checkbox').forEach(cb => {
    const groupId = cb.dataset.groupId;
    const rows = document.querySelectorAll(`.triage-row__checkbox`);
    // Find tabs in this group
    const groupTabs = triageTabs.filter(t => t.groupId && String(t.groupId) === groupId);
    if (groupTabs.length === 0) return;
    const allChecked = groupTabs.every(t => triageSelected.has(t.id));
    cb.checked = allChecked;
  });
}

function updateTriageButton() {
  const btn = document.getElementById('btn-triage-save');
  const count = triageSelected.size;
  const total = triageTabs.length;

  if (count === 0) {
    btn.disabled = true;
    btn.textContent = 'Save All & Close';
  } else if (count === total) {
    btn.disabled = false;
    btn.textContent = 'Save All & Close';
  } else {
    btn.disabled = false;
    btn.textContent = `Save ${count} & Close`;
  }
}

function updateSelectAllText() {
  const btn = document.getElementById('triage-select-all');
  const allSelected = triageSelected.size === triageTabs.length;
  btn.textContent = allSelected ? 'Deselect all' : 'Select all';
}

// Select all / deselect all
document.getElementById('triage-select-all').addEventListener('click', () => {
  const allSelected = triageSelected.size === triageTabs.length;
  if (allSelected) {
    triageSelected.clear();
  } else {
    triageSelected = new Set(triageTabs.map(t => t.id));
  }
  // Update all checkboxes
  document.querySelectorAll('.triage-row__checkbox').forEach(cb => {
    cb.checked = triageSelected.has(parseInt(cb.dataset.tabId, 10));
  });
  updateGroupCheckboxes();
  updateTriageButton();
  updateSelectAllText();
});

// Bulk save handler
document.getElementById('btn-triage-save').addEventListener('click', async () => {
  const btn = document.getElementById('btn-triage-save');
  const status = document.getElementById('triage-status');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  status.hidden = true;

  const tabData = triageTabs
    .filter(t => triageSelected.has(t.id))
    .map(t => ({ id: t.id, url: t.url, title: t.title }));

  const result = await sendMessage({ action: 'bulk_save', tabData }, 60000);

  if (!result) {
    status.textContent = 'Save failed — no response';
    status.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Try Again';
    return;
  }

  // Show results
  const parts = [];
  if (result.saved > 0) parts.push(`Saved ${result.saved}`);
  if (result.duplicates > 0) parts.push(`${result.duplicates} already saved`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);
  status.textContent = parts.join(' · ') || 'Done';
  status.hidden = false;

  // Reload triage after a moment
  setTimeout(() => loadTriage(), 2000);
});

// ============================================
// Settings Tab
// ============================================
async function loadSettings() {
  const settings = await sendMessage({ action: 'get_privacy_settings' });
  if (!settings) return;

  document.getElementById('toggle-history').checked = settings.historyEnabled !== false;
  document.getElementById('toggle-nudge').checked = settings.nudgeEnabled !== false;
  document.getElementById('blocklist-input').value =
    (settings.userBlocklist || []).join('\n');
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const historyEnabled = document.getElementById('toggle-history').checked;
  const nudgeEnabled = document.getElementById('toggle-nudge').checked;
  const raw = document.getElementById('blocklist-input').value;
  const userBlocklist = raw.split('\n')
    .map(d => d.trim().toLowerCase())
    .filter(d => d.length > 0);

  const result = await sendMessage({
    action: 'save_privacy_settings',
    settings: { historyEnabled, nudgeEnabled, userBlocklist }
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
