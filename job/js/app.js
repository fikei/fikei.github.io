// app.js — boot auth, gate the page, mount the rail.
// Bump VERSION on every PR that touches /job/js. The HTML loads this file
// with ?v=VERSION to bypass the 10-min Pages cache, and we append the same
// query to dynamic imports so the component graph stays consistent.
const VERSION = '0.34.1';
console.log(`[job] v${VERSION} - Leads view: drop Status column + bucket-tabs strip; recommendations only on Leads`);
window.JOB_VERSION = `v${VERSION}`;
const V = `?v=${VERSION}`;

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
const ALLOWED_EMAIL = 'fike101@gmail.com';

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
} else if (location.pathname.startsWith('/job/jobs')) {
  import('./components/job-pipeline.js' + V);
}

function applySignedInState(email) {
  if (email !== ALLOWED_EMAIL) {
    location.replace('/job/not-authorized.html');
    return;
  }
  document.body.dataset.authState = 'in';
  // Notify components that may have mounted before the event arrived.
  document.dispatchEvent(new CustomEvent('job:auth:ready', { detail: { email } }));
  injectFooter();
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
  adminEmails: [ALLOWED_EMAIL],
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
  setTimeout(() => {
    if (document.body.dataset.authState !== 'in') {
      window.CtrlAuth.openLoginModal();
    }
  }, 250);
});
