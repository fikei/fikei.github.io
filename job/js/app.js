// app.js — boot auth, gate the page, mount the rail.
// Bump VERSION on every PR that touches /job/js. The HTML loads this file
// with ?v=VERSION to bypass the 10-min Pages cache, and we append the same
// query to dynamic imports so the component graph stays consistent.
const VERSION = '0.8.0';
console.log(`[job] v${VERSION} - wise design system`);
window.JOB_VERSION = `v${VERSION}`;
const V = `?v=${VERSION}`;

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
const ALLOWED_EMAIL = 'fike101@gmail.com';

import('./components/job-rail.js' + V);
import('./kb.js' + V);
// Route-specific components.
if (location.pathname.startsWith('/job/history/_drill')) {
  import('./components/job-detail.js' + V);
} else if (location.pathname.startsWith('/job/history')) {
  import('./components/job-history-resume.js' + V);
}
if (location.pathname.startsWith('/job/jobs')) {
  import('./components/job-pipeline.js' + V);
}

// CtrlAuth mounts magic-link + Google sign-in into #ctrl-auth-root.
window.CtrlAuth.init({
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: SUPABASE_ANON_KEY,
  redirectTo: window.location.origin + window.location.pathname,
  adminEmails: [ALLOWED_EMAIL],
  mountTo: '#ctrl-auth-root'
});

document.addEventListener('ctrl:auth:signedin', (e) => {
  const email = e.detail?.user?.email || '';
  if (email !== ALLOWED_EMAIL) {
    location.replace('/job/not-authorized.html');
    return;
  }
  document.body.dataset.authState = 'in';
});

document.addEventListener('ctrl:auth:signedout', () => {
  document.body.dataset.authState = 'out';
});

// Wire the gate-card sign-in button + auto-open the modal on first arrival.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('signin-btn');
  if (btn) btn.addEventListener('click', () => window.CtrlAuth.openLoginModal());
  setTimeout(() => {
    if (document.body.dataset.authState !== 'in') {
      window.CtrlAuth.openLoginModal();
    }
  }, 250);
});
