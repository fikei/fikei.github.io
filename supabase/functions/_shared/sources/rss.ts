// rss — generic RSS / Atom plugin. Works with any feed that follows
// the common job-board conventions (Indeed, BuiltIn, Wellfound,
// Greenhouse company feeds, GitHub releases, etc.).
//
// LinkedIn's public RSS endpoint (linkedin.com/jobs/search.rss) was
// retired — we keep the URL pattern in case it ever returns, but the
// default `feeds` list ships Indeed instead because Indeed still serves
// public RSS for keyword + location searches.
//
// Config:
//   { feeds: [ { url, label?, source?, sourceLabel? } ] }
//
// `source` defaults to 'rss'; override per feed if you want the bullet
// card to show "Indeed Recommended" or similar. Items dedupe across
// feeds via the URL's path tail.

import type { Source, RecommendedRoleInput } from './types.ts';

interface FeedConfig {
  url:          string;
  label?:       string;
  source?:      string;     // override → recommended_roles.source
  sourceLabel?: string;     // override → user-facing badge
}
interface RssConfig {
  feeds?: FeedConfig[];
  feedUrl?: string;         // single-feed convenience
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function tag(itemXml: string, name: string): string {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = itemXml.match(re);
  return decodeXml((m?.[1] ?? '').trim());
}

function attr(itemXml: string, name: string, attrName: string): string {
  const re = new RegExp(`<${name}[^>]*\\b${attrName}=["']([^"']+)["'][^>]*\\/?>`, 'i');
  const m = itemXml.match(re);
  return m?.[1] ?? '';
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Parse common job-feed title formats and return { title, company, location }.
//   "Acme: Senior Product Manager"           → WWR / Remotive
//   "Senior Product Manager at Acme"          → LinkedIn / Wellfound
//   "Acme hiring Senior Product Manager in SF" → LinkedIn alt
//   "Senior Product Manager — Acme"           → some Indeed feeds
//   bare title                                → keep as-is
function splitTitle(raw: string): { title: string; company: string; location: string } {
  let s = (raw || '').trim();
  // "Company: Title"  (WWR canonical form)
  let m = s.match(/^([^:]{1,80}):\s*(.+)$/);
  if (m) return { title: m[2].trim(), company: cleanCompany(m[1]), location: '' };
  // "Title at Company [in Location]"
  m = s.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+(.+))?$/i);
  if (m) return { title: m[1].trim(), company: cleanCompany(m[2]), location: (m[3] || '').trim() };
  // "Company hiring Title [in Location]"
  m = s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+(.+))?$/i);
  if (m) return { title: m[2].trim(), company: cleanCompany(m[1]), location: (m[3] || '').trim() };
  // "Title — Company"  (em-dash, en-dash, hyphen, or pipe)
  m = s.match(/^(.+?)\s+[—\-–|]\s+(.+?)$/);
  if (m) return { title: m[1].trim(), company: cleanCompany(m[2]), location: '' };
  return { title: s, company: '', location: '' };
}

// Strip common suffixes WWR-style feeds add to company names — they
// only confuse the favicon lookup. "Doordash Usa" → "Doordash";
// "Acme Inc." → "Acme"; "Foo, LLC" → "Foo".
function cleanCompany(s: string): string {
  return s
    .trim()
    .replace(/[,\s]+(?:usa|us|north america|inc\.?|llc\.?|ltd\.?|co\.?|corp\.?|gmbh|s\.a\.?)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Stable per-item ID. Prefer <guid>, then the URL path tail, then a
// hash of title+url so different feeds for the same posting collapse.
function itemId(itemXml: string, link: string, title: string): string {
  const guid = tag(itemXml, 'guid');
  if (guid) return guid.replace(/[^a-z0-9:_-]/gi, '').slice(0, 80);
  const tail = link.split(/[?#]/)[0].split('/').filter(Boolean).slice(-2).join(':');
  if (tail) return tail.slice(0, 80);
  return (title + link).replace(/[^a-z0-9]/gi, '').slice(0, 80);
}

async function fetchOneFeed(feed: FeedConfig): Promise<RecommendedRoleInput[]> {
  const res = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`rss ${res.status} for ${feed.url.slice(0, 60)}`);
  const xml = await res.text();
  // Treat both <item> (RSS) and <entry> (Atom) as items.
  const isAtom = /<feed[^>]*xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(xml);
  const splitter = isAtom ? /<entry[\s>]/i : /<item[\s>]/i;
  const closer   = isAtom ? /<\/entry>/i   : /<\/item>/i;
  const wrapTag  = isAtom ? 'entry'        : 'item';
  const items = xml.split(splitter).slice(1).map(chunk => `<${wrapTag} ` + chunk.split(closer)[0] + `</${wrapTag}>`);
  if (!items.length) throw new Error(`no items in feed; first chars: ${xml.replace(/\s+/g, ' ').slice(0, 160)}`);

  const sourceKey   = feed.source      || 'rss';
  const sourceBadge = feed.sourceLabel || (feed.label ? `RSS · ${feed.label}` : 'RSS');

  return items.map(itemXml => {
    const titleRaw = tag(itemXml, 'title');
    // Atom uses <link href="..."/>, RSS uses <link>...</link>
    const link    = isAtom ? attr(itemXml, 'link', 'href') : tag(itemXml, 'link');
    const pubDate = tag(itemXml, 'pubDate') || tag(itemXml, 'published') || tag(itemXml, 'updated');
    const desc    = tag(itemXml, 'description') || tag(itemXml, 'summary') || tag(itemXml, 'content');
    const { title, company, location } = splitTitle(titleRaw);
    return {
      source:      sourceKey,
      sourceId:    `${sourceKey}:${itemId(itemXml, link, titleRaw)}`,
      sourceLabel: sourceBadge,
      url:         link,
      company,
      title,
      location,
      postedAt:    pubDate ? new Date(pubDate).toISOString() : undefined,
      description: desc ? stripHtml(desc).slice(0, 280) : undefined,
      payload:     { feedUrl: feed.url, feedLabel: feed.label || null },
    };
  }).filter(r => r.url && r.title);
}

export const rssSource: Source<RssConfig> = {
  type: 'rss',
  async pull(cfg) {
    const feeds: FeedConfig[] = cfg.feeds && cfg.feeds.length
      ? cfg.feeds
      : (cfg.feedUrl ? [{ url: cfg.feedUrl }] : []);
    if (!feeds.length) throw new Error('rss: config.feeds (or feedUrl) is required');
    const out: RecommendedRoleInput[] = [];
    const diag: string[] = [];
    for (const f of feeds) {
      try {
        const rows = await fetchOneFeed(f);
        out.push(...rows);
        diag.push(`${f.label || f.url.slice(0, 30)}=${rows.length}`);
      } catch (e) {
        diag.push(`${f.label || f.url.slice(0, 30)}=ERR ${(e as Error).message.slice(0, 80)}`);
      }
    }
    // Stash per-feed diag on the first item's payload so the worker
    // can include it in the run summary without us editing the worker.
    console.log(`[rss] ${diag.join(' | ')}`);
    if (!out.length) throw new Error(diag.join(' | ').slice(0, 500));
    if (out[0]?.payload) (out[0].payload as Record<string, unknown>)._diag = diag.join(' | ');
    return out;
  },
};
