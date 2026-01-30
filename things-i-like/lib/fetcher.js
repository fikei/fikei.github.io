/**
 * Metadata Fetcher Module
 * Fetches title, description, and images from URLs
 */

import { extractDomain } from './parser.js';

// CORS proxy for fetching external pages (use a public one or your own)
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

/**
 * Fetch metadata from a URL
 * @param {string} url - URL to fetch metadata from
 * @returns {Promise<Object>} - Metadata object
 */
export async function fetchMetadata(url) {
  const domain = extractDomain(url);

  // Default metadata
  const metadata = {
    title: domain,
    description: '',
    image: null,
    domain: domain,
    fetchedAt: new Date().toISOString()
  };

  try {
    // Try to fetch the page
    const response = await fetch(CORS_PROXY + encodeURIComponent(url), {
      headers: {
        'Accept': 'text/html'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const parsed = parseHtml(html, url);

    return {
      ...metadata,
      ...parsed
    };
  } catch (error) {
    console.warn(`Failed to fetch metadata for ${url}:`, error.message);

    // Return basic metadata with placeholder
    return {
      ...metadata,
      title: generateTitleFromUrl(url),
      image: generatePlaceholderImage(domain)
    };
  }
}

/**
 * Parse HTML to extract metadata
 * @param {string} html - Raw HTML string
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {Object} - Extracted metadata
 */
function parseHtml(html, baseUrl) {
  const result = {};

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i);

  if (ogTitleMatch) {
    result.title = decodeHtmlEntities(ogTitleMatch[1]);
  } else if (titleMatch) {
    result.title = decodeHtmlEntities(titleMatch[1]);
  }

  // Extract description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);

  if (ogDescMatch) {
    result.description = decodeHtmlEntities(ogDescMatch[1]);
  } else if (descMatch) {
    result.description = decodeHtmlEntities(descMatch[1]);
  }

  // Extract image
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["']/i);

  if (ogImageMatch) {
    result.image = resolveUrl(ogImageMatch[1], baseUrl);
  }

  return result;
}

/**
 * Resolve relative URL to absolute
 * @param {string} url - Potentially relative URL
 * @param {string} base - Base URL
 * @returns {string} - Absolute URL
 */
function resolveUrl(url, base) {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  try {
    return new URL(url, base).href;
  } catch {
    return null;
  }
}

/**
 * Decode HTML entities
 * @param {string} text - Text with HTML entities
 * @returns {string} - Decoded text
 */
function decodeHtmlEntities(text) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value.trim();
}

/**
 * Generate a title from URL when none is found
 * @param {string} url - URL to parse
 * @returns {string} - Generated title
 */
function generateTitleFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname
      .replace(/^\/|\/$/g, '')
      .replace(/[-_]/g, ' ')
      .replace(/\.[^.]+$/, '');

    if (path) {
      return path.split('/').pop().replace(/\b\w/g, c => c.toUpperCase());
    }
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Generate a placeholder image URL
 * @param {string} text - Text for the placeholder
 * @returns {string} - Placeholder image URL
 */
function generatePlaceholderImage(text) {
  // Return null to trigger the CSS placeholder state
  return null;
}

/**
 * Check if an image meets aesthetic guidelines
 * (Placeholder for future implementation)
 * @param {string} imageUrl - Image URL to check
 * @returns {Promise<boolean>} - Whether image meets guidelines
 */
export async function checkImageAesthetic(imageUrl) {
  // For v1, accept all images
  // Future: analyze image for contrast, clutter, etc.
  return true;
}
