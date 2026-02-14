// Boards — Save Links
// Service worker: handles toolbar button click

const BOARDS_URL = 'https://ctrl.rodeo/boards/';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    return;
  }

  const addUrl = `${BOARDS_URL}?add=${encodeURIComponent(tab.url)}`;

  // Check if Boards is already open in this window
  const tabs = await chrome.tabs.query({ url: `${BOARDS_URL}*`, currentWindow: true });

  if (tabs.length > 0) {
    // Reuse the existing Boards tab
    chrome.tabs.update(tabs[0].id, { url: addUrl, active: true });
  } else {
    chrome.tabs.create({ url: addUrl });
  }
});
