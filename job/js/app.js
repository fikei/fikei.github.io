// app.js — boot auth, gate the page, mount the rail.
// Bump VERSION on every PR that touches /job/js. The HTML loads this file
// with ?v=VERSION to bypass the 10-min Pages cache, and we append the same
// query to dynamic imports so the component graph stays consistent.
const VERSION = "0.92.0";
console.log(`[job] v${VERSION} - Agent chat P1: agent loop + 4 Tier-1 tools live`);
window.JOB_VERSION = `v${VERSION}`;
const V = `?v=${VERSION}`;

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';

// Auth model: any signed-in user with a user_profile row is allowed. Users
// without a row are routed to /job/onboarding. Row is created lazily there.
// The legacy ALLOWED_EMAIL hardcode is gone — see migrations/070_user_profile.sql.
const ONBOARDING_PATH = '/job/onboarding';

import('./components/job-rail.js' + V);
import('./components/job-footer.js' + V);
import('./kb.js' + V);
// Route-specific components.
if (location.pathname.startsWith('/job/history/drill')) {
  import('./components/job-detail.js' + V);
} else if (location.pathname.startsWith('/job/history')) {
  import('./components/job-career.js' + V);
}
if (location.pathname.startsWith('/job/jobs/drill')) {
  import('./components/job-role-detail.js' + V);
} else if (location.pathname.startsWith('/job/jobs/recommended')) {
  import('./components/job-recommendations-table.js' + V);
} else if (location.pathname.startsWith('/job/jobs')) {
  import('./components/job-pipeline.js' + V);
}
if (location.pathname.startsWith('/job/vision')) {
  import('./components/job-vision.js' + V);
}
if (location.pathname.startsWith('/job/onboarding')) {
  import('./components/job-onboarding.js' + V);
}
if (location.pathname.startsWith('/job/settings')) {
  import('./components/job-settings.js' + V);
}
// Mobile dashboard at /job/ (root). Desktop gets redirected to /jobs/ by
// inline script in index.html before this module runs.
if (location.pathname === '/job/' || location.pathname === '/job') {
  import('./components/job-home.js' + V);
}

async function applySignedInState(email) {
  const sb = window.CtrlAuth?.getSupabaseClient?.();
  // Gate: user must have a user_profile row with onboarding_complete_at set.
  // No row → first-time user; redirect to onboarding (which will create one).
  // Row but not complete → resume onboarding.
  // Already on the onboarding page → let it render regardless of status.
  const onOnboarding = location.pathname.startsWith(ONBOARDING_PATH);
  let profile = null;
  if (sb) {
    try {
      const { data, error } = await sb
        .from('user_profile')
        .select('onboarding_complete_at')
        .maybeSingle();
      if (error) console.warn('[job] user_profile query failed', error);
      profile = data;
    } catch (e) {
      console.warn('[job] user_profile query threw', e);
    }
  }
  if (!onOnboarding && (!profile || !profile.onboarding_complete_at)) {
    location.replace(ONBOARDING_PATH + '/');
    return;
  }
  document.body.dataset.authState = 'in';
  document.dispatchEvent(new CustomEvent('job:auth:ready', { detail: { email } }));
  injectFooter();
  injectMobileBar();
  injectSubnavBar();
  injectChat();
}

// Inject the global footer (theme toggle + version + links) into the .app
// grid so it spans both columns. Avoids editing every route HTML file.
function injectFooter() {
  if (document.querySelector('job-footer')) return;
  const app = document.querySelector('.app');
  if (!app) return;
  const el = document.createElement('job-footer');
  app.appendChild(el);
}

// Inject a mobile top app bar at the start of <body>. CSS hides it on
// >720px screens. The leading button is a back caret on every page except
// the home dashboard at /job/, where it's omitted. Title comes from the
// page's .page-header h1.
function injectMobileBar() {
  if (document.querySelector('.mobile-bar')) return;
  const app = document.querySelector('.app');
  if (!app) return;

  const isHome = location.pathname === '/job/' || location.pathname === '/job';
  const title = isHome
    ? '/ job'
    : (document.querySelector('.page-header h1')?.textContent?.trim()
       || document.title.replace(/\s*[—|]\s*\/?job.*$/i, '').trim()
       || 'ctrl.rodeo');

  const bar = document.createElement('header');
  bar.className = 'mobile-bar';
  bar.dataset.home = isHome ? 'true' : 'false';
  bar.innerHTML = `
    ${isHome
      ? `<span class="mobile-bar__spacer" aria-hidden="true"></span>`
      : `<a class="mobile-bar__back" href="/job/" aria-label="Back to home">‹</a>`}
    <span class="mobile-bar__title">${title}</span>
    <span class="mobile-bar__action-slot"></span>
  `;
  // Sit OUTSIDE .app__main so the bar can be edge-to-edge while main keeps
  // its own horizontal padding.
  document.body.insertBefore(bar, app);
}

// Inject the mobile segmented sub-nav (sticky under mobile-bar). Only
// populated on /job/jobs/ today; data-has-items toggles visibility so
// CSS only shows it when there's something to switch between. Counts are
// kept in sync by listening to the same 'job:pipeline:refresh' that the
// rail uses to refresh its count badges.
function injectSubnavBar() {
  if (document.querySelector('.subnav-bar')) return;
  const app = document.querySelector('.app');
  if (!app) return;

  const bar = document.createElement('nav');
  bar.className = 'subnav-bar';
  bar.setAttribute('aria-label', 'Sub-navigation');
  bar.dataset.hasItems = 'false';
  bar.innerHTML = `<div class="subnav-bar__row"></div>`;
  // Place directly after the mobile-bar (which has been inserted before .app).
  const mb = document.querySelector('.mobile-bar');
  if (mb) mb.after(bar);
  else document.body.insertBefore(bar, app);

  const row = bar.querySelector('.subnav-bar__row');
  const here = location.pathname;
  const isJobs = /^\/job\/jobs\/?/.test(here);

  if (!isJobs) {
    bar.dataset.hasItems = 'false';
    return;
  }

  // Keep in sync with ROUTES[0].sub in components/job-rail.js.
  const ITEMS = [
    { href: '/job/jobs/recommended/',    label: 'For You', path: '/job/jobs/recommended/', countKey: 'recommended' },
    { href: '/job/jobs/?bucket=leads',   label: 'Saved',   bucket: 'leads',                countKey: 'leads' },
    { href: '/job/jobs/?bucket=active',  label: 'Active',  bucket: 'active',               countKey: 'active' },
    { href: '/job/jobs/?bucket=archive', label: 'Archive', bucket: 'archive' },
  ];
  const bucket = new URLSearchParams(location.search).get('bucket') || 'leads';
  const onSubPath = ITEMS.some(i => i.path && here.startsWith(i.path));
  row.innerHTML = ITEMS.map(i => {
    const active = i.path
      ? here.startsWith(i.path)
      : (!onSubPath && bucket === i.bucket);
    return `<a class="subnav-bar__item" href="${i.href}" aria-current="${active ? 'page' : 'false'}"
              data-count-key="${i.countKey || ''}">
              <span class="subnav-bar__label">${i.label}</span>
              ${i.countKey ? `<span class="nav-count" data-count="${i.countKey}" hidden></span>` : ''}
            </a>`;
  }).join('');
  bar.dataset.hasItems = 'true';

  const applyCounts = (counts) => {
    if (!counts) return;
    for (const el of bar.querySelectorAll('[data-count]')) {
      const k = el.getAttribute('data-count');
      const n = counts[k];
      if (n == null) { el.hidden = true; continue; }
      el.hidden = false;
      el.textContent = String(n);
    }
  };

  // The rail component already fetches and stores counts on itself; listen
  // for its broadcast event and apply.
  const askRail = () => {
    const rail = document.querySelector('job-rail');
    if (rail?.counts) applyCounts(rail.counts);
  };
  document.addEventListener('job:rail:counts', (e) => applyCounts(e.detail));
  document.addEventListener('job:pipeline:refresh', () => setTimeout(askRail, 200));
  askRail();
}

// (Bottom tab bar removed — drawer is the only mobile nav now.)

// Mount the global agent chat — FAB at bottom-right + bottom drawer.
// Skipped on onboarding (the onboarding flow has its own chat surface).
async function injectChat() {
  if (document.querySelector('job-chat')) return;
  if (location.pathname.startsWith('/job/onboarding')) return;
  await import('./components/job-chat.js' + V);
  const el = document.createElement('job-chat');
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
});

// CtrlAuth mounts magic-link + Google sign-in into #ctrl-auth-root.
window.CtrlAuth.init({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  redirectTo: window.location.origin + window.location.pathname,
  mountTo: '#ctrl-auth-root'
});

// Belt-and-braces: even with the listener attached early, some CtrlAuth code
// paths can settle a restored session without dispatching to a fresh listener.
// Reconcile from the canonical source after a tick.
setTimeout(() => {
  const u = window.CtrlAuth?.getUser?.();
  if (u?.email && document.body.dataset.authState !== 'in') {
    applySignedInState(u.email);
  }
}, 0);

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('signin-btn');
  if (btn) btn.addEventListener('click', () => window.CtrlAuth.openLoginModal());
  // Onboarding is its own full-screen takeover and works pre-auth. Suppress
  // the auto-open sign-in modal on those routes; the component opens auth
  // explicitly at finalize time.
  const onOnboardingRoute = location.pathname.startsWith('/job/onboarding');
  if (onOnboardingRoute) return;
  setTimeout(() => {
    if (document.body.dataset.authState !== 'in') {
      window.CtrlAuth.openLoginModal();
    }
  }, 250);
});
