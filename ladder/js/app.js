// app.js — boot auth, gate the page, mount the rail.
// Bump VERSION on every PR that touches /ladder/js. The HTML loads this file
// with ?v=VERSION to bypass the 10-min Pages cache, and we append the same
// query to dynamic imports so the component graph stays consistent.
const VERSION = "2.33.1";
console.log(`[ladder] v${VERSION} - ease chip hover card: lists the actual essay/short-answer questions an application requires`);
window.LADDER_VERSION = `v${VERSION}`;
const V = `?v=${VERSION}`;

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';

// Auth model: any signed-in user with a user_profile row is allowed. Users
// without a row are routed to /ladder/onboarding. Row is created lazily there.
// The legacy ALLOWED_EMAIL hardcode is gone — see migrations/070_user_profile.sql.
const ONBOARDING_PATH = '/ladder/onboarding';

import('./components/ladder-rail.js' + V);
import('./components/ladder-footer.js' + V);
import('./kb.js' + V);
// Route-specific components.
if (location.pathname.startsWith('/ladder/history/drill')) {
  import('./components/ladder-detail.js' + V);
} else if (location.pathname.startsWith('/ladder/history')) {
  import('./components/ladder-career.js' + V);
}
if (location.pathname.startsWith('/ladder/jobs/drill')) {
  // ?rec=<id> → pre-save detail for a recommendation (not yet in the
  // pipeline). Swap the static <ladder-role-detail> mount for the rec
  // variant; the 404 rewrite preserves the query so pretty URLs like
  // /ladder/jobs/<slug>/?rec=<id> land here with both params.
  if (new URLSearchParams(location.search).get('rec')) {
    import('./components/ladder-rec-detail.js' + V);
    const mount = document.querySelector('ladder-role-detail');
    if (mount) mount.replaceWith(document.createElement('ladder-rec-detail'));
  } else {
    import('./components/ladder-role-detail.js' + V);
  }
} else if (location.pathname.startsWith('/ladder/jobs/recommended')) {
  import('./components/ladder-recommendations-table.js' + V);
  import('./components/ladder-updates.js' + V);
} else if (location.pathname.startsWith('/ladder/jobs')) {
  import('./components/ladder-pipeline.js' + V);
}
if (location.pathname.startsWith('/ladder/vision')) {
  import('./components/ladder-vision.js' + V);
  // Watched companies — sourcing config lives with the rest of the search
  // plan, not in the For You reading flow.
  import('./components/ladder-watched-companies.js' + V);
}
if (location.pathname.startsWith('/ladder/onboarding')) {
  import('./components/ladder-onboarding.js' + V);
}
if (location.pathname.startsWith('/ladder/settings')) {
  import('./components/ladder-settings.js' + V);
}
// Mobile dashboard at /ladder/ (root). Desktop gets redirected to /jobs/ by
// inline script in index.html before this module runs.
if (location.pathname === '/ladder/' || location.pathname === '/ladder') {
  import('./components/ladder-home.js' + V);
}
if (location.pathname.startsWith('/ladder/chat')) {
  import('./components/ladder-chat-page.js' + V);
}

async function applySignedInState(email) {
  const sb = window.CtrlAuth?.getSupabaseClient?.();
  const onOnboarding = location.pathname.startsWith(ONBOARDING_PATH);
  let profile = null;
  let queryOk = false;
  if (sb) {
    try {
      // Wait for the supabase client to actually load the session from
      // localStorage before issuing the user_profile query — otherwise the
      // request can go out with just the anon key, RLS returns no rows, and
      // we incorrectly conclude the user hasn't completed onboarding and
      // bounce them back through it.
      await sb.auth.getSession();
      const { data, error } = await sb
        .from('user_profile')
        .select('onboarding_complete_at')
        .maybeSingle();
      if (error) console.warn('[ladder] user_profile query failed', error);
      else queryOk = true;
      profile = data;
    } catch (e) {
      console.warn('[ladder] user_profile query threw', e);
    }
  }
  const completed = !!profile?.onboarding_complete_at;
  // Only WRITE the completion cache on a successful query. A failed query
  // (network/RLS hiccup) must not clear the flag and bounce a returning user
  // back through onboarding.
  if (queryOk) {
    try {
      if (completed) localStorage.setItem('job:profile:completed', '1');
      else           localStorage.removeItem('job:profile:completed');
    } catch (e) { /* */ }
  }
  // If the query failed but the cached flag says completed, trust the cache.
  const effectiveCompleted = completed || (!queryOk && (() => {
    try { return localStorage.getItem('job:profile:completed') === '1'; }
    catch { return false; }
  })());
  // Returning user with completed onboarding lands on /ladder/onboarding —
  // bounce to recommended. They came back to sign in, not to walk the flow
  // again. (Existing users still get to /ladder/settings/?demo=1 to re-test.)
  if (onOnboarding && effectiveCompleted) {
    location.replace('/ladder/jobs/recommended/');
    return;
  }
  // Unauth or incomplete profile on a protected route → push into onboarding.
  if (!onOnboarding && !effectiveCompleted) {
    location.replace(ONBOARDING_PATH + '/');
    return;
  }
  document.body.dataset.authState = 'in';
  document.dispatchEvent(new CustomEvent('job:auth:ready', { detail: { email } }));
  injectFooter();
  injectMobileBar();
  injectChat();
}

// Inject the global footer (theme toggle + version + links) into the .app
// grid so it spans both columns. Avoids editing every route HTML file.
function injectFooter() {
  if (document.querySelector('ladder-footer')) return;
  const app = document.querySelector('.app');
  if (!app) return;
  const el = document.createElement('ladder-footer');
  app.appendChild(el);
}

// Inject a mobile top app bar at the start of <body>. CSS hides it on
// >720px screens. J&J-style: a circular hamburger opens the nav drawer on
// every page (the drawer is the only mobile nav — no back caret). Title
// comes from the page's .page-header h1.
function injectMobileBar() {
  if (document.querySelector('.mobile-bar')) return;
  const app = document.querySelector('.app');
  if (!app) return;

  const isHome = location.pathname === '/ladder/' || location.pathname === '/ladder';
  const title = isHome
    ? 'Ladder'
    : (document.querySelector('.page-header h1')?.textContent?.trim()
       || document.title.replace(/\s*[—|]\s*\/?(ladder|job).*$/i, '').trim()
       || 'Ladder');

  const bar = document.createElement('header');
  bar.className = 'mobile-bar';
  bar.dataset.home = isHome ? 'true' : 'false';
  bar.innerHTML = `
    <button class="icon-btn mobile-bar__menu-btn" aria-label="Open navigation" aria-expanded="false">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>
    </button>
    <span class="mobile-bar__title">${title}</span>
    <span class="mobile-bar__action-slot"></span>
  `;
  // Sit OUTSIDE .app__main so the bar can be edge-to-edge while main keeps
  // its own horizontal padding.
  document.body.insertBefore(bar, app);
  bar.querySelector('.mobile-bar__menu-btn').addEventListener('click', () => toggleNavDrawer(true));
  injectNavDrawer();
}

// Left-side nav drawer (mobile). Same taxonomy as the rail — keep the two
// in sync by hand (see ROUTES in components/ladder-rail.js). Icons mirror
// NAV_ICONS there; primary navigation is the only surface icons are
// allowed on (DESIGN.md rule 7).
const DRAWER_ITEMS = [
  { href: '/ladder/jobs/recommended/', label: 'Inbox',       countKey: 'recommended', match: /^\/ladder\/jobs\/recommended\/?/,
    icon: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>' },
  { href: '/ladder/jobs/',             label: 'Jobs',        match: /^\/ladder\/jobs(?!\/recommended)\/?/,
    icon: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    // Six pipeline buckets as first-class sub-items (primary nav, no in-page
    // sub-nav bar). Keep in sync with the Jobs `sub` in components/ladder-rail.js.
    sub: [
      { href: '/ladder/jobs/?bucket=saved',        label: 'Saved',        bucket: 'saved',        countKey: 'saved' },
      { href: '/ladder/jobs/?bucket=drafting',     label: 'Drafting',     bucket: 'drafting',     countKey: 'drafting' },
      { href: '/ladder/jobs/?bucket=applied',      label: 'Applied',      bucket: 'applied',      countKey: 'applied' },
      { href: '/ladder/jobs/?bucket=interviewing', label: 'Interviewing', bucket: 'interviewing', countKey: 'interviewing' },
      { href: '/ladder/jobs/?bucket=offer',        label: 'Offer',        bucket: 'offer',        countKey: 'offer' },
      { href: '/ladder/jobs/?bucket=archive',      label: 'Archive',      bucket: 'archive',      countKey: 'archive' },
    ] },
  { href: '/ladder/history/',          label: 'Profile',     match: /^\/ladder\/history\/?/,
    icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>' },
  { href: '/ladder/vision/',           label: 'Search plan', match: /^\/ladder\/vision\/?/,
    icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
  { href: '/ladder/settings/',         label: 'Settings',    match: /^\/ladder\/settings\/?/,
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' },
];

function injectNavDrawer() {
  if (document.querySelector('.nav-drawer')) return;
  const here = location.pathname;
  const drawer = document.createElement('div');
  drawer.innerHTML = `
    <div class="nav-drawer__scrim" hidden></div>
    <nav class="nav-drawer" aria-label="Navigation" hidden>
      <a class="brand nav-drawer__brand" href="/ladder/">
        <span class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6.5" y1="2.5" x2="6.5" y2="21.5"/><line x1="17.5" y1="2.5" x2="17.5" y2="21.5"/><line x1="6.5" y1="7" x2="17.5" y2="7"/><line x1="6.5" y1="12" x2="17.5" y2="12"/><line x1="6.5" y1="17" x2="17.5" y2="17"/></svg>
        </span>
        <span class="brand__text">Ladder</span>
      </a>
      <ul class="nav-drawer__list">
        ${DRAWER_ITEMS.map(i => {
          const parentActive = i.match.test(here);
          // Normalize the current ?bucket= so legacy links still highlight
          // the right sub-item (leads→saved, active→drafting).
          const curBucket = (() => {
            const b = new URLSearchParams(location.search).get('bucket');
            if (!b || b === 'leads') return 'saved';
            if (b === 'active') return 'drafting';
            return b;
          })();
          const sub = (parentActive && i.sub) ? `
            <ul class="nav-drawer__sublist">
              ${i.sub.map(s => `
                <li>
                  <a class="nav-drawer__subitem" href="${s.href}" aria-current="${curBucket === s.bucket ? 'page' : 'false'}">
                    <span class="nav-sub__label">${s.label}</span>
                    ${s.countKey ? `<span class="nav-count" data-count="${s.countKey}" hidden></span>` : ''}
                  </a>
                </li>`).join('')}
            </ul>` : '';
          return `
          <li>
            <a class="nav-drawer__item" href="${i.href}" aria-current="${parentActive ? 'page' : 'false'}">
              <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${i.icon}</svg></span>
              <span class="nav-label">${i.label}</span>
              ${i.countKey ? `<span class="nav-count" data-count="${i.countKey}" hidden></span>` : ''}
            </a>
            ${sub}
          </li>`;
        }).join('')}
      </ul>
      <div class="nav-drawer__user">
        <span class="rail-user__dot" aria-hidden="true"></span>
        <span class="rail-user__email"></span>
      </div>
    </nav>
  `;
  while (drawer.firstChild) document.body.appendChild(drawer.firstChild);
  document.querySelector('.nav-drawer__scrim').addEventListener('click', () => toggleNavDrawer(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleNavDrawer(false); });
  const email = window.CtrlAuth?.getUser?.()?.email || '';
  const emailEl = document.querySelector('.nav-drawer__user .rail-user__email');
  if (email) emailEl.textContent = email;
  else document.querySelector('.nav-drawer__user').hidden = true;
  // Counts arrive from the rail's broadcast.
  document.addEventListener('job:rail:counts', (e) => {
    for (const el of document.querySelectorAll('.nav-drawer [data-count]')) {
      const n = e.detail?.[el.getAttribute('data-count')];
      if (n == null) { el.hidden = true; continue; }
      el.hidden = false;
      el.textContent = String(n);
    }
  });
}

function toggleNavDrawer(open) {
  const drawer = document.querySelector('.nav-drawer');
  const scrim = document.querySelector('.nav-drawer__scrim');
  const btn = document.querySelector('.mobile-bar__menu-btn');
  if (!drawer || !scrim) return;
  drawer.hidden = !open;
  scrim.hidden = !open;
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  document.body.style.overflow = open ? 'hidden' : '';
}

// (The mobile segmented sub-nav bar was removed — the pipeline buckets now
// live in primary navigation, nested under Jobs in both the rail and the
// mobile drawer above. Bottom tab bar was removed earlier too.)

// Global toast host. Components all over the app dispatch
// `job:toast { detail: { msg } }` — this is the single renderer (there
// previously was none, so toasts silently vanished). Every toast
// auto-expires and is click-dismissable; max 3 stack.
function injectToastHost() {
  if (document.querySelector('.toast-host')) return;
  const host = document.createElement('div');
  host.className = 'toast-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  document.addEventListener('job:toast', (e) => {
    const msg = e.detail?.msg;
    if (!msg) return;
    // Optional inline action: { action: 'Undo', onAction: fn } renders a
    // second button inside the toast (Updates-queue undo confirmations).
    const actionLabel = e.detail?.action;
    const onAction = typeof e.detail?.onAction === 'function' ? e.detail.onAction : null;
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    const remove = () => {
      el.classList.add('toast--leaving');
      setTimeout(() => el.remove(), 200);
    };
    const msgBtn = document.createElement('button');
    msgBtn.type = 'button';
    msgBtn.className = 'toast__msg';
    msgBtn.textContent = msg;
    msgBtn.title = 'Dismiss';
    msgBtn.addEventListener('click', remove);
    el.appendChild(msgBtn);
    if (actionLabel && onAction) {
      const actBtn = document.createElement('button');
      actBtn.type = 'button';
      actBtn.className = 'toast__action';
      actBtn.textContent = actionLabel;
      actBtn.addEventListener('click', () => { remove(); onAction(); });
      el.appendChild(actBtn);
    }
    host.appendChild(el);
    while (host.children.length > 3) host.firstChild.remove();
    setTimeout(remove, e.detail?.duration || 4500);
  });
}
injectToastHost();

// Mount the global agent chat — FAB at bottom-right + bottom drawer.
// Skipped on onboarding (the onboarding flow has its own chat surface).
async function injectChat() {
  if (document.querySelector('ladder-chat')) return;
  if (location.pathname.startsWith('/ladder/onboarding')) return;
  await import('./components/ladder-chat.js' + V);
  const el = document.createElement('ladder-chat');
  document.body.appendChild(el);
}

// Listeners FIRST — CtrlAuth's init can dispatch signedin synchronously when
// it restores an existing session, so we must already be subscribed.
document.addEventListener('ctrl:auth:signedin', (e) => {
  const email = e.detail?.user?.email || '';
  applySignedInState(email);
});
document.addEventListener('ctrl:auth:signedout', () => {
  document.body.dataset.authState = 'out';
  try { localStorage.removeItem('job:profile:completed'); } catch (e) { /* */ }
});

// CtrlAuth mounts magic-link + Google sign-in into #ctrl-auth-root.
window.CtrlAuth.init({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  redirectTo: window.location.origin + window.location.pathname,
  mountTo: '#ctrl-auth-root'
});

// Gmail OAuth callback. gmail-auth's auth-url action redirects to
// /ladder/?code=<code>&state=gmail:<user_id>&scope=… after the user grants
// consent. Stash code+state in sessionStorage immediately, strip the
// query (codes are single-use), then complete the exchange on
// ctrl:auth:signedin — keepalive on the fetch so a follow-up redirect
// to /onboarding/ doesn't kill the request mid-flight.
(() => {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state') || '';
  if (code && state.startsWith('gmail:')) {
    try { sessionStorage.setItem('job:pendingGmailOAuth', JSON.stringify({ code, state, at: Date.now() })); } catch {}
    const clean = new URL(location.href);
    clean.searchParams.delete('code');
    clean.searchParams.delete('state');
    clean.searchParams.delete('scope');
    clean.searchParams.delete('authuser');
    clean.searchParams.delete('prompt');
    history.replaceState(null, '', clean.pathname + (clean.search || '') + clean.hash);
  }
})();

// Single-flight guard so the event listener + timer + poller don't fire
// three concurrent exchanges of the same single-use code.
let _gmailConnectInFlight = false;

// Wait for a Supabase session token, polling for up to ~timeoutMs. The
// OAuth redirect lands before CtrlAuth has necessarily restored the
// session, and ctrl:auth:signedin can fire before our listener attaches —
// so a one-shot check raced and silently dropped the code. Poll instead.
async function _waitForSessionToken(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const supabase = window.CtrlAuth?.getSupabaseClient?.();
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (token) return token;
      } catch { /* keep polling */ }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function _completePendingGmailOAuth() {
  if (_gmailConnectInFlight) return;
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem('job:pendingGmailOAuth') || 'null'); } catch { return; }
  if (!pending?.code) return;
  // Stale entries (>10 min) — codes are single-use and quickly invalid.
  if (Date.now() - (pending.at || 0) > 10 * 60 * 1000) {
    sessionStorage.removeItem('job:pendingGmailOAuth');
    return;
  }
  _gmailConnectInFlight = true;
  try {
    const token = await _waitForSessionToken();
    if (!token) {
      // Leave pending in place — a later signedin event or page load
      // will retry while the code is still within its 10-min window.
      console.warn('[ladder] gmail connect: no session yet, will retry');
      return;
    }
    const r = await fetch('https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/gmail-auth', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'connect', code: pending.code }),
      keepalive: true,
    });
    if (r.ok) {
      console.log('[ladder] Gmail connected — token stored with gmail.modify scope');
      sessionStorage.removeItem('job:pendingGmailOAuth');
      document.dispatchEvent(new CustomEvent('job:gmail:connected'));
    } else {
      // The code is single-use; a failed exchange can't be retried with
      // the same code. Drop it so we don't loop, and surface the error.
      const body = await r.text();
      console.warn('[ladder] gmail-auth connect failed:', r.status, body);
      sessionStorage.removeItem('job:pendingGmailOAuth');
      document.dispatchEvent(new CustomEvent('job:gmail:connect-failed', { detail: { status: r.status, body } }));
    }
  } catch (e) {
    console.warn('[ladder] gmail-auth connect error:', e.message);
  } finally {
    _gmailConnectInFlight = false;
  }
}
document.addEventListener('ctrl:auth:signedin', () => { _completePendingGmailOAuth(); });
setTimeout(() => { _completePendingGmailOAuth(); }, 250);

// Belt-and-braces: even with the listener attached early, some CtrlAuth code
// paths can settle a restored session without dispatching to a fresh listener.
// Reconcile from the canonical source after a tick. If there's no user at
// all, transition body off "loading" so the sign-in gate becomes visible —
// CtrlAuth only fires `ctrl:auth:signedout` on a transition, not on initial
// load with no session, so without this fallback an unauthed visitor sees a
// permanently blank page (CSS hides everything while data-auth-state="loading").
setTimeout(() => {
  const u = window.CtrlAuth?.getUser?.();
  if (u?.email) {
    if (document.body.dataset.authState !== 'in') applySignedInState(u.email);
  } else if (document.body.dataset.authState === 'loading') {
    document.body.dataset.authState = 'out';
  }
}, 0);
// Second pass after CtrlAuth's async fast-restore (fetchProfile) has had a
// chance to land — if a user has arrived by then, promote to "in".
setTimeout(() => {
  const u = window.CtrlAuth?.getUser?.();
  if (u?.email && document.body.dataset.authState !== 'in') {
    applySignedInState(u.email);
  }
}, 800);

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('signin-btn');
  if (btn) btn.addEventListener('click', () => window.CtrlAuth.openLoginModal());
  // Onboarding is its own full-screen takeover and works pre-auth. Suppress
  // the auto-open sign-in modal on those routes; the component opens auth
  // explicitly at finalize time.
  const onOnboardingRoute = location.pathname.startsWith('/ladder/onboarding');
  if (onOnboardingRoute) return;
  setTimeout(() => {
    if (document.body.dataset.authState !== 'in') {
      window.CtrlAuth.openLoginModal();
    }
  }, 250);
});
