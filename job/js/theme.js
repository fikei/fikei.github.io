// Theme bootstrap — runs synchronously before paint to avoid flash.
const STORAGE_KEY = 'job:theme';
const DEFAULT_LIGHT = 'generic-light';
const DEFAULT_DARK = 'generic-dark';

let stored = localStorage.getItem(STORAGE_KEY);
// Migration: zocdoc theme was removed in v0.33.3. Snap stuck users back to generic.
if (stored && /^zocdoc-/.test(stored)) {
  stored = null;
  localStorage.removeItem(STORAGE_KEY);
}
const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme =
  stored || (prefersDark ? DEFAULT_DARK : DEFAULT_LIGHT);

window.JobTheme = {
  set(value) {
    document.documentElement.dataset.theme = value;
    localStorage.setItem(STORAGE_KEY, value);
    document.dispatchEvent(new CustomEvent('job:theme:changed', { detail: { theme: value } }));
  },
  get() {
    return document.documentElement.dataset.theme;
  }
};
