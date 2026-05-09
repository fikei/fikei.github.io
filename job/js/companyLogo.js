// companyLogo — derive a favicon URL for a job posting. Prefers the
// company's own domain; falls back through common ATS host patterns
// (greenhouse, lever, ashby, etc.) so the logo is the company's, not
// the ATS provider's. Returns null when we can't derive a useful host.

// ATS / aggregator hosts whose favicon would be the platform, not the
// employer. When we land on one of these, derive the company slug from
// the URL path and use `<slug>.com` as a guess for the favicon source.
const ATS_HOSTS = [
  /(^|\.)greenhouse\.io$/i,
  /(^|\.)lever\.co$/i,
  /(^|\.)ashbyhq\.com$/i,
  /(^|\.)workable\.com$/i,
  /(^|\.)smartrecruiters\.com$/i,
  /(^|\.)recruitee\.com$/i,
  /(^|\.)bamboohr\.com$/i,
  /(^|\.)jobvite\.com$/i,
  /(^|\.)workday(jobs)?\.com$/i,
  /(^|\.)icims\.com$/i,
  /(^|\.)taleo\.net$/i,
  /(^|\.)breezy\.hr$/i,
  /(^|\.)rippling\.com$/i,
  /(^|\.)pinpointhq\.com$/i,
  /(^|\.)teamtailor\.com$/i,
  /(^|\.)wellfound\.com$/i,
  /(^|\.)angel\.co$/i,
  /(^|\.)builtin\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)indeed\.com$/i,
  /(^|\.)glassdoor\.com$/i,
];

function isAts(host) {
  return ATS_HOSTS.some(re => re.test(host));
}

function slugifyCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

// Pull a likely company slug out of an ATS URL path.
//   boards.greenhouse.io/<slug>/jobs/...     → slug
//   jobs.lever.co/<slug>/...                 → slug
//   jobs.ashbyhq.com/<slug>/...              → slug
//   <slug>.workable.com / .recruitee.com     → already a subdomain
function atsSlugFromUrl(u) {
  const host = u.hostname;
  const seg = u.pathname.split('/').filter(Boolean);
  if (/greenhouse\.io$/i.test(host) || /lever\.co$/i.test(host) || /ashbyhq\.com$/i.test(host) ||
      /smartrecruiters\.com$/i.test(host) || /jobvite\.com$/i.test(host) ||
      /pinpointhq\.com$/i.test(host) || /teamtailor\.com$/i.test(host)) {
    return seg[0] || '';
  }
  // <slug>.workable.com etc.
  const parts = host.split('.');
  if (parts.length >= 3) return parts[0];
  return '';
}

// Returns a favicon URL or null. Prefers the role's URL host; if it's an
// ATS, derives a guess from the path/subdomain or the company name.
export function companyLogoUrl({ url, company } = {}) {
  let domain = '';
  if (url) {
    try {
      const u = new URL(url);
      if (isAts(u.hostname)) {
        const slug = atsSlugFromUrl(u) || slugifyCompany(company);
        if (slug) domain = `${slug}.com`;
      } else {
        domain = u.hostname.replace(/^www\./i, '');
      }
    } catch { /* fall through */ }
  }
  if (!domain && company) {
    const slug = slugifyCompany(company);
    if (slug) domain = `${slug}.com`;
  }
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}
