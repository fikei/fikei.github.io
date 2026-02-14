# Phase 6: Performance & Scale

> Back to [Project Plan](./index.md)

---

## Epic 6.1: Performance Optimization

| Story | Tasks | Status |
|-------|-------|--------|
| **Virtual Scrolling** | | Pending |
| | Implement for 500+ links | Pending |
| | Only render visible items | Pending |
| | Maintain scroll position on filter | Pending |
| | Handle expanded cards | Pending |
| **Lazy Loading** | | Partial |
| | Images with loading="lazy" | Complete |
| | Defer non-critical scripts | Pending |

---

## Epic 6.2: Offline & Sync Reliability

| Story | Tasks | Status |
|-------|-------|--------|
| **Sync Retry Queue** (R3) | | Pending |
| | Implement `pendingSyncs` queue in localStorage | Pending |
| | Retry failed writes on next successful sync | Pending |
| | Drain queue on timer (60s interval) | Pending |
| | Toast notification for persistent sync failures | Pending |
| **Periodic Full Sync** (R7) | | Pending |
| | Upload full local state every 5 minutes (authenticated) | Pending |
| | Compare local vs cloud timestamps to detect drift | Pending |
| **Service Worker** | | Pending |
| | Cache static assets | Pending |
| | Cache board data in IndexedDB | Pending |
| | Offline indicator | Pending |
| | Queue mutations for sync | Pending |

---

## Epic 6.3: Security Hardening

| Story | Tasks | Status |
|-------|-------|--------|
| **XSS Protection** | | Complete |
| | Escape URLs in widget suggestions with esc() function | Complete |
| | Validate expanded card state against existing links | Complete |
| **Restrict CORS Origins** (R4) | | Pending |
| | Change `Access-Control-Allow-Origin: *` to `https://ctrl.rodeo` in enrich-link | Pending |
| | Change in generate-widget | Pending |
| | Change in categorize | Pending |
| | Change in notion-sync | Pending |
| **Tighten Systemic RLS** (R5) | | Pending |
| | Restrict INSERT/UPDATE on systemic tables to authenticated users | Pending |
| **Add CSP Meta Tag** (R9) | | Pending |
| | Define allowed `script-src`, `style-src`, `connect-src` origins | Pending |
| | Add `<meta http-equiv="Content-Security-Policy">` to boards/index.html | Pending |
| | Test that Supabase SDK, Google Fonts, CORS proxies still work | Pending |
| **Edge Function Rate Limiting** (R10) | | Pending |
| | Track request count per IP in edge function memory | Pending |
| | Return 429 when threshold exceeded (e.g., 100 req/min) | Pending |
| | Log rate-limited requests for monitoring | Pending |
