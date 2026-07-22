/* Agape recruiting viewer — /applications
   Discord-gated (Recruiting Society channel on the Agape server, verified by
   the discord-membership edge fn). Applicants, shared decisions, and house
   notes live in Supabase behind RLS (migration 108). */
const VERSION = '2.15.0';
console.log(`[applications] v${VERSION} - Agape recruiting viewer`);

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';

// Multiple-choice reasons per decision; freeform note rides alongside.
const DECISION_REASONS = {
  outreach: [
    { id: 'community-fit', label: 'Strong community fit' },
    { id: 'timing', label: 'Timing works' },
    { id: 'referral', label: 'Referred / known to the house' },
    { id: 'other', label: 'Other' },
  ],
  hold: [
    { id: 'no-room', label: 'No room open for them yet' },
    { id: 'timing', label: 'Timing — revisit later' },
    { id: 'fit', label: 'Fit needs a 2nd review' },
    { id: 'needs', label: 'Current Agape needs (e.g. couple)' },
    { id: 'other', label: 'Other' },
  ],
  pass: [
    { id: 'fit', label: 'Not a community fit' },
    { id: 'budget', label: 'Budget too low' },
    { id: 'timing', label: 'Timing doesn’t work' },
    { id: 'short', label: 'Stay too short' },
    { id: 'other', label: 'Other' },
  ],
};
function reasonLabel(id) {
  for (const list of Object.values(DECISION_REASONS)) {
    const hit = list.find(r => r.id === id);
    if (hit) return hit.label;
  }
  return id || '';
}
const HOLD_REASONS = DECISION_REASONS.hold; // legacy references
// DB keeps 'pass'; the surface calls it Archive.
const DECISION_LABELS = { outreach: 'Outreach', hold: 'Hold', pass: 'Archive' };

const VIEWS = {
  inbox: { title: 'Inbox', kind: 'applicants' },
  outreach: { title: 'Outreach', kind: 'applicants' },
  hold: { title: 'Hold', kind: 'applicants' },
  archive: { title: 'Archive', kind: 'applicants' },
  occupancy: { title: 'Occupancy', kind: 'house' },
};

let sb = null;                // supabase client (from CtrlAuth)
let me = null;                // { id, name }
let applicants = [];          // newest first
let decisions = {};           // applicant_id -> { d, reason, by, byName, at }
let commentCounts = {};       // applicant_id -> n
let comments = [];            // comments for the applicant open in review
let view = 'inbox';           // current rail view
let filters = { track: 'all', month: 'any', budget: 'any' }; // shared across applicant views
let rooms = [];               // recruit_rooms
let occupancy = [];           // recruit_occupancy rows
let listings = [];            // recruit_listings rows
let houseLoaded = false;
let suggestions = {};         // applicant_id -> recruit_match_suggestions row
let settings = { open_to_couples: true };
let gmailStatus = { connected: false };
let reviewTab = 'profile';   // 'profile' | 'emails'
let emailsCache = {};        // applicant_id -> rows
let availCache = {};         // applicant_id -> { windows, updated_at }
let screeningsCache = {};    // applicant_id -> rows
let emailState = {};         // applicant_id -> { lastDir, lastAt, replies }
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

/* Row subline stays clean: track + move-in (+ stay length for sublets).
   Budget lives on the review page. */
function subLine(a) {
  const bits = [];
  if (a.pronouns) bits.push(a.pronouns.toLowerCase());
  bits.push(trackLabel(a));
  const mi = normalizeMoveIn(a);
  if (mi) bits.push(mi);
  if (isSublet(a)) {
    const len = stayLength(a);
    if (len) bits.push(len);
  }
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
  // Abbreviations tolerate suffixes ("Sept", "Aug.") — match on the 3-letter stem.
  const rx = new RegExp(`\\b(${MONTH_ABBR.join('|')})[a-z]*\\b`, 'gi');
  let m;
  while ((m = rx.exec(raw))) {
    let idx = MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3).toLowerCase()));
    if (idx >= 0 && !found.includes(idx)) found.push(idx);
  }
  if (!found.length) return flexible ? 'Flexible' : '';

  const first = found[0];
  const monthName = `(?:${MONTHS[first]}|${MONTH_ABBR[first]}[a-z]*)`;
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

/* Day-level stay length for sublets, when the move-in text carries two dates
   ("July 28 - Aug 29", "June 21st - Sept 4th"). Null when not parseable. */
function stayLength(a) {
  const raw = (a.movein || '');
  const rx = new RegExp(`\\b(${MONTH_ABBR.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi');
  const dates = [];
  let m;
  while ((m = rx.exec(raw)) && dates.length < 2) {
    const idx = MONTH_ABBR.findIndex(x => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) dates.push(new Date(2026, idx, +m[2]));
  }
  if (dates.length < 2) return null;
  if (dates[1] < dates[0]) dates[1].setFullYear(dates[1].getFullYear() + 1);
  const days = Math.round((dates[1] - dates[0]) / 86400000);
  if (days <= 0 || days > 366) return null;
  return days < 21 ? `${days}-day stay` : `${Math.round(days / 7)}-week stay`;
}

/* Human length of a listing window. */
function windowLength(starts, ends) {
  if (!ends) return null;
  const days = Math.round((new Date(ends) - new Date(starts)) / 86400000);
  if (days <= 0) return null;
  if (days < 21) return `${days} days`;
  if (days < 75) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30.4)} months`;
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

/* Avatars are resolved once, server-side (recruit-avatar fn) from the links
   we extract, and stored on the applicant. The client just renders the URL,
   sized + cached through weserv. */
function avatarHtml(a, large) {
  const cls = `avatar ${large ? 'avatar--lg' : ''}`;
  if (!a.avatarUrl) return `<span class="${cls}">${esc(initials(a))}</span>`;
  const px = large ? 112 : 56;
  const src = `https://images.weserv.nl/?url=${encodeURIComponent(a.avatarUrl.replace(/^https:\/\//, ''))}&w=${px}&h=${px}&fit=cover`;
  return `<span class="${cls}">${esc(initials(a))}<img class="avatar__img" src="${esc(src)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

/* Kick server-side resolution for anyone not yet checked (fire-and-forget;
   converges because the fn writes '' for misses). */
async function resolveAvatars() {
  if (!applicants.some(a => a.avatarUrl === null || a.avatarUrl === undefined)) return;
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ backfill: true }),
    });
    const out = await resp.json();
    if (out.resolved) {
      const { data: fresh } = await sb.from('recruit_applicants').select('id, avatar_url');
      for (const row of (fresh || [])) {
        const a = applicants.find(x => x.id === row.id);
        if (a) a.avatarUrl = row.avatar_url;
      }
      if (VIEWS[view]?.kind === 'applicants') renderApplicants();
    }
  } catch (e) { console.warn('avatar resolution failed', e); }
}

/* ---------- data ---------- */
async function loadAll() {
  const [aRes, dRes, cRes, sRes, eRes] = await Promise.all([
    sb.from('recruit_applicants').select('*').order('submitted_at', { ascending: false }),
    sb.from('recruit_decisions').select('*'),
    sb.from('recruit_comments').select('applicant_id'),
    sb.from('recruit_match_suggestions').select('*'),
    sb.from('recruit_emails').select('applicant_id, direction, sent_at').order('sent_at'),
  ]);
  emailState = {};
  for (const e of (eRes.data || [])) {
    const st = (emailState[e.applicant_id] ||= { lastDir: null, lastAt: null, replies: 0 });
    st.lastDir = e.direction; st.lastAt = e.sent_at;
    if (e.direction === 'in') st.replies++;
  }
  suggestions = Object.fromEntries((sRes.data || []).map(r => [r.applicant_id, r]));
  sb.from('recruit_settings').select('*').then(({ data }) => {
    for (const row of (data || [])) settings[row.key] = row.value;
    const box = document.getElementById('pref-couples');
    if (box) box.checked = settings.open_to_couples !== false;
  });
  if (aRes.error) throw aRes.error;
  applicants = (aRes.data || []).map(r => ({
    id: r.id, ts_iso: r.submitted_at,
    first: r.first_name, last: r.last_name, pronouns: r.pronouns,
    email: r.email, social: r.social, about: r.about, why: r.why_agape,
    gifts: r.gifts, source: r.heard_from, residency: r.residency,
    movein: r.move_in, budget: r.budget, avatarUrl: r.avatar_url, scheduleToken: r.schedule_token,
  }));
  decisions = {};
  for (const d of (dRes.data || [])) {
    decisions[d.applicant_id] = { d: d.decision, reason: d.reason, note: d.note || '', listingId: d.listing_id || null, byName: d.decided_by_name, at: d.decided_at };
  }
  commentCounts = {};
  for (const c of (cRes.data || [])) commentCounts[c.applicant_id] = (commentCounts[c.applicant_id] || 0) + 1;
}

async function saveDecision(id, d, reason, byName, note, listingId) {
  if (d === null) {
    delete decisions[id];
    const { error } = await sb.from('recruit_decisions').delete().eq('applicant_id', id);
    if (error) toast(`Save failed: ${error.message}`);
    return;
  }
  const name = byName || me.name;
  const lid = d === 'outreach' ? (listingId || null) : null;
  decisions[id] = { d, reason: reason || null, note: note || '', listingId: lid, byName: name, at: new Date().toISOString() };
  const { error } = await sb.from('recruit_decisions').upsert({
    applicant_id: id, decision: d, reason: reason || null, note: note || '',
    listing_id: lid,
    decided_by: me.id, decided_by_name: name,
    decided_at: new Date().toISOString(),
  });
  if (error) toast(`Save failed: ${error.message}`);
}

const matchInFlight = new Set();

/* Fire the matcher as soon as a reviewer lands on an applicant, so the
   suggestion is on screen before any decision is tapped. */
function ensureMatch(a) {
  const sug = suggestions[a.id];
  const fresh = sug && Date.now() - new Date(sug.created_at || 0).getTime() < 7 * 86400_000;
  if (fresh || matchInFlight.has(a.id)) return;
  matchInFlight.add(a.id);
  computeMatch(a.id).finally(() => {
    matchInFlight.delete(a.id);
    // refresh whichever surface is showing this applicant
    if (queue[qIndex] === a.id) {
      renderReviewMatch(a);
      if (pendingDecision === 'outreach') renderMatchHint(a);
    }
  });
}

/* One shared block: suggestion + soft flags. */
function matchBlockHtml(a) {
  const sug = suggestions[a.id];
  if (!sug) {
    return matchInFlight.has(a.id)
      ? `<p class="match-hint match-hint--empty">Sizing up the open listings…</p>`
      : '';
  }
  const flags = Array.isArray(sug.flags) ? sug.flags : [];
  return `
    <div class="match-hint">
      <span class="match-hint__text"><strong>AI suggests:</strong> ${esc(matchListingLabel(sug))}
        ${sug.confidence ? `<span class="match-hint__conf">${Math.round(sug.confidence * 100)}%</span>` : ''}
        <span class="match-hint__why">${esc(sug.rationale || '')}</span>
      </span>
      <button type="button" class="btn btn--sm" data-use-suggestion="${esc(sug.listing_id || '')}" data-open-outreach>Use</button>
    </div>
    ${flags.map(f => {
      const pref = f.type === 'couple' && settings.open_to_couples === false
        ? ' House preference: not open to couples right now.' : '';
      return `<div class="match-flag ${pref ? 'match-flag--strong' : ''}"><strong>${esc((f.type || 'heads-up'))}:</strong> ${esc((f.message || '') + pref)}</div>`;
    }).join('')}`;
}

function renderReviewMatch(a) {
  const host = document.getElementById('review-ai');
  if (host && queue[qIndex] === a.id) host.innerHTML = matchBlockHtml(a);
}

/* ---------- outreach email drafts ---------- */
let emailApplicantId = null;

async function openEmailModal(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  emailApplicantId = applicantId;
  document.getElementById('email-title').textContent = `Email ${fullName(a)}`;
  document.getElementById('email-subject').value = '';
  document.getElementById('email-body').value = '';
  document.getElementById('email-status').textContent = 'Drafting from their application, the listing, and any flags…';
  document.getElementById('email-modal').hidden = false;
  await generateEmail(applicantId);
}

async function generateEmail(applicantId) {
  document.getElementById('email-status').textContent = 'Drafting…';
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'draft_email', applicantId }),
    });
    const out = await resp.json();
    if (out.error) throw new Error(out.error);
    if (emailApplicantId !== applicantId) return; // closed / switched meanwhile
    document.getElementById('email-subject').value = out.subject || '';
    document.getElementById('email-body').value = out.body || '';
    document.getElementById('email-status').textContent = 'Edit freely, then copy.';
  } catch (e) {
    document.getElementById('email-status').textContent = `Draft failed: ${e.message}`;
  }
}

function closeEmailModal() {
  emailApplicantId = null;
  document.getElementById('email-modal').hidden = true;
}

/* Independent AI read (Sonnet) posted into the house notes for everyone. */
async function requestSecondOpinion(applicantId, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Thinking…'; }
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('No session');
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'second_opinion', applicantId }),
    });
    const out = await resp.json();
    if (out.error) throw new Error(out.error);
    await loadComments(applicantId);
    if (queue[qIndex] === applicantId) renderNotes(applicantId);
    toast('Second opinion added to house notes');
  } catch (e) {
    toast(`Second opinion failed: ${e.message}`);
  } finally {
    if (btn && document.contains(btn)) { btn.disabled = false; btn.textContent = 'Second opinion'; }
  }
}

/* Ask the recruit-match fn to (re)compute one applicant's suggestion. */
async function computeMatch(applicantId) {
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return;
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ applicantId }),
    });
    const out = await resp.json();
    const s = out.suggestions?.[0];
    if (s) suggestions[applicantId] = {
      applicant_id: applicantId, listing_id: s.listingId, confidence: s.confidence,
      rationale: s.rationale, flags: s.flags, created_at: new Date().toISOString(),
    };
  } catch (e) { console.warn('recruit-match failed', e); }
}

/* Short label for what an outreach decision is attached to. */
function attachmentLabel(rec) {
  if (!rec || rec.d !== 'outreach') return '';
  if (!rec.listingId) return 'General interest — future availability';
  const l = listings.find(x => x.id === rec.listingId);
  if (!l) return 'General interest — future availability';
  const room = rooms.find(r => r.id === l.room_id);
  return `${room?.name || 'Room'} — ${l.kind === 'resident' ? 'resident trial' : 'sublet'} from ${fmtDay(l.starts_on)}`;
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

/* ---------- house data ---------- */
async function loadHouse() {
  const [rRes, oRes, lRes] = await Promise.all([
    sb.from('recruit_rooms').select('*').order('sort'),
    sb.from('recruit_occupancy').select('*').order('month'),
    sb.from('recruit_listings').select('*').order('starts_on'),
  ]);
  rooms = rRes.data || [];
  occupancy = oRes.data || [];
  listings = lRes.data || [];
  houseLoaded = true;
}

/* ---------- router ---------- */
function setView(next, push = true) {
  if (next === 'listings') next = 'outreach'; // merged in v2.15
  if (!VIEWS[next]) next = 'inbox';
  view = next;
  if (push) {
    const url = new URL(location);
    url.searchParams.set('view', view);
    url.searchParams.delete('a');
    history.pushState(null, '', url);
  }
  document.getElementById('rail').classList.remove('is-open');
  document.getElementById('rail-scrim').hidden = true;
  render();
}

async function render() {
  const def = VIEWS[view];
  document.getElementById('page-title').textContent = def.title;
  document.getElementById('mobile-title').textContent = def.title;
  document.querySelectorAll('[data-view-link]').forEach(el =>
    el.classList.toggle('is-current', el.dataset.viewLink === view && el.classList.contains('rail-nav__row')));
  renderRailCounts();

  const root = document.getElementById('view-root');
  if ((def.kind === 'house' || view === 'outreach') && !houseLoaded) {
    root.innerHTML = `<p class="inbox-empty">Loading…</p>`;
    await loadHouse();
    if (VIEWS[view].kind !== 'house') return; // navigated away meanwhile
  }
  if (def.kind === 'applicants') renderApplicants();
  else if (view === 'occupancy') renderOccupancy();
}

/* ---------- applicants render ---------- */
function matchesView(a) {
  const rec = decisions[a.id];
  if (view === 'inbox') return !rec;
  if (view === 'archive') return rec?.d === 'pass';
  return rec?.d === view;
}

/* Shared filters — applied on top of whichever applicant view is open. */
function moveInBucket(a) {
  const norm = normalizeMoveIn(a);
  if (!norm) return 'unknown';
  if (/^(ASAP|Flexible)/.test(norm)) return 'flex';
  const m = norm.match(/^([A-Z][a-z]{2})/);
  return m ? m[1] : 'unknown';
}

function budgetBucket(a) {
  const max = budgetMax(a.budget);
  if (max === null) return 'unknown';
  if (max < 2000) return 'lt2000';
  if (max <= 2500) return 'mid';
  return 'gt2500';
}

function matchesFilters(a) {
  if (filters.track === 'fulltime' && isSublet(a)) return false;
  if (filters.track === 'sublet' && !isSublet(a)) return false;
  if (filters.month !== 'any' && moveInBucket(a) !== filters.month) return false;
  if (filters.budget !== 'any' && budgetBucket(a) !== filters.budget) return false;
  return true;
}

function renderFilterBar(viewList) {
  // Move-in month chips reflect what's actually in the current view.
  const monthsPresent = [...new Set(viewList.map(moveInBucket))].filter(b => /^[A-Z]/.test(b));
  monthsPresent.sort((x, y) => MONTH_ABBR.indexOf(x) - MONTH_ABBR.indexOf(y));
  const monthDefs = [['any', 'Any move-in'], ...monthsPresent.map(m => [m, m]), ['flex', 'Flexible']];
  const groups = [
    ['track', [['all', 'Everyone'], ['fulltime', 'Full-time'], ['sublet', 'Sublet']]],
    ['month', monthDefs],
    ['budget', [['any', 'Any budget'], ['lt2000', 'Under $2k'], ['mid', '$2k–2.5k'], ['gt2500', '$2.5k+']]],
  ];
  const active = filters.track !== 'all' || filters.month !== 'any' || filters.budget !== 'any';
  return `<div class="filters">
    ${groups.map(([key, defs]) => `<span class="filters__group">
      ${defs.map(([id, label]) =>
        `<button class="chip ${filters[key] === id ? 'is-on' : ''}" data-fkey="${key}" data-fval="${id}">${label}</button>`).join('')}
    </span>`).join('<span class="filters__sep"></span>')}
    ${active ? `<button class="chip chip--clear" data-fclear>Clear</button>` : ''}
  </div>`;
}

function counts() {
  const c = { inbox: 0, outreach: 0, hold: 0, archive: 0 };
  for (const a of applicants) {
    const rec = decisions[a.id];
    if (!rec) c.inbox++;
    else if (rec.d === 'pass') c.archive++;
    else c[rec.d]++;
  }
  return c;
}

function renderRailCounts() {
  const c = counts();
  for (const key of ['inbox', 'outreach', 'hold', 'archive']) {
    const el = document.getElementById(`count-${key}`);
    if (el) el.textContent = c[key] || '';
  }
}

function decisionChip(id) {
  const rec = decisions[id];
  if (!rec) return '';
  const reason = rec.reason ? ` — ${reasonLabel(rec.reason)}` : '';
  const by = rec.byName ? ` · ${rec.byName}` : '';
  return `<span class="decision-chip decision-chip--${rec.d}" title="${esc(DECISION_LABELS[rec.d] + reason + by)}">${DECISION_LABELS[rec.d]}</span>`;
}

function renderApplicants() {
  const viewList = applicants.filter(matchesView);
  const list = viewList.filter(matchesFilters);
  const filtered = list.length !== viewList.length;
  document.getElementById('page-sub').textContent =
    (filtered ? `${list.length} of ${viewList.length}` : `${viewList.length}`) +
    ` applicant${(filtered ? viewList.length : list.length) === 1 ? '' : 's'}` +
    (view === 'inbox' ? ' to review' : '');

  const host = document.getElementById('view-root');
  host.className = 'inbox';
  const bar = view === 'inbox' ? '' : renderFilterBar(viewList); // inbox stays clean
  if (!list.length) {
    host.innerHTML = bar + `<p class="inbox-empty">${filtered ? 'No applicants match these filters.' : (view === 'inbox' ? 'Inbox zero — every applicant is decided.' : 'Nothing here yet.')}</p>`;
    return;
  }
  // Outreach groups by listing (custom-orderable); other views group by month.
  const groups = [];
  if (view === 'outreach') {
    const byKey = new Map();
    for (const l of listings.filter(x => x.status === 'open')) byKey.set(l.id, []);
    for (const a of list) {
      const key = decisions[a.id]?.listingId || 'general';
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(a);
    }
    const order = Array.isArray(settings.outreach_group_order) ? settings.outreach_group_order : [];
    const keys = [...byKey.keys()].sort((x, y) => {
      const ix = order.indexOf(x), iy = order.indexOf(y);
      return (ix === -1 ? 1e9 : ix) - (iy === -1 ? 1e9 : iy); // unknown groups sink to the bottom
    });
    const rowOrder = (settings.outreach_row_order && typeof settings.outreach_row_order === 'object') ? settings.outreach_row_order : {};
    for (const key of keys) {
      const saved = Array.isArray(rowOrder[key]) ? rowOrder[key] : [];
      const items = byKey.get(key).slice().sort((x, y) => {
        const ix = saved.indexOf(x.id), iy = saved.indexOf(y.id);
        return (ix === -1 ? 1e9 : ix) - (iy === -1 ? 1e9 : iy); // new applicants go to the bottom
      });
      groups.push({ key, items });
    }
  } else {
    for (const a of list) {
      const k = monthKey(a.ts_iso);
      if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, items: [] });
      groups[groups.length - 1].items.push(a);
    }
  }

  const groupHead = g => {
    if (view !== 'outreach') return `<h2 class="inbox-group__label">${monthLabel(g.key)}</h2>`;
    if (g.key === 'general') return `<div class="listing-head__text"><h2 class="inbox-group__label">General interest</h2>
      <span class="inbox-group__count">no room yet — kept warm for future availability</span></div>`;
    const l = listings.find(x => x.id === g.key);
    if (!l) return `<h2 class="inbox-group__label">Listing removed</h2>`;
    const room = rooms.find(r => r.id === l.room_id);
    return `<div class="listing-head__text">
        <h2 class="inbox-group__label">${esc(room?.name || 'Room')}
          <span class="listing-kind listing-kind--${l.kind}">${l.kind === 'resident' ? 'Resident trial' : 'Sublet'}</span>
        </h2>
        <span class="inbox-group__count">${listingWindow(l)}</span>
        ${listingPricing(l) ? `<span class="inbox-group__count listing-row__pricing">${listingPricing(l)}</span>` : ''}
        ${l.notes ? `<span class="inbox-group__count">${esc(l.notes)}</span>` : ''}
      </div>
      <span class="listing-head__actions">
        <button class="btn btn--sm" data-edit-listing="${l.id}">Edit</button>
        <select class="listing-status listing-status--${l.status}" data-listing-status="${l.id}">
          ${['open', 'filled', 'closed'].map(st => `<option value="${st}" ${l.status === st ? 'selected' : ''}>${st[0].toUpperCase()}${st.slice(1)}</option>`).join('')}
        </select>
      </span>`;
  };

  const outreachChrome = view === 'outreach' ? `
    <div class="listing-toolbar">
      <span class="notes__empty">Each open listing is a ranked shortlist — drag rows to reorder.</span>
      <button class="btn btn--sm" data-new-listing>New listing</button>
    </div>` : '';
  const doneListings = view === 'outreach' ? listings.filter(l => l.status !== 'open') : [];
  const doneDrawer = doneListings.length ? `
    <details class="occupants__past">
      <summary>Filled & closed listings (${doneListings.length})</summary>
      <ul class="inbox-card listing-list">
        ${doneListings.map(l => {
          const room = rooms.find(r => r.id === l.room_id);
          return `<li class="inbox-row listing-row is-done">
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(room?.name || 'Room')}
                <span class="listing-kind listing-kind--${l.kind}">${l.kind === 'resident' ? 'Resident trial' : 'Sublet'}</span>
              </span>
              <span class="inbox-row__sub">${listingWindow(l)}</span>
            </span>
            <span class="inbox-row__actions">
              <button class="btn btn--sm inbox-row__review" data-edit-listing="${l.id}">Edit</button>
              <select class="listing-status listing-status--${l.status}" data-listing-status="${l.id}">
                ${['open', 'filled', 'closed'].map(st => `<option value="${st}" ${l.status === st ? 'selected' : ''}>${st[0].toUpperCase()}${st.slice(1)}</option>`).join('')}
              </select>
            </span>
          </li>`;
        }).join('')}
      </ul>
    </details>` : '';
  const outreachHint = view === 'outreach' ? `<p class="listing-hint">Listings also come from the <a href="?view=occupancy" data-view-link="occupancy">Occupancy calendar</a>: click an open stretch, or mark a resident as leaving.</p>` : '';

  host.innerHTML = bar + outreachChrome + groups.map(g => `
    <section class="inbox-group ${view === 'outreach' && g.key !== 'general' ? 'listing-group' : ''}" ${view === 'outreach' ? `data-group-key="${esc(g.key)}"` : ''}>
      <div class="inbox-group__head ${view === 'outreach' ? 'listing-head' : ''}">
        ${groupHead(g)}
        <span class="inbox-group__count listing-head__n">${g.items.length} applicant${g.items.length === 1 ? '' : 's'}</span>
      </div>
      ${view === 'outreach' && !g.items.length ? `<p class="inbox-empty inbox-empty--group">No one attached yet — add applicants via Review → Add to listing.</p>` : `<ul class="inbox-card">
        ${g.items.map(a => `
          <li class="inbox-row" ${view === 'outreach' ? `draggable="true" data-row-id="${a.id}" data-row-group="${esc(g.key)}"` : ''}>
            ${view === 'outreach' ? '<span class="inbox-row__grip" title="Drag to reorder">⠿</span>' : ''}
            <button class="inbox-row__main" data-review="${a.id}">
              ${avatarHtml(a)}
              <span class="inbox-row__text">
                <span class="inbox-row__title">${esc(fullName(a))}</span>
                <span class="inbox-row__sub">${esc(subLine(a))} · applied ${fmtDate(a.ts_iso)}</span>
                ${view === 'outreach' && decisions[a.id] && !decisions[a.id].listingId && suggestions[a.id]?.listing_id ? `<span class="inbox-row__sub inbox-row__ai">AI suggests ${esc(matchListingLabel(suggestions[a.id]))} — open to apply</span>` : ''}
              </span>
            </button>
            <span class="inbox-row__actions">
              ${emailState[a.id]?.lastDir === 'in' ? `<span class="decision-chip decision-chip--replied" title="They replied — last message ${relTime(emailState[a.id].lastAt)}">↙ Replied</span>` : (view === 'outreach' && emailState[a.id]?.lastDir === 'out' ? `<span class="note-count" title="Waiting on their reply">sent ${relTime(emailState[a.id].lastAt)}</span>` : '')}
              ${commentCounts[a.id] ? `<span class="note-count" title="${commentCounts[a.id]} house note${commentCounts[a.id] === 1 ? '' : 's'}">✎ ${commentCounts[a.id]}</span>` : ''}
              ${view === 'outreach' ? `<button class="btn inbox-row__review" data-email="${a.id}">Send email</button>` : `${decisionChip(a.id)}<button class="btn inbox-row__review" data-review="${a.id}">Review</button>`}
            </span>
          </li>`).join('')}
      </ul>`}
    </section>`).join('') + doneDrawer + outreachHint;
  if (view === 'outreach') wireRowDrag(host);
}

/* Drag-to-reorder applicants inside each listing group; shared house state. */
let dragRow = null; // { id, group }
function wireRowDrag(host) {
  host.querySelectorAll('.inbox-row[data-row-id]').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragRow = { id: row.dataset.rowId, group: row.dataset.rowGroup };
      row.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => { row.classList.remove('is-dragging'); dragRow = null; });
    row.addEventListener('dragover', e => {
      if (dragRow && row.dataset.rowGroup === dragRow.group) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragRow || row.dataset.rowGroup !== dragRow.group || row.dataset.rowId === dragRow.id) return;
      const group = dragRow.group;
      const ids = [...host.querySelectorAll(`.inbox-row[data-row-group="${CSS.escape(group)}"]`)].map(x => x.dataset.rowId);
      ids.splice(ids.indexOf(row.dataset.rowId), 0, ids.splice(ids.indexOf(dragRow.id), 1)[0]);
      const rowOrder = (settings.outreach_row_order && typeof settings.outreach_row_order === 'object') ? settings.outreach_row_order : {};
      rowOrder[group] = ids;
      settings.outreach_row_order = rowOrder;
      sb.from('recruit_settings').upsert({
        key: 'outreach_row_order', value: rowOrder,
        updated_by_name: me?.name || null, updated_at: new Date().toISOString(),
      }).then(({ error }) => { if (error) toast(`Order save failed: ${error.message}`); });
      renderApplicants();
    });
  });
}

/* ---------- occupancy ---------- */
const KIND_LABELS = { resident: 'Resident', sublet: 'Sublet (short-term)', candidate: 'Trial candidate', shared: 'Shared', vacant: 'Open' };

/* Google-Calendar-style lanes: one row per room, continuous colored spans
   per occupant stretch (not spreadsheet cells), month gridlines + today rule. */
function occupancySegments(roomId) {
  const months = [...Array(12)].map((_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`);
  const byMonth = {};
  for (const o of occupancy) if (o.room_id === roomId) byMonth[o.month] = o;
  const segs = [];
  for (let i = 0; i < 12; i++) {
    const cell = byMonth[months[i]];
    const kind = cell?.kind || 'vacant';
    const label = (cell?.occupant || '').trim();
    const last = segs[segs.length - 1];
    if (last && last.kind === kind && last.label === label) last.len++;
    else segs.push({ start: i, len: 1, kind, label, month: months[i] });
  }
  return segs;
}

let editingSegment = null;   // { roomId, start, len, kind, label } while the editor is open

function renderOccupancy() {
  const host = document.getElementById('view-root');
  host.className = 'house';
  document.getElementById('page-sub').textContent =
    `${rooms.length} rooms · 2026 · every name is a resident or a subletter`;

  const now = new Date();
  const nowIdx = now.getFullYear() === 2026 ? now.getMonth() : (now.getFullYear() < 2026 ? -1 : 12);
  const todayPct = nowIdx >= 0 && nowIdx < 12
    ? ((nowIdx + (now.getDate() - 1) / 31) / 12) * 100 : null;

  host.innerHTML = `
    <div class="occ-legend">
      ${['resident', 'sublet', 'candidate', 'vacant'].map(k =>
        `<span class="occ-legend__item"><span class="occ-swatch occ-swatch--${k}"></span>${KIND_LABELS[k]}</span>`).join('')}
      <span class="occ-legend__hint">Click any bar to adjust dates, change who's in the room, or mark a resident as leaving</span>
    </div>
    <div class="cal">
      <div class="cal__head">
        <div class="cal__room-col"></div>
        <div class="cal__months">
          ${MONTH_ABBR.map((m, i) => `<span class="cal__month ${i === nowIdx ? 'is-now' : ''}">${m}</span>`).join('')}
        </div>
      </div>
      <div class="cal__body">
        ${todayPct !== null ? `<span class="cal__today" style="left: calc(var(--room-col) + (100% - var(--room-col)) * ${todayPct / 100})"></span>` : ''}
        ${rooms.map(r => `
          <div class="cal__row">
            <div class="cal__room-col">
              <span class="occ__room-name">${esc(r.name)}</span>
              <span class="occ__room-sub">${esc(r.floor)}${r.resident ? ` · ${esc(r.resident)}` : ' · open room'}</span>
            </div>
            <div class="cal__lane">
              ${occupancySegments(r.id).map(s => {
                const style = `left: ${(s.start / 12) * 100}%; width: ${(s.len / 12) * 100}%`;
                const title = s.kind === 'vacant'
                  ? 'Open — click to edit or list'
                  : `${s.label} · ${KIND_LABELS[s.kind]} · ${MONTH_ABBR[s.start]}${s.len > 1 ? `–${MONTH_ABBR[s.start + s.len - 1]}` : ''} · click to edit`;
                const active = editingSegment && editingSegment.roomId === r.id && editingSegment.start === s.start;
                return `<button type="button" class="cal__event cal__event--${s.kind} ${active ? 'is-editing' : ''}"
                  style="${style}" title="${esc(title)}"
                  data-seg-room="${r.id}" data-seg-start="${s.start}" data-seg-len="${s.len}">
                  ${s.kind === 'vacant' ? 'Open' : esc(s.label)}</button>`;
              }).join('')}
            </div>
          </div>`).join('')}
      </div>
    </div>
    <div id="seg-editor">${editingSegment ? segmentEditorHtml() : ''}</div>
    ${occupantsHtml()}`;

  const segForm = host.querySelector('[data-seg-form]');
  if (segForm) {
    segForm.addEventListener('submit', onSegmentSave);
    segForm.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* --- segment editor: adjust who is in the room and for which months --- */
function segmentEditorHtml() {
  const { roomId, start, len, kind, label } = editingSegment;
  const room = rooms.find(r => r.id === roomId);
  const monthOpts = sel => MONTH_ABBR.map((m, i) =>
    `<option value="${i}" ${i === sel ? 'selected' : ''}>${m} 2026</option>`).join('');
  return `<form class="listing-form seg-form" data-seg-form>
    <div class="seg-form__head">
      <strong>${esc(room?.name || 'Room')}</strong>
      <span class="occ__room-sub">${MONTH_ABBR[start]}–${MONTH_ABBR[start + len - 1]} 2026</span>
    </div>
    <div class="listing-form__grid">
      <label class="listing-form__field">Who
        <input type="text" name="occupant" class="listing-status" value="${esc(kind === 'vacant' ? '' : label)}" placeholder="Empty = open">
      </label>
      <label class="listing-form__field">Type
        <select name="kind" class="listing-status">
          ${['resident', 'sublet', 'candidate', 'shared', 'vacant'].map(k =>
            `<option value="${k}" ${kind === k ? 'selected' : ''}>${KIND_LABELS[k]}</option>`).join('')}
        </select>
      </label>
      <label class="listing-form__field">From
        <select name="from" class="listing-status">${monthOpts(start)}</select>
      </label>
      <label class="listing-form__field">Through
        <select name="to" class="listing-status">${monthOpts(start + len - 1)}</select>
      </label>
    </div>
    <p class="listing-form__error" data-form-error></p>
    <div class="decision-sheet__actions seg-form__actions">
      ${kind === 'resident' ? `<button type="button" class="listing-form__delete" data-seg-leaving="${roomId}" data-seg-month="${start}">Mark leaving — list this room</button>` : ''}
      ${kind === 'vacant' ? `<button type="button" class="listing-form__delete seg-form__list" data-list-room="${roomId}" data-list-month="2026-${String(start + 1).padStart(2, '0')}-01">Create listing for this stretch</button>` : ''}
      <button type="button" class="hold-sheet__cancel" data-seg-cancel>Cancel</button>
      <button type="submit" class="btn btn--accent btn--sm">Save months</button>
    </div>
  </form>`;
}

async function onSegmentSave(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const seg = editingSegment;
  const from = +fd.get('from'), to = +fd.get('to');
  const err = e.target.querySelector('[data-form-error]');
  if (to < from) { err.textContent = '"Through" must be at or after "From".'; return; }
  const occupant = (fd.get('occupant') || '').trim();
  let kind = fd.get('kind');
  if (!occupant && kind !== 'shared') kind = 'vacant';
  if (occupant && kind === 'vacant') kind = 'sublet';

  // months inside the new range take the values; months freed up become open
  const monthKeyOf = i => `2026-${String(i + 1).padStart(2, '0')}-01`;
  const rows = [];
  for (let i = Math.min(from, seg.start); i <= Math.max(to, seg.start + seg.len - 1); i++) {
    const inNew = i >= from && i <= to;
    rows.push({
      room_id: seg.roomId, month: monthKeyOf(i),
      occupant: inNew ? occupant : '',
      kind: inNew ? kind : 'vacant',
    });
  }
  const { error } = await sb.from('recruit_occupancy').upsert(rows, { onConflict: 'room_id,month' });
  if (error) { err.textContent = error.message; return; }
  for (const row of rows) {
    const existing = occupancy.find(o => o.room_id === row.room_id && o.month === row.month);
    if (existing) Object.assign(existing, row); else occupancy.push(row);
  }
  editingSegment = null;
  toast('Occupancy updated');
  renderOccupancy();
}

/* --- current + past occupants --- */
function occupantsHtml() {
  const now = new Date();
  const nowKey = `2026-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
  const current = occupancy
    .filter(o => o.month === nowKey && o.kind !== 'vacant' && o.occupant)
    .sort((a, b) => (roomById[a.room_id]?.sort || 0) - (roomById[b.room_id]?.sort || 0));

  const currentNames = new Set(current.map(o => o.occupant.toLowerCase()));
  const pastMap = new Map(); // occupant label -> { rooms:Set, last:monthIdx }
  for (const o of occupancy) {
    if (o.month >= nowKey || o.kind === 'vacant' || o.kind === 'shared' || !o.occupant) continue;
    if (currentNames.has(o.occupant.toLowerCase())) continue;
    const rec = pastMap.get(o.occupant) || { rooms: new Set(), last: 0 };
    rec.rooms.add(roomById[o.room_id]?.name || '');
    rec.last = Math.max(rec.last, +o.month.slice(5, 7) - 1);
    pastMap.set(o.occupant, rec);
  }
  const past = [...pastMap.entries()].sort((a, b) => b[1].last - a[1].last);

  return `
    <section class="inbox-group occupants">
      <div class="inbox-group__head">
        <h2 class="inbox-group__label">Current occupants</h2>
        <span class="inbox-group__count">${current.length} this month</span>
      </div>
      <ul class="inbox-card">
        ${current.map(o => {
          const room = roomById[o.room_id];
          return `<li class="inbox-row">
            <span class="avatar">${esc((o.occupant[0] || '?').toUpperCase())}</span>
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(o.occupant)}</span>
              <span class="inbox-row__sub">${esc(room?.name || '')} · ${esc(room?.floor || '')}</span>
            </span>
            <span class="inbox-row__actions">
              <span class="listing-kind listing-kind--${o.kind === 'candidate' ? 'trial' : (o.kind === 'resident' ? 'resident' : 'sublet')}">${KIND_LABELS[o.kind]}</span>
            </span>
          </li>`;
        }).join('')}
      </ul>
      ${past.length ? `<details class="occupants__past">
        <summary>Past occupants this year (${past.length})</summary>
        <ul class="inbox-card">
          ${past.map(([name, rec]) => `<li class="inbox-row">
            <span class="avatar">${esc((name[0] || '?').toUpperCase())}</span>
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(name)}</span>
              <span class="inbox-row__sub">${esc([...rec.rooms].filter(Boolean).join(', '))} · through ${MONTH_ABBR[rec.last]} 2026</span>
            </span>
          </li>`).join('')}
        </ul>
      </details>` : ''}
    </section>`;
}

async function createListingFromCell(roomId, month) {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  const pretty = new Date(month + 'T12:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (!confirm(`Create a sublet listing for ${room.name} starting ${pretty}?`)) return;
  const { data, error } = await sb.from('recruit_listings').insert({
    room_id: roomId, kind: 'sublet', starts_on: month, status: 'open',
    source: 'gap', notes: `Created from the occupancy calendar (${pretty} open).`,
    created_by: me.id, created_by_name: me.name,
  }).select().single();
  if (error) { toast(`Listing failed: ${error.message}`); return; }
  listings.push(data);
  toast(`Listing created — ${room.name}, ${pretty}`);
  editingSegment = null;
  renderOccupancy();
  renderRailCounts();
}

async function markLeaving(roomId, defaultDate) {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  const when = prompt(`Mark ${room.resident || 'the resident'} as leaving ${room.name}.\nRoom opens from (YYYY-MM-DD):`,
    defaultDate || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10));
  if (!when || !/^\d{4}-\d{2}-\d{2}$/.test(when)) return;
  const { data, error } = await sb.from('recruit_listings').insert({
    room_id: roomId, kind: 'resident', starts_on: when, status: 'open',
    source: 'leaving', notes: `${room.resident || 'Resident'} marked as leaving.`,
    created_by: me.id, created_by_name: me.name,
  }).select().single();
  if (error) { toast(`Listing failed: ${error.message}`); return; }
  listings.push(data);
  toast(`${room.resident || 'Resident'} marked leaving — resident listing created for ${room.name}`);
  setView('outreach');
}

/* ---------- listings ---------- */
function fmtDay(d) {
  return new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/* A listing is a time-bound opening for a room: either a sublet of a
   resident's room (3 months or less) or a 3-month resident trial. */
let editingListingId = null;   // listing id, 'new', or null

function listingPricing(l) {
  const parts = [];
  if (l.rent_monthly != null) parts.push(`$${Number(l.rent_monthly).toLocaleString()} rent`);
  if (l.dues_monthly != null) parts.push(`$${Number(l.dues_monthly).toLocaleString()} house dues`);
  if (l.groceries_monthly != null) parts.push(`$${Number(l.groceries_monthly).toLocaleString()} groceries`);
  return parts.join(' + ');
}

function listingWindow(l) {
  const len = windowLength(l.starts_on, l.ends_on);
  if (l.kind === 'resident') {
    const trialEnd = new Date(l.starts_on + 'T12:00'); trialEnd.setMonth(trialEnd.getMonth() + 3);
    return `Trial ${fmtDay(l.starts_on)} – ${fmtDay(trialEnd.toISOString().slice(0, 10))} · 3-month trial, then house vote`;
  }
  return (l.ends_on ? `${fmtDay(l.starts_on)} – ${fmtDay(l.ends_on)}` : `From ${fmtDay(l.starts_on)} · end date TBD`) + (len ? ` · ${len}` : '');
}

function listingForm(l) {
  const isNew = !l.id;
  return `<form class="listing-form" data-listing-form="${l.id || 'new'}">
    <div class="listing-form__grid">
      <label class="listing-form__field">Room
        <select name="room_id" class="listing-status">${rooms.map(r =>
          `<option value="${r.id}" ${+l.room_id === r.id ? 'selected' : ''}>${esc(r.name)}${r.resident ? ` — ${esc(r.resident)}` : ''}</option>`).join('')}</select>
      </label>
      <label class="listing-form__field">Type
        <select name="kind" class="listing-status">
          <option value="sublet" ${l.kind !== 'resident' ? 'selected' : ''}>Sublet (≤ 3 months)</option>
          <option value="resident" ${l.kind === 'resident' ? 'selected' : ''}>Resident (3-month trial)</option>
        </select>
      </label>
      <label class="listing-form__field">Opens
        <input type="date" name="starts_on" class="listing-status" value="${l.starts_on || ''}" required>
      </label>
      <label class="listing-form__field">Sublet ends
        <input type="date" name="ends_on" class="listing-status" value="${l.ends_on || ''}">
      </label>
      <label class="listing-form__field">Rent / mo
        <input type="number" name="rent_monthly" class="listing-status" min="0" max="10000" step="5" value="${l.rent_monthly ?? ''}" placeholder="1490">
      </label>
      <label class="listing-form__field">House dues / mo
        <input type="number" name="dues_monthly" class="listing-status" min="0" max="5000" step="5" value="${l.dues_monthly ?? ''}" placeholder="0">
      </label>
      <label class="listing-form__field">Groceries / mo
        <input type="number" name="groceries_monthly" class="listing-status" min="0" max="5000" step="5" value="${l.groceries_monthly ?? ''}" placeholder="210">
      </label>
    </div>
    <label class="listing-form__field">Notes
      <textarea name="notes" class="notes__input listing-form__notes" rows="2" maxlength="1000">${esc(l.notes || '')}</textarea>
    </label>
    <p class="listing-form__error" data-form-error></p>
    <div class="decision-sheet__actions">
      ${isNew ? '' : `<button type="button" class="listing-form__delete" data-delete-listing="${l.id}">Delete listing</button>`}
      <button type="button" class="hold-sheet__cancel" data-cancel-listing>Cancel</button>
      <button type="submit" class="btn btn--accent btn--sm">${isNew ? 'Create listing' : 'Save changes'}</button>
    </div>
  </form>`;
}

function openListingModal(idOrNew) {
  editingListingId = idOrNew;
  const l = idOrNew === 'new'
    ? { kind: 'sublet', room_id: rooms[0]?.id }
    : listings.find(x => x.id === idOrNew) || {};
  const body = document.getElementById('listing-modal-body');
  body.innerHTML = `
    <div class="email-modal__head">
      <h3 class="email-modal__title">${idOrNew === 'new' ? 'New listing' : 'Edit listing'}</h3>
      <button class="review__close email-modal__close" data-cancel-listing aria-label="Close">✕</button>
    </div>
    <p class="notes__empty">A listing is a sublet (≤ 3 months) of a resident's room, or a 3-month resident trial.</p>
    ${listingForm(l)}`;
  document.getElementById('listing-modal').hidden = false;
  body.querySelector('[data-listing-form]').addEventListener('submit', onListingSubmit);
}

function closeListingModal() {
  editingListingId = null;
  document.getElementById('listing-modal').hidden = true;
}

function rerenderAfterListingChange() {
  closeListingModal();
  renderRailCounts();
  if (view === 'outreach') renderApplicants();
  else if (view === 'occupancy') renderOccupancy();
}

async function onListingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.dataset.listingForm;
  const fd = new FormData(form);
  const num = k => { const v = fd.get(k); return v === '' || v === null ? null : Math.round(+v); };
  const rec = {
    room_id: +fd.get('room_id'),
    kind: fd.get('kind'),
    starts_on: fd.get('starts_on'),
    ends_on: fd.get('ends_on') || null,
    rent_monthly: num('rent_monthly'),
    dues_monthly: num('dues_monthly'),
    groceries_monthly: num('groceries_monthly'),
    notes: (fd.get('notes') || '').trim(),
  };
  const err = form.querySelector('[data-form-error]');
  if (!rec.starts_on) { err.textContent = 'Start date is required.'; return; }
  if (rec.kind === 'resident') rec.ends_on = null; // trial length is fixed at 3 months
  if (rec.kind === 'sublet' && rec.ends_on) {
    const days = (new Date(rec.ends_on) - new Date(rec.starts_on)) / 86400000;
    if (days <= 0) { err.textContent = 'End date must be after the start.'; return; }
    if (days > 95) { err.textContent = 'A sublet runs 3 months or less — longer stays are a resident trial.'; return; }
  }
  if (id === 'new') {
    const { data, error } = await sb.from('recruit_listings').insert({
      ...rec, status: 'open', source: 'manual', created_by: me.id, created_by_name: me.name,
    }).select().single();
    if (error) { err.textContent = error.message; return; }
    listings.push(data);
    toast('Listing created');
  } else {
    const { error } = await sb.from('recruit_listings').update(rec).eq('id', id);
    if (error) { err.textContent = error.message; return; }
    Object.assign(listings.find(l => l.id === id) || {}, rec);
    toast('Listing updated');
  }
  rerenderAfterListingChange();
}

async function deleteListing(id) {
  const l = listings.find(x => x.id === id);
  const room = rooms.find(r => r.id === l?.room_id);
  if (!confirm(`Delete the ${l?.kind === 'resident' ? 'resident trial' : 'sublet'} listing for ${room?.name || 'this room'}?`)) return;
  const { error } = await sb.from('recruit_listings').delete().eq('id', id);
  if (error) { toast(`Delete failed: ${error.message}`); return; }
  listings = listings.filter(x => x.id !== id);
  toast('Listing deleted');
  rerenderAfterListingChange();
}

async function updateListingStatus(id, status) {
  const l = listings.find(x => x.id === id);
  if (!l) return;
  const prev = l.status;
  l.status = status;
  const { error } = await sb.from('recruit_listings').update({ status }).eq('id', id);
  if (error) { l.status = prev; toast(`Update failed: ${error.message}`); }
  rerenderAfterListingChange();
}

/* ---------- review overlay ---------- */
function openReview(id) {
  queue = applicants.filter(a => matchesView(a) && matchesFilters(a)).map(a => a.id);
  if (!queue.includes(id)) queue = applicants.map(a => a.id);
  qIndex = Math.max(0, queue.indexOf(id));
  reviewTab = 'profile';
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
  render();
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
    ${rec ? `<div class="decision-banner decision-banner--${rec.d}">
      <div class="decision-banner__text">
        <span class="decision-banner__label">${DECISION_LABELS[rec.d]}</span>
        <span class="decision-banner__meta">${rec.reason ? esc(reasonLabel(rec.reason)) : 'No reason recorded'}${rec.byName ? ` · by ${esc(rec.byName)}` : ''}${rec.at ? ` · ${fmtDate(rec.at)}` : ''}</span>
        ${rec.d === 'outreach' ? `<span class="decision-banner__meta">→ ${esc(attachmentLabel(rec))}</span>` : ''}
        ${rec.note ? `<span class="decision-banner__note">“${esc(rec.note)}”</span>` : ''}
      </div>
      <span class="decision-banner__actions">
        <button class="decision-banner__undo" data-edit-decision="${a.id}">Edit</button>
        <button class="decision-banner__undo" data-clear="${a.id}">Undo</button>
      </span>
    </div>` : ''}
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
            <div class="review__fact"><span class="review__fact-label">Move-in</span><span class="review__fact-value">${esc(miNorm || a.movein || '—')}${isSublet(a) && stayLength(a) ? ` · ${stayLength(a)}` : ''} ${infoDot(a.movein, miNorm)}</span></div>
            <div class="review__fact"><span class="review__fact-label">Budget</span><span class="review__fact-value">${esc(buNorm || a.budget || '—')} ${infoDot(a.budget, buNorm)}</span></div>
            <div class="review__fact"><span class="review__fact-label">Applied</span><span class="review__fact-value">${new Date(a.ts_iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
            ${linksHtml ? `<div class="review__fact"><span class="review__fact-label">Links</span>${linksHtml}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="review-tabs">
      <button class="review-tabs__tab ${reviewTab === 'profile' ? 'is-on' : ''}" data-review-tab="profile">Profile</button>
      <button class="review-tabs__tab ${reviewTab === 'emails' ? 'is-on' : ''}" data-review-tab="emails">Emails${(emailsCache[a.id] || []).length ? ` (${emailsCache[a.id].length})` : ''}</button>
    </div>
    ${reviewTab === 'emails' ? `<div id="emails-panel"><p class="notes__empty">Loading emails…</p></div>` : `
    <div id="review-ai">${matchBlockHtml(a)}</div>
    ${section('About them', a.about)}
    ${section('Why Agape', a.why)}
    ${section('Gifts to share', a.gifts)}
    <section class="review__section notes" id="notes">
      <div class="notes__head">
        <h3 class="review__section-title">House notes</h3>
        <button type="button" class="btn btn--sm" id="second-opinion" data-second-opinion="${a.id}">Second opinion</button>
      </div>
      <div id="notes-body"><p class="notes__empty">Loading notes…</p></div>
      <form class="notes__form" id="notes-form">
        <textarea class="notes__input" id="notes-input" placeholder="Add an internal note for the house — only Recruiting Society members see these." maxlength="4000"></textarea>
        <button class="btn btn--accent btn--sm notes__submit" type="submit">Add note</button>
      </form>
    </section>`}
  `;

  for (const d of ['pass', 'hold', 'outreach']) {
    const btn = document.getElementById(`btn-${d}`);
    btn.classList.toggle(`is-active--${d}`, rec?.d === d);
  }

  if (reviewTab === 'emails') loadEmailsPanel(a);
  if (houseLoaded) ensureMatch(a);
  else loadHouse().then(() => { houseLoaded = true; ensureMatch(a); renderReviewMatch(a); });
  loadComments(a.id).then(() => {
    // guard against navigating away while the query was in flight
    if (queue[qIndex] === a.id) renderNotes(a.id);
  });
  document.getElementById('notes-form')?.addEventListener('submit', e => {
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

/* ---------- emails panel ---------- */
function emailRow(m) {
  const arrow = m.direction === 'out' ? '↗' : '↙';
  const who = m.direction === 'out' ? `Agape${m.sent_by_name ? ` (${esc(m.sent_by_name)})` : ''}` : esc(m.from_email.replace(/<.*>/, '').trim() || m.from_email);
  return `<li class="email-row email-row--${m.direction}">
    <span class="email-row__dir" title="${m.direction === 'out' ? 'Sent by the house' : 'Received'}">${arrow}</span>
    <span class="inbox-row__text">
      <span class="inbox-row__title">${esc(m.subject || '(no subject)')}</span>
      <span class="inbox-row__sub">${who} · ${new Date(m.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${m.snippet ? ` — ${esc(m.snippet.slice(0, 110))}` : ''}</span>
    </span>
  </li>`;
}

async function loadEmailsPanel(a) {
  const host = () => document.getElementById('emails-panel');
  if (!host()) return;
  if (!gmailStatus.connected) {
    host().innerHTML = `
      <div class="match-hint">
        <span class="match-hint__text"><strong>Shared inbox not connected.</strong>
          <span class="match-hint__why">All applicant email runs through live.at.agapesf@gmail.com. Connect it once (you must be signed into that Google account in this browser).</span>
        </span>
        <button type="button" class="btn btn--sm" id="gmail-connect">Connect</button>
      </div>`;
    document.getElementById('gmail-connect').onclick = connectSharedGmail;
    return;
  }
  host().innerHTML = `<p class="notes__empty">Syncing with the shared inbox…</p>`;
  try {
    const out = await gmailCall({ action: 'sync', applicantId: a.id });
    emailsCache[a.id] = out.emails || [];
    availCache[a.id] = out.availability || null;
    screeningsCache[a.id] = out.screenings || [];
    if (queue[qIndex] !== a.id || reviewTab !== 'emails' || !host()) return;
    host().innerHTML = `
      ${schedulingHtml(a)}
      <div class="emails-toolbar">
        <span class="notes__empty">${emailsCache[a.id].length} message${emailsCache[a.id].length === 1 ? '' : 's'} with ${esc(a.email)}</span>
        <span class="emails-toolbar__actions">
          ${a.scheduleToken ? `<button type="button" class="btn btn--sm" data-copy-schedule="${a.id}">Copy availability link</button>` : ''}
          <button type="button" class="btn btn--sm" data-email="${a.id}">Compose</button>
        </span>
      </div>
      ${emailsCache[a.id].length ? `<ul class="inbox-card email-list">${emailsCache[a.id].map(emailRow).join('')}</ul>`
        : `<p class="inbox-empty">No emails yet — Compose starts the thread through the shared account.</p>`}`;
  } catch (e) {
    if (host()) host().innerHTML = `<p class="notes__empty">Email sync failed: ${esc(e.message)}</p>`;
  }
}

/* ---------- screening scheduler ---------- */
function fmtSlot(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function windowSlots(w) {
  // 30-min start times within the offered window (last start 30m before end)
  const slots = [];
  const start = new Date(`${w.date}T${w.start}:00`);
  const end = new Date(`${w.date}T${w.end}:00`);
  for (let t = start.getTime(); t + 30 * 60000 <= end.getTime(); t += 30 * 60000) {
    if (t > Date.now()) slots.push(new Date(t));
  }
  return slots.slice(0, 16);
}

function schedulingHtml(a) {
  const screenings = (screeningsCache[a.id] || []).filter(x => x.status === 'scheduled');
  const avail = availCache[a.id];
  const parts = [];
  for (const sc of screenings) {
    parts.push(`<div class="match-hint screening-card">
      <span class="match-hint__text"><strong>Screening call scheduled</strong>
        <span class="match-hint__why">${fmtSlot(sc.starts_at)} with ${esc(sc.housemate_name || 'a housemate')} · invites sent to both${sc.meet_link ? ` · <a href="${esc(sc.meet_link)}" target="_blank" rel="noopener">Meet link</a>` : ''}</span>
      </span>
    </div>`);
  }
  if (!screenings.length && avail?.windows?.length) {
    parts.push(`<div class="avail-card">
      <p class="avail-card__title">They offered availability — pick a time and both get a calendar invite:</p>
      ${avail.windows.map((w, i) => `
        <div class="avail-card__window">
          <span class="avail-card__range">${new Date(w.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${w.start}–${w.end}</span>
          <span class="avail-card__slots">${windowSlots(w).map(d =>
            `<button type="button" class="chip" data-slot="${d.toISOString()}" data-slot-applicant="${a.id}">${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</button>`).join('') || '<span class="notes__empty">window already passed</span>'}</span>
        </div>`).join('')}
    </div>`);
  } else if (!screenings.length) {
    parts.push(`<p class="notes__empty">No availability captured yet — when they reply with days/times, windows appear here automatically.</p>`);
  }
  return parts.join('');
}

async function scheduleSlot(applicantId, iso, btn) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  if (!confirm(`Book the screening call for ${fmtSlot(iso)} (30 min)?\nCalendar invites go to ${a.email} and you.`)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Booking…'; }
  try {
    const out = await gmailCall({ action: 'schedule', applicantId, startsAt: iso, minutes: 30 });
    (screeningsCache[applicantId] ||= []).unshift(out.screening);
    toast('Screening call booked — invites sent to both');
    if (queue[qIndex] === applicantId && reviewTab === 'emails') loadEmailsPanel(a);
  } catch (e) {
    toast(`Booking failed: ${e.message}`);
    if (btn) { btn.disabled = false; }
  }
}

/* ---------- decision sheet ----------
   Every decision asks for a multiple-choice reason plus an optional freeform
   note — typed, dictated (Web Speech), or pulled from the house notes. */
let pendingDecision = null;   // 'outreach' | 'hold' | 'pass' while the sheet is open
let pendingReason = null;
let sheetMode = 'decide';     // 'decide' advances the queue on save; 'edit' stays put
let dictation = null;         // active SpeechRecognition instance

async function openDecisionSheet(d, mode = 'decide') {
  sheetMode = mode;
  return _openDecisionSheet(d);
}

async function _openDecisionSheet(d) {
  const a = applicants.find(x => x.id === queue[qIndex]);
  if (!a) return;
  pendingDecision = d;
  const rec = decisions[a.id];
  pendingReason = (rec?.d === d ? rec.reason : null) || null;
  document.getElementById('decision-sheet-title').textContent =
    d === 'outreach' ? 'Add to a listing' : d === 'hold' ? 'Future fit — why not now?' : 'Not a fit — why?';
  renderDecisionOptions();

  // Outreach targets a specific open listing, or General interest.
  const attachWrap = document.getElementById('decision-attach-wrap');
  attachWrap.hidden = d !== 'outreach';
  if (d === 'outreach') {
    if (!houseLoaded) await loadHouse();
    const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
    const open = listings.filter(l => l.status === 'open');
    document.getElementById('decision-listing').innerHTML =
      `<option value="">General interest — future availability</option>` +
      open.map(l => `<option value="${l.id}" ${rec?.listingId === l.id ? 'selected' : ''}>` +
        `${esc(roomById[l.room_id]?.name || 'Room')} — ${l.kind === 'resident' ? 'resident trial' : 'sublet'} from ${fmtDay(l.starts_on)}</option>`).join('');
    renderMatchHint(a);
  } else {
    document.getElementById('decision-ai').innerHTML = '';
  }
  const noteEl = document.getElementById('decision-note');
  noteEl.value = (rec?.d === d ? rec.note : '') || '';
  document.getElementById('decision-use-notes').hidden = !comments.length;
  document.getElementById('decision-mic').hidden =
    !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  document.getElementById('decision-sheet').hidden = false;
  document.getElementById('review-foot').hidden = true;
}

function matchListingLabel(sug) {
  if (!sug?.listing_id) return 'General interest — future availability';
  const l = listings.find(x => x.id === sug.listing_id);
  const room = rooms.find(r => r.id === l?.room_id);
  return l ? `${room?.name || 'Room'} — ${l.kind === 'resident' ? 'resident trial' : 'sublet'} from ${fmtDay(l.starts_on)}` : 'General interest — future availability';
}

function renderMatchHint(a) {
  document.getElementById('decision-ai').innerHTML =
    matchBlockHtml(a) || `<p class="match-hint match-hint--empty">Sizing up the open listings…</p>`;
}

function renderDecisionOptions() {
  document.getElementById('decision-options').innerHTML =
    (DECISION_REASONS[pendingDecision] || []).map(r =>
      `<button class="hold-sheet__option ${pendingReason === r.id ? 'is-selected' : ''}" data-reason="${r.id}">${r.label}</button>`).join('');
}

function hideDecisionSheet() {
  stopDictation();
  pendingDecision = null;
  pendingReason = null;
  sheetMode = 'decide';
  document.getElementById('decision-sheet').hidden = true;
  document.getElementById('review-foot').hidden = false;
}
const hideHoldSheet = hideDecisionSheet; // step()/openReview() call this on navigation

function submitDecision() {
  const a = applicants.find(x => x.id === queue[qIndex]);
  if (!a || !pendingDecision) return;
  const d = pendingDecision;
  const reason = pendingReason;
  const note = document.getElementById('decision-note').value.trim();
  const listingId = d === 'outreach' ? (document.getElementById('decision-listing').value || null) : null;
  if (!reason && d !== 'outreach') { toast('Pick a reason first'); return; }
  const editing = sheetMode === 'edit';
  hideDecisionSheet();
  saveDecision(a.id, d, reason, null, note, listingId);
  toast(`${fullName(a)} → ${DECISION_LABELS[d]}${d === 'outreach' ? ` · ${attachmentLabel(decisions[a.id])}` : (reason ? ` (${reasonLabel(reason)})` : '')}`);
  if (d === 'outreach') computeMatch(a.id); // refresh the AI suggestion in the background
  if (editing) { renderReview(); return; }
  if (qIndex === queue.length - 1) closeReview(); else step(1);
}

/* Compact house-notes summary: latest three notes, attributed, trimmed. */
function summarizeNotesIntoDecision() {
  const noteEl = document.getElementById('decision-note');
  const picked = comments.slice(-3).map(c =>
    `${c.author_name || 'Housemate'}: ${c.body.replace(/\s+/g, ' ').slice(0, 140)}`);
  const summary = picked.join(' · ');
  noteEl.value = noteEl.value ? `${noteEl.value}\n${summary}` : summary;
  noteEl.focus();
}

function toggleDictation() {
  if (dictation) { stopDictation(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  const noteEl = document.getElementById('decision-note');
  dictation = new SR();
  dictation.continuous = true;
  dictation.interimResults = false;
  dictation.lang = 'en-US';
  dictation.onresult = ev => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) {
        const text = ev.results[i][0].transcript.trim();
        noteEl.value = noteEl.value ? `${noteEl.value} ${text}` : text;
      }
    }
  };
  dictation.onend = () => stopDictation();
  dictation.onerror = () => { stopDictation(); toast('Dictation unavailable — check mic permissions'); };
  dictation.start();
  document.getElementById('decision-mic').classList.add('is-live');
  document.getElementById('decision-mic-label').textContent = 'Listening…';
}

function stopDictation() {
  if (dictation) { try { dictation.onend = null; dictation.stop(); } catch { /* */ } }
  dictation = null;
  const mic = document.getElementById('decision-mic');
  if (mic) {
    mic.classList.remove('is-live');
    document.getElementById('decision-mic-label').textContent = 'Dictate';
  }
}

/* ---------- export ---------- */
function exportCsv() {
  const cols = ['first', 'last', 'email', 'ts_iso', 'residency', 'movein', 'budget', 'source'];
  const head = [...cols, 'decision', 'reason', 'decision_note', 'decided_by', 'decided_at', 'notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  for (const a of applicants) {
    const rec = decisions[a.id] || {};
    lines.push([...cols.map(c => q(a[c])), q(DECISION_LABELS[rec.d] || ''),
      q(rec.reason ? reasonLabel(rec.reason) : ''), q(rec.note || ''),
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

/* ---------- display name + shared gmail ---------- */
function renderRailUser() {
  const el = document.getElementById('rail-user');
  el.innerHTML = `${esc(me.name)} <button class="rail-foot__link rail-foot__edit" id="edit-name" title="Set display name">edit</button>`;
  el.querySelector('#edit-name').onclick = async () => {
    const name = prompt('Display name (shown on decisions, notes, and emails):', me.name);
    if (!name || !name.trim()) return;
    const clean = name.trim().slice(0, 60);
    const { error } = await sb.from('recruit_profiles').upsert({
      user_id: me.id, display_name: clean, updated_at: new Date().toISOString(),
    });
    if (error) { toast(`Save failed: ${error.message}`); return; }
    me.name = clean;
    renderRailUser();
    toast(`Display name set to ${clean}`);
  };
}

async function gmailCall(payload) {
  const { data } = await sb.auth.getSession();
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-gmail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data?.session?.access_token}` },
    body: JSON.stringify(payload),
  });
  const out = await resp.json();
  if (out.error) throw new Error(out.error);
  return out;
}

/* Throttled inbox-wide sweep: matches recent shared-inbox mail to
   applicants so outreach rows can badge replies. */
async function scanInbox() {
  if (!gmailStatus.connected) return;
  const last = +localStorage.getItem('agape:lastScan') || 0;
  if (Date.now() - last < 10 * 60 * 1000) return;
  localStorage.setItem('agape:lastScan', String(Date.now()));
  try {
    const out = await gmailCall({ action: 'scan' });
    if (out.matched) {
      const { data } = await sb.from('recruit_emails').select('applicant_id, direction, sent_at').order('sent_at');
      emailState = {};
      for (const e of (data || [])) {
        const st = (emailState[e.applicant_id] ||= { lastDir: null, lastAt: null, replies: 0 });
        st.lastDir = e.direction; st.lastAt = e.sent_at;
        if (e.direction === 'in') st.replies++;
      }
      if (VIEWS[view]?.kind === 'applicants') renderApplicants();
      if (out.replied?.length) toast(`${out.replied.length} applicant${out.replied.length === 1 ? '' : 's'} replied`);
    }
  } catch (e) { console.warn('inbox scan failed', e); }
}

/* OAuth callback (state=agape-gmail, forwarded from /ladder/). */
async function handleGmailCallback() {
  const params = new URLSearchParams(location.search);
  if (params.get('state') !== 'agape-gmail' || !params.get('code')) return;
  const code = params.get('code');
  const clean = new URL(location.href);
  clean.searchParams.delete('code'); clean.searchParams.delete('state'); clean.searchParams.delete('scope');
  history.replaceState(null, '', clean);
  try {
    const out = await gmailCall({ action: 'connect', code });
    gmailStatus = { connected: true, email: out.email };
    toast(`Shared Gmail connected: ${out.email}`);
  } catch (e) { toast(`Gmail connect failed: ${e.message}`); }
}

async function connectSharedGmail() {
  try {
    const { url } = await gmailCall({ action: 'auth-url' });
    location.href = url;
  } catch (e) { toast(`Couldn't start Gmail connect: ${e.message}`); }
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
    sb.from('recruit_profiles').select('display_name').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data?.display_name) { me.name = data.display_name; renderRailUser(); } });
    fetch(`${SUPABASE_URL}/functions/v1/recruit-gmail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await sb.auth.getSession()).data?.session?.access_token}` },
      body: JSON.stringify({ action: 'status' }),
    }).then(r => r.json()).then(st => { gmailStatus = st || { connected: false }; }).catch(() => {});
    await loadAll();
    // background — outreach attachment labels + rail badges need house data;
    // re-render the open view once it lands so labels don't show stale fallbacks
    loadHouse().then(() => {
      renderRailCounts();
      if (VIEWS[view]?.kind === 'applicants') renderApplicants();
    });
    resolveAvatars(); // background — server resolves any unchecked profile photos
    scanInbox();      // background — badge replies without opening each thread
    const autoPassed = await applyAutoPass();
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    renderRailUser();
    handleGmailCallback();
    view = new URLSearchParams(location.search).get('view') || 'inbox';
    if (!VIEWS[view]) view = 'inbox';
    render();
    if (autoPassed) toast(`${autoPassed} applicant${autoPassed === 1 ? '' : 's'} auto-archived (budget under $1,500)`);
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
    const navLink = e.target.closest('[data-view-link]');
    if (navLink) { e.preventDefault(); setView(navLink.dataset.viewLink); return; }
    const fchip = e.target.closest('[data-fkey]');
    if (fchip) {
      filters[fchip.dataset.fkey] = fchip.dataset.fval;
      renderApplicants();
      return;
    }
    const fclear = e.target.closest('[data-fclear]');
    if (fclear) { filters = { track: 'all', month: 'any', budget: 'any' }; renderApplicants(); return; }
    const review = e.target.closest('[data-review]');
    if (review) { openReview(review.dataset.review); return; }
    const clear = e.target.closest('[data-clear]');
    if (clear) { saveDecision(clear.dataset.clear, null); renderReview(); return; }
    const cps = e.target.closest('[data-copy-schedule]');
    if (cps) {
      const a = applicants.find(x => x.id === cps.dataset.copySchedule);
      navigator.clipboard.writeText(`https://ctrl.rodeo/applications/schedule/?t=${a?.scheduleToken}`)
        .then(() => toast('Availability link copied'));
      return;
    }
    const slot = e.target.closest('[data-slot]');
    if (slot) { scheduleSlot(slot.dataset.slotApplicant, slot.dataset.slot, slot); return; }
    const rtab = e.target.closest('[data-review-tab]');
    if (rtab) { reviewTab = rtab.dataset.reviewTab; renderReview(); return; }
    const em = e.target.closest('[data-email]');
    if (em) { openEmailModal(em.dataset.email); return; }
    const so = e.target.closest('[data-second-opinion]');
    if (so) { requestSecondOpinion(so.dataset.secondOpinion, so); return; }
    const useSug = e.target.closest('[data-use-suggestion]');
    if (useSug) {
      const val = useSug.dataset.useSuggestion || '';
      if (useSug.hasAttribute('data-open-outreach') && document.getElementById('decision-sheet').hidden) {
        openDecisionSheet('outreach').then(() => { document.getElementById('decision-listing').value = val; });
      } else {
        document.getElementById('decision-listing').value = val;
      }
      return;
    }
    const editDec = e.target.closest('[data-edit-decision]');
    if (editDec) {
      const rec = decisions[editDec.dataset.editDecision];
      if (rec) openDecisionSheet(rec.d, 'edit');
      return;
    }
    const reason = e.target.closest('[data-reason]');
    if (reason) { pendingReason = reason.dataset.reason; renderDecisionOptions(); return; }
    const delNote = e.target.closest('[data-delete-note]');
    if (delNote) { deleteNote(delNote.dataset.deleteNote, queue[qIndex]); return; }
    const listCell = e.target.closest('[data-list-room]');
    if (listCell) { createListingFromCell(+listCell.dataset.listRoom, listCell.dataset.listMonth); return; }
    const segLeaving = e.target.closest('[data-seg-leaving]');
    if (segLeaving) {
      const m = +segLeaving.dataset.segMonth;
      markLeaving(+segLeaving.dataset.segLeaving, `2026-${String(m + 1).padStart(2, '0')}-01`);
      return;
    }
    const seg = e.target.closest('[data-seg-room]');
    if (seg) {
      const roomId = +seg.dataset.segRoom, start = +seg.dataset.segStart;
      const match = occupancySegments(roomId).find(x => x.start === start);
      const already = editingSegment && editingSegment.roomId === roomId && editingSegment.start === start;
      editingSegment = (match && !already) ? { roomId, ...match } : null;
      renderOccupancy();
      return;
    }
    const segCancel = e.target.closest('[data-seg-cancel]');
    if (segCancel) { editingSegment = null; renderOccupancy(); return; }
    const leaving = e.target.closest('[data-leaving-room]');
    if (leaving) { markLeaving(+leaving.dataset.leavingRoom); return; }
    const editL = e.target.closest('[data-edit-listing]');
    if (editL) { openListingModal(editL.dataset.editListing); return; }
    const newL = e.target.closest('[data-new-listing]');
    if (newL) { openListingModal('new'); return; }
    const cancelL = e.target.closest('[data-cancel-listing]');
    if (cancelL) { closeListingModal(); return; }
    const delL = e.target.closest('[data-delete-listing]');
    if (delL) { deleteListing(delL.dataset.deleteListing); return; }
    const lstatus = e.target.closest('[data-listing-status]');
    if (lstatus) { return; } // handled by change event on the select
  });

  document.addEventListener('change', e => {
    const sel = e.target.closest('[data-listing-status]');
    if (sel) updateListingStatus(sel.dataset.listingStatus, sel.value);
  });

  window.addEventListener('popstate', () => {
    const v = new URLSearchParams(location.search).get('view') || 'inbox';
    setView(v, false);
  });

  // mobile drawer
  document.getElementById('mobile-menu').onclick = () => {
    const rail = document.getElementById('rail');
    const open = rail.classList.toggle('is-open');
    document.getElementById('rail-scrim').hidden = !open;
  };
  document.getElementById('rail-scrim').onclick = () => {
    document.getElementById('rail').classList.remove('is-open');
    document.getElementById('rail-scrim').hidden = true;
  };

  document.getElementById('menu-export').onclick = exportCsv;
  document.getElementById('menu-theme').onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  document.getElementById('menu-signout').onclick = () => window.CtrlAuth.signOut();
  document.getElementById('pref-couples').onchange = async (e) => {
    const value = e.target.checked;
    settings.open_to_couples = value;
    const { error } = await sb.from('recruit_settings').upsert({
      key: 'open_to_couples', value, updated_by_name: me?.name || null, updated_at: new Date().toISOString(),
    });
    if (error) { toast(`Preference save failed: ${error.message}`); e.target.checked = !value; settings.open_to_couples = !value; }
    else toast(value ? 'House preference: open to couples' : 'House preference: not open to couples');
  };

  document.getElementById('email-close').onclick = closeEmailModal;
  document.getElementById('email-regen').onclick = () => emailApplicantId && generateEmail(emailApplicantId);
  document.getElementById('email-send').onclick = async () => {
    if (!gmailStatus.connected) { toast('Connect the shared Gmail first (Emails tab)'); return; }
    const btn = document.getElementById('email-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await gmailCall({
        action: 'send', applicantId: emailApplicantId,
        subject: document.getElementById('email-subject').value,
        body: document.getElementById('email-body').value,
      });
      toast('Sent from live.at.agapesf@gmail.com');
      delete emailsCache[emailApplicantId];
      closeEmailModal();
    } catch (e) { toast(`Send failed: ${e.message}`); }
    btn.disabled = false; btn.textContent = 'Send via Agape Gmail';
  };
  document.getElementById('email-copy').onclick = async () => {
    const text = `Subject: ${document.getElementById('email-subject').value}\n\n${document.getElementById('email-body').value}`;
    try { await navigator.clipboard.writeText(text); toast('Email copied'); }
    catch { toast('Copy failed — select and copy manually'); }
  };
  document.getElementById('email-mailto').onclick = () => {
    const a = applicants.find(x => x.id === emailApplicantId);
    const url = `mailto:${encodeURIComponent(a?.email || '')}?subject=${encodeURIComponent(document.getElementById('email-subject').value)}&body=${encodeURIComponent(document.getElementById('email-body').value)}`;
    window.open(url, '_blank');
  };
  document.getElementById('review-close').onclick = closeReview;
  document.getElementById('review-prev').onclick = () => step(-1);
  document.getElementById('review-next').onclick = () => step(1);
  document.getElementById('btn-pass').onclick = () => openDecisionSheet('pass');
  document.getElementById('btn-outreach').onclick = () => openDecisionSheet('outreach');
  document.getElementById('btn-hold').onclick = () => openDecisionSheet('hold');
  document.getElementById('decision-cancel').onclick = hideDecisionSheet;
  document.getElementById('decision-submit').onclick = submitDecision;
  document.getElementById('decision-mic').onclick = toggleDictation;
  document.getElementById('decision-use-notes').onclick = summarizeNotesIntoDecision;

  document.addEventListener('keydown', e => {
    if (document.getElementById('review').hidden) return;
    if (e.target instanceof Element && e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') { if (!document.getElementById('decision-sheet').hidden) hideDecisionSheet(); else closeReview(); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('email-modal').hidden) closeEmailModal();
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
}

document.addEventListener('DOMContentLoaded', init);
