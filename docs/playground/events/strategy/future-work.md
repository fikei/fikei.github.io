# Events — Future Feature Work

**Last Updated:** 2026-07-05
**Status:** Backlog — groomed, not started
**Context:** Everything in the [source-architecture PRD](./prd-event-source-architecture.md) Phases 1–2 plus most of Phase 3 shipped July 2–5, 2026 (PRs #1003–#1028). This doc is the complete remaining roadmap.

---

## Epic 1 — UI/UX refinements (user-reported, 2026-07-05) ✅ Shipped (client v1.19.0, 2026-07-06)

| # | Item | Notes / diagnosis | Size |
|---|---|---|---|
| 1.1 | **Fix: page load shows tomorrow's events, not today's** | Root cause identified: the client computes "today" via `new Date().toISOString().split('T')[0]` (events/index.html `loadSupabaseCachedEvents`), which is **UTC** — after 5pm PDT that's tomorrow. Fix: derive the date in local time (`toLocaleDateString('sv-SE')` or manual Y-M-D). Audit all `toISOString().split('T')[0]` call sites client-side (past-events cutoff has the same bug). Server-side cron paths are fine (UTC intentional). | S — bug fix, do first |
| 1.2 | **Remove Day and Week views** | Drop the two middle options from the view toggle (`Table / Day / Week / Month` → `List / Month`). Delete `renderDay()`/`renderWeek()` code paths and their settings persistence values (migrate saved `view: 'day'|'week'` → `'table'`). | S |
| 1.3 | **Day separators in the desktop list view** | The mobile card view groups events under date headers; the desktop table renders a flat list. Bring the same date-separator rows (sticky, styled per design system) into the primary table view. Respects sort order (only applies when sorted by date). | M |
| 1.4 | **Rename "Table" → "List"** | View-toggle label only; keep the internal `view: 'table'` state value to avoid settings migration. | XS |
| 1.5 | **Month view: tap a date → day takeover** | Tapping a day cell in Month view opens a full-view breakdown of that day's events (replaces the grid, back affordance returns to Month). If the tap was on a specific event chip within the cell, scroll/focus that event in the takeover. Mobile-first interaction; replaces the removed Day view's purpose. | M–L |
| 1.6 | **Nav restructure: Calendar → account settings; Manage Sources → header** | Move the "Calendar" (Google Calendar sync/booking) entry point out of the events toolbar into the account settings surface (`/account/` or the CtrlAuth account menu), styled to match its patterns. Promote "Manage Sources" into the page header. Check `design-system/` before styling; run `/ux events` after. | M |

**Suggested order:** 1.1 (bug) → 1.4 + 1.2 (trivial) → 1.3 → 1.6 → 1.5.

---

## Epic 2 — Headless-browser venue scraping

**Why:** Wave 2/3 verification (migration 096) found **11 of 13 target venues are JS-only**: Gray Area, The Lab, SF Symphony, Exploratorium, SFMOMA, The Chapel, The Lost Church, ODC, Brick & Mortar, Rickshaw Stop (+ Noisebridge unstructured). These include the top art-coverage targets.

**Decision needed (1:3:1 when ready):** rendering infrastructure —
- Managed browser API (Browserless/ScrapingBee/Zyte): fastest to ship, per-request cost, no infra
- Self-hosted Playwright worker (Fly/Railway container on cron): more control, fixed cost, more ops
- Skip headless; use per-venue ticketing APIs where they exist (SeeTickets/Ticketweb powering several of these venues may have JSON endpoints like Eventbrite's showmore) — worth a research spike first

**Stories:** infra decision spike → `headless` parser type + queue → enable venues one at a time (registry flips) → coverage re-measure.
**Size:** L (epic). **Dependency:** none — registry rows already exist, disabled with findings in notes.

---

## Epic 3 — Image-flyer extraction (OCR/vision)

**Why:** 15–20% of Agape channel events are image-only flyers (258 image posts in the historical analysis) — currently invisible to extraction. Art/party events skew hardest toward flyers.

**Approach:** in `scrape-discord-events`, for candidate messages with image attachments and no resolvable link/text event: send the image to Claude (vision) with the same structured-extraction prompt. Cost-cap per run.
**Size:** M. **Dependency:** none. **PRD ref:** discord PRD Phase 3; open question §8.2 of source-architecture PRD.

---

## Epic 4 — Demoted discovery platforms (enrichers)

**Why:** PRD §2.1 — Eventbrite location search, Bandsintown-by-city, Funcheap, DoTheBay ingested as *hidden* metadata enrichers, rendered only when Agape-corroborated. The demotion/upgrade machinery already ships in cache-events (dormant); only the parsers are missing.

**Stories:** Eventbrite location-search parser → Bandsintown city parser → register as `demoted=true` sources → verify corroboration upgrades fire.
**Size:** M. **Priority:** low by design — these add dedup corroboration, not visible inventory.

---

## Epic 5 — Curation & members surface (Phase 3 completion)

| Item | Notes | Size |
|---|---|---|
| Auto-enable new stock sources for existing users | One-line client change; awaiting product call (default-on with toggle-off vs. current opt-in) | XS |
| Private-events view polish | Signed-in members browsing class-4 events (Partiful/invite-only) as a distinct surface; currently they render inline when sources are enabled | M |
| Curator expansion | Second community channel → `recommended_by` becomes multi-curator; schema already supports (array). UI: per-curator filter chips | M |
| Per-member taste signals | `posted_by` data accumulating since v1.3.0; "recommended by <member>" filters and ranking boosts | M–L |
| Replies as heat signal | 30% of channel messages are replies (RSVPs, corrections, cancellations); mine for event popularity + updates | L, research-y |

---

## Epic 6 — Pipeline quality & ops

| Item | Notes | Size |
|---|---|---|
| Partiful enrichment fetch failures | Partiful blocks some server fetches (2 of 8 in testing); consider retry with different fingerprint or accept | S |
| ra.co fetch blocked (Cloudflare) | Affects add-event submissions and enrichment of RA URLs; RA feed itself works. Headless (Epic 2) would fix | — |
| Coverage monitoring | `agape_coverage` is live on /events/metrics.html; add trend-over-time (snapshot table + sparkline) and alert if corroboration drops | S–M |
| Internet Archive org | Enabled with real org id; currently 0 upcoming events — verify it populates when they next schedule | XS, watch |
| Enrichment backlog burn-down | ~100s of `failed`/`skipped` rows from JS-only or blocked domains; periodic re-try job for transient failures | S |

---

## Documentation & process

- `/plan` — sync the project plan with the July 2–5 arc (source architecture, dedup, curation, submission, dashboard) and this backlog
- `/pm changelog` — record the release train (client 1.14→1.17.2; scrape-events 1.3.1→1.7.1; scrape-discord-events 1.1→1.4; cache-events 1.5.1→1.6.1; enrich-event 1.1→1.2; add-event 1.0; migrations 089–098)
- `/ux events` after Epic 1 ships (view toggle, nav restructure are UX-doc-worthy)

---

## Suggested sequencing

1. **Epic 1** (this week — visible daily-use wins; 1.1 is a real bug)
2. **Epic 2 decision spike** (unblocks the biggest coverage gap; the SeeTickets/Ticketweb JSON-endpoint research might make it cheap)
3. **Epic 3** (image flyers — highest-value extraction gap)
4. Epic 5 items opportunistically; Epic 4 + remaining Epic 6 as filler
