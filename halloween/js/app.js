/* Agape Halloween placement
   Place collaborator proposals into rooms of the house. No backend: proposals
   come from the Call for Collaborators sheet (live CSV when the sheet is
   link-shareable, bundled snapshot otherwise); placements live in
   localStorage and travel between people as a share link or a JSON export. */

const VERSION = '1.0.0';
console.log(`[halloween] v${VERSION} - placement app`);

const SHEET_ID = '1CT_3fD50yJ0i6US7rvjjpo8oJj9VUGKfBhat8zXjOqo';
const SHEET_GID = '909181316';
const SHEET_CSV = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const STORE_KEY = 'halloween-placement-v1';
const THEME_KEY = 'halloween-theme';

const TAG_LABEL = { space: 'Space', experience: 'Experience', perform: 'Perform', photo: 'Photo', roaming: 'Roaming', food: 'Food' };
const WHEN_LABEL = { setup: 'Setup (12–9pm)', early: 'Early (9pm–12am)', midnight: 'Midnight (12–2am)', late: 'Late (2–6am)', morning: 'Morning (7–9am)', 'all-night': 'All night' };

// ---------- state ----------
let house = null;           // house.json
let proposals = [];         // normalized proposals
let snapshotMeta = {};      // {generated_at}
let state = loadState();    // placements, notes, custom rooms
let ui = { selected: null, status: 'all', tags: new Set(), q: '', panel: 'proposals', editingNote: null };

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && typeof s === 'object') return withDefaults(s);
  } catch (_) { /* fall through */ }
  return withDefaults({});
}
function withDefaults(s) {
  return {
    placements: s.placements || {},   // proposalId -> { room, note }
    roomNotes: s.roomNotes || {},     // roomId -> text (the 2026 annotations)
    houseNotes: typeof s.houseNotes === 'string' ? s.houseNotes : null,
    customRooms: s.customRooms || [], // [{ id, name, floor }]
    updated: s.updated || null,
  };
}
function save() {
  state.updated = new Date().toISOString();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { toast('Could not save locally', true); }
}

// ---------- data ----------
async function loadHouse() {
  const res = await fetch('data/house.json?v=' + VERSION);
  house = await res.json();
}
async function loadSnapshot() {
  const res = await fetch('data/proposals.json?v=' + VERSION);
  const doc = await res.json();
  snapshotMeta = { generated_at: doc.generated_at };
  proposals = doc.proposals;
}
async function loadLive() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(SHEET_CSV, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const rows = parseCsv(text);
    const live = normalizeRows(rows);
    if (!live.length) throw new Error('no rows');
    // Merge: live wins for shared ids; keep snapshot-only rows (deleted from the sheet?) but mark them.
    const byId = new Map(proposals.map(p => [p.id, { ...p, stale: true }]));
    live.forEach(p => byId.set(p.id, p));
    proposals = [...byId.values()].sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
    setStatus(`live · ${live.length} proposals`, true);
    return true;
  } catch (err) {
    console.warn('[halloween] live sheet unavailable, using snapshot:', err.message);
    setStatus(`snapshot · ${proposals.length} proposals · ${fmtDate(snapshotMeta.generated_at)}`, false);
    return false;
  } finally { clearTimeout(timer); }
}

// Same normalization as scripts/halloween-proposals.py, so ids match across
// the snapshot and the live sheet.
const FIELDS = [
  ['Timestamp', 'ts'], ['Full name', 'artist'], ['Phone number', null], ['Email', null],
  ['What would you like to do', 'wants'], ["What's the name of your project", 'project'],
  ['Describe your project', 'description'], ['Share a step-by-step breakdown', 'journey'],
  ['Where does your experience live', 'where'], ['Upload any files', 'files'],
  ['When might your experience be', 'when'], ['Share any past work', 'past_work'],
  ['If any, which Agape Halloweens', 'attended'], ["Anything you'd like to add", 'extra'],
];
const WANT_TAGS = [['Design a space', 'space'], ['Create an experience', 'experience'], ['Perform', 'perform'], ['Event photography', 'photo'], ['Roaming', 'roaming'], ['Breakfast Chef', 'food']];
const WHEN_TAGS = [['Setup before', 'setup'], ['Early', 'early'], ['Midnight', 'midnight'], ['Late night', 'late'], ['Morning', 'morning'], ['All night', 'all-night']];

function normalizeRows(rows) {
  if (rows.length < 2) return [];
  const header = rows[0];
  const idx = {};
  header.forEach((h, i) => { FIELDS.forEach(([prefix, key]) => { if (h.trim().startsWith(prefix)) idx[key || prefix] = i; }); });
  if (idx.artist == null || idx.project == null) return [];
  return rows.slice(1).map(r => {
    const get = k => (idx[k] != null && r[idx[k]] != null) ? String(r[idx[k]]).replace(/\r\n/g, '\n').trim() : '';
    if (!get('artist') && !get('project')) return null;
    const [wants, wantsNote] = tagsFor(get('wants'), WANT_TAGS);
    const [when, whenNote] = tagsFor(get('when'), WHEN_TAGS);
    return {
      id: 'p-' + sha1(`${get('ts')}|${get('artist')}`).slice(0, 8),
      ts: get('ts'), artist: get('artist'), project: get('project') || '(untitled)',
      wants, wants_note: wantsNote, description: get('description'), journey: get('journey'),
      where: get('where'), files: (get('files').match(/https?:\/\/\S+/g) || []),
      when, when_note: whenNote, past_work: get('past_work'), attended: get('attended'), extra: get('extra'),
    };
  }).filter(Boolean);
}
function splitMulti(value) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of value) {
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
    cur += ch;
    if (depth <= 0 && cur.endsWith(', ')) { parts.push(cur.slice(0, -2)); cur = ''; }
  }
  parts.push(cur);
  return parts.map(p => p.trim()).filter(Boolean);
}
function tagsFor(value, table) {
  const tags = [], rest = [];
  splitMulti(value).forEach(part => {
    const hit = table.find(([prefix]) => part.startsWith(prefix));
    if (hit) { if (!tags.includes(hit[1])) tags.push(hit[1]); } else rest.push(part);
  });
  return [tags, rest.join(', ')];
}
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
// Tiny synchronous SHA-1 (ids only need to match the Python script).
function sha1(str) {
  const bytes = new TextEncoder().encode(str);
  const ml = bytes.length * 8;
  const withOne = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withOne.set(bytes); withOne[bytes.length] = 0x80;
  const dv = new DataView(withOne.buffer);
  dv.setUint32(withOne.length - 4, ml >>> 0); dv.setUint32(withOne.length - 8, Math.floor(ml / 0x100000000));
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  for (let off = 0; off < withOne.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, '0')).join('');
}

// ---------- derived ----------
function allRooms() {
  const out = [];
  house.floors.forEach(f => {
    f.rooms.forEach(r => out.push({ ...r, floor: f.id, floorName: f.name }));
    state.customRooms.filter(c => c.floor === f.id).forEach(c => out.push({ id: c.id, name: c.name, kind: 'custom', floor: f.id, floorName: f.name, keys: [c.name.toLowerCase()] }));
  });
  house.zones.forEach(z => out.push({ ...z, floor: 'zones', floorName: 'Zones', kind: 'zone' }));
  return out;
}
function roomById(id) { return allRooms().find(r => r.id === id); }
function placementOf(p) { return state.placements[p.id] || null; }
function statusOf(p) {
  const pl = placementOf(p);
  if (!pl) return 'unplaced';
  return pl.room === 'declined' ? 'declined' : 'placed';
}
function inRoom(roomId) { return proposals.filter(p => placementOf(p)?.room === roomId); }
function hintRooms(p) {
  if (!p) return new Set();
  const text = `${p.where} ${p.wants_note} ${p.when_note}`.toLowerCase();
  const hits = new Set();
  allRooms().forEach(r => { (r.keys || []).forEach(k => { if (text.includes(k)) hits.add(r.id); }); });
  if (p.wants.includes('roaming')) hits.add('roaming');
  return hits;
}
function visibleProposals() {
  const q = ui.q.trim().toLowerCase();
  return proposals.filter(p => {
    if (ui.status !== 'all' && statusOf(p) !== ui.status) return false;
    if (ui.tags.size && ![...ui.tags].every(t => p.wants.includes(t))) return false;
    if (q) {
      const hay = `${p.project} ${p.artist} ${p.where} ${p.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ---------- actions ----------
function place(pid, roomId, opts = {}) {
  const p = proposals.find(x => x.id === pid); if (!p) return;
  if (!roomId) { delete state.placements[pid]; }
  else {
    const prev = state.placements[pid] || {};
    state.placements[pid] = { room: roomId, note: prev.note || '' };
  }
  save(); render();
  if (!opts.quiet) {
    const r = roomId && roomById(roomId);
    toast(r ? `${p.project} → ${r.name}` : `${p.project} unplaced`);
  }
}
function select(pid) {
  ui.selected = pid;
  render();
  if (pid && window.innerWidth <= 900 && ui.panel === 'proposals') setPanel('detail');
}
function setPanel(name) {
  ui.panel = name;
  document.querySelector('.layout').dataset.panel = name;
  document.querySelectorAll('#mobile-tabs .tab').forEach(t => t.classList.toggle('tab--active', t.dataset.panel === name));
}

// ---------- render ----------
function render() { renderList(); renderHouse(); renderDetail(); renderCounts(); }

function renderCounts() {
  const c = { all: proposals.length, unplaced: 0, placed: 0, declined: 0 };
  proposals.forEach(p => c[statusOf(p)]++);
  document.querySelectorAll('[data-count]').forEach(el => { el.textContent = c[el.dataset.count]; });
}

function renderList() {
  const list = document.getElementById('plist');
  const items = visibleProposals();
  if (!items.length) { list.innerHTML = '<div class="plist__empty">Nothing matches.</div>'; return; }
  list.innerHTML = items.map(p => {
    const st = statusOf(p);
    const pl = placementOf(p);
    const room = pl && roomById(pl.room);
    return `<article class="pcard${ui.selected === p.id ? ' pcard--selected' : ''}${st === 'declined' ? ' pcard--declined' : ''}" draggable="true" data-id="${p.id}" role="listitem" tabindex="0">
      <div class="pcard__project">${esc(p.project)}</div>
      <div class="pcard__artist">${esc(p.artist)}${p.stale ? ' · <em>not in sheet</em>' : ''}</div>
      ${p.where ? `<div class="pcard__where">${esc(p.where)}</div>` : ''}
      <div class="pcard__foot">${tagsHtml(p)}${room ? `<span class="pcard__placed">${esc(room.name)}</span>` : ''}</div>
    </article>`;
  }).join('');
}
function tagsHtml(p) { return p.wants.map(t => `<span class="tag tag--${t}">${TAG_LABEL[t] || t}</span>`).join(''); }

function renderHouse() {
  const el = document.getElementById('house');
  const sel = proposals.find(p => p.id === ui.selected);
  const hints = hintRooms(sel);
  const notes = state.houseNotes ?? house.house_notes ?? '';
  let html = `<div class="house__notes"><div class="house__label">House notes</div><textarea id="house-notes" placeholder="Notes that apply to the whole house…">${esc(notes)}</textarea></div>`;
  house.floors.forEach(f => {
    const rooms = [...f.rooms, ...state.customRooms.filter(c => c.floor === f.id).map(c => ({ id: c.id, name: c.name, kind: 'custom', custom: true }))];
    const n = rooms.reduce((a, r) => a + inRoom(r.id).length, 0);
    html += `<section class="floor" data-floor="${f.id}">
      <div class="floor__head"><span class="floor__name">${esc(f.name)}</span><span class="floor__meta">${n ? `${n} placed` : ''}</span>
        <button class="btn btn--sm btn--ghost floor__add" data-add-room="${f.id}" type="button">+ room</button></div>
      <div class="floor__grid">${rooms.map(r => roomHtml(r, hints)).join('')}</div></section>`;
  });
  html += `<section class="floor floor--zones"><div class="floor__head"><span class="floor__name">Zones</span><span class="floor__meta">not a room</span></div>
    <div class="floor__grid">${house.zones.map(z => roomHtml({ ...z, kind: 'zone' }, hints)).join('')}</div></section>`;
  html += `<p class="house__label" style="margin-top:8px">${esc(house.notes_source)}</p>`;
  el.innerHTML = html;
}
function roomHtml(r, hints) {
  const items = inRoom(r.id);
  const note = state.roomNotes[r.id] || '';
  const editing = ui.editingNote === r.id;
  const cls = ['room', r.size ? `room--${r.size}` : '', `room--${r.kind}`, hints.has(r.id) ? 'room--hint' : '', r.id === 'declined' ? 'room--declined' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" data-room="${r.id}">
    <div class="room__head"><span class="room__name">${esc(r.name)}</span><span class="room__count">${items.length || ''}</span>
      <button class="room__note-btn" data-note="${r.id}" type="button" title="Edit this room's 2026 note">${note ? 'edit' : 'note'}</button>
      ${r.custom ? `<button class="room__note-btn" data-del-room="${r.id}" type="button" title="Remove this room">×</button>` : ''}</div>
    ${r.last ? `<div class="room__last">’25: ${esc(r.last)}</div>` : ''}
    ${r.hint ? `<div class="room__hint">${esc(r.hint)}</div>` : ''}
    ${editing ? `<textarea class="room__note-edit" data-note-edit="${r.id}" placeholder="2026 note for this room…">${esc(note)}</textarea>` : note ? `<div class="room__note">${esc(note)}</div>` : ''}
    <div class="room__chips">${items.map(p => `<div class="chip${ui.selected === p.id ? ' chip--selected' : ''}" draggable="true" data-id="${p.id}" title="${esc(p.project)} — ${esc(p.artist)}">
        <span class="chip__text"><b>${esc(p.project)}</b> · ${esc(p.artist)}${placementOf(p)?.note ? ` — ${esc(placementOf(p).note)}` : ''}</span>
        <button class="chip__x" data-unplace="${p.id}" type="button" title="Unplace">×</button></div>`).join('')}</div>
  </div>`;
}

function renderDetail() {
  const el = document.getElementById('detail');
  const p = proposals.find(x => x.id === ui.selected);
  if (!p) {
    el.className = 'detail detail--empty';
    el.innerHTML = '<p class="detail__empty">Pick a proposal to read the whole thing here while you look at the house.</p><p class="detail__empty detail__empty--hint">Drag a card onto a room, or use the “Place in” menu on this panel.</p>';
    return;
  }
  el.className = 'detail';
  const pl = placementOf(p);
  const rooms = allRooms();
  const groups = {};
  rooms.forEach(r => { (groups[r.floorName] ||= []).push(r); });
  const options = ['<option value="">— Unplaced —</option>'].concat(Object.entries(groups).map(([floor, rs]) =>
    `<optgroup label="${esc(floor)}">${rs.map(r => `<option value="${r.id}"${pl?.room === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</optgroup>`)).join('');
  const when = p.when.map(w => WHEN_LABEL[w] || w).join(' · ') + (p.when_note ? (p.when.length ? ' · ' : '') + p.when_note : '');
  el.innerHTML = `
    <header>
      <h2 class="detail__project">${esc(p.project)}</h2>
      <div class="detail__artist">${esc(p.artist)}</div>
      <div class="detail__tags">${tagsHtml(p)}${p.wants_note ? `<span class="tag">${esc(p.wants_note)}</span>` : ''}</div>
    </header>
    <div class="detail__place">
      <select class="input select" id="place-select" aria-label="Place in">${options}</select>
      <button class="btn btn--sm${pl?.room === 'declined' ? ' btn--filled' : ''}" id="place-decline" type="button">${pl?.room === 'declined' ? 'Declined' : 'Not this year'}</button>
      <textarea class="detail__place-note" id="place-note" placeholder="Placement note (e.g. ‘9pm–12am only’, ‘shares with Tea Lounge’)…">${esc(pl?.note || '')}</textarea>
    </div>
    ${section('Where it lives', p.where)}
    ${section('When', when)}
    ${section('Description', p.description)}
    ${section('Participant journey', p.journey)}
    ${p.files.length ? `<div class="detail__section"><div class="detail__label">Files</div><div class="detail__files">${p.files.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(shortUrl(u))}</a>`).join('')}</div></div>` : ''}
    ${section('Past work', p.past_work, true)}
    ${section('Agape Halloweens attended', p.attended, true)}
    ${section('Anything else', p.extra, true)}
    <div class="detail__meta">Submitted ${esc(p.ts)} · ${p.id}</div>`;
}
function section(label, text, muted) {
  if (!text) return '';
  return `<div class="detail__section"><div class="detail__label">${label}</div><div class="detail__text${muted ? ' detail__text--muted' : ''}">${linkify(text)}</div></div>`;
}

// ---------- share / export ----------
function encodeShare() {
  const compact = { p: state.placements, n: state.roomNotes, h: state.houseNotes, c: state.customRooms };
  return b64u(JSON.stringify(compact));
}
function decodeShare(s) {
  const o = JSON.parse(unb64u(s));
  return withDefaults({ placements: o.p, roomNotes: o.n, houseNotes: o.h, customRooms: o.c });
}
function b64u(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); }

function summaryText() {
  const lines = [`Agape Halloween XV — placements (${new Date().toLocaleDateString()})`, ''];
  house.floors.forEach(f => {
    const rooms = [...f.rooms, ...state.customRooms.filter(c => c.floor === f.id)];
    const has = rooms.some(r => inRoom(r.id).length || state.roomNotes[r.id]);
    if (!has) return;
    lines.push(`## ${f.name}`);
    rooms.forEach(r => {
      const items = inRoom(r.id); const note = state.roomNotes[r.id];
      if (!items.length && !note) return;
      lines.push(`- ${r.name}${note ? ` — ${note}` : ''}`);
      items.forEach(p => lines.push(`    - ${p.project} (${p.artist})${placementOf(p).note ? ` — ${placementOf(p).note}` : ''}`));
    });
    lines.push('');
  });
  house.zones.forEach(z => {
    const items = inRoom(z.id); if (!items.length) return;
    lines.push(`## ${z.name}`); items.forEach(p => lines.push(`- ${p.project} (${p.artist})`)); lines.push('');
  });
  const un = proposals.filter(p => statusOf(p) === 'unplaced');
  if (un.length) { lines.push('## Unplaced'); un.forEach(p => lines.push(`- ${p.project} (${p.artist})`)); }
  return lines.join('\n');
}

// ---------- events ----------
function bind() {
  const list = document.getElementById('plist');
  list.addEventListener('click', e => { const card = e.target.closest('.pcard'); if (card) select(card.dataset.id); });
  list.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('pcard')) select(e.target.dataset.id); });
  list.addEventListener('dragstart', e => {
    const card = e.target.closest('.pcard'); if (!card) return;
    e.dataTransfer.setData('text/plain', card.dataset.id); e.dataTransfer.effectAllowed = 'move';
    card.classList.add('pcard--dragging'); ui.selected = card.dataset.id; renderHouse(); renderDetail();
  });
  list.addEventListener('dragend', e => { e.target.closest('.pcard')?.classList.remove('pcard--dragging'); });

  document.getElementById('search').addEventListener('input', e => { ui.q = e.target.value; renderList(); });
  document.getElementById('status-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-status]'); if (!b) return;
    ui.status = b.dataset.status;
    document.querySelectorAll('#status-filters .filter-token').forEach(t => t.classList.toggle('filter-token--active', t === b));
    renderList();
  });
  document.getElementById('tag-filters').addEventListener('click', e => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    const t = b.dataset.tag; ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t);
    b.classList.toggle('filter-token--active', ui.tags.has(t)); renderList();
  });

  const houseEl = document.getElementById('house');
  houseEl.addEventListener('dragover', e => { const r = e.target.closest('.room'); if (!r) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; r.classList.add('room--over'); });
  houseEl.addEventListener('dragleave', e => { const r = e.target.closest('.room'); if (r && !r.contains(e.relatedTarget)) r.classList.remove('room--over'); });
  houseEl.addEventListener('drop', e => {
    const r = e.target.closest('.room'); if (!r) return; e.preventDefault();
    const pid = e.dataTransfer.getData('text/plain'); if (pid) place(pid, r.dataset.room);
  });
  houseEl.addEventListener('dragstart', e => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    e.dataTransfer.setData('text/plain', chip.dataset.id); e.dataTransfer.effectAllowed = 'move';
  });
  houseEl.addEventListener('click', e => {
    const un = e.target.closest('[data-unplace]'); if (un) { place(un.dataset.unplace, null); return; }
    const noteBtn = e.target.closest('[data-note]'); if (noteBtn) { ui.editingNote = noteBtn.dataset.note; renderHouse(); houseEl.querySelector(`[data-note-edit="${ui.editingNote}"]`)?.focus(); return; }
    const del = e.target.closest('[data-del-room]'); if (del) { removeRoom(del.dataset.delRoom); return; }
    const add = e.target.closest('[data-add-room]'); if (add) { addRoom(add.dataset.addRoom); return; }
    const chip = e.target.closest('.chip'); if (chip) { select(chip.dataset.id); }
  });
  houseEl.addEventListener('focusout', e => {
    const ta = e.target.closest('[data-note-edit]');
    if (ta) { state.roomNotes[ta.dataset.noteEdit] = ta.value.trim(); if (!state.roomNotes[ta.dataset.noteEdit]) delete state.roomNotes[ta.dataset.noteEdit]; ui.editingNote = null; save(); renderHouse(); }
    if (e.target.id === 'house-notes') { state.houseNotes = e.target.value; save(); }
  });
  houseEl.addEventListener('keydown', e => { if (e.key === 'Escape' && e.target.closest('[data-note-edit]')) { ui.editingNote = null; renderHouse(); } });

  const detail = document.getElementById('detail');
  detail.addEventListener('change', e => {
    if (e.target.id === 'place-select') place(ui.selected, e.target.value || null);
    if (e.target.id === 'place-note') { const pl = state.placements[ui.selected]; if (pl) { pl.note = e.target.value.trim(); save(); renderHouse(); } else if (e.target.value.trim()) toast('Place it somewhere first, then add a note', true); }
  });
  detail.addEventListener('click', e => {
    if (e.target.id === 'place-decline') { const pl = placementOf(proposals.find(p => p.id === ui.selected)); place(ui.selected, pl?.room === 'declined' ? null : 'declined'); }
  });

  document.getElementById('mobile-tabs').addEventListener('click', e => { const t = e.target.closest('[data-panel]'); if (t) setPanel(t.dataset.panel); });

  document.getElementById('btn-share').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#s=${encodeShare()}`;
    await copy(url); toast('Share link copied');
  });
  document.getElementById('btn-summary').addEventListener('click', async () => { await copy(summaryText()); toast('Summary copied'); });
  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: VERSION, exported: new Date().toISOString(), ...state }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `halloween-placements-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { state = withDefaults(JSON.parse(await f.text())); save(); render(); toast('Placements loaded'); }
    catch (_) { toast('That file is not a placements export', true); }
    e.target.value = '';
  });
  document.getElementById('btn-refresh').addEventListener('click', async () => { setStatus('refreshing…'); const ok = await loadLive(); render(); if (!ok) toast('Sheet not reachable — showing the bundled snapshot', true); });
  document.getElementById('btn-theme').addEventListener('click', () => {
    const light = document.documentElement.classList.toggle('light');
    try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch (_) {}
  });

  document.getElementById('banner-yes').addEventListener('click', () => { state = pendingShare; pendingShare = null; save(); render(); hideBanner(); toast('Shared placements loaded'); });
  document.getElementById('banner-no').addEventListener('click', hideBanner);
}

function addRoom(floorId) {
  const name = prompt('Room or spot name (e.g. "Tea lounge", "Under the stairs")'); if (!name?.trim()) return;
  const id = 'x-' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 5);
  state.customRooms.push({ id, name: name.trim(), floor: floorId }); save(); render();
}
function removeRoom(id) {
  const n = inRoom(id).length;
  if (n && !confirm(`Remove this room and unplace ${n} proposal${n > 1 ? 's' : ''}?`)) return;
  inRoom(id).forEach(p => delete state.placements[p.id]);
  delete state.roomNotes[id];
  state.customRooms = state.customRooms.filter(c => c.id !== id); save(); render();
}

let pendingShare = null;
function checkShareHash() {
  const m = location.hash.match(/#s=([A-Za-z0-9_-]+)/); if (!m) return;
  try { pendingShare = decodeShare(m[1]); } catch (_) { toast('Share link is malformed', true); return; }
  history.replaceState(null, '', location.pathname);
  const mine = Object.keys(state.placements).length || Object.keys(state.roomNotes).length;
  if (!mine) { state = pendingShare; pendingShare = null; save(); return; }
  const n = Object.keys(pendingShare.placements).length;
  document.getElementById('banner-text').textContent = `This link carries ${n} placement${n === 1 ? '' : 's'}. Load them and replace what's saved here?`;
  document.getElementById('banner').hidden = false;
}
function hideBanner() { document.getElementById('banner').hidden = true; }

// ---------- utils ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s<]+)/g, u => `<a href="${u}" target="_blank" rel="noopener">${shortUrl(u)}</a>`); }
function shortUrl(u) { try { const x = new URL(u); return (x.host.replace(/^www\./, '') + x.pathname).replace(/\/$/, '').slice(0, 48); } catch (_) { return u.slice(0, 48); } }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
function setStatus(text, live) { const el = document.getElementById('status'); el.textContent = text; el.classList.toggle('topbar__status--live', !!live); }
async function copy(text) { try { await navigator.clipboard.writeText(text); } catch (_) { prompt('Copy this:', text); } }
function toast(msg, err) {
  const el = document.createElement('div'); el.className = 'toast' + (err ? ' toast--error' : ''); el.textContent = msg;
  document.getElementById('toasts').appendChild(el); setTimeout(() => el.remove(), 2600);
}

// ---------- boot ----------
(async function init() {
  try { if (localStorage.getItem(THEME_KEY) === 'light') document.documentElement.classList.add('light'); } catch (_) {}
  bind();
  await Promise.all([loadHouse(), loadSnapshot()]);
  checkShareHash();
  setStatus(`snapshot · ${proposals.length} proposals · ${fmtDate(snapshotMeta.generated_at)}`);
  render();
  await loadLive();
  render();
})();
