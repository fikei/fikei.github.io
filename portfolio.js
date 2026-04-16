/* ============================================
   Portfolio — Navigation, Interaction, Edit Mode
   ============================================ */

(function () {
  'use strict';

  // ── Sub-nav scroll highlighting ──
  function initSubnav() {
    const links = document.querySelectorAll('.d-subnav__link');
    if (!links.length) return;
    const sections = [];
    links.forEach(link => {
      const id = link.getAttribute('href')?.replace('#', '');
      const el = id && document.getElementById(id);
      if (el) sections.push({ el, link });
    });
    if (!sections.length) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          links.forEach(l => l.classList.remove('d-subnav__link--active'));
          const match = sections.find(s => s.el === entry.target);
          if (match) match.link.classList.add('d-subnav__link--active');
        }
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach(s => observer.observe(s.el));
  }

  // ── Keyboard nav between pages ──
  function initKeyboard() {
    const pages = [
      '/',
      '/field.html',
      '/invoy.html',
      '/livongo.html',
      '/design-systems.html',
      '/how-i-work.html'
    ];
    const current = window.location.pathname;
    const idx = pages.findIndex(p => current.endsWith(p) || current.endsWith(p.replace('.html', '')));
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.key === 'ArrowRight' && idx < pages.length - 1) window.location.href = pages[idx + 1];
      else if (e.key === 'ArrowLeft' && idx > 0) window.location.href = pages[idx - 1];
      // Toggle edit mode with Shift+E
      if (e.key === 'E' && e.shiftKey && !e.metaKey && !e.ctrlKey) toggleEditMode();
    });
  }

  // ── Smooth scroll for anchors ──
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', e => {
        const target = document.querySelector(link.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.pushState(null, '', link.getAttribute('href'));
        }
      });
    });
  }

  // ── Active nav link ──
  function initNavHighlight() {
    const links = document.querySelectorAll('.d-nav__link');
    const path = window.location.pathname;
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && path.endsWith(href.replace('./', ''))) {
        link.classList.add('d-nav__link--active');
      }
    });
  }

  // ── Edit Mode ──
  let editModeActive = false;
  const editStyles = document.createElement('style');
  editStyles.textContent = `
    body { user-select: text !important; -webkit-user-select: text !important; }
    .edit-mode .d-body,
    .edit-mode .d-headline,
    .edit-mode .d-decision__q,
    .edit-mode .d-decision__a,
    .edit-mode .d-callout__body,
    .edit-mode .d-card__desc,
    .edit-mode .d-card__title,
    .edit-mode .d-metric__label,
    .edit-mode .d-metric__sub,
    .edit-mode .d-gallery__caption,
    .edit-mode .d-persona__name,
    .edit-mode .d-persona__needs li,
    .edit-mode .d-flow__step-desc,
    .edit-mode .d-flow__step-label,
    .edit-mode dd {
      outline: 1px dashed rgba(0, 255, 247, 0.3);
      outline-offset: 2px;
      cursor: text;
    }
    .edit-mode .d-body:hover,
    .edit-mode .d-headline:hover,
    .edit-mode .d-decision__q:hover,
    .edit-mode .d-decision__a:hover,
    .edit-mode .d-callout__body:hover,
    .edit-mode [contenteditable]:hover {
      outline-color: rgba(0, 255, 247, 0.6);
      background: rgba(0, 255, 247, 0.03);
    }
    .edit-mode [contenteditable]:focus {
      outline: 2px solid #00fff7;
      background: rgba(0, 255, 247, 0.05);
    }
    .edit-banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      background: #00fff7;
      color: #111;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      padding: 6px;
      letter-spacing: 0.04em;
    }
    .edit-banner button {
      background: #111;
      color: #00fff7;
      border: none;
      padding: 2px 10px;
      margin-left: 12px;
      font-family: inherit;
      font-size: 10px;
      cursor: pointer;
      border-radius: 2px;
    }
    .comment-marker {
      position: absolute;
      right: -32px;
      top: 0;
      width: 20px;
      height: 20px;
      background: #ffb000;
      color: #111;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
    }
    .comment-bubble {
      position: absolute;
      right: -280px;
      top: 0;
      width: 240px;
      background: #1a1a18;
      border: 1px solid #ffb000;
      border-radius: 4px;
      padding: 8px;
      z-index: 100;
    }
    .comment-bubble textarea {
      width: 100%;
      background: #111;
      color: #e8e6e3;
      border: 1px solid #33332f;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      padding: 6px;
      resize: vertical;
      min-height: 60px;
      border-radius: 2px;
    }
    .comment-bubble button {
      background: #ffb000;
      color: #111;
      border: none;
      padding: 4px 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      cursor: pointer;
      margin-top: 4px;
      border-radius: 2px;
    }
    .has-comment {
      border-left: 2px solid #ffb000 !important;
      padding-left: 8px;
    }
  `;

  let banner = null;

  function toggleEditMode() {
    editModeActive = !editModeActive;
    document.body.classList.toggle('edit-mode', editModeActive);

    if (editModeActive) {
      document.head.appendChild(editStyles);

      // Make text editable
      const editables = document.querySelectorAll('.d-body, .d-headline, .d-decision__q, .d-decision__a, .d-callout__body, .d-card__desc, .d-card__title, .d-metric__label, .d-metric__sub, .d-gallery__caption, .d-persona__name, .d-persona__needs li, .d-flow__step-desc, .d-flow__step-label, dd');
      editables.forEach(el => {
        el.setAttribute('contenteditable', 'true');
        el.style.position = 'relative';
        // Add comment button on click
        el.addEventListener('dblclick', function addComment(e) {
          if (el.querySelector('.comment-bubble')) return;
          const bubble = document.createElement('div');
          bubble.className = 'comment-bubble';
          bubble.innerHTML = '<textarea placeholder="Leave a comment..."></textarea><button onclick="this.parentElement.previousElementSibling?.classList.add(\'has-comment\'); const t = this.parentElement.querySelector(\'textarea\').value; if(t) { const m = document.createElement(\'span\'); m.className=\'comment-marker\'; m.title=t; m.textContent=\'!\'; this.parentElement.parentElement.appendChild(m); } this.parentElement.remove();">Save</button>';
          el.appendChild(bubble);
          bubble.querySelector('textarea').focus();
          e.stopPropagation();
        });
      });

      // Show banner
      banner = document.createElement('div');
      banner.className = 'edit-banner';
      banner.innerHTML = 'EDIT MODE — Click to edit. Double-click to comment. Shift+E to exit. <button onclick="document.querySelectorAll(\'[contenteditable]\').forEach(el => console.log(el.closest(\'[id]\')?.id || \'-\', \'|\', el.className, \'|\', el.textContent.trim().slice(0,60)))">Log changes</button>';
      document.body.prepend(banner);

    } else {
      // Disable editing
      document.querySelectorAll('[contenteditable]').forEach(el => {
        el.removeAttribute('contenteditable');
      });
      if (editStyles.parentNode) editStyles.remove();
      if (banner) { banner.remove(); banner = null; }
    }
  }

  // ── Lock subnav below primary nav + set scroll offset ──
  function initStickyOffsets() {
    const nav = document.querySelector('.d-nav');
    const subnav = document.querySelector('.d-subnav');
    if (!nav) return;
    const navH = nav.offsetHeight;
    const subnavH = subnav ? subnav.offsetHeight : 0;
    if (subnav) subnav.style.top = navH + 'px';
    document.documentElement.style.setProperty('--scroll-offset', (navH + subnavH) + 'px');
  }

  // ── Init ──
  document.addEventListener('DOMContentLoaded', () => {
    initSubnav();
    initKeyboard();
    initSmoothScroll();
    initNavHighlight();
    initStickyOffsets();
    window.addEventListener('resize', initStickyOffsets);
  });
})();
