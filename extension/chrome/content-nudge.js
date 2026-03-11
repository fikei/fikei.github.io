// Rodeo Extension — Idle Reading Nudge
// Content script: detects idle + scroll depth, injects save banner via Shadow DOM
// Injected at document_idle on all URLs (excludes chrome://, extension://, ctrl.rodeo)

(function() {
  'use strict';

  // ============================================
  // Config
  // ============================================
  const IDLE_TIMEOUT_MS = 3 * 60 * 1000;   // 3 minutes idle
  const SCROLL_THRESHOLD = 0.5;             // 50% scroll depth
  const DISMISS_KEY_PREFIX = 'rodeo_nudge_dismissed_';

  // ============================================
  // Guards — bail early if not applicable
  // ============================================
  const pageUrl = window.location.href;
  if (!pageUrl.startsWith('http')) return;

  const domain = window.location.hostname.replace(/^www\./, '');
  let nudgeInjected = false;
  let idleTimer = null;
  let maxScrollDepth = 0;

  // Check if domain is blocked or nudge is disabled
  Promise.all([
    msg({ action: 'check_domain_blocked', domain }),
    msg({ action: 'get_nudge_settings' })
  ]).then(([blockResult, nudgeResult]) => {
    if (blockResult && blockResult.blocked) return;
    if (nudgeResult && nudgeResult.nudgeEnabled === false) return;

    // Check if page is long enough (at least 2x viewport)
    if (document.documentElement.scrollHeight < window.innerHeight * 2) return;

    // Check dismiss cache
    const dismissKey = DISMISS_KEY_PREFIX + btoa(pageUrl).slice(0, 40);
    chrome.storage.session.get(dismissKey).then(data => {
      if (data[dismissKey]) return; // already dismissed this session
      startTracking();
    }).catch(() => startTracking());
  }).catch(() => {});

  // ============================================
  // Scroll + Idle Tracking
  // ============================================
  function startTracking() {
    // Track scroll depth
    window.addEventListener('scroll', onActivity, { passive: true });
    window.addEventListener('mousedown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });

    // Initial scroll check
    updateScrollDepth();
    resetIdleTimer();
  }

  function updateScrollDepth() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight > 0) {
      const depth = scrollTop / scrollHeight;
      if (depth > maxScrollDepth) maxScrollDepth = depth;
    }
  }

  function onActivity() {
    updateScrollDepth();
    resetIdleTimer();
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(onIdle, IDLE_TIMEOUT_MS);
  }

  function onIdle() {
    if (nudgeInjected) return;
    if (maxScrollDepth < SCROLL_THRESHOLD) {
      // Not scrolled far enough — keep waiting
      resetIdleTimer();
      return;
    }
    injectBanner();
  }

  // ============================================
  // Context-Aware Copy
  // ============================================
  function detectPageType() {
    // Article detection: <article> tag or high word count
    const hasArticle = !!document.querySelector('article');
    const bodyText = document.body ? document.body.innerText : '';
    const wordCount = bodyText.split(/\s+/).length;

    if (hasArticle || wordCount > 500) {
      return { headline: 'Finish reading later?', type: 'article' };
    }

    // Product detection: price patterns + cart signals
    const hasPrice = /\$\d+|\d+\.\d{2}/.test(bodyText);
    const hasCart = !!(
      document.querySelector('[class*="cart"], [class*="add-to-bag"], [data-action*="cart"]') ||
      /add to (cart|bag|basket)/i.test(bodyText.slice(0, 5000))
    );

    if (hasPrice && hasCart) {
      return { headline: 'Saving this for later?', type: 'product' };
    }

    return { headline: 'Come back to this?', type: 'default' };
  }

  // ============================================
  // Banner Injection (Shadow DOM)
  // ============================================
  async function injectBanner() {
    if (nudgeInjected) return;
    nudgeInjected = true;

    const pageType = detectPageType();

    // Get visit count for subtitle
    let visitText = '';
    try {
      const visitData = await msg({ action: 'get_visit_data_for_url', url: pageUrl });
      if (visitData && visitData.count > 1) {
        visitText = `You've visited this page ${visitData.count} times.`;
      }
    } catch {}

    // Create host element
    const host = document.createElement('rodeo-nudge');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;right:0;z-index:2147483647;';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap');

        :host {
          all: initial;
          display: block;
        }

        .bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 16px;
          background: #111;
          border-bottom: 1px solid #333;
          font-family: "Space Grotesk", sans-serif;
          font-size: 12px;
          color: #fff;
          transform: translateY(-100%);
          transition: transform 0.3s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }

        .bar.visible {
          transform: translateY(0);
        }

        .copy {
          flex: 1;
          min-width: 0;
        }

        .headline {
          font-weight: 500;
          font-size: 12px;
          line-height: 1.3;
        }

        .subtitle {
          font-size: 10px;
          color: #999;
          margin-top: 2px;
        }

        .actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .btn-save {
          background: #fff;
          color: #000;
          border: 1px solid #fff;
          padding: 5px 12px;
          font-family: "Space Grotesk", sans-serif;
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.1s;
        }

        .btn-save:hover {
          background: transparent;
          color: #fff;
        }

        .btn-dismiss {
          background: none;
          border: none;
          color: #666;
          font-family: "Space Grotesk", sans-serif;
          font-size: 10px;
          letter-spacing: 0.05em;
          cursor: pointer;
          padding: 5px 8px;
          white-space: nowrap;
        }

        .btn-dismiss:hover {
          color: #fff;
        }

        .btn-close {
          background: none;
          border: none;
          color: #666;
          font-size: 14px;
          cursor: pointer;
          padding: 4px;
          line-height: 1;
        }

        .btn-close:hover {
          color: #fff;
        }
      </style>

      <div class="bar" id="bar">
        <div class="copy">
          <div class="headline">${escHtml(pageType.headline)}</div>
          ${visitText ? `<div class="subtitle">${escHtml(visitText)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="btn-save" id="btn-save">Save & Close</button>
          <button class="btn-dismiss" id="btn-not-now">Not now</button>
          <button class="btn-close" id="btn-close" aria-label="Dismiss">&times;</button>
        </div>
      </div>
    `;

    // Slide in after a frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        shadow.getElementById('bar').classList.add('visible');
      });
    });

    // Save & Close
    shadow.getElementById('btn-save').addEventListener('click', async () => {
      const btn = shadow.getElementById('btn-save');
      btn.textContent = 'Saving...';
      btn.style.pointerEvents = 'none';

      await msg({
        action: 'save',
        data: {
          url: pageUrl,
          title: document.title,
          selectedText: null,
          source: 'nudge'
        }
      });

      btn.textContent = 'Saved';
      setTimeout(() => {
        msg({ action: 'close_tab', tabId: undefined });
        // Also try to get current tab and close it
        chrome.runtime.sendMessage({ action: 'get_tab_info' }, (info) => {
          if (info && info.tabId) {
            chrome.runtime.sendMessage({ action: 'close_tab', tabId: info.tabId });
          }
        });
      }, 500);
    });

    // Dismiss handlers
    const dismiss = () => {
      const bar = shadow.getElementById('bar');
      bar.classList.remove('visible');
      setTimeout(() => host.remove(), 300);
      // Mark dismissed for this session
      const dismissKey = DISMISS_KEY_PREFIX + btoa(pageUrl).slice(0, 40);
      chrome.storage.session.set({ [dismissKey]: Date.now() }).catch(() => {});
    };

    shadow.getElementById('btn-not-now').addEventListener('click', dismiss);
    shadow.getElementById('btn-close').addEventListener('click', dismiss);
  }

  // ============================================
  // Helpers
  // ============================================
  function msg(data) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(data, response => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

})();
