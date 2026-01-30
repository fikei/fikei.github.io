/**
 * URL Parser Module
 * Extracts URLs from unstructured text input
 */

// Regex to match URLs (handles various formats)
const URL_REGEX = /(?:https?:\/\/)?(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;

/**
 * Extract URLs from unstructured text
 * @param {string} text - Raw text that may contain URLs
 * @returns {string[]} - Array of normalized URLs
 */
export function extractUrls(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const matches = text.match(URL_REGEX) || [];

  // Normalize and deduplicate
  const normalized = matches
    .map(normalizeUrl)
    .filter(Boolean)
    .filter((url, index, self) => self.indexOf(url) === index);

  return normalized;
}

/**
 * Normalize a URL to a consistent format
 * @param {string} url - URL to normalize
 * @returns {string|null} - Normalized URL or null if invalid
 */
export function normalizeUrl(url) {
  if (!url) return null;

  let normalized = url.trim().toLowerCase();

  // Add protocol if missing
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }

  // Remove trailing slash
  normalized = normalized.replace(/\/+$/, '');

  // Validate URL
  try {
    new URL(normalized);
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Extract domain from URL
 * @param {string} url - Full URL
 * @returns {string} - Domain name
 */
export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Generate a unique ID for a link based on URL
 * @param {string} url - URL to hash
 * @returns {string} - Short hash ID
 */
export function generateId(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
