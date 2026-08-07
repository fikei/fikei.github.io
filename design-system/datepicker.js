/* Sassy date picker — a calendar dropdown for every date field.
   Self-contained: include the script and every input[type=date] and
   input[type=datetime-local] on the page gets a themed calendar on focus.
   Typing stays first-class — the input is never readonly, the calendar
   follows what you type, and picking a day writes back through normal
   'input' + 'change' events so autosave forms hear it.

   Desktop: popover anchored under the field (flips above when cramped).
   Mobile (coarse pointer or ≤520px): bottom sheet with a backdrop; the
   native wheel is suppressed so there is one picker, not two.

   Respects min/max on the input. For datetime-local the calendar owns the
   date half and leaves the typed time alone (defaults 12:00).
   Opt out per field with data-no-picker. */

(() => {
  const VERSION = '1.0.0';
  console.log(`[datepicker] v${VERSION} - Sassy calendar dropdown`);

  const SEL = 'input[type="date"]:not([data-no-picker]), input[type="datetime-local"]:not([data-no-picker])';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const coarse = matchMedia('(pointer: coarse)');
  const narrow = matchMedia('(max-width: 520px)');
  const sheetMode = () => coarse.matches || narrow.matches;

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parseIso = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
    return m ? { y: +m[1], mo: +m[2] - 1, d: +m[3] } : null;
  };

  let pop = null, back = null, anchor = null, vy = 0, vm = 0;

  const STYLE = `
  .dp { position: absolute; z-index: 1200; min-width: 252px; padding: var(--space-3, 12px);
    background: var(--bg-elevated, #1f2630); border: 1px solid var(--border, rgba(240,246,252,0.12));
    border-radius: var(--radius-md, 10px); box-shadow: var(--shadow-md, 0 8px 24px rgba(0,0,0,0.35)); }
  .dp--sheet { position: fixed; left: 0; right: 0; bottom: 0; min-width: 0;
    border-radius: var(--radius-md, 10px) var(--radius-md, 10px) 0 0; border-bottom: 0;
    padding-bottom: max(var(--space-3, 12px), env(safe-area-inset-bottom)); }
  .dp-back { position: fixed; inset: 0; z-index: 1199; background: rgba(0,0,0,0.4); }
  .dp__head { display: flex; align-items: center; gap: var(--space-2, 8px); margin-bottom: var(--space-2, 8px); }
  .dp__nav { flex: none; width: 28px; height: 28px; border: 0; border-radius: var(--radius-sm, 6px);
    background: transparent; color: var(--fg-muted, #b9c0c9); font-size: 14px; cursor: pointer; }
  .dp__nav:hover { background: var(--bg-overlay, rgba(255,255,255,0.06)); color: var(--fg, #f0f6fc); }
  .dp__sel { flex: 1; display: flex; gap: var(--space-1, 4px); justify-content: center; }
  .dp__sel select { border: 0; background: transparent; color: var(--fg, #f0f6fc);
    font: inherit; font-size: var(--font-size-small, 13px); font-weight: var(--fw-semibold, 600);
    text-align: center; cursor: pointer; border-radius: var(--radius-sm, 6px); padding: 2px 2px; }
  .dp__sel select:hover { background: var(--bg-overlay, rgba(255,255,255,0.06)); }
  .dp__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .dp__dow { text-align: center; padding: 2px 0; color: var(--fg-subtle, rgba(240,246,252,0.5));
    font-size: var(--font-size-caption, 11px); font-weight: var(--fw-semibold, 600); }
  .dp__day { aspect-ratio: 1; min-width: 30px; border: 0; border-radius: var(--radius-sm, 6px);
    background: transparent; color: var(--fg, #f0f6fc); font-size: var(--font-size-small, 13px);
    cursor: pointer; font-variant-numeric: tabular-nums; }
  .dp--sheet .dp__day { min-height: 42px; }
  .dp__day:hover { background: var(--bg-overlay, rgba(255,255,255,0.06)); }
  .dp__day.is-today { box-shadow: inset 0 0 0 1px var(--border-strong, rgba(240,246,252,0.28)); }
  .dp__day.is-selected { background: var(--accent-strong, #5CB2FF); color: var(--accent-strong-fg, #06264D); font-weight: var(--fw-semibold, 600); }
  .dp__day:disabled { color: var(--fg-subtle, rgba(240,246,252,0.5)); opacity: 0.4; cursor: default; background: transparent; }
  .dp__blank { pointer-events: none; }
  .dp__foot { display: flex; justify-content: space-between; margin-top: var(--space-2, 8px); }
  .dp__quiet { border: 0; background: transparent; color: var(--fg-link, #5CB2FF);
    font-size: var(--font-size-caption, 11px); cursor: pointer; padding: 4px 6px; border-radius: var(--radius-sm, 6px); }
  .dp__quiet:hover { background: var(--bg-overlay, rgba(255,255,255,0.06)); }
  input[type="date"]::-webkit-calendar-picker-indicator,
  input[type="datetime-local"]::-webkit-calendar-picker-indicator { display: none; }
  `;

  function ensureBuilt() {
    if (pop) return;
    const st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);
    pop = document.createElement('div');
    pop.className = 'dp';
    pop.hidden = true;
    // Keep focus (and the caret) in the input while clicking around the
    // calendar — click handlers still fire, blur never does.
    pop.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.appendChild(pop);
    back = document.createElement('div');
    back.className = 'dp-back';
    back.hidden = true;
    back.addEventListener('click', close);
    document.body.appendChild(back);
  }

  function limits() {
    return { min: parseIso(anchor.getAttribute('min')), max: parseIso(anchor.getAttribute('max')) };
  }
  const before = (y, m, d, l) => l && (y < l.y || (y === l.y && (m < l.mo || (m === l.mo && d < l.d))));
  const after = (y, m, d, l) => l && (y > l.y || (y === l.y && (m > l.mo || (m === l.mo && d > l.d))));

  function render() {
    const sel = parseIso(anchor.value);
    const t = new Date();
    const { min, max } = limits();
    const first = new Date(vy, vm, 1).getDay();
    const days = new Date(vy, vm + 1, 0).getDate();
    const years = [];
    const y0 = Math.min(vy, t.getFullYear()) - 5, y1 = Math.max(vy, t.getFullYear()) + 6;
    for (let y = y0; y <= y1; y++) years.push(y);
    let cells = DOW.map((d) => `<span class="dp__dow">${d}</span>`).join('');
    for (let i = 0; i < first; i++) cells += '<span class="dp__day dp__blank"></span>';
    for (let d = 1; d <= days; d++) {
      const isSel = sel && sel.y === vy && sel.mo === vm && sel.d === d;
      const isToday = t.getFullYear() === vy && t.getMonth() === vm && t.getDate() === d;
      const dis = before(vy, vm, d, min) || after(vy, vm, d, max);
      cells += `<button type="button" class="dp__day${isSel ? ' is-selected' : ''}${isToday ? ' is-today' : ''}"
        data-day="${d}" ${dis ? 'disabled' : ''}>${d}</button>`;
    }
    pop.innerHTML = `
      <div class="dp__head">
        <button type="button" class="dp__nav" data-nav="-1" aria-label="Previous month">‹</button>
        <span class="dp__sel">
          <select data-month aria-label="Month">${MONTHS.map((m, i) =>
            `<option value="${i}" ${i === vm ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <select data-year aria-label="Year">${years.map((y) =>
            `<option value="${y}" ${y === vy ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </span>
        <button type="button" class="dp__nav" data-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="dp__grid">${cells}</div>
      <div class="dp__foot">
        <button type="button" class="dp__quiet" data-today>Today</button>
        ${anchor.required ? '' : '<button type="button" class="dp__quiet" data-clear>Clear</button>'}
      </div>`;
  }

  function position() {
    pop.classList.toggle('dp--sheet', sheetMode());
    back.hidden = !sheetMode();
    if (sheetMode()) { pop.style.left = pop.style.top = ''; return; }
    const r = anchor.getBoundingClientRect();
    const h = pop.offsetHeight || 300;
    const below = r.bottom + 4 + h < innerHeight;
    pop.style.left = `${Math.max(8, Math.min(r.left + scrollX, scrollX + innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${(below ? r.bottom + 4 : r.top - h - 4) + scrollY}px`;
  }

  function open(el) {
    ensureBuilt();
    anchor = el;
    const cur = parseIso(el.value);
    const now = new Date();
    vy = cur ? cur.y : now.getFullYear();
    vm = cur ? cur.mo : now.getMonth();
    pop.hidden = false;
    render();
    position();
  }

  function close() {
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    back.hidden = true;
    anchor = null;
  }

  function write(val) {
    if (anchor.type === 'datetime-local') {
      const time = /T(\d{2}:\d{2})/.exec(anchor.value || '');
      val = val ? `${val}T${time ? time[1] : '12:00'}` : '';
    }
    anchor.value = val;
    anchor.dispatchEvent(new Event('input', { bubbles: true }));
    anchor.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('focusin', (e) => {
    if (e.target.matches?.(SEL)) { if (anchor !== e.target) open(e.target); }
    else if (pop && !pop.hidden && !pop.contains(e.target)) close();
  });
  // Coarse pointers: one picker, not the native wheel underneath ours.
  document.addEventListener('touchend', (e) => {
    const el = e.target.closest?.(SEL);
    if (el && sheetMode()) { e.preventDefault(); open(el); }
  }, { passive: false });
  document.addEventListener('mousedown', (e) => {
    if (pop && !pop.hidden && !pop.contains(e.target) && e.target !== anchor && e.target !== back) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('input', (e) => {
    if (e.target === anchor) {
      const cur = parseIso(anchor.value);
      if (cur) { vy = cur.y; vm = cur.mo; }
      render();
    }
  });
  addEventListener('resize', () => { if (anchor) position(); });
  addEventListener('scroll', () => { if (anchor && !sheetMode()) position(); }, true);

  document.addEventListener('click', (e) => {
    if (!pop || pop.hidden || !pop.contains(e.target)) return;
    const day = e.target.closest('[data-day]');
    const nav = e.target.closest('[data-nav]');
    if (day) { write(iso(vy, vm, +day.dataset.day)); if (anchor.type === 'date') close(); else render(); }
    else if (nav) { vm += +nav.dataset.nav; if (vm < 0) { vm = 11; vy--; } if (vm > 11) { vm = 0; vy++; } render(); }
    else if (e.target.closest('[data-today]')) {
      const t = new Date(); vy = t.getFullYear(); vm = t.getMonth();
      write(iso(vy, vm, t.getDate())); if (anchor.type === 'date') close(); else render();
    }
    else if (e.target.closest('[data-clear]')) { write(''); close(); }
  });
  document.addEventListener('change', (e) => {
    if (!pop || pop.hidden || !pop.contains(e.target)) return;
    if (e.target.matches('[data-month]')) { vm = +e.target.value; render(); }
    if (e.target.matches('[data-year]')) { vy = +e.target.value; render(); }
  });
})();
