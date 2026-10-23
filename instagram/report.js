const VERSION = '0.1.0';
console.log(`[instagram-audit] v${VERSION} - scaffold`);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '—');
const handle = (u) => `<a href="https://www.instagram.com/${esc(u)}/" target="_blank" rel="noopener">@${esc(u)}</a>`;

function table(el, cols, rows, opts = {}) {
  const head = `<thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const body = rows.length
    ? rows.map((r) => `<tr${opts.rowClass ? ` class="${opts.rowClass(r)}"` : ''}${opts.rowAttr ? ` ${opts.rowAttr(r)}` : ''}>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${cols.length}" class="muted">${esc(opts.empty || 'Nothing yet.')}</td></tr>`;
  el.innerHTML = head + `<tbody>${body}</tbody>`;
}

function pending(el, what) {
  el.innerHTML = `<p class="pending">Pending: ${esc(what)}</p>`;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// Cut lists: one checkbox per row, ticks kept in localStorage per list.
function cutList(list, accounts) {
  const key = `ig-cut:${list.id}`;
  let ticked = new Set();
  try { ticked = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch {}
  const rows = list.usernames.map((u) => accounts[u] || { username: u });
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <h3>${esc(list.title)} <span class="muted">· ${rows.length}</span></h3>
    <p class="muted">${esc(list.why || '')}</p>
    <div class="row-actions">
      <span class="muted"><span data-count>${ticked.size}</span> of ${rows.length} done</span>
      <button class="btn btn--ghost btn--sm" data-copy>copy usernames</button>
      <button class="btn btn--ghost btn--sm" data-copy-left>copy what's left</button>
    </div>
    <div class="data-table-wrap"><table class="data-table"></table></div>`;
  const tbl = wrap.querySelector('table');
  const save = () => { try { localStorage.setItem(key, JSON.stringify([...ticked])); } catch {} wrap.querySelector('[data-count]').textContent = ticked.size; };
  table(tbl, [
    { label: '', render: (r) => `<input type="checkbox" data-u="${esc(r.username)}" ${ticked.has(r.username) ? 'checked' : ''} aria-label="unfollowed ${esc(r.username)}">` },
    { label: 'account', render: (r) => `${handle(r.username)}${r.name ? `<br><span class="muted">${esc(r.name)}</span>` : ''}` },
    { label: 'why', render: (r) => `${esc(r.reason || '')}` },
    { label: 'followed', key: 'follow_date' },
    { label: 'last like', render: (r) => esc(r.last_like || 'never') },
  ], rows, { rowClass: (r) => (ticked.has(r.username) ? 'cut' : '') });
  tbl.addEventListener('change', (e) => {
    const u = e.target.dataset.u; if (!u) return;
    e.target.checked ? ticked.add(u) : ticked.delete(u);
    e.target.closest('tr').classList.toggle('cut', e.target.checked);
    save();
  });
  wrap.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(list.usernames.join('\n')).then(() => toast(`copied ${list.usernames.length}`));
  wrap.querySelector('[data-copy-left]').onclick = () => { const left = list.usernames.filter((u) => !ticked.has(u)); navigator.clipboard.writeText(left.join('\n')).then(() => toast(`copied ${left.length}`)); };
  return wrap;
}

async function main() {
  const data = await fetch('data.json?v=' + Date.now()).then((r) => r.json());
  const accounts = Object.fromEntries((data.accounts || []).map((a) => [a.username, a]));
  const s = data.summary || {};

  $('subtitle').textContent = `${fmt(s.following)} following · ${fmt(s.followers)} followers · data as of ${data.data_date || '—'}`;

  // Findings
  $('findings-list').innerHTML = (data.findings || []).map((f) => `<li>${esc(f)}</li>`).join('') || '<li class="muted">Pending.</li>';

  // Stats
  $('stats').innerHTML = (data.stats || []).map((st) => `<div class="stat"><span class="stat__value">${esc(st.value)}</span><span class="stat__label">${esc(st.label)}</span></div>`).join('');
  $('summary-text').innerHTML = (data.summary_text || []).map((p) => `<p>${esc(p)}</p>`).join('');

  // Interest map
  if (data.interests && data.interests.length) {
    table($('interests-table'), [
      { label: 'cluster', key: 'cluster' },
      { label: 'accounts', key: 'count', num: true },
      { label: 'share', render: (r) => pct(r.count, s.following), num: true },
      { label: 'engaged', render: (r) => `${fmt(r.engaged)} <span class="muted">(${pct(r.engaged, r.count)})</span>`, num: true },
      { label: 'examples', render: (r) => (r.examples || []).map(handle).join(', ') },
    ], data.interests);
  } else pending($('interests').querySelector('.data-table-wrap'), 'profile reads (bio and captions) for the accounts you follow.');

  // Classes
  if (data.classes && data.classes.length) {
    table($('classes-table'), [
      { label: 'class', key: 'class' },
      { label: 'accounts', key: 'count', num: true },
      { label: 'share', render: (r) => pct(r.count, s.following), num: true },
      { label: 'never liked', key: 'never_liked', num: true },
      { label: 'note', key: 'note' },
    ], data.classes);
  } else pending($('classes').querySelector('.data-table-wrap'), 'classification, which needs the profile reads.');

  // People
  if (data.people && data.people.length) {
    table($('people-table'), [
      { label: 'account', render: (r) => `${handle(r.username)}${r.name ? `<br><span class="muted">${esc(r.name)}</span>` : ''}` },
      { label: 'relationship', render: (r) => `<span class="inf">${esc(r.relationship || '')}</span>` },
      { label: 'follows back', render: (r) => (r.follows_back ? 'yes' : 'no') },
      { label: 'likes 36 mo', key: 'likes_36mo', num: true },
      { label: 'last like', render: (r) => esc(r.last_like || 'never') },
    ], data.people);
  } else pending($('people').querySelector('.data-table-wrap'), 'the people pass.');

  // Usage
  $('usage-text').innerHTML = (data.usage || []).map((p) => `<p>${esc(p)}</p>`).join('') || '<p class="pending">Pending.</p>';

  // Cut lists
  const cl = $('cut-lists');
  cl.innerHTML = '';
  (data.cut_lists || []).forEach((l) => cl.appendChild(cutList(l, accounts)));
  if (!(data.cut_lists || []).length) pending(cl, 'the cut lists, after classification.');

  // Recs
  $('recs-list').innerHTML = (data.recommendations || []).map((r) => `<li>${esc(r)}</li>`).join('') || '<li class="muted">Pending.</li>';

  // Footer
  $('footer').innerHTML = `
    <p>Data: ${esc(data.data_date || '—')}.</p>
    <p>Inputs used: ${esc((data.inputs_used || []).join(' · ') || '—')}.</p>
    <p>Inputs missing: ${esc((data.inputs_missing || []).join(' · ') || 'none')}.</p>
    <p>Private by obscurity only; not linked from the home page.</p>`;
}

main().catch((e) => { console.error(e); $('subtitle').textContent = 'Could not load data.json'; });
