# Events Session Handoff — 2026-07-08

Context handoff from the July 2–8 events build arc (source architecture → venues → taxonomy → mobile UX). Previous session's context is full. Everything below is merged and deployed unless marked TODO.

## Immediate TODOs (user's last two asks, unstarted)

### 1. Mobile date bar renders broken ("looks wack")
Screenshot evidence: on iPhone, the scrolled-to date ("WED, JUL 8") renders as a floating box **overlapping the MUSIC chip** in the category slider row instead of as a full-width bar *below* the slider.
- The intended CSS is in `events/index.html` under `@media (max-width: 768px)`: `.sources-bar { flex-wrap: wrap }` + `.sources-bar .pulse__current { order: 99; flex-basis: 100%; ... }`.
- Suspects: the sticky/collapsed header state (`pulse--collapsed`) repositions `.pulse__current`, or a parallel-session change to `.sources-bar` layout conflicts with the wrap rules, or the deployed CSS ordering. Reproduce in a 390px iframe (technique below) with the page scrolled (collapsed state!) — the screenshot is mid-scroll.

### 2. Film events need genre tags
Screen Slate film rows show no tags (screenshot: Mur Murs, Carrie, Paths of Glory — bare). 
- `enrich-event` (supabase/functions/enrich-event/index.ts) prompt asks for descriptive tags for music/social/art — extend instruction #1 with film guidance: genre ("Horror", "Documentary", "Noir"), era/movement ("French New Wave", "70s"), director when notable.
- `isJunkTag` in events/index.html already drops the bare "film" echo — good.
- Re-queue upcoming film rows: `UPDATE events SET enrichment_status='pending' WHERE content_type='film' AND date >= CURRENT_DATE AND enrichment_status='completed';` then drain via ONE paced agent (batches of 10 → `POST /functions/v1/enrich-event {eventIds}`, 3–5s sleep). ⚠️ Do NOT run two drains concurrently and don't hammer one domain — a 200-event burst tripped Luma's rate limiting on 7/8 (229 "Failed to fetch URL"). screenslate.com is on the enrichment allowlist.

## State of the world

- **Branch:** `claude/music-venues-k4m9p`, fully merged through PR #1090. Start a NEW branch per CLAUDE.md (`claude/<topic>-<5chars>` off master).
- **Client:** events/index.html v1.41.0, live on ctrl.rodeo via GH Pages (deploys on merge to master, ~2 min).
- **Edge functions (Boards project `yfhudwakpgzswiylhfbh`), all deployed:** scrape-events v1.9.1+, cache-events v1.7.x, enrich-event v1.3.1, scrape-discord-events v1.4.1, add-event v1.0.1. Deploy: `supabase functions deploy <name> --project-ref yfhudwakpgzswiylhfbh` (do it after merge, no asking).
- **Migrations 088–101 applied** (source registry/classes/visibility, dedup, reconciliation, venue categories, music_type). Files in supabase/migrations/; apply via MCP `apply_migration` AND save the .sql file.
- **Docs:** PRD at docs/playground/events/strategy/prd-event-source-architecture.md; roadmap at .../strategy/future-work.md; historical analysis at .../strategy/discord-channel-historical-analysis.md.

## Architecture in 10 lines

- All sources → parsers in `supabase/functions/scrape-events/parsers/` (dispatcher in index.ts by `event_sources.type`) → POST `cache-events` → `events` table (canonical store). Cron every 2h; `run_events_maintenance()` (SQL) purges >60d past, reconciles cross-source canonical keys, applies venue categories, backfills music_type.
- `event_sources` registry drives everything: `source_class` (venue/community/discovery/public-ticketing/private-ticketing/curation), `demoted`, `enabled`. Adding a source of an existing type = INSERT + client STOCK_SOURCES entry (client auto-enables new bay-area stock sources; tombstones respect removals).
- Visibility: `events.visibility` private/public; RLS = anon sees public, authenticated sees all. Agape rows are private; the ★ tag/filter is members-only (Discord guild gating via `agape-membership`).
- Dedup: event_key (per-source), canonical_key (cross-source, sha date|name|venue), canonical_url (URL-first adoption at ingest), plus SQL fuzzy reconciliation post-scrape. Client merges rows by canonical_key into one card with sources[].
- `music_type` column (8 buckets) = AI at enrichment > keyword at insert > maintenance self-heal. Client musicTypeFor() prefers it.
- Client filters state: state.filters {category, contentType, musicType, subGenre, venue(+venueLabel), tag, agape, interested, showPast, search, city, distance, dateFrom/To}. Chips row = renderSourceChips(); sub-nav = updateContentTypeFilter(); rows = renderTable() with tap delegation on #eventsBody (venue-tap, genre-tag[data-tag], agape-tap, bm-btn).

## Hard-won gotchas (read before editing)

1. **Parallel sessions edit events/index.html constantly.** Never trust remembered line numbers/anchors — grep fresh every time. Expect a merge conflict on the `VERSION`/console.log line: resolve by bumping minor and combining both log messages. `git fetch origin <sha> --depth=30` if full fetch hangs (it did; ls-remote works).
2. **PostgREST caps at 1000 rows.** Anything reading `events` must page with `.range()` (client loadSupabaseCachedEvents and metrics.html both do; copy that pattern).
3. **Dates:** UTC bites everywhere. Client uses localToday()/localDateStr(). Server parsers convert to region tz (ical Z-timestamps, RA window, AI "today" anchors are all PT-fixed). Any new parser: never `toISOString().split('T')[0]` on a local-time concept.
4. **localStorage caches survive hard refresh.** After any data repair, bump `CACHE_KEY` (currently 'ctrl-rodeo-events-cache-v3'). 15-min TTL otherwise.
5. **Browser testing:** memory says Chrome MCP only. Ian's real Chrome = the MCP browser — **create your own tab (tabs_create_mcp), never reuse his** (previous session accidentally fought his live Boards tab). Serve locally: `python3 -m http.server 84XX` from repo root (each port = fresh origin = onboarding; seed localStorage 'ctrl-rodeo-event-sources' + 'ctrl-rodeo-events-onboarded' to skip). Mobile viewport: resize_window often fails on maximized windows — inject a 390px iframe of /events/ and inspect `contentDocument` (media queries evaluate against iframe viewport). rAF/timers throttle in unfocused tabs — animations won't run in tests; verify with instant fallbacks/synchronous math.
6. **Anon vs member testing:** Agape rows are RLS-private; the ★ filter is members-only (anon click → login modal). Don't chase 'broken' agape behavior in anon tabs.
7. **Enrichment drains:** one agent, paced, per-domain gentle. Rows with discord permalinks/blocked domains legitimately fail/skip.
8. **seetickets ↔ eventim domain migration** is normalized in canonicalizeEventUrl (cache-events) and the seetickets-wp parser accepts both.

## Open backlog (docs/playground/events/strategy/future-work.md)

- Epic 2: headless scraping decision for 11 JS-only venues (Gray Area, SFMOMA, The Chapel already worked around, others pending)
- Epic 3: image-flyer OCR for Discord (15–20% of channel events)
- Epic 6: enrichment retry job (paced, per-domain throttle) — now urgent-adjacent given the Luma rate-limit episode
- Docs/process: `/plan` project-plan sync + `/pm changelog` for the whole July 2–8 arc (large; versions listed in future-work.md), `/ux events`
- Internet Archive TM/Eventbrite org: enabled, currently 0 events, watch
- PRD checkboxes are current through Phase 3 partial

## Process reminders (CLAUDE.md)

New branch per session → PR to master → **merge the PR yourself** → deploy changed edge functions → bump versions (client VERSION const + console.log; function VERSION at top). Assign PRs to fikei. Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
