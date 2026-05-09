// parseSectorTags — split a free-text sector string from the Job Search
// sheet into atomic tags. Used by jobs-pipe sync and build-sector-tags.

import { slugify } from './job-auth.ts';

// Tokens that should split off into their own tag even when adjacent to a
// longer phrase. "Healthcare AI" → ["Healthcare", "AI"]; "Health AI" → same.
const SUFFIX_TOKENS = ['AI', 'ML', 'Infra'];

// Canonical names for known synonyms. After parsing, we normalize the
// display value through this map so e.g. "Health" / "Healthcare" merge.
const CANONICAL: Record<string, string> = {
  'Health': 'Healthcare',
  'Healthcare AI': 'Healthcare',
  'Health AI': 'Healthcare',
  'Healthcare Infra': 'Healthcare',
  'Telehealth': 'Healthcare',
  "Women's Health": 'Healthcare',
  'Mental Health': 'Mental Health',
  'EdTech': 'EdTech',
  'Education': 'EdTech',
  'Legal AI': 'Legal',
  'Sales AI': 'Sales',
  'AI / Public Interest': 'AI',
  'Public Sector': 'Public Sector',
  'Civic Tech': 'Civic Tech',
  'Civic Tech / Public Sector': 'Civic Tech',
  'SaaS - Productivity': 'Productivity',
  'AI / Consumer Hardware': 'Consumer',
  'Consumer Hardware': 'Consumer',
};

function splitToken(token: string): string[] {
  let t = token.trim();
  if (!t) return [];
  // Pull off "X AI" / "X ML" suffixes into separate atoms.
  for (const suf of SUFFIX_TOKENS) {
    const re = new RegExp(`\\s+${suf}\\s*$`, 'i');
    if (re.test(t) && t.toLowerCase() !== suf.toLowerCase()) {
      const base = t.replace(re, '').trim();
      const parts = base ? splitToken(base) : [];
      parts.push(suf);
      return parts;
    }
  }
  return [t];
}

export interface SectorTag { slug: string; name: string; }

export function parseSectorTags(input: string | null | undefined): SectorTag[] {
  if (!input) return [];
  // Split on common separators. Don't split on whitespace.
  const raw = String(input)
    .split(/\s*(?:[\/,;]|\s-\s|\s—\s)\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(splitToken);

  const seen = new Set<string>();
  const out: SectorTag[] = [];
  for (const r of raw) {
    const cleaned = r.replace(/\s+/g, ' ').trim();
    const canonical = CANONICAL[cleaned] || cleaned;
    const slug = slugify(canonical);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, name: canonical });
  }
  return out;
}
