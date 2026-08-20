/* /apply — Agape's application, one question at a time.
   Auth is the first question: an email OTP signs the applicant in, so every
   answer after it saves server-side (recruit_apply_save RPC, migration 170)
   and the applicant can come back any time to pick up or edit — until the
   house makes a decision, at which point the RPCs lock the row. */

const VERSION = '1.1.0';
console.log(`[apply] v${VERSION} — native application form`);

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
    id: 'residency', type: 'radio', fields: ['residency'], required: true,
    label: 'What kind of stay are you looking for?',
    options: ['Full-time resident', 'Short-term (sublet)'],
  },
  {
    id: 'move_in', type: 'date', fields: ['move_in'], required: true,
    label: "What's the soonest you could move in?",
    hint: 'Rooms open up when they open up — no waitlist math here. Folks who can hop in when a spot frees up tend to move to the front.',
  },
  {
    id: 'budget', type: 'radio', fields: ['budget'], required: true,
    label: "What's your monthly budget?",
    options: ['Under $1,500/mo', '$1,500–$2,000/mo', '$2,000–$2,500/mo', '$2,500+/mo'],
  },
  {
    id: 'essays', type: 'interstitial',
    label: 'The next three questions matter most.',
    hint: 'A real person reads every application — what you share here is how we get a feel for whether the house would be a good fit for you, and you for it. Take your time.',
  },
  {
    id: 'why_agape', type: 'textarea', fields: ['why_agape'], required: true,
    label: 'Why Agape?',
    hint: "What drew you here? The honest version beats the polished one.",
  },
  {
    id: 'about', type: 'textarea', fields: ['about'], required: false,
    label: 'Tell us about yourself.',
    hint: 'Whatever feels true — how you spend your time, what you care about, what a good week looks like.',
  },
  {
    id: 'gifts', type: 'textarea', fields: ['gifts'], required: false,
    label: 'What would you bring to the house?',
    hint: "Cooking, music, deep questions at dinner, fixing things — everyone's list is different.",
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
];

/* ---------- state ---------- */
const state = {
  email: '',
  answers: {},        // column → value
  app: null,          // recruit_apply_load() result
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
  for (const q of QUESTIONS) {
    if (q.type === 'interstitial') continue;
    if (q.required && q.fields.every((f) => !(state.answers[f] || '').trim())) return q.id;
  }
  return null;
}

function progressFor(screen) {
  const pre = ['welcome', 'email', 'code'];
  const total = pre.length + QUESTIONS.length + 1; // + review
  let done = 0;
  if (pre.includes(screen)) done = pre.indexOf(screen);
  else if (screen.startsWith('q:')) done = pre.length + questionIndex(screen.slice(2));
  else done = total - (screen === 'review' ? 1 : 0);
  return Math.round((done / total) * 100);
}

function go(screen) {
  state.screen = screen;
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

function nav(html = '') {
  return `<div class="apply-nav">${html}<span class="apply-nav__enter">press enter ↵</span></div>
          <div class="apply-error" id="err"></div>`;
}

function bindEnter(fn) {
  $screen.querySelectorAll('input:not([type=checkbox])').forEach((el) => {
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } });
  });
}

function showErr(msg) { const el = document.getElementById('err'); if (el) el.textContent = msg; }

function renderWelcome() {
  $screen.innerHTML = `
    <div class="apply-intro__mark">agape</div>
    <h1 class="apply-q__title">Apply to live with us.</h1>
    <p class="apply-q__hint">This takes about ten minutes, and you can leave and come back any time — your answers save as you go. We'll start with your email so you can always find your way back in.</p>
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
    return q.options.map((opt, i) => `
      <button type="button" class="apply-choice ${opt === cur ? 'selected' : ''}" data-value="${esc(opt)}">
        <span class="apply-choice__key">${i + 1}</span>${esc(opt)}
      </button>`).join('');
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
  const idx = questionIndex(q.id);
  const n = QUESTIONS.filter((x) => x.type !== 'interstitial').indexOf(q) + 1;
  const total = QUESTIONS.filter((x) => x.type !== 'interstitial').length;

  if (q.type === 'interstitial') {
    $screen.innerHTML = `
      <h1 class="apply-q__title">${esc(q.label)}</h1>
      <p class="apply-q__hint">${esc(q.hint)}</p>
      ${nav('<button class="btn btn--filled" id="next">I’m ready</button><button class="apply-back" id="back">back</button>')}`;
  } else {
    $screen.innerHTML = `
      <div class="apply-q__count">${n} / ${total}${q.required ? '' : ' · optional'}</div>
      <h1 class="apply-q__title">${esc(q.label)}</h1>
      ${q.hint ? `<p class="apply-q__hint">${esc(q.hint)}</p>` : ''}
      <div class="apply-q">${inputHtml(q)}</div>
      ${nav(`<button class="btn btn--filled" id="next">${state.fromReview ? 'Save' : 'Next'}</button>` +
            (idx > 0 || state.fromReview ? '<button class="apply-back" id="back">back</button>' : ''))}`;
  }

  const advance = () => {
    if (state.fromReview) { state.fromReview = false; go('review'); }
    else {
      const nq = QUESTIONS[idx + 1];
      go(nq ? 'q:' + nq.id : 'review');
    }
  };

  const submit = async () => {
    if (q.type === 'interstitial') return advance();
    const fields = collect(q);
    if (q.required && Object.values(fields).every((x) => !x)) return showErr('This one’s required.');
    Object.assign(state.answers, fields);
    saveFields(fields); // fire-and-forget; the save chip reports failures
    advance();
  };

  document.getElementById('next').onclick = submit;
  const back = document.getElementById('back');
  if (back) back.onclick = () => {
    if (state.fromReview) { state.fromReview = false; return go('review'); }
    const pq = QUESTIONS[idx - 1];
    go(pq ? 'q:' + pq.id : 'code');
  };

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
    document.addEventListener('keydown', function pick(e) {
      const i = parseInt(e.key, 10) - 1;
      if (state.screen !== 'q:' + q.id) return document.removeEventListener('keydown', pick);
      if (i >= 0 && i < q.options.length) $screen.querySelectorAll('.apply-choice')[i].click();
    });
  } else {
    bindEnter(submit);
    const first = $screen.querySelector('input, textarea');
    if (first) first.focus();
    // Cmd/Ctrl+Enter submits a textarea (plain Enter is a newline there).
    $screen.querySelectorAll('textarea').forEach((el) => {
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
    });
  }
}

function renderReview() {
  const submitted = state.app?.is_submitted;
  const rows = QUESTIONS.filter((q) => q.type !== 'interstitial').map((q) => {
    const val = q.fields.map((f) => state.answers[f] || '').filter(Boolean).join(' · ');
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
    ${nav(submitted
      ? '<button class="btn btn--ghost" id="signout">sign out</button>'
      : '<button class="btn btn--filled btn--lg" id="submit">Submit application</button>')}`;
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
    go('done');
  };
  const out = document.getElementById('signout');
  if (out) out.onclick = async () => { await sb.auth.signOut(); state.answers = {}; state.app = null; go('welcome'); };
}

function renderDone() {
  $screen.innerHTML = `
    <div class="apply-intro__mark">✳</div>
    <h1 class="apply-q__title">It's in. Thank you.</h1>
    <p class="apply-q__hint">A housemate will read it soon — every application gets a real read. We'll reach out at ${esc(state.email || state.app?.email || 'your email')} about next steps. Come back to this page any time to update your answers.</p>
    <button class="btn btn--ghost" id="view">View my application</button>`;
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
    go('review'); // prefilled — they refresh what changed and resubmit
  };
  document.getElementById('signout').onclick = async () => { await sb.auth.signOut(); state.answers = {}; state.app = null; go('welcome'); };
}

/* ---------- boot ---------- */
(async function boot() {
  $fill.style.width = '2%';
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    state.email = session.user?.email || '';
    await loadApplication();
    afterAuthRoute();
  } else {
    render();
  }
})();
