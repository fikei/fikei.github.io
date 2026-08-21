/* Agape recruiting viewer — /applications
   Discord-gated (Recruiting Society channel on the Agape server, verified by
   the discord-membership edge fn). Applicants, votes, shared decisions, and
   house notes live in Supabase behind RLS (migrations 108 + 120).

   v4 funnel: Applicants (one reviewer decides: not a fit / needs input /
   move forward, comment required) → Candidates →
   Openings (listing shortlists) → Screening → Archive. The applicant's
   stage column is recomputed server-side by a trigger on recruit_votes;
   manual moves go through the recruit_set_stage RPC. Candidates are
   auto-placed into every open listing they qualify for
   (recruit_listing_candidates, migration 123). */
const VERSION = '3.84.0';
console.log(`[applications] v${VERSION} - Agape recruiting viewer`);

/* Cache-bust guard. index.html carries ?v= on the stylesheet and the scripts,
   and those are three separate strings that a merge can move independently —
   which is exactly what happened: the stylesheet sat at 3.49.0 for four
   releases while the JS advanced, so every CSS change shipped invisible. This
   says so in the console instead of letting it go quiet again. */
(() => {
  const css = [...document.styleSheets].map(s => s.href || '').find(h => h.includes('/css/app.css'));
  const tag = css && (css.match(/[?&]v=([\d.]+)/) || [])[1];
  if (tag && tag !== VERSION) {
    console.warn(`[applications] stale stylesheet: app.css?v=${tag} but app.js is ${VERSION}. `
      + 'Bump every ?v= in applications/index.html together.');
  }
})();

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
    hint: 'our no — records the house decision; their update goes out with the next bulk send',
    chip: 'not a fit', stage: 'rejected', danger: true,
  },
  // The residency decision going the other way. Kept distinct from "not a
  // fit" so the archive can tell "we lived with them and it didn't work"
  // apart from "we never got that far".
  {
    id: 'trial_ended', label: 'Trial ended — not staying',
    hint: 'they trialled with us and the house said no',
    chip: 'trial ended', stage: 'archived', danger: true, trialOnly: true,
  },
];
const removeOption = id => REMOVE_OPTIONS.find(o => o.id === id) || null;

/* Their live trial stay, if they have one. recruit_stays.applicant_id is the
   link (migration 141) — before it existed the occupant was a bare name and
   nothing could join the two sides together. Stays that predate the link
   stay unmatched, which is why this can be null for a real trial candidate. */
function trialStayFor(applicantId) {
  if (!applicantId || !houseLoaded) return null;
  const today = new Date().toISOString().slice(0, 10);
  return stays.find(s => s.kind === 'candidate' && s.applicant_id === applicantId
    && (!s.ends_on || s.ends_on >= today)) || null;
}
/* Any live or upcoming stay of theirs — trial, sublet, or residency. This is
   what "booked" means everywhere: on the calendar, out of the placement
   sweep, and the Book-them-in door closed behind them. */
function liveStayFor(applicantId) {
  if (!applicantId || !houseLoaded) return null;
  const today = new Date().toISOString().slice(0, 10);
  return stays.find(s => s.applicant_id === applicantId && s.kind !== 'shared'
    && (!s.ends_on || s.ends_on >= today)) || null;
}
// Default return date for Save for future: three months out, month start.
function defaultReturnDate() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + setting('save_for_future_months'), 1).toISOString().slice(0, 10);
}

const VIEWS = {
  inbox: { title: 'Applicants', kind: 'applicants' },
  candidates: { title: 'Candidates', kind: 'applicants' },
  openings: { title: 'Openings', kind: 'applicants' },
  screening: { title: 'Screening', kind: 'applicants' },
  archive: { title: 'Archive', kind: 'applicants' },
  occupancy: { title: 'Occupancy', kind: 'house' },
  settings: { title: 'Settings', kind: 'settings' },
  activity: { title: 'Activity', kind: 'activity' },
};
// Old bookmarks and deep links keep working.
// `inbox` stays the view key and the URL — renaming it would break every
// bookmark and deep link — but `?view=applicants` resolves too, since that is
// what the rail now calls it.
const LEGACY_VIEWS = { review: 'inbox', outreach: 'openings', hold: 'inbox', listings: 'openings', applicants: 'inbox' };

let sb = null;                // supabase client (from CtrlAuth)
let me = null;                // { id, name, groupEmail }
let applicants = [];          // newest first; each carries .stage
let decisions = {};           // applicant_id -> { d, reason, by, byName, at }
let votes = {};               // applicant_id -> recruit_votes rows
let placements = [];          // recruit_listing_candidates rows
let viewedIds = new Set();    // applicants I've opened (recruit_applicant_views)
let claimPosts = {};          // applicant_id -> { status, posted_at }
let tourState = {};           // applicant_id -> { status, confirmedSlot?, askedAt? }
let decisionVotes = {};       // applicant_id -> recruit_decision_votes rows
let screeningState = {};      // applicant_id -> { at?, with?, availability? }
let houseEvents = {};         // applicant_id -> non-intro_call calendar rows
let pendingVerdict = null;    // 'not_fit' | 'needs_input' | 'forward' while the review bar is open
let noteDraft = { id: null, text: '' };  // review comment in progress, scoped to its applicant
let footFor = null;           // which applicant the review bar in the DOM belongs to
let commentCounts = {};       // applicant_id -> n
let latestNotes = {};         // applicant_id -> { author, body }
let comments = [];            // comments for the applicant open in review
let activity = [];            // recruit_notifications, newest first — the running log
let activityError = null;
let activityFilter = { kind: 'all', open: false };
let activityOpenCount = 0;    // unresolved notifications, for the rail badge
let view = 'inbox';           // current rail view
let filters = { track: 'all', month: 'any', budget: 'any' }; // shared across applicant views
let rooms = [];               // recruit_rooms, in-pool only — what the funnel places into
let allRooms = [];            // every room including shared spaces, for costs/details
let stays = [];               // recruit_stays rows (date-based tenures)
let listings = [];            // recruit_listings rows
let onboarding = [];          // recruit_onboarding rows (checklist per resident stay)
let houseLoaded = false;
let settings = { open_to_couples: true };
let isAdmin = false;          // derived from Discord: can see #recruiting-automation

/* --- settings accessors (Sassy: Settings) ---
   One read path for every knob, whatever store it lives in. The schema's
   `default` is the fallback, which is why a setting can ship configurable with
   no migration and no seed row: no row means the default. Callers say
   setting('followup_stale_days') and never learn where it lives. */
function setting(key) {
  const def = SETTING_DEFS[key];
  if (!def) { console.warn(`[settings] unknown key: ${key}`); return undefined; }
  let raw;
  if (def.scope === 'house') raw = settings[key];
  else if (def.scope === 'local') raw = localStorage.getItem(def.storageKey || key);
  else if (def.scope === 'profile') raw = profile[def.column || key];
  if (raw === undefined || raw === null || raw === '') return def.default;
  if (def.type === 'number') { const n = +raw; return Number.isFinite(n) ? n : def.default; }
  if (def.type === 'bool') return raw === true || raw === 'true';
  return raw;
}

async function setSetting(key, value) {
  const def = SETTING_DEFS[key];
  if (!def) return { error: { message: `Unknown setting: ${key}` } };
  if (def.scope === 'local') {
    localStorage.setItem(def.storageKey || key, String(value));
    return {};
  }
  if (def.scope === 'profile') {
    profile[def.column || key] = value;
    const { error } = await sb.from('recruit_profiles')
      .upsert({ user_id: me.id, [def.column || key]: value }, { onConflict: 'user_id' });
    return { error };
  }
  // House-wide. RLS allows this only for admins (migration 144); the UI hides
  // the controls, and this is the wall behind that.
  const prev = settings[key];
  settings[key] = value;
  const { error } = await sb.from('recruit_settings').upsert({
    key, value,
    updated_by: me.id,
    updated_by_name: me.name,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  if (error) settings[key] = prev;
  return { error };
}

let profile = {};             // recruit_profiles row for me — display_name, group_email
let settingsMeta = {};        // key -> { updated_by_name, updated_at }, for the audit line
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
// The native form lets applicants pick BOTH tracks (with per-track notes),
// stored as "Full-time resident — note | Short-term (sublet) — note".
const isSublet = a => /short|sublet/i.test(a.residency);
const wantsBoth = a => /full.?time/i.test(a.residency) && isSublet(a);
const trackLabel = a => wantsBoth(a) ? 'Either' : isSublet(a) ? 'Sublet' : 'Full-time';
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
  `<span class="listing-kind listing-kind--${wantsBoth(a) ? 'fulltime' : isSublet(a) ? 'sublet' : 'fulltime'} listing-kind--xs">${trackLabel(a)}</span>`;

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

  // Native /apply values are ISO ("2026-11-15 (flexible)"), possibly per-track
  // ("Full-time: 2026-11-15 (flexible) | Sublet: —") — the first date wins.
  const iso = raw.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${MONTH_ABBR[+iso[2] - 1]} ${+iso[3]}, ${iso[1]}` + (flexible ? ' · flexible' : '');

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

/* The Openings row's funnel micro-state, read as a status chip: nothing sent
   yet · waiting on them · they wrote back · availability in hand · call
   booked · call done · tour cycle. The matching verbs all live in the ⋮
   menu (rowMenuHtml). */
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
    // "Notes on the way…" is a promise. Only make it when a bot is actually
    // going to deliver — and give up on it after 6 hours, because a bot that
    // hasn't produced anything by then isn't going to.
    if (!sc.awaiting) return 'done';
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
  return `<span class="decision-chip decision-chip--vote" title="A recording bot was on this call — the recording and notes usually land within 30 minutes">Notes on the way…</span>`;
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

/* Status only. Every verb for a row lives in its ⋮ menu (rowMenuHtml) — the
   singular highlighted CTA is gone. The chip answers "where are they?"; the
   menu answers "what can I do?". The one clickable exception is Join, which
   exists only for the ~10 minutes a call is actually live and would be
   useless buried in a menu. */
function openingsCta(a) {
  const chip = (txt, mod, title) => `<span class="decision-chip ${mod || ''}"${title ? ` title="${esc(title)}"` : ''}>${txt}</span>`;
  const stack = (top) => `<span class="cta-stack">${top}</span>`;
  const sc = screeningState[a.id];
  const phase = callPhase(sc);

  // Once a tour cycle is underway it owns the row's status.
  const tour = tourState[a.id];
  if (tour?.status === 'confirmed' && tour.confirmedSlot) {
    return stack(chip(`visit ${fmtSlot(tour.confirmedSlot)}`, 'decision-chip--outreach', 'House tour confirmed — they have the address and details'));
  }
  if (tour?.status === 'polled') {
    return stack(chip('house poll open', 'decision-chip--vote', `Housemates are reacting in Discord — the visit confirms itself past ${setting('tour_confirm_votes')} of them`));
  }
  if (tour?.status === 'asked') {
    return stack(chip('tour ask sent', 'decision-chip--outreach', 'Waiting on their availability — the house poll posts itself when they reply'));
  }

  if (phase === 'watch') {
    // Watch earns its inline spot back: the recording is the review artifact,
    // and burying it made every decision one menu deeper. Still no primary —
    // it sits beside the status chip, everything else stays in the ⋮.
    const hd = houseDecision(a.id);
    return stack(`<span class="cta-pair">${hd
      ? chip(`${hd.verdict === 'yes' ? 'accept' : 'pass'} — ${esc(hd.voter_name || 'a housemate')}`, hd.verdict === 'yes' ? 'decision-chip--replied' : 'decision-chip--pass', `The house decision${hd.note ? ` — “${esc(hd.note)}”` : ''}. Change it from the ⋮ menu.`)
      : chip('call done · needs a decision', 'decision-chip--vote', 'One housemate’s read settles it — decide from the ⋮ menu')}${watchBtn(sc, a.id)}</span>`);
  }
  if (phase === 'done') {
    const hd = houseDecision(a.id);
    return stack(hd
      ? chip(`${hd.verdict === 'yes' ? 'accept' : 'pass'} — ${esc(hd.voter_name || 'a housemate')}`, hd.verdict === 'yes' ? 'decision-chip--replied' : 'decision-chip--pass', `The house decision${hd.note ? ` — “${esc(hd.note)}”` : ''}. Change it from the ⋮ menu.`)
      : chip('call done · needs a decision', 'decision-chip--vote', 'One housemate’s read settles it — decide from the ⋮ menu'));
  }
  if (phase === 'processing') return stack(processingChip());
  if (phase === 'live') return stack(joinBtn(sc) || processingChip());
  if (phase === 'scheduled') {
    return stack(chip(fmtSlot(sc.at), 'decision-chip--outreach', `Intro call${sc.with ? ` with ${esc(sc.with)}` : ''}`));
  }
  const claim = claimPosts[a.id];
  if (sc?.availability && claim && (claim.status === 'open' || claim.status === 'manual')) {
    const days = Math.max(0, Math.round((Date.now() - new Date(claim.postedAt).getTime()) / 86400000));
    return stack(chip('◆ sent to housemates', 'decision-chip--outreach', `No screener yet · ${days === 0 ? 'sent today' : `${days}d ago`} — book it yourself from the ⋮ menu`));
  }
  if (sc?.availability) {
    return stack(chip(`times in${sc.nWindows ? ` · ${sc.nWindows} window${sc.nWindows === 1 ? '' : 's'}` : ''}`, 'decision-chip--replied', 'They offered availability — review times from the ⋮ menu'));
  }
  const st = emailState[a.id];
  if (st?.lastDir === 'in') return stack(chip(`replied ${relTime(st.lastAt)}`, 'decision-chip--replied', 'They wrote back — reply from the ⋮ menu'));
  if (st?.lastDir === 'out') {
    // "I'll send an invite" reads as manual scheduling — say so instead of
    // nagging; a shared-account invite gets picked up by the calendar sweep.
    const promised = /\b(invite|calendar|schedul|let'?s (chat|talk|meet)|talk (soon|then|tomorrow))\b/i.test(st.lastSnippet || '');
    // Waiting is passive until ~3 quiet days; then the clock flags the row.
    const stale = Date.now() - new Date(st.lastAt).getTime() > setting('followup_stale_days') * 86400000;
    return stack(chip(`${promised ? 'invite promised · ' : ''}sent ${relTime(st.lastAt)}`, stale ? 'decision-chip--auto' : 'decision-chip--vote', stale ? 'Quiet for a while — a follow-up is worth sending (⋮ menu)' : 'Waiting on them'));
  }
  return stack(chip('no outreach yet', 'decision-chip--vote', 'Start the thread from the ⋮ menu'));
}

/* Blue response dot in the row's left gutter — sits beside the avatar,
   never on top of it. */
function repliedDot(a) {
  // Same blue dot, two meanings by context: in Applicants it marks an
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
  const [aRes, dRes, cRes, eRes, vRes, scRes, avRes, pRes, vwRes, cpRes, dvRes, tRes, edRes] = await Promise.all([
    sb.from('recruit_applicants').select('*').order('submitted_at', { ascending: false }),
    sb.from('recruit_decisions').select('*'),
    sb.from('recruit_comments').select('applicant_id, author_name, body, created_at, source').order('created_at'),
    // Full rows, not just the state columns: this is also what hydrates
    // emailsCache so a profile can render its thread before any Gmail
    // round-trip. body_text is the one heavy column and stays out — the
    // background sync fills it in.
    sb.from('recruit_emails').select('id, applicant_id, gmail_id, thread_id, direction, subject, snippet, from_email, to_email, sent_at').order('sent_at'),
    sb.from('recruit_votes').select('*').order('created_at'),
    sb.from('recruit_screenings').select('id, applicant_id, starts_at, ends_at, status, housemate_name, meet_link, recall_status, recall_bot_id, external_recording_url, kind, title, calendar_id').order('starts_at'),
    sb.from('recruit_availability').select('applicant_id, windows, updated_at, source_gmail_id'),
    sb.from('recruit_listing_candidates').select('*'),
    sb.from('recruit_applicant_views').select('applicant_id'),
    sb.from('recruit_claim_posts').select('applicant_id, status, posted_at'),
    sb.from('recruit_decision_votes').select('*'),
    sb.from('recruit_tours').select('applicant_id, status, asked_at, confirmed_slot, off_hours'),
    sb.from('recruit_email_drafts').select('*'),
  ]);
  placements = pRes.data || [];
  emailDrafts = {};
  for (const d of (edRes?.data || [])) emailDrafts[d.applicant_id] = d;
  viewedIds = new Set((vwRes.data || []).map(v => v.applicant_id));
  claimPosts = {};
  for (const c of (cpRes.data || [])) claimPosts[c.applicant_id] = { status: c.status, postedAt: c.posted_at };
  tourState = {};
  for (const t of (tRes?.data || [])) tourState[t.applicant_id] = { status: t.status, askedAt: t.asked_at, confirmedSlot: t.confirmed_slot, offHours: t.off_hours };
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
      // Whether anything is still due to land. A call we never sent a bot to
      // — anything booked outside the app, which is most of the swept ones —
      // has no recording coming, ever.
      awaiting: Boolean(s.recall_bot_id) && s.recall_status !== 'done' && s.recall_status !== 'failed',
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
    for (const row of (data || [])) {
      settings[row.key] = row.value;
      settingsMeta[row.key] = { by: row.updated_by_name, at: row.updated_at };
    }
  });
  if (aRes.error) throw aRes.error;
  // Native drafts (someone mid-way through /apply) are not applications yet
  // — they enter the funnel when the applicant hits Submit.
  applicants = (aRes.data || []).filter(r => r.is_submitted !== false).map(r => ({
    id: r.id, ts_iso: r.submitted_at,
    updatedAt: r.updated_at || null, origin: r.source || 'sheet',
    anythingElse: r.anything_else || '', community: r.community || '',
    first: r.first_name, last: r.last_name, pronouns: r.pronouns,
    email: r.email, phone: r.phone || '', social: r.social, about: r.about, why: r.why_agape,
    gifts: r.gifts, source: r.heard_from, residency: r.residency,
    movein: r.move_in, budget: r.budget, avatarUrl: r.avatar_url,
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
  // 'Either' applicants qualify for both listing kinds.
  if (l.kind === 'sublet' ? !isSublet(a) : (isSublet(a) && !wantsBoth(a))) return false;
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
    return startMonth >= cur && startMonth <= monthShift(cur, setting('movein_flex_months'));
  }
  const range = moveInRange(a);
  if (!range) return false; // no parseable dates — can't confirm they line up
  const flexPad = /flexible/i.test(norm || '') ? setting('movein_flex_months') : 0;
  return monthShift(range.hi, flexPad) >= startMonth && monthShift(range.lo, -flexPad) <= endMonth;
}

const activePlacements = id => placements.filter(p => p.applicant_id === id && p.status === 'active');
const activePlacement = id => activePlacements(id)[0] || null;

/* Of the open listings an applicant qualifies for, the one they actually fit
   best: closest start date to their confirmed move-in, then earliest start,
   then lowest id so the choice is stable run to run. Same ordering migration
   139 used to reconcile the duplicates, so the sweep and the backfill agree.
   A tombstoned listing is a recruiter's "not here" and is never re-picked. */
function bestListingFor(a) {
  const target = a.moveinFrom ? new Date(a.moveinFrom).getTime() : null;
  const tombstoned = new Set(placements
    .filter(p => p.applicant_id === a.id && p.status === 'removed')
    .map(p => p.listing_id));
  return listings
    .filter(l => l.status === 'open' && !tombstoned.has(l.id) && qualifiesFor(a, l))
    .sort((x, y) => {
      if (target !== null) {
        const dx = Math.abs(new Date(x.starts_on).getTime() - target);
        const dy = Math.abs(new Date(y.starts_on).getTime() - target);
        if (dx !== dy) return dx - dy;
      }
      return x.starts_on.localeCompare(y.starts_on) || String(x.id).localeCompare(String(y.id));
    })[0] || null;
}

/* Insert missing placements for every candidate AND prune auto rows that no
   longer qualify (rule changes, edited listings, stage moves). Never touches
   manual placements or tombstones a recruiter removed. Returns adds. */
async function syncAutoPlacements() {
  if (!houseLoaded) return 0;
  const have = new Set(placements.map(p => `${p.applicant_id}:${p.listing_id}`));
  const fresh = [];
  // A saved-for-future candidate keeps the stage but is off the board until
  // their date lands, so they're excluded here as well as in matchesView.
  // Booked people (a live trial or sublet) are off the board too — the room
  // question is answered; the calendar owns them now.
  for (const a of applicants.filter(x => x.stage === 'candidate' && !x.exitReason && !liveStayFor(x.id))) {
    // One listing each. Someone already placed is left alone — the sweep
    // must never yank a person out from under whoever is working them.
    if (activePlacements(a.id).length) continue;
    const best = bestListingFor(a);
    if (best && !have.has(`${a.id}:${best.id}`)) {
      fresh.push({ applicant_id: a.id, listing_id: best.id, source: 'auto' });
    }
  }
  const stale = placements.filter(p => {
    if (p.source !== 'auto' || p.status !== 'active') return false;
    const a = applicants.find(x => x.id === p.applicant_id);
    const l = listings.find(x => x.id === p.listing_id);
    return !a || !l || a.stage !== 'candidate' || a.exitReason || !qualifiesFor(a, l) || !!liveStayFor(a.id);
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

/* An applicant belongs to exactly ONE listing (migration 139). Placing them
   somewhere therefore MOVES them — the previous active placement is dropped
   first, or the unique index would reject the insert. Deleted rather than
   tombstoned: a tombstone means "never here again", and a move says nothing
   of the kind. */
async function addPlacement(applicantId, listingId, source = 'manual') {
  const prior = placements.filter(p =>
    p.applicant_id === applicantId && p.status === 'active' && p.listing_id !== listingId);
  if (prior.length) {
    const { error: delErr } = await sb.from('recruit_listing_candidates')
      .delete().in('id', prior.map(p => p.id));
    if (delErr) { toast(`Couldn't move them: ${delErr.message}`); return null; }
    const gone = new Set(prior.map(p => p.id));
    placements = placements.filter(p => !gone.has(p.id));
  }
  const { data, error } = await sb.from('recruit_listing_candidates').upsert({
    applicant_id: applicantId, listing_id: listingId, source,
    status: 'active', added_by_name: me?.name || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id,listing_id' }).select().single();
  if (error) { toast(`Couldn't add to listing: ${error.message}`); return null; }
  placements = [...placements.filter(p => !(p.applicant_id === applicantId && p.listing_id === listingId)), data];
  // Only a hand-made placement is an event — the auto-sweep runs constantly and
  // its results are already visible as the candidate_placed notification.
  if (source !== 'auto') {
    const who = applicants.find(x => x.id === applicantId);
    logEvent('event_placement', applicantId, who ? fullName(who) : '',
      `${me?.name || 'A housemate'} put {} on ${listingLabel(listingId)}.`);
  }
  // They now have a room, so "no room fits" is answered — and the listing has a
  // shortlist, so its "nobody qualifies" is too.
  ackFor('applicant', applicantId, ['candidate_parked']);
  ackFor('listing', listingId, ['listing_no_qualifiers']);
  return data;
}

async function removePlacement(applicantId, listingId, quiet = false) {
  const { error } = await sb.from('recruit_listing_candidates')
    .update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('applicant_id', applicantId).eq('listing_id', listingId);
  if (error) { toast(`Remove failed: ${error.message}`); return; }
  const row = placements.find(p => p.applicant_id === applicantId && p.listing_id === listingId);
  if (row) row.status = 'removed';
  const who = applicants.find(x => x.id === applicantId);
  logEvent('event_placement', applicantId, who ? fullName(who) : '',
    `${me?.name || 'A housemate'} took {} off ${listingLabel(listingId)}.`);
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

function openRemoveSheet(applicantId, listingId = null, opts = {}) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  removeTarget = { applicantId, listingId: listingId || null };
  removePick = null;
  document.getElementById('remove-title').textContent = `Remove ${fullName(a)}`;
  document.getElementById('remove-note').value = opts.note || '';
  document.getElementById('remove-until').value = defaultReturnDate();
  document.getElementById('remove-until-wrap').hidden = true;
  renderRemoveOptions();
  document.getElementById('remove-submit').disabled = true;
  document.getElementById('remove-submit').classList.remove('btn--danger');
  document.getElementById('remove-modal').hidden = false;
  // Decide-no arrives here with "Not a fit" preselected — the verdict and
  // its consequences (archive + update email) are one gesture, not two apps.
  if (opts.preselect) pickRemoveOption(opts.preselect);
}

function renderRemoveOptions() {
  const listingId = removeTarget?.listingId;
  const onTrial = !!trialStayFor(removeTarget?.applicantId);
  document.getElementById('remove-options').innerHTML = REMOVE_OPTIONS
    .filter(o => (!o.scope || listingId) && (!o.trialOnly || onTrial))
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
    if (opt.id === 'not_a_fit') {
      await saveDecision(applicantId, 'pass', null, null, note);
      // Not-a-fit IS the house decision going the no way — record it as one,
      // so the decision chip, the sheet, and the archive all tell one story.
      await writeHouseDecision(applicantId, 'no', note);
    }
    if (a.stage !== opt.stage) await setStage(applicantId, opt.stage);
    toast(opt.id === 'not_a_fit' || opt.id === 'opted_out'
      ? `${fullName(a)} → Archived`
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
let emailKind = null;         // typed draft override, e.g. 'tour'
let emailDrafts = {};         // applicant_id -> recruit_email_drafts row ("Send later")
let emailExtras = null;       // { cc, attachments, stampStayId, stamp } riding the next send

async function openEmailModal(applicantId, kind) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  // Outreach is off for anyone who has been archived. Inviting someone to pick
  // a time right after turning them down is the worst thing this app could
  // send, so the drafter is unreachable for them rather than merely unused.
  if (a.stage === 'rejected' || a.stage === 'archived') {
    toast(`${fullName(a)} is archived — no outreach for them`);
    return;
  }
  emailApplicantId = applicantId;
  emailMode = 'outreach';
  emailKind = kind || null;
  emailExtras = null;
  document.getElementById('email-send').textContent = 'Send via Agape Gmail';
  document.getElementById('email-title').textContent = kind === 'tour' ? `Invite ${a.first} for a house tour`
    : kind === 'accepted' ? `Tell ${a.first} they're in` : `Email ${fullName(a)}`;
  document.getElementById('email-subject').value = '';
  document.getElementById('email-body').value = '';
  const addedHost = document.getElementById('email-added');
  if (addedHost) { addedHost.hidden = true; addedHost.innerHTML = ''; }
  // A saved draft beats a fresh AI one — someone already put words in.
  // Regenerate is the way to a fresh draft from here.
  const saved = emailDrafts[applicantId];
  if (saved && saved.mode === 'outreach') {
    emailKind = saved.kind || emailKind;
    // The day-of draft carries its send stamp, so a sent one stops nagging.
    if (saved.kind === 'movein_day') {
      const st = liveStayFor(applicantId);
      if (st) emailExtras = { stampStayId: st.id, stamp: 'dayof' };
    }
    document.getElementById('email-subject').value = saved.subject || '';
    document.getElementById('email-body').value = saved.body || '';
    document.getElementById('email-status').textContent =
      `Saved draft — ${saved.saved_by_name || 'a housemate'} · ${relTime(saved.updated_at)}. Edit and send, or Regenerate for a fresh one.`;
    document.getElementById('email-modal').hidden = false;
    return;
  }
  document.getElementById('email-status').textContent = kind === 'tour'
    ? 'Drafting the availability ask — Tue–Thu 5–7pm is stated as the preference, with no reasoning exposed…'
    : kind === 'accepted'
      ? 'Drafting the acceptance — room, dates, and next steps from their booking. Sending is optional…'
      : 'Drafting from their application, the listing, and any flags…';
  document.getElementById('email-modal').hidden = false;
  await generateEmail(applicantId);
}

/* "Send later" — the draft outlives the modal, server-side, one per
   applicant, for whoever picks it up next. Reopening the composer loads it. */
async function saveEmailDraft() {
  if (!emailApplicantId) return;
  const row = {
    applicant_id: emailApplicantId, mode: emailMode, kind: emailKind || null,
    subject: document.getElementById('email-subject').value.slice(0, 300),
    body: document.getElementById('email-body').value.slice(0, 10000),
    saved_by: me.id, saved_by_name: me.name, updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('recruit_email_drafts').upsert(row);
  if (error) { toast(`Draft save failed: ${error.message}`); return; }
  emailDrafts[emailApplicantId] = row;
  toast('Draft saved — it loads next time anyone opens their email');
  closeEmailModal();
}

async function clearEmailDraft(applicantId) {
  if (!emailDrafts[applicantId]) return;
  delete emailDrafts[applicantId];
  const { error } = await sb.from('recruit_email_drafts').delete().eq('applicant_id', applicantId);
  if (error) console.warn('draft clear failed', error.message);
}

async function generateEmail(applicantId) {
  const subject = applicants.find(x => x.id === applicantId);
  if (subject && (subject.stage === 'rejected' || subject.stage === 'archived')) {
    document.getElementById('email-status').textContent = 'Archived — no outreach for them.';
    return;
  }
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
    const typeLabels = { first_response: 'First response', follow_up: 'Follow-up nudge', reply: 'Reply to their last email', post_call: 'Post-call thank-you', reschedule: 'Reschedule ask', tour: 'House tour ask', visit: 'House tour ask', accepted: 'Acceptance email' };
    document.getElementById('email-status').textContent =
      `${typeLabels[out.emailType] || 'Outreach'}${out.reason ? ` — ${out.reason}` : ''}. Edit freely, then send.`;
    // What the drafter folded in beyond the scheduling ask, and why — so the
    // sender knows before hitting send rather than by diffing the copy.
    const addedHost = document.getElementById('email-added');
    if (addedHost) {
      if (out.added?.length) {
        addedHost.innerHTML = `<p class="email-added__title">Also added to this email:</p>` +
          out.added.map(x => `<p class="email-added__item"><strong>${esc(x.what)}</strong>${x.why ? ` — ${esc(x.why)}` : ''}</p>`).join('');
        addedHost.hidden = false;
      } else { addedHost.hidden = true; addedHost.innerHTML = ''; }
    }
  } catch (e) {
    document.getElementById('email-status').textContent = `Draft failed: ${e.message}`;
  }
}

function closeEmailModal() {
  emailApplicantId = null;
  emailExtras = null;
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

/* ---------- reviews + stage machine ---------- */
/* One reviewer decides. Three verdicts, a comment on each, and the DB trigger
   moves the applicant on the most recent decisive one (migration 140). */
const VERDICTS = {
  not_fit: { label: 'Not a fit', title: 'Archives them — an update email is owed', cls: 'is-not-fit' },
  needs_input: { label: 'Needs input', title: 'Stays in Applicants, flagged for another housemate to read', cls: 'is-needs-input' },
  forward: { label: 'Move forward', title: 'Moves them to Candidates and into every listing they qualify for', cls: 'is-forward' },
};

const myVote = id => (votes[id] || []).find(v =>
  (me?.id && v.voter_id === me.id) || (me?.groupEmail && v.voter_email && v.voter_email === me.groupEmail)) || null;

/* Reviews newest-first, plus the one that decided the stage. */
function voteStats(id) {
  const list = [...(votes[id] || [])].sort((x, y) =>
    new Date(y.updated_at || y.created_at) - new Date(x.updated_at || x.created_at));
  const decisive = list.find(v => v.verdict === 'not_fit' || v.verdict === 'forward') || null;
  return {
    list,
    n: list.length,
    decisive,
    notFit: decisive?.verdict === 'not_fit' ? decisive : null,
    needsInput: list.filter(v => v.verdict === 'needs_input'),
  };
}

const reviewerName = v => v.voter_name || v.voter_email || 'a housemate';

/* Manual stage moves go through the RPC — recruit_applicants is read-only
   to clients; vote-driven moves happen in the DB trigger. */
async function setStage(id, stage) {
  const { error } = await sb.rpc('recruit_set_stage', { p_applicant: id, p_stage: stage });
  if (error) { toast(`Stage change failed: ${error.message}`); return false; }
  const a = applicants.find(x => x.id === id);
  const before = a?.stage;
  if (a) a.stage = stage;
  if (a && before !== stage) {
    logEvent('event_stage', id, fullName(a),
      `${me.name || 'A housemate'} moved {} from ${before || 'nowhere'} to ${stage}.`);
    // Anything that chases a live candidate stops mattering the moment they
    // stop being one.
    if (stage !== 'candidate' && stage !== 'review') {
      ackFor('applicant', id, ['candidate_parked', 'candidate_placed', 'screening_followup',
        'decision_open', 'gone_cold', 'review_stalled', 'needs_input']);
    }
  }
  return true;
}

/* Save my review, then pick up whatever stage the DB trigger computed. The
   comment is required on every verdict — it's the record of why, and for
   "Not a fit" it becomes the reason on the archived record. */
async function castVote(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a || !pendingVerdict) return;
  const note = (document.getElementById('vote-note')?.value || '').trim();
  if (!VERDICTS[pendingVerdict]) { toast('Pick a verdict first'); return; }
  if (note.length < 3) { toast('Add a comment — every review needs a why'); return; }
  const { data, error } = await sb.from('recruit_votes').upsert({
    applicant_id: applicantId, voter_id: me.id, voter_name: me.name,
    verdict: pendingVerdict, score: null, veto: false, note,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id,voter_id' }).select().single();
  if (error) { toast(`Review failed: ${error.message}`); return; }
  votes[applicantId] = [...(votes[applicantId] || []).filter(v => v.voter_id !== me.id), data];
  logEvent('event_verdict', applicantId, fullName(a),
    `${me.name || 'A housemate'} reviewed {} as ${VERDICTS[pendingVerdict]?.label.toLowerCase() || pendingVerdict}.`, note);
  // The review IS the answer to both of those asks.
  ackFor('applicant', applicantId, ['review_stalled', 'needs_input', 'application_new']);
  // "Not a fit" is a recruiter decision too, so Archive and the update tray
  // can show the reason in the reviewer's own words.
  if (pendingVerdict === 'not_fit') await saveDecision(applicantId, 'pass', 'fit', me.name, note);
  const { data: fresh } = await sb.from('recruit_applicants').select('stage').eq('id', applicantId).single();
  const before = a.stage;
  if (fresh) a.stage = fresh.stage;
  const verdict = pendingVerdict;
  pendingVerdict = null;
  noteDraft = { id: null, text: '' };
  if (verdict === 'not_fit') {
    // No per-decision email offer: rejected rows sit in the Archive's update
    // queue and go out in bulk. Deciding and writing are separate moments.
    renderRailCounts();
    // Auto-advance: their profile has nothing left to do on it. The banner
    // carries the outcome onto the next applicant.
    const summary = `${fullName(a)} archived — update rides the next bulk send`;
    // Last in the queue means step() closes the overlay, taking the banner with
    // it, so say it in a toast instead.
    if (qIndex >= queue.length - 1) toast(summary);
    else {
      showReviewBanner(`<span><b>${esc(fullName(a))}</b> archived — update rides the next bulk send</span>
        <button type="button" class="cta-link" data-reopen="${a.id}">Undo</button>`);
      keepBannerOnce = true;
    }
    step(1);
    return;
  }
  if (a.stage === 'candidate' && before !== 'candidate') {
    if (!houseLoaded) await loadHouse();
    const added = await syncAutoPlacements();
    const placed = added ? ` · placed in ${added} listing${added === 1 ? '' : 's'}` : '';
    toast(`${fullName(a)} moved forward → Candidates${placed}`);
    // The profile changes shape underneath you — same person, different
    // questions. Say so where the eye already is (the bar it replaces) and
    // keep the way back within reach.
    showReviewBanner(`<span><b>${esc(fullName(a))}</b> is now a candidate${placed}</span>
      <button type="button" class="cta-link" data-reopen="${a.id}">Undo</button>`);
    justPromoted = a.id;
  } else toast('Saved — flagged for another housemate to read');
  renderRailCounts();
  renderReview();
}

/* House rule: a stated budget ceiling under $1,500/mo is an auto-flag —
   straight to Archive (rejected: an update email is owed). Recorded as a
   decision too, for attribution and undo. */
/* Attribution for decisions the app made on its own. Anything carrying this
   name is tagged as automatic wherever it's shown, so nobody reads a house
   rule as a housemate's call. */
const AUTO_DECIDER = 'House rule';
const isAutoDecision = rec => rec?.byName === AUTO_DECIDER || /^Auto[\s—-]/.test(rec?.byName || '');
const fmtMoney = n => n == null ? '' : `$${Number(n).toLocaleString()}`;

async function applyAutoFlags() {
  const auto = applicants.filter(a => a.stage === 'review' && !decisions[a.id]
    && budgetMax(a.budget) !== null && budgetMax(a.budget) < 1500);
  for (const a of auto) {
    await saveDecision(a.id, 'pass', 'budget', AUTO_DECIDER,
      `Budget tops out at ${fmtMoney(budgetMax(a.budget))}/mo — under the $1,500 house floor.`);
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
  const [rRes, sRes, lRes, oRes] = await Promise.all([
    // Rooms out of the pool (shared spaces like the basement Studio) are real
    // rooms the funnel never places anyone into — see migration 146.
    sb.from('recruit_rooms').select('*').order('sort'),
    sb.from('recruit_stays').select('*').order('starts_on'),
    sb.from('recruit_listings').select('*').order('starts_on'),
    sb.from('recruit_onboarding').select('*').order('sort'),
  ]);
  // `!== false` on purpose: a room row that predates migration 146 has no
  // in_pool value, and it should stay visible rather than vanish.
  allRooms = rRes.data || [];
  rooms = allRooms.filter(r => r.in_pool !== false);
  stays = sRes.data || [];
  listings = lRes.data || [];
  onboarding = oRes.data || [];
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
  if (headAction) headAction.innerHTML =
    view === 'openings' ? `<button class="btn btn--sm" data-new-listing>New listing</button>`
    // Referrals and walk-ins that never touched the application form.
    : view === 'inbox' || view === 'candidates'
      ? `<button class="btn btn--sm" data-add-person="${view === 'candidates' ? 'candidate' : 'review'}">Add person</button>`
    : '';
  document.querySelectorAll('[data-view-link]').forEach(el =>
    el.classList.toggle('is-current', el.dataset.viewLink === view
      && (el.classList.contains('rail-nav__row') || el.classList.contains('rail-foot__settings'))));
  renderRailCounts();

  const root = document.getElementById('view-root');
  if ((def.kind === 'house' || view === 'openings') && !houseLoaded) {
    root.innerHTML = `<p class="inbox-empty">Loading…</p>`;
    await loadHouse();
    if (VIEWS[view].kind !== 'house') return; // navigated away meanwhile
  }
  if (def.kind === 'activity') {
    root.innerHTML = `<p class="inbox-empty">Loading…</p>`;
    await loadActivity();
    if (view !== 'activity') return;   // navigated away meanwhile
    renderActivity();
    return;
  }
  if (def.kind === 'settings') {
    root.innerHTML = `<p class="inbox-empty">Loading…</p>`;
    await loadSettingsExtras();
    if (view !== 'settings') return;   // navigated away meanwhile
    renderSettings();
    return;
  }
  if (def.kind === 'applicants') renderApplicants();
  else if (view === 'occupancy') renderOccupancy();
}

/* ---------- Settings (Sassy: Settings) ----------
   Rendered from SETTING_DEFS / SETTING_SECTIONS, so adding a knob is one object
   literal in settings-schema.js and nothing here changes. Four field types
   cover every setting in the app; automations and connections are status rows,
   not fields, and get their own renderers.

   No Save anywhere: every field writes on `change` (see the drawer-cta rule).
   The only button in a section is destructive.

   House-wide writes are admin-only in RLS (migration 144). Non-admins see the
   same values, disabled, with one line saying who decides — read access was
   never the thing being protected. */
let cronStatus = [];          // recruit_cron_status() rows
let gmailStatusFull = null;   // recruit-gmail { action: 'status' }

async function loadSettingsExtras() {
  const [cron, prof] = await Promise.all([
    sb.rpc('recruit_cron_status'),
    sb.from('recruit_profiles').select('display_name, group_email').eq('user_id', me.id).maybeSingle(),
  ]);
  cronStatus = cron.data || [];
  if (cron.error) console.warn('[settings] cron status unavailable:', cron.error.message);
  if (prof.data) profile = prof.data;
}

function settingFieldHtml(key) {
  const def = SETTING_DEFS[key];
  const val = setting(key);
  const locked = def.scope === 'house' && !isAdmin;
  const dis = locked ? 'disabled' : '';
  let control;
  if (def.type === 'bool') {
    control = `<label class="set-switch">
      <input type="checkbox" data-setting="${key}" ${val ? 'checked' : ''} ${dis}>
      <span class="set-switch__track" aria-hidden="true"><span class="set-switch__knob"></span></span>
    </label>`;
  } else if (def.type === 'number') {
    control = `<span class="set-num">
      <input type="number" class="listing-status" data-setting="${key}" value="${val}"
        min="${def.min ?? 0}" max="${def.max ?? 9999}" step="${def.step ?? 1}" ${dis}>
      ${def.unit ? `<span class="set-num__unit">${esc(def.unit)}</span>` : ''}
    </span>`;
  } else if (def.type === 'enum') {
    control = `<select class="listing-status set-enum" data-setting="${key}" ${dis}>
      ${def.options.map(([v, label]) => `<option value="${v}" ${val === v ? 'selected' : ''}>${esc(label)}</option>`).join('')}
    </select>`;
  } else {
    control = `<input type="text" class="listing-status set-text" data-setting="${key}"
      value="${esc(String(val || ''))}" maxlength="${def.maxlength || 200}" ${dis}>`;
  }
  const meta = settingsMeta[key];
  return `<div class="set-field ${locked ? 'is-locked' : ''}">
    <span class="set-field__label">${esc(def.label)}</span>
    <span class="set-field__control">${control}</span>
    <span class="set-field__hint">${esc(def.hint || '')}${
      meta?.by ? ` <span class="set-field__by">${esc(meta.by)} changed this ${relTime(meta.at)}</span>` : ''}</span>
  </div>`;
}

const CRON_HUMAN = {
  '*/15 * * * *': 'every 15 min', '*/20 * * * *': 'every 20 min',
  '7 * * * *': 'hourly', '45 */6 * * *': 'every 6 hours',
};

function settingsAutomationsHtml() {
  const byName = Object.fromEntries(cronStatus.map(r => [r.jobname, r]));
  const rows = SETTING_AUTOMATIONS.map(a => {
    const r = byName[a.jobname];
    const cadence = r ? (CRON_HUMAN[r.schedule] || r.schedule) : 'not scheduled';
    const when = r?.last_run ? `ran ${relTime(r.last_run)}` : 'never run';
    const bad = r && r.last_status && r.last_status !== 'succeeded';
    return `<div class="set-auto ${r?.active ? '' : 'is-off'}">
      <span class="set-auto__label">${esc(a.label)}</span>
      <span class="set-auto__when ${bad ? 'is-bad' : ''}">${esc(r?.active ? when : 'paused')}${
        bad ? ` · ${esc(r.last_status)}` : ''}</span>
      <span class="set-auto__hint">${esc(a.hint)}</span>
      <span class="set-auto__cadence">${esc(cadence)}</span>
    </div>`;
  }).join('');
  // discord_auto_post is the one automation with a real switch — the cron jobs
  // are scheduled in the database, and a toggle here that only half-worked
  // would be worse than saying where they live.
  return rows + settingFieldHtml('discord_auto_post') +
    `<p class="set-note">Cadence is set by <code>pg_cron</code> in the database, not here. A paused job means someone unscheduled it.</p>`;
}

function settingsConnectionsHtml() {
  const g = gmailStatusFull || gmailStatus || { connected: false };
  // Same status vocabulary as the design system's .status indicator: a small
  // dot carries the color, the text stays downstyled. A card that needs a
  // human action swaps the state for its one repair verb — the tinted button
  // IS the indicator, never both.
  const conn = (label, ok, detail, warn, action, dim) => `<div class="set-conn${dim ? ' is-dim' : ''}">
    <span class="set-conn__label">${esc(label)}</span>
    ${action || (dim ? '' : `<span class="set-conn__state ${ok ? 'is-ok' : (warn ? 'is-warn' : 'is-off')}"><span class="set-conn__dot" aria-hidden="true"></span>${ok ? 'connected' : esc(warn || 'not connected')}</span>`)}
    ${detail ? `<span class="set-conn__detail">${esc(detail)}</span>` : ''}
  </div>`;
  return conn('Shared Gmail', !!g.connected, g.connected
      ? `${g.email || ''}${g.connected_by_name ? ` · connected by ${g.connected_by_name}` : ''}`
      : 'Applications and replies stop arriving until this is reconnected. You must be signed into live.at.agapesf@gmail.com in this browser.',
      null,
      g.connected ? '' : `<button type="button" class="btn btn--sm set-conn__action" id="set-gmail-connect">${g.reconnect ? 'Reconnect' : 'Connect'}</button>`)
    // Same rule as the button card, different clothes: no second red flag.
    // A calendar with nothing to click dims whole and drops its state text
    // entirely — the quiet card is the state, the detail says when it wakes.
    + conn('House calendar', !!g.connected,
        g.connected ? 'Screening invites land here.' : 'Wakes back up when Gmail reconnects.',
        null, '', !g.connected)
    + conn('Discord', true, '#recruiting-automation · #recruiting-interviews');
}

function settingsDataHtml() {
  return `<button type="button" class="drawer-cta__alt" id="set-export">
      <span>Export decisions</span>
      <span class="drawer-cta__exit-hint">every review, verdict, and comment as CSV</span>
    </button>`;
}

function renderSettings() {
  const host = document.getElementById('view-root');
  host.className = 'settings';
  const section = sec => {
    let body;
    if (sec.rows === 'automations') body = settingsAutomationsHtml();
    else if (sec.rows === 'connections') body = settingsConnectionsHtml();
    else if (sec.rows === 'data') body = settingsDataHtml();
    else {
      const keys = Object.keys(SETTING_DEFS).filter(k => SETTING_DEFS[k].section === sec.id);
      if (!keys.length) return '';
      body = keys.map(settingFieldHtml).join('');
    }
    const locked = !isAdmin && (sec.id === 'house' || sec.id === 'funnel');
    return `<section class="set-sec" id="set-${sec.id}">
      <h2 class="set-sec__title">${esc(sec.title)}</h2>
      <p class="set-sec__hint">${esc(sec.hint)}${locked ? ' Only housemates who can see #recruiting-automation can change them.' : ''}</p>
      ${body}
    </section>`;
  };
  host.innerHTML = `
    <p class="set-lede">${isAdmin
      ? 'Changes apply the moment you make them.'
      : 'You can see everything here. Changing the house-wide settings needs access to #recruiting-automation.'}</p>
    ${SETTING_SECTIONS.map(section).join('')}`;

  host.querySelectorAll('[data-setting]').forEach(el => {
    el.addEventListener('change', async () => {
      const key = el.dataset.setting;
      const def = SETTING_DEFS[key];
      let value;
      if (def.type === 'bool') value = el.checked;
      else if (def.type === 'number') {
        value = Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, Math.round(+el.value || 0)));
        el.value = value;   // clamp visibly rather than saving something else
      } else value = el.value.trim();
      const { error } = await setSetting(key, value);
      if (error) { toast(`Could not save: ${error.message}`); renderSettings(); return; }
      flashSetting(el);
      if (key === 'theme') applyTheme(value);
      // A window or a threshold changes what the funnel says about everyone.
      if (['followup_stale_days', 'movein_flex_months', 'gap_min_days'].includes(key)) renderRailCounts();
    });
  });
  host.querySelector('#set-export')?.addEventListener('click', exportCsv);
  host.querySelector('#set-gmail-connect')?.addEventListener('click', connectSharedGmail);
}

function flashSetting(el) {
  const field = el.closest('.set-field');
  if (!field) return;
  field.classList.add('is-saved');
  setTimeout(() => field.classList.remove('is-saved'), 1400);
}

/* ---------- activity log ----------
   The running log of every notification, exactly as recorded — the same rows
   #recruiting-automation gets, and the same rows the digest draws from. No
   filtering by default and nothing hidden: muted kinds and DMs are shown with
   a label saying so, because the point of the log is that it is complete.
   Migration 142 / recruit_notifications. */
/* Kind → how it introduces itself. Must stay in step with KINDS in
   _shared/recruit-notify.ts: the log and Discord should use the same words for
   the same thing, and neither should ever show the raw kind slug. */
/* Mirrors KINDS in _shared/recruit-notify.ts — the log and Discord must use the
   same word and the same icon for the same thing, and neither may ever show a
   raw kind slug. Single-codepoint emoji only: anything needing a U+FE0F
   variation selector renders as a box in Discord. */
const ACTIVITY_KINDS = {
  application_new:        { icon: '📥', label: 'New application' },
  review_stalled:         { icon: '⏳', label: 'Waiting on a review' },
  review_backlog:         { icon: '📚', label: 'Inbox backlog' },
  needs_input:            { icon: '🙋', label: 'Second read wanted' },
  opening_at_risk:        { icon: '🏠', label: 'Opening at risk' },
  opening_overdue:        { icon: '🔴', label: 'Opening overdue' },
  room_emptying:          { icon: '📦', label: 'Room emptying' },
  reply_availability:     { icon: '📅', label: 'Sent times' },
  reply_reschedule:       { icon: '⏰', label: 'Wants to move the call' },
  reply_plans_changed:    { icon: '🔄', label: 'Plans changed' },
  reply_withdrawing:      { icon: '👋', label: 'Withdrew' },
  reply_post_acceptance:  { icon: '🔑', label: 'Asking about moving in' },
  reply_question:         { icon: '❓', label: 'Asked a question' },
  reply_info_provided:    { icon: '📎', label: 'Sent something over' },
  reply_nudge:            { icon: '🔔', label: 'Following up' },
  reply_unclear:          { icon: '🤔', label: 'Reply needs a read' },
  screening_unclaimed:    { icon: '📣', label: 'Call needs a screener' },
  screening_booked:       { icon: '🤝', label: 'Call booked' },
  screening_today:        { icon: '📞', label: 'Call today' },
  screening_notes:        { icon: '📝', label: 'Recording ready' },
  screening_followup:     { icon: '⌛', label: 'Owed an answer' },
  application_updated:    { icon: '✍️', label: 'Application updated' },
  candidate_placed:       { icon: '✅', label: 'Passed review' },
  candidate_parked:       { icon: '🚧', label: 'No room fits yet' },
  decision_open:          { icon: '📊', label: 'Decision open' },
  candidate_promoted:     { icon: '🎉', label: 'Welcomed in' },
  movein_day:             { icon: '🧳', label: 'Move-in day' },
  gone_cold:              { icon: '💤', label: 'Gone quiet' },
  listing_draft:          { icon: '📄', label: 'Draft opening' },
  listing_draft_stale:    { icon: '🐌', label: 'Draft going stale' },
  listing_has_candidates: { icon: '🎯', label: 'Ready to screen' },
  listing_no_qualifiers:  { icon: '🚫', label: 'Nobody qualifies' },
  listing_filled_no_stay: { icon: '📋', label: 'Filled but unbooked' },
  onboarding_owed:        { icon: '🎁', label: 'Onboarding owed' },
  occupancy_conflict:     { icon: '❗', label: 'Calendar clash' },
  // Profile events — things housemates do, appended by recruit_log_event. They
  // share the ledger because a profile's history is one story; what separates
  // them is audience 'none', meaning recorded and never sent.
  event_verdict:          { icon: '🔖', label: 'Review written' },
  event_passed:           { icon: '🚪', label: 'Passed on' },
  event_stage:            { icon: '🔀', label: 'Stage changed' },
  event_added:            { icon: '➕', label: 'Added by hand' },
  event_email:            { icon: '📤', label: 'Email sent' },
  event_placement:        { icon: '📌', label: 'Shortlist changed' },
  event_move_in:          { icon: '🧳', label: 'Move-in confirmed' },
  event_phone:            { icon: '📱', label: 'Phone added' },
  event_comment:          { icon: '💬', label: 'Note added' },
  event_screening:        { icon: '👥', label: 'Call arranged' },
};
const kindIcon = k => ACTIVITY_KINDS[k]?.icon || '•';
const kindLabel = k => ACTIVITY_KINDS[k]?.label
  || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '));
/* Where each subject type lives, so a log line clicks through to the thing it
   is about rather than being a dead end. */
const ACTIVITY_TARGET = {
  applicant: id => `?a=${encodeURIComponent(id)}`,
  listing: () => `?view=openings`,
  stay: () => `?view=occupancy`,
  house: () => `?view=openings`,
};

async function loadActivity() {
  const { data, error } = await sb.from('recruit_notifications')
    .select('*').order('created_at', { ascending: false }).limit(300);
  if (error) { activityError = error.message; activity = []; return; }
  activityError = null;
  activity = data || [];
  activityOpenCount = activity.filter(n => !n.acked_at).length;
  renderRailCounts();
}

/* Just the badge number, for boot — the rail should show what's outstanding
   without pulling 300 log rows on every page load. */
async function loadActivityCount() {
  const { count, error } = await sb.from('recruit_notifications')
    .select('id', { count: 'exact', head: true }).is('acked_at', null);
  if (error) return;
  activityOpenCount = count || 0;
  renderRailCounts();
}

/* Who is on the hook. Shown as "you" when it is you, because a log that says
   "Ian Fike" to Ian reads like it is about somebody else. Notifications with no
   owner say nothing here — unowned is the common case and often the news. */
function activityOwner(n) {
  if (!n.owner_name) return '';
  const mine = n.owner_user_id && n.owner_user_id === me?.id;
  return mine ? 'yours' : n.owner_name;
}

function activityDelivery(n) {
  // What actually happened to this notification, in the order it happened.
  const bits = [];
  if (n.members_at) bits.push('housemates');
  if (n.escalated_at) bits.push('escalated to on-call');
  if (n.dm_at) bits.push('DM');
  if (n.log_at) bits.push('#recruiting-automation');
  if (n.muted) bits.push('muted — logged only');
  if (!bits.length) bits.push('not sent yet');
  return bits.join(' · ');
}

function renderActivity() {
  const host = document.getElementById('view-root');
  if (activityError) {
    host.innerHTML = `<p class="inbox-empty">Couldn't load the log — ${esc(activityError)}</p>`;
    return;
  }
  if (!activity.length) {
    host.innerHTML = `<p class="inbox-empty">Nothing logged yet. Every notification the house sends lands here.</p>`;
    return;
  }
  const kinds = [...new Set(activity.map(n => n.kind))].sort();
  const shown = activity.filter(n =>
    (activityFilter.kind === 'all' || n.kind === activityFilter.kind) &&
    (activityFilter.open === false || !n.acked_at));

  // Same chip vocabulary as the applicant filter bar — one kind chip per kind
  // actually present, plus the unresolved toggle.
  const filterBar = `<div class="filters">
    <span class="filters__group">
      <button class="chip ${activityFilter.open ? 'is-on' : ''}" data-activity-open>Unresolved</button>
    </span>
    <span class="filters__sep"></span>
    <span class="filters__group">
      <button class="chip ${activityFilter.kind === 'all' ? 'is-on' : ''}" data-activity-kind="all">Everything</button>
      ${kinds.map(k => `<button class="chip ${activityFilter.kind === k ? 'is-on' : ''}" data-activity-kind="${esc(k)}">${kindIcon(k)} ${esc(kindLabel(k))}</button>`).join('')}
    </span>
  </div>`;

  // Grouped by day: a log is read by "what happened on Tuesday", not by row.
  const days = [];
  for (const n of shown) {
    const day = new Date(n.created_at).toLocaleDateString('en-US',
      { weekday: 'long', month: 'short', day: 'numeric' });
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(n);
  }

  host.innerHTML = filterBar + (shown.length ? days.map(g => `
    <section class="inbox-group">
      <div class="inbox-group__head">
        <span class="inbox-group__label">${esc(g.day)}</span>
        <span class="inbox-group__count">${g.items.length}</span>
      </div>
      <ul class="inbox-card">
        ${g.items.map(n => `<li class="inbox-row log-row${n.acked_at ? ' is-done' : ''}">
          <span class="log-row__icon" title="${esc(kindLabel(n.kind))}">${kindIcon(n.kind)}</span>
          <button class="inbox-row__main" data-log-go="${esc(n.subject_type)}|${esc(n.subject_id || '')}">
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(kindLabel(n.kind))} · ${esc(n.payload?.title || n.subject_label)}</span>
              <span class="inbox-row__sub">${esc(n.payload?.body || '')}</span>
              <span class="log-row__meta">${esc(relTime(n.created_at))}${activityOwner(n) ? ` · ${esc(activityOwner(n))}` : ''} · ${esc(activityDelivery(n))}${n.acked_at ? ` · resolved ${esc(relTime(n.acked_at))}` : ''}</span>
            </span>
          </button>
          <span class="inbox-row__actions">
            ${n.acked_at ? '' : `<button class="btn btn--sm" data-ack="${esc(n.id)}">Resolve</button>`}
          </span>
        </li>`).join('')}
      </ul>
    </section>`).join('') : `<p class="inbox-empty">Nothing matches these filters.</p>`);

  host.querySelectorAll('[data-activity-kind]').forEach(el =>
    el.onclick = () => { activityFilter.kind = el.dataset.activityKind; renderActivity(); });
  host.querySelectorAll('[data-activity-open]').forEach(el =>
    el.onclick = () => { activityFilter.open = !activityFilter.open; renderActivity(); });
  host.querySelectorAll('[data-ack]').forEach(el => el.onclick = () => ackNotification(el.dataset.ack));
  host.querySelectorAll('[data-log-go]').forEach(el => el.onclick = () => {
    const [type, id] = el.dataset.logGo.split('|');
    if (type === 'applicant' && id) return openReview(id);
    const target = ACTIVITY_TARGET[type];
    if (target) setView(new URLSearchParams(target(id).replace(/^\?/, '')).get('view') || 'openings');
  });
}

/* One applicant's whole history: everything the house was told about them and
   everything the house did to them, in one order. Both live in
   recruit_notifications keyed on (subject_type, subject_id) — notifications and
   profile events differ only in audience, so this is a single query rather than
   a merge of two sources that could disagree. */
async function loadProfileActivity(a) {
  const host = () => document.getElementById('activity-panel');
  if (!host()) return;

  /* The ledger only knows what has happened since it shipped, and a profile's
     history goes back further than that. So this composes the feed from the
     source tables — reviews, notes, placements, decisions, email, calls — and
     folds in the ledger only for the notifications those tables can't explain.

     Deriving rather than backfilling means the panel is complete for every
     applicant on day one, and can't drift from the records it describes.
     Profile-event rows (audience 'none') are deliberately skipped: they say the
     same thing as the source row they were written from. */
  const [notifs, votesRes, commentsRes, placeRes, decisionRes, emailRes, screenRes] = await Promise.all([
    sb.from('recruit_notifications').select('*')
      .eq('subject_type', 'applicant').eq('subject_id', a.id).neq('audience', 'none'),
    sb.from('recruit_votes').select('*').eq('applicant_id', a.id),
    sb.from('recruit_comments').select('*').eq('applicant_id', a.id),
    sb.from('recruit_listing_candidates').select('*').eq('applicant_id', a.id),
    sb.from('recruit_decisions').select('*').eq('applicant_id', a.id),
    sb.from('recruit_emails').select('direction, subject, sent_at, sent_by_name, intent, intent_summary')
      .eq('applicant_id', a.id),
    sb.from('recruit_screenings').select('starts_at, status, housemate_name, kind, recording_posted_at')
      .eq('applicant_id', a.id),
  ]);
  // Navigated away while the queries were in flight.
  if (queue[qIndex] !== a.id || reviewTab !== 'activity' || !host()) return;

  const err = [votesRes, commentsRes, placeRes, decisionRes, emailRes, screenRes].find(r => r.error);
  if (err) {
    host().innerHTML = `<p class="notes__empty">Couldn't load their history — ${esc(err.error.message)}</p>`;
    return;
  }

  const feed = [];
  const add = (at, kind, sentence, detail) => { if (at) feed.push({ at, kind, sentence, detail }); };
  const who = n => n || 'a housemate';

  // Applied — always the first thing that happened.
  add(a.ts_iso, 'application_new', `Applied for ${wantsBoth(a) ? 'a room — open to full-time or a sublet' : isSublet(a) ? 'a sublet' : 'a full-time room'}.`);

  // Reviews, with the rationale — this is what "passed on" actually means.
  for (const v of votesRes.data || []) {
    const verdict = VERDICTS[v.verdict]?.label || v.verdict || 'reviewed';
    add(v.updated_at || v.created_at, v.verdict === 'not_fit' ? 'event_passed' : 'event_verdict',
      `${who(v.voter_name || v.voter_email)} marked them ${verdict.toLowerCase()}.`, v.note);
  }

  /* Archive decisions — but only when no verdict already explains it. Writing a
     "not a fit" review also writes a pass decision, so showing both would list
     one act twice in slightly different words. The decision row is only news on
     its own for house rules and legacy archives that never had a review. */
  const hasNotFit = (votesRes.data || []).some(v => v.verdict === 'not_fit');
  for (const d of decisionRes.data || []) {
    if (d.decision !== 'pass' || hasNotFit) continue;
    add(d.decided_at, 'event_passed',
      `${who(d.decided_by_name)} archived them${d.reason ? ` — ${reasonLabel(d.reason).toLowerCase()}` : ''}.`, d.note);
  }

  // House comments.
  for (const c of commentsRes.data || []) {
    add(c.created_at, 'event_comment',
      c.source === 'discord'
        ? `${who(c.author_name)} replied in Discord.`
        : `${who(c.author_name)} left a note.`, c.body);
  }

  // Listings they were added to or taken off.
  for (const p of placeRes.data || []) {
    const room = listingLabel(p.listing_id);
    const auto = p.source === 'auto';
    if (p.status === 'removed') {
      add(p.updated_at || p.created_at, 'event_placement',
        `${who(p.added_by_name)} took them off ${room}.`);
    } else {
      add(p.created_at, 'event_placement', auto
        ? `Auto-placed on ${room}.`
        : `${who(p.added_by_name)} added them to ${room}.`);
    }
  }

  // Email both ways, and what an inbound one turned out to be about.
  for (const e of emailRes.data || []) {
    if (e.direction === 'out') {
      add(e.sent_at, 'event_email', `${who(e.sent_by_name)} emailed them.`, e.subject);
    } else {
      const label = e.intent && ACTIVITY_KINDS[`reply_${e.intent}`]?.label;
      add(e.sent_at, e.intent ? `reply_${e.intent}` : 'event_email',
        label ? `They replied — ${label.toLowerCase()}.` : 'They replied.',
        e.intent_summary || e.subject);
    }
  }

  // Calls.
  for (const s of screenRes.data || []) {
    const when = s.starts_at ? relTime(s.starts_at) : '';
    add(s.starts_at, s.status === 'completed' ? 'screening_notes' : 'screening_today',
      s.status === 'completed'
        ? `Had an intro call${s.housemate_name ? ` with ${s.housemate_name}` : ''}.`
        : `Intro call booked${s.housemate_name ? ` with ${s.housemate_name}` : ''}.`,
      s.recording_posted_at ? 'recording & summary saved' : undefined);
  }

  // Notifications the tables above can't account for (stalled reviews, nudges,
  // openings they were matched to).
  for (const n of notifs.data || []) {
    const line = (n.payload?.sentence || '').replace('{}', n.payload?.title || fullName(a));
    const owner = n.owner_name ? `${n.owner_user_id === me?.id ? 'yours' : n.owner_name}` : '';
    add(n.created_at, n.kind, line, [n.payload?.body, owner].filter(Boolean).join(' · '));
  }

  feed.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  if (!feed.length) {
    host().innerHTML = `<p class="notes__empty">Nothing recorded yet.</p>`;
    return;
  }

  host().innerHTML = `<ul class="inbox-card activity-feed">
    ${feed.map(f => `<li class="inbox-row log-row">
      <span class="log-row__icon" title="${esc(kindLabel(f.kind))}">${kindIcon(f.kind)}</span>
      <span class="inbox-row__text">
        <span class="inbox-row__title activity-feed__line">${esc(f.sentence)}</span>
        ${f.detail ? `<span class="inbox-row__sub activity-feed__detail">${esc(String(f.detail).slice(0, 300))}</span>` : ''}
        <span class="log-row__meta">${esc(relTime(f.at))}</span>
      </span>
    </li>`).join('')}
  </ul>`;
}

/* Mark every open notification of these kinds, for this subject, resolved.
   Called when the underlying condition is actually dealt with — reviewing an
   applicant answers "waiting on a review", opening a listing answers its draft
   nudge. Without this the digest keeps asking for things already done, which is
   the fastest way for a notification channel to lose its credibility.

   Fire-and-forget, like logEvent: a housemate's action must never fail because
   the bookkeeping did. */
async function ackFor(subjectType, subjectId, kinds) {
  if (!subjectId) return;
  try {
    const { error } = await sb.rpc('recruit_ack_subject', {
      p_subject_type: subjectType, p_subject_id: String(subjectId), p_kinds: kinds || null,
    });
    if (error) { console.warn('[activity] could not resolve', kinds, error.message); return; }
    // Keep the rail badge honest without a refetch.
    if (activityOpenCount) { loadActivityCount(); }
  } catch (err) {
    console.warn('[activity] could not resolve', kinds, err);
  }
}

/* Append a profile event. Fire-and-forget on purpose: the log is valuable but
   never worth failing a housemate's actual action over, so a failure here warns
   and the action stands. `sentence` uses {} for the subject, same as the
   notification sentences, so both render identically. */
async function logEvent(kind, subjectId, subjectLabel, sentence, body) {
  try {
    const { error } = await sb.rpc('recruit_log_event', {
      p_kind: kind, p_subject_type: 'applicant', p_subject_id: subjectId,
      p_subject_label: subjectLabel || '', p_sentence: sentence, p_body: body || null,
    });
    if (error) console.warn('[activity] could not log', kind, error.message);
  } catch (err) {
    console.warn('[activity] could not log', kind, err);
  }
}

/* Resolving keeps the entry and adds the fact that it was handled — the log
   never loses a row, and the next digest stops asking. */
async function ackNotification(id) {
  const row = activity.find(n => n.id === id);
  if (row) { row.acked_at = new Date().toISOString(); renderActivity(); }
  const { error } = await sb.rpc('recruit_ack_notification', { p_id: id });
  if (error) {
    if (row) row.acked_at = null;
    renderActivity();
    toast(`Couldn't resolve that — ${error.message}`);
  }
}

/* ---------- applicants render ---------- */
function matchesView(a) {
  const out = a.stage !== 'rejected' && a.stage !== 'archived';
  // They moved in. Not archived (that reads as a no) and not in the pipeline
  // either — they live on the Occupancy calendar now, and every applicant
  // rail should be quiet about them.
  if (a.stage === 'resident') return false;
  // A "not a fit" verdict means archived — never show them here, whatever the
  // stage column says.
  if (view === 'inbox') return a.stage === 'review' && !voteStats(a.id).notFit;
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
  if (filters.track === 'fulltime' && isSublet(a) && !wantsBoth(a)) return false;
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
    if (a.stage === 'resident') continue; // housed — counted nowhere in the funnel
    if (a.stage === 'rejected' || a.stage === 'archived') { c.archive++; continue; }
    if (a.stage === 'review') c.inbox++;
    else if (a.stage === 'candidate') c.candidates++;
    if (screeningState[a.id]) c.screening++;
  }
  // Openings badges the rooms, not the people in them — "how many roles are
  // open" is what the rail answers; the shortlists live inside.
  c.openings = listings.filter(l => l.status === 'open').length;
  return c;
}

function renderRailCounts() {
  const c = counts();
  for (const key of ['inbox', 'candidates', 'openings', 'screening', 'archive']) {
    const el = document.getElementById(`count-${key}`);
    if (el) el.textContent = c[key] || '';
  }
  // Activity counts what's still unresolved, not the whole log — a log that
  // badges its own length would never stop badging.
  const act = document.getElementById('count-activity');
  if (act) act.textContent = activityOpenCount || '';
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
  if (st.notFit) return `<span class="decision-chip decision-chip--pass" title="${esc(reviewerName(st.notFit))} marked them not a fit">Not a fit</span>`;
  if (!st.needsInput.length) return '';
  const who = st.needsInput.map(reviewerName).join(', ');
  return `<span class="decision-chip decision-chip--vote" title="${esc(who)} asked for another housemate to read this">Needs input</span>`;
}

function stageChip(a) {
  const rec = decisions[a.id];
  if (isAutoDecision(rec)) {
    const why = rec.note || (rec.reason ? reasonLabel(rec.reason) : 'A house rule archived them');
    return `<span class="decision-chip decision-chip--auto" title="${esc(why)}">Auto-archived</span>`;
  }
  if (a.stage === 'rejected') {
    const st = voteStats(a.id);
    const why = st.notFit ? `Not a fit — ${reviewerName(st.notFit)}: “${st.notFit.note}”` : (decisions[a.id]?.note || 'Did not pass review');
    return `<span class="decision-chip decision-chip--pass" title="${esc(why)}">Archived</span>`;
  }
  if (decisions[a.id]?.reason === 'dropped-out') return `<span class="decision-chip decision-chip--vote" title="They withdrew">Dropped out</span>`;
  if (a.updateSentAt) return `<span class="decision-chip decision-chip--outreach" title="Update email sent">Update sent ${fmtDate(a.updateSentAt)}</span>`;
  return `<span class="decision-chip decision-chip--pass">Archived</span>`;
}

function screeningChip(a) {
  const sc = screeningState[a.id];
  if (!sc) return '';
  const phase = callPhase(sc);
  // Pass the applicant so Watch opens the Call tab: a pasted link has no
  // stream, and the detached modal can only play our own captures.
  if (phase === 'watch') return watchBtn(sc, a.id);
  if (phase === 'processing') return processingChip();
  if (phase === 'live') return joinBtn(sc) || processingChip();
  if (phase === 'scheduled') return `<span class="decision-chip decision-chip--outreach" title="Intro Call${sc.with ? ` with ${esc(sc.with)}` : ''}">${fmtSlot(sc.at)}</span>`;
  // The call happened and nothing is coming. Without this it fell through to
  // "Availability received" — describing a state two steps in the past.
  if (phase === 'done') return `<span class="decision-chip decision-chip--vote" title="The call happened${sc.with ? ` with ${sc.with}` : ''} — no recording was captured">Call done · no recording</span>`;
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
  // The markup must precede this script; a silent return here once cost an
  // afternoon of "the button does nothing".
  if (!v) { console.error('[applications] #gplayer missing at init — player disabled'); return; }
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
          <span class="note__time">${relTime(c.created_at)}${c.source === 'sheet' ? ' · from the application sheet' : c.source === 'discord' ? ' · replied in Discord' : ''}</span>
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
      <p class="notes__empty"><button type="button" class="cta-link" data-add-recording="${a.id}">Add recording</button> — if the call happened on tldv or elsewhere.</p>`;
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
        : `<p class="notes__empty">The recording lands here after the call. <button type="button" class="cta-link" data-add-recording="${a.id}">Add link</button> if it was recorded elsewhere.</p>`}
    ${row.recording_summary ? `<section class="review__section"><h3 class="review__section-title">Call summary</h3>${mdLite(row.recording_summary)}</section>` : ''}
    <section class="review__section notes">
      <div class="notes__head">
        <h3 class="review__section-title">Comments</h3>
        ${streamable ? `<button type="button" class="btn btn--sm" id="call-stamp" title="Prefix your comment with the video's current time">Comment</button>` : ''}
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

/* Booked people carry the answer on the row: which room, which kind of stay,
   from when. The trial's next step (Change to resident) lives in the calendar drawer. */
function bookedChip(a) {
  const s = liveStayFor(a.id);
  if (!s) return '';
  const room = rooms.find(r => r.id === s.room_id) || allRooms.find(r => r.id === s.room_id);
  const kind = s.kind === 'candidate' ? 'trial' : s.kind;
  return `<span class="decision-chip decision-chip--replied" title="${esc(`On the occupancy calendar — ${kind} in ${room?.name || 'a room'} from ${fmtDay(s.starts_on)}${s.ends_on ? ` through ${fmtDay(s.ends_on)}` : ''}${s.kind === 'candidate' ? '. Welcome them in from the calendar when the trial works out.' : ''}`)}">${
    esc(`booked · ${room?.name || 'Room'} ${kind}`)}</span>`;
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
  if (view === 'screening') return bookedChip(a) || screeningChip(a);
  if (view === 'candidates') return exitChip(a) || bookedChip(a) || placementChip(a);
  return decisionChip(a.id);
}

function renderApplicants() {
  // Held rows die on re-render, so their writes have to land first.
  flushPendingExits();
  const viewList = applicants.filter(matchesView);
  const list = viewList.filter(matchesFilters);
  const filtered = list.length !== viewList.length;
  // Openings leads with the rooms (same number the rail badges); people are
  // the second fact. Everywhere else the count IS the people.
  const openRoles = listings.filter(l => l.status === 'open').length;
  document.getElementById('page-sub').textContent = view === 'openings'
    ? `${openRoles} open role${openRoles === 1 ? '' : 's'} · ${viewList.length} applicant${viewList.length === 1 ? '' : 's'}`
    : (filtered ? `${list.length} of ${viewList.length}` : `${viewList.length}`) +
    ` applicant${(filtered ? viewList.length : list.length) === 1 ? '' : 's'}` +
    (view === 'inbox' ? ' waiting on a review · one read decides' :
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

  // Openings: draft listings detected from occupancy gaps sit above the
  // shortlists.
  let outreachChrome = recordingLeadsHtml();
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
                : `${rowBadge(a)}${view === 'inbox' && !myVote(a.id) ? `<button class="btn btn--sm inbox-row__review inbox-row__review--go" data-review="${a.id}">Review <span aria-hidden="true">→</span></button>` : ''}`}
            </span>
          </li>`).join('')}
      </ul>`}
      ${view === 'openings' ? othersAccordion(g.key) : ''}
    </section>`).join('') + doneDrawer + outreachHint;
  if (view === 'openings') wireRowDrag(host);
}

/* One line of status per qualified applicant. Where they are beats what was
   done to them: someone shortlisted elsewhere reads as "on DMT Room", not as
   "taken off this listing", even though both are true. */
function qualifiedTag(a, listingId, removed) {
  if (a.stage === 'review') {
    return '<span class="note-count" title="Nobody has reviewed them yet — one read decides">not reviewed yet</span>';
  }
  const elsewhere = activePlacements(a.id).find(p => p.listing_id !== listingId);
  if (elsewhere) {
    const l = listings.find(x => x.id === elsewhere.listing_id);
    const room = rooms.find(r => r.id === l?.room_id);
    return `<span class="note-count" title="Shortlisted there — adding them here moves them">on ${esc(room?.name || 'another listing')}</span>`;
  }
  if (removed) {
    return '<span class="note-count" title="A recruiter took them off this listing — the auto-sweep won\'t re-add them, but you can">taken off this listing</span>';
  }
  return '<span class="note-count" title="Reviewed and moved forward — ready to add">moved forward</span>';
}

/* Collapsed rail of everyone else who'd fit this listing — removed
   candidates can be re-added; Applicants folks link to their review page. */
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
            ${qualifiedTag(a, listingId, removed)}
            ${a.stage === 'candidate' ? `<button class="btn btn--sm inbox-row__review" title="${activePlacements(a.id).length ? 'Moves them here from their current listing' : 'Place them on this listing'}" data-add-placement="${a.id}|${esc(listingId)}">${activePlacements(a.id).length ? 'Move here' : 'Add'}</button>` : ''}
          </span>
        </li>`;
      }).join('')}
    </ul>
  </details>`;
}

/* Row-level ⋮ — the whole verb set, context-aware, suggested next step
   first (same funnel logic the old highlighted CTA ran on, now just the top
   row of the menu, unstyled). Both schedule actions live here. The four
   removal outcomes stay in the sheet rather than the menu — each needs a
   consequence line ("queues an update email") that a menu can't carry. */
function rowMenuHtml(a, listingId) {
  const mid = `row-${a.id}-${listingId}`;
  const sc = screeningState[a.id] || {};
  const st = emailState[a.id];
  const tour = tourState[a.id];
  const item = (attrs, label) => `<button type="button" class="listing-menu__item" ${attrs}>${label}</button>`;
  const items = [];
  // Suggested next step, by funnel state.
  if (sc.availability) items.push(item(`data-avail-review="${a.id}"`, 'Review times'));
  else if (st?.lastDir === 'in') items.push(item(`data-pick-time="${a.id}"`, 'Reply'));
  else if (st?.lastDir === 'out') items.push(item(`data-email="${a.id}"`, 'Follow up'));
  else if (!sc.at && !sc.done) items.push(item(`data-email="${a.id}"`, 'Email them'));
  // The two schedule actions. An intro-call ask only makes sense before one
  // exists; a tour ask is reachable any time a cycle isn't already running.
  if (!sc.at && !sc.done && !sc.availability) items.push(item(`data-email="${a.id}" data-email-kind="availability"`, 'Schedule intro call'));
  if (!tour || tour.status === 'cancelled' || tour.status === 'confirmed') items.push(item(`data-email="${a.id}" data-email-kind="tour"`, 'Schedule house tour'));
  // The manual override pair: set a concrete time yourself, invites go out
  // immediately — no availability windows or house poll required.
  if (!sc.at && !sc.done) items.push(item(`data-set-time="${a.id}|call"`, 'Set call time…'));
  if (!tour || tour.status !== 'confirmed') items.push(item(`data-set-time="${a.id}|visit"`, 'Set visit time…'));
  if (sc.watch) items.push(item(`data-play-mini="${a.id}"`, 'Watch recording'));
  if (sc.watch || sc.done) items.push(item(`data-give-decision="${a.id}"`, houseDecision(a.id) ? 'Change decision' : 'Decide'));
  // Available at any stage, like Remove — booking someone IS accepting them,
  // and the flow records the yes on the way through.
  if (!liveStayFor(a.id)) items.push(item(`data-book-in="${a.id}"`, 'Set their move-in…'));
  items.push(item(`data-review="${a.id}"`, 'Open profile'));
  items.push(item(`data-add-recording="${a.id}"`, 'Add recording'));
  return `<span class="listing-menu-wrap">
    <button type="button" class="btn btn--sm listing-menu-btn" data-listing-menu="${esc(mid)}" aria-label="Applicant actions" aria-haspopup="menu">⋮</button>
    <span class="listing-menu" data-menu-for="${esc(mid)}" hidden>
      ${items.join('')}
      <span class="listing-menu__rule" aria-hidden="true"></span>
      ${item(`data-open-remove="${a.id}|${esc(listingId)}"`, 'Remove…')}
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

/* Post-screening decision — ONE decider (2026-08-03). A single housemate's
   verdict is the house decision; storage keeps every row (history and RLS
   stay untouched) and the most recent write is canonical. Anyone can
   overrule by deciding again — same trust model as the Inbox review. */
function houseDecision(applicantId) {
  const dv = decisionVotes[applicantId] || [];
  if (!dv.length) return null;
  return dv.slice().sort((x, y) =>
    String(y.updated_at || y.created_at || '').localeCompare(String(x.updated_at || x.created_at || '')))[0];
}

/* The one writer for the house decision row — Decide-yes and the Remove
   sheet's Not-a-fit both land here, so "the decision" means one thing. */
async function writeHouseDecision(applicantId, verdict, note) {
  const { data, error } = await sb.from('recruit_decision_votes').upsert({
    applicant_id: applicantId, voter_id: me.id, voter_name: me.name,
    verdict, note: note || '', updated_at: new Date().toISOString(),
  }, { onConflict: 'applicant_id,voter_id' }).select().single();
  if (error) { toast(`Decision failed: ${error.message}`); return null; }
  decisionVotes[applicantId] = [...(decisionVotes[applicantId] || []).filter(v => v.voter_id !== me.id), data];
  return data;
}

async function giveDecision(applicantId, verdict, skipBooking = false) {
  const note = (document.getElementById('gd-note')?.value || '').trim();
  if (!await writeHouseDecision(applicantId, verdict, note)) return;
  // Accepting and booking are one gesture when a room is on the table — the
  // modal already showed which room and which dates a yes commits to. If the
  // booking half fails, the decision is saved and the error shows in place.
  const sel = document.getElementById('gd-book-listing');
  if (verdict === 'yes' && !skipBooking && sel) {
    const ok = await bookApplicant(applicantId, sel.value,
      document.getElementById('gd-book-start')?.value,
      document.getElementById('gd-book-end')?.value || null,
      document.getElementById('gd-book-error'));
    if (!ok) return;
    document.getElementById('gd-modal').hidden = true;
    return;
  }
  document.getElementById('gd-modal').hidden = true;
  toast(verdict === 'yes' && !liveStayFor(applicantId)
    ? 'Saved — accept is the house decision. Set their move-in from the ⋮ menu when ready.'
    : 'Saved — accept is the house decision');
  if (VIEWS[view]?.kind === 'applicants') renderApplicants();
  if (!document.getElementById('review').hidden) renderReview();
}

function openGiveDecision(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  const modal = document.getElementById('gd-modal');
  const hd = houseDecision(applicantId);
  const earlier = (decisionVotes[applicantId] || []).filter(v => hd && v !== hd);
  document.getElementById('gd-title').textContent = `Would you accept ${a.first}?`;
  document.getElementById('gd-tally').innerHTML = hd
    ? `<span class="chip-line">House decision · <b>${hd.verdict === 'yes' ? 'accept' : 'pass'}</b> — ${esc(hd.voter_name || 'a housemate')}${hd.note ? ` · “${esc(hd.note)}”` : ''}</span>` +
      earlier.map(v => `<span class="chip-line notes__empty">earlier · ${esc(v.voter_name || 'Housemate')} said ${v.verdict}${v.note ? ` — ${esc(v.note)}` : ''}</span>`).join('') +
      `<span class="notes__empty">Saving replaces the standing decision.</span>`
    : '<span class="notes__empty">One housemate’s read settles it — yours becomes the house decision.</span>';
  document.getElementById('gd-note').value = (hd && hd.voter_id === me?.id ? hd.note : '') || '';
  renderGdBooking(applicantId);
  modal.dataset.applicant = applicantId;
  modal.hidden = false;
}

/* The room half of the accept modal. When they're unbooked and a listing is
   open, a yes accepts AND books — the room and dates sit right under the
   decision so one click commits to exactly what's on screen. A quiet link
   keeps "decide now, book later" possible; booking then lives in the ⋮ menu. */
function renderGdBooking(applicantId, listingId) {
  const host = document.getElementById('gd-book');
  const yesBtn = document.getElementById('gd-yes');
  if (!host || !yesBtn) return;
  host.innerHTML = '';
  yesBtn.textContent = 'Yes — accept';
  const open = listings.filter(l => l.status === 'open');
  if (liveStayFor(applicantId) || !open.length) return;
  const preferred = listingId || activePlacements(applicantId)[0]?.listing_id;
  const l = open.find(x => x.id === preferred) || open[0];
  const { start, end } = bookInDefaults(l);
  const label = x => {
    const room = rooms.find(r => r.id === x.room_id) || allRooms.find(r => r.id === x.room_id);
    return `${room?.name || 'Room'} — ${x.kind === 'resident' ? 'resident trial' : 'sublet'} from ${fmtDay(x.starts_on)}`;
  };
  host.innerHTML = `
    <div class="occ-drawer__section">A yes gives them the room</div>
    ${open.length > 1 ? `<label class="listing-form__field">Listing
      <select class="listing-status" id="gd-book-listing">
        ${open.map(x => `<option value="${x.id}" ${x.id === l.id ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}
      </select>
    </label>` : `<p class="occ-drawer__note">${esc(label(l))}</p>
      <select id="gd-book-listing" hidden><option value="${l.id}" selected></option></select>`}
    <div class="occ-drawer__dates">
      <label class="listing-form__field">From
        <input type="date" class="listing-status" id="gd-book-start" value="${start}" required>
      </label>
      <label class="listing-form__field">Through
        <input type="date" class="listing-status" id="gd-book-end" value="${end}" ${l.kind === 'resident' ? '' : 'required'}>
      </label>
    </div>
    <p class="occ-drawer__note">${l.kind === 'resident'
      ? 'Their trial lands on the occupancy calendar with its milestones, the listing is marked filled, and they leave other openings.'
      : 'Their sublet lands on the occupancy calendar, the listing is marked filled, and they leave other openings.'}</p>
    <p class="listing-form__error" id="gd-book-error"></p>
    <p class="notes__empty">Not ready to commit the room? <button type="button" class="cta-link" id="gd-decide-only">Accept without booking</button></p>`;
  yesBtn.textContent = 'Yes — accept & book the room';
  const sel = host.querySelector('#gd-book-listing');
  if (sel && open.length > 1) sel.onchange = e => renderGdBooking(applicantId, e.target.value);
  host.querySelector('#gd-decide-only').onclick = () =>
    giveDecision(document.getElementById('gd-modal').dataset.applicant, 'yes', true);
}

/* --- set their move-in (the late-booking path) ---
   The accept modal books in the same click as the yes; this sheet exists for
   the yes that skipped booking ("Accept without booking"). Same core —
   bookApplicant → recruit_accept_applicant — reachable from the ⋮ menu until
   they're on the calendar. */
async function openBookIn(applicantId) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  if (!houseLoaded) await loadHouse();
  if (liveStayFor(applicantId)) { toast(`${a.first} is already on the calendar`); return; }
  const open = listings.filter(l => l.status === 'open');
  if (!open.length) {
    toast('No open listings — create one from Occupancy, then set their move-in from the ⋮ menu');
    return;
  }
  const modal = document.getElementById('bi-modal');
  modal.dataset.applicant = applicantId;
  document.getElementById('bi-title').textContent = `Move ${a.first} in`;
  const preferred = activePlacements(applicantId)[0]?.listing_id;
  renderBookIn(open.some(l => l.id === preferred) ? preferred : open[0].id);
  modal.hidden = false;
}

function bookInDefaults(l) {
  const today = new Date().toISOString().slice(0, 10);
  const start = l.starts_on > today ? l.starts_on : today;
  const end = l.kind === 'resident'
    ? addMonthsIso2(start, setting('trial_length_months'))
    : (l.ends_on || '');
  return { start, end };
}

function renderBookIn(listingId) {
  const open = listings.filter(l => l.status === 'open');
  const l = open.find(x => x.id === listingId) || open[0];
  if (!l) return;
  const { start, end } = bookInDefaults(l);
  const label = x => {
    const room = rooms.find(r => r.id === x.room_id) || allRooms.find(r => r.id === x.room_id);
    return `${room?.name || 'Room'} — ${x.kind === 'resident' ? 'resident trial' : 'sublet'} from ${fmtDay(x.starts_on)}`;
  };
  const room = rooms.find(r => r.id === l.room_id) || allRooms.find(r => r.id === l.room_id);
  document.getElementById('bi-body').innerHTML = `
    <label class="listing-form__field">Listing
      <select class="listing-status" id="bi-listing">
        ${open.map(x => `<option value="${x.id}" ${x.id === l.id ? 'selected' : ''}>${esc(label(x))}</option>`).join('')}
      </select>
    </label>
    <div class="occ-drawer__dates">
      <label class="listing-form__field">From
        <input type="date" class="listing-status" id="bi-start" value="${start}" required>
      </label>
      <label class="listing-form__field">Through
        <input type="date" class="listing-status" id="bi-end" value="${end}" ${l.kind === 'resident' ? '' : 'required'}>
      </label>
    </div>
    <p class="occ-drawer__note">${l.kind === 'resident'
      ? `Puts their trial in ${esc(room?.name || 'the room')} on the occupancy calendar with its check-in and decision milestones, marks the listing filled, and takes them out of other openings. Welcome them in from the calendar when the trial works out — one person's call, same as this one.`
      : `Puts their sublet in ${esc(room?.name || 'the room')} on the occupancy calendar, marks the listing filled, and takes them out of other openings.`}</p>
    <p class="listing-form__error" id="bi-error"></p>
    <div class="decision-sheet__actions">
      <button class="hold-sheet__cancel" id="bi-later" type="button" title="They stay a decided-yes candidate — set their move-in any time from the ⋮ menu">Not yet</button>
      <button class="btn btn--accent btn--sm" id="bi-submit" type="button">Confirm move-in</button>
    </div>`;
  document.getElementById('bi-listing').onchange = e => renderBookIn(e.target.value);
  document.getElementById('bi-later').onclick = () => { document.getElementById('bi-modal').hidden = true; };
  document.getElementById('bi-submit').onclick = () => submitBookIn();
}

/* The booking itself — shared by the accept modal's one-click yes and the
   ⋮ menu's later "Set their move-in". Validates, runs the RPC, reloads, and
   opens the acceptance email. Returns false with the error shown in errEl. */
async function bookApplicant(applicantId, listingId, start, end, errEl) {
  const a = applicants.find(x => x.id === applicantId);
  const l = listings.find(x => x.id === listingId);
  const err = errEl || { textContent: '' };
  if (!a || !l) { err.textContent = 'That listing is gone — reopen the sheet.'; return false; }
  if (!start) { err.textContent = 'Pick the day they move in.'; return false; }
  if (end && end < start) { err.textContent = '"Through" must be at or after "From".'; return false; }
  if (l.kind !== 'resident' && !end) { err.textContent = 'A sublet needs an end date.'; return false; }
  const { data: newStayId, error } = await sb.rpc('recruit_accept_applicant', {
    p_applicant: applicantId,
    p_listing: l.id,
    p_starts_on: start,
    p_ends_on: end || null,
    p_checkin_on: l.kind === 'resident' ? trialCheckinDefault(start) : null,
    p_decision_on: l.kind === 'resident' && end ? trialDecisionDefault(end) : null,
  });
  if (error) { err.textContent = error.message; return false; }
  // Booking IS accepting — record the yes so the decision chip agrees with
  // the calendar, whatever stage they were booked from.
  if (houseDecision(applicantId)?.verdict !== 'yes') {
    await writeHouseDecision(applicantId, 'yes', 'Accepted by booking them a room');
  }
  const room = rooms.find(r => r.id === l.room_id) || allRooms.find(r => r.id === l.room_id);
  const kindWord = l.kind === 'resident' ? 'trial' : 'sublet';
  logEvent('event_move_in', applicantId, fullName(a),
    `${me.name || 'A housemate'} gave {} ${room?.name || 'a room'} — ${kindWord} from ${fmtDay(start)}.`);
  // Everything that was chasing a room for them is answered.
  ackFor('applicant', applicantId, ['candidate_parked', 'candidate_placed', 'screening_followup',
    'decision_open', 'gone_cold']);
  ackFor('listing', l.id, ['listing_draft', 'listing_draft_stale', 'listing_no_qualifiers',
    'opening_at_risk', 'opening_overdue', 'listing_has_candidates']);
  // The RPC touched stays, the listing, placements, and possibly the stage.
  await Promise.all([loadHouse(), loadAll()]);
  toast(`${a.first} has ${room?.name || 'the room'} — ${kindWord} from ${fmtDay(start)} · listing marked filled`);
  renderRailCounts();
  if (VIEWS[view]?.kind === 'applicants') renderApplicants();
  if (view === 'occupancy') renderOccupancy();
  if (!document.getElementById('review').hidden) renderReview();
  // Telling them is the other half of accepting them — but first, confirm
  // every fact the email and agreement will state.
  openMoveinConfirm(newStayId);
  return true;
}

async function submitBookIn() {
  const modal = document.getElementById('bi-modal');
  const btn = document.getElementById('bi-submit');
  btn.disabled = true;
  const ok = await bookApplicant(modal.dataset.applicant,
    document.getElementById('bi-listing')?.value,
    document.getElementById('bi-start')?.value,
    document.getElementById('bi-end')?.value || null,
    document.getElementById('bi-error'));
  if (!ok) { btn.disabled = false; return; }
  modal.hidden = true;
}

/* --- confirm move-in details → welcome email ---
   Booking answers who and where; this sheet confirms everything the welcome
   email and the agreement will STATE — money, buddy, links, arrival — each
   field editable, then one click drafts the (still editable) email with the
   agreement PDF attached and the finance folks cc'd. Reachable again from the
   stay drawer as long as the stay is live. */
let moveinFor = null;   // stay id open in the confirm sheet

/* The rent this stay was offered at: the room's most recent listing wins,
   the room's own number is the fallback. */
function rentForStay(s) {
  const ls = listings.filter(l => l.room_id === s.room_id && l.rent_monthly != null)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  if (ls.length) return ls[0].rent_monthly;
  const room = rooms.find(r => r.id === s.room_id) || allRooms.find(r => r.id === s.room_id);
  return room?.rent_monthly ?? '';
}

// Current residents, for the buddy pick.
function residentRoster() {
  const today = new Date().toISOString().slice(0, 10);
  return [...new Set(stays
    .filter(s => s.kind === 'resident' && (!s.ends_on || s.ends_on >= today) && s.occupant)
    .map(s => s.occupant.trim()))];
}

/* Next up = the resident who has gone longest without being someone's buddy.
   Derived from buddy_name history on stays — no rotation table to maintain. */
function suggestedBuddy() {
  const roster = residentRoster();
  if (!roster.length) return null;
  const lastBuddied = new Map();
  for (const s of stays) {
    if (!s.buddy_name) continue;
    const when = s.starts_on || '';
    if (when > (lastBuddied.get(s.buddy_name) || '')) lastBuddied.set(s.buddy_name, when);
  }
  return roster.slice().sort((a, b) =>
    (lastBuddied.get(a) || '').localeCompare(lastBuddied.get(b) || ''))[0];
}

function openMoveinConfirm(stayId) {
  const s = stays.find(x => x.id === stayId);
  if (!s) { toast('Stay not found — open it from the occupancy calendar'); return; }
  moveinFor = stayId;
  const first = (s.occupant || '').split(' ')[0] || 'them';
  document.getElementById('mi-title').textContent = `Confirm move-in details — ${first}`;
  renderMoveinConfirm();
  document.getElementById('mi-modal').hidden = false;
}

function renderMoveinConfirm() {
  const s = stays.find(x => x.id === moveinFor);
  if (!s) return;
  const mv = s.movein || {};
  const room = rooms.find(r => r.id === s.room_id) || allRooms.find(r => r.id === s.room_id);
  const isTrial = s.kind === 'candidate';
  const roster = residentRoster();
  const next = suggestedBuddy();
  const buddy = s.buddy_name || next || '';
  const val = (k, fallback) => mv[k] ?? fallback;
  const field = (id, label, value, attrs = '') =>
    `<label class="listing-form__field">${label}
      <input class="listing-status" id="${id}" value="${esc(String(value ?? ''))}" ${attrs}>
    </label>`;
  document.getElementById('mi-body').innerHTML = `
    <p class="occ-drawer__note">${esc(room?.name || 'Room')}${room?.floor ? ` (${esc(String(room.floor))})` : ''} ·
      ${isTrial ? `resident trial from ${fmtDay(s.starts_on)}${s.ends_on ? ` — decision by ${fmtDay(s.ends_on)}` : ''}` : `sublet ${fmtDay(s.starts_on)} – ${s.ends_on ? fmtDay(s.ends_on) : 'TBD'}`}.
      Dates are edited on the stay itself; everything below feeds the email and the agreement.</p>
    <div class="occ-drawer__section">Money</div>
    <div class="occ-drawer__dates">
      ${field('mi-rent', 'Lease rent /mo', val('rent', rentForStay(s)), 'type="number" min="0" step="5"')}
      ${field('mi-dues', 'House dues /mo', val('dues', setting('dues_monthly')), 'type="number" min="0" step="5"')}
      ${field('mi-food', 'Groceries /mo', val('food', setting('food_monthly')), 'type="number" min="0" step="5"')}
      ${field('mi-deposit', 'Deposit', val('deposit', setting('deposit_amount')), 'type="number" min="0" step="50"')}
    </div>
    <p class="occ-drawer__note" id="mi-total"></p>
    <div class="occ-drawer__section">Buddy</div>
    <label class="listing-form__field">Their buddy
      <select class="listing-status" id="mi-buddy">
        <option value="">No buddy yet</option>
        ${roster.map(n => `<option value="${esc(n)}" ${n === buddy ? 'selected' : ''}>${esc(n)}${n === next ? ' (next up)' : ''}</option>`).join('')}
      </select>
    </label>
    <div class="occ-drawer__section">Links & people</div>
    ${field('mi-fin1-email', `Cc — ${esc(setting('finance_contact_1_name') || 'finance 1')}`, setting('finance_contact_1_email'), 'type="email" placeholder="finance email"')}
    ${field('mi-fin2-email', `Cc — ${esc(setting('finance_contact_2_name') || 'finance 2')}`, setting('finance_contact_2_email'), 'type="email" placeholder="finance email (optional)"')}
    ${field('mi-discord', 'Discord invite', setting('discord_invite_url'), 'placeholder="https://discord.gg/…"')}
    ${field('mi-notion', 'Notion guide', setting('notion_guide_url'), 'placeholder="https://notion.so/…"')}
    ${field('mi-hosts', 'Onboarding chat hosts', setting('onboarding_hosts'), '')}
    ${field('mi-address', 'Address', setting('house_address'), '')}
    ${field('mi-arrival', 'Arrival note', setting('arrival_note'), 'placeholder="Reach out to … when you arrive"')}
    <p class="occ-drawer__note">Link and people edits save back to Settings → Move-in — they're house facts, not per-person ones.</p>
    <p class="listing-form__error" id="mi-error"></p>
    <div class="decision-sheet__actions">
      <button class="hold-sheet__cancel" id="mi-later" type="button" title="Everything stays as it is — reopen from the stay on the occupancy calendar">Not yet</button>
      <button class="btn btn--accent btn--sm" id="mi-submit" type="button">Confirm &amp; draft the email</button>
    </div>`;
  const totalLine = () => {
    const n = id => Number(document.getElementById(id)?.value) || 0;
    document.getElementById('mi-total').textContent =
      `Monthly total: $${(n('mi-rent') + n('mi-dues') + n('mi-food')).toLocaleString('en-US')} · deposit $${n('mi-deposit').toLocaleString('en-US')} held throughout`;
  };
  ['mi-rent', 'mi-dues', 'mi-food', 'mi-deposit'].forEach(id =>
    document.getElementById(id).addEventListener('input', totalLine));
  totalLine();
  document.getElementById('mi-later').onclick = () => { document.getElementById('mi-modal').hidden = true; moveinFor = null; };
  document.getElementById('mi-submit').onclick = () => submitMoveinConfirm();
}

async function submitMoveinConfirm() {
  const s = stays.find(x => x.id === moveinFor);
  if (!s) return;
  const a = applicants.find(x => x.id === s.applicant_id);
  const err = document.getElementById('mi-error');
  const num = id => { const v = document.getElementById(id)?.value; return v === '' ? null : Number(v); };
  const str = id => (document.getElementById(id)?.value || '').trim();
  const payload = {
    rent: num('mi-rent'), dues: num('mi-dues'), food: num('mi-food'), deposit: num('mi-deposit'),
    total: (num('mi-rent') || 0) + (num('mi-dues') || 0) + (num('mi-food') || 0),
    finance_cc: [str('mi-fin1-email'), str('mi-fin2-email')].filter(e => e.includes('@')),
    discord_invite: str('mi-discord'), notion_guide: str('mi-notion'),
    hosts: str('mi-hosts'), address: str('mi-address'), arrival: str('mi-arrival'),
    confirmed_by: me?.name || null, confirmed_at: new Date().toISOString(),
  };
  if (payload.rent == null) { err.textContent = 'Rent is the one number the email cannot guess.'; return; }
  const btn = document.getElementById('mi-submit');
  btn.disabled = true;
  const buddy = str('mi-buddy') || document.getElementById('mi-buddy')?.value || '';

  // House facts flow back to settings so the next confirm starts current.
  const backToSettings = [
    ['finance_contact_1_email', str('mi-fin1-email')], ['finance_contact_2_email', str('mi-fin2-email')],
    ['discord_invite_url', payload.discord_invite], ['notion_guide_url', payload.notion_guide],
    ['onboarding_hosts', payload.hosts], ['house_address', payload.address], ['arrival_note', payload.arrival],
  ];
  for (const [key, v] of backToSettings) {
    if (v !== String(setting(key) ?? '')) await setSetting(key, v);
  }

  const { error } = await sb.from('recruit_stays')
    .update({ movein: payload, buddy_name: buddy || null, updated_at: new Date().toISOString() })
    .eq('id', s.id);
  if (error) { err.textContent = error.message; btn.disabled = false; return; }
  Object.assign(s, { movein: payload, buddy_name: buddy || null });

  // The agreement rides the email as a PDF. A generation failure downgrades
  // to sending without the attachment, never to blocking the email.
  let attachment = null;
  btn.textContent = 'Generating the agreement…';
  try {
    const out = await gmailCall({ action: 'generate-agreement', stayId: s.id });
    s.agreement_url = out.docUrl;
    attachment = { filename: out.filename, mimeType: 'application/pdf', dataBase64: out.pdfBase64 };
  } catch (e) {
    toast(`Agreement not attached — ${e.message}`);
  }
  document.getElementById('mi-modal').hidden = true;
  moveinFor = null;
  openWelcomeEmail(a, s, payload, attachment);
  if (view === 'occupancy') renderOccupancy();
}

/* The welcome email — a fixed template, so the numbers are exactly what was
   just confirmed. Fully editable in the composer before sending. */
function buildWelcomeEmail(a, s, p) {
  const room = rooms.find(r => r.id === s.room_id) || allRooms.find(r => r.id === s.room_id);
  const isTrial = s.kind === 'candidate';
  const first = a?.first || (s.occupant || '').split(' ')[0] || 'there';
  const money = v => v == null ? '$—' : `$${Number(v).toLocaleString('en-US')}`;
  const long = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const month = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('en-US', { month: 'long' }) : '';
  const fin = [setting('finance_contact_1_name'), p.finance_cc?.length > 1 ? setting('finance_contact_2_name') : null]
    .filter(Boolean).join(' & ') || 'our finance folks';
  const trialLine = isTrial
    ? ` with the standard ${setting('trial_length_months')}-month trial period. We'll do feedback check-ins after your first and second months, then either extend a long-term offer or confirm a move-out date.`
    : ` through ${long(s.ends_on)}.`;
  const sections = [];
  sections.push(`Set up rent — watch for an apartments.com invite
Your monthly total is ${money(p.total)}: ${money(p.rent)} rent + ${money(p.dues)} house dues + ${money(p.food)} communal groceries. A ${money(p.deposit)} deposit is held throughout your time at Agape.
- ${fin} (cc'd) will send an invite from apartments.com to ${a?.email || 'your email'} — accept it and set up your payment method there.
- Your first payment covers ${month(s.starts_on)} and is due by ${long(s.starts_on)}.
- If the invite hasn't landed within a couple of days, check spam, then ping ${fin} on Discord.`);
  sections.push(`Sign your agreement
Attached is your housemate agreement — give it a read, sign, and send it back before move-in day by replying to this email with the signed copy. It covers the basics and makes sure we're on the same page around dates, rent, and end-of-term details.`);
  sections.push(`Join Discord & Notion
These two are where the house actually runs.
- Discord: ${p.discord_invite || '(invite link)'} — announcements, events, and day-to-day logistics. Introduce yourself in #all-agape once you're in.
- Notion: invite sent separately — the house wiki: chore rotations, house guides, shared docs. A good place to start: ${p.notion_guide || '(guide link)'}`);
  sections.push(`Book your onboarding chat
Before moving in, reach out to ${p.hosts || 'the house'} on Discord to book your onboarding chat. It happens in your first day or two in the house and takes about an hour — they'll walk you through how the house runs (dinner and cooking shifts, monthly check-ins and house meetings), your areas of responsibility, and anything the tour didn't cover.`);
  if (s.buddy_name) {
    sections.push(`Your buddy
You're paired with ${s.buddy_name}. Your buddy is a current resident who's your first stop for questions — they'll set up your food bins and shoe storage and be a friendly point of contact throughout your time here. They'll say hi on Discord in the next few days; if you haven't heard from them, reply here and I'll make the intro.`);
  }
  sections.push(`Move-in day plan
- Date: ${long(s.starts_on)}
- Address: ${p.address || '(set the address in Settings)'}
${p.arrival ? `- Arrival: ${p.arrival}\n` : ''}We'll send a day-of email with WiFi, door, and everything else you need on arrival.`);
  const body = `Hey ${first},

Welcome to Agape — we are so, so excited for you to be joining us.

Quick confirmation before anything else: you'll be in the ${room?.name || 'your'} room${room?.floor ? ` (${room.floor})` : ''} as a ${isTrial ? 'full-time resident candidate' : 'subletter'}, starting on or after ${long(s.starts_on)}${trialLine} If any of that doesn't match what you expected, reply now and we'll sort it out.

Here's what to knock out before move-in day so you can just settle in when you arrive.

${sections.map((sec, i) => `${i + 1}. ${sec}`).join('\n\n')}

Questions before then? Reply here or ping me on Discord.

See you soon,
${me?.name || 'Ian'} & the Agape crew`;
  return { subject: 'Welcome to Agape — your move-in details', body };
}

function openWelcomeEmail(a, s, p, attachment) {
  if (!a) { toast('No application linked to this stay — email them by hand'); return; }
  const draft = buildWelcomeEmail(a, s, p);
  emailApplicantId = a.id;
  emailMode = 'outreach';
  emailKind = 'welcome';
  emailExtras = {
    cc: p.finance_cc || [],
    attachments: attachment ? [attachment] : [],
    stampStayId: s.id, stamp: 'welcome',
  };
  document.getElementById('email-send').textContent = 'Send via Agape Gmail';
  document.getElementById('email-title').textContent = `Welcome ${a.first} to Agape`;
  document.getElementById('email-subject').value = draft.subject;
  document.getElementById('email-body').value = draft.body;
  const addedHost = document.getElementById('email-added');
  if (addedHost) { addedHost.hidden = true; addedHost.innerHTML = ''; }
  document.getElementById('email-status').textContent =
    `${attachment ? `Agreement attached (${attachment.filename})` : 'No agreement attached'}${emailExtras.cc.length ? ` · cc ${emailExtras.cc.join(', ')}` : ''} · every line is editable.`;
  document.getElementById('email-modal').hidden = false;
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
  // addPlacement clears the previous placement itself now — one listing per
  // applicant is the invariant, so every placement is a move.
  const added = await addPlacement(applicantId, toListingId, 'manual');
  if (!added) return;
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
  return gaps.filter(([a, b]) => (new Date(b) - new Date(a)) / 86400000 >= setting('gap_min_days'));
}

/* What a listing actually covers, as dates. A sublet states its own end; a
   resident trial runs a fixed length; a listing with no end date is assumed to
   run that same length rather than forever — an offer with no horizon isn't an
   offer. */
function listingSpan(l) {
  const months = setting('trial_length_months');
  return [l.starts_on, l.ends_on || addMonthsIso2(l.starts_on, months)];
}

/* Cut one open stretch into what's listed and what isn't. The whole gap used to
   turn "listed" the moment any listing touched it, so a three-month opening
   inside an eight-month gap looked like an eight-month opening. */
function gapSegments(roomId, gapStart, gapEnd) {
  const open = listings
    .filter(l => l.room_id === roomId && l.status === 'open')
    .map(l => ({ l, span: listingSpan(l) }))
    .filter(({ span }) => span[0] <= gapEnd && span[1] >= gapStart)
    .sort((x, y) => x.span[0].localeCompare(y.span[0]));
  const segs = [];
  let cursor = gapStart;
  for (const { l, span } of open) {
    const from = span[0] < gapStart ? gapStart : span[0];
    const to = span[1] > gapEnd ? gapEnd : span[1];
    if (to < cursor) continue;                        // already covered
    if (from > cursor) segs.push([cursor, isoAddDays(from, -1), null]);
    segs.push([from < cursor ? cursor : from, to, l]);
    cursor = isoAddDays(to, 1);
    if (cursor > gapEnd) break;
  }
  if (cursor <= gapEnd) segs.push([cursor, gapEnd, null]);
  return segs;
}

/* One room's bars: stays, then the uncovered stretches between them. Module
   scope (not a closure inside renderOccupancy) so refreshLane() can repaint a
   single lane after an autosave without rebuilding the drawer. */
function laneBarsHtml(r) {
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
      style="left: ${left}%; width: calc(${Math.max(width, 0.8)}% - var(--bar-break))" title="${esc(`${s.occupant || KIND_LABELS[s.kind]} · ${KIND_LABELS[s.kind]} · ${range}`)}"
      data-stay="${s.id}">${esc(s.occupant || KIND_LABELS[s.kind])}</button>`);
  }
  for (const [gapA, gapB] of roomGaps(r.id)) {
    // A listed stretch and one nobody has touched were drawn identically, and
    // the listed bar is the listing's own window — usually three months — not
    // the whole gap it sits inside.
    for (const [a, b, listed] of gapSegments(r.id, gapA, gapB)) {
      const left = occPos(a) * 100;
      const width = occPos(isoAddDays(b, 1)) * 100 - left;
      if (width <= 0) continue;
      if (listed) {
        const act = occDrawer?.type === 'listing' && occDrawer.id === listed.id;
        const label = `Listed ${fmtShort(a)} – ${fmtShort(b)} · ${
          listed.kind === 'resident' ? 'resident trial' : 'sublet'}`;
        bars.push(`<button type="button" class="cal__event cal__event--vacant is-listed ${act ? 'is-editing' : ''}"
          style="left: ${left}%; width: calc(${width}% - var(--bar-break))" title="${esc(label)}"
          aria-label="${esc(label)}" data-listing-bar="${listed.id}"><span class="cal__event-tag">listed</span></button>`);
        continue;
      }
      const active = occDrawer?.type === 'gap' && occDrawer.roomId === r.id && occDrawer.start === a;
      bars.push(`<button type="button" class="cal__event cal__event--vacant ${active ? 'is-editing' : ''}"
        style="left: ${left}%; width: calc(${width}% - var(--bar-break))" title="Open ${fmtShort(a)} – ${fmtShort(b)} — tap to fill or list"
        aria-label="Open ${fmtShort(a)} – ${fmtShort(b)}"
        data-gap-room="${r.id}" data-gap-start="${a}" data-gap-end="${b}"></button>`);
    }
  }
  return bars.join('');
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
        <!-- One gridline overlay for the whole body, on the same
             repeat(n, 1fr) grid as the header, so a month edge in the header
             and a month edge behind the bars are the same pixel. Per-lane
             repeating gradients drifted by a pixel or two per month. -->
        <div class="cal__grid" aria-hidden="true">${months.map(() => '<span></span>').join('')}</div>
        ${todayPct !== null ? `<span class="cal__today" style="left: calc(var(--room-col) + (100% - var(--room-col)) * ${todayPct / 100})"></span>` : ''}
        ${rooms.map(r => `
          <div class="cal__row">
            <button type="button" class="cal__room-col cal__room-btn ${occDrawer?.type === 'room' && occDrawer.roomId === r.id ? 'is-editing' : ''}" data-room-info="${r.id}" title="Room details">
              <span class="occ__room-name">${esc(r.name)}</span>
              <span class="occ__room-sub">${esc(r.floor)}${r.total_sqft ? ` · ${r.total_sqft} sq ft` : ''}</span>
            </button>
            <div class="cal__lane" data-lane-room="${r.id}">${laneBarsHtml(r)}</div>
          </div>`).join('')}
      </div>
    </div>
    ${occListingsHtml()}
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
  if (next?.type !== 'stay' || next.id !== promoting) promoting = null;
  occDrawer = next;   // a new drawer starts at its first step, never mid-flow
  document.querySelectorAll('.cal__event.is-editing, .cal__room-btn.is-editing').forEach(el => el.classList.remove('is-editing'));
  if (next?.type === 'stay') document.querySelector(`[data-stay="${next.id}"]`)?.classList.add('is-editing');
  if (next?.type === 'gap') document.querySelector(`[data-gap-room="${next.roomId}"][data-gap-start="${next.start}"]`)?.classList.add('is-editing');
  if (next?.type === 'listing') document.querySelector(`[data-listing-bar="${next.id}"]`)?.classList.add('is-editing');
  if (next?.type === 'room') document.querySelector(`[data-room-info="${next.roomId}"]`)?.classList.add('is-editing');
  renderOccDrawer();
}

/* Trial milestones. A trial candidate gets a check-in once they're a month
   in, and a house decision a month before their sublet ends — far enough out
   that either side can still make other plans. Both are suggestions the
   drawer prefills; the house can move either date. */
function trialCheckinDefault(startsOn) {
  return startsOn ? addMonthsIso2(startsOn, setting('trial_checkin_months')) : '';
}
function trialDecisionDefault(endsOn) {
  return endsOn ? addMonthsIso2(endsOn, -setting('trial_decision_months')) : '';
}
/* addMonthsIso() snaps to the first of the month (the timeline needs that);
   milestones keep the day-of-month, clamped when the target month is short. */
function addMonthsIso2(iso, n) {
  const d = new Date(iso + 'T12:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toISOString().slice(0, 10);
}

function trialFieldsHtml(s) {
  return `<div class="occ-drawer__trial" data-trial-fields hidden>
    <div class="occ-drawer__section">Trial milestones</div>
    <div class="occ-drawer__dates">
      <label class="listing-form__field">Check-in
        <input type="date" name="checkin_on" class="listing-status" value="${s.checkin_on || ''}">
      </label>
      <label class="listing-form__field">Decision
        <input type="date" name="decision_on" class="listing-status" value="${s.decision_on || ''}">
      </label>
    </div>
    ${ballotFieldHtml('checkin', 'Month 1', s.occupant, s.checkin_on, s.checkin_form_url)}
    ${ballotFieldHtml('decision', 'Final decision', s.occupant, s.decision_on, s.decision_form_url)}
    <p class="occ-drawer__note">Check-in lands a month in; the decision a month before they move out. Each needs its own copy of the housemate feedback form, named as shown — the date is the meeting the ballot closes at, not the milestone. The house is nudged four days out and bumped again the morning of that meeting. Move a milestone past a Monday and the ballot closes at a different meeting, so rename the form — the nudges start again on their own.</p>
  </div>`;
}

/* One ballot field, with the name its form copy should carry underneath it.
   The name is derived rather than described because the close date is computed
   — asking someone to work out which Monday it is, for two milestones, per
   person, is how the folder ends up with four naming schemes in it. */
function ballotFieldHtml(which, milestone, occupant, on, url) {
  const close = voteCloseOn(on);
  return `<label class="listing-form__field">${esc(milestone)} ballot
      <input type="url" name="${which}_form_url" class="listing-status" placeholder="Google Form link"
             value="${esc(url || '')}">
      <span class="occ-drawer__hint">${on
        ? `Name the copy <code>Agape vote · ${esc(occupant || 'Name')} · ${esc(milestone)} · ${close}</code> — closes at the ${fmtShort(close)} meeting.`
        : 'Set the date above and this names itself.'}</span>
    </label>`;
}

/* When a ballot closes: the Monday house meeting before the milestone, taking
   the date on the stay as it stands. Kept in step with ballotCloses() in
   _shared/recruit-notify.ts. */
function voteCloseOn(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (((d.getUTCDay() + 6) % 7) || 7));
  return d.toISOString().slice(0, 10);
}

/* --- candidate → resident ---
   The decision reminder sends the house here. Promotion is a real state
   change with three moving parts (close the trial, open the residency, move
   the applicant's stage), so it goes through one RPC rather than the stay
   form — a half-applied promotion would leave someone in two rooms or in
   none. The form below still edits the trial itself; this is the door out. */
let promoting = null;   // stay id currently showing the confirm strip

/* The bottom action area of a stay drawer — every transition a stay can make,
   in one place: trial → resident ("Change to resident"), sublet → trial
   ("Add resident trial"), and the pre-move-in undo ("Step back"). The stay
   form above only edits the stay; these are the doors out of it. */
function stayTransitionsHtml(s) {
  if (!s.id) return '';   // a new stay has nothing to transition out of
  const today = new Date().toISOString().slice(0, 10);
  const parts = [];

  if (s.kind === 'candidate') {
    const trialEnd = s.ends_on;
    const start = trialEnd ? isoAddDays(trialEnd, 1) : today;
    if (promoting === s.id) {
      return `<form class="occ-drawer__promote occ-drawer__promote--open" data-promote-form="${s.id}">
        <div class="occ-drawer__section">Make ${esc(s.occupant || 'them')} a resident</div>
        <div class="occ-drawer__dates">
          <label class="listing-form__field">Room
            <select name="room_id" class="listing-status">
              ${rooms.map(r => `<option value="${r.id}" ${r.id === s.room_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
            </select>
          </label>
          <label class="listing-form__field">Resident from
            <input type="date" name="starts_on" class="listing-status" value="${start}" required>
          </label>
        </div>
        <p class="occ-drawer__note">The trial closes the day before, so the timeline has no gap. An onboarding checklist gets created for the house to work through.</p>
        <p class="listing-form__error" data-promote-error></p>
        <div class="drawer-cta">
          <div class="drawer-cta__row">
            <button type="button" class="drawer-cta__quiet" data-promote-cancel>Cancel</button>
            <button type="submit" class="btn btn--accent drawer-cta__commit">Change to resident</button>
          </div>
        </div>
      </form>`;
    }
    parts.push(`<button type="button" class="drawer-cta__alt" data-promote-open="${s.id}">
      <span>Change to resident</span>
      <span class="drawer-cta__exit-hint">ends the trial and starts an open-ended residency${trialEnd ? ` on ${fmtShort(start)}` : ''}</span>
    </button>`);
  }

  if (s.kind === 'sublet') {
    const start = s.ends_on ? isoAddDays(s.ends_on, 1) : today;
    if (promoting === s.id) {
      return `<form class="occ-drawer__promote occ-drawer__promote--open" data-s2t-form="${s.id}">
        <div class="occ-drawer__section">Start ${esc(s.occupant || 'their')} resident trial</div>
        <div class="occ-drawer__dates">
          <label class="listing-form__field">Room
            <select name="room_id" class="listing-status">
              ${rooms.map(r => `<option value="${r.id}" ${r.id === s.room_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
            </select>
          </label>
          <label class="listing-form__field">Trial from
            <input type="date" name="starts_on" class="listing-status" value="${start}" required>
          </label>
        </div>
        <label class="listing-form__field">Through
          <input type="date" name="ends_on" class="listing-status" value="${addMonthsIso2(start, setting('trial_length_months'))}" required>
        </label>
        <p class="occ-drawer__note">The sublet closes the day before, so the timeline has no gap. Check-in and decision milestones are prefilled from the trial settings.</p>
        <p class="listing-form__error" data-s2t-error></p>
        <div class="drawer-cta">
          <div class="drawer-cta__row">
            <button type="button" class="drawer-cta__quiet" data-promote-cancel>Cancel</button>
            <button type="submit" class="btn btn--accent drawer-cta__commit">Add resident trial</button>
          </div>
        </div>
      </form>`;
    }
    parts.push(`<button type="button" class="drawer-cta__alt" data-s2t-open="${s.id}">
      <span>Add resident trial</span>
      <span class="drawer-cta__exit-hint">they're staying to try for residency — you pick the start date; it defaults to when the sublet ends</span>
    </button>`);
  }

  // The ways out, least → most final: mark leaving (residents), the
  // pre-move-in step-back (booked people), and delete — always last, always
  // the only plain-destructive one.
  const exits = [];
  if (s.kind === 'resident') {
    exits.push(`<button type="button" class="drawer-cta__exit" data-stay-leaving="${s.room_id}" data-stay-leaving-date="${s.ends_on || ''}">
      <span class="drawer-cta__exit-label">Mark leaving</span>
      <span class="drawer-cta__exit-icon" aria-hidden="true">&rarr;</span>
      <span class="drawer-cta__exit-hint">sets a move-out date and lists the room</span>
    </button>`);
  }
  if (s.applicant_id && s.kind !== 'resident' && s.starts_on > today) {
    exits.push(`<button type="button" class="drawer-cta__exit drawer-cta__exit--danger" data-unbook="${s.id}">
      <span class="drawer-cta__exit-label">Step back — reopen the listing</span>
      <span class="drawer-cta__exit-icon" aria-hidden="true">&#8617;</span>
      <span class="drawer-cta__exit-hint">removes this booking, reopens the room's listing, and puts them back on it as a candidate — everyone else returns too, unless a recruiter removed them</span>
    </button>`);
  }
  exits.push(`<button type="button" class="drawer-cta__exit drawer-cta__exit--danger" data-stay-delete="${s.id}">
    <span class="drawer-cta__exit-label">Remove stay</span>
    <span class="drawer-cta__exit-icon" aria-hidden="true">&times;</span>
    <span class="drawer-cta__exit-hint">deletes it from the timeline</span>
  </button>`);

  if (!parts.length && !exits.length) return '';
  return `<div class="drawer-cta occ-drawer__promote">
    ${parts.join('')}
    ${exits.length ? `<div class="drawer-cta__exits">${exits.join('')}</div>` : ''}
  </div>`;
}

async function submitSubletToTrial(form) {
  const stayId = form.dataset.s2tForm;
  const err = form.querySelector('[data-s2t-error]');
  const fd = new FormData(form);
  const s = stays.find(x => x.id === stayId);
  const startsOn = fd.get('starts_on');
  const endsOn = fd.get('ends_on');
  if (!startsOn) { err.textContent = 'Pick the day the trial starts.'; return; }
  if (endsOn && endsOn < startsOn) { err.textContent = '"Through" must be at or after "From".'; return; }
  const { error } = await sb.rpc('recruit_sublet_to_trial', {
    p_stay_id: stayId,
    p_room_id: +fd.get('room_id'),
    p_starts_on: startsOn,
    p_ends_on: endsOn || null,
    p_checkin_on: trialCheckinDefault(startsOn),
    p_decision_on: endsOn ? trialDecisionDefault(endsOn) : null,
  });
  if (error) { err.textContent = error.message; return; }
  promoting = null;
  occDrawer = null;
  await Promise.all([loadHouse(), loadAll()]);
  toast(`${s?.occupant || 'They'} are on a resident trial from ${fmtDay(startsOn)}`);
  renderRailCounts();
  renderOccupancy();
}

/* --- onboarding checklist ---
   Seeded by the promotion RPC, ticked by hand. Nothing here provisions
   anything; it's the house's shared memory of what's still owed a new
   resident. Hidden once every item is done — a finished list is noise. */
function onboardingHtml(s) {
  const items = onboarding.filter(o => o.stay_id === s.id)
    .sort((a, b) => a.sort - b.sort);
  if (!items.length) return '';
  const left = items.filter(o => !o.done_at).length;
  return `<div class="occ-drawer__onboard">
    <div class="occ-drawer__section">Onboarding ${left ? `· ${left} left` : '· all done'}</div>
    <ul class="onboard-list">
      ${items.map(o => `<li class="onboard-item ${o.done_at ? 'is-done' : ''}">
        <label>
          <input type="checkbox" data-onboard="${o.id}" ${o.done_at ? 'checked' : ''}>
          <span>${esc(o.item)}</span>
        </label>
      </li>`).join('')}
    </ul>
  </div>`;
}

/* --- move-in panel (stay drawer) ---
   The acceptance flow's state, visible where the stay lives: buddy, the
   agreement, and the two emails. "Move-in details…" reopens the confirm
   sheet at any point before (or after) the welcome email goes out. */
function moveinPanelHtml(s) {
  if (!s.id || !s.applicant_id || s.kind === 'shared') return '';
  const row = (label, value) => `<div class="occ-drawer__fact"><dt>${label}</dt><dd>${value}</dd></div>`;
  const agreement = s.agreement_signed_at
    ? `signed ${fmtDay(s.agreement_signed_at.slice(0, 10))}`
    : s.agreement_url
      ? `<a href="${esc(s.agreement_url)}" target="_blank" rel="noopener">generated</a> — <label class="chip-line"><input type="checkbox" data-agreement-signed="${s.id}"> mark signed</label>`
      : 'not generated yet';
  return `<div class="occ-drawer__onboard">
    <div class="occ-drawer__section">Move-in</div>
    <dl class="occ-drawer__facts">
      ${row('Buddy', esc(s.buddy_name || '—'))}
      ${row('Agreement', agreement)}
      ${row('Welcome email', s.welcome_email_sent_at ? `sent ${fmtDay(s.welcome_email_sent_at.slice(0, 10))}` : 'not sent')}
      ${row('Day-of email', s.dayof_email_sent_at ? `sent ${fmtDay(s.dayof_email_sent_at.slice(0, 10))}` : 'drafts on move-in morning')}
    </dl>
    <button type="button" class="drawer-cta__alt" data-movein-open="${s.id}">
      <span>Move-in details…</span>
      <span class="drawer-cta__exit-hint">confirm money, buddy, and links — then ${s.welcome_email_sent_at ? 're-draft' : 'draft'} the welcome email</span>
    </button>
  </div>`;
}

/* The accept flow's undo, pre-move-in only. One RPC (migration 175): stay
   deleted, listing reopened, the person back on the shortlist. The sweep
   right after brings back everyone else who still qualifies — tombstones
   (real recruiter removals) keep holding. Decision and stage stand. */
async function unbookStay(stayId) {
  const s = stays.find(x => x.id === stayId);
  if (!s) return;
  const a = applicants.find(x => x.id === s.applicant_id);
  const room = rooms.find(r => r.id === s.room_id) || allRooms.find(r => r.id === s.room_id);
  if (!confirm(`Step ${s.occupant || 'them'} back from ${room?.name || 'the room'}?\n\nThe booking comes off the calendar, the listing reopens, and they go back onto it as a candidate. Their accept decision stays on record.`)) return;
  const { error } = await sb.rpc('recruit_unbook_stay', { p_stay_id: stayId });
  if (error) { toast(`Couldn't step back: ${error.message}`); return; }
  occDrawer = null;
  await Promise.all([loadHouse(), loadAll()]);
  const readded = await syncAutoPlacements();
  toast(`${s.occupant || 'They'} stepped back — listing reopened${readded ? ` · ${readded} candidate${readded === 1 ? '' : 's'} re-placed` : ''}`);
  if (a) logEvent('event_stage', a.id, fullName(a),
    `${me.name || 'A housemate'} stepped {} back from ${room?.name || 'a room'} before move-in — the listing is open again.`);
  renderRailCounts();
  renderOccupancy();
  if (VIEWS[view]?.kind === 'applicants') renderApplicants();
}

async function toggleAgreementSigned(stayId, signed) {
  const s = stays.find(x => x.id === stayId);
  if (!s) return;
  const when = signed ? new Date().toISOString() : null;
  const { error } = await sb.from('recruit_stays')
    .update({ agreement_signed_at: when, updated_at: new Date().toISOString() }).eq('id', stayId);
  if (error) { toast(`Could not save: ${error.message}`); return; }
  s.agreement_signed_at = when;
  renderOccDrawer();
}

async function toggleOnboarding(id, done) {
  const row = onboarding.find(o => o.id === id);
  if (!row) return;
  const patch = done
    ? { done_at: new Date().toISOString(), done_by: (await sb.auth.getUser()).data.user?.id || null }
    : { done_at: null, done_by: null };
  const { error } = await sb.from('recruit_onboarding').update(patch).eq('id', id);
  if (error) { toast(`Could not save: ${error.message}`); return; }
  Object.assign(row, patch);
  renderOccDrawer();
}

async function submitPromote(form) {
  const stayId = form.dataset.promoteForm;
  const err = form.querySelector('[data-promote-error]');
  const fd = new FormData(form);
  const s = stays.find(x => x.id === stayId);
  const startsOn = fd.get('starts_on');
  if (!startsOn) { err.textContent = 'Pick the date their residency starts.'; return; }
  if (s && startsOn <= s.starts_on) {
    err.textContent = `Their residency has to start after the trial began (${fmtDay(s.starts_on)}).`;
    return;
  }
  const { error } = await sb.rpc('recruit_promote_stay', {
    p_stay_id: stayId,
    p_room_id: +fd.get('room_id'),
    p_starts_on: startsOn,
  });
  if (error) { err.textContent = error.message; return; }
  promoting = null;
  occDrawer = null;
  // The RPC touched stays, onboarding, and possibly an applicant's stage.
  await Promise.all([loadHouse(), loadAll()]);
  toast(`${s?.occupant || 'They'} are a resident — onboarding checklist created`);
  renderRailCounts();
  renderOccupancy();
}

function stayFormHtml(s, roomId) {
  const isNew = !s.id;
  // The ways out of a stay live in the drawer's bottom action area
  // (stayTransitionsHtml), not inside the edit form — the form edits, the
  // bottom area transitions.
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
    ${trialFieldsHtml(s)}
    <p class="listing-form__error" data-form-error></p>
    <div class="drawer-cta">
      ${isNew ? `<div class="drawer-cta__row">
        <button type="button" class="drawer-cta__quiet" data-drawer-close>Cancel</button>
        <button type="submit" class="btn btn--accent drawer-cta__commit">Add stay</button>
      </div>` : `<p class="drawer-cta__flag" data-save-flag></p>`}
    </div>
  </form>`;
}

/* --- an open stretch: choose, then continue in place ---
   An empty stretch has exactly two honest answers: open it to candidates, or
   record who's already moving in. Showing both at once meant a listing button
   sitting on top of a full stay form, so the drawer now asks first and then
   becomes the flow you picked. Back returns to the choice; nothing is written
   until the step's own commit. */
function gapDrawerBody() {
  const choice = occDrawer.choice || null;
  if (!choice) {
    return `<div class="step-choices">
      <button type="button" class="step-choice" data-gap-choice="listing">
        <span class="step-choice__label">Create a listing</span>
        <span class="step-choice__go" aria-hidden="true">&rarr;</span>
        <span class="step-choice__hint">Opens the room to candidates. Everyone who qualifies gets placed in it.</span>
      </button>
      <button type="button" class="step-choice" data-gap-choice="occupant">
        <span class="step-choice__label">Add an occupant</span>
        <span class="step-choice__go" aria-hidden="true">&rarr;</span>
        <span class="step-choice__hint">Someone is already moving in — record the stay and close the gap.</span>
      </button>
    </div>`;
  }
  const back = `<button type="button" class="step-back" data-gap-choice="">&larr; ${
    choice === 'listing' ? 'Create a listing' : 'Add an occupant'}</button>`;
  if (choice === 'occupant') {
    return back + stayFormHtml(
      { kind: 'sublet', starts_on: occDrawer.start, ends_on: occDrawer.end }, occDrawer.roomId);
  }
  // The listing form lives in the drawer rather than a modal so the flow never
  // leaves the sidebar it started in. Same form, same create handler.
  return back + `<div class="step-listing">${listingForm({
    room_id: occDrawer.roomId, kind: 'sublet',
    starts_on: occDrawer.start, ends_on: occDrawer.end,
    notes: `Open from ${fmtShort(occDrawer.start)} on the occupancy calendar.`,
  })}</div>`;
}

/* --- tapping a listing ---
   A listed stretch used to open the gap chooser, whose two options were
   "create a listing" (already done) and "add an occupant" (not the point). A
   live listing has its own question: who's in it, and is it still true?
   So the drawer shows the offer and the candidates sitting in it, and its
   actions are the ones a listing actually has — edit the offer, mark it filled,
   or close it. Recording an occupant is still reachable, because a room that
   got taken offline is a real thing, but it's the alternative, not the default. */
function listingDrawerBody(l) {
  const room = rooms.find(r => r.id === l.room_id) || allRooms.find(r => r.id === l.room_id);
  const money = n => n != null && n !== '' ? '$' + Number(n).toLocaleString('en-US') : null;
  const rent = money(l.rent_monthly ?? room?.rent_monthly);
  const dues = money(l.dues_monthly ?? settings.dues_monthly);
  const food = money(l.groceries_monthly ?? settings.food_monthly);
  const allIn = [l.rent_monthly ?? room?.rent_monthly, l.dues_monthly ?? settings.dues_monthly,
    l.groceries_monthly ?? settings.food_monthly].every(v => v != null && v !== '')
    ? money(Number(l.rent_monthly ?? room?.rent_monthly) + Number(l.dues_monthly ?? settings.dues_monthly)
        + Number(l.groceries_monthly ?? settings.food_monthly)) : null;

  if (occDrawer.choice === 'edit') {
    return `<button type="button" class="step-back" data-listing-choice="">&larr; Edit the offer</button>
      <div class="step-listing">${listingForm(l)}</div>`;
  }
  if (occDrawer.choice === 'occupant') {
    const [from, to] = listingSpan(l);
    return `<button type="button" class="step-back" data-listing-choice="">&larr; Record who's moving in</button>
      ${stayFormHtml({ kind: l.kind === 'resident' ? 'candidate' : 'sublet', starts_on: from, ends_on: to }, l.room_id)}`;
  }

  const placed = placements.filter(p => p.listing_id === l.id && p.status === 'active');
  const named = placed.map(p => applicants.find(a => a.id === p.applicant_id)).filter(Boolean);
  const facts = [
    ['Window', listingWindow(l)],
    ['Rent', rent], ['Communal dues', dues], ['Food', food],
    ['All-in, one person', allIn ? `${allIn}/mo` : null],
    ['Listed', l.source === 'gap' ? 'from the occupancy calendar' : 'by hand'],
  ].filter(([, v]) => v);

  return `
    <dl class="occ-drawer__facts">
      ${facts.map(([k, v]) => `<div class="occ-drawer__fact"><dt>${k}</dt><dd>${esc(String(v))}</dd></div>`).join('')}
    </dl>
    <div class="occ-drawer__section">Candidates ${placed.length ? `· ${placed.length}` : ''}</div>
    ${named.length ? `<div class="listing-row__people">
      ${named.map(a => `<button class="link-chip" data-review="${a.id}">${
        esc([a.first, a.last].filter(Boolean).join(' ') || 'Applicant')}</button>`).join('')}
    </div>` : `<p class="occ-drawer__note">Nobody qualifies for it yet. Candidates are placed by rule as their dates line up.</p>`}
    ${l.notes ? `<p class="occ-drawer__note">${esc(l.notes)}</p>` : ''}
    <div class="drawer-cta">
      <button type="button" class="drawer-cta__alt" data-listing-choice="edit">
        <span>Edit the offer</span>
        <span class="drawer-cta__exit-hint">dates, rent, notes</span>
      </button>
      <div class="drawer-cta__exits">
        <button type="button" class="drawer-cta__exit" data-listing-choice="occupant">
          <span class="drawer-cta__exit-label">Record who's moving in</span>
          <span class="drawer-cta__exit-icon" aria-hidden="true">&rarr;</span>
          <span class="drawer-cta__exit-hint">someone took it — closes the gap</span>
        </button>
        <button type="button" class="drawer-cta__exit" data-listing-status="filled" data-listing-id="${l.id}">
          <span class="drawer-cta__exit-label">Mark filled</span>
          <span class="drawer-cta__exit-icon" aria-hidden="true">&check;</span>
          <span class="drawer-cta__exit-hint">keeps it on the record, stops placing candidates</span>
        </button>
        <button type="button" class="drawer-cta__exit drawer-cta__exit--danger" data-listing-status="closed" data-listing-id="${l.id}">
          <span class="drawer-cta__exit-label">Close listing</span>
          <span class="drawer-cta__exit-icon" aria-hidden="true">&times;</span>
          <span class="drawer-cta__exit-hint">we're not offering this room after all</span>
        </button>
      </div>
    </div>`;
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
    // Read top to bottom: edit the stay, its move-in state, the checklist,
    // then the ways OUT of it — transitions live in the bottom action area.
    body = stayFormHtml(s, s.room_id) + moveinPanelHtml(s) + onboardingHtml(s) + stayTransitionsHtml(s);
  } else if (occDrawer.type === 'gap') {
    const room = rooms.find(r => r.id === occDrawer.roomId);
    title = `${room?.name || 'Room'} — open`;
    sub = `${fmtShort(occDrawer.start)} – ${fmtShort(occDrawer.end)}`;
    body = gapDrawerBody();
  } else if (occDrawer.type === 'listing') {
    const l = listings.find(x => x.id === occDrawer.id);
    if (!l) { occDrawer = null; hostWrap.innerHTML = ''; return; }
    const room = rooms.find(r => r.id === l.room_id) || allRooms.find(r => r.id === l.room_id);
    title = `${room?.name || 'Room'} — listed`;
    sub = `${l.kind === 'resident' ? 'Resident trial' : 'Sublet'} · ${
      l.status === 'open' ? 'open to candidates' : esc(l.status)}`;
    body = listingDrawerBody(l);
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
  hostWrap.querySelectorAll('[data-gap-choice]').forEach(btn => btn.addEventListener('click', () => {
    occDrawer.choice = btn.dataset.gapChoice || null;
    renderOccDrawer();
  }));
  hostWrap.querySelectorAll('[data-listing-choice]').forEach(btn => btn.addEventListener('click', () => {
    occDrawer.choice = btn.dataset.listingChoice || null;
    renderOccDrawer();
  }));
  hostWrap.querySelectorAll('[data-listing-status]').forEach(btn => btn.addEventListener('click', () => {
    setListingStatusFromDrawer(btn.dataset.listingId, btn.dataset.listingStatus);
  }));
  const drawerListing = hostWrap.querySelector('.step-listing [data-listing-form]');
  if (drawerListing && occDrawer?.type === 'listing') {
    drawerListing.addEventListener('change', () => autoSaveListing(drawerListing, 'status'));
    drawerListing.querySelector('[data-cancel-listing]')?.addEventListener('click', () => {
      occDrawer.choice = null;
      renderOccDrawer();
    });
  }
  const gapListing = hostWrap.querySelector('.step-listing [data-listing-form]');
  if (gapListing) {
    gapListing.addEventListener('submit', onListingCreate);
    gapListing.querySelector('[data-cancel-listing]')?.addEventListener('click', () => {
      occDrawer.choice = null;
      renderOccDrawer();
    });
  }
  hostWrap.querySelector('[data-stay-form]')?.addEventListener('submit', onStayFormSubmit);
  hostWrap.querySelector('[data-promote-open]')?.addEventListener('click', e => {
    promoting = e.currentTarget.dataset.promoteOpen;
    renderOccDrawer();
  });
  hostWrap.querySelector('[data-promote-cancel]')?.addEventListener('click', () => {
    promoting = null;
    renderOccDrawer();
  });
  hostWrap.querySelector('[data-promote-form]')?.addEventListener('submit', e => {
    e.preventDefault();
    submitPromote(e.target);
  });
  hostWrap.querySelector('[data-s2t-open]')?.addEventListener('click', e => {
    promoting = e.currentTarget.dataset.s2tOpen;
    renderOccDrawer();
  });
  hostWrap.querySelector('[data-s2t-form]')?.addEventListener('submit', e => {
    e.preventDefault();
    submitSubletToTrial(e.target);
  });
  hostWrap.querySelector('[data-movein-open]')?.addEventListener('click', e => {
    openMoveinConfirm(e.currentTarget.dataset.moveinOpen);
  });
  hostWrap.querySelector('[data-unbook]')?.addEventListener('click', e => {
    unbookStay(e.currentTarget.dataset.unbook);
  });
  hostWrap.querySelector('[data-agreement-signed]')?.addEventListener('change', e => {
    toggleAgreementSigned(e.target.dataset.agreementSigned, e.target.checked);
  });
  hostWrap.querySelectorAll('[data-onboard]').forEach(box => {
    box.addEventListener('change', () => toggleOnboarding(box.dataset.onboard, box.checked));
  });
  // Scoped to the stay form on purpose: the promote form above it has its own
  // starts_on, and an unscoped lookup here read that instead — recomputing the
  // check-in default off the residency date rather than the trial's.
  const form = hostWrap.querySelector('[data-stay-form]');
  if (form) {
    const ongoing = form.querySelector('input[name="ongoing"]');
    if (ongoing) ongoing.addEventListener('change', e => {
      const ends = form.querySelector('input[name="ends_on"]');
      ends.disabled = e.target.checked;
      if (e.target.checked) ends.value = '';
      syncTrialFields(form);
    });
    for (const sel of ['select[name="kind"]', 'input[name="starts_on"]', 'input[name="ends_on"]']) {
      form.querySelector(sel)?.addEventListener('change', () => syncTrialFields(form));
    }
    syncTrialFields(form);
    // Autosave. `change` is the right moment: text commits on blur, dates and
    // selects the instant they settle. Delegated, so the trial milestone fields
    // that appear later are covered without re-binding.
    if (form.dataset.stayForm !== 'new') {
      form.addEventListener('change', () => autoSaveStay(form));
    }
  }
}

/* Show the milestone block only for trial candidates, and keep the suggested
   dates in step with the stay window until someone edits them by hand. */
function syncTrialFields(form) {
  const block = form.querySelector('[data-trial-fields]');
  if (!block) return;
  const kind = form.querySelector('select[name="kind"]')?.value;
  block.hidden = kind !== 'candidate';
  if (block.hidden) return;
  const startsOn = form.querySelector('input[name="starts_on"]')?.value || '';
  const endsOn = form.querySelector('input[name="ongoing"]')?.checked
    ? '' : (form.querySelector('input[name="ends_on"]')?.value || '');
  const checkin = block.querySelector('input[name="checkin_on"]');
  const decision = block.querySelector('input[name="decision_on"]');
  if (!checkin.dataset.touched) checkin.value = trialCheckinDefault(startsOn);
  if (!decision.dataset.touched) decision.value = trialDecisionDefault(endsOn);
  for (const el of [checkin, decision]) {
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      el.addEventListener('input', () => { el.dataset.touched = '1'; });
    }
  }
}

/* Validate + write, and nothing else — no toast, no navigation, no re-render.
   Both the autosave path and the create button go through this so an edit and
   an insert can never drift apart on validation. Returns true on success;
   on failure the inline error is already set. */
async function writeStayForm(form) {
  const fd = new FormData(form);
  const id = form.dataset.stayForm;
  const err = form.querySelector('[data-form-error]');
  const rec = {
    room_id: +form.dataset.stayRoom,
    occupant: (fd.get('occupant') || '').trim(),
    kind: fd.get('kind'),
    starts_on: fd.get('starts_on'),
    ends_on: fd.get('ongoing') ? null : (fd.get('ends_on') || null),
    // Milestones belong to a trial; switching a stay to any other kind clears them.
    checkin_on: fd.get('kind') === 'candidate' ? (fd.get('checkin_on') || null) : null,
    decision_on: fd.get('kind') === 'candidate' ? (fd.get('decision_on') || null) : null,
    checkin_form_url: fd.get('kind') === 'candidate' ? ((fd.get('checkin_form_url') || '').trim() || null) : null,
    decision_form_url: fd.get('kind') === 'candidate' ? ((fd.get('decision_form_url') || '').trim() || null) : null,
  };
  if (!rec.starts_on) { err.textContent = 'Start date is required.'; return; }
  if (rec.ends_on && rec.ends_on < rec.starts_on) { err.textContent = '"Through" must be at or after "From".'; return; }
  if (!rec.occupant && rec.kind !== 'shared') { err.textContent = 'Add a name (or delete the stay to leave the room open).'; return; }
  if (!rec.ends_on && !fd.get('ongoing')) {
    if (rec.kind === 'resident' || rec.kind === 'shared') rec.ends_on = null; // residents default open-ended
    else { err.textContent = 'Sublets and trials need an end date (or tick "Ongoing").'; return; }
  }
  for (const [field, label] of [['checkin_on', 'Check-in'], ['decision_on', 'Decision']]) {
    const v = rec[field];
    if (!v) continue;
    if (v < rec.starts_on || (rec.ends_on && v > rec.ends_on)) {
      err.textContent = `${label} has to fall inside the trial (${fmtDay(rec.starts_on)} – ${rec.ends_on ? fmtDay(rec.ends_on) : 'ongoing'}).`;
      return;
    }
  }
  if (rec.checkin_on && rec.decision_on && rec.decision_on < rec.checkin_on) {
    err.textContent = 'The decision comes after the check-in.'; return;
  }
  // A ballot that isn't a form link is a typo, and the nudges would send the
  // house somewhere that isn't the ballot.
  for (const [field, label] of [['checkin_form_url', 'Check-in'], ['decision_form_url', 'Decision']]) {
    const v = rec[field];
    if (v && !/^https:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/.test(v)) {
      err.textContent = `${label} ballot has to be a Google Form link.`; return;
    }
  }
  // A moved milestone is a new milestone — let its reminder fire again.
  const prev = stays.find(s => s.id === id);
  if (prev && prev.checkin_on !== rec.checkin_on) rec.checkin_reminded_at = null;
  if (prev && prev.decision_on !== rec.decision_on) rec.decision_reminded_at = null;
  if (id === 'new') {
    const { data, error } = await sb.from('recruit_stays').insert(rec).select().single();
    if (error) { err.textContent = error.message; return; }
    stays.push(data);
  } else {
    const { error } = await sb.from('recruit_stays').update({ ...rec, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { err.textContent = error.message; return; }
    Object.assign(stays.find(s => s.id === id) || {}, rec);
  }
  err.textContent = '';
  return true;
}

/* --- autosave ---
   A field commits on `change`, which for text fires when it loses focus and
   for dates/selects the moment the value settles. Nothing is repainted except
   the one lane and the drawer's own subtitle, so focus and caret survive.
   Creation is the exception: a record that doesn't exist yet can't autosave,
   so a new stay keeps an explicit "Add stay". */
let staySavedTimer = null;

async function autoSaveStay(form) {
  if (form.dataset.stayForm === 'new') return;
  const ok = await writeStayForm(form);
  if (!ok) return;
  const roomId = +form.dataset.stayRoom;
  refreshLane(roomId);
  refreshOccupants();
  refreshDrawerSub();
  const flag = form.querySelector('[data-save-flag]');
  if (flag) {
    flag.textContent = 'Saved';
    flag.classList.add('is-on');
    clearTimeout(staySavedTimer);
    staySavedTimer = setTimeout(() => {
      flag.classList.remove('is-on');
    }, 2200);
  }
}

/* Repaint one room's bars in place. The whole-view render would rebuild the
   drawer and throw away whatever the cursor was in. */
function refreshLane(roomId) {
  const lane = document.querySelector(`[data-lane-room="${roomId}"]`);
  const r = rooms.find(x => x.id === roomId);
  if (lane && r) lane.innerHTML = laneBarsHtml(r);
}

function refreshOccupants() {
  const host = document.querySelector('.occupants');
  if (!host) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = occupantsHtml();
  const next = wrap.firstElementChild;
  if (next) host.replaceWith(next);
}

/* The subtitle carries the stay's dates, so it goes stale the moment one changes. */
function refreshDrawerSub() {
  if (occDrawer?.type !== 'stay') return;
  const s = stays.find(x => x.id === occDrawer.id);
  const el = document.querySelector('.occ-drawer__sub');
  if (!s || !el) return;
  const room = rooms.find(r => r.id === s.room_id);
  el.textContent = `${room?.name || 'Room'} · ${KIND_LABELS[s.kind]} · ${fmtShort(s.starts_on)} – ${s.ends_on ? fmtShort(s.ends_on) : 'ongoing'}`;
}

/* Submit means "I'm done here": the Add-stay button on a new record, or Enter
   in a field on an existing one. Either way, write and close. */
async function onStayFormSubmit(e) {
  e.preventDefault();
  const ok = await writeStayForm(e.target);
  if (!ok) return;
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

/* " · decision Oct 1" — the next unmet trial milestone, or nothing. */
function nextMilestoneLabel(s, todayIso) {
  if (s.kind !== 'candidate') return '';
  const next = [['check-in', s.checkin_on], ['decision', s.decision_on]]
    .filter(([, d]) => d && d >= todayIso).sort((a, b) => a[1].localeCompare(b[1]))[0];
  return next ? ` · ${next[0]} ${fmtShort(next[1])}` : '';
}

/* --- current + past occupants --- */
/* Open listings, on the page that shows who is in the house. The calendar says
   a stretch is listed; this says what the listing actually offers and how many
   candidates are sitting in it — the two questions the badge can't answer. */
function occListingsHtml() {
  const open = listings.filter(l => l.status === 'open')
    .slice().sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  if (!open.length) return '';
  const roomById = Object.fromEntries(rooms.map(r => [r.id, r]));
  const money = n => n != null && n !== '' ? '$' + Number(n).toLocaleString('en-US') : null;
  return `
    <section class="inbox-group occ-listings">
      <div class="inbox-group__head">
        <h2 class="inbox-group__label">Open listings</h2>
        <span class="inbox-group__count">${open.length} live</span>
      </div>
      <ul class="inbox-card">
        ${open.map(l => {
          const room = roomById[l.room_id];
          const placed = placements.filter(p => p.listing_id === l.id && p.status === 'active').length;
          const rent = money(l.rent_monthly ?? room?.rent_monthly);
          return `<li class="inbox-row">
            <span class="inbox-row__text">
              <span class="inbox-row__title">${esc(room?.name || 'Room')}</span>
              <span class="inbox-row__sub">${esc(listingWindow(l))}${rent ? ` · ${rent}/mo` : ''}${
                l.source === 'gap' ? ' · from the calendar' : ''}</span>
            </span>
            <span class="inbox-row__actions">
              <span class="link-chip">${placed} candidate${placed === 1 ? '' : 's'}</span>
              <span class="listing-kind listing-kind--${l.kind === 'resident' ? 'trial' : 'sublet'}">${
                l.kind === 'resident' ? 'Resident trial' : 'Sublet'}</span>
              <button class="btn btn--sm" data-edit-listing="${l.id}">Edit</button>
            </span>
          </li>`;
        }).join('')}
      </ul>
    </section>`;
}

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
              <span class="inbox-row__sub">${esc(room?.name || '')} · ${esc(room?.floor || '')} · ${s.ends_on ? `through ${fmtShort(s.ends_on)}` : 'ongoing'}${esc(nextMilestoneLabel(s, todayIso))}</span>
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
  // The date is the first thing anyone needs from a listing — it decides who
  // qualifies — so it leads and it's emphasised.
  if (l.kind === 'resident') {
    bits.push(`<b class="listing-when">Opens ${fmtDay(l.starts_on)}</b>`);
  } else {
    bits.push(l.ends_on
      ? `<b class="listing-when">${fmtDay(l.starts_on)} – ${fmtDay(l.ends_on)}</b>`
      : `<b class="listing-when">From ${fmtDay(l.starts_on)}</b> · end date TBD`);
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
      <button type="button" class="listing-menu__item" data-edit-listing="${l.id}">Edit</button>
      ${l.status === 'open'
        ? `<button type="button" class="listing-menu__item" data-set-status="${l.id}|filled">Mark filled</button>
           <button type="button" class="listing-menu__item" data-set-status="${l.id}|closed">Close listing</button>`
        : `<button type="button" class="listing-menu__item" data-set-status="${l.id}|open">Reopen</button>`}
    </span>
  </span>`;
}

/* Everyone still in play for this listing who isn't on the active shortlist.
   Two groups, in this order:
     1. moved forward — reviewed, passed, and a recruiter can add them now
     2. not reviewed yet — the dates fit, nobody has read them
   Anyone archived is excluded outright, and so is anyone reviewed but not
   moved forward: a "needs input" verdict is a question, not a shortlist. */
function otherQualified(listingId) {
  const l = listings.find(x => x.id === listingId);
  if (!l) return [];
  const placed = new Set(placements.filter(p => p.listing_id === listingId && p.status === 'active').map(p => p.applicant_id));
  const forward = [], unread = [];
  for (const a of applicants) {
    if (placed.has(a.id) || a.exitReason) continue;
    if (!qualifiesFor(a, l)) continue;
    if (a.stage === 'candidate') forward.push(a);
    else if (a.stage === 'review' && !voteStats(a.id).n) unread.push(a);
  }
  return [...forward, ...unread];
}

/* A listing named the way a housemate would say it: the room, or "a listing"
   when the house data hasn't loaded yet. Used by the profile event sentences,
   which must never show a uuid. */
function listingLabel(listingId) {
  const l = listings.find(x => x.id === listingId);
  const room = l && rooms.find(r => r.id === l.room_id);
  return room?.name ? `the ${room.name} listing` : 'a listing';
}

function listingWindow(l) {
  const len = windowLength(l.starts_on, l.ends_on);
  if (l.kind === 'resident') {
    const months = setting('trial_length_months');
    return `Trial ${fmtDay(l.starts_on)} – ${fmtDay(addMonthsIso2(l.starts_on, months))} · ${months}-month trial, then a review`;
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
        <input type="date" name="ends_on" class="listing-status" value="${l.ends_on || ''}"
          min="${l.starts_on || ''}" ${l.kind === 'resident' ? 'disabled title="Resident trials have no sublet end date"' : ''}>
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
    <div class="drawer-cta">
      ${isNew ? `<div class="drawer-cta__row">
        <button type="button" class="drawer-cta__quiet" data-cancel-listing>Cancel</button>
        <button type="submit" class="btn btn--accent drawer-cta__commit">Create listing</button>
      </div>` : `<p class="drawer-cta__flag" data-save-flag></p>
      <div class="drawer-cta__exits">
        <button type="button" class="drawer-cta__exit drawer-cta__exit--danger" data-delete-listing="${l.id}">
          <span class="drawer-cta__exit-label">Delete listing</span>
          <span class="drawer-cta__exit-icon" aria-hidden="true">&times;</span>
          <span class="drawer-cta__exit-hint">removes it and unplaces its candidates</span>
        </button>
      </div>`}
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
  const lform = body.querySelector('[data-listing-form]');
  lform.addEventListener('submit', onListingCreate);
  if (lform.dataset.listingForm !== 'new') {
    lform.addEventListener('change', e => autoSaveListing(lform, e.target.name));
  }
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

/* Validate + write only. Shared by the autosave path and the create button so
   the two can't drift apart on validation. */
async function writeListingForm(form) {
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
  } else {
    const { error } = await sb.from('recruit_listings').update(rec).eq('id', id);
    if (error) { err.textContent = error.message; return; }
    Object.assign(listings.find(l => l.id === id) || {}, rec);
  }
  err.textContent = '';
  return true;
}

async function onListingCreate(e) {
  e.preventDefault();
  if (!await writeListingForm(e.target)) return;
  rerenderAfterListingChange();
}

/* Autosave an existing listing: write, then refresh the views behind the modal
   without closing it. A status change can pick up or drop auto-placements, so
   that sync still has to run. */
let listingSavedTimer = null;
/* Fields that can change who qualifies for this listing. Editing the notes
   shouldn't cost an auto-placement round trip. */
const PLACEMENT_FIELDS = new Set(['room_id', 'kind', 'starts_on', 'ends_on', 'status']);
async function autoSaveListing(form, changed) {
  if (form.dataset.listingForm === 'new') return;
  if (!await writeListingForm(form)) return;
  const flag = form.querySelector('[data-save-flag]');
  if (flag) {
    flag.textContent = 'Saved';
    flag.classList.add('is-on');
    clearTimeout(listingSavedTimer);
    listingSavedTimer = setTimeout(() => {
      flag.classList.remove('is-on');
    }, 2200);
  }
  if (!PLACEMENT_FIELDS.has(changed)) return;
  const added = await syncAutoPlacements();
  renderRailCounts();
  if (view === 'openings') renderApplicants();
  else if (view === 'occupancy') renderOccupancy();
  if (added) toast(`${added} candidate${added === 1 ? '' : 's'} auto-placed`);
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

/* Marking filled or closing is a real state change with an audience — the
   auto-placement sweep stops feeding it — so it confirms, then closes the
   drawer rather than leaving a dead listing open on screen. */
async function setListingStatusFromDrawer(id, status) {
  const l = listings.find(x => x.id === id);
  if (!l) return;
  const room = rooms.find(r => r.id === l.room_id);
  const placed = placements.filter(p => p.listing_id === id && p.status === 'active').length;
  const what = status === 'filled' ? 'Mark filled' : 'Close';
  const tail = placed ? ` ${placed} candidate${placed === 1 ? '' : 's'} stop being placed in it.` : '';
  if (!confirm(`${what} the ${l.kind === 'resident' ? 'resident trial' : 'sublet'} listing for ${room?.name || 'this room'}?${tail}`)) return;
  occDrawer = null;
  await updateListingStatus(id, status);
  toast(status === 'filled' ? 'Listing marked filled' : 'Listing closed');
}

async function updateListingStatus(id, status) {
  const l = listings.find(x => x.id === id);
  if (!l) return;
  const prev = l.status;
  l.status = status;
  const { error } = await sb.from('recruit_listings').update({ status }).eq('id', id);
  if (error) { l.status = prev; toast(`Update failed: ${error.message}`); rerenderAfterListingChange(); return; }
  // Opening a draft is the answer to both draft nudges; taking it off the market
  // answers everything that was chasing the room.
  if (prev === 'draft' && status === 'open') {
    ackFor('listing', id, ['listing_draft', 'listing_draft_stale']);
  }
  if (status === 'filled' || status === 'closed') {
    ackFor('listing', id, ['listing_draft', 'listing_draft_stale', 'listing_no_qualifiers',
      'opening_at_risk', 'opening_overdue', 'listing_has_candidates']);
  }
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
  noteDraft = { id, text: '' };
  reviewTab = 'profile';
  pendingVerdict = null;
  moveinEditing = false;
  phoneEditing = false;
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
  hideReviewBanner();
  gpSyncPlacement(); // a playing call follows you out to the list
  const url = new URL(location); url.searchParams.delete('a');
  history.replaceState(null, '', url);
  render();
}

/* One line of "what just happened" that survives auto-advance. Carries the way
   back, since undoing a decision you made a second ago shouldn't mean hunting
   through Archive for the person. */
let bannerTimer = null;
let keepBannerOnce = false;   // set when the banner explains the step we're taking
let justPromoted = null;      // applicant whose foot bar should announce the promotion
function showReviewBanner(html) {
  const el = document.getElementById('review-banner');
  if (!el) return;
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, 12000);
}
function hideReviewBanner() {
  clearTimeout(bannerTimer);
  const el = document.getElementById('review-banner');
  if (el) { el.hidden = true; el.innerHTML = ''; }
}

function step(delta) {
  const next = qIndex + delta;
  if (next < 0 || next >= queue.length) { if (delta > 0) closeReview(); return; }
  qIndex = next;
  pendingVerdict = null;
  noteDraft = { id: queue[next], text: '' };
  moveinEditing = false;
  phoneEditing = false;
  if (!keepBannerOnce) hideReviewBanner();
  keepBannerOnce = false;
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

  /* One bar for a closed application, not two.

     There used to be a banner at the top saying why it closed and a separate
     action bar at the bottom offering to reopen it — the same subject split
     across two places, so you read the reason in one and acted in the other.
     Now it is a single bar: what happened, who decided and why in their own
     words, and the one action that undoes it.

     Colour carries the kind of closure, because "we said no" and "they said no"
     and "not right now" are three different things and the reader should know
     which before reading a word. */
  const closedTone = () => {
    if (isAutoDecision(rec)) return 'rule';                    // a house rule, nobody's judgement
    if (a.exitReason === 'opted_out') return 'theirs';         // they withdrew
    if (a.exitReason === 'future') return 'later';             // right person, wrong time
    if (a.exitReason === 'trial_ended') return 'trial';        // we lived together; it didn't work
    return 'ours';                                             // the house passed
  };
  const CLOSED_HEAD = {
    ours:  'This application is closed',
    rule:  'Closed by a house rule',
    theirs:'They withdrew',
    later: 'Saved for later',
    trial: 'The trial ended',
  };

  const closedBar = () => {
    const st = voteStats(a.id);
    const tone = closedTone();
    // The reason, in the words of whoever gave it — a reviewer's comment first,
    // then a recruiter's note, then the structured reason as a last resort.
    const v = st.notFit;
    const quote = v?.note || rec?.note || '';
    const by = v ? reviewerName(v) : rec?.byName || '';
    const fallback = rec?.reason ? reasonLabel(rec.reason)
      : isAutoDecision(rec) ? 'A house rule closed it'
      : 'No reason recorded';
    const sub = quote
      ? `${quote}${by ? ` — ${by}` : ''}`
      : `${fallback}${by ? ` — ${by}` : ''}`;
    return `<div class="closed-bar closed-bar--${tone}">
      <div class="closed-bar__text">
        <span class="closed-bar__head">${CLOSED_HEAD[tone]}</span>
        <span class="closed-bar__sub">${esc(sub)}</span>
      </div>
      <span class="closed-bar__actions">
        <button type="button" class="closed-bar__reopen" data-reopen="${a.id}">Reopen</button>
      </span>
    </div>`;
  };

  document.getElementById('review-body').innerHTML = `
    ${archived ? closedBar() : ''}
    <div class="review__card">
      <div class="review__head">
        ${avatarHtml(a, true)}
        <div class="review__head-text">
          <h2 class="review__title">${esc(fullName(a))}${a.pronouns ? ` <span class="review__pronouns">${esc(a.pronouns)}</span>` : ''}</h2>
          <p class="review__meta"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a></p>
          <div class="review__badges">
            <span class="review__badge review__badge--track">${trackLabel(a)}</span>
            ${a.origin === 'native' ? '<span class="review__badge" title="Applied through ctrl.rodeo/apply — they can edit their answers until a decision">native</span>' : ''}
          </div>
          <div class="review__facts">
            <div class="review__fact"><span class="review__fact-label">Move-in</span>${moveInFactHtml(a, miNorm)}</div>
            <div class="review__fact"><span class="review__fact-label">Budget</span><span class="review__fact-value">${esc(buNorm || a.budget || '—')} ${infoDot(a.budget, buNorm)}</span></div>
            <div class="review__fact"><span class="review__fact-label">Phone</span>${phoneFactHtml(a)}</div>
            ${a.source ? `<div class="review__fact"><span class="review__fact-label">Via</span><span class="review__fact-value review__fact-value--quiet">${esc(a.source)}</span></div>` : ''}
            <div class="review__fact"><span class="review__fact-label">Applied</span><span class="review__fact-value">${new Date(a.ts_iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}${a.updatedAt && (new Date(a.updatedAt) - new Date(a.ts_iso)) > 3600e3 ? ` <span class="review__fact-value--quiet" title="They edited their application on /apply">· updated ${relTime(a.updatedAt)}</span>` : ''}</span></div>
            ${linksHtml ? `<div class="review__fact"><span class="review__fact-label">Links</span>${linksHtml}</div>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div class="review-tabs">
      <button class="review-tabs__tab ${reviewTab === 'profile' ? 'is-on' : ''}" data-review-tab="profile">Profile</button>
      <button class="review-tabs__tab ${reviewTab === 'emails' ? 'is-on' : ''}" data-review-tab="emails">Emails${(emailsCache[a.id] || []).length ? ` (${emailsCache[a.id].length})` : ''}</button>
      ${(screeningState[a.id]?.watch || screeningState[a.id]?.at || screeningState[a.id]?.done) ? `<button class="review-tabs__tab ${reviewTab === 'call' ? 'is-on' : ''}" data-review-tab="call">Call</button>` : ''}
      <button class="review-tabs__tab ${reviewTab === 'activity' ? 'is-on' : ''}" data-review-tab="activity">Activity</button>
    </div>
    ${reviewTab === 'emails' ? `<div id="emails-panel"><p class="notes__empty">Loading emails…</p></div>` : reviewTab === 'call' ? `<div id="call-panel"><p class="notes__empty">Loading the call…</p></div>` : reviewTab === 'activity' ? `<div id="activity-panel"><p class="notes__empty">Loading their history…</p></div>` : `
    ${voteSectionHtml(a)}
    ${section('About them', a.about)}
    ${section('Why Agape', a.why)}
    ${section('Gifts to share', a.gifts)}
    ${section('Community', a.community)}
    ${section('Anything else', a.anythingElse)}
    ${stagesHtml(a)}
    ${availabilityHtml(a)}
    ${houseEventsHtml(a)}
    <section class="review__section notes" id="notes">
      <div class="notes__head">
        <h3 class="review__section-title">House notes</h3>
        <button type="button" class="btn btn--sm" id="second-opinion" data-second-opinion="${a.id}">AI read</button>
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
  else if (reviewTab === 'activity') loadProfileActivity(a);
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
      <input type="date" class="listing-status movein-set__input" id="movein-to" value="${esc(a.moveinTo || '')}"
        min="${esc(a.moveinFrom || '')}" ${a.moveinFrom ? '' : 'disabled'}
        aria-label="Through (optional)" title="Through — leave empty for open-ended. Wakes up once move-in is set.">
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
  if (!error) {
    const who = applicants.find(x => x.id === id);
    logEvent('event_move_in', id, who ? fullName(who) : '',
      from ? `${me.name || 'A housemate'} confirmed {} can move in ${fmtShort(from)}${to && to !== from ? ` to ${fmtShort(to)}` : ''}.`
           : `${me.name || 'A housemate'} cleared {}'s confirmed move-in window.`);
  }
  if (error) { toast(`Save failed: ${error.message}`); return; }
  a.moveinFrom = from; a.moveinTo = to; a.moveinSetBy = from ? me.name : null;
  moveinEditing = false;
  if (!houseLoaded) await loadHouse();
  await syncAutoPlacements(); // dates changed — placements reshuffle to match
  toast(from ? `Move-in confirmed: ${confirmedMoveIn(a)} — placements updated` : 'Confirmed date cleared — back to their stated answer');
  renderRailCounts();
  renderReview();
}

/* ---------- phone field ----------
   The form doesn't reliably ask for a number, so the profile is where one
   lands — typed in by whoever got it (usually over email, before a tour).
   Same quiet ✎ as the move-in fact; recruit_applicants is client-read-only,
   so the save goes through the recruit_update_profile RPC. */
let phoneEditing = false;

function phoneFactHtml(a) {
  if (phoneEditing) {
    return `<span class="movein-set movein-set--form">
      <input type="tel" class="listing-status movein-set__input" id="phone-input" value="${esc(a.phone || '')}"
        maxlength="40" placeholder="e.g. (415) 555-0123" aria-label="Phone number">
      <button type="button" class="btn btn--sm btn--accent" data-phone-save>Save</button>
      <button type="button" class="hold-sheet__cancel movein-set__cancel" data-phone-cancel>Cancel</button>
    </span>`;
  }
  const sms = (a.phone || '').replace(/[^+\d]/g, '');
  const shown = a.phone
    ? `<a href="sms:${esc(sms)}" title="Text them">${esc(a.phone)}</a>`
    : '—';
  return `<span class="review__fact-value">${shown}
    <button type="button" class="fact-edit" data-phone-edit title="${a.phone ? 'Edit their number' : 'Add their number'}" aria-label="Edit phone number">✎</button>
  </span>`;
}

async function savePhone(id) {
  const a = applicants.find(x => x.id === id);
  if (!a) return;
  const phone = (document.getElementById('phone-input')?.value || '').trim();
  const { error } = await sb.rpc('recruit_update_profile', { p_applicant: id, p_phone: phone });
  if (error) { toast(`Save failed: ${error.message}`); return; }
  const had = Boolean(a.phone);
  a.phone = phone;
  phoneEditing = false;
  if (phone && !had) {
    logEvent('event_phone', id, fullName(a), `${me.name || 'A housemate'} added {}'s phone number.`);
  }
  toast(phone ? 'Phone saved' : 'Phone cleared');
  renderReview();
}

/* Reviews in the review body. Every review carries its comment, so this reads
   as a short thread rather than a tally. */
function voteSectionHtml(a) {
  const st = voteStats(a.id);
  if (!st.n) {
    return a.stage === 'review'
      ? `<section class="review__section notes">
           <div class="notes__head"><h3 class="review__section-title">Reviews</h3></div>
           <p class="notes__empty">No review yet — yours decides.</p>
         </section>`
      : '';
  }
  const rows = st.list.map(v => {
    const badge = VERDICTS[v.verdict]
      ? `<span class="verdict-tag ${VERDICTS[v.verdict].cls}">${VERDICTS[v.verdict].label}</span>`
      : (v.veto ? '<span class="verdict-tag is-not-fit">Not a fit</span>' : '');
    return `<li class="note">
      <span class="avatar">${esc(reviewerName(v)[0].toUpperCase())}</span>
      <div class="note__body-wrap">
        <div class="note__meta">
          <span class="note__author">${esc(reviewerName(v))}</span>
          <span class="note__time">${badge} · ${relTime(v.updated_at || v.created_at)}${v.voter_email && !v.voter_id ? ' · from the application sheet' : ''}</span>
        </div>
        ${v.note ? `<p class="note__body">${esc(v.note)}</p>` : ''}
      </div>
    </li>`;
  }).join('');
  return `<section class="review__section notes">
    <div class="notes__head"><h3 class="review__section-title">Reviews</h3></div>
    <ul class="notes__list">${rows}</ul>
  </section>`;
}

/* The house reaches ONE decision about a candidate; housemates weigh in on it.
   The old copy counted "3 decisions in", which read as three separate verdicts
   needing a quorum — the opposite of how this works. */
/* Contextual footer: vote bar in review, recruiter actions for candidates,
   reopen for archived. */
function renderReviewFoot(a) {
  const foot = document.getElementById('review-foot');
  if (!foot) return;
  // In-progress typing survives a re-render of the bar, but only for the
  // applicant it was typed about — carrying it to the next person would put
  // your words on the wrong profile. The capture is keyed on who the bar in
  // the DOM was rendered for, not on who we're about to render: on an advance
  // those differ, and that gap is exactly where the text used to leak.
  const liveNote = document.getElementById('vote-note');
  if (liveNote && footFor === a.id) noteDraft = { id: a.id, text: liveNote.value };
  const keepNote = noteDraft.id === a.id ? noteDraft.text : null;
  // Fresh off a forward verdict: the candidate bar that replaces the vote bar
  // names the change before offering its new actions, so the swap reads as a
  // promotion rather than a glitch.
  const promoted = justPromoted === a.id && a.stage === 'candidate';
  justPromoted = null;
  foot.classList.toggle('is-promoted', promoted);
  if (a.stage === 'review') {
    const mine = myVote(a.id);
    const sel = pendingVerdict || mine?.verdict || null;
    // Select-then-confirm: picking a verdict arms the bar, the comment is
    // required, and the confirm button names what will happen.
    const confirmLabel = sel === 'not_fit' ? 'Archive them'
      : sel === 'forward' ? 'Move forward'
      : sel === 'needs_input' ? 'Ask for another read'
      : 'Save review';
    foot.innerHTML = `
      <div class="vote-bar">
        <span class="vote-bar__q">Would you live with them?</span>
        <span class="vote-bar__verdicts">
          ${Object.entries(VERDICTS).map(([k, v]) =>
            `<button type="button" class="vote-bar__verdict ${v.cls} ${sel === k ? 'is-on' : ''}" data-verdict="${k}" title="${esc(v.title)}">${v.label}</button>`).join('')}
        </span>
        <input type="text" class="listing-status vote-bar__note" id="vote-note" maxlength="500"
          placeholder="Your comment (required)"
          value="${esc(keepNote ?? mine?.note ?? '')}">
        <button type="button" class="btn btn--accent vote-bar__cast" data-cast-vote ${sel ? '' : 'disabled'}>${confirmLabel}</button>
      </div>
      ${liveStayFor(a.id) ? '' : `<span class="foot-links"><button type="button" class="cta-link" data-book-in="${a.id}" title="Skips the funnel — books a room and records the accept in one step">Set their move-in…</button></span>`}`;
    footFor = a.id;
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
          <button type="button" class="cta-link" data-bring-back="${a.id}">Bring back</button>
          ${liveStayFor(a.id) ? '' : `<button type="button" class="cta-link" data-book-in="${a.id}">Set their move-in…</button>`}
          <button type="button" class="cta-link cta-link--danger" data-open-remove="${a.id}|">Remove…</button>
        </span>`;
    } else {
      // Mid-trial, the question stops being "which listing?" and becomes
      // "do they stay?". Promotion takes over the primary slot; the listing
      // controls stay available behind it.
      const trial = trialStayFor(a.id);
      foot.innerHTML = `
        ${promoted ? `<span class="verdict-tag is-forward foot-promoted">Now a candidate</span>` : ''}
        ${pills ? `<span class="foot-pills">${pills}</span>` : ''}
        <span class="foot-cta">${trial
          ? `<button class="btn btn--accent review__btn" data-promote-applicant="${a.id}">Change to resident</button>`
          : openingsCta(a)}</span>
        <span class="foot-links">
          ${trial ? '' : `<button type="button" class="cta-link" data-open-decision="outreach">${activePlacements(a.id).length ? 'Move to a different listing' : 'Add to a listing'}</button>`}
          ${liveStayFor(a.id) ? '' : `<button type="button" class="cta-link" data-book-in="${a.id}">Set their move-in…</button>`}
          <button type="button" class="cta-link cta-link--danger" data-open-remove="${a.id}|">Remove…</button>
        </span>`;
    }
  } else {
    /* Closed. Everything this bar used to offer — reopen, and the optional
       update email — now lives in the closed-bar at the top of the profile,
       next to the reason it closed. Two bars about one subject meant reading the
       verdict in one place and acting in another. */
    foot.innerHTML = '';
    foot.hidden = true;
    return;
  }
  foot.hidden = false;
}

async function reopenApplicant(id) {
  const a = applicants.find(x => x.id === id);
  if (!a) return;
  // A decisive verdict is what put them here, so reopening has to soften it —
  // otherwise the trigger sends them straight back. The comment survives: it
  // becomes a "needs input" note, which is what reopening actually means.
  const st0 = voteStats(id);
  if (st0.decisive) {
    const { error } = await sb.from('recruit_votes')
      .update({ verdict: 'needs_input', updated_at: new Date().toISOString() })
      .eq('applicant_id', id).in('verdict', ['not_fit', 'forward']);
    if (error) { toast(`Couldn't reopen: ${error.message}`); return; }
    votes[id] = (votes[id] || []).map(v =>
      v.verdict === 'not_fit' || v.verdict === 'forward' ? { ...v, verdict: 'needs_input' } : v);
  }
  if (await setStage(id, 'review')) {
    hideReviewBanner();
    toast(st0.decisive
      ? `Reopened — ${reviewerName(st0.decisive)}'s comment is kept as needing input`
      : 'Reopened — back in Applicants');
    renderRailCounts();
    if (!document.getElementById('review').hidden) renderReview(); else render();
  }
}

/* ---------- manual add ----------
   Referrals, friends of the house, people met at dinners — anyone who never
   touched the application form. recruit_applicants is client-read-only, so
   the insert goes through the recruit_add_applicant RPC (migration 166),
   which also owns id minting and the duplicate-email guard. */
function openAddPerson(stage) {
  ['add-first', 'add-last', 'add-email', 'add-phone', 'add-movein', 'add-budget', 'add-source', 'add-about']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('add-stage').value = stage === 'candidate' ? 'candidate' : 'review';
  document.getElementById('add-status').textContent = '';
  document.getElementById('add-modal').hidden = false;
  document.getElementById('add-first').focus();
}

function closeAddPerson() { document.getElementById('add-modal').hidden = true; }

async function submitAddPerson(btn) {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const first = val('add-first'), last = val('add-last'), email = val('add-email');
  const status = document.getElementById('add-status');
  if (!first) { status.textContent = 'A first name is required.'; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { status.textContent = 'A real email is required — it\'s how the funnel reaches them.'; return; }
  const stage = val('add-stage') === 'candidate' ? 'candidate' : 'review';
  btn.disabled = true;
  status.textContent = 'Adding…';
  const { data: id, error } = await sb.rpc('recruit_add_applicant', {
    p_first: first, p_email: email, p_last: last, p_stage: stage,
    p_residency: val('add-track'), p_move_in: val('add-movein'),
    p_budget: val('add-budget'), p_source: val('add-source'), p_about: val('add-about'),
    p_phone: val('add-phone'),
  });
  btn.disabled = false;
  if (error) { status.textContent = `Couldn't add them: ${error.message}`; return; }
  const a = {
    id, ts_iso: new Date().toISOString(), first, last, pronouns: '',
    email, phone: val('add-phone'), social: '', about: val('add-about'), why: '', gifts: '',
    source: val('add-source'), residency: val('add-track'),
    movein: val('add-movein'), budget: val('add-budget'), avatarUrl: null,
    stage, moveinFrom: null, moveinTo: null, moveinSetBy: null,
    updateSentAt: null, updateSkippedAt: null,
    exitReason: null, exitUntil: null, exitNote: '', exitBy: null,
  };
  applicants.unshift(a);
  logEvent('event_added', id, fullName(a),
    `${me.name || 'A housemate'} added {} by hand, straight to ${stage === 'candidate' ? 'Candidates' : 'Applicants'}.`,
    val('add-source') || null);
  if (stage === 'candidate') {
    if (!houseLoaded) await loadHouse();
    await syncAutoPlacements();
  }
  closeAddPerson();
  renderRailCounts();
  render();
  toast(`${fullName(a)} added to ${stage === 'candidate' ? 'Candidates' : 'Applicants'}`);
  openReview(id);
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
          <span class="note__time">${relTime(c.created_at)}${c.source === 'sheet' ? ' · from the application sheet' : c.source === 'discord' ? ' · replied in Discord' : ''}</span>
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
  const who = applicants.find(x => x.id === applicantId);
  logEvent('event_comment', applicantId, who ? fullName(who) : '',
    `${me?.name || 'A housemate'} left a note on {}.`, body.slice(0, 140));
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
/* Bodies stored before the UTF-8 decode fix carry mojibake — UTF-8 bytes
   read as Latin-1 ("â€™" for a curly quote). The tell is unmistakable in
   English text, so re-decode when it's present; new rows come in clean. */
function demojibake(s) {
  let out = String(s || '');
  for (let i = 0; i < 2 && /â€|Ã[-¿©®±¼½¾]|Â[ -¿]/.test(out); i++) {
    try { out = decodeURIComponent(escape(out)); } catch { break; }
  }
  return out;
}

/* Reader view of a message body: fix legacy mojibake, drop the quoted
   history (the thread renders it as its own rows), and tighten whitespace. */
function cleanEmailBody(text) {
  let t = demojibake(text).replace(/\r\n/g, '\n');
  const cut = t.search(/\n\s*(On .{5,120} wrote:|-{2,}\s?(Original|Forwarded) message|From: .+\n(Sent|Date): )/i);
  if (cut > 40) t = t.slice(0, cut);
  t = t.split('\n').filter(line => !/^\s*>/.test(line)).join('\n');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* Each row expands in place to the full message body. */
function emailRow(m) {
  const arrow = m.direction === 'out' ? '↗' : '↙';
  const who = m.direction === 'out' ? `Agape${m.sent_by_name ? ` (${esc(m.sent_by_name)})` : ''}` : esc(m.from_email.replace(/<.*>/, '').trim() || m.from_email);
  const body = cleanEmailBody(m.body_text || '');
  return `<li class="email-row email-row--${m.direction}">
    <button type="button" class="email-row__head" data-email-toggle aria-expanded="false" ${body ? '' : 'disabled title="No text body stored for this message"'}>
      <span class="email-row__dir" title="${m.direction === 'out' ? 'Sent by the house' : 'Received'}">${arrow}</span>
      <span class="inbox-row__text">
        <span class="inbox-row__title">${esc(demojibake(m.subject) || '(no subject)')}</span>
        <span class="inbox-row__sub">${who} · ${new Date(m.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}${m.snippet ? ` — ${esc(demojibake(m.snippet).slice(0, 110))}` : ''}</span>
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
  // ALWAYS repaint after the sync, not just when the count changed: loadAll
  // hydrates the cache without body_text (the heavy column), so the first
  // paint renders every row as an un-expandable disabled button. The sync
  // returns full rows — same list, now tappable — and "nothing new synced"
  // used to skip exactly that repaint, which is why taps did nothing on a
  // fresh phone load.
  syncEmails(a.id).then(() => {
    if (queue[qIndex] === a.id && reviewTab === 'emails' && host()) paintEmailsPanel(a, '');
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

/* The two things that have to happen to a candidate, always on screen.

   Before this, an intro call and a house visit only appeared once one existed —
   a screening card if booked, a calendar row if visited, nothing at all
   otherwise. So "has nobody booked her call, or did I just miss it?" could only
   be answered by reading the whole profile and inferring from absence, and
   absence looks identical to a rendering bug.

   Now both stages are permanent rows with an explicit state. Not scheduled is a
   state, and the row says so and offers the way to fix it. */
const STAGE_STATE = {
  none:      { label: 'Not scheduled', cls: 'is-none' },
  scheduled: { label: 'Scheduled',     cls: 'is-scheduled' },
  done:      { label: 'Completed',     cls: 'is-done' },
};

function stageRow(kind, opts) {
  const st = STAGE_STATE[opts.state];
  return `<div class="stage-row stage-row--${st.cls}">
    <span class="stage-row__what">${esc(kind)}</span>
    <span class="stage-chip stage-chip--${st.cls}">${st.label}</span>
    <span class="stage-row__detail">${opts.detail || ''}</span>
    <span class="stage-row__action">${opts.action || ''}</span>
  </div>`;
}

function stagesHtml(a) {
  const sc = screeningState[a.id] || {};

  /* The intro call. "Completed" wins over "scheduled" when both exist, because
     a second call booked after the first is the exception and the first one
     having happened is the fact that matters most. */
  let callState = 'none', callDetail = '', callAction = '';
  if (sc.done) {
    callState = 'done';
    callDetail = `${esc(fmtSlot(sc.doneAt))}${sc.with && !/calendar|the house/i.test(sc.with) ? ` · ${esc(sc.with)}` : ''}`;
    callAction = sc.watch
      ? `<button type="button" class="cta-link" data-play-mini="${a.id}">Watch</button>`
      : sc.awaiting ? '<span class="stage-row__muted">recording on the way</span>' : '';
  } else if (sc.at) {
    callState = 'scheduled';
    callDetail = `${esc(fmtSlot(sc.at))}${sc.with && !/calendar|the house/i.test(sc.with) ? ` · ${esc(sc.with)}` : ''}`;
    callAction = sc.link ? `<a class="cta-link" href="${esc(sc.link)}" target="_blank" rel="noopener">Join</a>` : '';
  } else {
    // Availability already in hand is the difference between "ask them" and
    // "somebody take this" — the two have completely different next actions.
    const hasTimes = (availCache[a.id]?.windows || []).length > 0;
    callDetail = hasTimes ? 'they sent times, nobody has taken it' : 'no times offered yet';
    callAction = `<button type="button" class="cta-link" data-email="${a.id}" data-email-kind="${hasTimes ? 'schedule' : 'availability'}">${hasTimes ? 'Book it' : 'Ask for times'}</button>
      <button type="button" class="cta-link" data-set-time="${a.id}|call">Set a time</button>`;
  }

  // The house visit. Read from the calendar rather than screenings — a visit is
  // an event the house holds, not a call somebody claims.
  const visits = (houseEvents[a.id] || []).filter(e => e.kind === 'visit');
  const past = visits.filter(e => new Date(e.ends_at || e.starts_at) < new Date());
  const upcoming = visits.filter(e => new Date(e.ends_at || e.starts_at) >= new Date());
  let visitState = 'none', visitDetail = '', visitAction = '';
  const tour = tourState[a.id];
  if (past.length) {
    visitState = 'done';
    visitDetail = esc(fmtSlot(past[past.length - 1].starts_at));
  } else if (upcoming.length) {
    visitState = 'scheduled';
    visitDetail = esc(fmtSlot(upcoming[0].starts_at));
  } else if (tour?.status === 'confirmed' && tour.confirmedSlot) {
    visitState = 'scheduled';
    visitDetail = `${esc(fmtSlot(tour.confirmedSlot))} · confirmed by house poll`;
  } else if (tour?.status === 'polled') {
    visitDetail = 'house poll open — confirms itself when enough housemates react';
    visitAction = `<button type="button" class="cta-link" data-set-time="${a.id}|visit">Set a time</button>`;
  } else if (tour?.status === 'asked') {
    visitDetail = 'tour ask sent — the house poll posts when they reply with times';
    visitAction = `<button type="button" class="cta-link" data-set-time="${a.id}|visit">Set a time</button>`;
  } else {
    // Only worth offering once they have actually been interviewed.
    visitDetail = sc.done ? 'ready to invite' : 'after the intro call';
    visitAction = `${sc.done
      ? `<button type="button" class="cta-link" data-email="${a.id}" data-email-kind="tour">Invite them</button>`
      : ''}
      <button type="button" class="cta-link" data-set-time="${a.id}|visit">Set a time</button>`;
  }

  return `<section class="review__section stages">
    <h3 class="review__section-title">Where they are</h3>
    ${stageRow('Intro call', { state: callState, detail: callDetail, action: callAction })}
    ${stageRow('House visit', { state: visitState, detail: visitDetail, action: visitAction })}
  </section>`;
}

/* Dedicated availability home on the profile: the parsed windows AND the
   applicant's own words they came from. An extraction you can check against
   its source is one you can trust — or overrule by just reading the email. */
function availabilityHtml(a) {
  const av = availCache[a.id];
  if (!Array.isArray(av?.windows) || !av.windows.length) return '';
  const wins = av.windows.map(w =>
    `<span class="chip avail-sec__win">${new Date(w.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${esc(w.start)}–${esc(w.end)}</span>`).join('');
  const src = (emailsCache[a.id] || []).find(m => m.gmail_id === av.source_gmail_id);
  const quoteText = src ? (cleanEmailBody(src.body_text || '') || demojibake(src.snippet || '')) : '';
  const srcLine = src
    ? `from their email · ${new Date(src.sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · <button type="button" class="cta-link" data-review-tab="emails">open the thread</button>`
    : `parsed from their reply · <button type="button" class="cta-link" data-review-tab="emails">open the thread</button>`;
  return `<section class="review__section avail-sec">
    <h3 class="review__section-title">Availability <span class="avail-sec__tz">Pacific time</span></h3>
    <div class="avail-sec__wins">${wins}</div>
    ${quoteText ? `<blockquote class="avail-sec__quote">${esc(quoteText.slice(0, 280))}${quoteText.length > 280 ? '…' : ''}</blockquote>` : ''}
    <p class="avail-sec__src">${srcLine}</p>
  </section>`;
}

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
  // Scheduling is outreach: off for anyone archived.
  if (a && (a.stage === 'rejected' || a.stage === 'archived')) {
    toast(`${fullName(a)} is archived — scheduling is off for them`);
    return;
  }
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

/* ---------- manual set-time modal ----------
   The override path: pick any date/time for the intro call or the house
   visit, no offered windows or house poll needed. Booking sends the real
   invites immediately — house calendar + applicant + you — so this both
   schedules and progresses them in one move. */
let setTimeCtx = null;   // { applicantId, kind: 'call' | 'visit' }

function openSetTimeModal(applicantId, kind) {
  const a = applicants.find(x => x.id === applicantId);
  if (!a) return;
  if (a.stage === 'rejected' || a.stage === 'archived') {
    toast(`${fullName(a)} is archived — scheduling is off for them`);
    return;
  }
  if (!(a.email || '').includes('@')) {
    toast(`${fullName(a)} has no email on file — invites need one`);
    return;
  }
  setTimeCtx = { applicantId, kind };
  document.getElementById('settime-title').textContent = kind === 'call'
    ? `Set the intro call with ${a.first}` : `Set the house visit for ${a.first}`;
  document.getElementById('settime-status').textContent = '';
  document.getElementById('settime-note').textContent = kind === 'call'
    ? `Calendar invites (with a Meet link) go to ${a.email} and you, plus an email introduction.`
    : `A house-calendar invite goes to ${a.email} and you, plus a confirmation email with the address.`;
  const input = document.getElementById('settime-input');
  // Default to the next round hour; min pins the picker to the future.
  const next = new Date(Math.ceil((Date.now() + 60 * 60000) / 3600000) * 3600000);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  input.value = local(next);
  input.min = local(new Date());
  document.getElementById('settime-minutes').value = kind === 'call' ? '30' : '45';
  document.getElementById('settime-modal').hidden = false;
}

function closeSetTimeModal() {
  setTimeCtx = null;
  document.getElementById('settime-modal').hidden = true;
}

async function submitSetTime(btn) {
  if (!setTimeCtx) return;
  const { applicantId, kind } = setTimeCtx;
  const when = new Date(document.getElementById('settime-input').value);
  if (isNaN(when.getTime()) || when < new Date()) {
    document.getElementById('settime-status').textContent = 'Pick a future date and time first.';
    return;
  }
  const minutes = Number(document.getElementById('settime-minutes').value) || (kind === 'call' ? 30 : 45);
  btn.disabled = true; btn.textContent = 'Booking…';
  try {
    if (kind === 'call') {
      const out = await gmailCall({ action: 'schedule', applicantId, startsAt: when.toISOString(), minutes });
      (screeningsCache[applicantId] ||= []).unshift(out.screening);
      screeningState[applicantId] = {
        ...(screeningState[applicantId] || {}),
        at: out.screening.starts_at, ends: out.screening.ends_at,
        with: out.screening.housemate_name, link: out.screening.meet_link,
      };
      toast('Intro call booked — invites sent to both');
    } else {
      const out = await gmailCall({ action: 'schedule-visit', applicantId, startsAt: when.toISOString(), minutes });
      tourState[applicantId] = {
        ...(tourState[applicantId] || {}),
        status: 'confirmed', confirmedSlot: out.tour?.confirmed_slot || when.toISOString(),
      };
      toast('House visit set — invites sent');
    }
    closeSetTimeModal();
    renderRailCounts();
    if (VIEWS[view]?.kind === 'applicants') renderApplicants();
    if (!document.getElementById('review').hidden) renderReview();
  } catch (e) {
    document.getElementById('settime-status').textContent = `Booking failed: ${e.message}`;
  }
  btn.disabled = false; btn.textContent = 'Send invites';
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
    d === 'outreach' ? 'Which listing?' : d === 'hold' ? 'Future fit — why not now?' : 'Not a fit — why?';
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
  // Recruiter "not a fit" on a candidate auto-archives, same as a veto;
  // outreach keeps them a candidate.
  if (d === 'pass' && a.stage !== 'archived') await setStage(a.id, 'rejected');
  if (d === 'outreach' && listingId) await addPlacement(a.id, listingId, 'manual');
  toast(`${fullName(a)} → ${d === 'pass' ? 'Archived' : DECISION_LABELS[d]}${d === 'outreach' ? ` · ${attachmentLabel(decisions[a.id])}` : (reason ? ` (${reasonLabel(reason)})` : '')}`);
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
  const head = [...cols, 'stage', 'reviews', 'verdict', 'reviewed_by', 'review_comment', 'decision', 'reason', 'decision_note', 'decided_by', 'decided_at', 'notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(',')];
  for (const a of applicants) {
    const rec = decisions[a.id] || {};
    const st = voteStats(a.id);
    const top = st.decisive || st.list[0];
    lines.push([...cols.map(c => q(a[c])), q(a.stage), q(st.n || 0),
      q(top ? (VERDICTS[top.verdict]?.label || '') : ''), q(top ? reviewerName(top) : ''), q(top?.note || ''),
      q(DECISION_LABELS[rec.d] || ''),
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
  // Every outbound message goes through here, so this is the one place an
  // "email sent" event has to be written.
  if (payload.action === 'send' && payload.applicantId) {
    const who = applicants.find(x => x.id === payload.applicantId);
    logEvent('event_email', payload.applicantId, who ? fullName(who) : '',
      `${me?.name || 'A housemate'} emailed {}.`, payload.subject || null);
    // Writing to them is precisely what the silence notifications were asking
    // for, so they are answered whatever the email actually said.
    ackFor('applicant', payload.applicantId, ['screening_followup', 'gone_cold']);
  }
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
    gmailStatus = { connected: true, email: out.email, connected_by_name: me?.name };
    // Reconnecting usually means the hourly sheet pull has been failing —
    // the server runs a catch-up pull inside connect, so fold its result in.
    const pulled = out.ingest?.inserted || 0;
    toast(pulled
      ? `Shared Gmail connected: ${out.email} — ${pulled} new applicant${pulled === 1 ? '' : 's'} pulled from the sheet`
      : `Shared Gmail connected: ${out.email}`);
    if (pulled) { await loadAll(); render(); }
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

/* Sign-in must return you to the page you were trying to reach. A link posted
   in Discord usually carries a destination (?a=<applicant>, ?view=…), and
   redirecting to just origin+pathname threw it away — you signed in and landed
   on the inbox home wondering what you had clicked. Transient auth params are
   stripped so a retry can't loop. */
function returnUrl() {
  const url = new URL(location.href);
  ['signin', 'code', 'state', 'scope', 'error', 'error_description', 'cb'].forEach(k => url.searchParams.delete(k));
  return url.origin + url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '');
}


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
    if (!resp.ok) {
      // An expired link is the common case, not an error to explain — hand
      // back the button that mints another one.
      const err = new Error(out.error || 'redeem failed');
      err.rerequestUrl = out.rerequestUrl;
      throw err;
    }
    // token_hash and type ONLY — supabase-js rejects the call if email rides along
    const { error } = await sb.auth.verifyOtp({ type: 'email', token_hash: out.token_hash });
    if (error) throw error;
  } catch (e) {
    if (e.rerequestUrl) {
      setGate(e.message, 'Get a fresh link',
        'Opens the sign-in message on Discord. You can also type /signin in the Agape server.');
      document.getElementById('gate-btn').onclick = () => { location.href = e.rerequestUrl; };
    } else {
      setGate(e.message || 'Sign-in link failed.', 'Continue with Discord',
        'Get a fresh link from the sign-in message on Discord, or sign in with Discord here.');
      document.getElementById('gate-btn').onclick = signInWithDiscord;
    }
  }
}

/* Direct Discord OAuth — the gate's primary action goes straight to Discord
   rather than through the multi-provider modal. */
async function signInWithDiscord() {
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: returnUrl(), scopes: 'identify email' },
    });
    if (error) throw error;
  } catch (e) {
    document.getElementById('gate-error').textContent = e.message || 'Discord sign-in failed';
  }
}

function setGate(sub, btnLabel, hint) {
  // A gate message with a button is terminal — we've stopped and need the
  // reader to act, so reveal the card even if we were mid-load. Progress
  // messages pass no button and stay behind the spinner: a returning housemate
  // should never watch the sign-in card narrate its own loading.
  if (btnLabel) document.body.dataset.authState = 'out';
  document.getElementById('gate-sub').textContent = sub;
  const btn = document.getElementById('gate-btn');
  document.getElementById('gate-btn-label').textContent = btnLabel || '';
  btn.hidden = !btnLabel;
  document.getElementById('gate-hint').textContent = hint ||
    'Access is limited to members of the Recruiting Society channel on the Agape server.';
}

let _entering = false;
let _watchdog = null;

/* boot-opt: cached gate verdict. Telemetry (boot_vitals_summary, 14-day
   window) showed the Discord access check is the slow leg of boot, not the
   data load: boot_access.deep p75 1260ms vs boot_data.deep p75 915ms (plain:
   1076ms vs 833ms). loadAll already runs parallel to the access check, so the
   only lever left is the access check itself. We cache a fresh success and let
   a return visit enter on it immediately, re-verifying in the background. A
   refused or failed check is never cached. */
const GATE_CACHE_KEY = 'agape:gate';
const GATE_CACHE_MAX_AGE = 6 * 60 * 60 * 1000; // 6h
function readGateCache(userId) {
  if (!userId) return null;
  try {
    const c = JSON.parse(localStorage.getItem(GATE_CACHE_KEY) || 'null');
    if (!c || c.userId !== userId) return null;
    if (!(c.at > 0) || (Date.now() - c.at) > GATE_CACHE_MAX_AGE) return null;
    return c;
  } catch { return null; }
}
function writeGateCache(userId, username, isAdmin) {
  if (!userId) return;
  try {
    localStorage.setItem(GATE_CACHE_KEY, JSON.stringify({ userId, username, isAdmin, at: Date.now() }));
  } catch { /* storage full / disabled — cache is best-effort */ }
}
function clearGateCache() {
  try { localStorage.removeItem(GATE_CACHE_KEY); } catch { /* ignore */ }
}

/* The spinner is shown for authState 'in' and hides the gate card, so any
   path that stops without calling setGate(..., button) strands the reader on
   a spinner forever — which is exactly what happened to a housemate whose
   membership check never returned. Nothing may fail silently behind it. */
function stall(sub, hint) {
  setGate(sub, 'Try again', hint);
  document.getElementById('gate-btn').onclick = () => { _entering = false; checkMembershipAndEnter(); };
  // Report it. A stall is invisible from the server — the request either never
  // arrived or never came back — so the only witness is this browser.
  try {
    fetch(`${SUPABASE_URL}/functions/v1/recruit-discord/auth-event`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ event: 'client_stall', detail: sub, channel: 'app', inAppBrowser: inAppBrowser() }),
    }).catch(() => {});
  } catch { /* never let reporting break the gate */ }
}

async function checkMembershipAndEnter() {
  // CtrlAuth can dispatch signedin twice (fast-restore + auth event); the
  // enter sequence (load + auto-pass + toast) must only run once.
  if (_entering) return;
  _entering = true;
  // Backstop for anything that hangs rather than throws (a fetch that never
  // settles, an await that never resolves): after 25s, offer a way out.
  clearTimeout(_watchdog);
  _watchdog = setTimeout(() => {
    if (!document.getElementById('app').hidden) return; // already in
    if (document.body.dataset.authState === 'out') return; // a gate is showing
    stall('This is taking longer than it should.',
      'Sign-in worked, but checking your Recruiting Society access stalled. Try again — if it keeps happening, say so in the Agape server.');
  }, 25000);
  try { await _checkMembershipAndEnter(); } finally {
    clearTimeout(_watchdog);
    if (document.getElementById('app').hidden) _entering = false; // gate paths may retry
  }
}

async function _checkMembershipAndEnter() {
  const tEnter = performance.now();
  let token = null;
  try {
    const session = await sb.auth.getSession();
    token = session?.data?.session?.access_token || null;
  } catch (e) {
    stall('Couldn’t read your sign-in session.', e.message || 'Try again.');
    return;
  }
  // A signedin event can land a beat before the session is persisted. Give it
  // a moment rather than returning into a permanent spinner.
  if (!token) {
    await new Promise(r => setTimeout(r, 1200));
    token = (await sb.auth.getSession().catch(() => null))?.data?.session?.access_token || null;
  }
  if (!token) {
    // The classic cause: an in-app browser (Instagram, Discord, Messenger)
    // whose storage is partitioned, so the session written during the OAuth
    // round-trip is gone by the time we read it. Name it instead of guessing.
    stall(
      inAppBrowser()
        ? 'Sign-in worked, but this in-app browser threw the session away.'
        : 'You’re signed in, but the session didn’t stick.',
      inAppBrowser()
        ? 'Tap ⋯ and choose “Open in browser”, then sign in again — or use “Get sign-in link” in the recruiting channel for a one-tap link that works anywhere.'
        : 'The browser dropped the sign-in. Try again, or open ctrl.rodeo in a normal browser window.');
    return;
  }
  const user = window.CtrlAuth.getUser();
  // boot-opt: a recent success lets a return visit skip the slow access wait.
  const cached = user ? readGateCache(user.id) : null;
  setGate('Checking your Recruiting Society access…', null);
  /* The data load doesn't need the access verdict — RLS enforces recruiting
     membership on every row regardless — so it runs IN PARALLEL with the
     access check instead of queued behind it. They used to serialize, and
     each leg costs 1–3s; a deep link onto an applicant paid both. If the
     gate ends up refusing entry, the fetches were RLS-empty and harmless. */
  let tData = 0;
  const tAccess0 = performance.now();
  const dataP = loadAll().then(() => { tData = performance.now(); });
  dataP.catch(() => {}); // surfaced at the await below; never unhandled here

  // boot-opt: cached gate verdict — enter now on the cached success and
  // re-verify against Discord in the background. The access phase reads as ~0
  // because we didn't wait for it; first paint is bounded by loadAll instead.
  if (cached) {
    _verifyAccessInBackground(token, user);
    try {
      await _enterApp({ discordUsername: cached.username, isRecruitingAdmin: cached.isAdmin },
        user, tEnter, performance.now(), tAccess0, dataP, () => tData);
    } catch (e) {
      stall('Something went wrong opening the inbox.', e.message || '');
      console.error(e);
    }
    return;
  }

  try {
    // No timeout here once cost a housemate a permanent spinner.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let resp;
    try {
      resp = await fetch(`${SUPABASE_URL}/functions/v1/discord-membership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'status' }),
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
    const status = await resp.json().catch(() => ({}));
    // A 500 used to fall through to "no Discord linked", sending people off to
    // re-link an account that was never the problem. Say what actually broke.
    if (!resp.ok) {
      stall('The access check failed.',
        `${status.error || `Server returned ${resp.status}`} — this is on our side, not your account.`);
      return;
    }
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
    // in — cache the fresh verdict (boot-opt) so the next visit skips this wait
    writeGateCache(user.id, status.discordUsername, status.isRecruitingAdmin === true);
    await _enterApp(status, user, tEnter, performance.now(), tAccess0, dataP, () => tData);
  } catch (e) {
    const aborted = e.name === 'AbortError';
    stall(aborted ? 'The access check timed out.' : 'Something went wrong checking access.',
      aborted ? 'Discord took too long to answer. Try again — this is usually transient.' : (e.message || ''));
    console.error(e);
  }
}

/* boot-opt: the "we're in" body, shared by the verified path and the cached
   fast path. `status` needs only discordUsername + isRecruitingAdmin; `tAccess`
   is passed in so the cached path can report a ~0 access phase (it never waited
   for the fetch). First paint still awaits loadAll (dataP). */
async function _enterApp(status, user, tEnter, tAccess, tAccess0, dataP, dataTime) {
  me = { id: user.id, name: status.discordUsername || user.email || 'Housemate', groupEmail: user.email || null };
  // Admin = can see #recruiting-automation. The function derives it from
  // Discord and writes recruit_admins, which is what RLS actually consults —
  // so this flag only decides whether the controls are disabled, never
  // whether a write is allowed.
  isAdmin = status.isRecruitingAdmin === true;
  // group_email ties this account to its roster identity, which is how a
  // review imported from the sheet becomes yours once you sign in.
  sb.from('recruit_profiles').select('display_name, group_email').eq('user_id', user.id).maybeSingle()
    .then(({ data }) => {
      if (data?.display_name) me.name = data.display_name;
      if (data?.group_email) me.groupEmail = data.group_email;
      if (data) renderRailUser();
    });
  fetch(`${SUPABASE_URL}/functions/v1/recruit-gmail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await sb.auth.getSession()).data?.session?.access_token}` },
    body: JSON.stringify({ action: 'status' }),
  }).then(r => r.json()).then(st => { gmailStatus = st || { connected: false }; gmailStatusFull = gmailStatus; if (view === 'settings') renderSettings(); }).catch(() => {});
  await dataP;
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
  loadActivityCount();  // background — unresolved-notification badge on Activity
  document.getElementById('gate').hidden = true;
  document.getElementById('app').hidden = false;
  renderRailUser();
  handleGmailCallback();
  view = new URLSearchParams(location.search).get('view') || 'openings';
  view = LEGACY_VIEWS[view] || view;
  if (!VIEWS[view]) view = 'openings';
  pendingOccRoom = view === 'occupancy' ? +new URLSearchParams(location.search).get('room') || null : null;
  render();
  // The budget-floor sweep writes two rows per flagged applicant and used
  // to gate first paint. Under-floor applications are rare and re-render
  // is cheap — run it behind the render instead.
  applyAutoFlags().then(n => {
    if (!n) return;
    toast(`${n} applicant${n === 1 ? '' : 's'} auto-archived by the $1,500 budget floor — tagged, with update emails queued`);
    renderRailCounts();
    if (VIEWS[view]?.kind === 'applicants') renderApplicants();
  }).catch(() => {});
  /* Boot report — one console line, and each phase into the vitals
     pipeline so slow loads show up in /analytics rather than anecdotes.
     access+data overlap; "enter" is this function, "since nav" is the
     user's real wait from tapping the link. */
  {
    const tShown = performance.now();
    const tData = dataTime();
    const deepLinked = Boolean(new URLSearchParams(location.search).get('a'));
    const phases = {
      boot_access: tAccess - tAccess0,
      boot_data: (tData || tShown) - tAccess0,
      boot_enter: tShown - tEnter,
      boot_since_nav: tShown,
    };
    console.log(`[applications] boot: access ${phases.boot_access.toFixed(0)}ms ∥ data ${phases.boot_data.toFixed(0)}ms · enter ${phases.boot_enter.toFixed(0)}ms · since nav ${phases.boot_since_nav.toFixed(0)}ms${deepLinked ? ' · deep-link' : ''}`);
    if (typeof window.ctrlVital === 'function') {
      for (const [name, v] of Object.entries(phases)) window.ctrlVital(deepLinked ? `${name}.deep` : name, v);
    }
  }
  const deep = new URLSearchParams(location.search).get('a');
  if (deep) {
    // Exact id first; then the short name form for legacy timestamp ids
    // (?a=jane-doe finds jane-doe-20260101120000 — newest wins if the name
    // repeats); then the stable uuid (migration 159).
    let hit = applicants.find(x => x.id === deep);
    if (!hit) {
      hit = applicants
        .filter(x => x.id.replace(/-\d{14}$/, '') === deep)
        .sort((a, b) => b.id.localeCompare(a.id))[0];
    }
    if (!hit && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(deep)) {
      hit = applicants.find(x => x.uuid === deep);
    }
    if (hit) openReview(hit.id);
  }
  const linkEv = new URLSearchParams(location.search).get('link');
  if (linkEv) openLinkRecording(linkEv);
}

/* boot-opt: re-verify a cached verdict against Discord without blocking entry.
   Success refreshes the cache (and keeps the admin flag honest). A genuine
   refusal revokes access — clear the cache, hide the app, show the gate. A
   network/server failure keeps the cached verdict rather than punishing the
   reader for a transient blip, and is never cached. */
async function _verifyAccessInBackground(token, user) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let resp;
    try {
      resp = await fetch(`${SUPABASE_URL}/functions/v1/discord-membership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'status' }),
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
    if (!resp.ok) return; // transient server error — keep the cached verdict
    const status = await resp.json().catch(() => ({}));
    if (status.linked && status.isRecruitingMember) {
      writeGateCache(user.id, status.discordUsername, status.isRecruitingAdmin === true);
      isAdmin = status.isRecruitingAdmin === true; // reflect a changed admin flag
      return;
    }
    // access genuinely revoked since the cached success — send them back
    clearGateCache();
    _entering = false;
    document.getElementById('app').hidden = true;
    document.body.dataset.authState = 'out';
    setGate(!status.linked
      ? 'Your account has no Discord linked.'
      : 'Signed in — but this account can’t see the Recruiting Society channel.',
      'Re-check access',
      'Your Recruiting Society access changed. Ask in the Agape server, then re-check.');
    document.getElementById('gate').hidden = false;
    document.getElementById('gate-btn').onclick = () => { _entering = false; checkMembershipAndEnter(); };
  } catch { /* network/abort — keep the cached verdict; next boot re-checks */ }
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
    // Lead with /signin: it is the only path that survives in-app browsers,
    // and it works from any link anyone posts in Discord.
    setGate('Sign in with Discord to open the applicant inbox.', 'Continue with Discord',
      inAppBrowser()
        ? 'You\'re in an in-app browser, where Discord sign-in usually fails. Type /signin in the Agape server for a one-tap link that works here — or use ⋯ → "Open in browser".'
        : 'On a phone? Type /signin in the Agape server for a one-tap link instead.');
    document.getElementById('gate-btn').onclick = signInWithDiscord;
  });

  window.CtrlAuth.init({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    redirectTo: returnUrl(),
    mountTo: '#ctrl-auth-root',
  });
  sb = window.CtrlAuth.getSupabaseClient();
  redeemSigninToken(); // no-op without ?signin=
  initGlobalPlayer();

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
        if (row) { toast('Placed on this listing'); renderRailCounts(); renderApplicants(); }
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
    const vd = e.target.closest('[data-verdict]');
    if (vd) {
      pendingVerdict = pendingVerdict === vd.dataset.verdict ? null : vd.dataset.verdict;
      renderReviewFoot(applicants.find(x => x.id === queue[qIndex]));
      document.getElementById('vote-note')?.focus();
      return;
    }
    const cv = e.target.closest('[data-cast-vote]');
    if (cv) {
      if (!pendingVerdict) pendingVerdict = myVote(queue[qIndex])?.verdict || null;
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
    // Promotion is confirmed against the stay (room + start date), so the
    // profile hands off to the occupancy drawer rather than duplicating the
    // form here. One place decides what a promotion means.
    const promo = e.target.closest('[data-promote-applicant]');
    if (promo) {
      const trial = trialStayFor(promo.dataset.promoteApplicant);
      if (!trial) { toast("No trial stay on the calendar for them yet — add one in Occupancy first"); return; }
      closeReview();
      setView('occupancy');
      // After setView, not before: renderOccupancy would otherwise open a
      // room drawer over the top and clear the pending promotion.
      promoting = trial.id;
      openOccDrawer({ type: 'stay', id: trial.id });
      document.querySelector(`[data-stay="${trial.id}"]`)?.scrollIntoView({ block: 'nearest' });
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
    const stx = e.target.closest('[data-set-time]');
    if (stx) {
      const [aid, kind] = stx.dataset.setTime.split('|');
      openSetTimeModal(aid, kind);
      return;
    }
    const gd = e.target.closest('[data-give-decision]');
    if (gd) { openGiveDecision(gd.dataset.giveDecision); return; }
    const bi = e.target.closest('[data-book-in]');
    if (bi) { openBookIn(bi.dataset.bookIn); return; }
    const od2 = e.target.closest('[data-open-draft]');
    if (od2) { updateListingStatus(od2.dataset.openDraft, 'open'); return; }
    const pm = e.target.closest('[data-play-mini]');
    if (pm) {
      e.stopPropagation();
      // A pasted link (tldv et al.) can't be played in the docked player —
      // those hosts refuse to embed. Send Watch to the Call tab instead,
      // which renders it as a link out.
      const aid = pm.dataset.playMini;
      if (screeningState[aid]?.watchExternal) {
        openReview(aid);
        reviewTab = 'call';
        renderReview();
        return;
      }
      gpPlayMini(aid);
      return;
    }
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
    const phEdit = e.target.closest('[data-phone-edit]');
    if (phEdit) { phoneEditing = true; renderReview(); document.getElementById('phone-input')?.focus(); return; }
    const phSave = e.target.closest('[data-phone-save]');
    if (phSave) { savePhone(queue[qIndex]); return; }
    const phCancel = e.target.closest('[data-phone-cancel]');
    if (phCancel) { phoneEditing = false; renderReview(); return; }
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
    const listingBar = e.target.closest('[data-listing-bar]');
    if (listingBar) {
      const id = listingBar.dataset.listingBar;
      const already = occDrawer?.type === 'listing' && occDrawer.id === id;
      openOccDrawer(already ? null : { type: 'listing', id });
      return;
    }
    const editL = e.target.closest('[data-edit-listing]');
    if (editL) { openListingModal(editL.dataset.editListing); return; }
    const newL = e.target.closest('[data-new-listing]');
    if (newL) { openListingModal('new'); return; }
    const addP = e.target.closest('[data-add-person]');
    if (addP) { openAddPerson(addP.dataset.addPerson); return; }
    if (e.target.closest('#add-close') || e.target.closest('#add-cancel')) { closeAddPerson(); return; }
    const addGo = e.target.closest('#add-submit');
    if (addGo) { submitAddPerson(addGo); return; }
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
    // Field-context guardrails, wherever the form came from:
    // an end date can't precede its start…
    if (e.target.name === 'starts_on') {
      const ends = e.target.closest('form')?.querySelector('input[name="ends_on"]');
      if (ends) ends.min = e.target.value || '';
    }
    // "Through" sleeps until a move-in exists to measure it from.
    if (e.target.id === 'movein-from') {
      const to = document.getElementById('movein-to');
      if (to) { to.disabled = !e.target.value; to.min = e.target.value || ''; if (to.disabled) to.value = ''; }
    }
    // …and a resident trial has no sublet end — the field sleeps until the
    // listing is a sublet again.
    if (e.target.matches('[data-listing-form] select[name="kind"]')) {
      const ends = e.target.closest('form').querySelector('input[name="ends_on"]');
      if (ends) {
        ends.disabled = e.target.value === 'resident';
        if (ends.disabled) ends.value = '';
      }
    }
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

  document.getElementById('menu-signout').onclick = () => window.CtrlAuth.signOut();
  document.getElementById('gd-close').onclick = () => { document.getElementById('gd-modal').hidden = true; };
  document.getElementById('bi-close').onclick = () => { document.getElementById('bi-modal').hidden = true; };
  document.getElementById('mi-close').onclick = () => { document.getElementById('mi-modal').hidden = true; moveinFor = null; };
  document.getElementById('gd-yes').onclick = () => giveDecision(document.getElementById('gd-modal').dataset.applicant, 'yes');
  // No is not a sentiment to file — it routes into the Remove sheet with
  // Not a fit preselected (note carried), so the verdict and its
  // consequences happen as one act. The decision row is written on commit.
  document.getElementById('gd-no').onclick = () => {
    const id = document.getElementById('gd-modal').dataset.applicant;
    const note = (document.getElementById('gd-note')?.value || '').trim();
    document.getElementById('gd-modal').hidden = true;
    openRemoveSheet(id, null, { preselect: 'not_a_fit', note });
  };

  document.getElementById('remove-close').onclick = hideRemoveSheet;
  document.getElementById('remove-cancel').onclick = hideRemoveSheet;
  document.getElementById('remove-submit').onclick = submitRemove;

  document.getElementById('claim-close').onclick = closeSchedulerModal;
  document.getElementById('claim-cancel').onclick = closeSchedulerModal;
  document.getElementById('claim-post-btn').onclick = postSchedulerFromModal;
  document.getElementById('avail-close').onclick = closeAvailModal;
  document.getElementById('settime-close').onclick = closeSetTimeModal;
  document.getElementById('settime-cancel').onclick = closeSetTimeModal;
  document.getElementById('settime-confirm').onclick = (e) => submitSetTime(e.currentTarget);
  document.getElementById('avail-ask-coverage').onclick = () => {
    const id = availApplicantId;
    closeAvailModal();
    if (id) openSchedulerPreview(id);
  };
  document.getElementById('email-close').onclick = closeEmailModal;
  document.getElementById('email-later').onclick = saveEmailDraft;
  // Regenerate has to respect which editor you're in. In the rejection queue
  // it must redraft the update — routing it to the outreach drafter produced a
  // warm invite, complete with a booking link, one click away from being sent
  // to someone who was just archived.
  document.getElementById('email-regen').onclick = () => {
    if (emailApplicantId) generateEmail(emailApplicantId);
  };
  document.getElementById('email-send').onclick = async () => {
    if (!gmailStatus.connected) { toast('Connect the shared Gmail first (Emails tab)'); return; }
    const btn = document.getElementById('email-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const sentFor = emailApplicantId;
      await gmailCall({
        action: 'send', applicantId: sentFor,
        subject: document.getElementById('email-subject').value,
        body: document.getElementById('email-body').value,
        // A tour ask opens the tour cycle server-side: the next availability
        // reply becomes a house poll instead of a screener claim.
        ...(emailKind === 'tour' || emailKind === 'visit' ? { kind: 'tour' } : {}),
        // The welcome email copies the finance folks and carries the agreement.
        ...(emailExtras?.cc?.length ? { cc: emailExtras.cc } : {}),
        ...(emailExtras?.attachments?.length ? { attachments: emailExtras.attachments } : {}),
      });
      // Welcome / day-of sends stamp the stay so nudges and panels move on.
      if (emailExtras?.stampStayId) {
        const col = emailExtras.stamp === 'dayof' ? 'dayof_email_sent_at' : 'welcome_email_sent_at';
        const when = new Date().toISOString();
        sb.from('recruit_stays').update({ [col]: when }).eq('id', emailExtras.stampStayId)
          .then(({ error: e2 }) => { if (e2) console.warn('send stamp failed', e2.message); });
        const st = stays.find(x => x.id === emailExtras.stampStayId);
        if (st) st[col] = when;
        if (emailExtras.stamp === 'dayof') ackFor('applicant', sentFor, ['movein_day']);
      }
      if (emailKind === 'tour' || emailKind === 'visit') {
        tourState[sentFor] = { status: 'asked', askedAt: new Date().toISOString() };
        if (VIEWS[view]?.kind === 'applicants') renderApplicants();
      }
      toast('Sent from live.at.agapesf@gmail.com');
      // Pull the sent message in rather than dropping the cache — clearing
      // it would blank a thread the user is looking at.
      syncEmails(sentFor).then(() => {
        const a = applicants.find(x => x.id === sentFor);
        if (a && queue[qIndex] === sentFor && reviewTab === 'emails') paintEmailsPanel(a, '');
      }).catch(() => {});
      clearEmailDraft(sentFor); // sent — the saved draft has done its job
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
