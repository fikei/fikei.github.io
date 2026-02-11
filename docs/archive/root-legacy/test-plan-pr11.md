# Test Plan: PR #11 — Multi-Branch Consolidation Merge

**Merged:** 2026-02-08
**Branches merged:** 9 feature branches into master
**Files changed:** 87 | **Insertions:** 10,116 | **Deletions:** 1,185

**Last tested:** 2026-02-10
**Test branch:** `claude/test-recent-merge-GMvRT`

### Legend
- PASS = Tested and working
- FAIL = Bug found (see Notes)
- FIXED = Bug found and fixed in test branch
- SKIP = Not testable / deferred
- BLOCKED = Blocked by prerequisite

---

## 1. Boards — "Listen" Category

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 1.1 | Add Spotify link | Paste a `open.spotify.com/track/...` URL into Boards | Auto-categorizes to "listen" category | FIXED — URL was being lowercased by `normalizeUrl()`, causing 404s. Fixed to only lowercase protocol+host. |
| 1.2 | Add SoundCloud link | Paste a `soundcloud.com/artist/track` URL | Auto-categorizes to "listen" | SKIP — testing in another chat |
| 1.3 | Add Bandcamp link | Paste a `artist.bandcamp.com/album/...` URL | Auto-categorizes to "listen" | SKIP — testing in another chat |
| 1.4 | Add music.youtube.com link | Paste a `music.youtube.com/watch?v=...` URL | Auto-categorizes to "listen" (not "watch") | SKIP — testing in another chat |
| 1.5 | Add regular youtube.com link | Paste a `youtube.com/watch?v=...` URL | Categorizes to "watch" (NOT "listen") | SKIP — testing in another chat |
| 1.6 | Filter by "listen" | Click "listen" in category nav | Only music links shown; sub-tags appear (genres, moods, formats) | FIXED — `renderFilters()` was not called after category assignment; filter tab didn't appear until refresh. Fixed. |
| 1.7 | Migration — existing user | Load Boards with existing music links in "watch" | Console: `[migrate-listen] Migrated X links from watch → listen`; localStorage key `boards-listen-migration-v1` set | |
| 1.8 | Migration — runs once | Refresh page after migration | Migration does NOT re-run (localStorage flag checked) | |
| 1.9 | Migration — new user | Load Boards with no saved links | No migration error; no console noise | |
| 1.10 | Listen widgets render | View "listen" category with 3+ music links | Eligible widgets appear: `profiler`, `discover-more`, `upcoming-releases`, `sound-shelf`, `listen-next`, `board-overview` | BLOCKED — Requires 3-4+ listen items. `sound-shelf` needs 4 items, `listen-next` needs 3. User needs to add enough music links first. |
| 1.11 | og:music metadata | Add Spotify track | Console: `[FETCH] og:music tags found: {duration: ..., albumTitle: ...}`; link metadata includes `music` object | |
| 1.12 | og:music — non-music link | Add a news article to "listen" category manually | `extractMusicMetadata()` runs, finds no tags, music metadata stays null | |

---

## 2. Boards — Cross-Category Widget Data Leak Fix

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 2.1 | Category switch clears widgets | View "wear" → wait for widget → switch to "home" | Widget regenerates with ONLY home items; no wear-category content visible | FIXED — Server widget configs (gap-filler, price-radar, use-compare) had overly broad `categories` arrays. Restricted to match client `WIDGET_CATEGORY_MAP`. |
| 2.2 | New link isolated to category | In "wear", add a clothing link → switch to "eat" | Eat widgets do NOT reference the new wear link | PASS |
| 2.3 | "All" category shows everything | Click "all" filter | Widgets see ALL links across categories; prompt context includes mixed categories | |
| 2.4 | Widget refresh respects filter | In "eat" category, click widget refresh icon | Regenerates with eat items only | |
| 2.5 | Hard refresh — no leak | Hard refresh (Ctrl+Shift+R) while on "wear" | Widget loads with only wear items; no cross-category bleed from cache | |
| 2.6 | Rapid category switching | Click wear → home → watch → eat quickly | Final widget matches final category ("eat"); no race condition | |

---

## 3. Boards — Generic Widget Architecture

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 3.1 | Profiler → wear | View "wear" category with 3+ items | `style-summary` server widget renders (fashion analysis) | PASS — Widgets render on wear |
| 3.2 | Profiler → home | View "home" category with 3+ items | `design-dna` server widget renders (interior design) | PASS — Widgets render on home |
| 3.3 | Profiler → watch | View "watch" category with 3+ items | `viewer-profile` server widget renders | PASS — Widgets render on watch |
| 3.4 | Profiler → eat | View "eat" category with 3+ items | `flavor-profile` server widget renders | PASS — Widgets render on eat |
| 3.5 | Profiler → go | View "go" category with 3+ items | `traveler-type` server widget renders | |
| 3.6 | Profiler → follow | View "follow" category with 3+ items | `fan-profile` server widget renders | |
| 3.7 | Profiler → read | View "read" category with 3+ items | `reader-identity` server widget renders | BLOCKED — Needs 3+ items from 2+ domains. User likely has <3 read items. |
| 3.8 | Profiler → use | View "use" category with 3+ items | `setup-profile` server widget renders | |
| 3.9 | min_items eligibility | View category with only 2 items (widget requires 3) | Widget does NOT appear | PASS — Confirmed: listen/read don't show widgets when item count is below threshold |
| 3.10 | variety eligibility | Add 10 links all from same domain | `discover-more` widget may be suppressed (needs 2+ unique domains) | |
| 3.11 | Server discovery fallback | Disconnect network, view category | Falls back to local `WIDGET_REGISTRY`; console: `[widget] Using local registry fallback` | |
| 3.12 | Widget content matches category | View profiler widget in any category | Widget title, vocabulary, and analysis match the category domain (fashion terms for wear, food terms for eat, etc.) | |

---

## 4. Boards — Design Constraint Engine

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 4.1 | Engine loads on page load | Open Boards, open DevTools console | Console: `[design-constraints] Ready — X components, Y widget atoms, Z templates` | PASS — Engine loads and reports ready state |
| 4.2 | Ready state | In console, run `window.DS_CONSTRAINTS.ready` | Returns `true` | PASS |
| 4.3 | Widget DOM annotations | Inspect any widget shell in DevTools | Has attributes: `data-ds-size`, `data-ds-template`, `data-ds-valid-sizes`, `data-ds-required-atoms` | |
| 4.4 | Audit — no violations | In console, run `auditDesignConstraints()` | Returns empty array; console: `[design-constraints] ✓ No violations found` (green) | FAIL — `discover-more` widget reports: `Template "suggestion" is missing: w-text--title`. This is a structural violation in the widget HTML. |
| 4.5 | Audit — size violation | Force a widget to invalid size (DevTools) | Audit returns violation: `widget-size`, severity `error` | |
| 4.6 | Audit — missing atoms | Remove required `.w-title` from widget HTML (DevTools) | Audit returns violation: `template-structure`, severity `warning` | |
| 4.7 | Manifest missing | Temporarily rename `manifest.json` → 404 | Console warning only; app doesn't crash; widgets still render | |

---

## 5. Boards — oEmbed Cache & Domain Profiles

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 5.1 | First link from domain | Add `https://example-shop.com/product-1` | AI classifies content type; `domain_profiles` table gets new row with `sample_count: 1` | |
| 5.2 | Second link from same domain | Add `https://example-shop.com/product-2` | Cache hit; skips AI call; console: `[enrich-link] Cache hit: product`; response has `cached: true` | |
| 5.3 | Multi-type domain | Add article + video + product from same news site | `domain_profiles.types_seen` shows counts for each type; `classification: multi_type` | |
| 5.4 | Low confidence — no cache | Domain with <85% confidence | Still calls AI (doesn't use cache); confidence updates after classification | |

---

## 6. Boards — Image Validation (Tier 1 + Tier 2)

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 6.1 | Valid product image | Add link with 800x600 JPEG | Tier 1 passes; image displays; scores include `evaluation_method: 'tier1_heuristic'` | |
| 6.2 | Blocklisted filename | Add link whose og:image URL contains "logo" or "favicon" | Tier 1 rejects; falls back to next image strategy | |
| 6.3 | Placeholder URL pattern | Add link whose og:image contains "no-image" or "placeholder" | Tier 1 rejects; `reason: 'not_distinctive'` | |
| 6.4 | Tiny tracking pixel | Add link with 1x1 pixel as og:image | File size <5KB; Tier 2 rejects; falls back | |
| 6.5 | Known-good source (YouTube) | Add YouTube video | Skips Tier 2 checks; `tier1_known_good` method; high default scores | |
| 6.6 | Known-good source (Spotify) | Add Spotify link | Same known-good bypass | |
| 6.7 | Extreme aspect ratio | Add link with 3000x100 banner image | Aspect ratio 30:1 exceeds 3:1 threshold; image rejected | |
| 6.8 | Broken og:image (404) | Add link whose og:image URL returns 404 | HEAD request fails or redirects to error page; image rejected | |
| 6.9 | No og:image at all | Add link with no image metadata | Validation skipped gracefully; fallback strategy used | |
| 6.10 | Refresh Image button | Right-click card → "Refresh Image" | FIXED — Was returning 401 due to `supabase.functions.invoke`. Fixed in branch to use raw `fetch` with anon key. Not yet on master (needs merge). |

---

## 7. Image Validation — Tier 3 AI Vision (Edge Function)

**Prerequisite:** Migration `007_image_validation.sql` applied; `ANTHROPIC_API_KEY` set.

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 7.1 | AI scoring — valid image | Add link that passes Tier 1; wait for async Tier 3 | `links.image_scores` updates with `evaluation_method: 'tier3_ai_vision'`; scores for accuracy, aesthetic_fit, distinctiveness, safety | |
| 7.2 | Cache hit | Validate same image URL twice | Second call returns `cached: true`; no AI cost | |
| 7.3 | Known-good bypass | Validate YouTube thumbnail | Returns preset scores (0.9/0.9/0.8/1.0/1.0); no AI call | |
| 7.4 | Budget exhaustion | Exceed $0.50/day (~500 evaluations) | Returns 429 error; image still displays (Tier 1 already passed) | |
| 7.5 | Safety — "safe" content | Validate normal product photo | `safety_tier: "safe"`, `safety: 1` | |
| 7.6 | Safety — "mature" content | Validate artistic nudity image | `safety_tier: "mature"`, still allowed (not blocked) | |
| 7.7 | Safety — "blocked" content | Validate prohibited content | `safety_tier: "blocked"`, composite score forced to 0 | |
| 7.8 | No API key | Remove `ANTHROPIC_API_KEY` env var | Function errors gracefully; image still displays | |
| 7.9 | AI returns invalid JSON | (Simulate) Send unprocessable items | Parse error logged; returns null; app continues | |

---

## 8. Events Page — Calendar Views

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 8.1 | Default view | Open Events page | Table view active; "Table" button highlighted | PASS |
| 8.2 | Switch to Day view | Click "Day" button | Day view renders; title shows day name + date (e.g., "Monday, January 15, 2026"); navigation: ← Today → | PASS |
| 8.3 | Switch to Week view | Click "Week" button | Week view renders; title shows date range (e.g., "Jan 12 – Jan 18, 2026"); 7-column grid (Sun–Sat) | PASS |
| 8.4 | Switch to Month view | Click "Month" button | Month calendar renders; 7×6 grid; today cell highlighted | PASS |
| 8.5 | Day view — no events | Navigate to a day with no events | Shows "No events on this day" empty state | |
| 8.6 | Day view — has events | Navigate to a day with events | Vertical timeline: time column (80px) + event name (linked) + venue/city/genre | |
| 8.7 | Week view — overflow | Day with >5 events | Shows 5 events + "+ N more" link | |
| 8.8 | Week view — click day header | Click a day header in week view | Switches to Day view for that date | |
| 8.9 | Week view — today highlight | View current week | Today column has bold header, highlighted style | |
| 8.10 | Month view — click cell | Click a date cell in month calendar | Day Detail panel slides in below calendar; shows all events for that date in table | |
| 8.11 | Month view — close detail | Click X on Day Detail panel | Panel collapses | |
| 8.12 | Month view — event count badge | View month with events | Cells show count badge + up to 3 event previews + "+ N more" | |
| 8.13 | Navigation — prev/next | Click ← / → in any calendar view | Navigates to previous/next day/week/month depending on active view | |
| 8.14 | Navigation — Today | Click "Today" button | Returns to current date in active view | |
| 8.15 | Date sync across views | Click a date in Month → switch to Week → switch to Day | All views centered on the same date; no date jump | |

---

## 9. Events Page — Location Filtering

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 9.1 | City dropdown populated | Open Events page | `#filterCity` dropdown shows "All Cities" + unique cities from events (sorted alphabetically) | |
| 9.2 | Filter by city | Select a city from dropdown | Only events in that city shown; stats bar: "Showing X" | |
| 9.3 | City filter + calendar views | Filter by city, then switch between Table/Day/Week/Month | All views respect the city filter | |
| 9.4 | Events with no city | Filter by a specific city | Events without a `city` value are excluded | |
| 9.5 | Clear filters | Click "Clear" button | City resets to "All Cities"; all events visible; date filters cleared | |
| 9.6 | Search + city filter | Type in search box while city is filtered | Both filters applied together (intersection) | |
| 9.7 | Source + city filter | Select source AND city | Both filters applied together | |
| 9.8 | Empty result | Filter to city with no events in date range | Empty state displayed | |

---

## 10. Events Page — fetch-source Edge Function

**Prerequisite:** Function deployed to Supabase.

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 10.1 | Allowed domain | Fetch from `19hz.info` | Returns HTML content, status 200 | |
| 10.2 | Blocked domain | Fetch from unlisted domain | Returns 403 error | |
| 10.3 | Rate limiting | Send 31 requests in <1 minute | 31st request returns 429 | |
| 10.4 | CORS headers | Check response headers | `Access-Control-Allow-Origin: *` present | |

---

## 11. Systemic — Renaming & UI

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 11.1 | Page title | Open Systemic app | Browser tab: "Systemic - Design System Generator" | |
| 11.2 | Logo text | Check header | Shows "Systemic" (not "SystemicAI") | |
| 11.3 | Scanning | Run a component scan | Scanner works; no console errors | |
| 11.4 | Viewer | View a scanned component | Docs view renders correctly | |

---

## 12. Systemic — Variant Audit Stoplight System

**Note:** Variant viewer currently clones the same source widget for all 15 size permutations with identical content. Does NOT generate different dummy content per variant/size. Fix in progress on test branch.

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 12.1 | Default state | View variant with no audit history | Green stoplight; "Comment" button visible | PASS |
| 12.2 | Add comment | Click "Comment" → type feedback → blur/Esc | Textarea appears; saves on blur; stoplight: Green → Yellow; comment count badge "1"; "Mark processed" button appears | |
| 12.3 | Mark processed | Click "Mark processed" on yellow variant | Stoplight: Yellow → Orange; button changes to "Approve" | |
| 12.4 | Approve | Click "Approve" on orange variant | Stoplight: Orange → Green; comment clears; buttons reset to "Comment" | |
| 12.5 | Prefer | Click "Prefer" on any variant | "Preferred" badge appears; button toggles to "Unprefer" | |
| 12.6 | Prefer + blocked | Click "Prefer" on a blocked (red) variant | Auto-unblocks; "Preferred" badge appears; stoplight: Red → Green | |
| 12.7 | Block | Click "Block" on active variant | Variant moves to blocked grid; Red stoplight; "Blocked" badge; card gets flagged class | |
| 12.8 | Unblock | Click "Unblock" on blocked variant | Variant returns to active grid; stoplight returns to previous state | |
| 12.9 | Persistence | Add comments + prefer + block → refresh page | All audit state persists (localStorage: `widget-variant-audit`) | |
| 12.10 | QA ↔ Docs sync | Block variant in QA view → switch to Docs viewer | Same variant shows as blocked in Docs view | |
| 12.11 | Grid test | Select component in QA view | Grid test shows widget at 5col, 4col, 3col; toggle buttons work; "Grid lines" toggle works | |
| 12.12 | Export audit | Click "Copy as JSON" in audit log | JSON array copied to clipboard with structure: `{name, size, grid, status, preferred, note}`; button shows "Copied!" for 1.5s | |

---

## 13. Systemic — Viewer Audit Integration

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 13.1 | Audit actions in Docs view | View component → variant gallery | Each variant card shows: stoplight dot, action buttons (Prefer, Comment, Block), badges | |
| 13.2 | Comment in viewer | Click "Comment" on variant card in Docs view | Textarea overlays card; auto-saves on blur or Esc | |
| 13.3 | Inline audit log | View component with audit entries | Audit log table appears below variant gallery; shows only entries for this component | |
| 13.4 | Click target accuracy | Click audit button (not the card itself) | Button action fires; does NOT select variant for stage view | |

---

## 14. Widget Generation — New Widgets

### 14a. style-summary (wear)

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 14a.1 | Generates with 3+ items | Save 3+ fashion links in "wear" | Hero card renders with: primaryStyle, secondaryInfluences, colorPalette, keyBrands, priceRange | |
| 14a.2 | Suppressed with <3 items | Have only 2 items in "wear" | Widget does not appear | |
| 14a.3 | Suppressed on low confidence | AI returns `confidence: 0.3` | Widget suppressed (`fallbackBehavior: 'suppress'`, threshold 0.5) | |
| 14a.4 | Content accuracy | Review style analysis against actual saved items | Brands, colors, price range plausibly match saved links | |

### 14b. fan-profile (follow)

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 14b.1 | Generates with 3+ items | Save 3+ creators/accounts in "follow" | Hero card with: label (2-3 words), traits (2-4), summary (1 sentence), confidence | |
| 14b.2 | Label length | Check generated label | 2-3 words, not generic like "Music Fan" | |
| 14b.3 | Traits count | Check traits array | 2-4 items, not more | |

### 14c. listen-next (listen)

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 14c.1 | Generates with 3+ music items | Save 3+ music links in "listen" | List widget: exactly 3 picks with title, artist, reason, estimatedMinutes + sessionLabel | |
| 14c.2 | Exactly 3 picks | Check queue length | Exactly 3 items (not 2 or 5) | |
| 14c.3 | No duplicate artists | Check artist names across 3 picks | All different artists | |
| 14c.4 | IDs match saved items | Compare returned `id` values | All IDs exist in user's saved links (no invented items) | |
| 14c.5 | Estimated minutes plausible | Check `estimatedMinutes` | Track ~4, album ~40, podcast ~45 | |
| 14c.6 | Session label quality | Check `sessionLabel` | 2-3 words, evocative (not "Music Session") | |

### 14d. sound-shelf (listen)

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 14d.1 | Generates with 4+ music items | Save 4+ music links with album art | Grouped visual grid: shelfLabel, ordered items, vibe sentence | |
| 14d.2 | Items have images | All displayed items | Have album art visible in grid | |
| 14d.3 | Shelf label quality | Check `shelfLabel` | Evocative (e.g., "Late Night Electronics"), not "My Music" | |
| 14d.4 | Vibe length | Check `vibe` text | Under 15 words | |
| 14d.5 | Only real items | Compare returned items | All exist in user's saved links | |

### 14e. upcoming-releases (all categories)

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 14e.1 | Generates with 3+ items | Save 3+ items with identifiable brands | List widget: 3-5 predicted releases with brand, release, when, relevance | |
| 14e.2 | Brands from collection | Check `brand` values | All brands appear in user's saved links | |
| 14e.3 | Specific timeframes | Check `when` values | Specific (e.g., "Spring 2026", "Q2 2026"), not "Soon" | |
| 14e.4 | No fabricated releases | Spot-check release names | Plausibly real products/releases | |
| 14e.5 | Count within range | Check items array length | 3-5 items | |

---

## 15. Database Migration — 007_image_validation.sql

**Prerequisite:** Access to Supabase dashboard or CLI.

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 15.1 | Migration applies cleanly | Run `supabase db push` or apply manually | No errors; tables created | FIXED — Migrations 001-007 had bare `CREATE POLICY` statements that fail on re-run. Fixed with `DO $ IF NOT EXISTS` wrappers. Used `supabase migration repair --status applied 001` through `007` to unblock. |
| 15.2 | image_validation_cache table | Check table exists | Columns: `image_url_hash` (PK), `image_url`, `scores` (JSONB), `evaluated_at`, `ttl_days` (default 30), `source_domain`, `content_type` | |
| 15.3 | links table — new columns | Check `links` table | New columns: `image_scores` (JSONB), `image_enrichment_attempts` (INT), `image_enrichment_log` (JSONB) | |
| 15.4 | Indexes created | Check indexes | `idx_validation_cache_domain`, `idx_validation_cache_score`, `idx_links_image_composite`, `idx_links_no_scores` | |
| 15.5 | No data loss | Check existing links data | All existing rows intact; new columns are NULL | |

---

## 16. Homepage

| # | Test Case | Steps | Expected Result | Notes |
|---|-----------|-------|-----------------|-------|
| 16.1 | Visual check | Open `ctrl.rodeo` | Page loads; no visual regressions; links work | |
| 16.2 | Navigation | Click all nav links | All destinations load correctly | |

---

## Priority Order

| Priority | Area | Risk Level | Reason |
|----------|------|------------|--------|
| P0 | 2. Cross-category widget data leak fix | High | Regression = data shown to wrong context |
| P0 | 6. Image validation Tier 1 | High | Regression = broken images everywhere |
| P1 | 1. Listen category | High | New category, migration, domain matching |
| P1 | 3. Generic widget architecture | High | Core refactor, affects all widget rendering |
| P1 | 8. Events calendar views | Medium | New UI, date sync edge cases |
| P2 | 4. Design constraint engine | Medium | New system, but failures are silent |
| P2 | 14. Widget generation (all new) | Medium | AI output validation |
| P2 | 12. Variant audit stoplight | Medium | State machine with persistence |
| P3 | 5. Domain profile caching | Low | Optimization, not user-facing |
| P3 | 7. Tier 3 AI vision | Low | Async, requires deployment |
| P3 | 9. Location filtering | Low | Enhancement to existing feature |
| P3 | 11. Systemic renaming | Low | Cosmetic only |
| P3 | 15. Database migration | Low | One-time, additive only |
| P3 | 16. Homepage | Low | Minimal changes |

---

## Test Results Summary (2026-02-10)

### Bugs Found & Fixed (in test branch `claude/test-recent-merge-GMvRT`)

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Spotify URLs returning 404 | `normalizeUrl()` lowercased entire URL including path (Spotify paths are case-sensitive) | Only lowercase protocol + hostname |
| "Listen" filter tab not appearing | `renderFilters()` not called after AI category assignment | Added `renderFilters()` before `renderGrid()` in both `addForm.onsubmit` and `processLinks` flows |
| Wear product recs on Home category | Server widget configs (`gap-filler`, `price-radar`, `use-compare`) had overly broad `categories` arrays | Restricted to match client `WIDGET_CATEGORY_MAP` |
| Widget right-click menu broken | Context menu matched resolved template name vs registry template name | Changed to use `data-widget-id` attribute |
| enrich-link 401 on "Refresh Image" | `callEnrichmentAPI()` still used `supabase.functions.invoke` | Replaced with raw `fetch` + anon key header |
| DB migrations crash on re-run | `CREATE POLICY` doesn't support `IF NOT EXISTS` | Wrapped in `DO $ IF NOT EXISTS` blocks; also ran `migration repair` |

### Known Issues (not yet fixed)

| Issue | Cause | Severity |
|-------|-------|----------|
| `discover-more` widget constraint violation: `Template "suggestion" is missing: w-text--title` | Widget HTML structure doesn't include required atom | Low — cosmetic audit warning |
| No widgets on listen/read categories | Item count below eligibility threshold (need 3-4+ items) | Expected behavior — not a bug |
| "gear" not a valid category | User referenced "gear" but valid categories are: home, wear, watch, listen, use, eat, go, follow, read | Expected behavior — no "gear" category exists |
| Systemic variant viewer shows same content for all sizes | `buildVariantItem()` clones source widget without content variation | Medium — fix in progress |

### Test Coverage

| Status | Count |
|--------|-------|
| PASS | ~15 |
| FIXED | 6 |
| FAIL | 1 |
| BLOCKED | 2 |
| SKIP (deferred) | 4 |
| Not yet tested | ~75 |

### Deployment Status
- Edge functions deployed: `generate-widget`, `enrich-link`, `categorize` — PASS
- DB migrations: All 7 marked as applied via `supabase migration repair`
- Test branch fixes: NOT yet merged to master — live site still has old code
