// Rodeo Extension — URL canonicalization and domain extraction
// Matches normalizeUrl() and extractDomain() from boards/index.html:10980-10996

function normalizeUrl(url) {
  if (!url) return null;
  let n = url.trim();
  if (!/^https?:\/\//i.test(n)) {
    n = 'https://' + n;
  }
  n = n.replace(/\/+$/, '');
  try {
    const u = new URL(n);
    return u.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Generate a title from URL when page title is unavailable
function titleFromUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/|\/$/g, '');
    if (path) {
      // /some/page-name → "Some Page Name"
      return path.split('/').pop()
        .replace(/[-_]/g, ' ')
        .replace(/\.\w+$/, '')
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim() || u.hostname;
    }
    return u.hostname;
  } catch {
    return url;
  }
}
