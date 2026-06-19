// Shared role-slug helper. Mirror the server-side logic in gen-asset.
// Format: {company}-{first-3-words-of-title}, lowercased + hyphenated.
export function roleSlug(company, title) {
  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const c = norm(company);
  const titleWords = norm(title).split('-').filter(Boolean).slice(0, 3).join('-');
  return [c, titleWords].filter(Boolean).join('-');
}
