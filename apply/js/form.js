/* /apply — Agape's application, one question at a time.
   Auth is the first question: an email OTP signs the applicant in, so every
   answer after it saves server-side (recruit_apply_save RPC, migration 170)
   and the applicant can come back any time to pick up or edit — until the
   house makes a decision, at which point the RPCs lock the row. */

const VERSION = '1.7.1';
console.log(`[apply] v${VERSION} — native application form + program listings`);

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- questions ----------
   Field changes are edits to this array — the renderer and autosave are
   generic. `fields` names the recruit_applicants columns a screen owns. */
const QUESTIONS = [
  {
    id: 'name', type: 'name', fields: ['first_name', 'last_name'], required: true,
    label: "What's your name?",
  },
  {
    id: 'pronouns', type: 'text', fields: ['pronouns'], required: false,
    label: 'What are your pronouns?',
    placeholder: 'she/her, they/them, …',
  },
  {
    id: 'residency', type: 'multi', fields: ['residency', 'move_in'], required: true,
    label: 'What kind of stay are you looking for?',
    hint: 'Pick one — or both, if you could see either working. Rooms open up when they open up, so folks who can hop in when a spot frees up tend to move to the front.',
    options: [
      { label: 'Full-time resident', short: 'Full-time', tone: 'fulltime', desc: 'A long-term home. Full-time starts with a three-month resident trial — live with us, see how it fits — then you join the house proper.' },
      { label: 'Short-term (sublet)', short: 'Sublet', tone: 'sublet', desc: 'A few months in an open room — while a resident is away, or a room waits for its person.' },
    ],
  },
  {
    id: 'budget', type: 'radio', fields: ['budget'], required: true, when: () => hasHousing(),
    label: "What's your monthly budget?",
    options: ['Under $1,500/mo', '$1,500–$2,000/mo', '$2,000–$2,500/mo', '$2,500+/mo'],
  },
  /* ---- program (DJ residency) block — shown when a program listing is
     selected on the kind-of-stay screen. Housing-only questions carry
     when: hasHousing(); these carry when: hasProgram(). */
  {
    id: 'artist_name', type: 'text', fields: ['artist_name'], required: true, when: () => hasProgram(),
    label: 'What name do you play under?',
    placeholder: 'your artist name or alias',
  },
  {
    id: 'based_in', type: 'text', fields: ['based_in'], required: true, when: () => hasProgram(),
    label: 'Where are you based?',
    placeholder: 'city, country — and anything about travel we should know',
  },
  {
    id: 'mix_links', type: 'textarea', fields: ['mix_links'], required: true, when: () => hasProgram(),
    label: 'Where can we listen?',
    hint: 'Links to mixes or sets — SoundCloud, Bandcamp, YouTube, anywhere. One per line is easiest for us.',
  },
  {
    id: 'performance_history', type: 'textarea', fields: ['performance_history'], required: false, when: () => hasProgram(),
    label: 'Where have you played?',
    hint: 'Clubs, parties, radio, your bedroom — a short history of your sets. No pedigree required.',
  },
  {
    id: 'gear_notes', type: 'textarea', fields: ['gear_notes'], required: false, when: () => hasProgram(),
    label: 'What gear would you need?',
    hint: "The basement has the Neptune sound system and Pioneer decks. Tell us what you'd bring or need beyond that.",
  },
  {
    id: 'essays', type: 'interstitial',
    label: 'These next questions matter most.',
    hint: 'A real person reads every application — what you share here is how we get a feel for whether the house would be a good fit for you, and you for it. Take your time.',
  },
  {
    id: 'about', type: 'textarea', fields: ['about'], required: true,
    label: 'About you.',
    hint: 'Whatever feels true — how you spend your time, what you care about, what a good week looks like.',
  },
  {
    id: 'why_agape', type: 'textarea', fields: ['why_agape'], required: true, when: () => hasHousing(),
    label: 'Why Agape?',
    hint: "What drew you here? The honest version beats the polished one.",
  },
  {
    id: 'sound_essay', type: 'textarea', fields: ['sound_essay'], required: true, when: () => hasProgram(),
    label: 'Tell us about your sound.',
    hint: 'What you play, what you’re reaching for, what a month of focused time would let you make. The honest version beats the polished one.',
  },
  {
    id: 'gifts', type: 'textarea', fields: ['gifts'], required: true,
    label: 'What would you bring to the house?',
    hint: "Cooking, music, deep questions at dinner, fixing things — everyone's list is different.",
  },
  {
    id: 'community', type: 'textarea', fields: ['community'], required: false,
    label: "What's important to you in community?",
    hint: 'What makes living with people feel good — and what makes it hard?',
  },
  {
    id: 'heard_from', type: 'text', fields: ['heard_from'], required: false,
    label: 'How did you hear about us?',
    placeholder: 'a friend, an event, the internet…',
  },
  {
    id: 'contact', type: 'contact', fields: ['phone', 'social'], required: false,
    label: 'Where else can we find you?',
    hint: 'Both optional. A number helps when it comes time to schedule a tour.',
  },
  {
    id: 'anything_else', type: 'textarea', fields: ['anything_else'], required: false,
    label: 'Anything else we should know?',
    hint: "Totally optional — timing quirks, pets, questions for us, anything that didn't fit above.",
  },
];

/* Track answers live in the two existing TEXT columns, human-readable:
     residency: "Full-time resident | Short-term (sublet)"
     move_in:   "Full-time: 2026-11-15 (flexible — after my lease) | Sublet: 2026-09-01"
   Each selected track carries structured timing: a move-in date, a flexible
   toggle, and optional context. Parses back leniently — legacy single-value
   answers ("Full-time resident" / "2026-10-01 (flexible)") load fine. */
function parseTracks(q, residencyRaw, moveinRaw) {
  const map = {}; // label → { date, flex, note }
  const resParts = String(residencyRaw || '').split('|').map((s) => s.trim()).filter(Boolean);
  for (const opt of q.options) {
    if (resParts.some((r) => r.startsWith(opt.label) || r.startsWith(opt.short))) {
      map[opt.label] = { date: '', flex: false, note: '' };
    }
  }
  for (const part of String(moveinRaw || '').split('|')) {
    const p = part.trim();
    if (!p) continue;
    const opt = q.options.find((o) => p.startsWith(o.short + ':') || p.startsWith(o.label));
    // Legacy value with no track prefix belongs to the only selected track.
    const keys = Object.keys(map);
    const label = opt ? opt.label : (keys.length === 1 ? keys[0] : null);
    if (!label || !map[label]) continue;
    const dates = p.match(/\d{4}-\d{2}-\d{2}/g) || [];
    map[label] = {
      date: dates[0] || '',
      dateEnd: dates[1] || '', // "soonest → latest"; absent when flexible
      flex: /flexible/i.test(p),
      note: (p.match(/—\s*([^)|]+)\)?\s*$/) || [])[1]?.trim() || '',
    };
  }
  return map;
}
function composeTracks(q, map) {
  const labels = [];
  const timing = [];
  for (const opt of q.options) {
    const t = map[opt.label];
    if (!t) continue;
    labels.push(opt.label);
    let when = t.date || '';
    // The latest-date bound only means something when timing is firm.
    if (!t.flex && t.dateEnd) when += (when ? ' → ' : '…') + t.dateEnd;
    if (t.flex) when += when ? ' (flexible' + (t.note ? ' — ' + t.note : '') + ')' : 'Flexible' + (t.note ? ' — ' + t.note : '');
    else if (t.note) when += (when ? ' — ' : '') + t.note;
    if (when) timing.push(`${opt.short}: ${when}`); // no timing yet → say nothing, not "—"
  }
  return {
    residency: labels.join(' | '),
    move_in: labels.length === 1 && timing.length === 1
      ? timing[0].replace(/^[^:]+:\s*/, '') // single track keeps the legacy plain format
      : timing.join(' | '), // multi-track entries keep their prefix so parse can attribute them
  };
}

/* ---------- program listings ----------
   Open program listings (migration 178) become extra kind-of-stay options.
   ?listing=<slug> deep-links into one; ?payment=success is the Stripe
   Payment Link return. Selection lands on the applicant via
   recruit_apply_set_listing, so triage sees listing_id, not just text. */
const PARAMS = new URLSearchParams(window.location.search);
const pendingListing = (PARAMS.get('listing') || '').trim().toLowerCase();
const paymentReturn = PARAMS.get('payment');

const RESIDENCY_Q = QUESTIONS.find((q) => q.id === 'residency');

function trackSelected(opt) {
  return String(state.answers.residency || '').split('|').map((s) => s.trim())
    .some((r) => r.startsWith(opt.label) || r.startsWith(opt.short));
}
function hasProgram() {
  return RESIDENCY_Q.options.some((o) => o.program && trackSelected(o));
}
function hasHousing() {
  // Nothing chosen yet reads as housing — the classic form until a program
  // option is actually picked.
  return RESIDENCY_Q.options.some((o) => !o.program && trackSelected(o)) || !hasProgram();
}
/* The questions active for this applicant's selection. */
const AQ = () => QUESTIONS.filter((q) => !q.when || q.when());

async function loadProgramListings() {
  try {
    const { data, error } = await sb.rpc('recruit_open_program_listings');
    if (error) throw error;
    for (const l of (data || [])) {
      if (!l.slug || RESIDENCY_Q.options.some((o) => o.slug === l.slug)) continue;
      const dates = [l.starts_on, l.ends_on].filter(Boolean).map(fmtISO).join(' – ');
      const bits = [
        dates,
        l.fee_cents ? `$${Math.round(l.fee_cents / 100)} application fee` : '',
        l.application_deadline ? `apply by ${fmtISO(l.application_deadline)}` : '',
      ].filter(Boolean).join(' · ');
      RESIDENCY_Q.options.push({
        label: l.title, short: l.title, tone: 'program',
        desc: (l.blurb ? l.blurb + ' ' : '') + (bits ? `(${bits})` : ''),
        program: true, slug: l.slug, fee_cents: l.fee_cents || 0,
      });
      state.listings.push(l);
    }
    // Housing options always lead; programs follow, in date order.
    RESIDENCY_Q.options.sort((a, b) => (a.program ? 1 : 0) - (b.program ? 1 : 0));
  } catch (e) { console.warn('[apply] program listings load failed', e); }
}

/* Keep the applicant's listing_id in step with the kind-of-stay selection. */
function syncListingSelection(q) {
  const prog = q.options.find((o) => o.program && state._multi?.[o.label]);
  const want = prog ? prog.slug : null;
  const have = state.app?.listing?.slug || null;
  if (want === have || (!state.app && !want)) return;
  sb.rpc('recruit_apply_set_listing', { p_slug: want }).then(({ data, error }) => {
    if (error) console.warn('[apply] set listing failed', error);
    else if (data) state.app = data;
  });
}

const feeDue = () => Boolean(state.app?.listing && (state.app.listing.fee_cents || 0) > 0
  && state.app.payment_status !== 'paid');
const feeLabel = () => `$${Math.round((state.app?.listing?.fee_cents || 0) / 100)}`;

function payRedirect() {
  try {
    const u = new URL(state.app.listing.payment_link);
    u.searchParams.set('prefilled_email', state.email || state.app.email || '');
    u.searchParams.set('client_reference_id', state.app.id);
    window.location.href = u.toString();
  } catch (e) {
    console.warn('[apply] payment link missing or invalid', e);
    go('done');
  }
}

const fmtISO = (iso) => {
  const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/* Human summary of the stay answer for the overview row. */
function prettyTracks(q) {
  const map = parseTracks(q, state.answers.residency || '', state.answers.move_in || '');
  const parts = [];
  for (const opt of q.options) {
    const t = map[opt.label];
    if (!t) continue;
    const bits = [];
    if (t.date) bits.push(t.dateEnd && !t.flex ? `${fmtISO(t.date)} – ${fmtISO(t.dateEnd)}` : `from ${fmtISO(t.date)}`);
    if (t.flex) bits.push('flexible');
    if (t.note) bits.push(t.note);
    parts.push(opt.short + (bits.length ? ` (${bits.join(', ')})` : ''));
  }
  return parts.join(' + ');
}

/* ---------- state ---------- */
const state = {
  email: '',
  answers: {},        // column → value
  app: null,          // recruit_apply_load() result
  listings: [],       // open program listings (recruit_open_program_listings)
  screen: 'welcome',  // welcome | email | code | q:<id> | review | done | locked
  fromReview: false,
};

const $screen = document.getElementById('screen');
const $fill = document.getElementById('progressFill');
const $save = document.getElementById('saveState');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Funnel progress lands in /analytics as a vital: the furthest screen index
// reached (welcome=0 … done). Drop-off = where the max stops.
const SCREEN_ORDER = ['welcome', 'email', 'code', ...QUESTIONS.map((q) => 'q:' + q.id), 'review', 'done'];
const track = (screen) => {
  try {
    const i = SCREEN_ORDER.indexOf(screen);
    if (i >= 0) window.ctrlVital?.('apply_step', i);
    if (screen === 'submitted') window.ctrlVital?.('apply_submitted', 1);
    if (screen === 'reapplied') window.ctrlVital?.('apply_reapplied', 1);
  } catch { /* analytics is best-effort */ }
};

/* ---------- persistence ---------- */
let saveTimer = null;
async function saveFields(fields) {
  clearTimeout(saveTimer);
  $save.textContent = 'saving…';
  try {
    const { data, error } = await sb.rpc('recruit_apply_save', { p_fields: fields });
    if (error) throw error;
    state.app = data;
    $save.textContent = 'saved';
  } catch (e) {
    console.warn('[apply] save failed', e);
    $save.textContent = 'save failed — check your connection';
  }
  saveTimer = setTimeout(() => { $save.textContent = ''; }, 2500);
}

async function loadApplication() {
  const { data, error } = await sb.rpc('recruit_apply_load');
  if (error) { console.warn('[apply] load failed', error); return null; }
  state.app = data;
  if (data) {
    for (const q of QUESTIONS) for (const f of (q.fields || [])) state.answers[f] = data[f] || '';
  }
  return data;
}

/* ---------- flow ---------- */
function questionIndex(id) { return QUESTIONS.findIndex((q) => q.id === id); }

function firstUnanswered() {
  for (const q of AQ()) {
    if (q.type === 'interstitial') continue;
    if (q.required && q.fields.every((f) => !(state.answers[f] || '').trim())) return q.id;
  }
  return null;
}

function progressFor(screen) {
  const list = AQ();
  const pre = ['welcome', 'email', 'code'];
  const total = pre.length + list.length + 1; // + review
  let done = 0;
  if (pre.includes(screen)) done = pre.indexOf(screen);
  else if (screen.startsWith('q:')) done = pre.length + Math.max(0, list.findIndex((q) => q.id === screen.slice(2)));
  else done = total - (screen === 'review' ? 1 : 0);
  return Math.round((done / total) * 100);
}

function go(screen) {
  state.screen = screen;
  state._multiFor = null; // multi-choice screens re-parse their answer on entry
  $fill.style.width = progressFor(screen) + '%';
  $screen.classList.add('fade-out');
  setTimeout(() => {
    render();
    $screen.classList.remove('fade-out');
  }, 150);
  track(`screen:${screen}`);
}

function afterAuthRoute() {
  const app = state.app;
  if (app && app.stage !== 'review') return go('locked');
  if (app && app.is_submitted) return go('review');
  const next = firstUnanswered();
  return go(next ? 'q:' + next : 'review');
}

/* ---------- rendering ---------- */
function render() {
  const s = state.screen;
  if (s === 'welcome') return renderWelcome();
  if (s === 'email') return renderEmail();
  if (s === 'code') return renderCode();
  if (s === 'review') return renderReview();
  if (s === 'done') return renderDone();
  if (s === 'locked') return renderLocked();
  if (s.startsWith('q:')) return renderQuestion(QUESTIONS[questionIndex(s.slice(2))]);
}

const QKEYS = '<kbd>↵</kbd> next · <kbd>←</kbd><kbd>→</kbd> move · <kbd>esc</kbd> overview';
function nav(html = '', keys = '<kbd>↵</kbd> enter') {
  return `<div class="apply-nav">${html}<span class="apply-nav__enter">${keys}</span></div>
          <div class="apply-error" id="err"></div>`;
}

function bindEnter(fn) {
  $screen.querySelectorAll('input:not([type=checkbox])').forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } });
  });
}

function showErr(msg) { const el = document.getElementById('err'); if (el) el.textContent = msg; }

function renderWelcome() {
  // A ?listing= deep link opens the door with the program's context up top.
  const l = state.listings.find((x) => x.slug === pendingListing);
  const dates = l ? [l.starts_on, l.ends_on].filter(Boolean).map(fmtISO).join(' – ') : '';
  const bits = l ? [dates,
    l.fee_cents ? `$${Math.round(l.fee_cents / 100)} application fee` : '',
    l.application_deadline ? `apply by ${fmtISO(l.application_deadline)}` : ''].filter(Boolean).join(' · ') : '';
  $screen.innerHTML = `
    <div class="apply-intro__mark">agape</div>
    ${l ? `<div class="apply-banner"><strong>${esc(l.title)}</strong>${bits ? ' · ' + esc(bits) : ''}</div>` : ''}
    <h1 class="apply-q__title">${l ? 'Apply for the ' + esc(l.title) + '.' : 'Apply to live with us.'}</h1>
    <p class="apply-q__hint">${l && l.blurb ? esc(l.blurb) + ' ' : ''}This takes about ten minutes, and you can leave and come back any time — your answers save as you go. We'll start with your email so you can always find your way back in.</p>
    <button class="btn btn--filled btn--lg" id="start">Start</button>`;
  document.getElementById('start').onclick = () => go('email');
}

function renderEmail() {
  $screen.innerHTML = `
    <div class="apply-q__count">first things first</div>
    <h1 class="apply-q__title">What's your email?</h1>
    <p class="apply-q__hint">We'll send you a six-digit code — no password to remember. This is also how we'll reach you about your application.</p>
    <div class="apply-q"><input class="input" type="email" id="email" placeholder="you@example.com" value="${esc(state.email)}" autocomplete="email"></div>
    ${nav('<button class="btn btn--filled" id="next">Send code</button>')}`;
  const submit = async () => {
    const email = document.getElementById('email').value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr('That email doesn’t look right.');
    state.email = email;
    const btn = document.getElementById('next');
    btn.disabled = true; btn.textContent = 'Sending…';
    // emailRedirectTo matters: the project's auth email is a magic LINK
    // (no {{ .Token }} code yet) — clicking it must land back on /apply/,
    // where supabase-js picks the session out of the URL and boot() resumes.
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: window.location.origin + '/apply/' },
    });
    if (error) { btn.disabled = false; btn.textContent = 'Send code'; return showErr(error.message); }
    go('code');
  };
  document.getElementById('next').onclick = submit;
  bindEnter(submit);
  document.getElementById('email').focus();
}

function renderCode() {
  $screen.innerHTML = `
    <div class="apply-q__count">check your inbox</div>
    <h1 class="apply-q__title">Check your email —<br>${esc(state.email)}</h1>
    <p class="apply-q__hint">Tap the sign-in link in the email and you'll land right back here. Got a six-digit code instead? Enter it below.</p>
    <div class="apply-q"><input class="input apply-otp" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="······"></div>
    ${nav('<button class="btn btn--filled" id="next">Verify</button><button class="apply-back" id="back">use a different email</button>')}`;
  const submit = async () => {
    const token = document.getElementById('code').value.trim();
    if (token.length < 6) return showErr('The code is six digits.');
    const btn = document.getElementById('next');
    btn.disabled = true; btn.textContent = 'Checking…';
    const { error } = await sb.auth.verifyOtp({ email: state.email, token, type: 'email' });
    if (error) { btn.disabled = false; btn.textContent = 'Verify'; return showErr('That code didn’t work — it may have expired. Go back to resend.'); }
    await loadApplication();
    afterAuthRoute();
  };
  document.getElementById('next').onclick = submit;
  document.getElementById('back').onclick = () => go('email');
  bindEnter(submit);
  document.getElementById('code').focus();
}

function inputHtml(q) {
  const v = (f) => esc(state.answers[f] || '');
  if (q.type === 'name') return `
    <div class="apply-row">
      <div><label class="apply-field-label" for="f-first_name">first</label><input class="input" id="f-first_name" value="${v('first_name')}" autocomplete="given-name"></div>
      <div><label class="apply-field-label" for="f-last_name">last</label><input class="input" id="f-last_name" value="${v('last_name')}" autocomplete="family-name"></div>
    </div>`;
  if (q.type === 'contact') return `
    <div class="apply-field"><label class="apply-field-label" for="f-phone">phone</label><input class="input" id="f-phone" type="tel" value="${v('phone')}" autocomplete="tel" placeholder="(555) 555-5555"></div>
    <div class="apply-field"><label class="apply-field-label" for="f-social">instagram / website / anything public</label><input class="input" id="f-social" value="${v('social')}" placeholder="@you"></div>`;
  if (q.type === 'textarea') return `<textarea class="input textarea" id="f-${q.fields[0]}" maxlength="4000">${v(q.fields[0])}</textarea>`;
  if (q.type === 'radio') {
    const cur = state.answers[q.fields[0]] || '';
    return q.options.map((opt, i) => {
      const label = typeof opt === 'string' ? opt : opt.label;
      const desc = typeof opt === 'string' ? '' : (opt.desc || '');
      return `
      <button type="button" class="apply-choice ${typeof opt !== 'string' && opt.tone ? 'apply-choice--' + opt.tone : ''} ${label === cur ? 'selected' : ''}" data-value="${esc(label)}">
        <span class="apply-choice__key">${i + 1}</span>
        <span class="apply-choice__body">${esc(label)}${desc ? `<span class="apply-choice__desc">${esc(desc)}</span>` : ''}</span>
      </button>`;
    }).join('');
  }
  if (q.type === 'multi') {
    const sel = state._multi || {};
    const today = new Date().toISOString().slice(0, 10);
    return q.options.map((opt, i) => {
      const t = sel[opt.label];
      return `
      <div class="apply-field">
        <button type="button" class="apply-choice ${opt.tone ? 'apply-choice--' + opt.tone : ''} ${t ? 'selected' : ''}" data-value="${esc(opt.label)}">
          <span class="apply-choice__key">${t ? '✓' : i + 1}</span>
          <span class="apply-choice__body">${esc(opt.label)}${opt.desc ? `<span class="apply-choice__desc">${esc(opt.desc)}</span>` : ''}</span>
        </button>
        ${t && !opt.program ? `
        <div class="apply-track">
          <div class="apply-row">
            <div>
              <label class="apply-field-label">soonest you could move in</label>
              <input class="input" type="date" data-t-date="${esc(opt.label)}" value="${esc(t.date)}" min="${today}">
            </div>
            ${t.flex ? '' : `
            <div>
              <label class="apply-field-label">latest you could move in</label>
              <input class="input" type="date" data-t-late="${esc(opt.label)}" value="${esc(t.dateEnd || '')}" min="${esc(t.date || today)}">
            </div>`}
          </div>
          <label class="apply-field-label apply-track__flex"><input type="checkbox" data-t-flex="${esc(opt.label)}" ${t.flex ? 'checked' : ''}> my timing is flexible</label>
          <input class="input apply-choice__note" data-t-note="${esc(opt.label)}" placeholder="context on timing? e.g. after my lease ends (optional)" value="${esc(t.note)}">
        </div>` : ''}
      </div>`;
    }).join('');
  }
  if (q.type === 'date') {
    const cur = state.answers[q.fields[0]] || '';
    const m = cur.match(/\d{4}-\d{2}-\d{2}/);
    const flex = /flexible/i.test(cur);
    return `
      <input class="input" type="date" id="f-date" value="${m ? m[0] : ''}" min="${new Date().toISOString().slice(0, 10)}">
      <label class="apply-field-label" style="display:flex;align-items:center;gap:8px;margin-top:14px;cursor:pointer">
        <input type="checkbox" id="f-flex" ${flex ? 'checked' : ''}> my timing is flexible
      </label>`;
  }
  return `<input class="input" id="f-${q.fields[0]}" value="${v(q.fields[0])}" placeholder="${esc(q.placeholder || '')}">`;
}

function collect(q) {
  const out = {};
  if (q.type === 'radio') return null; // handled on click
  if (q.type === 'date') {
    const d = document.getElementById('f-date').value;
    const flex = document.getElementById('f-flex').checked;
    out[q.fields[0]] = d ? (flex ? `${d} (flexible)` : d) : (flex ? 'Flexible' : '');
    return out;
  }
  for (const f of q.fields) out[f] = document.getElementById('f-' + f)?.value.trim() ?? '';
  return out;
}

function renderQuestion(q) {
  const idx = AQ().findIndex((x) => x.id === q.id);
  // One document-level key handler at a time — toggle re-renders on multi
  // screens would otherwise stack listeners and double-fire Enter.
  if (state._keyHandler) { document.removeEventListener('keydown', state._keyHandler); state._keyHandler = null; }
  if (q.type === 'multi' && state._multiFor !== q.id) {
    state._multi = parseTracks(q, state.answers.residency || '', state.answers.move_in || '');
    // Deep link: the ?listing= program option arrives pre-checked.
    if (pendingListing && !Object.keys(state._multi).length) {
      const opt = q.options.find((o) => o.program && o.slug === pendingListing);
      if (opt) state._multi[opt.label] = { date: '', dateEnd: '', flex: false, note: '' };
    }
    state._multiFor = q.id;
  }
  const n = AQ().filter((x) => x.type !== 'interstitial').indexOf(q) + 1;
  const total = AQ().filter((x) => x.type !== 'interstitial').length;

  if (q.type === 'interstitial') {
    $screen.innerHTML = `
      <h1 class="apply-q__title">${esc(q.label)}</h1>
      <p class="apply-q__hint">${esc(q.hint)}</p>
      ${nav('<button class="btn btn--filled" id="next">I’m ready</button><button class="apply-back" id="back">back</button>', QKEYS)}`;
  } else {
    $screen.innerHTML = `
      <div class="apply-q__count">${n} / ${total}${q.required ? '' : ' · optional'}</div>
      <h1 class="apply-q__title">${esc(q.label)}</h1>
      ${q.hint ? `<p class="apply-q__hint">${esc(q.hint)}</p>` : ''}
      <div class="apply-q">${inputHtml(q)}</div>
      ${nav(`<button class="btn btn--filled" id="next">${state.fromReview ? 'Save' : 'Next'}</button>` +
            (idx > 0 || state.fromReview ? '<button class="apply-back" id="back">back</button>' : ''), QKEYS)}`;
  }

  const advance = () => {
    if (state.fromReview) { state.fromReview = false; go('review'); }
    else {
      // Recompute at click time — the kind-of-stay answer just changed which
      // questions are active.
      const list = AQ();
      const i = list.findIndex((x) => x.id === q.id);
      const nq = i >= 0 ? list[i + 1] : null;
      go(nq ? 'q:' + nq.id : 'review');
    }
  };

  const syncMulti = () => {
    $screen.querySelectorAll('[data-t-date]').forEach((el) => { if (state._multi[el.dataset.tDate]) state._multi[el.dataset.tDate].date = el.value; });
    $screen.querySelectorAll('[data-t-late]').forEach((el) => { if (state._multi[el.dataset.tLate]) state._multi[el.dataset.tLate].dateEnd = el.value; });
    $screen.querySelectorAll('[data-t-flex]').forEach((el) => { if (state._multi[el.dataset.tFlex]) state._multi[el.dataset.tFlex].flex = el.checked; });
    $screen.querySelectorAll('[data-t-note]').forEach((el) => { if (state._multi[el.dataset.tNote]) state._multi[el.dataset.tNote].note = el.value.trim(); });
  };

  const submit = async () => {
    if (q.type === 'interstitial') return advance();
    if (q.type === 'radio') {
      // Selection already saved on click — Enter/Next just moves on, which
      // is what makes a prefilled re-apply walk fast to step through.
      if (q.required && !(state.answers[q.fields[0]] || '').trim()) return showErr('Pick one to continue.');
      return advance();
    }
    if (q.type === 'multi') {
      syncMulti();
      if (q.required && !Object.keys(state._multi).length) return showErr('Pick at least one to continue.');
      const composed = composeTracks(q, state._multi);
      Object.assign(state.answers, composed);
      // The listing link needs the row to exist — wait for the save that
      // creates it before syncing listing_id.
      await saveFields(composed);
      syncListingSelection(q);
      return advance();
    }
    const fields = collect(q);
    if (q.required && Object.values(fields).every((x) => !x)) return showErr('This one’s required.');
    Object.assign(state.answers, fields);
    saveFields(fields); // fire-and-forget; the save chip reports failures
    advance();
  };

  const goBack = () => {
    if (state.fromReview) { state.fromReview = false; return go('review'); }
    const list = AQ();
    const i = list.findIndex((x) => x.id === q.id);
    const pq = i > 0 ? list[i - 1] : null;
    go(pq ? 'q:' + pq.id : 'code');
  };

  // Esc bails to the overview, keeping whatever is typed so far.
  const exitToOverview = () => {
    if (q.type === 'multi') {
      syncMulti();
      if (Object.keys(state._multi).length) {
        const composed = composeTracks(q, state._multi);
        Object.assign(state.answers, composed);
        saveFields(composed).then(() => syncListingSelection(q));
      }
    } else if (q.type !== 'interstitial' && q.type !== 'radio') {
      const fields = collect(q);
      Object.assign(state.answers, fields);
      if (Object.values(fields).some(Boolean)) saveFields(fields);
    }
    state.fromReview = false;
    go('review');
  };

  document.getElementById('next').onclick = submit;
  const back = document.getElementById('back');
  if (back) back.onclick = goBack;

  if (q.type === 'radio') {
    $screen.querySelectorAll('.apply-choice').forEach((el) => {
      el.onclick = () => {
        const val = el.dataset.value;
        state.answers[q.fields[0]] = val;
        $screen.querySelectorAll('.apply-choice').forEach((x) => x.classList.toggle('selected', x === el));
        saveFields({ [q.fields[0]]: val });
        setTimeout(advance, 200);
      };
    });
  } else if (q.type === 'multi') {
    $screen.querySelectorAll('.apply-choice').forEach((el) => {
      el.onclick = () => {
        syncMulti();
        const label = el.dataset.value;
        if (state._multi[label]) delete state._multi[label];
        else state._multi[label] = { date: '', dateEnd: '', flex: false, note: '' };
        renderQuestion(q); // re-render so the timing fields follow the selection
      };
    });
    // Flexible hides the latest-date bound — a firm deadline and "flexible"
    // contradict each other. Re-render so the field follows the toggle.
    $screen.querySelectorAll('[data-t-flex]').forEach((el) => {
      el.onchange = () => { syncMulti(); renderQuestion(q); };
    });
  } else {
    const first = $screen.querySelector('input, textarea');
    if (first) first.focus();
  }

  // One keyboard scheme for every question screen: Enter advances (plain
  // Enter stays a newline inside a textarea — Cmd/Ctrl+Enter sends those),
  // arrows move between questions when not typing, Esc jumps to the overview.
  state._keyHandler = (e) => {
    if (state.screen !== 'q:' + q.id) return;
    const t = e.target;
    const typing = Boolean(t && t.matches && t.matches('input, textarea'));
    const inTextarea = Boolean(t && t.matches && t.matches('textarea'));
    if (e.key === 'Escape') { e.preventDefault(); return exitToOverview(); }
    if (e.key === 'Enter') {
      if (inTextarea && !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault(); return submit();
    }
    // Arrows navigate even from inside a field — speed beats cursor movement
    // in a one-question-per-screen form.
    if (e.key === 'ArrowRight') { e.preventDefault(); return submit(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); return goBack(); }
    if ((q.type === 'radio' || q.type === 'multi') && !typing) {
      const i = parseInt(e.key, 10) - 1;
      if (i >= 0 && i < q.options.length) $screen.querySelectorAll('.apply-choice')[i].click();
    }
  };
  document.addEventListener('keydown', state._keyHandler);
}

function renderReview() {
  const submitted = state.app?.is_submitted;
  const rows = AQ().filter((q) => q.type !== 'interstitial').map((q) => {
    const val = q.id === 'residency'
      ? prettyTracks(q)
      : q.fields.map((f) => state.answers[f] || '').filter(Boolean).join(q.type === 'name' ? ' ' : ' · ');
    return `<div class="apply-review__row" data-q="${q.id}">
      <span class="apply-review__label">${esc(q.label)}</span>
      <span class="apply-review__value ${val ? '' : 'empty'}">${esc(val || '—')}</span>
      <span class="apply-review__edit">edit</span>
    </div>`;
  }).join('');
  $screen.innerHTML = `
    ${submitted ? '<div class="apply-banner"><strong>Application submitted.</strong> You can still update any answer here until the house makes a decision — edits save automatically.</div>' : ''}
    <h1 class="apply-q__title">${submitted ? 'Your application' : 'Look it over.'}</h1>
    <p class="apply-q__hint">${submitted ? 'Signed in as ' + esc(state.email || state.app?.email || '') + '.' : 'Tap any answer to change it, then send it in.'}</p>
    <div class="apply-review">${rows}</div>
    ${submitted && feeDue() ? `<div class="apply-banner">The ${feeLabel()} application fee is still owed — your application counts once it's in.</div>` : ''}
    ${nav(submitted
      ? (feeDue() ? `<button class="btn btn--filled" id="pay">Pay the ${feeLabel()} fee</button>` : '') +
        '<button class="btn btn--ghost" id="signout">sign out</button>'
      : `<button class="btn btn--filled btn--lg" id="submit">${feeDue() ? 'Submit & pay the ' + feeLabel() + ' fee' : 'Submit application'}</button>`)}`;
  $screen.querySelectorAll('.apply-review__row').forEach((el) => {
    el.onclick = () => { state.fromReview = true; go('q:' + el.dataset.q); };
  });
  const sBtn = document.getElementById('submit');
  if (sBtn) sBtn.onclick = async () => {
    sBtn.disabled = true; sBtn.textContent = 'Sending…';
    const { data, error } = await sb.rpc('recruit_apply_submit');
    if (error) { sBtn.disabled = false; sBtn.textContent = 'Submit application'; return showErr(error.message.replace(/^.*?: /, '')); }
    state.app = data;
    track('submitted');
    // Program applications: payment is the last gate — hand off to the
    // Stripe Payment Link; its return URL lands back here with ?payment=.
    if (feeDue() && state.app.listing?.payment_link) return payRedirect();
    go('done');
  };
  const payBtn = document.getElementById('pay');
  if (payBtn) payBtn.onclick = payRedirect;
  const out = document.getElementById('signout');
  if (out) out.onclick = async () => { await sb.auth.signOut(); state.answers = {}; state.app = null; go('welcome'); };
}

function renderDone() {
  const paid = state.app?.payment_status === 'paid';
  const owes = feeDue() && state.app?.is_submitted;
  $screen.innerHTML = `
    <div class="apply-intro__mark">✳</div>
    <h1 class="apply-q__title">It's in. Thank you.</h1>
    ${paid && state.app?.listing ? '<div class="apply-banner"><strong>Fee received.</strong> You’re all set.</div>' : ''}
    ${owes ? `<div class="apply-banner">One last step — the ${feeLabel()} application fee. Your application counts once it's in.</div>` : ''}
    <p class="apply-q__hint">A housemate will read it soon — every application gets a real read. We'll reach out about next steps, and if anything comes up meanwhile, write us at <a href="mailto:live.at.agapesf@gmail.com" style="color:var(--fg)">live.at.agapesf@gmail.com</a>. Come back to this page any time to update your answers.</p>
    ${owes ? `<button class="btn btn--filled" id="pay">Pay the ${feeLabel()} fee</button> ` : ''}
    <button class="btn btn--ghost" id="view">View my application</button>`;
  const payBtn = document.getElementById('pay');
  if (payBtn) payBtn.onclick = payRedirect;
  document.getElementById('view').onclick = () => go('review');
}

function renderLocked() {
  const stage = state.app?.stage || '';
  const canReapply = Boolean(state.app?.can_reapply);
  const returnAfter = state.app?.return_after
    ? new Date(state.app.return_after + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;
  const msg = stage === 'candidate'
    ? 'Good news — your application has moved forward. Keep an eye on your email; a housemate will be in touch about next steps.'
    : returnAfter
      ? `This round didn't line up, but the house suggested checking back around ${returnAfter}. Things change — rooms open, timing shifts. You're welcome to apply again.`
      : 'Your application has been reviewed and this round is closed. Thanks for the time you put into it — and the door isn’t locked: you can apply again whenever things feel different.';
  $screen.innerHTML = `
    <div class="apply-banner"><strong>Application ${stage === 'candidate' ? 'moved forward' : 'closed'}.</strong></div>
    <h1 class="apply-q__title">${stage === 'candidate' ? 'You’re in review for a spot.' : 'This application is closed.'}</h1>
    <p class="apply-q__hint">${msg}</p>
    ${nav((canReapply ? '<button class="btn btn--filled" id="reapply">Apply again</button>' : '') +
          '<button class="btn btn--ghost" id="signout">sign out</button>')}`;
  const re = document.getElementById('reapply');
  if (re) re.onclick = async () => {
    re.disabled = true; re.textContent = 'Reopening…';
    const { data, error } = await sb.rpc('recruit_apply_reapply');
    if (error) { re.disabled = false; re.textContent = 'Apply again'; return showErr(error.message.replace(/^.*?: /, '')); }
    state.app = data;
    for (const q of QUESTIONS) for (const f of (q.fields || [])) state.answers[f] = data[f] || '';
    track('reapplied');
    // Walk the whole form again, prefilled — stay type, move-in, and budget
    // came back cleared (they age fastest), so those must be answered fresh.
    state.fromReview = false;
    go('q:' + QUESTIONS[0].id);
  };
  document.getElementById('signout').onclick = async () => { await sb.auth.signOut(); state.answers = {}; state.app = null; go('welcome'); };
}

/* ---------- boot ---------- */
(async function boot() {
  $fill.style.width = '2%';
  await loadProgramListings();
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.email = session.user?.email || '';
    await loadApplication();
    if (paymentReturn === 'success' && state.app?.listing) {
      // Back from the Stripe Payment Link. Provisional — the weekly
      // reconciliation is the authoritative record.
      const { data, error } = await sb.rpc('recruit_apply_mark_paid');
      if (!error && data) state.app = data;
      window.history.replaceState(null, '', window.location.pathname);
      return go('done');
    }
    afterAuthRoute();
  } else {
    render();
  }
})();
