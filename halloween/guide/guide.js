/* Agape Halloween guest guide
   Mobile-first map + list of every room and the art in it. Discord sign-in is
   required, and you must be in the Agape Discord server (the guide is a nudge
   onto the server). Before the party it shows all the art; during the party
   (Oct 24 9pm → Oct 25 9am PT) it shows only what's happening right now.
   Data: data/guide.json (built by scripts/halloween-guide.py); theater times
   are refreshed live from the shared theater schedule (Supabase Boards). */

const VERSION = '1.0.0';
console.log(`[halloween-guide] v${VERSION} - guest guide (map + list, Discord-gated)`);

const SB_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
const MEMBER_KEY = 'halloween-guide-member';
const SEEN_KEY = 'halloween-guide-seen';
const THEME_KEY = 'halloween-theme';
const MEMBER_TTL = 24 * 3600 * 1000;

let G = null;            // guide.json
let sb = null;
let me = { user: null, name: null };
let ui = { tab: 'map', floor: 'f1', mediums: new Set(), room: null, open: null };
let seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (_) {}

// ---------- time ----------
// ?now=2026-10-25T01:30 (local PT) lets planners preview the live mode.
function now() {
  const q = new URLSearchParams(location.search).get('now');
  if (q) { const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(q) ? q : q + '-07:00'); if (!isNaN(d)) return d; }
  return new Date();
}
const eventStart = () => new Date(G.event.start);
const eventEnd = () => new Date(G.event.end);
const isLive = () => { const n = now(); return n >= eventStart() && n < eventEnd(); };
// "HH:MM" on party night → Date (before noon = the next morning). PT is UTC-7 on Oct 24–25.
function at(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const day = h < 12 ? '2026-10-25' : '2026-10-24';
  return new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-07:00`);
}
function fmt(hhmm) {
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return h + (m ? ':' + String(m).padStart(2, '0') : '') + ap;
}
function onNow(p, n = now()) { return (p.times || []).some(([s, e]) => n >= at(s) && n < at(e)); }
function nextUp(p, n = now()) { return (p.times || []).map(([s]) => at(s)).filter(d => d > n).sort((a, b) => a - b)[0] || null; }
// In live mode, show what's on now; untimed music stays visible (set times not published yet).
function visible(p) {
  if (ui.mediums.size && !ui.mediums.has(p.medium)) return false;
  if (!isLive()) return true;
  return onNow(p) || !p.times; // untimed pieces stay listed (marked "Times TBA") until times are set
}

// ---------- data helpers ----------
const rooms = () => G.floors.flatMap(f => f.rooms.map(r => ({ ...r, floor: f.id, floorName: f.name })));
const roomById = id => rooms().find(r => r.id === id);
const piecesIn = id => G.pieces.filter(p => p.rooms.includes(id) && visible(p));
const mediumName = id => (G.mediums.find(m => m.id === id) || {}).name || id;
const roomsWithArt = () => rooms().filter(r => piecesIn(r.id).length);
function ringFor(list) {
  const ms = [...new Set(list.map(p => p.medium))];
  if (!ms.length) return 'var(--border-subtle)';
  const step = 360 / ms.length;
  return `conic-gradient(${ms.map((m, i) => `var(--m-${m}) ${i * step}deg ${(i + 1) * step}deg`).join(', ')})`;
}
function whenLabel(p) {
  if (!p.times) return p.medium === 'music' ? 'Set time TBA' : 'Times TBA';
  if (p.times.length === 1 && p.times[0][0] === '21:00' && p.times[0][1] === '09:00') return 'All night';
  return p.times.map(([s, e]) => `${fmt(s)}–${fmt(e)}`).join(' · ');
}

// ---------- render ----------
function render() {
  document.getElementById('mode').textContent = isLive()
    ? `Live · ${now().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: G.event.tz })}`
    : 'Preview · all the art';
  document.getElementById('mode').classList.toggle('top__mode--live', isLive());
  document.querySelectorAll('.tabbar__btn').forEach(b => b.classList.toggle('tabbar__btn--on', b.dataset.tab === ui.tab));
  renderStories();
  const v = document.getElementById('view');
  v.innerHTML = ui.tab === 'map' ? mapHtml() : ui.tab === 'list' ? listHtml() : meHtml();
  if (ui.room) renderSheet();
}

function renderStories() {
  const el = document.getElementById('stories');
  const list = roomsWithArt();
  el.hidden = ui.tab === 'me' || !list.length;
  el.innerHTML = list.map(r => {
    const ps = piecesIn(r.id);
    return `<button class="story ${seen.has(r.id) ? 'story--seen' : ''}" data-room="${esc(r.id)}" type="button" aria-label="${esc(r.name)}">
      <span class="story__ring" style="--ring:${ringFor(ps)}"><span class="story__inner">${esc(initials(r.name))}</span></span>
      <span class="story__name">${esc(r.name)}</span>
    </button>`;
  }).join('');
}

function legendHtml() {
  return `<div class="legend" role="group" aria-label="Filter by medium">${G.mediums.map(m =>
    `<button class="mchip m-${m.id} ${ui.mediums.has(m.id) ? 'mchip--on' : ''}" data-medium="${m.id}" type="button" aria-pressed="${ui.mediums.has(m.id)}">${esc(m.name)}</button>`).join('')}</div>`;
}
function liveNote() {
  return isLive()
    ? `<div class="view__note">Showing what's happening right now. Anything marked TBA doesn't have a time yet.</div>`
    : `<div class="view__note">Preview — every piece at the party. On Oct 24 from 9pm this switches to what's happening right now.</div>`;
}

function mapHtml() {
  const floor = G.floors.find(f => f.id === ui.floor) || G.floors[0];
  const tabs = G.floors.map(f => {
    const n = f.rooms.reduce((s, r) => s + piecesIn(r.id).length, 0);
    return `<button class="filter-token floor-tab ${f.id === floor.id ? 'filter-token--active' : ''}" data-floor="${f.id}" type="button">${esc(f.name)}${n ? ` · ${n}` : ''}</button>`;
  }).join('');
  const tiles = floor.rooms.map(r => {
    const ps = piecesIn(r.id);
    const [c, row, w, h] = r.grid;
    const ms = [...new Set(ps.map(p => p.medium))];
    return `<button class="tile ${r.outdoor ? 'tile--outdoor' : ''} ${ps.length ? '' : 'tile--empty'}" data-room="${esc(r.id)}" type="button"
      style="grid-column:${c + 1} / span ${w};grid-row:${row + 1} / span ${h}"
      ${ps.length ? '' : 'aria-disabled="true"'}>
      <span class="tile__bar" style="background:${ms.length ? (ms.length === 1 ? `var(--m-${ms[0]})` : stripe(ms)) : 'transparent'}"></span>
      <span class="tile__name">${esc(r.name)}</span>
      ${r.sub ? `<span class="tile__sub">${esc(r.sub)}</span>` : ''}
      ${ps.length ? `<span class="tile__count">${ps.length}</span>` : ''}
      <span class="tile__dots">${ps.map(p => `<i class="dot m-${p.medium}"></i>`).join('')}</span>
    </button>`;
  }).join('');
  return `${liveNote()}${legendHtml()}<div class="floors">${tabs}</div><div class="plan" aria-label="${esc(floor.name)} map">${tiles}</div>`;
}
function stripe(ms) {
  const step = 100 / ms.length;
  return `linear-gradient(to bottom, ${ms.map((m, i) => `var(--m-${m}) ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

function listHtml() {
  const groups = G.floors.map(f => {
    const rs = f.rooms.filter(r => piecesIn(r.id).length);
    if (!rs.length) return '';
    return `<section class="group"><h3 class="group__floor">${esc(f.name)}</h3>${rs.map(r => `
      <button class="roomrow" data-room="${esc(r.id)}" type="button">
        <span class="roomrow__name">${esc(r.name)}</span>
        ${r.sub ? `<span class="roomrow__sub">${esc(r.sub)}</span>` : ''}
        <span class="roomrow__go">›</span>
      </button>
      ${piecesIn(r.id).filter(p => p.rooms[0] === r.id || !p.roaming).map(pieceHtml).join('')}`).join('')}
    </section>`;
  }).join('');
  return `${liveNote()}${legendHtml()}${groups || `<p class="view__empty">${isLive() ? 'Nothing scheduled right this minute — wander, the rooms are all open.' : 'Nothing matches that filter.'}</p>`}`;
}

function pieceHtml(p) {
  const open = ui.open === p.id;
  const live = isLive() && onNow(p);
  const nxt = !isLive() ? null : nextUp(p);
  const w = whenLabel(p);
  return `<article class="piece m-${p.medium} ${open ? 'piece--open' : ''}" data-piece="${esc(p.id)}" tabindex="0" aria-expanded="${open}">
    <div class="piece__top"><span class="piece__title">${esc(p.title)}</span><span class="piece__medium">${esc(mediumName(p.medium))}</span></div>
    <div class="piece__artists">${esc(p.artists)}</div>
    ${p.blurb ? `<div class="piece__blurb">${esc(p.blurb)}</div>` : ''}
    <div class="piece__meta">
      ${live ? '<span class="when when--now">On now</span>' : ''}
      ${w ? `<span class="when">${esc(w)}</span>` : ''}
      ${nxt && !live ? `<span class="when">Next ${esc(nxt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: G.event.tz }))}</span>` : ''}
      ${p.roaming ? '<span class="when">Roaming</span>' : ''}
    </div>
    <div class="piece__more">
      ${p.description ? `<div class="piece__label">About</div><div class="piece__text">${esc(p.description)}</div>` : ''}
      ${p.journey ? `<div class="piece__label">What to expect</div><div class="piece__text">${esc(p.journey)}</div>` : ''}
      <div class="piece__label">Where</div>
      <div class="piece__rooms">${p.rooms.map(id => { const r = roomById(id); return r ? `<button class="roomlink" data-room="${esc(id)}" type="button">${esc(r.name)} · ${esc(r.floorName)}</button>` : ''; }).join('')}</div>
    </div>
  </article>`;
}

function meHtml() {
  return `<div class="me">
    <div class="me__card">
      <div class="me__muted">Signed in with Discord</div>
      <div class="me__name">${esc(me.name || 'Agape guest')}</div>
      <div class="me__muted">You're in the Agape Discord — that's where announcements, set changes and after-party plans land.</div>
    </div>
    <a class="btn btn--block" href="${esc(G.event.discord)}" target="_blank" rel="noopener">Open the Agape Discord</a>
    <div class="me__card">
      <div class="me__muted">Colours</div>
      <div class="legend" style="flex-wrap:wrap">${G.mediums.map(m => `<span class="mchip mchip--static m-${m.id}">${esc(m.name)}</span>`).join('')}</div>
      <div class="me__muted">${G.pieces.length} pieces · ${roomsWithArt().length} rooms with art · Oct 24, 9pm → 9am</div>
    </div>
    <button class="btn btn--ghost btn--block" id="btn-signout" type="button">Sign out</button>
  </div>`;
}

// ---------- room sheet (stories-style: prev/next through rooms with art) ----------
function openRoom(id) {
  ui.room = id; ui.open = null;
  seen.add(id); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch (_) {}
  document.getElementById('sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  renderSheet(); renderStories();
  history.replaceState(null, '', `#room=${id}`);
}
function closeRoom() {
  ui.room = null; document.getElementById('sheet').hidden = true; document.body.style.overflow = '';
  history.replaceState(null, '', location.pathname + location.search);
}
function stepRoom(d) {
  const list = roomsWithArt(); const i = list.findIndex(r => r.id === ui.room);
  const nx = list[i + d]; if (nx) openRoom(nx.id);
}
function renderSheet() {
  const r = roomById(ui.room); if (!r) return closeRoom();
  const list = roomsWithArt(); const i = list.findIndex(x => x.id === r.id);
  document.getElementById('sheet-kicker').textContent = r.floorName;
  document.getElementById('sheet-title').textContent = r.name;
  document.getElementById('sheet-prev').disabled = i <= 0;
  document.getElementById('sheet-next').disabled = i < 0 || i >= list.length - 1;
  const ps = piecesIn(r.id);
  document.getElementById('sheet-body').innerHTML = `
    ${r.sub ? `<div class="sheet__sub">${esc(r.sub)}</div>` : ''}
    ${ps.length ? ps.map(pieceHtml).join('') : `<p class="view__empty">${isLive() ? 'Nothing on in here right now.' : 'Nothing listed here yet.'}</p>`}`;
}

// ---------- auth: Discord sign-in + Agape server membership ----------
function setGate(state, sub, hint) {
  document.body.dataset.auth = state;
  document.getElementById('gate-sub').textContent = sub || '';
  if (hint != null) document.getElementById('gate-hint').textContent = hint;
  const btn = document.getElementById('gate-btn');
  btn.hidden = !(state === 'out' || state === 'error');
  btn.textContent = state === 'error' ? 'Try again' : 'Continue with Discord';
  document.getElementById('gate-join').hidden = state !== 'join';
  document.getElementById('gate-recheck').hidden = state !== 'join';
  document.getElementById('gate').hidden = state === 'in';
  document.getElementById('app').hidden = state !== 'in';
}
async function signIn() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: location.origin + location.pathname, scopes: 'identify email' },
  });
  if (error) setGate('error', error.message || 'Discord sign-in failed.');
}
async function checkAccess(force) {
  setGate('loading', 'Checking your sign-in…');
  const { data } = await sb.auth.getSession();
  const session = data?.session;
  if (!session) {
    setGate('out', 'Every room, every artist, and what’s on right now.',
      'The guide lives on the Agape Discord. Sign in with Discord to see every room.');
    return;
  }
  me.user = session.user;
  const meta = session.user.user_metadata || {};
  me.name = meta.custom_claims?.global_name || meta.full_name || meta.name || null;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(MEMBER_KEY) || 'null'); } catch (_) {}
  if (!force && cached && cached.user === session.user.id && cached.isMember && Date.now() - cached.at < MEMBER_TTL) {
    me.name = cached.name || me.name; enter(); return;
  }
  setGate('loading', 'Checking the Agape Discord…');
  try {
    const resp = await fetch(`${SB_URL}/functions/v1/halloween-guide-member`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: '{}',
    });
    const st = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(st.error || `server returned ${resp.status}`);
    if (!st.linked) { setGate('out', 'This account has no Discord linked.', 'Sign in with the Discord account you use for Agape.'); return; }
    if (st.discordUsername) me.name = st.discordUsername;
    try { localStorage.setItem(MEMBER_KEY, JSON.stringify({ user: session.user.id, isMember: !!st.isMember, name: me.name, at: Date.now() })); } catch (_) {}
    if (!st.isMember) {
      setGate('join', `Almost there${me.name ? `, ${me.name}` : ''} — join the Agape Discord to open the guide.`,
        'Tap join, accept the invite, then come back and check again.');
      return;
    }
    enter();
  } catch (e) {
    setGate('error', 'Couldn’t check the Agape Discord.', e.message);
  }
}
async function signOut() {
  try { localStorage.removeItem(MEMBER_KEY); } catch (_) {}
  await sb.auth.signOut(); closeRoom(); checkAccess();
}
function enter() {
  setGate('in');
  render();
  const m = location.hash.match(/#room=([\w-]+)/); if (m && roomById(m[1])) openRoom(m[1]);
}

// ---------- live theater times ----------
async function refreshTheater() {
  try {
    const { data } = await sb.from('halloween_theater').select('doc').eq('id', 'xv-2026').maybeSingle();
    const acts = data?.doc?.acts; if (!acts) return;
    const add = (t, mins) => { const [h, m] = t.split(':').map(Number); const v = (h * 60 + m + mins) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
    G.pieces.forEach(p => {
      const a = p.theater && acts.find(x => x.id === p.theater); if (!a) return;
      if (a.status === 'declined') { p.times = []; return; }
      const run = a.run || 30;
      p.times = (a.slots || []).filter(Boolean).map(s => [s, add(s, run)]);
    });
    if (document.body.dataset.auth === 'in') render();
  } catch (_) { /* keep the bundled times */ }
}

// ---------- events ----------
function bind() {
  document.addEventListener('click', e => {
    const room = e.target.closest('[data-room]');
    if (room && !room.getAttribute('aria-disabled')) { openRoom(room.dataset.room); return; }
    const piece = e.target.closest('[data-piece]');
    if (piece) { ui.open = ui.open === piece.dataset.piece ? null : piece.dataset.piece; ui.room ? renderSheet() : render(); return; }
    const tab = e.target.closest('[data-tab]'); if (tab) { ui.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
    const fl = e.target.closest('[data-floor]'); if (fl) { ui.floor = fl.dataset.floor; render(); return; }
    const md = e.target.closest('[data-medium]');
    if (md) { const id = md.dataset.medium; ui.mediums.has(id) ? ui.mediums.delete(id) : ui.mediums.add(id); render(); return; }
    if (e.target.id === 'btn-signout') { signOut(); return; }
  });
  document.addEventListener('keydown', e => {
    if (ui.room && e.key === 'Escape') closeRoom();
    if (ui.room && e.key === 'ArrowRight') stepRoom(1);
    if (ui.room && e.key === 'ArrowLeft') stepRoom(-1);
    if (e.key === 'Enter' && e.target.matches('[data-piece]')) e.target.click();
  });
  document.getElementById('sheet-close').addEventListener('click', closeRoom);
  document.getElementById('sheet-prev').addEventListener('click', () => stepRoom(-1));
  document.getElementById('sheet-next').addEventListener('click', () => stepRoom(1));
  // Swipe between rooms, like stories.
  let x0 = null;
  const body = document.getElementById('sheet');
  body.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  body.addEventListener('touchend', e => {
    if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 60) stepRoom(dx < 0 ? 1 : -1);
  });
  document.getElementById('gate-btn').addEventListener('click', () => (document.body.dataset.auth === 'error' ? checkAccess(true) : signIn()));
  document.getElementById('gate-recheck').addEventListener('click', () => checkAccess(true));
  document.getElementById('btn-theme').addEventListener('click', () => {
    const light = document.documentElement.classList.toggle('light');
    try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (_) {}
  });
}

// ---------- utils ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function initials(name) { return name.replace(/[’']s\b/g, '').split(/[\s&·]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }

// ---------- boot ----------
(async function init() {
  try { if (localStorage.getItem(THEME_KEY) === 'light') document.documentElement.classList.add('light'); } catch (_) {}
  bind();
  G = await (await fetch('../data/guide.json?v=' + VERSION)).json();
  // Open on the floor with the most art.
  ui.floor = G.floors.slice().sort((a, b) => b.rooms.reduce((s, r) => s + piecesIn(r.id).length, 0) - a.rooms.reduce((s, r) => s + piecesIn(r.id).length, 0))[0].id;
  if (!window.supabase?.createClient) { setGate('error', 'Couldn’t load sign-in.', 'Check your connection and reload.'); return; }
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  sb = window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { detectSessionInUrl: true, flowType: mobile ? 'implicit' : 'pkce', autoRefreshToken: true, persistSession: true },
  });
  refreshTheater();
  await checkAccess();
  sb.auth.onAuthStateChange((ev, session) => {
    if ((session?.user?.id || null) !== (me.user?.id || null)) checkAccess();
  });
  setInterval(() => { if (isLive() && document.body.dataset.auth === 'in') render(); }, 60 * 1000);
})();
