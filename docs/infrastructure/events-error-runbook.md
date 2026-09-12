# Events pipeline error runbook

Fix paths for the recurring errors surfaced by the alert bot (Discord DMs from `analytics-alerts`) and the [events metrics page](https://ctrl.rodeo/events/metrics.html) Issue → fix column. Error data lives in `scrape_runs.error_log`, `source_health`, and `analytics_events` (type `server_error`) on the Boards project (`yfhudwakpgzswiylhfbh`).

## Shared Gmail disconnected (invalid_grant) {#gmail-invalid-grant}

**Symptom:** `fn:recruit-gmail — Token refresh failed: {"error":"invalid_grant", ...}` every hour; interview-claim email scanning stops.

**Cause:** the recruiting Gmail OAuth token was revoked or expired. The OAuth app is in Google "Testing" mode, so refresh tokens die roughly every 7 days.

**Fix now:** open [ctrl.rodeo/applications](https://ctrl.rodeo/applications) → Settings → Reconnect Gmail, signed in as the shared recruiting account.

**Fix durably:** publish the OAuth app to Production in Google Cloud Console (see `gmail-oauth-testing-mode-expiry` notes) so refresh tokens stop expiring.

## Eventbrite org API 403 {#eventbrite-org-403}

**Symptom:** every scrape run logs `Eventbrite org API 403 for org <id>` for all `eventbrite-org` sources (eb-mannys, eb-publicworks, eb-hoodslam, eb-thecentersf, eb-envelop, eb-fluxvertical, eb-curiosityguild, internetarchive-sf). Broken since 2026-08-21.

**Cause:** Eventbrite now blocks the unauthenticated `https://www.eventbrite.com/org/{orgId}/showmore/` endpoint the parser ([supabase/functions/scrape-events/parsers/eventbrite-org.ts](../../supabase/functions/scrape-events/parsers/eventbrite-org.ts)) relies on. This is not per-org — the transport itself is dead.

**Fix:** move the parser to an authenticated or scrape-based transport. Options, in order of preference:
1. Eventbrite API with a private token (`https://www.eventbriteapi.com/v3/organizers/{id}/events/?status=live&token=...`) — requires a free Eventbrite account + API key stored as a Supabase secret.
2. Scrape the org page HTML (server-rendered JSON-LD is present on `https://www.eventbrite.com/o/<slug>-<id>`).

**Interim:** disable the eight sources so they stop logging 8 errors × 12 runs/day:

```bash
# Boards DB via management API (keychain token recipe in memory: boards-sql-and-sheet-access)
# UPDATE event_sources SET enabled = false WHERE source_class = 'eventbrite-org';
```

Re-enable and force a run after the transport fix:

```bash
gh workflow run scrape-events.yml -f source_id=eb-mannys
```

## Ticketmaster API 429 {#ticketmaster-429}

**Symptom:** intermittent `Ticketmaster API 429` on `tm-*` venue sources (castro, regency, independent, masonic, warfield, gamh, fillmore).

**Cause:** all Ticketmaster sources hit the Discovery API in the same run; the free tier rate-limits (5 req/s, 5k/day). Transient — the next 2-hour run usually succeeds.

**Fix if persistent:** add a small delay between `tm-*` fetches in `scrape-events` (they currently fire back-to-back), or split them across runs.

## Scrape succeeds but zero events {#zero-results}

**Symptom:** `last_failure_reason = zero_results`, high consecutive-failure count (e.g. `ata-sf` broken since 2026-08-06).

**Cause:** the site changed its markup, so the parser parses nothing — the fetch itself is fine.

**Fix:** open the source URL, compare against its parser in `supabase/functions/scrape-events/parsers/`, update selectors, then force a single-source run:

```bash
gh workflow run scrape-events.yml -f source_id=ata-sf
```

Long-dead HTML sources still enabled and worth pausing or fixing: `citylights-sf`, `sf-punchline`, `cobbs-sf`, `sfdesignweek`, `audium-sf` (all broken since 2026-03).

## Timeouts and aborts {#timeouts}

**Symptom:** `The signal has been aborted`, `Signal timed out.`, or 5xx from the source.

**Cause:** slow upstream or a transient outage; the scraper cancels slow fetches. A whole-run burst (e.g. all `tm-*` timing out at once) usually means the upstream had a blip.

**Fix:** none needed unless the same source shows it repeatedly — then treat as [zero results](#zero-results) and inspect the source.

## Invariant violations {#invariants}

**Symptom:** `last_failure_reason = invariant violation — see pipeline_invariant_checks` (the `19hz-*` sources carry this from an old violation).

**Fix:** check the violation detail, then clear or address:

```sql
SELECT checked_at, violations FROM pipeline_invariant_checks WHERE ok = false ORDER BY checked_at DESC LIMIT 5;
```
