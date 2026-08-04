# Analytics dashboard — technical design

**Status:** Live (v1.1.0) · **Surface:** [ctrl.rodeo/analytics](https://ctrl.rodeo/analytics/) · **Backend:** Supabase Boards project (`yfhudwakpgzswiylhfbh`)

Private, owner-only analytics across every ctrl.rodeo project: pageviews, unique sessions, client-side JS errors, Supabase account stats, and per-person visit history. Four tabs (hash-routed, e.g. `/analytics/#accounts`): **Overview** (tiles, daily chart, per-project rollup), **Traffic** (top pages/referrers), **Errors** (recent, expandable stacks), **Accounts** (account tiles + per-person cards).

## Architecture

```
page (any app) ──▶ /analytics/track.js ──▶ POST /rest/v1/analytics_events  (anon key, insert-only RLS)
                                                        │
ctrl.rodeo/analytics ──▶ analytics-dashboard edge fn ──▶ analytics_summary() / analytics_account_stats()
   (CtrlAuth sign-in)     (403 unless owner email)        (security definer, service_role-only)
```

### Ingest — `analytics/track.js` (v1.0.0)
- `<script defer src="/analytics/track.js"></script>` in the `<head>` of: home, boards, events, applications, ladder, calendar, soundscape, account, communes.
- Sends one `pageview` row per page load, plus `error` rows from `window.onerror` / `unhandledrejection` (deduped per message, max 10/page, cross-origin "Script error." noise dropped).
- Fields: type, app (first path segment), path, referrer, session_id (per-tab `sessionStorage` id), user_id (signed-in Supabase user, read from the shared `sb-<ref>-auth-token` localStorage session; null when signed out), viewport, ua, message/stack for errors.
- Fire-and-forget `fetch` with `keepalive`; failures never surface to the page.
- Opt out on a device: `localStorage.setItem('ctrl-analytics-optout', '1')`.

### Storage — `public.analytics_events` (migration `156_analytics_events.sql`)
- RLS enabled. One INSERT policy for `anon`/`authenticated` with length-checked columns; **no SELECT policy at all** — the anon key can write telemetry but read nothing back.
- Reads happen only through two `security definer` functions, `REVOKE`d from public/anon/authenticated and granted to `service_role` only:
  - `analytics_summary(days)` — totals, daily series, per-app rollup, top paths/referrers, last 50 errors.
  - `analytics_account_stats()` — counts + 20 most recent accounts from `auth.users` (email, providers, created, last sign-in).
  - `analytics_people(days)` (migration `157_analytics_people.sql`) — one row per account joined to its events: last visit, views/sessions/errors in window, apps used, and the 30 most recent events (what they viewed). `user_id` is client-reported telemetry and is never used for authorization; visits made while signed out are not attributable.

### API — `supabase/functions/analytics-dashboard` (v1.0.0)
- `verify_jwt` on; additionally checks the caller's email against `ADMIN_EMAILS = ['fike101@gmail.com']` — anyone else gets 403. This is the single access-control gate; the client-side `CtrlAuth.isAdmin()` check is UX only.
- Accepts `{ days: 1–365 }` (default 30); returns `{ summary, accounts }` from the two RPCs via the service-role client.

### Dashboard — `analytics/index.html` (v1.0.0)
- CtrlAuth sign-in (magic link / Google / Discord), Sassy tokens/components, dark-first, mobile responsive, `noindex`.
- Stat tiles, single-series daily views bar chart (SVG, hover tooltip with views/sessions/errors), tables for projects, top pages, referrers, recent errors (click a row to expand the stack), and recent accounts. 7/30/90-day range filter.

## Security model
- **Only Ian can read anything.** Read path is: owner JWT → edge function email check → service-role RPCs. The table itself is unreadable via PostgREST for every client role, and both SQL functions are non-executable for anon/authenticated.
- Writes are open to the anon key by design (it's public telemetry), constrained by column length checks and a type whitelist.

## Visibility build-out (migration `158_analytics_vitals_alerts.sql`)
- **Server-side errors** — `_shared/telemetry.ts` `logServerError()` writes type `server_error` rows (app `fn:<name>`) from the top-level catch of analytics-dashboard, recruit-watch, recruit-gmail, and recruit-discord. Service-role-only: the anon insert policy excludes `server_error`. They appear on the errors tab labeled "(server)" and count in error totals. Add the same two lines to any function's catch to enroll it.
- **Web vitals** — track.js v1.2.0 hand-rolls LCP/CLS/INP/TTFB via PerformanceObserver (no external lib), batched as type `vital` rows when the page first goes hidden. `analytics_summary` exposes p75 per metric; the overview shows them as tiles.
- **Custom app vitals** — track.js v1.3.0 exposes `window.ctrlVital(name, value)`; apps push their own timings as `vital` rows (same shape, no schema change). First consumer: the recruiting app's boot phases — `boot_access` (Discord gate check), `boot_data` (loadAll), `boot_enter` (gate→app), `boot_since_nav` (nav→interactive); deep links (`?a=`) report as `boot_*.deep`. The boot line also prints to the console: `[applications] boot: access …ms ∥ data …ms · enter …ms · since nav …ms`.
- **Alerts** — `analytics-alerts` fn v1.0.0, pg_cron every 30 min (`analytics_alerts_tick`, nonce handshake per migrations 123/136, no new secrets). DMs Ian via the recruiting bot on ≥3 client errors/hour or ≥1 server error/hour, deduped to one DM per kind per 6h via the `analytics_alerts` ledger.

## Operations
- Deploy: `supabase functions deploy analytics-dashboard` (Boards project).
- Retention: no automatic purge yet; add a cron delete if the table grows past ~1M rows.
- Adding a page to tracking: drop the one script tag in its `<head>`; `app` is derived from the URL automatically.
