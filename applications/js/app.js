/* Agape recruiting viewer — /applications
   Discord-gated (Recruiting Society channel on the Agape server, verified by
   the discord-membership edge fn). Applicants, shared decisions, and house
   notes live in Supabase behind RLS (migration 108). */
const VERSION = '2.1.1';
console.log(`[applications] v${VERSION} - Agape recruiting viewer`);

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';

const HOLD_REASONS = [
  { id: 'fit', label: 'Fit needs review' },
  { id: 'timing', label: 'Length of timing' },
  { id: 'needs', label: 'Current Agape needs (e.g. couple)' },
];
const DECISION_LABELS = { outreach: 'Outreach', hold: 'Hold', pass: 'Pass' };

let sb = null;                // supabase client (from CtrlAuth)
let me = null;                // { id, name }
let applicants = [];          // newest first
let decisions = {};           // applicant_id -> { d, reason, by, byName, at }
let commentCounts = {};       // applicant_id -> n
let comments = [];            // comments for the applicant open in review
let filter = 'all';
let queue = [];
let qIndex = 0;

/* ---------- helpers (shared with the static viewer) ---------- */
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = a => ((a.first[0] || '') + (a.last[0] || '')).toUpperCase();
const fullName = a => `${a.first} ${a.last}`.trim();
const isSublet = a => /short/i.test(a.residency);
const trackLabel = a => isSublet(a) ? 'Sublet' : 'Full-time';
const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const monthKey = iso => iso.slice(0, 7);
const monthLabel = iso => new Date(iso + (iso.length === 7 ? '-01T12:00' : '')).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const relTime = iso => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/* Row subline stays clean: track + move-in. Budget lives on the review page. */
function subLine(a) {
  const bits = [trackLabel(a)];
  const mi = normalizeMoveIn(a);
  if (mi) bits.push(mi);
  return bits.join(' · ');
}

/* ---------- normalizers (raw text stays behind the (i) tooltip) ---------- */
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function normalizeMoveIn(a) {
  const raw = (a.movein || '').trim();
  if (!raw || /^n\/?a$/i.test(raw)) return '';
  const flexible = /flexib|anytime|any time|whenever|open to|open for/i.test(raw);
  if (/asap|as soon as/i.test(raw)) return 'ASAP' + (flexible ? ' · flexible' : '');

  const found = [];
  const rx = new RegExp(`\\b(${MONTHS.join('|')}|${MONTH_ABBR.join('|')})\\b`, 'gi');
  let m;
  while ((m = rx.exec(raw))) {
    let idx = MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3).toLowerCase()));
    if (idx >= 0 && !found.includes(idx)) found.push(idx);
  }
  if (!found.length) return flexible ? 'Flexible' : '';

  const first = found[0];
  const monthName = `(?:${MONTHS[first]}|${MONTH_ABBR[first]})`;
  const day = raw.match(new RegExp(`${monthName}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'))
    || raw.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthName}`, 'i'));

  const yearMatch = raw.match(/\b(20\d{2})\b/);
  const applied = new Date(a.ts_iso);
  const year = yearMatch ? +yearMatch[1] : (first < applied.getMonth() ? applied.getFullYear() + 1 : applied.getFullYear());

  let label;
  if (found.length > 1) {
    const lo = Math.min(...found), hi = Math.max(...found);
    label = `${MONTH_ABBR[lo]}–${MONTH_ABBR[hi]} ${year}`;
  } else if (day) {
    label = `${MONTH_ABBR[first]} ${+day[1]}, ${year}`;
  } else {
    label = `${MONTH_ABBR[first]} ${year}`;
  }
  return label + (flexible ? ' · flexible' : '');
}

function budgetNumbers(raw) {
  const nums = [];
  const rx = /\$?\s?(\d{1,2}(?:[.,]\d{1,3})?)\s*[kK]\b|\$?\s?(\d{1,3}(?:,\d{3})+|\d{3,4})(?!\d)/g;
  let m;
  while ((m = rx.exec(raw))) {
    let n = m[1] ? parseFloat(m[1].replace(',', '.')) * 1000 : parseInt(m[2].replace(/,/g, ''), 10);
    if (n >= 300 && n <= 10000) nums.push(Math.round(n));
  }
  return nums;
}

/* The applicant's stated ceiling, or null when no number was parseable. */
function budgetMax(raw) {
  const nums = budgetNumbers((raw || '').trim());
  return nums.length ? Math.max(...nums) : null;
}

function normalizeBudget(raw) {
  raw = (raw || '').trim();
  if (!raw || /^n\/?a$/i.test(raw)) return '';
  const nums = budgetNumbers(raw);
  if (!nums.length) return /flexib/i.test(raw) ? 'Flexible' : '';
  const fmt = n => '$' + n.toLocaleString('en-US');
  const lo = Math.min(...nums), hi = Math.max(...nums);
  const capped = /up to|max|below|under|less than|<|limit|upper bound|no more than/i.test(raw);
  const plus = /\d\s*\+/.test(raw);
  let label;
  if (lo !== hi) label = `${fmt(lo)}–${fmt(hi)}`;
  else if (capped) label = `Up to ${fmt(hi)}`;
  else if (plus) label = `${fmt(hi)}+`;
  else label = fmt(hi);
  return label + '/mo';
}

function infoDot(raw, normalized) {
  if (!raw || !normalized || raw.trim() === normalized) return '';
  return `<button class="info-dot" type="button" data-tip="${esc(raw)}" aria-label="Original response">i</button>`;
}

/* ---------- links helper ---------- */
const HANDLE_STOPWORDS = /^(https?|www|and|but|not|the|don|dont|use|media|active|com|net|org|only|though|really)$/i;
// Official brand marks (Simple Icons paths, 24x24) — shown instead of the
// platform's name on link chips. Unmodified single-path glyphs.
const BRAND_ICONS = {
  instagram: 'M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z',
  linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  github: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  tiktok: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  substack: 'M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z',
  youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  soundcloud: 'M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c0-.057-.045-.1-.09-.1m-.899.828c-.06 0-.091.037-.104.094L0 14.479l.165 1.308c0 .055.045.094.09.094s.089-.045.104-.104l.21-1.319-.21-1.334c0-.061-.044-.09-.09-.09m1.83-1.229c-.061 0-.12.045-.12.104l-.21 2.563.225 2.458c0 .06.045.12.119.12.061 0 .105-.061.121-.12l.254-2.474-.254-2.548c-.016-.06-.061-.12-.121-.12m.945-.089c-.075 0-.135.06-.15.135l-.193 2.64.21 2.544c.016.077.075.138.149.138.075 0 .135-.061.15-.15l.24-2.532-.24-2.623c0-.075-.06-.135-.135-.135l-.031-.017zm1.155.36c-.005-.09-.075-.149-.159-.149-.09 0-.158.06-.164.149l-.217 2.43.2 2.563c0 .09.075.157.159.157.074 0 .148-.068.148-.158l.227-2.563-.227-2.444.033.015zm.809-1.709c-.101 0-.18.09-.18.181l-.21 3.957.187 2.563c0 .09.08.164.18.164.094 0 .174-.09.18-.18l.209-2.563-.209-3.972c-.008-.104-.088-.18-.18-.18m.959-.914c-.105 0-.195.09-.203.194l-.18 4.872.165 2.548c0 .12.09.209.195.209.104 0 .194-.089.21-.209l.193-2.548-.192-4.856c-.016-.12-.105-.21-.21-.21m.989-.449c-.121 0-.211.089-.225.209l-.165 5.275.165 2.52c.014.119.104.225.225.225.119 0 .225-.105.225-.225l.195-2.52-.196-5.275c0-.12-.105-.225-.225-.225m1.245.045c0-.135-.105-.24-.24-.24-.119 0-.24.105-.24.24l-.149 5.441.149 2.503c.016.135.121.24.256.24s.24-.105.24-.24l.164-2.503-.164-5.456-.016.015zm.749-.134c-.135 0-.255.119-.255.254l-.15 5.322.15 2.473c0 .15.12.255.255.255s.255-.12.255-.27l.15-2.474-.165-5.307c0-.148-.12-.255-.255-.255m1.005.166c-.164 0-.284.135-.284.285l-.103 5.143.135 2.474c0 .149.119.277.284.277.149 0 .271-.128.284-.284l.121-2.443-.135-5.112c-.012-.164-.135-.285-.285-.285m1.184-.945c-.045-.029-.105-.044-.165-.044s-.119.015-.165.044c-.09.054-.149.15-.149.255v.061l-.104 6.048.115 2.449v.008c.008.06.03.135.074.18.06.075.149.12.24.12.074 0 .149-.03.209-.09.06-.06.09-.135.09-.225l.015-.24.117-2.203-.135-6.086c0-.104-.061-.193-.135-.24l-.007-.037zm1.006-.547c-.045-.045-.09-.061-.15-.061-.074 0-.149.016-.209.061-.075.061-.119.15-.119.24v.029l-.137 6.609.076 1.215.061 1.185c0 .164.148.311.328.311.181 0 .33-.147.33-.327l.15-2.399-.15-6.637c0-.12-.074-.221-.165-.277m8.934 3.777c-.405 0-.795.086-1.139.232-.24-2.654-2.46-4.736-5.188-4.736-.659 0-1.305.135-1.889.359-.225.09-.27.18-.285.359v9.368c.016.18.15.33.33.345h8.185C22.681 17.218 24 15.914 24 14.28s-1.319-2.952-2.938-2.952',
  spotify: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z',
};
const GLOBE_ICON = 'M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm7.938 8h-3.032a15.6 15.6 0 0 0-1.7-4.575A10.03 10.03 0 0 1 19.938 8zM12 2.09c.96 1.32 1.86 3.24 2.4 5.91H9.6c.54-2.67 1.44-4.59 2.4-5.91zM2.462 14A9.984 9.984 0 0 1 2 12c0-.69.07-1.36.2-2h3.632c-.06.65-.1 1.31-.1 2s.04 1.35.1 2H2.462zm1.332 2h3.032c.42 1.77 1.02 3.3 1.7 4.575A10.03 10.03 0 0 1 3.794 16zm3.032-8H3.794a10.03 10.03 0 0 1 4.732-4.575A15.6 15.6 0 0 0 6.826 8zM12 21.91c-.96-1.32-1.86-3.24-2.4-5.91h4.8c-.54 2.67-1.44 4.59-2.4 5.91zM14.7 14H9.3c-.066-.64-.11-1.307-.11-2s.044-1.36.11-2h5.4c.066.64.11 1.307.11 2s-.044 1.36-.11 2zm.474 6.575c.68-1.275 1.28-2.805 1.7-4.575h3.032a10.03 10.03 0 0 1-4.732 4.575zM18.168 14c.06-.65.1-1.31.1-2s-.04-1.35-.1-2H21.8c.13.64.2 1.31.2 2s-.07 1.36-.2 2h-3.632z';

const LINK_PLATFORMS = [
  [/instagram\.com/i, 'instagram'], [/linkedin\.com/i, 'linkedin'],
  [/facebook\.com/i, 'facebook'], [/(?:^|\.)x\.com|twitter\.com/i, 'x'],
  [/github\.com/i, 'github'], [/tiktok\.com/i, 'tiktok'],
  [/substack\.com/i, 'substack'], [/youtube\.com|youtu\.be/i, 'youtube'],
  [/soundcloud\.com/i, 'soundcloud'], [/spotify\.com/i, 'spotify'],
];

function linkMeta(url) {
  try {
    const u = new URL(url);
    for (const [rx, platform] of LINK_PLATFORMS) {
      if (rx.test(u.hostname + u.pathname)) {
        let seg = u.pathname.split('/').filter(Boolean).pop() || '';
        if (!seg && /substack\.com$/i.test(u.hostname) && !/^www\./i.test(u.hostname)) seg = u.hostname.split('.')[0];
        const handle = decodeURIComponent(seg).replace(/^@/, '').replace(/\/$/, '');
        const label = handle && !/^(in|company|profile|people)$/i.test(handle) ? handle : platform;
        return { platform, label };
      }
    }
    return { platform: null, label: u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '') };
  } catch { return { platform: null, label: url }; }
}

function linkLabel(url) {
  const { platform, label } = linkMeta(url);
  return platform && label !== platform ? `${platform} · ${label}` : label; // CSV/dedup label
}

function linkChip(l) {
  const { platform, label } = linkMeta(l.url);
  const icon = BRAND_ICONS[platform] || GLOBE_ICON;
  const title = platform ? `${platform[0].toUpperCase()}${platform.slice(1)} — ${label}` : label;
  return `<a class="link-chip" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(title)}">` +
    `<span class="link-chip__icon" aria-hidden="true"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${icon}"/></svg></span>${esc(label)}</a>`;
}

/* ---------- avatars ---------- */
/* Social profile photo via unavatar.io when a linked account exists;
   falls back to initials when the lookup 404s or is rate-limited. */
const AVATAR_PROVIDERS = ['github', 'x', 'instagram', 'tiktok', 'facebook', 'youtube', 'soundcloud'];
function avatarSource(a) {
  const metas = collectLinks(a).map(l => linkMeta(l.url));
  for (const p of AVATAR_PROVIDERS) {
    const m = metas.find(x => x.platform === p && x.label && x.label !== p);
    if (m) return `https://unavatar.io/${p === 'x' ? 'twitter' : p}/${encodeURIComponent(m.label)}?fallback=false`;
  }
  if (a.email) return `https://unavatar.io/gravatar/${encodeURIComponent(a.email.trim().toLowerCase())}?fallback=false`;
  return null;
}
function avatarHtml(a, large) {
  const src = avatarSource(a);
  return `<span class="avatar ${large ? 'avatar--lg' : ''}">${esc(initials(a))}` +
    (src ? `<img class="avatar__img" src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()">` : '') +
    `</span>`;
}

function collectLinks(a) {
  const found = new Map();
  const add = url => {
    if (!url) return;
    url = url.replace(/[.,;:!?)\]]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const key = url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    if (!found.has(key)) found.set(key, { url, label: linkLabel(url) });
  };

  const social = a.social || '';
  const answers = [a.about, a.why, a.gifts].join('  ');
  const all = social + '  ' + answers;

  for (const m of all.matchAll(/https?:\/\/[^\s,<>()"']+/gi)) add(m[0]);
  for (const m of all.matchAll(/(?<![@\w.])((?:[a-z0-9-]+\.)+(?:com|org|net|io|co|ai|me|dev|house|fm|xyz))(\/[^\s,<>()"']*)?/gi)) {
    if (/@/.test(m[0])) continue;
    add(m[1] + (m[2] || ''));
  }
  if (social && !/^(i don'?t|none|n\/?a|right now)/i.test(social.trim())) {
    for (const m of social.matchAll(/(?:^|[\s,])(?:(insta(?:gram)?|ig|tiktok|fb|facebook|linkedin|twitter|x)\b[:\s]*)?@([a-z0-9._]{2,30})\b(?:\s*(?:on\s+)?\(?(insta(?:gram)?|ig|tiktok|fb|facebook)\)?)?/gi)) {
      const hint = (m[1] || m[3] || 'instagram').toLowerCase();
      const handle = m[2];
      if (HANDLE_STOPWORDS.test(handle)) continue;
      const host = /tiktok/.test(hint) ? `tiktok.com/@${handle}`
        : /fb|facebook/.test(hint) ? `facebook.com/${handle}`
        : /linkedin/.test(hint) ? `linkedin.com/in/${handle}`
        : /twitter|^x$/.test(hint) ? `x.com/${handle}`
        : `instagram.com/${handle}`;
      add(host);
    }
    for (const m of social.matchAll(/(?:(insta(?:gram)?|ig|fb|facebook)\b[:\s]+([a-z0-9._]{3,30})\b|\b([a-z0-9._]{3,30})\s+on\s+(insta(?:gram)?|ig|fb|facebook)\b)/gi)) {
      const hint = (m[1] || m[4] || '').toLowerCase();
      const handle = m[2] || m[3];
      if (!handle || HANDLE_STOPWORDS.test(handle)) continue;
      add(/fb|facebook/.test(hint) ? `facebook.com/${handle}` : `instagram.com/${handle}`);
    }
  }
  return [...found.values()];
}

/* ---------- data ---------- */
async function loadAll() {
  const [aRes, dRes, cRes] = await Promise.all([
    sb.from('recruit_applicants').select('*').order('submitted_at', { ascending: false }),
    sb.from('recruit_decisions').select('*'),
    sb.from('recruit_comments').select('applicant_id'),
  ]);
  if (aRes.error) throw aRes.error;
  applicants = (aRes.data || []).map(r => ({
    id: r.id, ts_iso: r.submitted_at,
    first: r.first_name, last: r.last_name, pronouns: r.pronouns,
    email: r.email, social: r.social, about: r.about, why: r.why_agape,
    gifts: r.gifts, source: r.heard_from, residency: r.residency,
    movein: r.move_in, budget: r.budget,
  }));
  decisions = {};
  for (const d of (dRes.data || [])) {
    decisions[d.applicant_id] = { d: d.decision, reason: d.hold_reason, byName: d.decided_by_name, at: d.decided_at };
  }
  commentCounts = {};
  for (const c of (cRes.data || [])) commentCounts[c.applicant_id] = (commentCounts[c.applicant_id] || 0) + 1;
}

async function saveDecision(id, d, reason, byName) {
  if (d === null) {
    delete decisions[id];
    const { error } = await sb.from('recruit_decisions').delete().eq('applicant_id', id);
    if (error) toast(`Save failed: ${error.message}`);
    return;
  }
  const name = byName || me.name;
  decisions[id] = { d, reason: reason || null, byName: name, at: new Date().toISOString() };
  const { error } = await sb.from('recruit_decisions').upsert({
    applicant_id: id, decision: d, hold_reason: reason || null,
    decided_by: me.id, decided_by_name: name,
    decided_at: new Date().toISOString(),
  });
  if (error) toast(`Save failed: ${error.message}`);
}

/* House rule: a stated budget ceiling under $1,500/mo is an automatic pass.
   Applied to undecided applicants after load; recorded like any decision so
   it syncs, shows attribution, and can be undone from the review page. */
async function applyAutoPass() {
  const auto = applicants.filter(a => !decisions[a.id] && budgetMax(a.budget) !== null && budgetMax(a.budget) < 1500);
  for (const a of auto) {
    await saveDecision(a.id, 'pass', null, 'Auto — budget under $1,500');
  }
  return auto.length;
}

async function loadComments(applicantId) {
  const { data, error } = await sb.from('recruit_comments')
    .select('*').eq('applicant_id', applicantId).order('created_at');
  comments = error ? [] : (data || []);
}

/* ---------- inbox render ---------- */
function matchesFilter(a) {
  const rec = decisions[a.id];
  if (filter === 'all') return true;
  if (filter === 'undecided') return !rec;
  return rec?.d === filter;
}

function counts() {
  const c = { all: applicants.length, undecided: 0, outreach: 0, hold: 0, pass: 0 };
  for (const a of applicants) {
    const rec = decisions[a.id];
    if (!rec) c.undecided++; else c[rec.d]++;
  }
  return c;
}

function decisionChip(id) {
  const rec = decisions[id];
  if (!rec) return '';
  const reason = rec.reason ? ` — ${HOLD_REASONS.find(r => r.id === rec.reason)?.label || rec.reason}` : '';
  const by = rec.byName ? ` · ${rec.byName}` : '';
  return `<span class="decision-chip decision-chip--${rec.d}" title="${esc(DECISION_LABELS[rec.d] + reason + by)}">${DECISION_LABELS[rec.d]}</span>`;
}

function renderFilters() {
  const c = counts();
  const defs = [
    ['all', 'All'], ['undecided', 'Needs review'],
    ['outreach', 'Outreach'], ['hold', 'Hold'], ['pass', 'Pass'],
  ];
  document.getElementById('filters').innerHTML = defs.map(([id, label]) =>
    `<button class="chip ${filter === id ? 'is-on' : ''}" data-filter="${id}">${label} <span class="chip__count">${c[id]}</span></button>`
  ).join('');
}

function renderInbox() {
  renderFilters();
  const list = applicants.filter(matchesFilter);
  document.getElementById('page-sub').textContent =
    `${applicants.length} applicants · ${counts().undecided} to review`;

  const host = document.getElementById('inbox');
  if (!list.length) {
    host.innerHTML = `<p class="inbox-empty">Nothing here — every applicant in this view is decided.</p>`;
    return;
  }
  const groups = [];
  for (const a of list) {
    const k = monthKey(a.ts_iso);
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, items: [] });
    groups[groups.length - 1].items.push(a);
  }
  host.innerHTML = groups.map(g => `
    <section class="inbox-group">
      <div class="inbox-group__head">
        <h2 class="inbox-group__label">${monthLabel(g.key)}</h2>
        <span class="inbox-group__count">${g.items.length} applicant${g.items.length === 1 ? '' : 's'}</span>
      </div>
      <ul class="inbox-card">
        ${g.items.map(a => `
          <li class="inbox-row">
            <button class="inbox-row__main" data-review="${a.id}">
              ${avatarHtml(a)}
              <span class="inbox-row__text">
                <span class="inbox-row__title">${esc(fullName(a))}</span>
                <span class="inbox-row__sub">${esc(subLine(a))} · applied ${fmtDate(a.ts_iso)}</span>
              </span>
            </button>
            <span class="inbox-row__actions">
              ${commentCounts[a.id] ? `<span class="note-count" title="${commentCounts[a.id]} house note${commentCounts[a.id] === 1 ? '' : 's'}">✎ ${commentCounts[a.id]}</span>` : ''}
              ${decisionChip(a.id)}
              <button class="btn inbox-row__review" data-review="${a.id}">Review</button>
            </span>
          </li>`).join('')}
      </ul>
    </section>`).join('');
}

/* ---------- review overlay ---------- */
function openReview(id) {
  queue = applicants.filter(matchesFilter).map(a => a.id);
  if (!queue.includes(id)) queue = applicants.map(a => a.id);
  qIndex = Math.max(0, queue.indexOf(id));
  document.getElementById('review').hidden = false;
  document.body.style.overflow = 'hidden';
  hideHoldSheet();
  renderReview();
  resetScroll();
}

function closeReview() {
  document.getElementById('review').hidden = true;
  document.body.style.overflow = '';
  const url = new URL(location); url.searchParams.delete('a');
  history.replaceState(null, '', url);
  renderInbox();
}

function step(delta) {
  const next = qIndex + delta;
  if (next < 0 || next >= queue.length) { if (delta > 0) closeReview(); return; }
  qIndex = next;
  hideHoldSheet();
  renderReview();
  resetScroll();
}

function resetScroll() {
  const el = document.querySelector('.review__scroll');
  el.scrollTop = 0;
  requestAnimationFrame(() => { el.scrollTop = 0; });
}

function renderReview() {
  const a = applicants.find(x => x.id === queue[qIndex]);
  if (!a) { closeReview(); return; }
  const url = new URL(location); url.searchParams.set('a', a.id);
  history.replaceState(null, '', url);

  const dotsHost = document.getElementById('review-progress');
  dotsHost.innerHTML = queue.length <= 12
    ? `<span class="review__dots">${queue.map((_, i) => `<span class="review__dot ${i === qIndex ? 'is-current' : ''}"></span>`).join('')}</span>`
    : `<span class="review__counter">${qIndex + 1} of ${queue.length}</span>`;

  document.getElementById('review-prev').disabled = qIndex === 0;
  document.getElementById('review-next').disabled = qIndex === queue.length - 1;

  const rec = decisions[a.id];
  const links = collectLinks(a);
  const linksHtml = links.length
    ? `<div class="link-chips">${links.map(linkChip).join('')}${a.social ? infoDot(a.social, 'links') : ''}</div>`
    : (a.social ? `<span class="review__fact-value">${esc(a.social)}</span>` : '');
  const miNorm = normalizeMoveIn(a);
  const buNorm = normalizeBudget(a.budget);

  document.getElementById('review-body').innerHTML = `
    ${rec ? `<p class="review__decided">Decided: ${DECISION_LABELS[rec.d]}${rec.reason ? ` — ${esc(HOLD_REASONS.find(r => r.id === rec.reason)?.label || rec.reason)}` : ''}${rec.byName ? ` · by ${esc(rec.byName)}` : ''} · <button class="link-clear" data-clear="${a.id}">Undo</button></p>` : ''}
    <div class="review__card">
      <div class="review__head">
        ${avatarHtml(a, true)}
        <div class="review__head-text">
          <h2 class="review__title">${esc(fullName(a))}${a.pronouns ? ` <span class="review__pronouns">${esc(a.pronouns)}</span>` : ''}</h2>
          <p class="review__meta"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>
          <div class="review__badges">
            <span class="review__badge review__badge--track">${trackLabel(a)}</span>
            ${a.source ? `<span class="review__badge" title="How they heard about Agape">${esc(a.source)}</span>` : ''}
          </div>
          <div class="review__facts">
            <div class="review__fact"><span class="review__fact-label">Move-in</span><span class="review__fact-value">${esc(miNorm || a.movein || '—')} ${infoDot(a.movein, miNorm)}</span></div>
            <div class="review__fact"><span class="review__fact-label">Budget</span><span class="review__fact-value">${esc(buNorm || a.budget || '—')} ${infoDot(a.budget, buNorm)}</span></div>
            <div class="review__fact"><span class="review__fact-label">Applied</span><span class="review__fact-value">${new Date(a.ts_iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
            ${linksHtml ? `<div class="review__fact"><span class="review__fact-label">Links</span>${linksHtml}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
    ${section('About them', a.about)}
    ${section('Why Agape', a.why)}
    ${section('Gifts to share', a.gifts)}
    <section class="review__section notes" id="notes">
      <h3 class="review__section-title">House notes</h3>
      <div id="notes-body"><p class="notes__empty">Loading notes…</p></div>
      <form class="notes__form" id="notes-form">
        <textarea class="notes__input" id="notes-input" placeholder="Add an internal note for the house — only Recruiting Society members see these." maxlength="4000"></textarea>
        <button class="btn btn--accent btn--sm notes__submit" type="submit">Add note</button>
      </form>
    </section>
  `;

  for (const d of ['pass', 'hold', 'outreach']) {
    const btn = document.getElementById(`btn-${d}`);
    btn.classList.toggle(`is-active--${d}`, rec?.d === d);
  }

  loadComments(a.id).then(() => {
    // guard against navigating away while the query was in flight
    if (queue[qIndex] === a.id) renderNotes(a.id);
  });
  document.getElementById('notes-form').addEventListener('submit', e => {
    e.preventDefault();
    postNote(a.id);
  });
}

function renderNotes(applicantId) {
  const host = document.getElementById('notes-body');
  if (!host) return;
  commentCounts[applicantId] = comments.length;
  if (!comments.length) {
    host.innerHTML = `<p class="notes__empty">No notes yet — be the first.</p>`;
    return;
  }
  host.innerHTML = `<ul class="notes__list">${comments.map(c => `
    <li class="note">
      <span class="avatar">${esc((c.author_name || '?')[0].toUpperCase())}</span>
      <div class="note__body-wrap">
        <div class="note__meta">
          <span class="note__author">${esc(c.author_name || 'Housemate')}</span>
          <span class="note__time">${relTime(c.created_at)}</span>
        </div>
        <p class="note__body">${esc(c.body)}</p>
      </div>
      ${c.user_id === me.id ? `<button class="note__delete" data-delete-note="${c.id}" aria-label="Delete note">✕</button>` : ''}
    </li>`).join('')}</ul>`;
}

async function postNote(applicantId) {
  const input = document.getElementById('notes-input');
  const body = (input.value || '').trim();
  if (!body) return;
  input.value = '';
  const { data, error } = await sb.from('recruit_comments')
    .insert({ applicant_id: applicantId, user_id: me.id, author_name: me.name, body })
    .select().single();
  if (error) { toast(`Note failed: ${error.message}`); input.value = body; return; }
  comments.push(data);
  renderNotes(applicantId);
}

async function deleteNote(noteId, applicantId) {
  const { error } = await sb.from('recruit_comments').delete().eq('id', noteId);
  if (error) { toast(`Delete failed: ${error.message}`); return; }
  comments = comments.filter(c => c.id !== noteId);
  renderNotes(applicantId);
}

function section(title, text) {
  if (!text) return '';
  return `<section class="review__section">
    <h3 class="review__section-title">${title}</h3>
    <p class="review__prose">${esc(text)}</p>
  </section>`;
}

function decide(d, reason) {
  const a = applicants.find(x => x.id === queue[qIndex]);
  if (!a) return;
  saveDecision(a.id, d, reason);
  toast(`${fullName(a)} → ${DECISION_LABELS[d]}${reason ? ` (${HOLD_REASONS.find(r => r.id === reason)?.label})` : ''}`);
  if (qIndex === queue.length - 1) closeReview(); else step(1);
}

function showHoldSheet() {
  const a = applicants.find(x => x.id === queue[qIndex]);
  const current = decisions[a?.id]?.reason;
  document.getElementById('hold-options').innerHTML = HOLD_REASONS.map(r =>
    `<button class="hold-sheet__option ${current === r.id ? 'is-selected' : ''}" data-reason="${r.id}">${r.label}</button>`).join('');
  document.getElementById('hold-sheet').hidden = false;
  document.getElementById('review-foot').hidden = true;
}
function hideHoldSheet() {
  document.getElementById('hold-sheet').hidden = true;
  document.getElementById('review-foot').hidden = false;
}

/* ---------- export ---------- */
function exportCsv() {
  const cols = ['first', 'last', 'email', 'ts_iso', 'residency', 'movein', 'budget', 'source'];
  const head = [...cols, 'decision', 'hold_reason', 'decided_by', 'decided_at', 'notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  for (const a of applicants) {
    const rec = decisions[a.id] || {};
    lines.push([...cols.map(c => q(a[c])), q(DECISION_LABELS[rec.d] || ''),
      q(rec.reason ? (HOLD_REASONS.find(r => r.id === rec.reason)?.label || rec.reason) : ''),
      q(rec.byName || ''), q(rec.at || ''), q(commentCounts[a.id] || 0)].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const aEl = document.createElement('a');
  aEl.href = URL.createObjectURL(blob);
  aEl.download = `agape-decisions-${new Date().toISOString().slice(0, 10)}.csv`;
  aEl.click();
  URL.revokeObjectURL(aEl.href);
}

/* ---------- toast ---------- */
function toast(msg) {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  el.onclick = () => el.remove();
  host.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ---------- theme ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('agape:theme', t);
}

/* ---------- auth + boot ---------- */
/* Direct Discord OAuth — the gate's primary action goes straight to Discord
   rather than through the multi-provider modal. */
async function signInWithDiscord() {
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: window.location.origin + window.location.pathname, scopes: 'identify email' },
    });
    if (error) throw error;
  } catch (e) {
    document.getElementById('gate-error').textContent = e.message || 'Discord sign-in failed';
  }
}

function setGate(sub, btnLabel, hint) {
  document.getElementById('gate-sub').textContent = sub;
  const btn = document.getElementById('gate-btn');
  document.getElementById('gate-btn-label').textContent = btnLabel || '';
  btn.hidden = !btnLabel;
  document.getElementById('gate-hint').textContent = hint ||
    'Access is limited to members of the Recruiting Society channel on the Agape server.';
}

let _entering = false;
async function checkMembershipAndEnter() {
  // CtrlAuth can dispatch signedin twice (fast-restore + auth event); the
  // enter sequence (load + auto-pass + toast) must only run once.
  if (_entering) return;
  _entering = true;
  try { await _checkMembershipAndEnter(); } finally {
    if (document.getElementById('app').hidden) _entering = false; // gate paths may retry
  }
}

async function _checkMembershipAndEnter() {
  const session = await sb.auth.getSession();
  const token = session?.data?.session?.access_token;
  if (!token) return;
  setGate('Checking your Recruiting Society access…', null);
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/discord-membership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'status' }),
    });
    const status = await resp.json();
    if (!status.linked) {
      setGate('Your account has no Discord linked.', 'Link Discord',
        'Link the Discord account that’s in the Agape server, then try again.');
      document.getElementById('gate-btn').onclick = () => window.CtrlAuth.linkDiscord(location.href);
      return;
    }
    if (!status.isRecruitingMember) {
      setGate(`Signed in as ${status.discordUsername || 'you'} — but this account can’t see the Recruiting Society channel.`,
        'Re-check access',
        'Ask in the Agape server for access to the Recruiting Society channel, then re-check.');
      document.getElementById('gate-btn').onclick = async () => {
        setGate('Re-checking…', null);
        await fetch(`${SUPABASE_URL}/functions/v1/discord-membership`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ action: 'verify' }),
        });
        checkMembershipAndEnter();
      };
      return;
    }
    // in — identify self, load data, render
    const user = window.CtrlAuth.getUser();
    me = { id: user.id, name: status.discordUsername || user.email || 'Housemate' };
    await loadAll();
    const autoPassed = await applyAutoPass();
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    renderInbox();
    if (autoPassed) toast(`${autoPassed} applicant${autoPassed === 1 ? '' : 's'} auto-passed (budget under $1,500)`);
    const deep = new URLSearchParams(location.search).get('a');
    if (deep && applicants.some(x => x.id === deep)) openReview(deep);
  } catch (e) {
    setGate('Something went wrong checking access.', 'Try again');
    document.getElementById('gate-btn').onclick = checkMembershipAndEnter;
    console.error(e);
  }
}

function init() {
  applyTheme(localStorage.getItem('agape:theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  // Listeners before init — CtrlAuth can dispatch signedin synchronously.
  document.addEventListener('ctrl:auth:signedin', () => {
    document.body.dataset.authState = 'in';
    checkMembershipAndEnter();
  });
  document.addEventListener('ctrl:auth:signedout', () => {
    document.body.dataset.authState = 'out';
    document.getElementById('app').hidden = true;
    document.getElementById('gate').hidden = false;
    setGate('Sign in with Discord to open the applicant inbox.', 'Continue with Discord');
    document.getElementById('gate-btn').onclick = signInWithDiscord;
  });

  window.CtrlAuth.init({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    redirectTo: window.location.origin + window.location.pathname,
    mountTo: '#ctrl-auth-root',
  });
  sb = window.CtrlAuth.getSupabaseClient();

  document.getElementById('gate-btn').onclick = signInWithDiscord;
  document.getElementById('gate-alt').onclick = () => window.CtrlAuth.openLoginModal();
  // If no signedin event lands shortly, we're signed out — show the gate.
  setTimeout(() => {
    if (document.body.dataset.authState === 'loading' && !window.CtrlAuth.getUser()) {
      document.body.dataset.authState = 'out';
    }
  }, 2500);

  // delegation
  document.addEventListener('click', e => {
    const review = e.target.closest('[data-review]');
    if (review) { openReview(review.dataset.review); return; }
    const fil = e.target.closest('[data-filter]');
    if (fil) { filter = fil.dataset.filter; renderInbox(); return; }
    const clear = e.target.closest('[data-clear]');
    if (clear) { saveDecision(clear.dataset.clear, null); renderReview(); return; }
    const reason = e.target.closest('[data-reason]');
    if (reason) { hideHoldSheet(); decide('hold', reason.dataset.reason); return; }
    const delNote = e.target.closest('[data-delete-note]');
    if (delNote) { deleteNote(delNote.dataset.deleteNote, queue[qIndex]); return; }
    if (!e.target.closest('.page-menu')) document.getElementById('menu-list')?.classList.remove('is-open');
  });

  document.getElementById('menu-trigger').onclick = () =>
    document.getElementById('menu-list').classList.toggle('is-open');
  document.getElementById('menu-export').onclick = () => { exportCsv(); document.getElementById('menu-list').classList.remove('is-open'); };
  document.getElementById('menu-theme').onclick = () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    document.getElementById('menu-list').classList.remove('is-open');
  };
  document.getElementById('menu-signout').onclick = () => window.CtrlAuth.signOut();
  document.getElementById('menu-sheet').onclick = () =>
    window.open('https://docs.google.com/spreadsheets/d/1dyDpPv7LhFSjL2Nz2E_2GMBIR-qGZg4qW4TjEkt7Epg/edit', '_blank');

  document.getElementById('review-close').onclick = closeReview;
  document.getElementById('review-prev').onclick = () => step(-1);
  document.getElementById('review-next').onclick = () => step(1);
  document.getElementById('btn-pass').onclick = () => decide('pass');
  document.getElementById('btn-outreach').onclick = () => decide('outreach');
  document.getElementById('btn-hold').onclick = showHoldSheet;
  document.getElementById('hold-cancel').onclick = hideHoldSheet;

  document.addEventListener('keydown', e => {
    if (document.getElementById('review').hidden) return;
    if (e.target instanceof Element && e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') { if (!document.getElementById('hold-sheet').hidden) hideHoldSheet(); else closeReview(); }
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
}

document.addEventListener('DOMContentLoaded', init);
