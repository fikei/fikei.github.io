/* Agape Halloween theater — run of show
   Schedule the theater acts across the day of the party and track what each
   one needs. Two lanes on one clock: arrive / pre-party setup (before doors)
   and the theater itself (changeover + show during the party). No backend:
   the seed is a snapshot of the email threads (data/theater.json); edits live
   in localStorage and travel as a share link or a JSON export. */

const VERSION = '1.5.1';
console.log(`[halloween-theater] v${VERSION} - theater run of show (shared backend: Supabase, Discord sign-in)`);

const STORE_KEY = 'halloween-theater-v1';
const THEME_KEY = 'halloween-theme';
const NOON = 12 * 60;            // the timeline starts at noon on party day
const SPAN = 21 * 60;            // …and runs to 9am the next morning
const PX = 1.2;                  // px per minute (matches --tl-px)
const SHOW_PREP = false;         // arrive / pre-party lane hidden for now (data is kept)
const SNAP = 5;                  // drag snaps to 5 min
const DEF = { run: 30, changeover: 15, prep: 30 };   // drawn when a value is still TBD
const CATS = { info: 'Info', av: 'AV', setup: 'Setup', tix: 'Tickets', money: 'Artist pay', comms: 'Comms' };
const STATUS = { confirmed: 'Confirmed', pending: 'Pending', declined: 'Declined' };

let seed = null;
let state = null;
const REFLOW_KEY = 'halloween-theater-reflow';
let ui = { sel: null, view: 'timeline', panel: 'acts', needs: 'open', dirty: false, reflow: true, bannerYes: null };
try { ui.reflow = localStorage.getItem(REFLOW_KEY) !== 'off'; } catch (_) {}

// ---------- state ----------
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function fromSeed() { return { event: clone(seed.event), acts: clone(seed.acts), rev: seed.rev || 1, updated: null }; }
// A newer seed (acts added from later emails/requests) merges into saved edits once:
// new acts are appended, event fields that didn't exist yet are filled, nothing saved is overwritten.
function upgrade(s) {
  if ((s.rev || 1) >= (seed.rev || 1)) return s;
  const have = new Set(s.acts.map(a => a.id));
  const added = seed.acts.filter(a => !have.has(a.id));
  s.acts.push(...clone(added));
  s.event = { ...clone(seed.event), ...s.event };
  s.rev = seed.rev;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {}
  setTimeout(() => toast(added.length
    ? `Added ${added.map(a => a.project).join(', ')} — your saved times were kept (Reset loads the new draft)`
    : 'A newer draft is available — Reset loads it (replaces your local edits)'), 300);
  return s;
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && Array.isArray(s.acts) && s.event) return upgrade(s);
  } catch (_) { /* fall through */ }
  return fromSeed();
}
function save() {
  if (readOnly()) { toast('Sign in with Discord to edit', true); return; }
  state.updated = new Date().toISOString();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { toast('Could not save locally', true); }
  if (cloud.live && cloud.member) queuePush();
}
const actById = id => state.acts.find(a => a.id === id);
const live = () => state.acts.filter(a => a.status !== 'declined');

// ---------- time ----------
// "HH:MM" → minutes after noon on party day (times before noon belong to the next morning).
function toMin(t) {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return (h < 12 ? h + 24 : h) * 60 + m - NOON;
}
function toHHMM(v) { const a = ((v + NOON) % 1440 + 1440) % 1440; return pad(Math.floor(a / 60)) + ':' + pad(a % 60); }
function fmt(v) {
  if (v == null) return 'TBD';
  const a = ((v + NOON) % 1440 + 1440) % 1440; let h = Math.floor(a / 60); const m = a % 60;
  const ap = h >= 12 ? 'p' : 'a'; h = h % 12 || 12;
  return h + (m ? ':' + pad(m) : '') + ap;
}
function pad(n) { return String(n).padStart(2, '0'); }
const doors = () => toMin(state.event.doors) ?? 540;
const showsStart = () => toMin(state.event.shows) ?? doors();
const timelineStart = () => SHOW_PREP ? 0 : doors();

// ---------- schedule model ----------
function showBlocks() {
  const out = [];
  // First show of an act gets the full changeover; repeat shows only the reset.
  // Strike (tear-down) hangs off the act's last show.
  live().forEach(a => {
    const mine = a.slots.map((s, i) => ({ i, start: toMin(s) })).filter(x => x.start != null).sort((x, y) => x.start - y.start);
    mine.forEach((x, k) => {
      const run = a.run ?? DEF.run;
      const repeat = k > 0 && a.reset != null;
      const co = repeat ? a.reset : (a.changeover ?? DEF.changeover);
      const last = k === mine.length - 1;
      const strike = last ? (a.strike || 0) : 0;
      out.push({ act: a, i: x.i, start: x.start, end: x.start + run, stop: x.start + run + strike, strike, coStart: x.start - co, repeat,
        runGuess: a.run == null, coGuess: !repeat && a.changeover == null });
    });
  });
  return out.sort((x, y) => x.start - y.start);
}
function prepBlocks() {
  return live().filter(a => toMin(a.arrive) != null).map(a => {
    const start = toMin(a.arrive);
    return { act: a, start, end: start + (a.prep ?? DEF.prep), guess: a.prep == null };
  }).sort((x, y) => x.start - y.start);
}
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

function issuesFor(a) {
  if (a.status === 'declined') return [];
  const out = [];
  const d = doors();
  if (!a.slots.length) out.push('No theater slot yet');
  if (a.run == null) out.push('Run time TBD');
  if (a.changeover == null) out.push('Changeover (setup during party) TBD');
  if (SHOW_PREP && a.arrive == null) out.push('Arrival / pre-party setup TBD');
  const shows = showBlocks();
  shows.filter(b => b.act === a).forEach(b => {
    const label = `Slot ${fmt(b.start)}`;
    if (b.stop > SPAN) out.push(`${label} runs past the end of the party (${fmt(SPAN)})`);
    if (b.start < d) out.push(`${label} starts before doors`);
    else if (b.start < showsStart()) out.push(`${label} starts before shows begin (${fmt(showsStart())})`);
    if (a.earliest && b.start < toMin(a.earliest)) out.push(`${label} is before their earliest (${fmt(toMin(a.earliest))})`);
    if (a.latest && b.end > toMin(a.latest)) out.push(`${label} runs past their latest (${fmt(toMin(a.latest))})`);
    shows.filter(o => o.act !== a && overlaps(b.coStart, b.stop, o.coStart, o.stop))
      .forEach(o => out.push(`${label} collides with ${o.act.project} ${fmt(o.start)} (counting changeover/strike)`));
    shows.filter(o => o.act === a && o.start > b.start && o.coStart < b.end)
      .forEach(o => out.push(`${label} overlaps their next show ${fmt(o.start)}`));
  });
  const p = SHOW_PREP && prepBlocks().find(b => b.act === a);
  if (p) {
    if (p.end > d) out.push('Pre-party setup runs past doors');
    prepBlocks().filter(o => o.act !== a && overlaps(p.start, p.end, o.start, o.end))
      .forEach(o => out.push(`Load-in shares the room with ${o.act.project}`));
  }
  return out;
}
const openNeeds = a => a.needs.filter(n => !n.done).length;

// Greedy columns so overlapping blocks sit side by side instead of on top of each other.
function columns(blocks, s = b => b.start, e = b => b.end) {
  const ends = [];
  blocks.forEach(b => {
    let c = ends.findIndex(x => x <= s(b)); if (c < 0) { c = ends.length; ends.push(0); }
    ends[c] = e(b); b.col = c;
  });
  blocks.forEach(b => { b.cols = Math.max(1, ...blocks.filter(o => overlaps(s(b), e(b), s(o), e(o))).map(o => o.col + 1)); });
  return blocks;
}

// ---------- render ----------
function render() { renderActs(); renderPlan(); renderDetail(); }
// View-only visitors: disable every editing control after each paint.
function lockUI() {
  const ro = readOnly();
  document.body.classList.toggle('is-readonly', ro);
  if (!ro) return;
  document.querySelectorAll('#detail input, #detail select, #detail textarea, #detail button:not([data-sel]), #plan input[data-need], #btn-add, #btn-close-gaps, #btn-reset, #btn-import')
    .forEach(el => { el.disabled = true; });
}

function renderActs() { renderActsInner(); lockUI(); }
function renderActsInner() {
  const el = document.getElementById('acts');
  const roomOpen = state.event.needs.filter(n => !n.done).length;
  const cards = [`
    <div class="pcard pcard--room ${ui.sel === 'room' ? 'pcard--selected' : ''}" data-sel="room" role="listitem">
      <div class="pcard__project">Theater room</div>
      <div class="pcard__artist">${esc(state.event.room)}</div>
      <div class="pcard__foot"><span class="tag">Production</span><span class="pcard__needs">${roomOpen} open</span></div>
    </div>`];
  const order = { confirmed: 0, pending: 1, declined: 2 };
  const first = a => Math.min(...a.slots.map(toMin).filter(v => v != null), 9e9);
  [...state.acts].sort((x, y) => order[x.status] - order[y.status] || first(x) - first(y)).forEach(a => {
    const shows = a.slots.map(toMin).filter(v => v != null).sort((x, y) => x - y);
    const when = shows.length ? shows.map(s => `${fmt(s)}–${fmt(s + (a.run ?? DEF.run))}`).join(' · ') : 'Unscheduled';
    const iss = issuesFor(a).length;
    cards.push(`
    <div class="pcard ${ui.sel === a.id ? 'pcard--selected' : ''} ${a.status === 'declined' ? 'pcard--declined' : ''}" data-sel="${esc(a.id)}" role="listitem">
      <div class="pcard__project">${esc(a.project)}</div>
      <div class="pcard__artist">${esc(a.artist)}</div>
      ${a.status === 'declined' ? '' : `<div class="pcard__when ${shows.length ? '' : 'pcard__when--none'}">${when}${SHOW_PREP && a.arrive ? ` <span class="pcard__artist">· in ${fmt(toMin(a.arrive))}</span>` : ''}</div>`}
      <div class="pcard__foot">
        <span class="tag tag--${a.status}">${STATUS[a.status]}</span>
        ${iss ? `<span class="pcard__warn">${iss} to resolve</span>` : ''}
        ${a.grant ? `<span class="pcard__needs" title="What we pay this act, after the event">we pay $${a.grant}</span>` : ''}
        <span class="pcard__needs">${openNeeds(a)}/${a.needs.length} open</span>
      </div>
    </div>`);
  });
  cards.push(`<button class="btn btn--sm btn--ghost" id="btn-add" type="button">+ Add act</button>`);
  el.innerHTML = cards.join('');
}

function renderPlan() { renderPlanInner(); lockUI(); }
function renderPlanInner() {
  document.querySelectorAll('#view-tabs [data-view]').forEach(b => b.classList.toggle('filter-token--active', b.dataset.view === ui.view));
  const allOpen = state.event.needs.filter(n => !n.done).length + live().reduce((s, a) => s + openNeeds(a), 0);
  document.getElementById('needs-count').textContent = allOpen;
  const conf = live().filter(a => a.status === 'confirmed').length;
  const probs = live().reduce((s, a) => s + issuesFor(a).length, 0);
  document.getElementById('summary').textContent = `${conf} confirmed · ${live().length - conf} pending · ${probs} to resolve`;
  document.getElementById('plan').innerHTML = ui.view === 'needs' ? needsHtml() : timelineHtml();
}

function timelineHtml() {
  const ev = state.event, d = doors();
  const T0 = timelineStart(), H = (SPAN - T0) * PX, y = m => (m - T0) * PX;
  const hours = [];
  for (let m = T0; m <= SPAN; m += 60) hours.push(`<div class="tl__hour ${m === d || m === 720 ? 'tl__hour--major' : ''}" style="top:${y(m)}px">${fmt(m)}</div>`);
  const sel = actById(ui.sel);
  const win = sel && (sel.earliest || sel.latest)
    ? `<div class="tl__window" style="top:${y(Math.max(T0, toMin(sel.earliest) ?? d))}px;height:${((toMin(sel.latest) ?? SPAN) - Math.max(T0, toMin(sel.earliest) ?? d)) * PX}px" title="${esc(sel.project)}: their window"></div>` : '';
  const warnSet = new Set(live().filter(a => issuesFor(a).some(i => /collides|before doors|before shows|earliest|latest|past doors|shares the room/.test(i))).map(a => a.id));

  const prep = columns(prepBlocks()).map(b => {
    const w = 100 / b.cols;
    return `<div class="blk blk--prep ${b.guess ? 'blk--guess' : ''} ${ui.sel === b.act.id ? 'blk--sel' : ''} ${warnSet.has(b.act.id) ? 'blk--warn' : ''}"
      data-drag="arrive" data-act="${esc(b.act.id)}" style="top:${y(b.start)}px;height:${Math.max(18, (b.end - b.start) * PX)}px;left:${b.col * w}%;width:${w}%"
      title="${esc(b.act.project)} — arrive ${fmt(b.start)}, setup ${b.act.prep ?? DEF.prep + '? (TBD)'} min">
      <b>${esc(b.act.project)}</b><span class="blk__t">${fmt(b.start)}–${fmt(b.end)}${b.guess ? ' · TBD' : ''}</span></div>`;
  }).join('');

  const shows = columns(showBlocks(), b => b.coStart, b => b.stop).map(b => {
    const w = 100 / b.cols, pos = `left:${b.col * w}%;width:${w}%`;
    const co = b.start - b.coStart;
    const strike = b.strike ? `<div class="blk blk--co blk--strike" style="top:${y(b.end)}px;height:${b.strike * PX}px;${pos}" title="Strike / tear-down: ${b.strike} min">${b.strike * PX >= 14 ? `strike ${b.strike}m` : ''}</div>` : '';
    return `${strike}<div class="blk blk--co ${b.coGuess ? 'blk--guess' : ''}" style="top:${y(b.coStart)}px;height:${co * PX}px;${pos}" title="${b.repeat ? 'Reset between shows' : 'Changeover / setup during party'}: ${co} min${b.coGuess ? ' (TBD)' : ''}">${co * PX >= 14 ? `${b.repeat ? 'reset' : 'setup'} ${co}m` : ''}</div>
      <div class="blk blk--show ${b.runGuess ? 'blk--guess' : ''} ${ui.sel === b.act.id ? 'blk--sel' : ''} ${warnSet.has(b.act.id) ? 'blk--warn' : ''}"
      data-drag="slot" data-act="${esc(b.act.id)}" data-slot="${b.i}" style="top:${y(b.start)}px;height:${Math.max(18, (b.end - b.start) * PX)}px;${pos}"
      title="${esc(b.act.project)} — ${fmt(b.start)}–${fmt(b.end)}${b.runGuess ? ' (run time TBD)' : ''}">
      <b>${esc(b.act.project)}</b><span class="blk__t">${fmt(b.start)}–${fmt(b.end)}${b.runGuess ? ' · run TBD' : ''}</span></div>`;
  }).join('');

  const unsched = live().filter(a => !a.slots.some(s => toMin(s) != null));
  return `
    <div class="plan__note"><b>Draft.</b> ${esc(seed.note)} ${ev.photos ? `<a href="${esc(ev.photos)}" target="_blank" rel="noopener">Room photos</a>.` : ''}</div>
    <div class="tl ${SHOW_PREP ? '' : 'tl--solo'}">
      <div class="tl__lanes-head">
        <span></span>
        ${SHOW_PREP ? '<span class="tl__lane-title"><b>Arrive · pre-party setup</b><br>load-in, soundcheck</span>' : ''}
        <span class="tl__lane-title"><b>Theater · during party</b><br>setup/changeover + show</span>
      </div>
      <div class="tl__grid" id="tl-grid" style="height:${H}px">
        <div class="tl__gutter">${hours.join('')}</div>
        ${SHOW_PREP ? `<div class="tl__lane" id="lane-prep"><div class="tl__zone tl__zone--pre" style="top:${y(d)}px;height:${(SPAN - d) * PX}px"></div>${prep}</div>` : ''}
        <div class="tl__lane" id="lane-show">${T0 < d ? `<div class="tl__zone tl__zone--pre" style="top:0;height:${(d - T0) * PX}px"></div>` : ''}${win}${shows}</div>
        <div class="tl__line" style="top:${y(d)}px"><span>Doors ${fmt(d)}</span></div>
        ${showsStart() > d ? `<div class="tl__line tl__line--shows" style="top:${y(showsStart())}px"><span>Shows ${fmt(showsStart())}</span></div>` : ''}
        <div class="tl__line" style="top:${y(SPAN)}px"><span>Party ends ${fmt(SPAN)}</span></div>
      </div>
      <div class="tl__legend">
        ${SHOW_PREP ? '<span><i style="border-color:var(--tl-prep);background:var(--tl-prep-dim)"></i>Arrive + setup</span>' : ''}
        <span><i style="border-color:var(--border-subtle)"></i>Strike</span>
        <span><i style="border-color:var(--border-subtle)"></i>Changeover</span>
        <span><i style="border-color:var(--tl-show);background:var(--tl-show-dim)"></i>Show</span>
        <span><i style="border-style:dashed"></i>Length still TBD</span>
        <span><i style="border-color:var(--tl-warn)"></i>Conflict</span>
        <span>Drag a block to move it (5 min steps).</span>
        <label class="tl__opt"><input type="checkbox" id="opt-reflow" ${ui.reflow ? 'checked' : ''}> Auto-shift later shows</label>
        <button class="btn btn--sm btn--ghost" id="btn-close-gaps" type="button" title="Pack all shows back-to-back, keeping their order">Close gaps</button>
      </div>
      ${unsched.length ? `<div class="tl__unsched">Not on the clock yet: ${unsched.map(a => `<button data-sel="${esc(a.id)}" type="button">${esc(a.project)}</button>`).join(', ')}</div>` : ''}
    </div>`;
}

function needRow(n, owner) {
  return `<div class="need ${n.done ? 'need--done' : ''}">
    <input type="checkbox" data-need="${esc(n.id)}" data-owner="${esc(owner)}" ${n.done ? 'checked' : ''} aria-label="Done">
    <span class="need__text">${esc(n.text)}</span>
    <button class="need__who" data-sel="${esc(owner)}" type="button">${esc(owner === 'room' ? 'Room' : actById(owner)?.project || '')}</button>
  </div>`;
}

function needsHtml() {
  const rows = [{ owner: 'room', needs: state.event.needs }, ...live().map(a => ({ owner: a.id, needs: a.needs }))];
  const acts = live();
  const sum = (k) => acts.reduce((s, a) => s + (Number(a[k]) || 0), 0);
  const groups = Object.entries(CATS).map(([cat, label]) => {
    const items = rows.flatMap(r => r.needs.filter(n => n.cat === cat && (ui.needs === 'all' || !n.done)).map(n => needRow(n, r.owner)));
    return items.length ? `<div class="needs__group"><h3>${label} · ${items.length}</h3>${items.join('')}</div>` : '';
  }).join('');
  return `
    <div class="needs">
      <div class="needs__totals">
        <div class="needs__stat"><b>${sum('comps')}</b><span>comps committed${sum('compsAsked') > sum('comps') ? ` · ${sum('compsAsked')} asked` : ''}</span></div>
        <div class="needs__stat"><b>$${sum('grant')}</b><span>we pay artists${sum('grantAsked') > sum('grant') ? ` · $${sum('grantAsked')} requested` : ''}</span></div>
        ${SHOW_PREP ? `<div class="needs__stat"><b>${acts.filter(a => a.arrive).length}/${acts.length}</b><span>arrival times set</span></div>` : ''}
        <div class="needs__stat"><b>${acts.filter(a => a.run != null && a.changeover != null).length}/${acts.length}</b><span>run + changeover known</span></div>
      </div>
      <div class="filters" id="needs-filter" style="position:static;border:none;padding:0">
        <button class="filter-token ${ui.needs === 'open' ? 'filter-token--active' : ''}" data-needs="open" type="button">Open</button>
        <button class="filter-token ${ui.needs === 'all' ? 'filter-token--active' : ''}" data-needs="all" type="button">All</button>
      </div>
      ${groups || '<p class="detail__empty">Nothing open. Nice.</p>'}
    </div>`;
}

function needsEditor(needs, owner) {
  return `<div class="detail__section">
    <div class="detail__label">Needs · ${needs.filter(n => !n.done).length} open</div>
    ${needs.map(n => `<div class="need ${n.done ? 'need--done' : ''}">
      <input type="checkbox" data-need="${esc(n.id)}" data-owner="${esc(owner)}" ${n.done ? 'checked' : ''} aria-label="Done">
      <span class="tag">${CATS[n.cat] || n.cat}</span>
      <span class="need__text">${esc(n.text)}</span>
      <button class="need__x" data-del-need="${esc(n.id)}" data-owner="${esc(owner)}" type="button" title="Remove">×</button>
    </div>`).join('')}
    <form class="need__add" data-add-need="${esc(owner)}">
      <select class="select" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input class="input" name="text" placeholder="Add a need…" autocomplete="off">
      <button class="btn btn--sm" type="submit">Add</button>
    </form>
  </div>`;
}

function renderDetail() { renderDetailInner(); lockUI(); }
function renderDetailInner() {
  const el = document.getElementById('detail');
  if (ui.sel === 'room') {
    const ev = state.event;
    el.innerHTML = `
      <div><h2 class="detail__project">Theater room</h2><div class="detail__artist">${esc(ev.name)} · ${esc(ev.date)}</div></div>
      <div class="form">
        <label class="form__row form__row--full"><span class="detail__label">Room</span><input class="input" data-ev="room" value="${esc(ev.room)}"></label>
        <label class="form__row"><span class="detail__label">Load-in opens</span><input class="input" type="time" data-ev="loadin" value="${esc(ev.loadin)}"></label>
        <label class="form__row"><span class="detail__label">Doors</span><input class="input" type="time" data-ev="doors" value="${esc(ev.doors)}"></label>
        <label class="form__row"><span class="detail__label">Shows start</span><input class="input" type="time" data-ev="shows" value="${esc(ev.shows || '')}"></label>
        <label class="form__row form__row--full"><span class="detail__label">Room notes</span><textarea class="input" data-ev="notes">${esc(ev.notes)}</textarea></label>
      </div>
      ${ev.photos ? `<a class="detail__meta" href="${esc(ev.photos)}" target="_blank" rel="noopener">Room photos ↗</a>` : ''}
      ${needsEditor(ev.needs, 'room')}`;
    return;
  }
  const a = actById(ui.sel);
  if (!a) {
    el.innerHTML = `<p class="detail__empty">Pick an act to edit its times and needs.</p>
      <p class="detail__empty detail__empty--hint">Each act has two setup moments: <b>arrive / pre-party setup</b> (load-in and soundcheck before doors) and <b>changeover</b> (setup in the theater right before their slot, during the party).</p>`;
    return;
  }
  const iss = issuesFor(a);
  const run = a.run ?? DEF.run, co = a.changeover ?? DEF.changeover;
  const arr = toMin(a.arrive);
  const flow = [];
  if (SHOW_PREP && arr != null) flow.push(`<span>Arrive <b>${fmt(arr)}</b> → pre-party setup ${a.prep ?? '?'} min → ready <b>${fmt(arr + (a.prep ?? DEF.prep))}</b></span>`);
  showBlocks().filter(b => b.act === a).forEach(b => flow.push(`<span>${b.repeat && b.coStart === b.start ? 'Rig stays set' : `${b.repeat ? 'Reset' : 'Changeover'} <b>${fmt(b.coStart)}</b>`} → show <b>${fmt(b.start)}–${fmt(b.end)}</b>${b.strike ? ` → strike until <b>${fmt(b.stop)}</b>` : ''}</span>`));
  const num = (f, v) => `<input class="input" type="number" min="0" step="5" data-f="${f}" value="${v ?? ''}" placeholder="TBD">`;
  el.innerHTML = `
    <div>
      <h2 class="detail__project">${esc(a.project)}</h2>
      <div class="detail__artist">${esc(a.artist)}</div>
      <div class="detail__tags"><span class="tag tag--${a.status}">${STATUS[a.status]}</span>${a.format ? `<span class="tag">${esc(a.format)}</span>` : ''}</div>
    </div>
    ${iss.length ? `<ul class="issues">${iss.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    ${flow.length ? `<div class="flow">${flow.join('')}</div>` : ''}

    ${SHOW_PREP ? `<div class="detail__section">
      <div class="detail__label">Arrive / pre-party setup</div>
      <div class="form">
        <label class="form__row"><span class="form__hint">Arrival</span><input class="input" type="time" data-f="arrive" value="${esc(a.arrive || '')}"></label>
        <label class="form__row"><span class="form__hint">Setup / soundcheck (min)</span>${num('prep', a.prep)}</label>
      </div>
    </div>` : ''}

    <div class="detail__section">
      <div class="detail__label">Theater slot · during party</div>
      ${a.formWhen ? `<div class="form__hint">Asked for: ${esc(a.formWhen)}</div>` : ''}
      <div class="form">
        <label class="form__row"><span class="form__hint">Changeover before (min)</span>${num('changeover', a.changeover)}</label>
        <label class="form__row"><span class="form__hint">Run time per show (min)</span>${num('run', a.run)}</label>
        <label class="form__row"><span class="form__hint">Reset between repeat shows (min)</span>${num('reset', a.reset)}</label>
        <label class="form__row"><span class="form__hint">Strike after last show (min)</span>${num('strike', a.strike)}</label>
        <label class="form__row"><span class="form__hint">Earliest start</span><input class="input" type="time" data-f="earliest" value="${esc(a.earliest || '')}"></label>
        <label class="form__row"><span class="form__hint">Latest end</span><input class="input" type="time" data-f="latest" value="${esc(a.latest || '')}"></label>
      </div>
      <div class="slots">
        ${a.slots.map((s, i) => { const st = toMin(s); return `<div class="slot">
          <input class="input" type="time" data-slot-i="${i}" value="${esc(s)}">
          <span class="slot__range">${st != null ? `→ ${fmt(st + run)}` : ''}</span>
          <button class="need__x" data-del-slot="${i}" type="button" title="Remove slot">×</button></div>`; }).join('')}
        <button class="btn btn--sm btn--ghost" id="btn-add-slot" type="button">+ Add slot</button>
      </div>
    </div>

    ${needsEditor(a.needs, a.id)}

    <div class="detail__section">
      <div class="detail__label">Act</div>
      <div class="form">
        <label class="form__row"><span class="form__hint">Status</span><select class="select" data-f="status">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="form__row"><span class="form__hint">Point of contact</span><input class="input" data-f="poc" value="${esc(a.poc || '')}"></label>
        <label class="form__row"><span class="form__hint">Comp tickets we give (given / requested)</span><span style="display:flex;gap:4px">${num('comps', a.comps).replace('step="5"', 'step="1"')}${num('compsAsked', a.compsAsked).replace('step="5"', 'step="1"')}</span></label>
        <label class="form__row"><span class="form__hint">We pay the artist $ (agreed / they requested)</span><span style="display:flex;gap:4px">${num('grant', a.grant)}${num('grantAsked', a.grantAsked)}</span></label>
        <label class="form__row form__row--full"><span class="form__hint">Project</span><input class="input" data-f="project" value="${esc(a.project)}"></label>
        <label class="form__row form__row--full"><span class="form__hint">Artist</span><input class="input" data-f="artist" value="${esc(a.artist)}"></label>
        <label class="form__row form__row--full"><span class="form__hint">Format</span><input class="input" data-f="format" value="${esc(a.format || '')}"></label>
        <label class="form__row form__row--full"><span class="form__hint">Email thread</span><input class="input" data-f="thread" value="${esc(a.thread || '')}" placeholder="Gmail link"></label>
        <label class="form__row form__row--full"><span class="form__hint">Notes</span><textarea class="input" data-f="notes" placeholder="Anything else…">${esc(a.notes || '')}</textarea></label>
      </div>
    </div>

    <div class="detail__section">
      <div class="detail__label">From the emails</div>
      <div class="detail__text detail__text--muted">${esc(a.summary || '—')}</div>
      ${a.thread ? `<a class="detail__meta" href="${esc(a.thread)}" target="_blank" rel="noopener">Open thread in Gmail ↗</a>` : ''}
      ${a.proposal ? `<a class="detail__meta" href="./" title="Proposal ${esc(a.proposal)}">Proposal in Placement ↗</a>` : ''}
    </div>
    <button class="btn btn--sm btn--ghost" id="btn-del-act" type="button">Delete act</button>`;
}

// ---------- editing ----------
const NUM_FIELDS = new Set(['prep', 'changeover', 'run', 'reset', 'strike', 'comps', 'compsAsked', 'grant', 'grantAsked']);
// Text/time/number edits leave the detail pane alone until focus leaves the field
// (re-rendering mid-edit would kick the cursor out of a half-typed time).
function commit(keepDetail) { save(); renderActs(); renderPlan(); if (keepDetail) ui.dirty = true; else renderDetail(); }
function focusKey(el) {
  for (const k of ['f', 'ev', 'slotI']) if (el?.dataset?.[k] != null) return `[data-${k.replace(/I$/, '-i')}="${el.dataset[k]}"]`;
  return null;
}

function onDetailChange(e) {
  const t = e.target;
  if (t.dataset.ev) { state.event[t.dataset.ev] = t.value; return commit(true); }
  const a = actById(ui.sel); if (!a) return;
  if (t.dataset.f) {
    const f = t.dataset.f;
    a[f] = NUM_FIELDS.has(f) ? (t.value === '' ? null : Math.max(0, Number(t.value))) : (t.value || (['arrive', 'earliest', 'latest'].includes(f) ? null : ''));
    return commit(f !== 'status');
  }
  if (t.dataset.slotI != null) { if (t.value) a.slots[+t.dataset.slotI] = t.value; return commit(true); }
}

function needsOf(owner) { return owner === 'room' ? state.event.needs : actById(owner)?.needs; }
function toggleNeed(owner, id, done) { const n = needsOf(owner)?.find(x => x.id === id); if (n) { n.done = done; save(); render(); } }

function addAct() {
  const project = prompt('Act / project name'); if (!project?.trim()) return;
  const id = 'a-' + Math.random().toString(36).slice(2, 8);
  state.acts.push({
    id, artist: '', project: project.trim(), proposal: '', format: 'Theater', status: 'pending', poc: '', thread: '', summary: '',
    arrive: null, prep: null, changeover: null, run: null, earliest: null, latest: null, slots: [],
    comps: null, compsAsked: null, grant: null, grantAsked: null,
    needs: [{ id: nid(), cat: 'info', text: 'Get setup time, run time, earliest/latest', done: false }], notes: '',
  });
  select(id); save(); render();
}
function nid() { return 'n' + Math.random().toString(36).slice(2, 8); }

function select(id) {
  ui.sel = id; ui.dirty = false;
  if (window.matchMedia('(max-width: 900px)').matches) setPanel('detail');
  render();
}
function setPanel(p) {
  ui.panel = p;
  document.querySelector('.layout').dataset.panel = p;
  document.querySelectorAll('#mobile-tabs .tab').forEach(t => t.classList.toggle('tab--active', t.dataset.panel === p));
}

// ---------- drag on the timeline ----------
let drag = null;
function onPointerDown(e) {
  const blk = e.target.closest('.blk[data-drag]'); if (!blk) return;
  e.preventDefault();
  if (readOnly()) { select(blk.dataset.act); return; }
  blk.setPointerCapture(e.pointerId);
  drag = { blk, y0: e.clientY, top0: parseFloat(blk.style.top), moved: false, act: blk.dataset.act, kind: blk.dataset.drag, slot: +blk.dataset.slot };
  blk.classList.add('blk--dragging');
}
function onPointerMove(e) {
  if (!drag) return;
  const dy = e.clientY - drag.y0;
  if (Math.abs(dy) > 3) drag.moved = true;
  const mins = Math.round(dy / PX / SNAP) * SNAP;
  drag.mins = mins;
  drag.blk.style.top = (drag.top0 + mins * PX) + 'px';
  const t = drag.blk.querySelector('.blk__t');
  if (t) t.textContent = fmt(timelineStart() + Math.round(drag.top0 / PX) + mins);
}
function onPointerUp() {
  if (!drag) return;
  const d = drag; drag = null;
  d.blk.classList.remove('blk--dragging');
  if (!d.moved || !d.mins) { select(d.act); return; }
  const a = actById(d.act);
  const v = Math.min(SPAN, Math.max(0, timelineStart() + Math.round(d.top0 / PX) + d.mins));
  if (d.kind === 'arrive') a.arrive = toHHMM(v); else a.slots[d.slot] = toHHMM(v);
  if (d.kind === 'slot' && ui.reflow) {
    const n = reflow(a.id, d.slot);
    if (n) toast(`Shifted ${n} later show${n > 1 ? 's' : ''} to make room`);
  }
  ui.sel = a.id; save(); render();
}

// ---------- auto-reflow ----------
// The show that was just dropped keeps its time. Anything that still ends before its
// changeover starts stays put; everything else keeps its order and is pushed later
// just far enough to fit its own changeover/reset after the previous show (and strike).
// Gaps are never closed here — "Close gaps" does that on request.
function reflow(actId, idx) {
  const bs = showBlocks();
  const me = bs.find(b => b.act.id === actId && b.i === idx); if (!me) return 0;
  const after = bs.filter(b => b !== me && !(b.stop <= me.coStart && b.start < me.start)).sort((x, y) => x.start - y.start);
  return push(me.stop, after);
}
function push(cursor, blocks) {
  let moved = 0;
  blocks.forEach(b => {
    const co = b.start - b.coStart, tail = b.stop - b.start;
    const need = cursor + co;
    if (b.start < need) { b.act.slots[b.i] = toHHMM(need); b.start = need; moved++; }
    cursor = b.start + tail;
  });
  return moved;
}
// Pack every show back-to-back from the first one, keeping the current order.
function closeGaps() {
  const bs = showBlocks(); if (!bs.length) return;
  let cursor = bs[0].stop, moved = 0;
  bs.slice(1).forEach(b => {
    const co = b.start - b.coStart, tail = b.stop - b.start, want = Math.max(cursor + co, showsStart());
    if (b.start !== want) { b.act.slots[b.i] = toHHMM(want); moved++; }
    cursor = want + tail;
  });
  save(); render(); toast(moved ? `Closed gaps — moved ${moved} show${moved > 1 ? 's' : ''}` : 'No gaps to close');
}

// ---------- shared backend (Supabase · Boards project) ----------
// One row (halloween_theater.id = 'xv-2026') holds the whole schedule. Anyone can
// read it; verified Agape Discord members can write (RLS, migration 180). Saves
// are compare-and-set on `version`, so a stale tab can't overwrite a newer save.
const SB_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
const ROW_ID = 'xv-2026';
const TABLE = 'halloween_theater';
const cloud = { sb: null, live: false, user: null, member: false, name: null, why: '', version: null, docRev: null, timer: null, pushing: false, again: false, sync: '', updatedBy: null };
const readOnly = () => cloud.live && !cloud.member;

function cloudInit() {
  if (!window.supabase?.createClient) return false;
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  cloud.sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { detectSessionInUrl: true, flowType: mobile ? 'implicit' : 'pkce', autoRefreshToken: true, persistSession: true },
  });
  return true;
}
async function cloudLoad() {
  const { data, error } = await cloud.sb.from(TABLE).select('doc, version, updated_at, updated_by_name').eq('id', ROW_ID).maybeSingle();
  if (error) throw error;
  cloud.live = true;
  if (data) applyRemote(data);
  else { cloud.version = null; cloud.docRev = null; state = fromSeed(); } // nobody has saved yet: everyone sees the email snapshot
}
function applyRemote(row) {
  cloud.version = row.version;
  cloud.updatedBy = row.updated_by_name || null;
  cloud.docRev = row.doc?.rev || 1;
  state = upgrade(clone(row.doc));
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) {}
}
function subscribe() {
  cloud.sb.channel('halloween-theater-' + ROW_ID)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `id=eq.${ROW_ID}` }, p => {
      const row = p.new;
      if (!row || row.version == null) return;
      if (cloud.version != null && row.version <= cloud.version) return; // our own save echoing back
      if (cloud.timer || cloud.pushing) return; // our pending save will hit the version check and reload
      applyRemote(row); render(); setSync();
      toast(`Updated by ${row.updated_by_name || 'another planner'}`);
    })
    .subscribe();
}

// Membership: read our own cached row first (RLS lets users read theirs). Only call
// the discord-membership function when there's no fresh verdict — it logs every call.
async function cloudAuth() {
  const { data } = await cloud.sb.auth.getSession();
  const session = data?.session || null;
  cloud.user = session?.user || null;
  cloud.member = false; cloud.why = '';
  if (!session) { setSync(); render(); return; }
  const meta = session.user.user_metadata || {};
  cloud.name = meta.full_name || meta.name || meta.custom_claims?.global_name || session.user.email || 'a planner';
  try {
    const { data: row } = await cloud.sb.from('user_discord_membership').select('is_agape_member, discord_username, verified_at').eq('user_id', session.user.id).maybeSingle();
    const fresh = row && (Date.now() - new Date(row.verified_at).getTime()) < 7 * 864e5;
    if (row?.is_agape_member && fresh) {
      cloud.member = true; cloud.name = row.discord_username || cloud.name;
    } else {
      const resp = await fetch(`${SB_URL}/functions/v1/discord-membership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'status' }),
      });
      const st = await resp.json().catch(() => ({}));
      if (!resp.ok) cloud.why = 'access check failed';
      else if (!st.linked) cloud.why = 'no Discord linked to this account';
      else if (!st.isMember) cloud.why = `${st.discordUsername || 'this account'} isn't in the Agape Discord`;
      cloud.member = !!(resp.ok && st.isMember);
      if (st.discordUsername) cloud.name = st.discordUsername;
    }
  } catch (e) { cloud.why = 'access check failed'; }
  setSync(); render();
}
function afterAuth(localSnap) {
  if (!cloud.member) return;
  if (cloud.version == null || (state.rev || 1) > (cloud.docRev || 1)) queuePush(); // first save / newer seed merged in
  // Edits made in this browser before the backend existed: offer to publish them once.
  const strip = s => JSON.stringify({ event: s.event, acts: s.acts });
  if (localSnap?.updated && strip(localSnap) !== strip(state)) {
    ui.bannerYes = () => { state = localSnap; ui.sel = null; save(); render(); toast('Your local edits are now the shared schedule'); };
    document.getElementById('banner-text').textContent =
      `This browser has edits from ${new Date(localSnap.updated).toLocaleString()} that aren't in the shared schedule. Upload them? (Replaces the shared version for everyone.)`;
    document.getElementById('banner-yes').textContent = 'Upload';
    document.getElementById('banner-no').textContent = 'Keep shared';
    document.getElementById('banner').hidden = false;
  }
}
function queuePush() { clearTimeout(cloud.timer); setSync('saving'); cloud.timer = setTimeout(() => { cloud.timer = null; pushCloud(); }, 800); }
async function pushCloud() {
  if (cloud.pushing) { cloud.again = true; return; }
  cloud.pushing = true;
  try {
    const doc = clone(state);
    const res = cloud.version == null
      ? await cloud.sb.from(TABLE).insert({ id: ROW_ID, doc, updated_by_name: cloud.name }).select('version').maybeSingle()
      : await cloud.sb.from(TABLE).update({ doc, updated_by_name: cloud.name }).eq('id', ROW_ID).eq('version', cloud.version).select('version').maybeSingle();
    if (res.error && res.error.code !== '23505') throw res.error;
    if (res.error || !res.data) { await onConflict(); return; }
    cloud.version = res.data.version; cloud.docRev = state.rev || 1; cloud.updatedBy = cloud.name;
    setSync('saved');
  } catch (e) {
    console.warn('[halloween-theater] save failed:', e.message);
    setSync('error'); toast('Couldn’t save to the shared schedule — your change is only in this browser', true);
  } finally {
    cloud.pushing = false;
    if (cloud.again) { cloud.again = false; pushCloud(); }
  }
}
async function onConflict() {
  const { data } = await cloud.sb.from(TABLE).select('doc, version, updated_at, updated_by_name').eq('id', ROW_ID).maybeSingle();
  if (data) { applyRemote(data); render(); }
  setSync('saved');
  toast(`${data?.updated_by_name || 'Someone'} saved first — showing their version. Redo your last change.`, true);
}
async function signIn() {
  const { error } = await cloud.sb.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: location.origin + location.pathname, scopes: 'identify email' },
  });
  if (error) toast(error.message || 'Discord sign-in failed', true);
}
async function signOut() { await cloud.sb.auth.signOut(); await cloudAuth(); }
function setSync(mode) {
  if (mode) cloud.sync = mode;
  const pill = document.getElementById('sync'), btn = document.getElementById('btn-auth');
  if (!pill) return;
  let text, cls = '';
  if (!cloud.sb || !cloud.live) { text = cloud.sb ? 'Local only · shared schedule unreachable' : 'Local only'; btn.hidden = true; }
  else if (cloud.member) {
    text = cloud.sync === 'saving' ? 'Saving…' : cloud.sync === 'error' ? 'Not saved — retry by editing' : `Live · ${cloud.name}`;
    cls = cloud.sync === 'error' ? 'topbar__status--error' : 'topbar__status--live';
    btn.hidden = false; btn.textContent = 'Sign out';
  } else {
    text = cloud.user ? `View only · ${cloud.why || 'not an Agape member'}` : 'View only';
    btn.hidden = false; btn.textContent = cloud.user ? 'Sign out' : 'Sign in with Discord to edit';
  }
  pill.textContent = text;
  pill.className = 'topbar__status ' + cls;
  pill.title = cloud.updatedBy ? `Last saved by ${cloud.updatedBy}` : '';
}

// ---------- share / export / copy ----------
function b64u(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }

function runOfShowText() {
  const ev = state.event, lines = [`${ev.name} — Theater run of show (${ev.date})`, ev.room, ''];
  if (SHOW_PREP) {
    lines.push('ARRIVE / PRE-PARTY SETUP');
    prepBlocks().forEach(b => lines.push(`  ${fmt(b.start)}–${fmt(b.end)}  ${b.act.project}${b.guess ? ' (setup length TBD)' : ''}`));
    const noArr = live().filter(a => !a.arrive); if (noArr.length) lines.push(`  TBD: ${noArr.map(a => a.project).join(', ')}`);
    lines.push('');
  }
  lines.push(`DOORS ${fmt(doors())} · SHOWS FROM ${fmt(showsStart())} · PARTY ENDS ${fmt(SPAN)}`, '', 'THEATER');
  showBlocks().forEach(b => {
    if (b.start > b.coStart) lines.push(`  ${fmt(b.coStart)}  ${b.repeat ? 'reset' : 'changeover'} ${b.start - b.coStart}m${b.coGuess ? ' (TBD)' : ''}`);
    lines.push(`  ${fmt(b.start)}–${fmt(b.end)}  ${b.act.project} — ${b.act.artist}${b.runGuess ? ' (run time TBD)' : ''}`);
    if (b.strike) lines.push(`  ${fmt(b.end)}–${fmt(b.stop)}  strike`);
  });
  const paid = live().filter(a => a.grant);
  if (paid.length) {
    lines.push('', 'ARTIST PAY (we pay, after the event)');
    paid.forEach(a => lines.push(`  $${a.grant}  ${a.project} — ${a.artist}`));
    lines.push(`  Total: $${paid.reduce((t, a) => t + Number(a.grant), 0)}`);
  }
  lines.push('', 'OPEN NEEDS');
  [{ name: 'Room', needs: ev.needs }, ...live().map(a => ({ name: a.project, needs: a.needs }))].forEach(r =>
    r.needs.filter(n => !n.done).forEach(n => lines.push(`  - [${CATS[n.cat] || n.cat}] ${r.name}: ${n.text}`)));
  return lines.join('\n');
}

let pendingShare = null;
function checkShareHash() {
  const m = location.hash.match(/#t=([A-Za-z0-9_-]+)/); if (!m) return;
  try { pendingShare = JSON.parse(unb64u(m[1])); if (!Array.isArray(pendingShare.acts)) throw 0; pendingShare = upgrade(pendingShare); }
  catch (_) { toast('Share link is malformed', true); pendingShare = null; return; }
  history.replaceState(null, '', location.pathname);
  if (!state.updated) { state = pendingShare; pendingShare = null; save(); return; }
  ui.bannerYes = () => { state = pendingShare; pendingShare = null; save(); render(); toast('Shared schedule loaded'); };
  document.getElementById('banner-yes').textContent = 'Load';
  document.getElementById('banner-no').textContent = 'Keep mine';
  document.getElementById('banner-text').textContent = `This link carries a theater schedule with ${pendingShare.acts.length} acts. Load it and replace what's saved here?`;
  document.getElementById('banner').hidden = false;
}

// ---------- events ----------
function bind() {
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-sel]'); if (s && !e.target.matches('input')) { select(s.dataset.sel); return; }
    const v = e.target.closest('[data-view]'); if (v) { ui.view = v.dataset.view; if (window.matchMedia('(max-width: 900px)').matches) setPanel('plan'); renderPlan(); return; }
    const nf = e.target.closest('[data-needs]'); if (nf) { ui.needs = nf.dataset.needs; renderPlan(); return; }
    const dn = e.target.closest('[data-del-need]');
    if (dn) { const list = needsOf(dn.dataset.owner); const i = list.findIndex(n => n.id === dn.dataset.delNeed); if (i >= 0) list.splice(i, 1); save(); render(); return; }
    const ds = e.target.closest('[data-del-slot]'); if (ds) { actById(ui.sel).slots.splice(+ds.dataset.delSlot, 1); save(); render(); return; }
    if (e.target.id === 'btn-add-slot') { const a = actById(ui.sel); const last = Math.max(showsStart(), ...showBlocks().map(b => b.stop)); a.slots.push(toHHMM(Math.min(SPAN - 30, last + (a.changeover ?? DEF.changeover)))); save(); render(); return; }
    if (e.target.id === 'btn-add') { addAct(); return; }
    if (e.target.id === 'btn-close-gaps') { closeGaps(); return; }
    if (e.target.id === 'btn-del-act') { const a = actById(ui.sel); if (a && confirm(`Delete ${a.project}?`)) { state.acts = state.acts.filter(x => x !== a); ui.sel = null; save(); render(); } }
  });
  document.addEventListener('change', e => {
    if (e.target.matches('input[data-need]')) { toggleNeed(e.target.dataset.owner, e.target.dataset.need, e.target.checked); return; }
    if (e.target.id === 'opt-reflow') { ui.reflow = e.target.checked; try { localStorage.setItem(REFLOW_KEY, ui.reflow ? 'on' : 'off'); } catch (_) {} return; }
    if (e.target.closest('#detail')) onDetailChange(e);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('[data-add-need]'); if (!f) return;
    e.preventDefault();
    const text = f.elements.text.value.trim(); if (!text) return;
    needsOf(f.dataset.addNeed).push({ id: nid(), cat: f.elements.cat.value, text, done: false });
    save(); render();
    document.querySelector(`[data-add-need="${CSS.escape(f.dataset.addNeed)}"] input`)?.focus();
  });
  document.getElementById('detail').addEventListener('focusout', () => setTimeout(() => {
    if (!ui.dirty) return;
    ui.dirty = false;
    const key = focusKey(document.activeElement);
    renderDetail();
    if (key) document.querySelector(`#detail ${key}`)?.focus();
  }));
  const plan = document.getElementById('plan');
  plan.addEventListener('pointerdown', onPointerDown);
  plan.addEventListener('pointermove', onPointerMove);
  plan.addEventListener('pointerup', onPointerUp);
  plan.addEventListener('pointercancel', onPointerUp);

  document.getElementById('mobile-tabs').addEventListener('click', e => { const t = e.target.closest('[data-panel]'); if (t) setPanel(t.dataset.panel); });
  document.getElementById('btn-share').addEventListener('click', async () => {
    await copy(`${location.origin}${location.pathname}#t=${b64u(JSON.stringify(state))}`); toast('Share link copied');
  });
  document.getElementById('btn-copy').addEventListener('click', async () => { await copy(runOfShowText()); toast('Run of show copied'); });
  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: VERSION, exported: new Date().toISOString(), ...state }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `halloween-theater-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const s = JSON.parse(await f.text()); if (!Array.isArray(s.acts) || !s.event) throw 0; state = s; save(); render(); toast('Schedule loaded'); }
    catch (_) { toast('That file is not a theater export', true); }
    e.target.value = '';
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (cloud.live) {
      if (!confirm('Replace the SHARED schedule — for everyone — with the email snapshot?')) return;
      state = fromSeed(); ui.sel = null; save(); render(); toast('Shared schedule reset to the email snapshot');
      return;
    }
    if (!confirm('Throw away local edits and reload the email snapshot?')) return;
    state = fromSeed(); try { localStorage.removeItem(STORE_KEY); } catch (_) {} ui.sel = null; render(); toast('Reset to the email snapshot');
  });
  document.getElementById('btn-theme').addEventListener('click', () => {
    const light = document.documentElement.classList.toggle('light');
    try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (_) {}
  });
  document.getElementById('banner-yes').addEventListener('click', () => { document.getElementById('banner').hidden = true; const f = ui.bannerYes; ui.bannerYes = null; f && f(); });
  document.getElementById('banner-no').addEventListener('click', () => { document.getElementById('banner').hidden = true; ui.bannerYes = null; });
  document.getElementById('btn-auth').addEventListener('click', () => (cloud.user ? signOut() : signIn()));
  // Belt and braces for view-only visitors: swallow edits even if a control slipped past lockUI().
  document.addEventListener('click', e => {
    if (readOnly() && e.target.closest('#btn-add, #btn-close-gaps, #btn-del-act, #btn-add-slot, #btn-reset, #btn-import, [data-del-need], [data-del-slot], input[data-need], .need__add button')) {
      e.preventDefault(); e.stopImmediatePropagation(); toast('Sign in with Discord to edit', true);
    }
  }, true);
  document.addEventListener('submit', e => { if (readOnly()) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
}

// ---------- utils ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
async function copy(text) { try { await navigator.clipboard.writeText(text); } catch (_) { prompt('Copy this:', text); } }
function toast(msg, err) {
  const el = document.createElement('div'); el.className = 'toast' + (err ? ' toast--error' : ''); el.textContent = msg;
  document.getElementById('toasts').appendChild(el); setTimeout(() => el.remove(), 2600);
}

// ---------- boot ----------
(async function init() {
  try { if (localStorage.getItem(THEME_KEY) === 'light') document.documentElement.classList.add('light'); } catch (_) {}
  bind();
  seed = await (await fetch('data/theater.json?v=' + VERSION)).json();
  const localSnap = loadState();
  state = localSnap;
  checkShareHash();
  render(); setSync();
  if (!cloudInit()) { setSync(); return; }
  try { await cloudLoad(); } catch (e) { console.warn('[halloween-theater] shared schedule unavailable:', e.message); cloud.live = false; }
  render(); setSync();
  if (!cloud.live) return;
  subscribe();
  await cloudAuth();
  afterAuth(localSnap);
  cloud.sb.auth.onAuthStateChange(async (ev, session) => {
    if ((session?.user?.id || null) === (cloud.user?.id || null)) return;
    await cloudAuth(); afterAuth(null);
  });
})();
