/* Agape recruiting viewer — /applications
   Discord-gated (Recruiting Society channel on the Agape server, verified by
   the discord-membership edge fn). Applicants, votes, shared decisions, and
   house notes live in Supabase behind RLS (migrations 108 + 120).

   v3 funnel: Inbox (collective 1–5 votes, veto rejects) → Candidates →
   Openings (listing shortlists) → Screening → Archive. The applicant's
   stage column is recomputed server-side by a trigger on recruit_votes;
   manual moves go through the recruit_set_stage RPC. Candidates are
   auto-placed into every open listing they qualify for
   (recruit_listing_candidates, migration 123). */
const VERSION = '3.35.0';
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
    { id: 'dropped-out', label: 'Dropped out' },
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

/* Removing someone is one gesture with four outcomes. 'listing' is scope
   (recruit_listing_candidates tombstone); the other three are exits from the
   funnel (recruit_applicants.exit_reason, migration 135). Ordered least →
   most final — only the last one is destructive. */
const REMOVE_OPTIONS = [
  {
    id: 'listing', label: 'From this listing',
    hint: 'still a candidate for other rooms',
    chip: 'removed', scope: true,
  },
  {
    id: 'future', label: 'Save for future',
    hint: 'right person, wrong time — pick when to bring them back',
    chip: 'saved for future', stage: 'candidate', needsDate: true,
  },
  {
    id: 'opted_out', label: 'Opted out',
    hint: 'they withdrew — no update email owed',
    chip: 'opted out', stage: 'archived',
  },
  {
    id: 'not_a_fit', label: 'Not a fit',
    hint: 'our no — queues an update email',
    chip: 'not a fit', stage: 'rejected', danger: true,
  },
];
const removeOption = id => REMOVE_OPTIONS.find(o => o.id === id) || null;
// Default return date for Save for future: three months out, month start.
function defaultReturnDate() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 3, 1).toISOString().slice(0, 10);
}

const VIEWS = {
  inbox: { title: 'Inbox', kind: 'applicants' },
  candidates: { title: 'Candidates', kind: 'applicants' },
  openings: { title: 'Openings', kind: 'applicants' },
  screening: { title: 'Screening', kind: 'applicants' },
  archive: { title: 'Archive', kind: 'applicants' },
  occupancy: { title: 'Occupancy', kind: 'house' },
};
// Old bookmarks and deep links keep working.
const LEGACY_VIEWS = { review: 'inbox', outreach: 'openings', hold: 'inbox', listings: 'openings' };

let sb = null;                // supabase client (from CtrlAuth)
let me = null;                // { id, name }
let applicants = [];          // newest first; each carries .stage
let decisions = {};           // applicant_id -> { d, reason, by, byName, at }
let votes = {};               // applicant_id -> recruit_votes rows
let placements = [];          // recruit_listing_candidates rows
let viewedIds = new Set();    // applicants I've opened (recruit_applicant_views)
let claimPosts = {};          // applicant_id -> { status, posted_at }
let decisionVotes = {};       // applicant_id -> recruit_decision_votes rows
let screeningState = {};      // applicant_id -> { at?, with?, availability? }
let houseEvents = {};         // applicant_id -> non-intro_call calendar rows
let pendingVote = null;       // { score, veto } while the vote bar is open
let commentCounts = {};       // applicant_id -> n
let latestNotes = {};         // applicant_id -> { author, body }
let comments = [];            // comments for the applicant open in review
let view = 'inbox';           // current rail view
let filters = { track: 'all', month: 'any', budget: 'any' }; // shared across applicant views
let rooms = [];               // recruit_rooms
let stays = [];               // recruit_stays rows (date-based tenures)
let listings = [];            // recruit_listings rows
let houseLoaded = false;
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

/* Recruiter-confirmed move-in window (set after emailing them) — when
   present it beats the parsed free text everywhere dates matter. */
const fmtMD = iso => new Date(iso + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const confirmedMoveIn = a => a.moveinFrom
  ? (a.moveinTo ? `${fmtMD(a.moveinFrom)} → ${fmtMD(a.moveinTo)}` : fmtDay(a.moveinFrom))
  : '';
const effectiveMoveIn = a => confirmedMoveIn(a) || normalizeMoveIn(a);

/* The canonical, simplified move-in display. One of:
   "Sep 1, 2026" · "Sep 2026" · "Aug–Sep 2026" · "ASAP" · "Flexible" ·
   "Jul 28 → Aug 29" (a known in→out window) · '' (unparseable).
   The "· flexible" suffix never renders in sublines — the raw answer lives
   behind the profile info-dot. */
function displayMoveIn(a) {
  const conf = confirmedMoveIn(a);
  if (conf) return conf;
  const win = parsedStayWindow(a);
  if (win) return `${fmtMD(win[0])} → ${fmtMD(win[1])}`;
  return normalizeMoveIn(a).replace(/ · flexible$/, '');
}

/* Track badge — same pill component as the listing headers. Full-time is
   the default track, so it stays neutral (blends with the background);
   Sublet keeps its tint as the exception worth noticing. */
const trackBadge = a =>
  `<span class="listing-kind listing-kind--${isSublet(a) ? 'sublet' : 'fulltime'} listing-kind--xs">${trackLabel(a)}</span>`;

/* Row subline (text after the track badge): pronouns · move-in dates.
   Budget lives on the review page. */
function subLine(a) {
  const bits = [];
  if (a.pronouns) bits.push(a.pronouns.toLowerCase());
  const mi = displayMoveIn(a);
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
/* A stated in→out window parsed from the free text ("July 28 - Aug 29"),
   as a pair of ISO dates. Null when the answer doesn't carry two dates. */
function parsedStayWindow(a) {
  if (!isSublet(a)) return null;
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
  return dates.map(d => d.toISOString().slice(0, 10));
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
        let label = handle && !/^(in|company|profile|people)$/i.test(handle) ? handle : platform;
        if (platform === 'linkedin') label = label.replace(/-[0-9a-f]{6,}$/i, '').replace(/-/g, ' ');
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

/* The one CTA an Openings row needs right now, from its funnel micro-state:
   nothing sent yet → Reach out · waiting on them → Follow up · they wrote
   back → Reply · availability in hand → Pick a time · call booked → the
   slot chip (+ Join when there's a Meet link). */
/* Time-derived call phase — a clock, not a cron, decides these. Stored
   status only carries facts time can't tell us (cancelled). Join renders
   ONLY while the call is actually live (T-10min through end). */
function callPhase(sc) {
  if (!sc) return null;
  if (sc.watch) return 'watch';
  // Finished, nothing to watch. Distinct from 'processing' (which means a
  // recording is still landing) — this call may simply never have been
  // recorded, so the row should move on rather than wait forever.
  if (sc.done && !sc.at) {
    const overFor = Date.now() - new Date(sc.doneAt).getTime();
    return overFor > 6 * 3600000 ? 'done' : 'processing';
  }
  if (sc.at) {
    const now = Date.now();
    const start = new Date(sc.at).getTime();
    const end = sc.ends ? new Date(sc.ends).getTime() : start + 30 * 60000;
    if (now >= end) return 'processing';
    if (now >= start - 10 * 60000) return 'live';
    return 'scheduled';
  }
  if (sc.availability) return 'availability';
  return null;
}

function processingChip() {
  return `<span class="decision-chip decision-chip--vote" title="The call ended — recording and notes usually land within 30 minutes">Notes on the way…</span>`;
}

function watchBtn(sc, applicantId) {
  // Opens the Call tab on their profile (video + summary + comments) —
  // not a detached modal.
  if (applicantId) return `<button class="btn btn--sm inbox-row__review cta-std btn--watch" title="Watch the recorded intro call" data-play-mini="${applicantId}"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Watch</button>`;
  return `<button class="btn btn--sm inbox-row__review cta-std btn--watch" title="Watch the recorded intro call" onclick="event.stopPropagation();openWatch('${sc.watch}')"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>Watch</button>`;
}

function joinBtn(sc) {
  return sc.link ? `<a class="btn btn--sm inbox-row__review cta-std btn--join" href="${esc(sc.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>Join</a>` : '';
}

function openingsCta(a) {
  const sc = screeningState[a.id];
  const phase = callPhase(sc);
  const stack = (top, ctx) => `<span class="cta-stack">${top}${ctx ? `<span class="cta-context">${ctx}</span>` : ''}</span>`;
  const when = sc?.at ? `${fmtSlot(sc.at)}${sc.with ? ` · ${esc(sc.with)}` : ''}` : '';
  if (phase === 'watch') {
    const dv = decisionVotes[a.id] || [];
    const mine = dv.find(v => v.voter_id === me?.id);
    const decCtx = mine
      ? `${dv.length} decision${dv.length === 1 ? '' : 's'} in — yours counted`
      : `<button type="button" class="cta-link" data-give-decision="${a.id}">give your decision</button>${dv.length ? ` · ${dv.length} in` : ''}`;
    return stack(
      `<span class="cta-pair"><button class="btn btn--sm inbox-row__review cta-std cta--blue" data-email="${a.id}" data-email-kind="visit" title="Invite them to a house visit — opens the email draft">Schedule a visit</button><button type="button" class="btn btn--sm cta-icon btn--watch" title="Play in the docked player — View opens the Call tab" data-play-mini="${a.id}"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button></span>`,
      `${decCtx}${when ? ` · ${when}` : ''}`);
  }
  if (phase === 'done') {
    // Same move as after a watched call — the decision is the point, the
    // recording was only ever an aid — plus a way to supply one.
    const dv = decisionVotes[a.id] || [];
    const mine = dv.find(v => v.voter_id === me?.id);
    const decCtx = mine
      ? `${dv.length} decision${dv.length === 1 ? '' : 's'} in — yours counted`
      : `<button type="button" class="cta-link" data-give-decision="${a.id}">give your decision</button>${dv.length ? ` · ${dv.length} in` : ''}`;
    return stack(
      `<button class="btn btn--sm inbox-row__review cta-std cta--blue" data-email="${a.id}" data-email-kind="visit" title="Invite them to a house visit — opens the email draft">Schedule a visit</button>`,
      `${decCtx} · no recording — <button type="button" class="cta-link" data-add-recording="${a.id}">add a link</button>`);
  }
  if (phase === 'processing') return stack(processingChip(), when);
  if (phase === 'live') return stack(joinBtn(sc) || processingChip(), when);
  if (phase === 'scheduled') {
    return stack(`<span class="decision-chip decision-chip--outreach" title="Intro call${sc.with ? ` with ${esc(sc.with)}` : ''}">${fmtSlot(sc.at)}</span>`, sc.with ? `with ${esc(sc.with)}` : '');
  }
  const claim = claimPosts[a.id];
  if (sc?.availability && claim && (claim.status === 'open' || claim.status === 'manual')) {
    const days = Math.max(0, Math.round((Date.now() - new Date(claim.postedAt).getTime()) / 86400000));
    return stack(`<span class="decision-chip decision-chip--outreach">◆ sent to housemates</span>`,
      `no screener yet · ${days === 0 ? 'sent today' : `${days}d`} · <button type="button" class="cta-link" data-avail-review="${a.id}">book it yourself</button>`);
  }
  if (sc?.availability) return stack(
    `<button class="btn btn--sm inbox-row__review cta-std cta--blue" data-avail-review="${a.id}">Review availability</button>`,
    sc.nWindows ? `${sc.nWindows} window${sc.nWindows === 1 ? '' : 's'} offered` : '');
  const st = emailState[a.id];
  if (st?.lastDir === 'in') return stack(`<button class="btn btn--sm inbox-row__review cta-std cta--green" data-pick-time="${a.id}">Reply</button>`, `replied ${relTime(st.lastAt)}`);
  if (st?.lastDir === 'out') {
    // "I'll send an invite" reads as manual scheduling — say so instead of
    // nagging; a shared-account invite gets picked up by the calendar sweep.
    const promised = /\b(invite|calendar|schedul|let'?s (chat|talk|meet)|talk (soon|then|tomorrow))\b/i.test(st.lastSnippet || '');
    // Waiting is passive until ~3 quiet days; then the clock arms Follow up.
    const stale = Date.now() - new Date(st.lastAt).getTime() > 3 * 86400000;
    return stack(`<button class="btn btn--sm inbox-row__review cta-std ${stale ? 'cta--amber' : ''}" data-email="${a.id}">Follow up</button>`,
      `${promised ? 'invite promised · ' : ''}sent ${relTime(st.lastAt)}`);
  }
  return stack(`<button class="btn btn--sm inbox-row__review cta-std" data-email="${a.id}">Reach out</button>`, '');
}

/* Blue response dot in the row's left gutter — sits beside the avatar,
   never on top of it. */
function repliedDot(a) {
  // Same blue dot, two meanings by context: in the Inbox it marks an
  // application nobody on your account has opened yet; elsewhere it marks
  // their reply waiting on you.
  if (view === 'inbox') {
    return viewedIds.has(a.id) ? '' : `<span class="replied-dot" title="New — you haven't opened this application yet"></span>`;
  }
  const st = emailState[a.id];
  if (st?.lastDir !== 'in') return '';
  return `<span class="replied-dot" title="They replied — ${relTime(st.lastAt)}"></span>`;
}

/* Filled square speech bubble (tail centered on the bottom) with the note
   count inside — louder than the old pencil count. */
function noteBubble(id) {
  const n = commentCounts[id];
  if (!n) return '';
  const latest = latestNotes[id];
  const tip = `${n} house note${n === 1 ? '' : 's'}${latest ? ` · latest — ${latest.author}: “${latest.body.replace(/\s+/g, ' ').slice(0, 140)}${latest.body.length > 140 ? '…' : ''}”` : ''}`;
  return `<span class="note-bubble" data-tip="${esc(tip)}">
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-4.6L12 21l-2.4-4H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z"/></svg>
    <b class="note-bubble__n">${n}</b>
  </span>`;
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
  const [aRes, dRes, cRes, eRes, vRes, scRes, avRes, pRes, cpRes, dvRes, vwRes] = await Promise.all([
    sb.from('recruit_applicants').select('*').order('submitted_at', { ascending: false }),
    sb.from('recruit_decisions').select('*'),
    sb.from('recruit_comments').select('applicant_id, author_name, body, created_at').order('created_at'),
    // Full rows, not just the state columns: this is also what hydrates
    // emailsCache so a profile can render its thread before any Gmail
    // round-trip. body_text is the one heavy column and stays out — the
    // background sync fills it in.
    sb.from('recruit_emails').select('id, applicant_id, gmail_id, thread_id, direction, subject, snippet, from_email, to_email, sent_at').order('sent_at'),
    sb.from('recruit_votes').select('*').order('created_at'),
    sb.from('recruit_screenings').select('id, applicant_id, starts_at, ends_at, status, housemate_name, meet_link, recall_status, kind, title, calendar_id').order('starts_at'),
    sb.from('recruit_availability').select('applicant_id, windows, updated_at'),
    sb.from('recruit_listing_candidates').select('*'),
    sb.from('recruit_applicant_views').select('applicant_id'),
    sb.from('recruit_claim_posts').select('applicant_id, status, posted_at'),
    sb.from('recruit_decision_votes').select('*'),
  ]);
  placements = pRes.data || [];
  viewedIds = new Set((vwRes.data || []).map(v => v.applicant_id));
  claimPosts = {};
  for (const c of (cpRes.data || [])) claimPosts[c.applicant_id] = { status: c.status, postedAt: c.posted_at };
  decisionVotes = {};
  for (const d of (dvRes.data || [])) (decisionVotes[d.applicant_id] ||= []).push(d);
  votes = {};
  for (const v of (vRes.data || [])) (votes[v.applicant_id] ||= []).push(v);
  screeningState = {};
  houseEvents = {};
  for (const s of (scRes.data || [])) {
    // Only intro calls drive the row state machine. Visits and house events
    // come off the house calendar (migration 137) and belong on the profile,
    // not in the Screening funnel — a dinner must never render a Watch chip
    // or arm "Notes on the way…".
    if ((s.kind || 'intro_call') !== 'intro_call') {
      (houseEvents[s.applicant_id] ||= []).push(s);
      continue;
    }
    if (s.status === 'scheduled') screeningState[s.applicant_id] = { ...(screeningState[s.applicant_id] || {}), at: s.starts_at, ends: s.ends_at, with: s.housemate_name, link: s.meet_link };
    // A call that already happened. Calendar-swept rows land here directly
    // (the sweep inserts past events as 'completed'), and without this the
    // row falls through to the availability branch below and offers to book
    // a call that is already over.
    if (s.status === 'completed') screeningState[s.applicant_id] = {
      ...(screeningState[s.applicant_id] || {}),
      done: s.id, doneAt: s.ends_at || s.starts_at, with: s.housemate_name,
    };
    // A finished recording adds a Watch state to the row (fresh link on
    // click). Recall's own capture and a pasted link (tldv etc.) are equally
    // watchable — the Call tab knows which player to use.
    if (s.recall_status === 'done') screeningState[s.applicant_id] = { ...(screeningState[s.applicant_id] || {}), watch: s.id };
    if (s.external_recording_url) screeningState[s.applicant_id] = {
      ...(screeningState[s.applicant_id] || {}),
      watch: s.id, watchExternal: s.external_recording_url,
    };
  }
  for (const av of (avRes.data || [])) {
    // Availability is the weakest signal there is — it must never overwrite
    // a booked or finished call. `||=` guards the object, but a row whose
    // only state is `done` still needs the windows recorded without the
    // availability CTA winning.
    if (!Array.isArray(av.windows) || !av.windows.length) continue;
    const st = screeningState[av.applicant_id];
    if (!st) { screeningState[av.applicant_id] = { availability: true, nWindows: av.windows.length }; continue; }
    if (!st.at && !st.done && !st.watch) { st.availability = true; st.nWindows = av.windows.length; }
  }
  emailState = {};
  emailsCache = {};
  for (const e of (eRes.data || [])) {
    const st = (emailState[e.applicant_id] ||= { lastDir: null, lastAt: null, lastSnippet: '', replies: 0 });
    st.lastDir = e.direction; st.lastAt = e.sent_at; st.lastSnippet = e.snippet || '';
    if (e.direction === 'in') st.replies++;
    // Newest-first, matching what the sync action returns.
    (emailsCache[e.applicant_id] ||= []).unshift(e);
  }
  // Availability and screenings ride along too, so the Emails tab can draw
  // its scheduling card from the first paint rather than after the sync.
  availCache = {};
  for (const av of (avRes.data || [])) availCache[av.applicant_id] = av;
  screeningsCache = {};
  for (const s of (scRes.data || [])) (screeningsCache[s.applicant_id] ||= []).push(s);
  sb.from('recruit_settings').select('*').then(({ data }) => {
    for (const row of (data || [])) settings[row.key] = row.value;
    const box = document.getElementById('pref-couples');
    if (box) box.checked = settings.open_to_couples !== false;
    const ap = document.getElementById('pref-autopost');
    if (ap) ap.checked = settings.discord_auto_post === true;
  });
  if (aRes.error) throw aRes.error;
  applicants = (aRes.data || []).map(r => ({
    id: r.id, ts_iso: r.submitted_at,
    first: r.first_name, last: r.last_name, pronouns: r.pronouns,
    email: r.email, social: r.social, about: r.about, why: r.why_agape,
    gifts: r.gifts, source: r.heard_from, residency: r.residency,
    movein: r.move_in, budget: r.budget, avatarUrl: r.avatar_url, scheduleToken: r.schedule_token,
    stage: r.stage || 'review',
    moveinFrom: r.move_in_from, moveinTo: r.move_in_to, moveinSetBy: r.move_in_set_by_name,
    updateSentAt: r.update_email_sent_at, updateSkippedAt: r.update_email_skipped_at,
    exitReason: r.exit_reason || null, exitUntil: r.exit_until || null,
    exitNote: r.exit_note || '', exitBy: r.exit_by_name || null,
  }));
  decisions = {};
  for (const d of (dRes.data || [])) {
    decisions[d.applicant_id] = { d: d.decision, reason: d.reason, note: d.note || '', listingId: d.listing_id || null, byName: d.decided_by_name, at: d.decided_at };
  }
  commentCounts = {};
  latestNotes = {};
  for (const c of (cRes.data || [])) {
    commentCounts[c.applicant_id] = (commentCounts[c.applicant_id] || 0) + 1;
    latestNotes[c.applicant_id] = { author: c.author_name || 'Housemate', body: c.body || '' }; // rows are created_at-ordered
  }
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

/* ---------- deterministic listing placement ----------
   AI suggestions are gone: a candidate is auto-placed into EVERY open
   listing they qualify for. Qualification = track match (sublet applicants
   → sublet listings, full-time → resident trials), budget covers the rent
   when both are known, and their move-in window brushes the listing's.
   Unknown/flexible move-in qualifies everywhere on its track. */

/* Move-in as a {lo, hi} 'YYYY-MM' range, or null when flexible/unknown.
   A recruiter-confirmed window is exact and wins over the parsed text. */
function moveInRange(a) {
  if (a.moveinFrom) {
    return { lo: a.moveinFrom.slice(0, 7), hi: (a.moveinTo || a.moveinFrom).slice(0, 7) };
  }
  const norm = normalizeMoveIn(a);
  if (!norm || /^(ASAP|Flexible)/.test(norm)) return null;
  const yr = norm.match(/(20\d\d)/)?.[1];
  const ms = [...norm.matchAll(new RegExp(`\\b(${MONTH_ABBR.join('|')})\\b`, 'g'))].map(m => MONTH_ABBR.indexOf(m[1]));
  if (!yr || !ms.length) return null;
  const key = m => `${yr}-${String(m + 1).padStart(2, '0')}`;
  return { lo: key(Math.min(...ms)), hi: key(Math.max(...ms)) };
}

const monthShift = (ym, n) => {
  const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 15);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function qualifiesFor(a, l) {
  if (l.status !== 'open') return false;
  if (isSublet(a) !== (l.kind === 'sublet')) return false;
  const bm = budgetMax(a.budget);
  if (bm !== null && l.rent_monthly != null && bm < l.rent_monthly) return false;
  // Dates have to line up. A recruiter-confirmed window is exact — no
  // flexible escape hatch. Otherwise: only an explicit "flexible" rides any
  // window; ASAP only fits a room opening within the month after now; stated
  // dates must fall inside the listing's actual window (a resident trial's
  // window is its start month — that's when the room is free).
  const startMonth = l.starts_on.slice(0, 7);
  const endMonth = l.ends_on ? l.ends_on.slice(0, 7) : startMonth;
  if (a.moveinFrom) {
    const r = moveInRange(a);
    return r.hi >= startMonth && r.lo <= endMonth;
  }
  const norm = normalizeMoveIn(a);
  // Bare "Flexible" rides any window; "month + flexible" means that month ±1.
  if (/^Flexible$/i.test(norm || '')) return true;
  if (/^ASAP/.test(norm || '')) {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return startMonth >= cur && startMonth <= monthShift(cur, 1);
  }
  const range = moveInRange(a);
  if (!range) return false; // no parseable dates — can't confirm they line up
  const flexPad = /flexible/i.test(norm || '') ? 1 : 0;
  return monthShift(range.hi, flexPad) >= startMonth && monthShift(range.lo, -flexPad) <= endMonth;
}

const activePlacements = id => placements.filter(p => p.applicant_id === id && p.status === 'active');

/* Insert missing placements for every candidate AND prune auto rows that no
   longer qualify (rule changes, edited listings, stage moves). Never touches
   manual placements or tombstones a recruiter removed. Returns adds. */
async function syncAutoPlacements() {
  if (!houseLoaded) return 0;
  const have = new Set(placements.map(p => `${p.applicant_id}:${p.listing_id}`));
  const fresh = [];
  // A saved-for-future candidate keeps the stage but is off the board until
  // their date lands, so they're excluded here as well as in matchesView.
  for (const a of applicants.filter(x => x.stage === 'candidate' && !x.exitReason)) {
    for (const l of listings.filter(l => l.status === 'open')) {
      if (!have.has(`${a.id}:${l.id}`) && qualifiesFor(a, l)) {
        fresh.push({ applicant_id: a.id, listing_id: l.id, source: 'auto' });
      }
    }
  }
  const stale = placements.filter(p => {
    if (p.source !== 'auto' || p.status !== 'active') return false;
    const a = applicants.find(x => x.id === p.applicant_id);
    const l = listings.find(x => x.id === p.listing_id);
    return !a || !l || a.stage !== 'candidate' || a.exitReason || !qualifiesFor(a, l);
  });
  if (stale.length) {
    const { error } = await sb.from('recruit_listing_candidates').delete().in('id', stale.map(r => r.id));
    if (error) console.warn('placement prune failed', error.message);
    else {
      const gone = new Set(stale.map(r => r.id));
      placements = placements.filter(p => !gone.has(p.id));
    }
  }
  if (!fresh.length) return 0;
  const { data, error } = await sb.from('recruit_listing_candidates')
    .upsert(fresh, { onConflict: 'applicant_id,listing_id', ignoreDuplicates: true }).select();
  if (error) { console.warn('placement sync failed', error.message); return 0; }
  placements.push(...(data || []));
  return (data || []).length;
}

async function addPlacement(applicantId, listingId, source = 'manual') {
  const { data, error } = await sb.from('recruit_listing_candidates').upsert({
    applicant_id: applicantId, listing_id: listingId, source,
    status: 'active', added_by_name: me?.name || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id,listing_id' }).select().single();
  if (error) { toast(`Couldn't add to listing: ${error.message}`); return null; }
  placements = [...placements.filter(p => !(p.applicant_id === applicantId && p.listing_id === listingId)), data];
  return data;
}

async function removePlacement(applicantId, listingId, quiet = false) {
  const { error } = await sb.from('recruit_listing_candidates')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('applicant_id', applicantId).eq('listing_id', listingId);
  if (error) { toast(`Remove failed: ${error.message}`); return; }
  const row = placements.find(p => p.applicant_id === applicantId && p.listing_id === listingId);
  if (row) row.status = 'removed';
  if (quiet) return;
  toast('Removed from the listing — the auto-sweep won\'t re-add them');
  renderRailCounts();
  if (!document.getElementById('review').hidden) renderReview();
  else if (VIEWS[view]?.kind === 'applicants') renderApplicants();
}

/* ---------- funnel exits (migration 135) ----------
   The three non-scope removals. Each writes exit_reason via the RPC and
   moves the stage; 'not_a_fit' additionally records a pass decision so the
   update-email tray picks them up. Passing reason=null is the Undo. */
async function setExit(applicantId, reason, until = null, note = '') {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return false;
  const { error } = await sb.rpc('recruit_set_exit', {
    p_applicant: applicantId, p_reason: reason,
    p_until: reason === 'future' ? until : null,
    p_note: note || null, p_name: me?.name || null,
  });
  if (error) { toast(`Remove failed: ${error.message}`); return false; }
  a.exitReason = reason;
  a.exitUntil = reason === 'future' ? until : null;
  a.exitNote = reason ? note : '';
  a.exitBy = reason ? (me?.name || null) : null;
  return true;
}

/* A future-fit exit hides them from Openings, so their auto placements have
   to go too — otherwise the sweep and the view disagree about who's live. */
async function clearActivePlacements(applicantId) {
  const live = activePlacements(applicantId);
  if (!live.length) return;
  const { error } = await sb.from('recruit_listing_candidates')
    .delete().in('id', live.map(p => p.id));
  if (error) { console.warn('placement clear failed', error.message); return; }
  const gone = new Set(live.map(p => p.id));
  placements = placements.filter(p => !gone.has(p.id));
}

/* Saved-for-future people come back on their own — that's the whole reason
   Save for future isn't just Archive. Anyone whose date has arrived has the
   exit cleared on load; syncAutoPlacements then re-places them normally. */
async function returnDueCandidates() {
  const today = new Date().toISOString().slice(0, 10);
  const due = applicants.filter(x => x.exitReason === 'future' && x.exitUntil && x.exitUntil <= today);
  if (!due.length) return 0;
  for (const a of due) {
    if (await setExit(a.id, null)) a.returnedFromFuture = true;
  }
  return due.length;
}

/* ---------- external recordings ----------
   Calls recorded outside the pipeline (tldv, Zoom, Drive). Stored as a link,
   opened in a new tab: none of these hosts allow cross-origin embedding, so
   an inline player would just be a broken black box. */
async function promptRecordingLink(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  const url = prompt(`Recording link for ${fullName(a)} (tldv, Zoom, Drive…):`, '');
  if (url === null) return;                       // cancelled
  const clean = url.trim();
  if (clean && !/^https?:\/\//i.test(clean)) { toast('Link must start with http:// or https://'); return; }
  try {
    await gmailCall({ action: 'attach-recording', applicantId, url: clean || null });
    toast(clean ? `Recording linked to ${a.first}` : 'Recording link removed');
    if (!document.getElementById('review').hidden) renderReview();
  } catch (e) { toast(`Couldn't attach: ${e.message}`); }
}

/* Links harvested from the recruiting channels that nobody has filed yet.
   Suggestions only — a wrong recording on a profile is worse than none, so
   attaching always takes a human confirming who it belongs to. */
let recordingLeads = [];
async function loadRecordingLeads() {
  if (!gmailStatus.connected) return;
  try {
    const out = await gmailCall({ action: 'recording-leads' });
    recordingLeads = out.leads || [];
    if (view === 'screening') renderApplicants();
  } catch (e) { console.warn('recording leads failed', e); }
}

function recordingLeadsHtml() {
  if (view !== 'screening' || !recordingLeads.length) return '';
  return `<div class="update-tray">
    <div class="update-tray__head">
      <b>${recordingLeads.length} recording link${recordingLeads.length === 1 ? '' : 's'} posted in Discord, unfiled</b>
      <button type="button" class="btn btn--sm" data-rescan-recordings>Rescan</button>
    </div>
    ${recordingLeads.map(l => {
      const who = l.suggested_applicant_id
        ? applicants.find(x => x.id === l.suggested_applicant_id) : null;
      return `<div class="update-tray__row">
        <span class="update-tray__who">${esc(l.source || 'link')}${l.author_name ? ` · ${esc(l.author_name)}` : ''}</span>
        <span class="update-tray__why">${esc(l.context || l.url)}</span>
        ${who
          ? `<button type="button" class="cta-link" data-file-lead="${esc(l.id)}|${esc(who.id)}">File under ${esc(who.first)}</button>`
          : `<span class="note-count">no match — open a profile and use Add recording link</span>`}
        <a class="cta-link" href="${esc(l.url)}" target="_blank" rel="noopener">Open</a>
        <button type="button" class="cta-link" data-dismiss-lead="${esc(l.id)}">Dismiss</button>
      </div>`;
    }).join('')}
  </div>`;
}

/* ---------- the Remove sheet ----------
   One ⋯ item, four outcomes. Opened from an Openings row (listingId set) or
   from a profile (listingId null, so the scope option is hidden — there's no
   "this listing" to scope to). */
let removeTarget = null;   // { applicantId, listingId }
let removePick = null;     // REMOVE_OPTIONS id

function openRemoveSheet(applicantId, listingId = null) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  removeTarget = { applicantId, listingId: listingId || null };
  removePick = null;
  document.getElementById('remove-title').textContent = `Remove ${fullName(a)}`;
  document.getElementById('remove-note').value = '';
  document.getElementById('remove-until').value = defaultReturnDate();
  document.getElementById('remove-until-wrap').hidden = true;
  renderRemoveOptions();
  document.getElementById('remove-submit').disabled = true;
  document.getElementById('remove-submit').classList.remove('btn--danger');
  document.getElementById('remove-modal').hidden = false;
}

function renderRemoveOptions() {
  const listingId = removeTarget?.listingId;
  document.getElementById('remove-options').innerHTML = REMOVE_OPTIONS
    .filter(o => !o.scope || listingId)
    .map(o => `<button type="button" class="remove-sheet__option${removePick === o.id ? ' is-selected' : ''}${o.danger ? ' remove-sheet__option--danger' : ''}" data-remove-pick="${o.id}">
      <span class="remove-sheet__option-label">${esc(o.label)}</span>
      <span class="remove-sheet__option-hint">${esc(o.hint)}</span>
    </button>`).join('');
}

function pickRemoveOption(id) {
  const opt = removeOption(id);
  if (!opt) return;
  removePick = id;
  renderRemoveOptions();
  document.getElementById('remove-until-wrap').hidden = !opt.needsDate;
  const submit = document.getElementById('remove-submit');
  submit.disabled = false;
  submit.textContent = opt.scope ? 'Remove' : opt.label;
  // Danger is an outline style — it replaces the accent fill, never stacks
  // on top of it (design-system/components.css .btn--danger).
  submit.classList.toggle('btn--danger', !!opt.danger);
  submit.classList.toggle('btn--accent', !opt.danger);
}

function hideRemoveSheet() {
  document.getElementById('remove-modal').hidden = true;
  removeTarget = null;
  removePick = null;
}

async function submitRemove() {
  if (!removeTarget || !removePick) return;
  const { applicantId, listingId } = removeTarget;
  const opt = removeOption(removePick);
  const a = applicants.find(x => x.id === applicantId);
  if (!a || !opt) return;
  const note = document.getElementById('remove-note').value.trim();
  const until = opt.needsDate ? document.getElementById('remove-until').value : null;
  if (opt.needsDate && !until) { toast('Pick a date to bring them back'); return; }

  hideRemoveSheet();
  // Fade the row and hold it — nothing is written until the window closes,
  // so Undo is a no-op rather than a compensating write.
  beginRowExit(applicantId, listingId, opt, async () => {
    if (opt.scope) { await removePlacement(applicantId, listingId); return; }
    if (!await setExit(applicantId, opt.id, until, note)) return;
    // Their listing slots go with them — all three exits leave the board.
    await clearActivePlacements(applicantId);
    if (opt.id === 'not_a_fit') await saveDecision(applicantId, 'pass', null, null, note);
    if (a.stage !== opt.stage) await setStage(applicantId, opt.stage);
    toast(opt.id === 'not_a_fit'
      ? `${fullName(a)} → Archived — update email queued`
      : opt.id === 'opted_out'
        ? `${fullName(a)} → Archived — no update email owed`
        : `${fullName(a)} saved for ${fmtDay(until)} — they'll come back on their own`);
    renderRailCounts();
    if (VIEWS[view]?.kind === 'applicants') renderApplicants();
    if (!document.getElementById('review').hidden) renderReview();
  });
}

/* ---------- transparency exit ----------
   The row fades to the same 0.45 the drag state uses, swaps its actions for
   the outcome chip + Undo, and holds for EXIT_HOLD_MS before the write runs.
   It never moves while the window is open — no reflow under the cursor. */
const EXIT_HOLD_MS = 6000;
const pendingExits = new Map(); // rowKey -> { timer, commit }

const exitRowKey = (applicantId, listingId) => `${applicantId}|${listingId || ''}`;

function beginRowExit(applicantId, listingId, opt, commit) {
  const key = exitRowKey(applicantId, listingId);
  if (pendingExits.has(key)) clearTimeout(pendingExits.get(key).timer);
  const row = document.querySelector(
    listingId
      ? `.inbox-row[data-row-id="${CSS.escape(applicantId)}"][data-row-group="${CSS.escape(listingId)}"]`
      : `.inbox-row[data-row-id="${CSS.escape(applicantId)}"]`);
  if (!row) { commit(); return; } // row isn't on screen — just do it

  const actions = row.querySelector('.inbox-row__actions');
  const restore = actions ? actions.innerHTML : null;
  row.classList.add('is-exiting');
  if (actions) {
    actions.innerHTML = `<span class="exit-chip">${esc(opt.chip)}</span>
      <button type="button" class="cta-link exit-undo" data-undo-exit="${esc(key)}">Undo</button>`;
  }
  const timer = setTimeout(() => {
    pendingExits.delete(key);
    commit();
  }, EXIT_HOLD_MS);
  pendingExits.set(key, { timer, commit, row, actions, restore });
}

function undoRowExit(key) {
  const held = pendingExits.get(key);
  if (!held) return;
  clearTimeout(held.timer);
  pendingExits.delete(key);
  held.row.classList.remove('is-exiting');
  if (held.actions && held.restore !== null) held.actions.innerHTML = held.restore;
  toast('Kept them where they were');
}

/* Any re-render drops the held rows, so commit them first — otherwise the
   fade silently disappears and the write never happens. */
function flushPendingExits() {
  for (const [key, held] of pendingExits) {
    clearTimeout(held.timer);
    pendingExits.delete(key);
    held.commit();
  }
}

/* ---------- outreach email drafts ---------- */
let emailApplicantId = null;

let emailMode = 'outreach';   // 'outreach' | 'update' (rejection queue)
let emailKind = null;         // typed draft override, e.g. 'visit'

async function openEmailModal(applicantId, kind) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  emailApplicantId = applicantId;
  emailMode = 'outreach';
  emailKind = kind || null;
  document.getElementById('email-send').textContent = 'Send via Agape Gmail';
  document.getElementById('email-title').textContent = kind === 'visit' ? `Invite ${a.first} to visit` : `Email ${fullName(a)}`;
  document.getElementById('email-subject').value = '';
  document.getElementById('email-body').value = '';
  document.getElementById('email-status').textContent = 'Drafting from their application, the listing, and any flags…';
  document.getElementById('email-modal').hidden = false;
  await generateEmail(applicantId);
}

/* Rejection-queue editor: drafts via draft_update, sends via send-update
   (which stamps the queue state server-side). */
/* Batch: draft + send every pending update, sequentially with progress. */
async function sendAllUpdates(btn) {
  const pending = applicants.filter(x => x.stage === 'rejected' && !x.updateSentAt && !x.updateSkippedAt);
  if (!pending.length) return;
  if (!confirm(`Send update emails to ${pending.length} applicant${pending.length === 1 ? '' : 's'}? Each gets an individually drafted community note.`)) return;
  btn.disabled = true;
  let done = 0;
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  for (const a of pending) {
    try {
      btn.textContent = `Sending ${done + 1}/${pending.length}…`;
      const dr = await (await fetch(`${SUPABASE_URL}/functions/v1/recruit-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'draft_update', applicantId: a.id }),
      })).json();
      if (dr.error) throw new Error(dr.error);
      await gmailCall({ action: 'send-update', applicantId: a.id, subject: dr.subject, body: dr.body });
      a.updateSentAt = new Date().toISOString(); a.stage = 'archived';
      done++;
    } catch (e) {
      toast(`${fullName(a)}: ${e.message}`);
    }
  }
  toast(`${done}/${pending.length} update${pending.length === 1 ? '' : 's'} sent`);
  renderRailCounts(); renderApplicants();
}

async function openUpdateEmail(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  emailApplicantId = applicantId;
  emailMode = 'update';
  emailKind = null;
  document.getElementById('email-title').textContent = `Update for ${fullName(a)}`;
  document.getElementById('email-subject').value = '';
  document.getElementById('email-body').value = '';
  document.getElementById('email-send').textContent = 'Send update';
  document.getElementById('email-status').textContent = 'Drafting the community update…';
  document.getElementById('email-modal').hidden = false;
  try {
    const { data } = await sb.auth.getSession();
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data?.session?.access_token}` },
      body: JSON.stringify({ action: 'draft_update', applicantId }),
    });
    const out = await resp.json();
    if (out.error) throw new Error(out.error);
    if (emailApplicantId !== applicantId) return;
    document.getElementById('email-subject').value = out.subject || 'An update from Agape';
    document.getElementById('email-body').value = out.body || '';
    document.getElementById('email-status').textContent = 'Edit freely, then send.';
  } catch (e) {
    document.getElementById('email-status').textContent = `Draft failed: ${e.message}`;
  }
}

async function generateEmail(applicantId) {
  document.getElementById('email-status').textContent = 'Drafting…';
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'draft_email', applicantId, ...(emailKind ? { emailType: emailKind } : {}) }),
    });
    const out = await resp.json();
    if (out.error) throw new Error(out.error);
    if (emailApplicantId !== applicantId) return; // closed / switched meanwhile
    document.getElementById('email-subject').value = out.subject || '';
    document.getElementById('email-body').value = out.body || '';
    const typeLabels = { first_response: 'First response', follow_up: 'Follow-up nudge', reply: 'Reply to their last email', post_call: 'Post-call thank-you', reschedule: 'Reschedule ask' };
    document.getElementById('email-status').textContent =
      `${typeLabels[out.emailType] || 'Outreach'}${out.reason ? ` — ${out.reason}` : ''}. Edit freely, then send.`;
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
    if (btn && document.contains(btn)) { btn.disabled = false; btn.textContent = 'Get an AI read'; }
  }
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

/* ---------- votes + stage machine ---------- */
/* Thresholds come from recruit_settings (tunable without a deploy). */
const voteMin = () => Number(settings.vote_min_count) || 3;
const votePassAvg = () => Number(settings.vote_pass_avg) || 3.5;

const myVote = id => (votes[id] || []).find(v => v.voter_id === me?.id) || null;

function voteStats(id) {
  const list = votes[id] || [];
  const scored = list.filter(v => !v.veto && v.score != null);
  const avg = scored.length ? scored.reduce((s, v) => s + v.score, 0) / scored.length : null;
  return {
    n: list.length,
    scored: scored.length,
    avg,
    veto: list.find(v => v.veto) || null,
  };
}

/* Manual stage moves go through the RPC — recruit_applicants is read-only
   to clients; vote-driven moves happen in the DB trigger. */
async function setStage(id, stage) {
  const { error } = await sb.rpc('recruit_set_stage', { p_applicant: id, p_stage: stage });
  if (error) { toast(`Stage change failed: ${error.message}`); return false; }
  const a = applicants.find(x => x.id === id);
  if (a) a.stage = stage;
  return true;
}

/* Upsert my vote, then pick up whatever stage the DB trigger computed. */
async function castVote(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a || !pendingVote) return;
  const note = (document.getElementById('vote-note')?.value || '').trim();
  const { score, veto } = pendingVote;
  if (!veto && !score) { toast('Pick a score — or veto'); return; }
  if (veto && note.length < 3) { toast('A veto needs a short why'); return; }
  const { data, error } = await sb.from('recruit_votes').upsert({
    applicant_id: applicantId, voter_id: me.id, voter_name: me.name,
    score: veto ? null : score, veto, note,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id,voter_id' }).select().single();
  if (error) { toast(`Vote failed: ${error.message}`); return; }
  votes[applicantId] = [...(votes[applicantId] || []).filter(v => v.voter_id !== me.id), data];
  const { data: fresh } = await sb.from('recruit_applicants').select('stage').eq('id', applicantId).single();
  const before = a.stage;
  if (fresh) a.stage = fresh.stage;
  pendingVote = null;
  const st = voteStats(applicantId);
  if (a.stage === 'rejected') toast(`${fullName(a)} vetoed — auto-archived, update email queued`);
  else if (a.stage === 'candidate' && before !== 'candidate') {
    if (!houseLoaded) await loadHouse();
    const added = await syncAutoPlacements();
    toast(`${fullName(a)} passed review → Candidates${added ? ` · placed in ${added} listing${added === 1 ? '' : 's'}` : ''}`);
  } else toast(`Vote saved — ${st.scored}/${voteMin()} votes${st.avg ? ` · avg ${st.avg.toFixed(1)}` : ''}`);
  renderRailCounts();
  renderReview();
}

/* House rule: a stated budget ceiling under $1,500/mo is an auto-flag —
   straight to Archive (rejected: an update email is owed). Recorded as a
   decision too, for attribution and undo. */
async function applyAutoFlags() {
  const auto = applicants.filter(a => a.stage === 'review' && !decisions[a.id]
    && budgetMax(a.budget) !== null && budgetMax(a.budget) < 1500);
  for (const a of auto) {
    await saveDecision(a.id, 'pass', 'budget', 'Auto — budget under $1,500');
    await setStage(a.id, 'rejected');
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
  const [rRes, sRes, lRes] = await Promise.all([
    sb.from('recruit_rooms').select('*').order('sort'),
    sb.from('recruit_stays').select('*').order('starts_on'),
    sb.from('recruit_listings').select('*').order('starts_on'),
  ]);
  rooms = rRes.data || [];
  stays = sRes.data || [];
  listings = lRes.data || [];
  houseLoaded = true;
}

/* ---------- router ---------- */
function setView(next, push = true) {
  next = LEGACY_VIEWS[next] || next;
  if (!VIEWS[next]) next = 'inbox';
  view = next;
  if (push) {
    const url = new URL(location);
    url.searchParams.set('view', view);
    url.searchParams.delete('a');
    url.searchParams.delete('room');
    if (view === 'occupancy' && pendingOccRoom) url.searchParams.set('room', String(pendingOccRoom));
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
  const headAction = document.getElementById('page-head-action');
  if (headAction) headAction.innerHTML = view === 'openings' ? `<button class="btn btn--sm" data-new-listing>New listing</button>` : '';
  document.querySelectorAll('[data-view-link]').forEach(el =>
    el.classList.toggle('is-current', el.dataset.viewLink === view && el.classList.contains('rail-nav__row')));
  renderRailCounts();

  const root = document.getElementById('view-root');
  if ((def.kind === 'house' || view === 'openings') && !houseLoaded) {
    root.innerHTML = `<p class="inbox-empty">Loading…</p>`;
    await loadHouse();
    if (VIEWS[view].kind !== 'house') return; // navigated away meanwhile
  }
  if (def.kind === 'applicants') renderApplicants();
  else if (view === 'occupancy') renderOccupancy();
}

/* ---------- applicants render ---------- */
function matchesView(a) {
  const out = a.stage !== 'rejected' && a.stage !== 'archived';
  // A standing veto means archived — never show them here, whatever the stage says.
  if (view === 'inbox') return a.stage === 'review' && !voteStats(a.id).veto;
  // Saved for future stays a candidate — visible in Candidates with its chip,
  // absent from Openings until the return date brings them back.
  if (view === 'candidates') return a.stage === 'candidate';
  if (view === 'openings') return activePlacements(a.id).length > 0 && out && !a.exitReason;
  if (view === 'screening') return !!screeningState[a.id] && out;
  if (view === 'archive') return !out;
  return false;
}

/* Shared filters — applied on top of whichever applicant view is open. */
function moveInBucket(a) {
  const norm = effectiveMoveIn(a);
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
  const c = { inbox: 0, candidates: 0, openings: 0, screening: 0, archive: 0 };
  for (const a of applicants) {
    if (a.stage === 'rejected' || a.stage === 'archived') { c.archive++; continue; }
    if (a.stage === 'review') c.inbox++;
    else if (a.stage === 'candidate') c.candidates++;
    if (activePlacements(a.id).length) c.openings++;
    if (screeningState[a.id]) c.screening++;
  }
  return c;
}

function renderRailCounts() {
  const c = counts();
  for (const key of ['inbox', 'candidates', 'openings', 'screening', 'archive']) {
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

/* Per-view row badge: vote progress in Review, funnel state in Archive,
   call state in Screening, the recruiter decision elsewhere. */
function voteChip(a) {
  const st = voteStats(a.id);
  if (st.veto) return `<span class="decision-chip decision-chip--pass" title="Vetoed by ${esc(st.veto.voter_name || 'a housemate')}">Vetoed</span>`;
  if (!st.scored) return '';
  // The average stays blind until you've cast your own vote.
  if (!myVote(a.id)) return `<span class="decision-chip decision-chip--vote" title="${voteMin()} votes needed — tally shows after you vote">${st.scored}/${voteMin()} votes</span>`;
  const passing = st.scored >= voteMin() && st.avg >= votePassAvg();
  return `<span class="decision-chip decision-chip--vote ${passing ? 'decision-chip--outreach' : ''}" title="${st.scored} of ${voteMin()} votes needed · passing average is ${votePassAvg()}">${st.scored}/${voteMin()} · avg ${st.avg.toFixed(1)}</span>`;
}

function stageChip(a) {
  if (a.stage === 'rejected') {
    const st = voteStats(a.id);
    const why = st.veto ? `Vetoed by ${st.veto.voter_name || 'a housemate'}` : (decisions[a.id]?.note || 'Did not pass review');
    return `<span class="decision-chip decision-chip--hold" title="${esc(why)}">Update queued</span>`;
  }
  if (decisions[a.id]?.reason === 'dropped-out') return `<span class="decision-chip decision-chip--vote" title="They withdrew — no update email owed">Dropped out</span>`;
  if (a.updateSentAt) return `<span class="decision-chip decision-chip--outreach" title="Update email sent">Update sent ${fmtDate(a.updateSentAt)}</span>`;
  return `<span class="decision-chip decision-chip--pass">Archived</span>`;
}

function screeningChip(a) {
  const sc = screeningState[a.id];
  if (!sc) return '';
  const phase = callPhase(sc);
  if (phase === 'watch') return watchBtn(sc);
  if (phase === 'processing') return processingChip();
  if (phase === 'live') return joinBtn(sc) || processingChip();
  if (phase === 'scheduled') return `<span class="decision-chip decision-chip--outreach" title="Intro Call${sc.with ? ` with ${esc(sc.with)}` : ''}">${fmtSlot(sc.at)}</span>`;
  return `<span class="decision-chip decision-chip--vote">Availability received</span>`;
}

/* Playback-speed row for a <video>. Browsers bury speed in a menu (and iOS
   omits it), so surface it; the choice sticks across calls. */
const PLAY_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const RATE_KEY = 'agape:watchRate';

function savedRate() {
  const r = parseFloat(localStorage.getItem(RATE_KEY));
  return PLAY_RATES.includes(r) ? r : 1;
}

/* Controls ride on the player itself (top-right), not as a row beneath it:
   playback speed and pop-out, matching the public watch page. */
function speedOverlayHtml(videoId) {
  const cur = savedRate();
  return `<div class="vchrome">
    <div class="vspeed" data-speed-for="${videoId}">
      <button type="button" class="vspeed__btn" aria-haspopup="true" aria-expanded="false">${cur}×</button>
      <div class="vspeed__menu" role="menu">
        ${PLAY_RATES.map(r => `<button type="button" role="menuitemradio" data-rate="${r}" aria-checked="${r === cur}">${r}×</button>`).join('')}
      </div>
    </div>
    <button type="button" class="vspeed__btn vpip" data-pip-for="${videoId}" title="Pop out into a floating window">⧉</button>
  </div>`;
}

/* Native picture-in-picture, so the call keeps playing when you switch tabs. */
function wirePip(videoId) {
  const btn = document.querySelector(`[data-pip-for="${videoId}"]`);
  const video = document.getElementById(videoId);
  if (!btn || !video) return;
  if (!document.pictureInPictureEnabled || video.disablePictureInPicture) { btn.hidden = true; return; }
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch { /* browser declined — inline playback still works */ }
  });
}

function wireSpeedBar(videoId) {
  const wrap = document.querySelector(`[data-speed-for="${videoId}"]`);
  const video = document.getElementById(videoId);
  if (!wrap || !video) return;
  const trigger = wrap.querySelector('.vspeed__btn');
  const menu = wrap.querySelector('.vspeed__menu');
  const apply = rate => {
    video.playbackRate = rate;
    localStorage.setItem(RATE_KEY, String(rate));
    trigger.textContent = `${rate}×`;
    menu.querySelectorAll('[data-rate]').forEach(b =>
      b.setAttribute('aria-checked', String(parseFloat(b.dataset.rate) === rate)));
  };
  const close = () => { menu.classList.remove('is-open'); trigger.setAttribute('aria-expanded', 'false'); };
  trigger.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.classList.toggle('is-open');
    trigger.setAttribute('aria-expanded', String(open));
  });
  menu.addEventListener('click', e => {
    const btn = e.target.closest('[data-rate]');
    if (!btn) return;
    e.stopPropagation();
    apply(parseFloat(btn.dataset.rate));
    close();
  });
  document.addEventListener('click', close);
  // Setting src resets playbackRate, so re-apply once metadata lands.
  video.addEventListener('loadedmetadata', () => { video.playbackRate = savedRate(); });
  apply(savedRate());
}

/* ---------- app-level player ----------------------------------------------
   One <video> for the whole app. It is moved into the Call tab's mount while
   that tab is open and docked bottom-right the rest of the time, so a call
   keeps playing while you navigate. Moves are synchronous (remove + insert in
   one task) — the spec only pauses a media element that stays detached. */

const gp = { applicantId: null, screeningId: null, title: '', loading: false };

function gpEl() { return document.getElementById('gplayer'); }
function gpVideo() { return document.getElementById('gp-video'); }
function gpPlaying() { const v = gpVideo(); return v && !v.paused && !v.ended && v.currentSrc; }

function gpSetMode(mode) {
  const el = gpEl();
  if (!el) return;
  el.classList.toggle('is-mini', mode === 'mini');
  el.classList.toggle('is-inline', mode === 'inline');
  el.classList.toggle('is-hidden', mode === 'hidden');
}

/* Where should the player live right now? Inline when its own applicant's
   Call tab is open and scrolled into view; docked while it plays anywhere
   else; hidden when nothing is playing. */
function gpSyncPlacement() {
  const el = gpEl();
  if (!el || !gp.applicantId) return;
  const mount = document.getElementById('call-player-mount');
  const reviewOpen = !document.getElementById('review')?.hidden;
  const onItsCallTab = reviewOpen && reviewTab === 'call' && queue[qIndex] === gp.applicantId && mount;

  let inline = false;
  if (onItsCallTab) {
    const scroller = document.querySelector('.review__scroll');
    const m = mount.getBoundingClientRect();
    const b = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const visible = m.bottom > b.top + 56 && m.top < b.bottom - 56;
    // Keep the mount's height while docked so the tab doesn't collapse.
    if (mount.offsetHeight > 40) mount.style.minHeight = `${mount.offsetHeight}px`;
    inline = visible || !gpPlaying();
  }

  if (inline) {
    if (el.parentElement !== mount) mount.appendChild(el);
    gpSetMode('inline');
  } else {
    if (el.parentElement !== document.body) document.body.appendChild(el);
    gpSetMode(gpPlaying() ? 'mini' : 'hidden');
  }
}

/* Point the player at an applicant's recording. Returns false when there is
   nothing streamable. Does not autoplay unless asked. */
async function gpLoad(applicantId, { autoplay = false } = {}) {
  const sc = screeningState[applicantId] || {};
  if (!sc.watch || sc.watchExternal) return false;
  const a = applicants.find(x => x.id === applicantId);
  const title = a ? fullName(a) : 'Intro call';
  if (gp.screeningId === sc.watch && gpVideo()?.currentSrc) {
    gp.applicantId = applicantId;
    if (autoplay) { try { await gpVideo().play(); } catch { /* gesture required */ } }
    gpSyncPlacement();
    return true;
  }
  gp.applicantId = applicantId;
  gp.screeningId = sc.watch;
  gp.title = title;
  gp.loading = true;
  document.getElementById('gp-title').textContent = title;
  gpSetMode(autoplay ? 'mini' : 'inline');
  try {
    const out = await gmailCall({ action: 'recording-link', screeningId: sc.watch });
    const v = gpVideo();
    if (!out.url || !v) throw new Error('Recording unavailable');
    v.src = out.url;
    v.playbackRate = savedRate();
    if (autoplay) { try { await v.play(); } catch { /* gesture required */ } }
  } catch (e) {
    gp.loading = false;
    toast(`Recording unavailable: ${e.message}`);
    gpSetMode('hidden');
    return false;
  }
  gp.loading = false;
  gpSyncPlacement();
  return true;
}

/* Row ▶ — start straight into the docked player, no navigation. */
async function gpPlayMini(applicantId) {
  const ok = await gpLoad(applicantId, { autoplay: true });
  if (ok) gpSyncPlacement();
}

function gpStop() {
  const v = gpVideo();
  try { v.pause(); } catch { /* not started */ }
  v?.removeAttribute('src');
  gp.applicantId = null;
  gp.screeningId = null;
  document.body.appendChild(gpEl());
  gpSetMode('hidden');
}

function initGlobalPlayer() {
  const v = gpVideo();
  if (!v) return;
  wireSpeedBar('gp-video');
  wirePip('gp-video');
  v.addEventListener('play', gpSyncPlacement);
  v.addEventListener('pause', gpSyncPlacement);
  v.addEventListener('ended', gpSyncPlacement);
  v.addEventListener('loadedmetadata', () => { v.playbackRate = savedRate(); });
  window.addEventListener('resize', gpSyncPlacement);
  // The review pane scrolls independently of the page.
  document.addEventListener('scroll', gpSyncPlacement, { capture: true, passive: true });
  // The docked player sits outside the review overlay, so its clicks would
  // otherwise bubble to the outside-click handler that closes the review —
  // reopening and immediately closing it.
  document.getElementById('gp-close').addEventListener('click', (e) => { e.stopPropagation(); gpStop(); });
  document.getElementById('gp-expand').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!gp.applicantId) return;
    openReview(gp.applicantId);
    reviewTab = 'call';
    renderReview();
    gpSyncPlacement();
  });
}

/* ---------- recording viewer: video + call notes + house comments ---------- */
let watchApplicantId = null;

/* Tiny renderer for the Haiku summary (headings, bold, bullets). */
function mdLite(md) {
  return esc(md)
    .replace(/^#+\s*(.+)$/gm, '<strong class="watch-md__h">$1</strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*]\s+(.+)$/gm, '<span class="watch-md__li">• $1</span>')
    .replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
}

function renderWatchNotes() {
  const host = document.getElementById('watch-notes');
  if (!host) return;
  if (!comments.length) { host.innerHTML = `<p class="notes__empty">No notes yet — be the first.</p>`; return; }
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
    </li>`).join('')}</ul>`;
}

async function postWatchNote() {
  const input = document.getElementById('watch-note-input');
  const body = (input.value || '').trim();
  if (!body || !watchApplicantId) return;
  input.value = '';
  const { data, error } = await sb.from('recruit_comments')
    .insert({ applicant_id: watchApplicantId, user_id: me.id, author_name: me.name, body })
    .select().single();
  if (error) { toast(`Note failed: ${error.message}`); input.value = body; return; }
  comments.push(data);
  commentCounts[watchApplicantId] = comments.length;
  renderWatchNotes();
}

/* Call tab: recording + AI summary + the house's comments, with a
   timestamp-stamp affordance. Same recruit_comments store as House notes. */
async function loadCallPanel(a) {
  const host = () => document.getElementById('call-panel');
  if (!host()) return;
  const sc = screeningState[a.id] || {};
  // sc.watch covers both our own captures and pasted links; only the former
  // can actually be played inline.
  const streamable = Boolean(sc.watch) && !sc.watchExternal;
  let row = null;
  if (sc.watch) {
    ({ data: row } = await sb.from('recruit_screenings')
      .select('id, housemate_name, starts_at, recording_summary, external_recording_url, external_recording_source, external_recording_by_name')
      .eq('id', sc.watch).maybeSingle());
  } else {
    ({ data: row } = await sb.from('recruit_screenings')
      .select('id, housemate_name, starts_at, recording_summary, external_recording_url, external_recording_source, external_recording_by_name')
      .eq('applicant_id', a.id).order('starts_at', { ascending: false }).limit(1).maybeSingle());
  }
  if (queue[qIndex] !== a.id || reviewTab !== 'call' || !host()) return;
  if (!row) {
    host().innerHTML = `<p class="notes__empty">No intro call yet.</p>
      <p class="notes__empty"><button type="button" class="cta-link" data-add-recording="${a.id}">Add a recording link</button> — if the call happened on tldv or elsewhere.</p>`;
    return;
  }
  host().innerHTML = `
    <p class="notes__empty">${esc(`${row.housemate_name ? `${row.housemate_name} × ` : ''}${fullName(a)}`)} · ${row.starts_at ? fmtSlot(row.starts_at) : ''}</p>
    ${streamable
      ? `<div id="call-player-mount" class="call-player-mount"></div>
         <p class="email-modal__status" id="call-status"></p>`
      : row.external_recording_url
        // These hosts block cross-origin embedding, so this opens out rather
        // than pretending to be a player.
        ? `<p class="external-rec"><a class="btn btn--sm btn--watch" href="${esc(row.external_recording_url)}" target="_blank" rel="noopener">Watch on ${esc(row.external_recording_source || 'the host')}</a>
             <span class="notes__empty">added${row.external_recording_by_name ? ` by ${esc(row.external_recording_by_name)}` : ''} · <button type="button" class="cta-link" data-add-recording="${a.id}">replace</button></span></p>`
        : `<p class="notes__empty">The recording lands here after the call. <button type="button" class="cta-link" data-add-recording="${a.id}">Add a link</button> if it was recorded elsewhere.</p>`}
    ${row.recording_summary ? `<section class="review__section"><h3 class="review__section-title">Call summary</h3>${mdLite(row.recording_summary)}</section>` : ''}
    <section class="review__section notes">
      <div class="notes__head">
        <h3 class="review__section-title">Comments</h3>
        ${streamable ? `<button type="button" class="btn btn--sm" id="call-stamp" title="Prefix your comment with the video's current time">Comment at current time</button>` : ''}
      </div>
      <div id="notes-body"><p class="notes__empty">Loading comments…</p></div>
      <form class="notes__form" id="notes-form-call">
        <textarea class="notes__input" id="notes-input" placeholder="Comment on the call — visible to the whole house." maxlength="4000"></textarea>
        <button class="btn btn--accent btn--sm notes__submit" type="submit">Add comment</button>
      </form>
    </section>`;
  loadComments(a.id).then(() => { if (queue[qIndex] === a.id && reviewTab === 'call') renderNotes(a.id); });
  document.getElementById('notes-form-call')?.addEventListener('submit', (ev) => { ev.preventDefault(); postNote(a.id); });
  document.getElementById('call-stamp')?.addEventListener('click', () => {
    const v = gpVideo();
    const t = v?.currentTime || 0;
    const stamp = `[${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}] `;
    const input = document.getElementById('notes-input');
    if (input && !input.value.startsWith(stamp)) input.value = stamp + input.value;
    input?.focus();
  });
  if (streamable) {
    const st = document.getElementById('call-status');
    if (gp.applicantId !== a.id) { if (st) st.textContent = 'Fetching recording…'; }
    const ok = await gpLoad(a.id);
    if (st) st.textContent = ok ? '' : 'Recording unavailable';
  } else {
    // Another call may be docked; leaving this tab must not strand it.
    gpSyncPlacement();
  }
}

async function openWatch(screeningId) {
  const modal = document.getElementById('watch-modal');
  const video = document.getElementById('watch-video');
  const status = document.getElementById('watch-status');
  modal.hidden = false;
  video.removeAttribute('src');
  status.textContent = 'Fetching recording…';
  document.getElementById('watch-summary').innerHTML = '';
  document.getElementById('watch-notes').innerHTML = '';
  try {
    const { data: sRow } = await sb.from('recruit_screenings')
      .select('applicant_id, housemate_name, starts_at, recording_summary')
      .eq('id', screeningId).maybeSingle();
    const a = applicants.find(x => x.id === sRow?.applicant_id);
    watchApplicantId = sRow?.applicant_id || null;
    document.getElementById('watch-title').textContent =
      `${a ? fullName(a) : 'Agape intro call'}${sRow?.housemate_name ? ` × ${sRow.housemate_name}` : ''} · ${sRow?.starts_at ? fmtSlot(sRow.starts_at) : ''}`;
    document.getElementById('watch-summary').innerHTML =
      sRow?.recording_summary ? mdLite(sRow.recording_summary) : '<p class="notes__empty">No summary was captured for this call.</p>';
    if (watchApplicantId) { await loadComments(watchApplicantId); renderWatchNotes(); }
    const out = await gmailCall({ action: 'recording-link', screeningId });
    if (!out.url) throw new Error('recording not available');
    video.src = out.url;
    status.textContent = '';
    wireSpeedBar('watch-video');
    wirePip('watch-video');
  } catch (e) {
    status.textContent = `Recording unavailable: ${e.message}`;
  }
}

function closeWatch() {
  const modal = document.getElementById('watch-modal');
  const video = document.getElementById('watch-video');
  try { video.pause(); } catch { /* not started */ }
  video.removeAttribute('src');
  modal.hidden = true;
  watchApplicantId = null;
}

/* One pill per room they're placed in, with the room's open date. Falls
   back to a count before house data lands. */
function placementChip(a) {
  const active = activePlacements(a.id);
  if (!active.length) return '';
  if (!houseLoaded) return `<span class="decision-chip decision-chip--outreach">In ${active.length} listing${active.length === 1 ? '' : 's'}</span>`;
  return active.map(p => {
    const l = listings.find(x => x.id === p.listing_id);
    if (!l || l.status !== 'open') return '';
    const room = rooms.find(r => r.id === l.room_id);
    const d = new Date(l.starts_on + 'T12:00');
    return `<span class="decision-chip decision-chip--outreach" title="${esc(`${room?.name || 'Room'} — ${l.kind === 'resident' ? 'resident trial' : 'sublet'} from ${fmtDay(l.starts_on)}`)}">${esc(room?.name || 'Room')} · ${d.getMonth() + 1}/${d.getDate()}</span>`;
  }).join('');
}

function rowBadge(a) {
  if (view === 'inbox') return voteChip(a);
  // Archive carries two facts: which kind of no, and whether they've been
  // told. The email chip only earns its place when an email is actually
  // owed or sent — "opted out · Archived" is noise.
  if (view === 'archive') {
    const owed = a.stage === 'rejected' || a.updateSentAt;
    return exitChip(a) + (owed || !a.exitReason ? stageChip(a) : '');
  }
  if (view === 'screening') return screeningChip(a);
  if (view === 'candidates') return exitChip(a) || placementChip(a);
  return decisionChip(a.id);
}

function renderApplicants() {
  // Held rows die on re-render, so their writes have to land first.
  flushPendingExits();
  const viewList = applicants.filter(matchesView);
  const list = viewList.filter(matchesFilters);
  const filtered = list.length !== viewList.length;
  document.getElementById('page-sub').textContent =
    (filtered ? `${list.length} of ${viewList.length}` : `${viewList.length}`) +
    ` applicant${(filtered ? viewList.length : list.length) === 1 ? '' : 's'}` +
    (view === 'inbox' ? ` gathering votes · ${voteMin()} needed, one veto rejects` :
     view === 'candidates' ? ' passed review — waiting for a room' : '');

  const host = document.getElementById('view-root');
  host.className = 'inbox';
  const bar = view === 'inbox' || view === 'openings' ? '' : renderFilterBar(viewList); // inbox + openings stay clean
  if (!list.length) {
    host.innerHTML = bar + `<p class="inbox-empty">${filtered ? 'No applicants match these filters.' : (view === 'inbox' ? 'All caught up — every application has its votes.' : 'Nothing here yet.')}</p>`;
    return;
  }
  // Openings groups by listing (custom-orderable); other views group by month.
  const groups = [];
  if (view === 'openings') {
    // A candidate appears under EVERY open listing they're placed in.
    const byKey = new Map();
    for (const l of listings.filter(x => x.status === 'open')) byKey.set(l.id, []);
    for (const a of list) {
      for (const p of activePlacements(a.id)) {
        if (byKey.has(p.listing_id)) byKey.get(p.listing_id).push(a);
      }
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
    if (view !== 'openings') return `<h2 class="inbox-group__label">${monthLabel(g.key)}</h2>`;
    const l = listings.find(x => x.id === g.key);
    if (!l) return `<h2 class="inbox-group__label">Listing removed</h2>`;
    const room = rooms.find(r => r.id === l.room_id);
    return `<div class="listing-head__text">
        <h2 class="inbox-group__label">
          <a class="listing-head__room" href="?view=occupancy&room=${l.room_id}" data-occ-room-link="${l.room_id}" title="View on the occupancy calendar">${esc(room?.name || 'Room')}</a>
          <span class="listing-kind listing-kind--${l.kind}">${l.kind === 'resident' ? 'Resident trial' : 'Sublet'}</span>
        </h2>
        <span class="inbox-group__count">${listingMeta(l)}</span>
      </div>
      <span class="listing-head__actions">${listingMenuHtml(l)}</span>`;
  };

  // Archive: the update-email tray sits above the list. Openings: draft
  // listings detected from occupancy gaps sit above the shortlists.
  let outreachChrome = recordingLeadsHtml();
  if (view === 'archive') {
    const pending = applicants.filter(x => x.stage === 'rejected' && !x.updateSentAt && !x.updateSkippedAt);
    if (pending.length) {
      outreachChrome = `<div class="update-tray">
        <div class="update-tray__head">
          <b>${pending.length} applicant${pending.length === 1 ? '' : 's'} haven't been told yet</b>
          <button type="button" class="btn btn--sm cta--amber" data-send-all-updates>Send all ${pending.length}</button>
        </div>
        ${pending.map(x => `<div class="update-tray__row">
          <span class="update-tray__who">${esc(fullName(x))}</span>
          <span class="update-tray__why">${voteStats(x.id).veto ? `vetoed by ${esc(voteStats(x.id).veto.voter_name || 'a housemate')}` : (decisions[x.id]?.note || 'did not pass review')}</span>
          <button type="button" class="cta-link" data-update-edit="${x.id}">Edit email</button>
          <button type="button" class="cta-link" data-update-skip="${x.id}">Skip</button>
        </div>`).join('')}
      </div>`;
    }
  }
  if (view === 'openings') {
    const drafts = listings.filter(l => l.status === 'draft');
    if (drafts.length) {
      outreachChrome = drafts.map(l => {
        const room = rooms.find(r => r.id === l.room_id);
        return `<div class="draft-card">
          <span class="draft-card__text"><b>Draft — ${esc(room?.name || 'Room')}, ${l.kind === 'resident' ? `opens ${fmtDay(l.starts_on)}` : `${fmtDay(l.starts_on)} – ${l.ends_on ? fmtDay(l.ends_on) : 'TBD'}`}</b>
          <span>Detected from the occupancy calendar · invisible to bucketing until opened</span></span>
          <span class="draft-card__actions">
            <button type="button" class="cta-link" data-delete-listing="${l.id}">Dismiss</button>
            <button type="button" class="btn btn--sm" data-open-draft="${l.id}">Open listing</button>
          </span>
        </div>`;
      }).join('');
    }
  }
  const doneListings = view === 'openings' ? listings.filter(l => l.status !== 'open') : [];
  const doneDrawer = doneListings.length ? `
    <details class="occupants__past">
      <summary>Filled & closed listings (${doneListings.length})</summary>
      <ul class="inbox-card listing-list">
        ${doneListings.map(l => {
          const room = rooms.find(r => r.id === l.room_id);
          return `<li class="inbox-row listing-row is-done">
            <span class="inbox-row__text">
              <span class="inbox-row__title">
                <a class="listing-head__room" href="?view=occupancy&room=${l.room_id}" data-occ-room-link="${l.room_id}" title="View on the occupancy calendar">${esc(room?.name || 'Room')}</a>
                <span class="listing-kind listing-kind--${l.kind}">${l.kind === 'resident' ? 'Resident trial' : 'Sublet'}</span>
              </span>
              <span class="inbox-row__sub">${listingWindow(l)}</span>
            </span>
            <span class="inbox-row__actions">
              <span class="note-count">${l.status}</span>
              ${listingMenuHtml(l)}
            </span>
          </li>`;
        }).join('')}
      </ul>
    </details>` : '';
  const outreachHint = view === 'openings' ? `<p class="listing-hint">Listings also come from the <a href="?view=occupancy" data-view-link="occupancy">Occupancy calendar</a>: click an open stretch, or mark a resident as leaving.</p>` : '';

  host.innerHTML = bar + outreachChrome + groups.map(g => `
    <section class="inbox-group ${view === 'openings' && g.key !== 'general' ? 'listing-group' : ''}" ${view === 'openings' ? `data-group-key="${esc(g.key)}"` : ''}>
      <div class="inbox-group__head ${view === 'openings' ? 'listing-head' : ''}">
        ${groupHead(g)}
        <span class="inbox-group__count listing-head__n">${g.items.length} applicant${g.items.length === 1 ? '' : 's'}</span>
      </div>
      ${view === 'openings' && !g.items.length ? `<p class="inbox-empty inbox-empty--group">No qualifying candidates yet — they land here automatically when they pass review.</p>` : `<ul class="inbox-card">
        ${g.items.map(a => `
          <li class="inbox-row" ${view === 'openings' ? `draggable="true" data-row-id="${a.id}" data-row-group="${esc(g.key)}"` : ''}>
            ${repliedDot(a)}
            ${view === 'openings' ? '<span class="inbox-row__grip" title="Drag to reorder — or drop on another listing to move them">⠿</span>' : ''}
            <button class="inbox-row__main" data-review="${a.id}">
              ${avatarHtml(a)}
              <span class="inbox-row__text">
                <span class="inbox-row__title">${esc(fullName(a))}</span>
                <span class="inbox-row__sub">${trackBadge(a)}${esc(subLine(a))}</span>
              </span>
            </button>
            <span class="inbox-row__actions">
              ${noteBubble(a.id)}
              ${view === 'openings'
                ? `${openingsCta(a)}${rowMenuHtml(a, g.key)}`
                : `${rowBadge(a)}${view === 'inbox' && !myVote(a.id) ? `<button class="btn inbox-row__review" data-review="${a.id}">Review</button>` : ''}`}
            </span>
          </li>`).join('')}
      </ul>`}
      ${view === 'openings' ? othersAccordion(g.key) : ''}
    </section>`).join('') + doneDrawer + outreachHint;
  if (view === 'openings') wireRowDrag(host);
}

/* Collapsed rail of everyone else who'd fit this listing — removed
   candidates can be re-added; Inbox folks link to their review page. */
function othersAccordion(listingId) {
  const others = otherQualified(listingId);
  if (!others.length) return '';
  return `<details class="listing-others">
    <summary>See other qualified applicants (${others.length}) <span class="listing-others__chev" aria-hidden="true">▾</span></summary>
    <ul class="inbox-card">
      ${others.map(a => {
        const removed = placements.some(p => p.applicant_id === a.id && p.listing_id === listingId && p.status === 'removed');
        return `<li class="inbox-row">
          ${repliedDot(a)}
          <button class="inbox-row__main" data-review="${a.id}">
            ${avatarHtml(a)}
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(fullName(a))}</span>
              <span class="inbox-row__sub">${trackBadge(a)}${esc(subLine(a))}</span>
            </span>
          </button>
          <span class="inbox-row__actions">
            ${a.stage === 'review' ? (voteChip(a) || '<span class="note-count">gathering votes</span>') : (removed ? '<span class="note-count" title="Removed from this listing by a recruiter">removed</span>' : '')}
            ${a.stage === 'candidate' ? `<button class="btn btn--sm inbox-row__review" data-add-placement="${a.id}|${esc(listingId)}">Add</button>` : ''}
          </span>
        </li>`;
      }).join('')}
    </ul>
  </details>`;
}

/* Row-level ⋯: navigation up top, one Remove… below the rule. The four
   removal outcomes live in the sheet rather than the menu — each needs a
   consequence line ("queues an update email") that a menu can't carry. */
function rowMenuHtml(a, listingId) {
  const mid = `row-${a.id}-${listingId}`;
  return `<span class="listing-menu-wrap">
    <button type="button" class="btn btn--sm listing-menu-btn" data-listing-menu="${esc(mid)}" aria-label="Applicant actions" aria-haspopup="menu">⋮</button>
    <span class="listing-menu" data-menu-for="${esc(mid)}" hidden>
      <button type="button" class="listing-menu__item" data-review="${a.id}">Open profile</button>
      ${a.scheduleToken ? `<button type="button" class="listing-menu__item" data-copy-schedule="${a.id}">Copy availability link</button>` : ''}
      ${screeningState[a.id]?.watch ? `<button type="button" class="listing-menu__item" data-give-decision="${a.id}">Give decision…</button>` : ''}
      <button type="button" class="listing-menu__item" data-add-recording="${a.id}">Add recording link…</button>
      <span class="listing-menu__rule" aria-hidden="true"></span>
      <button type="button" class="listing-menu__item" data-open-remove="${a.id}|${esc(listingId)}">Remove…</button>
    </span>
  </span>`;
}

/* Exit state on a row outside Openings — Candidates shows saved-for-future
   with its return date, Archive shows which kind of no it was. */
function exitChip(a) {
  if (!a.exitReason) return '';
  const opt = removeOption(a.exitReason);
  if (!opt) return '';
  const when = a.exitReason === 'future' && a.exitUntil ? ` · ${fmtDay(a.exitUntil)}` : '';
  const who = a.exitBy ? ` by ${a.exitBy}` : '';
  return `<span class="decision-chip decision-chip--exit decision-chip--exit-${esc(a.exitReason)}" title="${esc(opt.hint)}${esc(who)}">${esc(opt.chip)}${esc(when)}</span>`;
}

/* Occupancy-gap sweep: stretches of 28+ days with nothing scheduled in the
   next six months become DRAFT listings (invisible to bucketing until a
   human opens them). Dedup: skip when any listing for the room starts
   within 21 days of the gap. */
async function syncDraftListings() {
  if (!houseLoaded) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const horizon = addMonthsIso(today.slice(0, 7) + '-01', 6);
  let created = 0;
  for (const r of rooms) {
    const covered = stays.filter(x => x.room_id === r.id)
      .map(x => [x.starts_on, x.ends_on || '9999-12-31'])
      .filter(([a, b]) => a <= horizon && b >= today)
      .sort((x, y) => x[0].localeCompare(y[0]));
    const gaps = [];
    let cursor = today;
    for (const [a, b] of covered) {
      if (a > cursor) gaps.push([cursor, isoAddDays(a, -1)]);
      if (b >= cursor) cursor = isoAddDays(b, 1);
      if (cursor > horizon) break;
    }
    if (cursor <= horizon) gaps.push([cursor, null]); // open-ended
    for (const [gs, ge] of gaps) {
      const days = ge ? Math.round((new Date(ge) - new Date(gs)) / 86400000) : 999;
      if (days < 28) continue;
      const near = listings.some(l => l.room_id === r.id &&
        Math.abs(new Date(l.starts_on) - new Date(gs)) < 21 * 86400000);
      if (near) continue;
      const rec = {
        room_id: r.id, kind: ge && days <= 95 ? 'sublet' : 'resident',
        starts_on: gs, ends_on: ge && days <= 95 ? ge : null,
        status: 'draft', source: 'gap',
        notes: `Auto-detected occupancy gap (${fmtDay(gs)}${ge ? ` – ${fmtDay(ge)}` : ' onward'}).`,
        created_by: me.id, created_by_name: 'auto',
      };
      const { data, error } = await sb.from('recruit_listings').insert(rec).select().single();
      if (!error && data) { listings.push(data); created++; }
    }
  }
  return created;
}

/* Post-screening decision sheet: yes / no + note, one row per housemate. */
async function giveDecision(applicantId, verdict) {
  const note = (document.getElementById('gd-note')?.value || '').trim();
  const { data, error } = await sb.from('recruit_decision_votes').upsert({
    applicant_id: applicantId, voter_id: me.id, voter_name: me.name,
    verdict, note, updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id,voter_id' }).select().single();
  if (error) { toast(`Decision failed: ${error.message}`); return; }
  decisionVotes[applicantId] = [...(decisionVotes[applicantId] || []).filter(v => v.voter_id !== me.id), data];
  document.getElementById('gd-modal').hidden = true;
  toast(`Decision saved — ${(decisionVotes[applicantId] || []).length} in`);
  if (VIEWS[view]?.kind === 'applicants') renderApplicants();
  if (!document.getElementById('review').hidden) renderReview();
}

function openGiveDecision(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  const modal = document.getElementById('gd-modal');
  const dv = decisionVotes[applicantId] || [];
  const mine = dv.find(v => v.voter_id === me?.id);
  document.getElementById('gd-title').textContent = `Would you accept ${a.first}?`;
  document.getElementById('gd-tally').innerHTML = mine || dv.length
    ? dv.map(v => `<span class="chip-line">${esc(v.voter_name || 'Housemate')} · <b>${v.verdict}</b>${v.note ? ` — ${esc(v.note)}` : ''}</span>`).join('')
    : '<span class="notes__empty">You\'re first — others see the tally after they decide.</span>';
  document.getElementById('gd-note').value = mine?.note || '';
  modal.dataset.applicant = applicantId;
  modal.hidden = false;
}

/* Drag applicants inside a listing group to reorder, or across groups to
   move them to another opening. Same-group drops write shared row order;
   cross-group drops are a real placement move (drop the source, add the
   target) so the auto-sweep won't undo either half. */
let dragRow = null; // { id, group }

function saveRowOrder(group, ids) {
  const rowOrder = (settings.outreach_row_order && typeof settings.outreach_row_order === 'object') ? settings.outreach_row_order : {};
  rowOrder[group] = ids;
  settings.outreach_row_order = rowOrder;
  sb.from('recruit_settings').upsert({
    key: 'outreach_row_order', value: rowOrder,
    updated_by_name: me?.name || null, updated_at: new Date().toISOString(),
  }).then(({ error }) => { if (error) toast(`Order save failed: ${error.message}`); });
}

/* Move a placement between listings. The source row is deleted rather than
   tombstoned: a 'removed' tombstone is a recruiter saying "never here
   again", which isn't what a move means — they may well qualify later. */
async function movePlacement(applicantId, fromListingId, toListingId) {
  const a = applicants.find(x => x.id === applicantId);
  const to = listings.find(l => l.id === toListingId);
  if (!a || !to) return;
  if (activePlacements(applicantId).some(p => p.listing_id === toListingId)) {
    toast(`${a.first} is already on that listing`);
    return;
  }
  const added = await addPlacement(applicantId, toListingId, 'manual');
  if (!added) return;
  const src = placements.find(p => p.applicant_id === applicantId && p.listing_id === fromListingId);
  if (src) {
    const { error } = await sb.from('recruit_listing_candidates').delete().eq('id', src.id);
    if (error) { toast(`Move half-finished: ${error.message}`); }
    else placements = placements.filter(p => p.id !== src.id);
  }
  const room = rooms.find(r => r.id === to.room_id);
  toast(`${a.first} moved to ${room?.name || 'the other listing'}${qualifiesFor(a, to) ? '' : " — they don't auto-qualify there, so it'll stick"}`);
  renderRailCounts();
  renderApplicants();
}

function wireRowDrag(host) {
  const clearTargets = () => host.querySelectorAll('.is-drop-target')
    .forEach(el => el.classList.remove('is-drop-target'));

  host.querySelectorAll('.inbox-row[data-row-id]').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragRow = { id: row.dataset.rowId, group: row.dataset.rowGroup };
      row.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Firefox won't start a drag without payload.
      try { e.dataTransfer.setData('text/plain', row.dataset.rowId); } catch { /* */ }
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      clearTargets();
      dragRow = null;
    });
    row.addEventListener('dragover', e => {
      if (!dragRow) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', e => {
      if (!dragRow) return;
      e.preventDefault();
      e.stopPropagation(); // don't also fire the section handler underneath
      const { id, group } = dragRow;
      clearTargets();
      if (row.dataset.rowGroup !== group) { movePlacement(id, group, row.dataset.rowGroup); return; }
      if (row.dataset.rowId === id) return;
      const ids = [...host.querySelectorAll(`.inbox-row[data-row-group="${CSS.escape(group)}"]`)].map(x => x.dataset.rowId);
      ids.splice(ids.indexOf(row.dataset.rowId), 0, ids.splice(ids.indexOf(id), 1)[0]);
      saveRowOrder(group, ids);
      renderApplicants();
    });
  });

  // Whole-section targets — the only way to reach a listing with no rows yet.
  host.querySelectorAll('.inbox-group[data-group-key]').forEach(section => {
    section.addEventListener('dragover', e => {
      if (!dragRow || section.dataset.groupKey === dragRow.group) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      section.classList.add('is-drop-target');
    });
    section.addEventListener('dragleave', e => {
      if (!section.contains(e.relatedTarget)) section.classList.remove('is-drop-target');
    });
    section.addEventListener('drop', e => {
      if (!dragRow || section.dataset.groupKey === dragRow.group) return;
      e.preventDefault();
      const { id, group } = dragRow;
      clearTargets();
      movePlacement(id, group, section.dataset.groupKey);
    });
  });
}

/* ---------- occupancy ---------- */
const KIND_LABELS = { resident: 'Resident', sublet: 'Sublet (short-term)', candidate: 'Trial candidate', shared: 'Shared', vacant: 'Open' };

/* Google-Calendar-style lanes over a rolling window of months. Stays are
   date-based (recruit_stays, ends_on NULL = open-ended), so the timeline
   pages forward indefinitely — ◀ ▶ shift the window, Today recenters it. */
let OCC_WINDOW = 12;         // months visible at once (3 on phones — set per render)
const occMq = window.matchMedia('(max-width: 720px)');
let occStart = null;         // 'YYYY-MM-01' — left edge of the window
let occDrawer = null;        // { type:'stay'|'gap'|'room', ... } | null — opens on click; hover shows a tooltip
let pendingOccRoom = null;   // room id to open once the calendar renders (openings → occupancy links)

function firstOfMonth(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function addMonthsIso(iso, n) {
  const d = new Date(iso + 'T12:00');
  d.setMonth(d.getMonth() + n);
  return firstOfMonth(d);
}
function isoAddDays(iso, n) {
  const d = new Date(iso + 'T12:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function defaultOccStart() {
  const d = new Date();
  if (!occMq.matches) d.setMonth(d.getMonth() - 1); // desktop: a month of history; phones: today at the left edge
  return firstOfMonth(d);
}
function occMonths() {
  return [...Array(OCC_WINDOW)].map((_, i) => addMonthsIso(occStart, i));
}
/* Fractional x-position of a date inside the window: months are equal-width
   (matching the header grid), days interpolate within their month. */
function occPos(iso) {
  const months = occMonths();
  const end = addMonthsIso(occStart, OCC_WINDOW);
  if (iso <= occStart) return 0;
  if (iso >= end) return 1;
  const key = iso.slice(0, 7) + '-01';
  const idx = months.indexOf(key);
  if (idx === -1) return iso < occStart ? 0 : 1;
  const dim = new Date(+iso.slice(0, 4), +iso.slice(5, 7), 0).getDate();
  return (idx + (+iso.slice(8, 10) - 1) / dim) / OCC_WINDOW;
}
function fmtShort(iso) {
  return new Date(iso + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function roomStays(roomId) {
  return stays.filter(s => s.room_id === roomId)
    .slice().sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

/* Uncovered stretches (≥ 7 days) inside the visible window for one room. */
function roomGaps(roomId) {
  const winStart = occStart;
  const winEnd = isoAddDays(addMonthsIso(occStart, OCC_WINDOW), -1); // inclusive
  const covered = roomStays(roomId)
    .map(s => [s.starts_on, s.ends_on || '9999-12-31'])
    .filter(([a, b]) => a <= winEnd && b >= winStart)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const gaps = [];
  let cursor = winStart;
  for (const [a, b] of covered) {
    if (a > cursor) gaps.push([cursor, isoAddDays(a, -1)]);
    if (b >= cursor) cursor = isoAddDays(b, 1);
    if (cursor > winEnd) break;
  }
  if (cursor <= winEnd) gaps.push([cursor, winEnd]);
  return gaps.filter(([a, b]) => (new Date(b) - new Date(a)) / 86400000 >= 7);
}

function renderOccupancy() {
  OCC_WINDOW = occMq.matches ? 3 : 12;
  if (!occStart) occStart = defaultOccStart();
  const host = document.getElementById('view-root');
  host.className = 'house';
  const months = occMonths();
  const rangeLabel = `${monthLabel(months[0].slice(0, 7))} – ${monthLabel(months[OCC_WINDOW - 1].slice(0, 7))}`;
  document.getElementById('page-sub').textContent = `${rooms.length} rooms · ${rangeLabel}`;

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayPct = todayIso >= occStart && occPos(todayIso) < 1 ? occPos(todayIso) * 100 : null;

  const barsFor = r => {
    const winEndExcl = addMonthsIso(occStart, OCC_WINDOW);
    const bars = [];
    for (const s of roomStays(r.id)) {
      const endExcl = s.ends_on ? isoAddDays(s.ends_on, 1) : winEndExcl;
      if (s.starts_on >= winEndExcl || endExcl <= occStart) continue;
      const left = occPos(s.starts_on) * 100;
      const width = (s.ends_on ? occPos(endExcl) : 1) * 100 - left;
      const range = `${fmtShort(s.starts_on)} – ${s.ends_on ? fmtShort(s.ends_on) : 'ongoing'}`;
      const active = occDrawer?.type === 'stay' && occDrawer.id === s.id;
      bars.push(`<button type="button" class="cal__event cal__event--${s.kind} ${!s.ends_on ? 'is-open-ended' : ''} ${active ? 'is-editing' : ''}"
        style="left: ${left}%; width: ${Math.max(width, 0.8)}%" title="${esc(`${s.occupant || KIND_LABELS[s.kind]} · ${KIND_LABELS[s.kind]} · ${range}`)}"
        data-stay="${s.id}">${esc(s.occupant || KIND_LABELS[s.kind])}</button>`);
    }
    for (const [a, b] of roomGaps(r.id)) {
      const left = occPos(a) * 100;
      const width = occPos(isoAddDays(b, 1)) * 100 - left;
      const active = occDrawer?.type === 'gap' && occDrawer.roomId === r.id && occDrawer.start === a;
      bars.push(`<button type="button" class="cal__event cal__event--vacant ${active ? 'is-editing' : ''}"
        style="left: ${left}%; width: ${width}%" title="Open ${fmtShort(a)} – ${fmtShort(b)} — click to fill or list"
        data-gap-room="${r.id}" data-gap-start="${a}" data-gap-end="${b}">Open</button>`);
    }
    return bars.join('');
  };

  host.innerHTML = `
    <div class="occ-legend">
      ${['resident', 'sublet', 'candidate', 'vacant'].map(k =>
        `<span class="occ-legend__item"><span class="occ-swatch occ-swatch--${k}"></span>${KIND_LABELS[k]}</span>`).join('')}
      <span class="occ-legend__hint">Tap a room for its details; tap any bar to edit who's in it and their exact dates</span>
      <span class="cal-nav">
        <button type="button" class="btn btn--sm" data-cal-nav="prev" title="Earlier">◀</button>
        <button type="button" class="btn btn--sm" data-cal-nav="today">Today</button>
        <button type="button" class="btn btn--sm" data-cal-nav="next" title="Later">▶</button>
      </span>
    </div>
    <div class="cal" style="--occ-months: ${OCC_WINDOW}">
      <div class="cal__head">
        <div class="cal__room-col"></div>
        <div class="cal__months">
          ${months.map(m => {
            const isNow = m === firstOfMonth(new Date());
            const lbl = MONTH_ABBR[+m.slice(5, 7) - 1] + (m.slice(5, 7) === '01' || m === months[0] ? ` ’${m.slice(2, 4)}` : '');
            return `<span class="cal__month ${isNow ? 'is-now' : ''}">${lbl}</span>`;
          }).join('')}
        </div>
      </div>
      <div class="cal__body">
        ${todayPct !== null ? `<span class="cal__today" style="left: calc(var(--room-col) + (100% - var(--room-col)) * ${todayPct / 100})"></span>` : ''}
        ${rooms.map(r => `
          <div class="cal__row">
            <button type="button" class="cal__room-col cal__room-btn ${occDrawer?.type === 'room' && occDrawer.roomId === r.id ? 'is-editing' : ''}" data-room-info="${r.id}" title="Room details">
              <span class="occ__room-name">${esc(r.name)}</span>
              <span class="occ__room-sub">${esc(r.floor)}${r.total_sqft ? ` · ${r.total_sqft} sq ft` : ''}</span>
            </button>
            <div class="cal__lane">${barsFor(r)}</div>
          </div>`).join('')}
      </div>
    </div>
    ${occupantsHtml()}
    <div id="occ-drawer-host"></div>`;
  renderOccDrawer();
  if (pendingOccRoom) {
    const rid = pendingOccRoom;
    pendingOccRoom = null;
    if (rooms.some(r => r.id === rid)) openOccDrawer({ type: 'room', roomId: rid });
    document.querySelector(`[data-room-info="${rid}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}

/* --- right-hand drawer: stay editor, gap actions, or room details --- */
function openOccDrawer(next) {
  occDrawer = next;
  document.querySelectorAll('.cal__event.is-editing, .cal__room-btn.is-editing').forEach(el => el.classList.remove('is-editing'));
  if (next?.type === 'stay') document.querySelector(`[data-stay="${next.id}"]`)?.classList.add('is-editing');
  if (next?.type === 'gap') document.querySelector(`[data-gap-room="${next.roomId}"][data-gap-start="${next.start}"]`)?.classList.add('is-editing');
  if (next?.type === 'room') document.querySelector(`[data-room-info="${next.roomId}"]`)?.classList.add('is-editing');
  renderOccDrawer();
}

function stayFormHtml(s, roomId) {
  const isNew = !s.id;
  return `<form class="occ-drawer__form" data-stay-form="${s.id || 'new'}" data-stay-room="${roomId}">
    <label class="listing-form__field">Who
      <input type="text" name="occupant" class="listing-status" value="${esc(s.occupant || '')}" placeholder="Name" autofocus>
    </label>
    <label class="listing-form__field">Type
      <select name="kind" class="listing-status">
        ${['resident', 'sublet', 'candidate', 'shared'].map(k =>
          `<option value="${k}" ${(s.kind || 'sublet') === k ? 'selected' : ''}>${KIND_LABELS[k]}</option>`).join('')}
      </select>
    </label>
    <div class="occ-drawer__dates">
      <label class="listing-form__field">From
        <input type="date" name="starts_on" class="listing-status" value="${s.starts_on || ''}" required>
      </label>
      <label class="listing-form__field">Through
        <input type="date" name="ends_on" class="listing-status" value="${s.ends_on || ''}" ${s.id && !s.ends_on ? 'disabled' : ''}>
      </label>
    </div>
    <label class="occ-drawer__ongoing"><input type="checkbox" name="ongoing" ${s.id && !s.ends_on ? 'checked' : ''}> Ongoing — no move-out date yet</label>
    <p class="listing-form__error" data-form-error></p>
    <div class="decision-sheet__actions seg-form__actions">
      ${!isNew ? `<button type="button" class="listing-form__delete" data-stay-delete="${s.id}">Remove stay</button>` : ''}
      ${!isNew && s.kind === 'resident' ? `<button type="button" class="listing-form__delete" data-stay-leaving="${roomId}" data-stay-leaving-date="${s.ends_on || ''}">Mark leaving — list room</button>` : ''}
      <button type="button" class="hold-sheet__cancel" data-drawer-close>Cancel</button>
      <button type="submit" class="btn btn--accent btn--sm">${isNew ? 'Add stay' : 'Save'}</button>
    </div>
  </form>`;
}

function roomDetailsHtml(r) {
  const facts = [
    ['Floor', r.floor],
    ['Room', r.sqft ? `${r.sqft} sq ft` : null],
    ['Closet', r.closet_sqft != null ? `${r.closet_sqft} sq ft` : null],
    ['Total', r.total_sqft ? `${r.total_sqft} sq ft` : null],
    ['Ceiling', r.ceiling_ft ? `${(+r.ceiling_ft).toFixed(r.ceiling_ft % 1 ? 2 : 0)} ft` : null],
    ['Volume', r.cubic_ft ? `${Number(r.cubic_ft).toLocaleString()} cu ft` : null],
    ['Share of private space', r.pct_private ? `${(+r.pct_private).toFixed(2)}%` : null],
  ].filter(([, v]) => v);
  const open = listings.filter(l => l.room_id === r.id && l.status === 'open');
  const money = n => n != null && n !== '' ? '$' + Number(n).toLocaleString('en-US') : null;
  const food = settings.food_monthly, dues = settings.dues_monthly;
  const allIn = r.rent_monthly != null && food != null && dues != null
    ? r.rent_monthly + Number(food) + Number(dues) : null;
  const costsHtml = r.rent_monthly != null ? `
    <div class="occ-drawer__section">Monthly costs</div>
    <dl class="occ-drawer__facts">
      <div class="occ-drawer__fact"><dt>Room (lease share)</dt><dd>${money(r.rent_monthly)}</dd></div>
      ${r.rent_private != null && r.rent_public ? `<div class="occ-drawer__fact occ-drawer__fact--sub"><dt>${money(r.rent_private)} private + ${money(r.rent_public)} shared</dt><dd></dd></div>` : ''}
      <div class="occ-drawer__fact"><dt>Food <span class="occ-drawer__global">per person · global</span></dt>
        <dd><input type="number" class="listing-status occ-drawer__cost" data-cost-setting="food_monthly" value="${food ?? ''}" min="0" max="2000" step="5"></dd></div>
      <div class="occ-drawer__fact"><dt>Communal dues <span class="occ-drawer__global">per person · global</span></dt>
        <dd><input type="number" class="listing-status occ-drawer__cost" data-cost-setting="dues_monthly" value="${dues ?? ''}" min="0" max="5000" step="5"></dd></div>
      ${allIn != null ? `<div class="occ-drawer__fact occ-drawer__fact--total"><dt>All-in, one person</dt><dd>${money(allIn)}/mo</dd></div>` : ''}
    </dl>` : '';
  return `
    <dl class="occ-drawer__facts">
      ${facts.map(([k, v]) => `<div class="occ-drawer__fact"><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`).join('')}
    </dl>
    ${costsHtml}
    ${r.details_notes ? `<p class="occ-drawer__note">${esc(r.details_notes)}</p>` : ''}
    ${open.length ? `<div class="occ-drawer__listings">
      ${open.map(l => `<p class="occ-drawer__note">Open listing: ${l.kind === 'resident' ? 'resident trial' : 'sublet'} from ${fmtDay(l.starts_on)}
        <button class="btn btn--sm" data-edit-listing="${l.id}">Edit</button></p>`).join('')}
    </div>` : ''}`;
}

function renderOccDrawer() {
  const hostWrap = document.getElementById('occ-drawer-host');
  if (!hostWrap) return;
  if (!occDrawer) { hostWrap.innerHTML = ''; return; }
  let title = '', sub = '', body = '';
  if (occDrawer.type === 'stay') {
    const s = stays.find(x => x.id === occDrawer.id);
    if (!s) { occDrawer = null; hostWrap.innerHTML = ''; return; }
    const room = rooms.find(r => r.id === s.room_id);
    title = s.occupant || KIND_LABELS[s.kind];
    sub = `${room?.name || 'Room'} · ${KIND_LABELS[s.kind]} · ${fmtShort(s.starts_on)} – ${s.ends_on ? fmtShort(s.ends_on) : 'ongoing'}`;
    body = stayFormHtml(s, s.room_id);
  } else if (occDrawer.type === 'gap') {
    const room = rooms.find(r => r.id === occDrawer.roomId);
    title = `${room?.name || 'Room'} — open`;
    sub = `${fmtShort(occDrawer.start)} – ${fmtShort(occDrawer.end)}`;
    body = `
      <button class="btn btn--sm occ-drawer__list-btn" data-list-room="${occDrawer.roomId}" data-list-start="${occDrawer.start}">Create listing for this stretch</button>
      <p class="occ-drawer__note">…or record who's moving in:</p>
      ${stayFormHtml({ kind: 'sublet', starts_on: occDrawer.start, ends_on: occDrawer.end }, occDrawer.roomId)}`;
  } else if (occDrawer.type === 'room') {
    const r = rooms.find(x => x.id === occDrawer.roomId);
    if (!r) { occDrawer = null; hostWrap.innerHTML = ''; return; }
    title = r.name;
    sub = 'Room details';
    body = roomDetailsHtml(r);
  }
  hostWrap.innerHTML = `
    <aside class="occ-drawer">
      <div class="occ-drawer__head">
        <div>
          <h3 class="occ-drawer__title">${esc(title)}</h3>
          <p class="occ-drawer__sub">${esc(sub)}</p>
        </div>
        <button class="review__close" data-drawer-close aria-label="Close">✕</button>
      </div>
      <div class="occ-drawer__body">${body}</div>
    </aside>`;
  hostWrap.querySelector('[data-stay-form]')?.addEventListener('submit', onStaySave);
  const ongoing = hostWrap.querySelector('input[name="ongoing"]');
  if (ongoing) ongoing.addEventListener('change', e => {
    const ends = hostWrap.querySelector('input[name="ends_on"]');
    ends.disabled = e.target.checked;
    if (e.target.checked) ends.value = '';
  });
}

async function onStaySave(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const id = form.dataset.stayForm;
  const err = form.querySelector('[data-form-error]');
  const rec = {
    room_id: +form.dataset.stayRoom,
    occupant: (fd.get('occupant') || '').trim(),
    kind: fd.get('kind'),
    starts_on: fd.get('starts_on'),
    ends_on: fd.get('ongoing') ? null : (fd.get('ends_on') || null),
  };
  if (!rec.starts_on) { err.textContent = 'Start date is required.'; return; }
  if (rec.ends_on && rec.ends_on < rec.starts_on) { err.textContent = '"Through" must be at or after "From".'; return; }
  if (!rec.occupant && rec.kind !== 'shared') { err.textContent = 'Add a name (or delete the stay to leave the room open).'; return; }
  if (!rec.ends_on && !fd.get('ongoing')) {
    if (rec.kind === 'resident' || rec.kind === 'shared') rec.ends_on = null; // residents default open-ended
    else { err.textContent = 'Sublets and trials need an end date (or tick "Ongoing").'; return; }
  }
  if (id === 'new') {
    const { data, error } = await sb.from('recruit_stays').insert(rec).select().single();
    if (error) { err.textContent = error.message; return; }
    stays.push(data);
  } else {
    const { error } = await sb.from('recruit_stays').update({ ...rec, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { err.textContent = error.message; return; }
    Object.assign(stays.find(s => s.id === id) || {}, rec);
  }
  occDrawer = null;
  toast('Occupancy updated');
  renderOccupancy();
}

async function deleteStay(id) {
  const s = stays.find(x => x.id === id);
  const room = rooms.find(r => r.id === s?.room_id);
  if (!confirm(`Remove ${s?.occupant || 'this stay'} from ${room?.name || 'the room'}? The stretch becomes open.`)) return;
  const { error } = await sb.from('recruit_stays').delete().eq('id', id);
  if (error) { toast(`Delete failed: ${error.message}`); return; }
  stays = stays.filter(x => x.id !== id);
  occDrawer = null;
  toast('Stay removed');
  renderOccupancy();
}

/* --- current + past occupants --- */
function occupantsHtml() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
  const current = stays
    .filter(s => s.occupant && s.starts_on <= todayIso && (!s.ends_on || s.ends_on >= todayIso))
    .sort((a, b) => (roomById[a.room_id]?.sort || 0) - (roomById[b.room_id]?.sort || 0));

  const currentNames = new Set(current.map(s => s.occupant.toLowerCase()));
  const pastMap = new Map(); // occupant -> { rooms:Set, last:iso }
  for (const s of stays) {
    if (!s.occupant || !s.ends_on || s.ends_on >= todayIso || s.kind === 'shared') continue;
    if (currentNames.has(s.occupant.toLowerCase())) continue;
    const rec = pastMap.get(s.occupant) || { rooms: new Set(), last: '' };
    rec.rooms.add(roomById[s.room_id]?.name || '');
    if (s.ends_on > rec.last) rec.last = s.ends_on;
    pastMap.set(s.occupant, rec);
  }
  const past = [...pastMap.entries()].sort((a, b) => b[1].last.localeCompare(a[1].last));

  return `
    <section class="inbox-group occupants">
      <div class="inbox-group__head">
        <h2 class="inbox-group__label">Current occupants</h2>
        <span class="inbox-group__count">${current.length} right now</span>
      </div>
      <ul class="inbox-card">
        ${current.map(s => {
          const room = roomById[s.room_id];
          return `<li class="inbox-row">
            <span class="avatar">${esc((s.occupant[0] || '?').toUpperCase())}</span>
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(s.occupant)}</span>
              <span class="inbox-row__sub">${esc(room?.name || '')} · ${esc(room?.floor || '')} · ${s.ends_on ? `through ${fmtShort(s.ends_on)}` : 'ongoing'}</span>
            </span>
            <span class="inbox-row__actions">
              <span class="listing-kind listing-kind--${s.kind === 'candidate' ? 'trial' : (s.kind === 'resident' ? 'resident' : 'sublet')}">${KIND_LABELS[s.kind]}</span>
            </span>
          </li>`;
        }).join('')}
      </ul>
      ${past.length ? `<details class="occupants__past">
        <summary>Past occupants (${past.length})</summary>
        <ul class="inbox-card">
          ${past.map(([name, rec]) => `<li class="inbox-row">
            <span class="avatar">${esc((name[0] || '?').toUpperCase())}</span>
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(name)}</span>
              <span class="inbox-row__sub">${esc([...rec.rooms].filter(Boolean).join(', '))} · through ${fmtShort(rec.last)}</span>
            </span>
          </li>`).join('')}
        </ul>
      </details>` : ''}
    </section>`;
}

async function createListingFromGap(roomId, startIso) {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  const pretty = fmtShort(startIso);
  if (!confirm(`Create a sublet listing for ${room.name} starting ${pretty}?`)) return;
  const { data, error } = await sb.from('recruit_listings').insert({
    room_id: roomId, kind: 'sublet', starts_on: startIso, status: 'open',
    source: 'gap', notes: `Created from the occupancy calendar (open from ${pretty}).`,
    created_by: me.id, created_by_name: me.name,
  }).select().single();
  if (error) { toast(`Listing failed: ${error.message}`); return; }
  listings.push(data);
  toast(`Listing created — ${room.name}, from ${pretty}`);
  occDrawer = null;
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
  setView('openings');
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

/* One meta line, no repetition: when + terms + all-in cost (breakdown on
   hover). Notes live in the edit modal, not the header. */
function listingMeta(l) {
  const bits = [];
  if (l.kind === 'resident') {
    bits.push(`Opens ${fmtDay(l.starts_on)}`);
  } else {
    bits.push(l.ends_on ? `${fmtDay(l.starts_on)} – ${fmtDay(l.ends_on)}` : `From ${fmtDay(l.starts_on)} · end date TBD`);
    const len = windowLength(l.starts_on, l.ends_on);
    if (len) bits.push(len);
  }
  const costs = [l.rent_monthly, l.dues_monthly, l.groceries_monthly].filter(v => v != null);
  if (costs.length) {
    const total = costs.reduce((s, v) => s + Number(v), 0);
    bits.push(`<span class="listing-allin" title="${esc(listingPricing(l))}">$${total.toLocaleString('en-US')}/mo all-in</span>`);
  }
  return bits.join(' · ');
}

/* ⋯ menu — edit + quick status moves; the inline status select is gone. */
function listingMenuHtml(l) {
  return `<span class="listing-menu-wrap">
    <button type="button" class="btn btn--sm listing-menu-btn" data-listing-menu="${l.id}" aria-label="Listing actions" aria-haspopup="menu">⋮</button>
    <span class="listing-menu" data-menu-for="${l.id}" hidden>
      <button type="button" class="listing-menu__item" data-edit-listing="${l.id}">Edit listing…</button>
      ${l.status === 'open'
        ? `<button type="button" class="listing-menu__item" data-set-status="${l.id}|filled">Mark filled</button>
           <button type="button" class="listing-menu__item" data-set-status="${l.id}|closed">Close listing</button>`
        : `<button type="button" class="listing-menu__item" data-set-status="${l.id}|open">Reopen</button>`}
    </span>
  </span>`;
}

/* Everyone who'd qualify for this listing but isn't on the active shortlist:
   candidates a recruiter removed, plus qualifying applicants still in the
   Inbox gathering votes. */
function otherQualified(listingId) {
  const l = listings.find(x => x.id === listingId);
  if (!l) return [];
  const placed = new Set(placements.filter(p => p.listing_id === listingId && p.status === 'active').map(p => p.applicant_id));
  return applicants.filter(a => !placed.has(a.id)
    && (a.stage === 'review' || a.stage === 'candidate')
    && qualifiesFor(a, l));
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
      <label class="listing-form__field">Status
        <select name="status" class="listing-status">
          ${['open', 'filled', 'closed'].map(st => `<option value="${st}" ${(l.status || 'open') === st ? 'selected' : ''}>${st[0].toUpperCase()}${st.slice(1)}</option>`).join('')}
        </select>
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
  // a new or reopened listing may pick up qualifying candidates
  syncAutoPlacements().then(added => {
    renderRailCounts();
    if (view === 'openings') renderApplicants();
    else if (view === 'occupancy') renderOccupancy();
    if (added) toast(`${added} candidate${added === 1 ? '' : 's'} auto-placed`);
  });
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
    status: fd.get('status') || 'open',
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
      ...rec, source: 'manual', created_by: me.id, created_by_name: me.name,
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
/* The review queue mirrors whatever order is on screen — listing groups,
   manual drag order, filters — falling back to data order off-list. */
function renderedQueue() {
  const ids = [...document.querySelectorAll('#view-root .inbox-row__main[data-review]')].map(b => b.dataset.review);
  return [...new Set(ids)];
}

function openReview(id) {
  const domOrder = VIEWS[view]?.kind === 'applicants' ? renderedQueue() : [];
  queue = domOrder.includes(id) ? domOrder
    : applicants.filter(a => matchesView(a) && matchesFilters(a)).map(a => a.id);
  if (!queue.includes(id)) {
    const target = applicants.find(x => x.id === id);
    queue = applicants.filter(x => x.stage === target?.stage).map(x => x.id);
    if (!queue.includes(id)) queue = [id];
  }
  qIndex = Math.max(0, queue.indexOf(id));
  reviewTab = 'profile';
  pendingVote = null;
  moveinEditing = false;
  if (!viewedIds.has(id)) {
    viewedIds.add(id);
    sb.from('recruit_applicant_views')
      .upsert({ applicant_id: id, user_id: me.id, viewed_at: new Date().toISOString() }, { onConflict: 'applicant_id,user_id' })
      .then(({ error }) => { if (error) console.warn('view mark failed', error.message); });
  }
  document.getElementById('review').hidden = false;
  document.body.style.overflow = 'hidden';
  hideHoldSheet();
  renderReview();
  resetScroll();
  prefetchNextEmails();
}

function closeReview() {
  document.getElementById('review').hidden = true;
  document.body.style.overflow = '';
  gpSyncPlacement(); // a playing call follows you out to the list
  const url = new URL(location); url.searchParams.delete('a');
  history.replaceState(null, '', url);
  render();
}

function step(delta) {
  const next = qIndex + delta;
  if (next < 0 || next >= queue.length) { if (delta > 0) closeReview(); return; }
  qIndex = next;
  pendingVote = null;
  moveinEditing = false;
  hideHoldSheet();
  renderReview();
  resetScroll();
  prefetchNextEmails();
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

  const archived = a.stage === 'rejected' || a.stage === 'archived';
  const archiveBanner = () => {
    const st = voteStats(a.id);
    const why = st.veto ? `Vetoed by ${st.veto.voter_name || 'a housemate'}${st.veto.note ? ` — “${st.veto.note}”` : ''}`
      : rec?.note || (rec?.reason ? reasonLabel(rec.reason) : 'Did not pass review');
    return `<div class="decision-banner decision-banner--pass">
      <div class="decision-banner__text">
        <span class="decision-banner__label">${a.stage === 'rejected' ? 'Archived — update email queued' : 'Archived'}</span>
        <span class="decision-banner__meta">${esc(why)}</span>
      </div>
      <span class="decision-banner__actions">
        <button class="decision-banner__undo" data-reopen="${a.id}">Reopen — back to Inbox</button>
      </span>
    </div>`;
  };

  document.getElementById('review-body').innerHTML = `
    ${archived ? archiveBanner() : ''}
    <div class="review__card">
      <div class="review__head">
        ${avatarHtml(a, true)}
        <div class="review__head-text">
          <h2 class="review__title">${esc(fullName(a))}${a.pronouns ? ` <span class="review__pronouns">${esc(a.pronouns)}</span>` : ''}</h2>
          <p class="review__meta"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>
          <div class="review__badges">
            <span class="review__badge review__badge--track">${trackLabel(a)}</span>

          </div>
          <div class="review__facts">
            <div class="review__fact"><span class="review__fact-label">Move-in</span>${moveInFactHtml(a, miNorm)}</div>
            <div class="review__fact"><span class="review__fact-label">Budget</span><span class="review__fact-value">${esc(buNorm || a.budget || '—')} ${infoDot(a.budget, buNorm)}</span></div>
            ${a.source ? `<div class="review__fact"><span class="review__fact-label">Via</span><span class="review__fact-value review__fact-value--quiet">${esc(a.source)}</span></div>` : ''}
            <div class="review__fact"><span class="review__fact-label">Applied</span><span class="review__fact-value">${new Date(a.ts_iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
            ${linksHtml ? `<div class="review__fact"><span class="review__fact-label">Links</span>${linksHtml}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="review-tabs">
      <button class="review-tabs__tab ${reviewTab === 'profile' ? 'is-on' : ''}" data-review-tab="profile">Profile</button>
      <button class="review-tabs__tab ${reviewTab === 'emails' ? 'is-on' : ''}" data-review-tab="emails">Emails${(emailsCache[a.id] || []).length ? ` (${emailsCache[a.id].length})` : ''}</button>
      ${(screeningState[a.id]?.watch || screeningState[a.id]?.at || screeningState[a.id]?.done) ? `<button class="review-tabs__tab ${reviewTab === 'call' ? 'is-on' : ''}" data-review-tab="call">Call</button>` : ''}
    </div>
    ${reviewTab === 'emails' ? `<div id="emails-panel"><p class="notes__empty">Loading emails…</p></div>` : reviewTab === 'call' ? `<div id="call-panel"><p class="notes__empty">Loading the call…</p></div>` : `
    ${voteSectionHtml(a)}
    ${section('About them', a.about)}
    ${section('Why Agape', a.why)}
    ${section('Gifts to share', a.gifts)}
    ${houseEventsHtml(a)}
    <section class="review__section notes" id="notes">
      <div class="notes__head">
        <h3 class="review__section-title">House notes</h3>
        <button type="button" class="btn btn--sm" id="second-opinion" data-second-opinion="${a.id}">Get an AI read</button>
      </div>
      <div id="notes-body"><p class="notes__empty">Loading notes…</p></div>
      <form class="notes__form" id="notes-form">
        <textarea class="notes__input" id="notes-input" placeholder="Add an internal note for the house — only Recruiting Society members see these." maxlength="4000"></textarea>
        <button class="btn btn--accent btn--sm notes__submit" type="submit">Add note</button>
      </form>
    </section>`}
  `;

  renderReviewFoot(a);

  if (reviewTab === 'emails') loadEmailsPanel(a);
  else if (reviewTab === 'call') loadCallPanel(a);
  if (!houseLoaded) loadHouse().then(() => { renderRailCounts(); });
  loadComments(a.id).then(() => {
    // guard against navigating away while the query was in flight
    if (queue[qIndex] === a.id) renderNotes(a.id);
  });
  document.getElementById('notes-form')?.addEventListener('submit', e => {
    e.preventDefault();
    postNote(a.id);
  });
}

/* ---------- confirmed move-in field ----------
   What they typed stays on top; the structured window a recruiter confirms
   (usually after emailing them) lives underneath and drives placement. */
let moveinEditing = false;

/* One value, cleanly swapped: the confirmed window replaces the parsed text
   when set (green, ✓, attributed on hover); the applicant's raw answer stays
   behind the info-dot either way. A quiet ✎ opens the inline editor. */
function moveInFactHtml(a, miNorm) {
  if (moveinEditing) {
    return `<span class="movein-set movein-set--form">
      <input type="date" class="listing-status movein-set__input" id="movein-from" value="${esc(a.moveinFrom || '')}" aria-label="Confirmed move-in">
      <span class="movein-set__sep">→</span>
      <input type="date" class="listing-status movein-set__input" id="movein-to" value="${esc(a.moveinTo || '')}" aria-label="Through (optional)" title="Through — leave empty for open-ended">
      <button type="button" class="btn btn--sm btn--accent" data-movein-save>Save</button>
      ${a.moveinFrom ? `<button type="button" class="btn btn--sm" data-movein-clear>Clear</button>` : ''}
      <button type="button" class="hold-sheet__cancel movein-set__cancel" data-movein-cancel>Cancel</button>
    </span>`;
  }
  const conf = confirmedMoveIn(a);
  const shown = conf || displayMoveIn(a) || a.movein || '—';
  return `<span class="review__fact-value ${conf ? 'is-confirmed' : ''}" title="${esc(a.movein || '')}">
    ${esc(shown)}
    ${conf ? `<span class="movein-check" title="Confirmed by ${esc(a.moveinSetBy || 'the house')}">✓</span>` : ''}
    <button type="button" class="fact-edit" data-movein-edit title="${conf ? 'Edit the confirmed date' : 'Confirm their real date'}" aria-label="Edit move-in date">✎</button>
  </span>`;
}

async function saveMoveIn(id, clear = false) {
  const a = applicants.find(x => x.id === id);
  if (!a) return;
  const from = clear ? null : (document.getElementById('movein-from')?.value || null);
  const to = clear ? null : (document.getElementById('movein-to')?.value || null);
  if (!clear && !from) { toast('Pick a move-in date (or Cancel)'); return; }
  if (from && to && to < from) { toast('"Through" must be after the move-in date'); return; }
  const { error } = await sb.rpc('recruit_set_move_in', { p_applicant: id, p_from: from, p_to: to, p_name: me.name });
  if (error) { toast(`Save failed: ${error.message}`); return; }
  a.moveinFrom = from; a.moveinTo = to; a.moveinSetBy = from ? me.name : null;
  moveinEditing = false;
  if (!houseLoaded) await loadHouse();
  await syncAutoPlacements(); // dates changed — placements reshuffle to match
  toast(from ? `Move-in confirmed: ${confirmedMoveIn(a)} — placements updated` : 'Confirmed date cleared — back to their stated answer');
  renderRailCounts();
  renderReview();
}

/* House votes in the review body. The tally stays hidden until you've cast
   yours — no anchoring. */
function voteSectionHtml(a) {
  if (a.stage !== 'review') {
    const st = voteStats(a.id);
    if (!st.n) return '';
    return `<p class="vote-recap">Review: ${st.scored} vote${st.scored === 1 ? '' : 's'}${st.avg ? ` · avg ${st.avg.toFixed(1)}` : ''}${st.veto ? ' · vetoed' : ''}</p>`;
  }
  const list = votes[a.id] || [];
  const mine = myVote(a.id);
  const st = voteStats(a.id);
  let body;
  if (!list.length) {
    body = `<p class="notes__empty">No votes yet — be the first.</p>`;
  } else if (!mine && a.stage === 'review') {
    body = `<p class="notes__empty">${list.length} vote${list.length === 1 ? '' : 's'} cast — the tally appears after you cast yours.</p>`;
  } else {
    const summary = st.veto
      ? `Vetoed — auto-archived, update email queued.`
      : st.scored
        ? `${st.scored}/${voteMin()} votes · avg ${st.avg.toFixed(1)} · ${st.scored >= voteMin() && st.avg >= votePassAvg() ? 'passing' : `needs avg ≥ ${votePassAvg()}`}`
        : '';
    body = `${summary ? `<p class="vote-summary">${esc(summary)}</p>` : ''}
      <ul class="notes__list">${list.map(v => `
        <li class="note">
          <span class="avatar">${esc((v.voter_name || '?')[0].toUpperCase())}</span>
          <div class="note__body-wrap">
            <div class="note__meta">
              <span class="note__author">${esc(v.voter_name || 'Housemate')}</span>
              <span class="note__time">${v.veto ? '<span class="vote-score vote-score--veto">Veto</span>' : `<span class="vote-score">${v.score}/5</span>`} · ${relTime(v.updated_at || v.created_at)}</span>
            </div>
            ${v.note ? `<p class="note__body">${esc(v.note)}</p>` : ''}
          </div>
        </li>`).join('')}</ul>`;
  }
  return `<section class="review__section notes">
    <div class="notes__head"><h3 class="review__section-title">House votes</h3></div>
    ${body}
  </section>`;
}

/* Contextual footer: vote bar in review, recruiter actions for candidates,
   reopen for archived. */
function renderReviewFoot(a) {
  const foot = document.getElementById('review-foot');
  if (!foot) return;
  const keepNote = document.getElementById('vote-note')?.value ?? null;
  if (a.stage === 'review') {
    const mine = myVote(a.id);
    const sel = pendingVote || (mine ? { score: mine.score, veto: mine.veto } : { score: null, veto: false });
    foot.innerHTML = `
      <div class="vote-bar">
        <span class="vote-bar__q">Would you live with them?</span>
        <span class="vote-bar__scores">
          ${[1, 2, 3, 4, 5].map(n =>
            `<button type="button" class="vote-bar__score ${!sel.veto && sel.score === n ? 'is-on' : ''}" data-vote-score="${n}" aria-label="Vote ${n}">${n}</button>`).join('')}
        </span>
        <button type="button" class="vote-bar__veto ${sel.veto ? 'is-on' : ''}" data-vote-veto>${sel.veto ? 'Veto — tap to undo' : 'Veto'}</button>
        <input type="text" class="listing-status vote-bar__note" id="vote-note" maxlength="500"
          placeholder="${sel.veto ? 'Why the veto? (required)' : 'One line on why (optional)'}"
          value="${esc(keepNote ?? mine?.note ?? '')}">
        <button type="button" class="btn btn--accent vote-bar__cast" data-cast-vote>${mine ? 'Update vote' : 'Cast vote'}</button>
      </div>`;
  } else if (a.stage === 'candidate') {
    const pills = activePlacements(a.id).map(p => {
      const l = listings.find(x => x.id === p.listing_id);
      if (!l || l.status !== 'open') return '';
      const room = rooms.find(r => r.id === l.room_id);
      return `<button type="button" class="decision-chip decision-chip--outreach placement-pill" data-remove-placement="${a.id}|${p.listing_id}" title="Remove from ${esc(room?.name || 'this listing')} — the auto-sweep won't re-add them">${esc(room?.name || 'Room')} ✕</button>`;
    }).join('');
    // Saved for future: they're off the board, so the outreach CTA would be
    // a lie. Show the standing date and a way back instead.
    if (a.exitReason === 'future') {
      foot.innerHTML = `
        <span class="foot-cta"><span class="decision-chip decision-chip--exit decision-chip--exit-future">saved for future · ${esc(fmtDay(a.exitUntil))}</span></span>
        <span class="foot-links">
          <button type="button" class="cta-link" data-bring-back="${a.id}">Bring back now</button>
          <button type="button" class="cta-link cta-link--danger" data-open-remove="${a.id}|">Remove…</button>
        </span>`;
    } else {
      foot.innerHTML = `
        ${pills ? `<span class="foot-pills">${pills}</span>` : ''}
        <span class="foot-cta">${openingsCta(a)}</span>
        <span class="foot-links">
          <button type="button" class="cta-link" data-open-decision="outreach">${activePlacements(a.id).length ? 'Add to another listing' : 'Add to a listing'}</button>
          <button type="button" class="cta-link cta-link--danger" data-open-remove="${a.id}|">Remove…</button>
        </span>`;
    }
  } else {
    foot.innerHTML = `<button class="btn review__btn" data-reopen="${a.id}">Reopen — back to Inbox</button>`;
  }
}

async function reopenApplicant(id) {
  const a = applicants.find(x => x.id === id);
  if (!a) return;
  // A veto is archival, so reopening has to clear it — otherwise they'd sit in
  // the Inbox with a standing veto that can never resolve.
  const st0 = voteStats(id);
  if (st0.veto) {
    if (!confirm(`${fullName(a)} was vetoed by ${st0.veto.voter_name || 'a housemate'}. Reopening clears that veto so the house can review them again. Continue?`)) return;
    const { error } = await sb.from('recruit_votes').delete().eq('applicant_id', id).eq('veto', true);
    if (error) { toast(`Couldn't clear the veto: ${error.message}`); return; }
    votes[id] = (votes[id] || []).filter(v => !v.veto);
  }
  if (await setStage(id, 'review')) {
    const st = voteStats(id);
    toast(st0.veto ? 'Reopened — the veto was cleared' : 'Reopened — back in the Inbox');
    renderRailCounts();
    if (!document.getElementById('review').hidden) renderReview(); else render();
  }
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
  const long = text.length > 700;
  return `<section class="review__section">
    <h3 class="review__section-title">${title}</h3>
    <p class="review__prose ${long ? 'is-clamped' : ''}">${esc(text)}</p>
    ${long ? '<button type="button" class="cta-link prose-more" data-prose-toggle>More</button>' : ''}
  </section>`;
}

/* ---------- emails panel ---------- */
/* Each row expands in place to the full message body. */
function emailRow(m) {
  const arrow = m.direction === 'out' ? '↗' : '↙';
  const who = m.direction === 'out' ? `Agape${m.sent_by_name ? ` (${esc(m.sent_by_name)})` : ''}` : esc(m.from_email.replace(/<.*>/, '').trim() || m.from_email);
  const body = (m.body_text || '').trim();
  return `<li class="email-row email-row--${m.direction}">
    <button type="button" class="email-row__head" data-email-toggle aria-expanded="false" ${body ? '' : 'disabled title="No text body stored for this message"'}>
      <span class="email-row__dir" title="${m.direction === 'out' ? 'Sent by the house' : 'Received'}">${arrow}</span>
      <span class="inbox-row__text">
        <span class="inbox-row__title">${esc(m.subject || '(no subject)')}</span>
        <span class="inbox-row__sub">${who} · ${new Date(m.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${m.snippet ? ` — ${esc(m.snippet.slice(0, 110))}` : ''}</span>
      </span>
      ${body ? '<span class="email-row__chev" aria-hidden="true">▾</span>' : ''}
    </button>
    ${body ? `<div class="email-row__body" hidden>${esc(body.slice(0, 8000))}</div>` : ''}
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
  // Cache-first: past emails are already in memory from loadAll, so the
  // thread paints immediately and the Gmail round-trip only ever ADDS to
  // what's on screen. The old behaviour blanked the panel and blocked on
  // the network every single time the tab was opened.
  paintEmailsPanel(a, emailSyncing.has(a.id) ? 'checking' : '');
  syncEmails(a.id).then(changed => {
    if (changed && queue[qIndex] === a.id && reviewTab === 'emails' && host()) paintEmailsPanel(a, '');
    else if (queue[qIndex] === a.id && reviewTab === 'emails' && host()) setEmailsNote('');
  }).catch(e => setEmailsNote(`couldn't reach the inbox — showing what we have (${e.message})`));
}

function setEmailsNote(text) {
  const el = document.getElementById('emails-note');
  if (el) el.textContent = text;
}

function paintEmailsPanel(a, note) {
  const host = document.getElementById('emails-panel');
  if (!host) return;
  const rows = emailsCache[a.id] || [];
  host.innerHTML = `
    ${schedulingHtml(a)}
    <div class="emails-toolbar">
      <span class="notes__empty">${rows.length ? `${rows.length} message${rows.length === 1 ? '' : 's'} with ${esc(a.email)}` : esc(a.email || '')}
        <span class="emails-note" id="emails-note">${esc(note === 'checking' ? 'checking for new…' : note)}</span></span>
      <span class="emails-toolbar__actions">
        ${a.scheduleToken ? `<button type="button" class="btn btn--sm" data-copy-schedule="${a.id}">Copy availability link</button>` : ''}
        <button type="button" class="btn btn--sm" data-email="${a.id}">Compose</button>
      </span>
    </div>
    ${rows.length ? `<ul class="inbox-card email-list">${rows.map(emailRow).join('')}</ul>`
      : `<p class="inbox-empty">No emails yet — Compose starts the thread through the shared account.</p>`}`;
}

/* One in-flight sync per applicant; resolves true when anything changed.
   Callers that just want the data warm can ignore the result. */
const emailSyncing = new Map(); // applicant_id -> Promise<boolean>
function syncEmails(applicantId) {
  if (emailSyncing.has(applicantId)) return emailSyncing.get(applicantId);
  const p = (async () => {
    if (!gmailStatus.connected) return false;
    const before = (emailsCache[applicantId] || []).length;
    const out = await gmailCall({ action: 'sync', applicantId });
    emailsCache[applicantId] = out.emails || emailsCache[applicantId] || [];
    availCache[applicantId] = out.availability || null;
    screeningsCache[applicantId] = out.screenings || [];
    return (out.synced || 0) > 0 || emailsCache[applicantId].length !== before;
  })();
  emailSyncing.set(applicantId, p);
  p.catch(() => {}).finally(() => emailSyncing.delete(applicantId));
  return p;
}

/* Warm the next applicant in the queue while you read the current one, so
   stepping through review never waits on Gmail. Silent by design. */
function prefetchNextEmails() {
  const next = queue[qIndex + 1];
  if (!next || !gmailStatus.connected) return;
  const a = applicants.find(x => x.id === next);
  if (a?.email?.includes('@')) syncEmails(next).catch(() => {});
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

/* Visits and house events swept off the house calendar. Read-only context:
   "they came to dinner on the 4th" is exactly the thing that used to live
   only in someone's head. Newest first, past ones included. */
function houseEventsHtml(a) {
  const evs = (houseEvents[a.id] || []).slice()
    .sort((x, y) => (y.starts_at || '').localeCompare(x.starts_at || ''));
  if (!evs.length) return '';
  const label = { visit: 'Visited the house', house_event: 'House event' };
  return `<div class="house-events">
    <h4 class="house-events__title">On the house calendar</h4>
    ${evs.map(e => {
      const past = new Date(e.ends_at || e.starts_at) < new Date();
      return `<div class="house-events__row">
        <span class="decision-chip decision-chip--vote">${esc(label[e.kind] || 'Event')}</span>
        <span class="house-events__what">${esc(e.title || 'Untitled')}</span>
        <span class="house-events__when">${past ? '' : 'upcoming · '}${esc(fmtSlot(e.starts_at))}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function schedulingHtml(a) {
  const screenings = (screeningsCache[a.id] || [])
    .filter(x => x.status === 'scheduled' && (x.kind || 'intro_call') === 'intro_call');
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
      <p class="avail-card__discord">…or <button type="button" class="btn btn--sm btn--discord" data-claim-preview="${a.id}"><svg class="btn-discord__icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>Ask for coverage…</button>
        <span class="notes__empty">first housemate to sign up runs the screener (manual for now)</span></p>
    </div>`);
  } else if (!screenings.length) {
    parts.push(`<p class="notes__empty">No availability captured yet — when they reply with days/times, windows appear here automatically.${emailState[a.id]?.lastDir === 'in' ? ` <button type="button" class="btn btn--sm btn--discord" data-claim-preview="${a.id}"><svg class="btn-discord__icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>Ask for coverage…</button>` : ''}</p>`);
  }
  return parts.join('');
}

/* ---------- screener scheduler: manual Discord trigger (preview → post) ---------- */
let schedulerCtx = null; // { applicantId, extraction } while the modal is open

async function openSchedulerPreview(applicantId) {
  schedulerCtx = { applicantId, extraction: null };
  document.getElementById('claim-modal').hidden = false;
  document.getElementById('claim-status').textContent = 'Reading their reply and composing the screener scheduler…';
  document.getElementById('claim-preview-body').innerHTML = '';
  document.getElementById('claim-post-btn').disabled = true;
  try {
    const out = await gmailCall({ action: 'scheduler-preview', applicantId });
    if (schedulerCtx?.applicantId !== applicantId) return; // closed meanwhile
    schedulerCtx.extraction = out.extraction;
    const emb = out.preview?.embeds?.[0] || {};
    document.getElementById('claim-status').textContent = 'This exact message goes to #recruiting-automation:';
    document.getElementById('claim-preview-body').innerHTML = `
      <div class="claim-preview ${out.slotLabels?.length ? '' : 'claim-preview--manual'}">
        <p class="claim-preview__title">${esc(emb.title || '')}</p>
        <p class="claim-preview__desc">${esc(emb.description || '').replace(/\n/g, '<br>')}</p>
        ${out.slotLabels?.length ? `<div class="claim-preview__slots">${out.slotLabels.map(l => `<span class="chip">${esc(l)}</span>`).join('')}<span class="chip">Other time…</span></div>` : ''}
      </div>`;
    document.getElementById('claim-post-btn').disabled = false;
  } catch (e) {
    document.getElementById('claim-status').textContent = `Preview failed: ${e.message}`;
  }
}

function closeSchedulerModal() {
  schedulerCtx = null;
  document.getElementById('claim-modal').hidden = true;
}

async function postSchedulerFromModal() {
  if (!schedulerCtx?.extraction) return;
  const btn = document.getElementById('claim-post-btn');
  btn.disabled = true; btn.textContent = 'Posting…';
  try {
    const out = await gmailCall({ action: 'scheduler-post', applicantId: schedulerCtx.applicantId, extraction: schedulerCtx.extraction });
    toast(out.posted ? 'Screener scheduler posted — first housemate to sign up runs it' : 'A screener already signed up — not reposted');
    closeSchedulerModal();
  } catch (e) {
    toast(`Post failed: ${e.message}`);
  }
  btn.disabled = false; btn.textContent = 'Post to Discord';
}

/* Review-availability modal: bookable slots from their windows, "how we
   read it" bullets, and the coverage ask as the secondary path. */
let availApplicantId = null;
let availSelected = null;    // ISO of the slot picked in the modal, pre-confirm

async function openAvailModal(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  availApplicantId = applicantId;
  availSelected = null;
  const poss = /she/i.test(a.pronouns || '') ? 'her' : /\bhe\b|he\//i.test(a.pronouns || '') ? 'his' : 'their';
  document.getElementById('avail-title').textContent = `Schedule a call with ${a.first}`;
  document.getElementById('avail-body').innerHTML = `<p class="notes__empty">Reading ${poss} reply…</p>`;
  document.getElementById('avail-modal').hidden = false;
  renderAvailFoot();
  try {
    const [avRes, out] = await Promise.all([
      sb.from('recruit_availability').select('windows, source_gmail_id, updated_at').eq('applicant_id', applicantId).maybeSingle(),
      gmailCall({ action: 'scheduler-preview', applicantId }).catch(() => ({})),
    ]);
    const av = avRes.data;
    let srcEmail = null;
    if (av?.source_gmail_id) {
      ({ data: srcEmail } = await sb.from('recruit_emails').select('snippet, sent_at').eq('gmail_id', av.source_gmail_id).maybeSingle());
    }
    if (availApplicantId !== applicantId) return;
    const windows = av?.windows || [];
    const ex = out.extraction || {};
    // One quote + one interpretation line — nothing the quote already says plainly.
    const deent = (t) => String(t || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const bullets = [];
    if (srcEmail?.snippet) bullets.push(`${a.first} wrote${srcEmail.sent_at ? ` on ${fmtDate(srcEmail.sent_at)}` : ''}: “${esc(deent(srcEmail.snippet).slice(0, 180))}”`);
    const readBits = [];
    if (ex.timezone_note) readBits.push(esc(ex.timezone_note));
    if (ex.platform?.kind) readBits.push(`${esc(ex.platform.kind)}${ex.platform.handle ? ` (@${esc(ex.platform.handle)})` : ''} requested — the invite defaults to Google Meet`);
    if (readBits.length) bullets.push(`Read as: ${readBits.join(' · ')}`);
    document.getElementById('avail-body').innerHTML = `
      <p class="notes__empty">Here's ${poss} availability:</p>
      ${windows.length ? windows.map(w => `
        <div class="avail-card__window">
          <span class="avail-card__range">${new Date(w.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${w.start}–${w.end}</span>
          <span class="avail-card__slots">${windowSlots(w).map(d =>
            `<button type="button" class="chip" data-slot-pick="${d.toISOString()}">${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</button>`).join('') || '<span class="notes__empty">window already passed</span>'}</span>
        </div>`).join('') : `<p class="notes__empty">No windows on file for ${a.first}.</p>`}
      ${bullets.length ? `<section class="review__section">
        <h3 class="review__section-title">How we read it</h3>
        <ul class="avail-why">${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      </section>` : ''}`;
  } catch (e) {
    if (availApplicantId === applicantId) document.getElementById('avail-body').innerHTML = `<p class="notes__empty">Couldn't load availability: ${esc(e.message)}</p>`;
  }
}

function renderAvailFoot() {
  const btn = document.getElementById('avail-confirm');
  if (!btn) return;
  btn.disabled = !availSelected;
  btn.textContent = availSelected ? `Confirm ${fmtSlot(availSelected)}` : 'Confirm a time';
}

function closeAvailModal() {
  availApplicantId = null;
  document.getElementById('avail-modal').hidden = true;
}

async function scheduleSlot(applicantId, iso, btn, skipConfirm = false) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  if (!skipConfirm && !confirm(`Book the screening call for ${fmtSlot(iso)} (30 min)?\nCalendar invites go to ${a.email} and you.`)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Booking…'; }
  try {
    const out = await gmailCall({ action: 'schedule', applicantId, startsAt: iso, minutes: 30 });
    (screeningsCache[applicantId] ||= []).unshift(out.screening);
    toast('Screening call booked — invites sent to both');
    if (!document.getElementById('avail-modal').hidden) {
      closeAvailModal();
      renderRailCounts();
      if (VIEWS[view]?.kind === 'applicants') renderApplicants();
    }
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
  }
  const noteEl = document.getElementById('decision-note');
  noteEl.value = (rec?.d === d ? rec.note : '') || '';
  document.getElementById('decision-use-notes').hidden = !comments.length;
  document.getElementById('decision-mic').hidden =
    !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  document.getElementById('decision-sheet').hidden = false;
  document.getElementById('review-foot').hidden = true;
}

function renderDecisionOptions() {
  // Outreach is just "attach to a listing" — the votes are the reasons now.
  if (pendingDecision === 'outreach') { document.getElementById('decision-options').innerHTML = ''; return; }
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

async function submitDecision() {
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
  // Recruiter "not a fit" on a candidate auto-archives — the update email is
  // owed, same as a veto; outreach keeps them a candidate.
  if (d === 'pass' && a.stage !== 'archived') await setStage(a.id, 'rejected');
  if (d === 'outreach' && listingId) await addPlacement(a.id, listingId, 'manual');
  toast(`${fullName(a)} → ${d === 'pass' ? 'Archived — update email queued' : DECISION_LABELS[d]}${d === 'outreach' ? ` · ${attachmentLabel(decisions[a.id])}` : (reason ? ` (${reasonLabel(reason)})` : '')}`);
  renderRailCounts();
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
  const head = [...cols, 'stage', 'votes', 'vote_avg', 'vetoed', 'decision', 'reason', 'decision_note', 'decided_by', 'decided_at', 'notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  for (const a of applicants) {
    const rec = decisions[a.id] || {};
    const st = voteStats(a.id);
    lines.push([...cols.map(c => q(a[c])), q(a.stage), q(st.n || 0), q(st.avg ? st.avg.toFixed(2) : ''),
      q(st.veto ? (st.veto.voter_name || 'yes') : ''), q(DECISION_LABELS[rec.d] || ''),
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

/* Global shared-account connection row (rail footer). Set once, house-wide. */
function renderGmailStatus() {
  const el = document.getElementById('gmail-conn');
  if (!el) return;
  if (gmailStatus.connected) {
    el.textContent = `✓ ${gmailStatus.email || 'shared Gmail'} connected`;
    el.title = `House email + calendar run through this account${gmailStatus.connected_by_name ? ` · connected by ${gmailStatus.connected_by_name}` : ''}${gmailStatus.connected_at ? ` · ${new Date(gmailStatus.connected_at).toLocaleDateString()}` : ''}. Click to reconnect (e.g. after a scope change).`;
  } else {
    el.textContent = 'Connect shared Gmail (house-wide, one time)';
    el.title = 'All applicant email + screening invites run through live.at.agapesf@gmail.com. Sign into that Google account in this browser first.';
  }
  el.onclick = () => {
    if (!gmailStatus.connected || confirm('Reconnect the shared Google account? Only needed after scope changes or if sending breaks.')) connectSharedGmail();
  };
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
    gmailStatus = { connected: true, email: out.email, connected_by_name: me?.name };
    renderGmailStatus();
    toast(`Shared Gmail connected: ${out.email}`);
  } catch (e) { toast(`Gmail connect failed: ${e.message}`); }
}

async function connectSharedGmail() {
  try {
    const { url } = await gmailCall({ action: 'auth-url' });
    location.href = url;
  } catch (e) { toast(`Couldn't start Gmail connect: ${e.message}`); }
}

/* ---------- link orphaned recording to applicant (?link=<gcal id>) ---------- */
async function openLinkRecording(gcalEventId) {
  const clean = new URL(location.href);
  clean.searchParams.delete('link');
  history.replaceState(null, '', clean);
  const modal = document.getElementById('link-modal');
  const { data: rec } = await sb.from('recruit_recorded_events')
    .select('gcal_event_id, title, starts_at, applicant_id').eq('gcal_event_id', gcalEventId).maybeSingle();
  if (!rec) { toast('Recording not found — it may already be linked.'); return; }
  if (rec.applicant_id) { toast('Already linked.'); openReview(rec.applicant_id); return; }
  document.getElementById('link-title').textContent = `Link "${rec.title || 'Agape call'}" to an applicant`;
  document.getElementById('link-status').textContent =
    new Date(rec.starts_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const results = document.getElementById('link-results');
  const search = document.getElementById('link-search');
  const renderRows = q => {
    const needle = (q || '').toLowerCase();
    const rows = applicants
      .filter(a => !needle || `${a.first_name} ${a.last_name || ''} ${a.email || ''}`.toLowerCase().includes(needle))
      .slice(0, 30);
    results.innerHTML = rows.map(a =>
      `<button type="button" class="hold-sheet__cancel" style="display:block;width:100%;text-align:left;margin-top:4px" data-link-pick="${esc(a.id)}">
        ${esc(`${a.first_name} ${a.last_name || ''}`.trim())} <span style="opacity:.6">${esc(a.email || '')}</span>
      </button>`).join('') || '<p class="email-modal__status">No matches.</p>';
  };
  search.value = ''; renderRows('');
  search.oninput = () => renderRows(search.value);
  results.onclick = async e => {
    const btn = e.target.closest('[data-link-pick]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const out = await gmailCall({ action: 'link-recording', gcalEventId, applicantId: btn.dataset.linkPick });
      modal.hidden = true;
      toast(`Linked to ${out.firstName} — notes will land on their profile`);
      await loadAll(); render();
      openReview(btn.dataset.linkPick);
    } catch (err) { toast(`Link failed: ${err.message}`); btn.disabled = false; }
  };
  document.getElementById('link-close').onclick = () => { modal.hidden = true; };
  modal.hidden = false;
  search.focus();
}

/* ---------- auth + boot ---------- */

/* Webview sandboxes (Discord/Instagram/FB in-app browsers, Android wv) break
   OAuth round-trips: isolated short-lived storage, and the PKCE verifier is
   lost if the flow hops out and back. Nudge toward the real browser or the
   bot's one-time link instead. */
function inAppBrowser() {
  const ua = navigator.userAgent || '';
  return /discord|instagram|fban|fbav|; wv\)/i.test(ua);
}

/* One-time sign-in link from the Discord "Get sign-in link" button:
   ?signin=<token> → recruit-discord /redeem → verifyOtp mints the session
   (CtrlAuth then fires signedin and the normal gate flow takes over). */
async function redeemSigninToken() {
  const params = new URLSearchParams(location.search);
  const token = params.get('signin');
  if (!token) return;
  const clean = new URL(location.href);
  clean.searchParams.delete('signin');
  history.replaceState(null, '', clean);
  setGate('Signing you in…', null);
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/recruit-discord/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ token }),
    });
    const out = await resp.json();
    if (!resp.ok) throw new Error(out.error || 'redeem failed');
    // token_hash and type ONLY — supabase-js rejects the call if email rides along
    const { error } = await sb.auth.verifyOtp({ type: 'email', token_hash: out.token_hash });
    if (error) throw error;
  } catch (e) {
    setGate(e.message || 'Sign-in link failed.', 'Continue with Discord',
      'Get a fresh link from the "Get sign-in link" button on Discord, or sign in with Discord here.');
    document.getElementById('gate-btn').onclick = signInWithDiscord;
  }
}

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
  // Showing a gate message means we've stopped: reveal the card even if we
  // were mid-load, or the spinner would spin forever over a silent failure.
  document.body.dataset.authState = 'out';
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
    }).then(r => r.json()).then(st => { gmailStatus = st || { connected: false }; renderGmailStatus(); }).catch(() => {});
    await loadAll();
    // background — outreach attachment labels + rail badges need house data;
    // re-render the open view once it lands so labels don't show stale fallbacks
    loadHouse().then(async () => {
      // Saved-for-future people whose date has landed come back first, so the
      // placement sweep below re-places them in the same pass.
      const back = await returnDueCandidates();
      if (back) toast(`${back} saved candidate${back === 1 ? ' is' : 's are'} back — their date arrived`);
      const added = await syncAutoPlacements();
      if (added) toast(`${added} auto-placement${added === 1 ? '' : 's'} added across open listings`);
      const drafted = await syncDraftListings();
      if (drafted) toast(`${drafted} draft listing${drafted === 1 ? '' : 's'} detected from occupancy gaps`);
      renderRailCounts();
      if (VIEWS[view]?.kind === 'applicants') renderApplicants();
    });
    resolveAvatars(); // background — server resolves any unchecked profile photos
    scanInbox();      // background — badge replies without opening each thread
    loadRecordingLeads(); // background — unfiled Discord recording links
    const autoFlagged = await applyAutoFlags();
    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;
    renderRailUser();
    handleGmailCallback();
    view = new URLSearchParams(location.search).get('view') || 'openings';
    view = LEGACY_VIEWS[view] || view;
    if (!VIEWS[view]) view = 'openings';
    pendingOccRoom = view === 'occupancy' ? +new URLSearchParams(location.search).get('room') || null : null;
    render();
    if (autoFlagged) toast(`${autoFlagged} applicant${autoFlagged === 1 ? '' : 's'} auto-archived (budget under $1,500) — update emails queued`);
    const deep = new URLSearchParams(location.search).get('a');
    if (deep && applicants.some(x => x.id === deep)) openReview(deep);
    const linkEv = new URLSearchParams(location.search).get('link');
    if (linkEv) openLinkRecording(linkEv);
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
    if (new URLSearchParams(location.search).get('signin')) return; // redeem in flight
    setGate('Sign in with Discord to open the applicant inbox.', 'Continue with Discord',
      inAppBrowser()
        ? 'Heads up: you\'re in an in-app browser, where Discord sign-in often loops. Use ⋯ → "Open in browser", or tap "Get sign-in link" in the recruiting channel for a one-tap link.'
        : null);
    document.getElementById('gate-btn').onclick = signInWithDiscord;
  });

  window.CtrlAuth.init({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    redirectTo: window.location.origin + window.location.pathname,
    mountTo: '#ctrl-auth-root',
  });
  sb = window.CtrlAuth.getSupabaseClient();
  redeemSigninToken(); // no-op without ?signin=

  document.getElementById('gate-btn').onclick = signInWithDiscord;
  document.getElementById('gate-alt').onclick = () => window.CtrlAuth.openLoginModal();
  // Nothing stored to restore and no redeem in flight? Then we're signed out
  // for certain — show the card now instead of spinning for 2.5s.
  const hasStoredSession = Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k));
  if (!hasStoredSession && !new URLSearchParams(location.search).get('signin')
      && !location.hash.includes('access_token')) {
    document.body.dataset.authState = 'out';
  }

  // If no signedin event lands shortly, we're signed out — show the gate.
  setTimeout(() => {
    if (document.body.dataset.authState === 'loading' && !window.CtrlAuth.getUser()) {
      document.body.dataset.authState = 'out';
    }
  }, 2500);

  // delegation
  document.addEventListener('click', e => {
    // ⋯ listing menus: any click closes open menus except the one being toggled
    const menuBtn = e.target.closest('[data-listing-menu]');
    document.querySelectorAll('.listing-menu').forEach(m => {
      if (!menuBtn || m.dataset.menuFor !== menuBtn.dataset.listingMenu) m.hidden = true;
    });
    if (menuBtn) {
      const m = document.querySelector(`[data-menu-for="${menuBtn.dataset.listingMenu}"]`);
      if (m) m.hidden = !m.hidden;
      return;
    }
    const setSt = e.target.closest('[data-set-status]');
    if (setSt) {
      const [lid, st] = setSt.dataset.setStatus.split('|');
      updateListingStatus(lid, st);
      return;
    }
    const addPl = e.target.closest('[data-add-placement]');
    if (addPl) {
      const [aid, lid] = addPl.dataset.addPlacement.split('|');
      addPlacement(aid, lid, 'manual').then(row => {
        if (row) { toast('Added to the listing'); renderRailCounts(); renderApplicants(); }
      });
      return;
    }
    const occLink = e.target.closest('[data-occ-room-link]');
    if (occLink) {
      e.preventDefault();
      pendingOccRoom = +occLink.dataset.occRoomLink;
      setView('occupancy');
      return;
    }
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
    const vs = e.target.closest('[data-vote-score]');
    if (vs) {
      pendingVote = { score: +vs.dataset.voteScore, veto: false };
      renderReviewFoot(applicants.find(x => x.id === queue[qIndex]));
      return;
    }
    const vv = e.target.closest('[data-vote-veto]');
    if (vv) {
      pendingVote = { score: pendingVote?.score || null, veto: !(pendingVote?.veto ?? myVote(queue[qIndex])?.veto) };
      renderReviewFoot(applicants.find(x => x.id === queue[qIndex]));
      return;
    }
    const cv = e.target.closest('[data-cast-vote]');
    if (cv) {
      if (!pendingVote) {
        const mine = myVote(queue[qIndex]);
        pendingVote = mine ? { score: mine.score, veto: mine.veto } : null;
      }
      castVote(queue[qIndex]);
      return;
    }
    const od = e.target.closest('[data-open-decision]');
    if (od) { openDecisionSheet(od.dataset.openDecision); return; }
    const ro = e.target.closest('[data-reopen]');
    if (ro) { reopenApplicant(ro.dataset.reopen); return; }
    const clear = e.target.closest('[data-clear]');
    if (clear) {
      const a = applicants.find(x => x.id === clear.dataset.clear);
      saveDecision(clear.dataset.clear, null);
      // undoing an auto/manual archive puts them back in front of the house
      if (a && a.stage === 'rejected') setStage(a.id, 'review').then(() => { renderRailCounts(); renderReview(); });
      renderReview();
      return;
    }
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
    if (rtab) { reviewTab = rtab.dataset.reviewTab; renderReview(); gpSyncPlacement(); return; }
    const em = e.target.closest('[data-email]');
    if (em) { openEmailModal(em.dataset.email, em.dataset.emailKind || null); return; }
    const so = e.target.closest('[data-second-opinion]');
    if (so) { requestSecondOpinion(so.dataset.secondOpinion, so); return; }
    const et = e.target.closest('[data-email-toggle]');
    if (et) {
      const bodyEl = et.parentElement.querySelector('.email-row__body');
      if (bodyEl) {
        bodyEl.hidden = !bodyEl.hidden;
        et.setAttribute('aria-expanded', String(!bodyEl.hidden));
        et.parentElement.classList.toggle('is-open', !bodyEl.hidden);
      }
      return;
    }
    const proseT = e.target.closest('[data-prose-toggle]');
    if (proseT) {
      const prose = proseT.previousElementSibling;
      const clamped = prose.classList.toggle('is-clamped');
      proseT.textContent = clamped ? 'More' : 'Less';
      return;
    }
    const fileLead = e.target.closest('[data-file-lead]');
    if (fileLead) {
      const [leadId, aid] = fileLead.dataset.fileLead.split('|');
      const lead = recordingLeads.find(l => l.id === leadId);
      if (lead) {
        gmailCall({ action: 'attach-recording', applicantId: aid, url: lead.url })
          .then(() => {
            recordingLeads = recordingLeads.filter(l => l.id !== leadId);
            toast('Recording filed');
            renderApplicants();
          })
          .catch(err => toast(`Couldn't file: ${err.message}`));
      }
      return;
    }
    const dismissLead = e.target.closest('[data-dismiss-lead]');
    if (dismissLead) {
      const id = dismissLead.dataset.dismissLead;
      gmailCall({ action: 'dismiss-lead', leadId: id }).catch(() => {});
      recordingLeads = recordingLeads.filter(l => l.id !== id);
      renderApplicants();
      return;
    }
    if (e.target.closest('[data-rescan-recordings]')) {
      toast('Scanning the recruiting channels…');
      gmailCall({ action: 'scan-recordings' })
        .then(out => { toast(out.found ? `${out.found} new link${out.found === 1 ? '' : 's'}` : 'No new links'); return loadRecordingLeads(); })
        .catch(err => toast(`Scan failed: ${err.message}`));
      return;
    }
    const addRec = e.target.closest('[data-add-recording]');
    if (addRec) { promptRecordingLink(addRec.dataset.addRecording); return; }
    const orm = e.target.closest('[data-open-remove]');
    if (orm) {
      const [aid, lid] = orm.dataset.openRemove.split('|');
      openRemoveSheet(aid, lid || null);
      return;
    }
    const rpick = e.target.closest('[data-remove-pick]');
    if (rpick) { pickRemoveOption(rpick.dataset.removePick); return; }
    const undo = e.target.closest('[data-undo-exit]');
    if (undo) { undoRowExit(undo.dataset.undoExit); return; }
    const bb = e.target.closest('[data-bring-back]');
    if (bb) {
      const id = bb.dataset.bringBack;
      setExit(id, null).then(async ok => {
        if (!ok) return;
        if (!houseLoaded) await loadHouse();
        const added = await syncAutoPlacements();
        toast(`Back on the board${added ? ` · placed in ${added} listing${added === 1 ? '' : 's'}` : ''}`);
        renderRailCounts();
        if (!document.getElementById('review').hidden) renderReview();
        else if (VIEWS[view]?.kind === 'applicants') renderApplicants();
      });
      return;
    }
    const sp = e.target.closest('[data-slot-pick]');
    if (sp) {
      availSelected = sp.dataset.slotPick;
      document.querySelectorAll('[data-slot-pick]').forEach(c => c.classList.toggle('is-on', c.dataset.slotPick === availSelected));
      renderAvailFoot();
      return;
    }
    const ac = e.target.closest('#avail-confirm');
    if (ac && availSelected && availApplicantId) {
      scheduleSlot(availApplicantId, availSelected, ac, true);
      return;
    }
    const ar = e.target.closest('[data-avail-review]');
    if (ar) { openAvailModal(ar.dataset.availReview); return; }
    const gd = e.target.closest('[data-give-decision]');
    if (gd) { openGiveDecision(gd.dataset.giveDecision); return; }
    const ue = e.target.closest('[data-update-edit]');
    if (ue) { openUpdateEmail(ue.dataset.updateEdit); return; }
    const us = e.target.closest('[data-update-skip]');
    if (us) {
      const a = applicants.find(x => x.id === us.dataset.updateSkip);
      if (a && confirm(`Skip the update email for ${fullName(a)}? They're archived without one.`)) {
        sb.rpc('recruit_skip_update', { p_applicant: a.id }).then(({ error }) => {
          if (error) { toast(`Skip failed: ${error.message}`); return; }
          a.updateSkippedAt = new Date().toISOString(); a.stage = 'archived';
          toast(`${fullName(a)} archived without an update`);
          renderRailCounts(); renderApplicants();
        });
      }
      return;
    }
    const sa = e.target.closest('[data-send-all-updates]');
    if (sa) { sendAllUpdates(sa); return; }
    const od2 = e.target.closest('[data-open-draft]');
    if (od2) { updateListingStatus(od2.dataset.openDraft, 'open'); return; }
    const pm = e.target.closest('[data-play-mini]');
    if (pm) { e.stopPropagation(); gpPlayMini(pm.dataset.playMini); return; }
    const oc = e.target.closest('[data-open-call]');
    if (oc) {
      openReview(oc.dataset.openCall);
      reviewTab = 'call';
      renderReview();
      return;
    }
    const cp = e.target.closest('[data-claim-preview]');
    if (cp) { openSchedulerPreview(cp.dataset.claimPreview); return; }
    const pt = e.target.closest('[data-pick-time]');
    if (pt) {
      openReview(pt.dataset.pickTime);
      reviewTab = 'emails';
      renderReview();
      return;
    }
    const miEdit = e.target.closest('[data-movein-edit]');
    if (miEdit) { moveinEditing = true; renderReview(); return; }
    const miSave = e.target.closest('[data-movein-save]');
    if (miSave) { saveMoveIn(queue[qIndex]); return; }
    const miClear = e.target.closest('[data-movein-clear]');
    if (miClear) { saveMoveIn(queue[qIndex], true); return; }
    const miCancel = e.target.closest('[data-movein-cancel]');
    if (miCancel) { moveinEditing = false; renderReview(); return; }
    const rmPl = e.target.closest('[data-remove-placement]');
    if (rmPl) {
      const [aid, lid] = rmPl.dataset.removePlacement.split('|');
      removePlacement(aid, lid);
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
    const calNav = e.target.closest('[data-cal-nav]');
    if (calNav) {
      const dir = calNav.dataset.calNav;
      const stepMonths = Math.max(1, Math.round(OCC_WINDOW / 2));
      occStart = dir === 'today' ? defaultOccStart() : addMonthsIso(occStart, dir === 'next' ? stepMonths : -stepMonths);
      renderOccupancy();
      return;
    }
    const listCell = e.target.closest('[data-list-room]');
    if (listCell) { createListingFromGap(+listCell.dataset.listRoom, listCell.dataset.listStart); return; }
    const stayLeaving = e.target.closest('[data-stay-leaving]');
    if (stayLeaving) { markLeaving(+stayLeaving.dataset.stayLeaving, stayLeaving.dataset.stayLeavingDate || null); return; }
    const stayDel = e.target.closest('[data-stay-delete]');
    if (stayDel) { deleteStay(stayDel.dataset.stayDelete); return; }
    const stayBar = e.target.closest('[data-stay]');
    if (stayBar) {
      const already = occDrawer?.type === 'stay' && occDrawer.id === stayBar.dataset.stay;
      openOccDrawer(already ? null : { type: 'stay', id: stayBar.dataset.stay });
      return;
    }
    const gapBar = e.target.closest('[data-gap-room]');
    if (gapBar) {
      openOccDrawer({ type: 'gap', roomId: +gapBar.dataset.gapRoom, start: gapBar.dataset.gapStart, end: gapBar.dataset.gapEnd });
      return;
    }
    const roomBtn = e.target.closest('[data-room-info]');
    if (roomBtn) {
      const already = occDrawer?.type === 'room' && occDrawer.roomId === +roomBtn.dataset.roomInfo;
      openOccDrawer(already ? null : { type: 'room', roomId: +roomBtn.dataset.roomInfo });
      return;
    }
    const drawerClose = e.target.closest('[data-drawer-close]');
    if (drawerClose) { openOccDrawer(null); return; }
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
    const cost = e.target.closest('[data-cost-setting]');
    if (cost) {
      const key = cost.dataset.costSetting;
      const value = cost.value === '' ? null : Math.round(+cost.value);
      if (value === null || value < 0) return;
      settings[key] = value;
      sb.from('recruit_settings').upsert({
        key, value, updated_by_name: me?.name || null, updated_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) toast(`Save failed: ${error.message}`);
        else toast('Global cost updated — applies to everyone');
      });
      renderOccDrawer();
    }
  });

  // Re-fit the timeline when the viewport crosses the phone breakpoint.
  occMq.addEventListener('change', () => {
    if (view === 'occupancy' && houseLoaded) renderOccupancy();
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
  document.getElementById('pref-autopost').onchange = async (e) => {
    const value = e.target.checked;
    settings.discord_auto_post = value;
    const { error } = await sb.from('recruit_settings').upsert({
      key: 'discord_auto_post', value, updated_by_name: me?.name || null, updated_at: new Date().toISOString(),
    });
    if (error) { toast(`Save failed: ${error.message}`); e.target.checked = !value; settings.discord_auto_post = !value; }
    else toast(value ? 'Coverage asks now post to Discord automatically' : 'Coverage asks are manual again');
  };
  document.getElementById('gd-close').onclick = () => { document.getElementById('gd-modal').hidden = true; };
  document.getElementById('gd-yes').onclick = () => giveDecision(document.getElementById('gd-modal').dataset.applicant, 'yes');
  document.getElementById('gd-no').onclick = () => giveDecision(document.getElementById('gd-modal').dataset.applicant, 'no');
  document.getElementById('pref-couples').onchange = async (e) => {
    const value = e.target.checked;
    settings.open_to_couples = value;
    const { error } = await sb.from('recruit_settings').upsert({
      key: 'open_to_couples', value, updated_by_name: me?.name || null, updated_at: new Date().toISOString(),
    });
    if (error) { toast(`Preference save failed: ${error.message}`); e.target.checked = !value; settings.open_to_couples = !value; }
    else toast(value ? 'House preference: open to couples' : 'House preference: not open to couples');
  };

  document.getElementById('remove-close').onclick = hideRemoveSheet;
  document.getElementById('remove-cancel').onclick = hideRemoveSheet;
  document.getElementById('remove-submit').onclick = submitRemove;

  document.getElementById('claim-close').onclick = closeSchedulerModal;
  document.getElementById('claim-cancel').onclick = closeSchedulerModal;
  document.getElementById('claim-post-btn').onclick = postSchedulerFromModal;
  document.getElementById('avail-close').onclick = closeAvailModal;
  document.getElementById('avail-ask-coverage').onclick = () => {
    const id = availApplicantId;
    closeAvailModal();
    if (id) openSchedulerPreview(id);
  };
  document.getElementById('email-close').onclick = closeEmailModal;
  document.getElementById('email-regen').onclick = () => emailApplicantId && generateEmail(emailApplicantId);
  document.getElementById('email-send').onclick = async () => {
    if (!gmailStatus.connected) { toast('Connect the shared Gmail first (Emails tab)'); return; }
    const btn = document.getElementById('email-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const sentFor = emailApplicantId;
      await gmailCall({
        action: emailMode === 'update' ? 'send-update' : 'send', applicantId: sentFor,
        subject: document.getElementById('email-subject').value,
        body: document.getElementById('email-body').value,
      });
      if (emailMode === 'update') {
        const a = applicants.find(x => x.id === sentFor);
        if (a) { a.updateSentAt = new Date().toISOString(); a.stage = 'archived'; }
        toast('Update sent — archived clean');
        renderRailCounts();
        if (VIEWS[view]?.kind === 'applicants') renderApplicants();
      } else {
        toast('Sent from live.at.agapesf@gmail.com');
      }
      // Pull the sent message in rather than dropping the cache — clearing
      // it would blank a thread the user is looking at.
      syncEmails(sentFor).then(() => {
        const a = applicants.find(x => x.id === sentFor);
        if (a && queue[qIndex] === sentFor && reviewTab === 'emails') paintEmailsPanel(a, '');
      }).catch(() => {});
      closeEmailModal();
    } catch (e) { toast(`Send failed: ${e.message}`); }
    btn.disabled = false; btn.textContent = emailMode === 'update' ? 'Send update' : 'Send via Agape Gmail';
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
  document.getElementById('decision-cancel').onclick = hideDecisionSheet;
  document.getElementById('decision-submit').onclick = submitDecision;
  document.getElementById('decision-mic').onclick = toggleDictation;
  document.getElementById('decision-use-notes').onclick = summarizeNotesIntoDecision;

  document.addEventListener('keydown', e => {
    const reviewOpen = !document.getElementById('review').hidden;
    const modalOpen = !document.getElementById('email-modal').hidden || !document.getElementById('listing-modal').hidden;
    if (!reviewOpen && !modalOpen) return;
    if (!reviewOpen && e.key !== 'Escape') return;
    if (e.target instanceof Element && e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') {
      if (!document.getElementById('email-modal').hidden) closeEmailModal();
      else if (!document.getElementById('claim-modal').hidden) closeSchedulerModal();
      else if (!document.getElementById('listing-modal').hidden) closeListingModal();
      else if (!document.getElementById('decision-sheet').hidden) hideDecisionSheet();
      else closeReview();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('email-modal').hidden) closeEmailModal();
    if (e.key === 'Escape' && occDrawer && view === 'occupancy') { openOccDrawer(null); return; }
    if (e.key === 'ArrowRight') step(1);
    if (e.key === 'ArrowLeft') step(-1);
  });
}

document.addEventListener('DOMContentLoaded', init);
