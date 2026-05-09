// linkedin-rss — pulls postings from a LinkedIn job-alert RSS feed.
//
// LinkedIn lets you turn any saved-search URL into RSS by swapping the
// path:
//   /jobs/search/?keywords=Product+Manager&location=San+Francisco&f_TPR=r604800
// becomes
//   /jobs/search.rss?keywords=Product+Manager&location=San+Francisco&f_TPR=r604800
//
// Config:
//   { feeds: [ { url, label? } ] }   — multiple feeds per source allowed
//
// One source row can hold many feeds so the user doesn't have to create
// a separate user_sources row for every saved search. Each item we
// return uses the LinkedIn job ID as the dedup key, so the same posting
// surfacing across feeds collapses to a single recommended_roles row.

import type { Source, RecommendedRoleInput } from './types.ts';

interface FeedConfig { url: string; label?: string; }
interface LinkedInRssConfig { feeds?: FeedConfig[]; feedUrl?: string; }   // feedUrl kept for single-feed convenience

// LinkedIn item titles look like "Senior Product Manager at Acme Corp"
// or sometimes "Acme Corp hiring Senior Product Manager in SF". Try the
// canonical first form, then fall back to the second.
function splitTitle(raw: string): { title: string; company: string } {
  let s = (raw || '').trim();
  // "Title at Company"
  let m = s.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s+in\s+.+)?$/i);
  if (m) return { title: m[1].trim(), company: m[2].trim() };
  // "Company hiring Title in Location"
  m = s.match(/^(.+?)\s+hiring\s+(.+?)(?:\s+in\s+.+)?$/i);
  if (m) return { title: m[2].trim(), company: m[1].trim() };
  return { title: s, company: '' };
}

// LinkedIn job URL → numeric job ID. Falls back to URL hash so we still
// have a unique key even if the format changes.
function jobIdFromUrl(url: string): string {
  const m = url.match(/jobs\/view\/(\d+)/);
  if (m) return m[1];
  return url.replace(/[^a-z0-9]/gi, '').slice(0, 64);
}

// LinkedIn-style location ("San Francisco, CA") sits in the title or
// in a separate <location> element on some feeds; we accept both.
function extractLocation(itemXml: string, titleRaw: string): string {
  const tag = itemXml.match(/<(?:location|category)>([^<]+)<\/(?:location|category)>/i);
  if (tag) return decodeXml(tag[1]).trim();
  const m = titleRaw.match(/\s+in\s+(.+?)\s*$/i);
  return m ? m[1].trim() : '';
}

function tag(itemXml: string, name: string): string {
  // Match <name>...</name> or <name><![CDATA[...]]></name>
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${name}>`, 'i');
  const m = itemXml.match(re);
  return decodeXml((m?.[1] ?? m?.[2] ?? '').trim());
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

async function fetchOneFeed(feed: FeedConfig): Promise<RecommendedRoleInput[]> {
  const res = await fetch(feed.url, {
    headers: {
      // LinkedIn returns 451 to obvious bots; pretend to be a browser.
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`linkedin-rss ${res.status} for ${feed.url.slice(0, 80)}`);
  const xml = await res.text();
  console.log(`[linkedin-rss] ${feed.label || feed.url.slice(0, 60)}: ${xml.length} bytes, ct=${res.headers.get('content-type')}`);
  const items = xml.split(/<item[\s>]/i).slice(1).map(chunk => '<item ' + chunk.split(/<\/item>/i)[0] + '</item>');
  if (!items.length) {
    // Surface what we actually got for debugging — first 200 chars.
    throw new Error(`no <item> in feed; first chars: ${xml.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
  return items.map(itemXml => {
    const titleRaw = tag(itemXml, 'title');
    const link     = tag(itemXml, 'link');
    const pubDate  = tag(itemXml, 'pubDate');
    const desc     = tag(itemXml, 'description');
    const { title, company } = splitTitle(titleRaw);
    const location = extractLocation(itemXml, titleRaw);
    return {
      source:      'linkedin-rss',
      sourceId:    `li:${jobIdFromUrl(link)}`,
      sourceLabel: feed.label ? `LinkedIn · ${feed.label}` : 'LinkedIn Recommended',
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

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export const linkedinRssSource: Source<LinkedInRssConfig> = {
  type: 'linkedin-rss',
  async pull(cfg) {
    const feeds: FeedConfig[] = cfg.feeds && cfg.feeds.length
      ? cfg.feeds
      : (cfg.feedUrl ? [{ url: cfg.feedUrl }] : []);
    if (!feeds.length) throw new Error('linkedin-rss: config.feeds (or feedUrl) is required');
    const out: RecommendedRoleInput[] = [];
    const errs: string[] = [];
    for (const f of feeds) {
      try {
        const rows = await fetchOneFeed(f);
        out.push(...rows);
      } catch (e) {
        errs.push(`${f.label || f.url.slice(0, 40)}: ${(e as Error).message.slice(0, 200)}`);
      }
    }
    // If every feed failed, throw so the user_sources row sees last_error.
    if (!out.length && errs.length === feeds.length) {
      throw new Error(errs.join(' | ').slice(0, 500));
    }
    return out;
  },
};
