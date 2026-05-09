// logo.js — derive a company logo URL from a role's posting URL or
// company name. Best-effort. Pure client-side; no DB column needed.
//
//   logoSrc(role) → a Clearbit logo URL, or null if we can't guess.
//   logoInitial(company) → first letter for the placeholder fallback.

const ATS_HOSTS = /(ashbyhq|greenhouse(?:\.io)?|lever\.co|workday(?:jobs)?|smartrecruiters|linkedin|indeed)\.(com|co|io)$/i;
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
};

function looksLikeAts(host) { return ATS_HOSTS.test(host); }

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
    const key = role.company.trim().toLowerCase();
    if (COMPANY_DOMAIN_OVERRIDES[key]) {
      domain = COMPANY_DOMAIN_OVERRIDES[key];
    } else {
      const slug = role.company.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (slug.length >= 2) domain = `${slug}.com`;
    }
  }
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

export function logoInitial(company) {
  return (company || '?').trim().charAt(0).toUpperCase() || '?';
}
