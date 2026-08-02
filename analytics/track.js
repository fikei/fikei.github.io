/**
 * ctrl.rodeo analytics tracker — pageviews + uncaught JS errors.
 * Fire-and-forget inserts into Supabase analytics_events (insert-only RLS;
 * nothing is readable with the anon key). Viewable only on /analytics/.
 *
 * Usage: <script defer src="/analytics/track.js"></script>
 */
(function () {
  'use strict';
  var VERSION = '1.1.0';
  var SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';
  var ENDPOINT = SUPABASE_URL + '/rest/v1/analytics_events';
  var MAX_ERRORS_PER_PAGE = 10;
  var errorCount = 0;
  var sentErrors = {};

  // Opt out (e.g. your own devices): localStorage.setItem('ctrl-analytics-optout', '1')
  try {
    if (localStorage.getItem('ctrl-analytics-optout') === '1') return;
  } catch (e) { /* storage unavailable — keep tracking */ }

  function sessionId() {
    try {
      var id = sessionStorage.getItem('ctrl-analytics-sid');
      if (!id) {
        id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem('ctrl-analytics-sid', id);
      }
      return id;
    } catch (e) {
      return null;
    }
  }

  // Signed-in Supabase user, read from the shared CtrlAuth session storage.
  function userId() {
    try {
      var raw = localStorage.getItem('sb-yfhudwakpgzswiylhfbh-auth-token');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var id = parsed && parsed.user && parsed.user.id;
      return (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) ? id : null;
    } catch (e) {
      return null;
    }
  }

  function appName() {
    var seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? seg.toLowerCase() : 'home';
  }

  function send(row) {
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON_KEY,
          Authorization: 'Bearer ' + ANON_KEY,
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(row)
      }).catch(function () { /* never surface tracking failures */ });
    } catch (e) { /* ignore */ }
  }

  function base(type) {
    return {
      type: type,
      app: appName(),
      path: (location.pathname + location.search).slice(0, 512),
      referrer: (document.referrer || '').slice(0, 512) || null,
      session_id: sessionId(),
      user_id: userId(),
      viewport: window.innerWidth + 'x' + window.innerHeight,
      ua: (navigator.userAgent || '').slice(0, 512)
    };
  }

  function trackError(message, stack) {
    if (errorCount >= MAX_ERRORS_PER_PAGE) return;
    message = String(message || 'Unknown error').slice(0, 1000);
    var key = message.slice(0, 200);
    if (sentErrors[key]) return; // dedupe repeats within a page
    sentErrors[key] = true;
    errorCount++;
    var row = base('error');
    row.message = message;
    row.stack = stack ? String(stack).slice(0, 4000) : null;
    send(row);
  }

  window.addEventListener('error', function (ev) {
    if (ev.message === 'Script error.' && !ev.filename) return; // opaque cross-origin noise
    var loc = ev.filename ? ' (' + ev.filename + ':' + ev.lineno + ')' : '';
    trackError((ev.message || 'Script error') + loc, ev.error && ev.error.stack);
  });

  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev.reason;
    trackError(
      'Unhandled rejection: ' + (reason && reason.message ? reason.message : String(reason)),
      reason && reason.stack
    );
  });

  send(base('pageview'));
})();
