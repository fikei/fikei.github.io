// format.js — shared display formatters + tiny renderers for the job list
// views. Imported by ladder-recommendations-table.js and ladder-pipeline.js so
// Location + Source render identically everywhere (single source of truth).
import { html, nothing } from 'https://esm.run/lit@3';

// Normalize a free-text location into a compact, deduped display.
//   "San Francisco, CA; New York, NY"  → { primary: "San Francisco, CA", extra: 1, all: [...] }
//   "Remote - US"                       → { primary: "Remote", extra: 0, all: ["Remote"] }
//   ""/null                             → null
// NOTE: we split on multi-location separators (; | / • • newlines, " or ")
// but NOT on commas — a comma is the city,state separator inside one location.
export function formatLocation(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const stripped = raw.replace(/^\s*locations?\s*:\s*/i, '').trim();
  if (!stripped) return null;

  const parts = stripped
    .split(/\s*(?:;|\||•|·|\/|\bor\b|\n)\s*/i)
    .map(cleanOne)
    .filter(Boolean);

  const seen = new Set();
  const all = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) { seen.add(key); all.push(p); }
  }
  if (!all.length) return null;
  return { primary: all[0], extra: all.length - 1, all };
}

function cleanOne(p) {
  let s = String(p || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Collapse remote spellings → "Remote" (drops "Remote - US", "Remote (Global)").
  if (/^remote\b/i.test(s)) return 'Remote';
  if (/^hybrid\b/i.test(s)) return s.replace(/\s*[-–(].*$/, '').trim() || 'Hybrid';
  // Trim redundant US country suffixes; keep international ones.
  s = s.replace(/,?\s*(united states(?:\s+of\s+america)?|usa|u\.s\.a?\.?)\s*$/i, '').trim();
  return s;
}

// Favicon for a host via Google's s2 service (same source as logo.js).
function favicon(host) {
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null;
}

// Source-platform metadata for a recommendation row.
//   → { iconUrl, label, title }   label is a tight platform name.
// Favicon: Gmail for inbox-sourced rows; otherwise the posting URL's host
// (which IS the platform for ATS/company-page/LinkedIn sources).
export function sourceMeta(r) {
  const rawLabel = String(r.sourceLabel || r.source || '').trim();
  const src = String(r.source || '').toLowerCase();

  if (src.includes('gmail') || r.sourceEmailUrl) {
    return { iconUrl: favicon('mail.google.com'), label: 'Gmail', title: rawLabel || 'Gmail' };
  }

  // Platform = text before a "·"/"|" separator ("Greenhouse · Abridge" → "Greenhouse").
  let label = rawLabel.split(/\s*[·|]\s*/)[0].trim();
  const lower = label.toLowerCase();
  if (/linkedin/.test(lower) || src.includes('linkedin')) label = 'LinkedIn';
  else if (lower === 'from company pages' || src === 'tracked-ats') label = label && lower !== 'from company pages' ? label : 'Company site';
  else if (lower === 'manual') label = 'Added';
  else if (lower === 'rss' || src.includes('rss')) label = 'RSS';
  if (!label) label = rawLabel || 'Source';

  let iconUrl = null;
  try {
    if (r.url) iconUrl = favicon(new URL(r.url).hostname.replace(/^www\./, ''));
  } catch { /* ignore */ }

  return { iconUrl, label, title: rawLabel || label };
}

const LOC_PIN = html`<svg class="loc-pin" viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor"/></svg>`;

// Location nested under the Role cell — normalized + deduped. Multiple
// locations collapse to "primary +N" with the full list on hover.
export function renderLocation(raw) {
  const loc = formatLocation(raw);
  if (!loc) return nothing;
  return html`
    <div class="role-cell__loc" title=${loc.extra ? loc.all.join(' · ') : loc.primary}>
      ${LOC_PIN}<span class="role-cell__loc-text">${loc.primary}</span>${loc.extra
        ? html`<span class="role-cell__loc-more">+${loc.extra}</span>` : nothing}
    </div>`;
}

// Source as favicon + tight platform label (For You list).
export function renderSource(r) {
  const sm = sourceMeta(r);
  return html`<span class="rec-source">
    ${sm.iconUrl ? html`<img class="rec-source__icon" src=${sm.iconUrl} alt="" loading="lazy"
        referrerpolicy="no-referrer" @error=${(e) => { e.target.style.visibility = 'hidden'; }}>` : nothing}
    <span class="rec-source__label" title=${sm.title}>${sm.label}</span>
  </span>`;
}
