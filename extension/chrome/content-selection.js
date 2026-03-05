// Rodeo — Content script for all pages
// Tracks text selection for contextual pin capture

document.addEventListener('mouseup', () => {
  const selection = window.getSelection();
  if (!selection) return;

  const text = selection.toString().trim();
  if (text.length >= 10 && text.length <= 2000) {
    chrome.runtime.sendMessage({
      action: 'selection_update',
      text: text,
      url: window.location.href
    });
  }
});
