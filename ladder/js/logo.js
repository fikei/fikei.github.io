// logo.js — derive a company logo URL from a role's posting URL or
// company name. Best-effort. Pure client-side; no DB column needed.
//
//   logoSrc(role) → a favicon URL (Google s2), or null if we can't guess.
//   logoInitial(company) → first letter for the placeholder fallback.
//
// Uses Google's s2 favicon service. Clearbit's free Logo API was retired
// in 2024, so an `<img src="logo.clearbit.com/…">` request never resolves
// — that's why every row showed nothing.

// Hosts whose favicon would be the platform/aggregator, not the
// employer. When the posting URL points at one of these, we ignore the
// host and derive the favicon from the company name instead.
const AGGREGATOR_HOSTS = /(ashbyhq|greenhouse(?:\.io)?|lever|workday(?:jobs)?|smartrecruiters|linkedin|indeed|weworkremotely|remotive|remoteok|hnrss|ycombinator|workatastartup|wellfound|angel|builtin|otta|welcometothejungle)\.(com|co|io|hr|fr|net|org)$/i;

const COMPANY_DOMAIN_OVERRIDES = {
  // Hand-curated where domain-from-name doesn't work. Add as needed.
  'abridge': 'abridge.com',
  'ambience': 'ambiencehealthcare.com',
  'ambience healthcare': 'ambiencehealthcare.com',
  'general medicine': 'generalmedicine.com',
  'maven clinic': 'mavenclinic.com',
  'verily health': 'verily.com',
  'sully.ai': 'sully.ai',
  'evenup': 'evenuplaw.com',
  'plaud': 'plaud.ai',
  'crossing hurdles': 'crossinghurdles.com',
  'rec technologies': 'rec.io',
  'develop health': 'develophealth.io',
  'spring health': 'springhealth.com',
  // Tech companies the RSS source surfaces with awkward formatting.
  'doordash': 'doordash.com',
  'doordash usa': 'doordash.com',
  'webpt': 'webpt.com',
  'ethos life': 'ethos.com',
  'ethos': 'ethos.com',
  'okta': 'okta.com',
  'gypsy collective': 'gypsycollective.com',
  'silverorange': 'silverorange.com',
  'walrus': 'walrus.com',
  'payra': 'payra.io',
};

function looksLikeAts(host) { return AGGREGATOR_HOSTS.test(host); }

// Strip "Inc / LLC / Co / USA" suffixes that confuse the slug → domain
// guess. Mirror of the cleanCompany() in the rss source plugin.
function cleanCompany(s) {
  return String(s || '')
    .trim()
    .replace(/[,\s]+(?:usa|us|north america|inc\.?|llc\.?|ltd\.?|co\.?|corp\.?|gmbh|s\.a\.?)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function logoSrc(role) {
  if (!role) return null;
  if (role.logoUrl) return role.logoUrl;

  // Try the explicit posting URL first.
  let domain = null;
  try {
    if (role.url) {
      const host = new URL(role.url).hostname.replace(/^www\./, '');
      if (!looksLikeAts(host)) domain = host;
    }
  } catch { /* ignore */ }

  // Fall back to a guess from the company name.
  if (!domain && role.company) {
    const cleaned = cleanCompany(role.company);
    const key = cleaned.toLowerCase();
    if (COMPANY_DOMAIN_OVERRIDES[key]) {
      domain = COMPANY_DOMAIN_OVERRIDES[key];
    } else {
      const slug = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (slug.length >= 2) domain = `${slug}.com`;
    }
  }
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function logoInitial(company) {
  return (company || '?').trim().charAt(0).toUpperCase() || '?';
}
