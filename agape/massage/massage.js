// Agape house massage day poll · /agape/massage/
// One row per person in house_polls (Supabase "playground"), poll_id = 'massage-2026'.
// The row person = '__meta' carries { chosen_date }; once set, the page asks for in-day hours instead.
// No login. Name is remembered on the device.
// Three beats, dates first: (1) tap the dates, Continue; (2) "Who's voting?", Save writes the row;
// (3) the house's results. A remembered name still starts at the dates and is prefilled on beat 2.
// If the table is missing or the network is down, answers stay on this phone and sync later.
(() => {
  'use strict';

  const SB_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
  const TABLE = 'house_polls';
  const POLL = 'massage-2026';
  const META = '__meta';
  const STORE = 'agape-massage-2026';

  // Didi's dates, as Justine posted them Oct 6 (Oct 28/29 dropped in her correction).
  const DATES = ['2026-10-07', '2026-10-14',
    '2026-11-07', '2026-11-11', '2026-11-15', '2026-11-18',
    '2026-11-23', '2026-11-25', '2026-11-28', '2026-11-30'];
  const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]; // slot starts, 9am to 9pm
  // Untapped = can't. Dates cycle: (nothing) -> can -> maybe -> (nothing). Hours use the same cycle.
  const NEXT = { undefined: 'can', can: 'maybe', maybe: undefined };
  // One scale, shown on every row: untapped reads Can't.
  const WORD = { can: 'Can do', maybe: 'Possible' };
  const CANT = 'Can\u2019t';
  const word = (v) => WORD[v] || CANT;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const keyOf = (name) => name.trim().replace(/\s+/g, ' ').toLowerCase();
  const isAdmin = new URLSearchParams(location.search).has('admin');

  const parts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmt = (iso, opts) => parts(iso).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  const dayLabel = (iso) => fmt(iso, { month: 'short', day: 'numeric' });
  const weekday = (iso) => fmt(iso, { weekday: 'long' });
  const longDate = (iso) => fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' });
  const hourLabel = (h) => { const f = (x) => `${((x + 11) % 12) + 1}${x < 12 ? 'am' : 'pm'}`; return `${f(h)}–${f(h + 1)}`; };

  // ---------- state ----------
  const blank = () => ({ name: '', dates: {}, first: null, second: null, slots: {} });
  let me = blank();
  let dirty = false;         // local answers not yet on the server
  let pending = false;       // the final Next was pressed but the write has not landed yet
  let submitted = false;     // this phone has been through both beats; results are shown only after that
  let rows = new Map();      // person key -> answers (other people, from the server)
  let meta = {};
  const cloud = { sb: null, live: false, timer: null, retry: null };

  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.me) { me = { ...blank(), ...saved.me }; dirty = !!saved.dirty; pending = !!saved.pending; submitted = !!saved.submitted; meta = saved.meta || {}; }
  } catch (_) { /* private mode: run without memory */ }

  const persistLocal = () => {
    try { localStorage.setItem(STORE, JSON.stringify({ me, dirty, pending, submitted, meta })); } catch (_) {}
  };

  // ---------- saved mark ----------
  let fadeT = null;
  function mark(text, err) {
    const el = $('saved');
    el.textContent = text; el.classList.toggle('err', !!err); el.style.opacity = 1;
    clearTimeout(fadeT);
    if (!err) fadeT = setTimeout(() => { el.style.opacity = 0; }, 1800);
  }

  // ---------- render ----------
  const hasName = () => keyOf(me.name).length > 0;
  const phase2 = () => !!meta.chosen_date;

  // 'dates' -> 'name' -> 'results'. A visitor who already submitted on this phone lands on results.
  let beat = submitted && me.name ? 'results' : 'dates';
  const answered = () => (phase2()
    ? Object.values(me.slots).some((v) => v === 'can' || v === 'maybe')
    : Object.values(me.dates).some((v) => v === 'can' || v === 'maybe'));

  function render() {
    document.body.dataset.beat = beat;
    const name = $('name');
    if (document.activeElement !== name && beat !== 'name') name.value = me.name || '';
    phase2() ? renderSlots() : renderDates();
    $('continue').disabled = !answered();
    $('me-name').textContent = me.name || '';
    $('not-you').hidden = !me.name || keyOf(name.value) !== keyOf(me.name);
    renderResults();
    renderAdmin();
  }

  function go(next) {
    beat = next;
    render();
    window.scrollTo(0, 0);
    if (next === 'name') {
      const n = $('name');
      n.value = me.name || '';
      $('not-you').hidden = !me.name;
      if (!me.name) n.focus();
    }
  }

  function renderDates() {
    $('sub').textContent = 'Didi is coming to the house. Tap a date: Can do, then Possible, then back to Can\u2019t.';
    const rowsHtml = DATES.map((d) => {
      const v = me.dates[d] === 'can' || me.dates[d] === 'maybe' ? me.dates[d] : '';
      const star = me.first === d ? 1 : me.second === d ? 2 : 0;
      const starText = star === 1 ? '1st' : star === 2 ? '2nd' : 'star';
      const starBtn = v === 'can'
        ? `<button class="star${star ? ' on' : ''}" data-star="${d}"
          aria-label="${star ? (star === 1 ? 'First pick' : 'Second pick') : 'Not starred'}. Tap to star ${esc(dayLabel(d))}.">
          ${star ? '★' : '☆'}<small>${starText}</small></button>` : '';
      return `<div class="tile row" data-v="${v}">
        <button class="cycle" data-date="${d}" aria-label="${esc(longDate(d))}: ${word(v)}. Tap to change.">
          <span class="l"><span class="d">${esc(weekday(d))}</span> <span class="w">${esc(dayLabel(d))}</span></span>
          <span class="s">${word(v)}</span>
        </button>${starBtn}
      </div>`;
    }).join('');
    const anyCan = DATES.some((d) => me.dates[d] === 'can');
    // The sub line already says untapped = can't and tap again = maybe, so the only legend is the star hint.
    // It always holds its line (dimmed until a date is a can) so the first tap never shifts the rows.
    const hint = `<p class="legend${anyCan ? '' : ' is-off'}">☆ Star your top two (optional)</p>`;
    $('vote').innerHTML = `${hint}<div class="list">${rowsHtml}</div>`;
  }

  function renderSlots() {
    const d = meta.chosen_date;
    $('sub').textContent = 'Which hours work for you that day? Tap an hour: Can do, then Possible, then back to Can\u2019t.';
    const tiles = HOURS.map((h) => {
      const v = me.slots[h];
      return `<div class="tile" data-v="${v || ''}">
        <button class="cycle" data-hour="${h}" aria-label="${hourLabel(h)}: ${word(v)}. Tap to change.">
          <span class="d">${hourLabel(h)}</span>
          <span class="s">${word(v)}</span>
        </button>
      </div>`;
    }).join('');
    $('vote').innerHTML = `<div class="chosen">The day is <b>${esc(longDate(d))}</b>.</div><div class="grid slots">${tiles}</div>`;
  }

  function everyone() {
    const all = new Map(rows);
    if (hasName()) all.set(keyOf(me.name), me);
    return [...all.values()].filter((a) => a && a.name);
  }

  function namesLine(list, cls, label) {
    return list.length ? `<span class="${cls || ''}">${label}: ${list.map(esc).join(', ')}</span>` : '';
  }

  function renderResults() {
    if (!submitted) { $('results').innerHTML = ''; $('count-line').textContent = ''; return; }
    const people = everyone();
    $('count-line').textContent = people.length ? `· ${people.length} ${people.length === 1 ? 'person' : 'people'} answered` : '';
    const ul = $('results');
    if (!people.length) { ul.innerHTML = '<li class="empty">Nobody has answered yet. Be the first.</li>'; return; }

    if (phase2()) {
      $('results-title').firstChild.textContent = 'Hours so far ';
      const list = HOURS.map((h) => tally(people, (a) => a.slots && a.slots[h]));
      const best = Math.max(...list.map((t) => t.can.length));
      ul.innerHTML = HOURS.map((h, i) => item(hourLabel(h), list[i], people.length, best > 0 && list[i].can.length === best, '')).join('');
      return;
    }

    $('results-title').firstChild.textContent = 'The house so far ';
    const list = DATES.map((d) => {
      const t = tally(people, (a) => a.dates && a.dates[d]);
      t.date = d;
      t.firsts = people.filter((a) => a.first === d).length;
      t.seconds = people.filter((a) => a.second === d).length;
      return t;
    });
    list.sort((a, b) => b.can.length - a.can.length || b.maybe.length - a.maybe.length
      || b.firsts - a.firsts || b.seconds - a.seconds || a.date.localeCompare(b.date));
    ul.innerHTML = list.map((t, i) => {
      const stars = t.firsts || t.seconds
        ? `<div class="who">★ ${t.firsts} first · ${t.seconds} second</div>` : '';
      const pick = isAdmin ? `<button class="pick" data-choose="${t.date}">Pick this day</button>` : '';
      const when = `${dayLabel(t.date)} · ${weekday(t.date).slice(0, 3)}`;
      return item(when, t, people.length, i === 0 && t.can.length > 0, stars + pick);
    }).join('');
  }

  function tally(people, get) {
    const t = { can: [], maybe: [] };
    people.forEach((a) => { const v = get(a); if (t[v]) t[v].push(a.name); });
    return t;
  }

  function item(when, t, total, lead, extra) {
    const pc = (n) => (total ? (100 * n) / total : 0);
    const who = [namesLine(t.can, '', WORD.can), namesLine(t.maybe, '', WORD.maybe)]
      .filter(Boolean).join(' · ');
    return `<li>
      <div class="top"><span class="when">${esc(when)}</span>
        <span class="nums"><span class="c">${t.can.length} can do</span> · <span class="m">${t.maybe.length} possible</span></span></div>
      <div class="bar"><i class="c" style="width:${pc(t.can.length)}%"></i><i class="m" style="width:${pc(t.maybe.length)}%"></i></div>
      ${who ? `<div class="who">${who}</div>` : ''}${extra}
    </li>`;
  }

  function renderAdmin() {
    const el = $('admin-row');
    if (!isAdmin) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = phase2()
      ? `Organizer view. <button data-unchoose="1">Back to the date vote</button>`
      : 'Organizer view: “Pick this day” on a result switches everyone to the hours grid.';
  }

  // ---------- taps ----------
  function needName() {
    const el = $('name');
    el.classList.remove('want'); void el.offsetWidth; el.classList.add('want');
    el.focus();
    mark('Add your name first', true);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.choose) return setMeta({ chosen_date: b.dataset.choose });
    if (b.dataset.unchoose) return setMeta({ chosen_date: null });
    if (b.id === 'continue') { if (answered()) go('name'); return; }
    if (b.id === 'save') return save();
    if (b.id === 'back') return go('dates');
    if (b.id === 'edit') return go('dates');
    if (b.id === 'not-you') {
      // Someone else on a shared phone: keep the dates just tapped, drop the remembered name.
      nameEl.value = ''; b.hidden = true; nameEl.focus();
      return;
    }

    if (b.dataset.date) {
      const d = b.dataset.date;
      const v = NEXT[me.dates[d] === 'no' ? undefined : me.dates[d]];
      if (v) me.dates[d] = v; else delete me.dates[d];
      if (v !== 'can') { if (me.first === d) me.first = null; if (me.second === d) me.second = null; }
    } else if (b.dataset.star) {
      const d = b.dataset.star;
      if (me.dates[d] !== 'can') return;
      // One tile cycles: none → 1st → 2nd → none. A new tile takes 1st if it is free, else 2nd.
      if (me.first === d) { me.first = null; me.second = d; }
      else if (me.second === d) me.second = null;
      else if (!me.first) me.first = d;
      else me.second = d;
    } else if (b.dataset.hour) {
      const h = b.dataset.hour;
      const nv = NEXT[me.slots[h]];
      if (nv) me.slots[h] = nv; else delete me.slots[h];
    } else return;

    changed();
  });

  // The name lives on beat 2. Enter or Save writes the row under it, with the dates tapped on beat 1.
  const nameEl = $('name');
  nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  function save() {
    let v = nameEl.value.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (v.startsWith('__')) v = v.replace(/^_+/, '');
    nameEl.value = v;
    if (!v) return needName();
    me.name = v;
    rows.delete(keyOf(v));   // these answers replace whatever that name had on the server
    dirty = true;
    pending = true;
    submitted = true;
    persistLocal();
    push().then(() => { if (cloud.live) load().catch(() => {}); });
    go('results');
  }

  // Taps are kept on the phone; nothing is written until Save names whose answers they are.
  function changed() {
    dirty = true;
    persistLocal();
    render();
  }

  // ---------- cloud ----------
  function localNotice(on) {
    const n = $('notice');
    n.hidden = !on;
    n.textContent = 'Live sharing isn’t switched on yet, so your answers are kept on this phone for now. They’ll sync once it is.';
  }

  async function push() {
    if (!hasName()) return;
    if (!cloud.live) { mark('Saved on this phone'); return; }
    const keep = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v === 'can' || v === 'maybe'));
    const answers = { ...me, dates: keep(me.dates), slots: keep(me.slots), updated: new Date().toISOString() };
    const { error } = await cloud.sb.from(TABLE).upsert(
      { poll_id: POLL, person: keyOf(me.name), answers, updated_at: new Date().toISOString() },
      { onConflict: 'poll_id,person' });
    if (error) {
      mark('Not saved yet, retrying', true);
      clearTimeout(cloud.retry);
      cloud.retry = setTimeout(push, 5000);
      return;
    }
    dirty = false;
    pending = false;
    persistLocal();
    mark('Saved ✓');
  }

  async function setMeta(patch) {
    if (!cloud.live) { mark('Needs live sharing', true); return; }
    const next = { ...meta, ...patch };
    const { error } = await cloud.sb.from(TABLE).upsert(
      { poll_id: POLL, person: META, answers: next, updated_at: new Date().toISOString() },
      { onConflict: 'poll_id,person' });
    if (error) { mark('Could not save the day', true); return; }
    meta = next; persistLocal(); render(); mark('Saved ✓');
  }

  async function load() {
    const { data, error } = await cloud.sb.from(TABLE).select('person, answers, updated_at').eq('poll_id', POLL);
    if (error) throw error;
    const next = new Map();
    let nextMeta = {};
    (data || []).forEach((r) => {
      if (r.person === META) nextMeta = r.answers || {};
      else if (!r.person.startsWith('__')) next.set(r.person, r.answers || {});
    });
    rows = next;
    meta = nextMeta;
    // Another device answered under this name and nothing here is waiting to save: take theirs.
    const mine = hasName() && rows.get(keyOf(me.name));
    if (mine && !dirty) me = { ...blank(), ...mine, name: me.name };
    rows.delete(keyOf(me.name));
    persistLocal();
    render();
  }

  async function start() {
    render();
    if (!window.supabase || !window.supabase.createClient) { localNotice(true); return; }
    cloud.sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    try {
      await load();
    } catch (err) {
      console.warn('house_polls unavailable, running local-only', err);
      localNotice(true);
      return;
    }
    cloud.live = true;
    localNotice(false);
    if (pending) push();

    try {
      cloud.sb.channel('house-polls-' + POLL)
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `poll_id=eq.${POLL}` },
          () => load().catch(() => {}))
        .subscribe();
    } catch (_) { /* polling below covers it */ }
    setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load().catch(() => {}); });
  }

  start();
})();
