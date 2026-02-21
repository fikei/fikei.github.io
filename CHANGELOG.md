# Changelog

All notable changes to ctrl.rodeo will be documented in this file.

For Notion sync and ops infrastructure changes, see [docs/infrastructure/ops-changelog.md](docs/infrastructure/ops-changelog.md).

---

## [2026-02-21] - Categorization Cleanup & Lookback MVPs

### Added
- **Categorization Cleanup MVP (Epic 3.6)** — Adaptive threshold system for identifying pins needing manual review:
  - Adaptive threshold engine: 25th percentile of confidence scores, floor 0.50, ceiling 0.80
  - Cleanup queue with 7 qualification criteria: threshold, category conflict, content mismatch, no category, description missing, title missing, enrichment error
  - Priority sorting by confidence score, daily cap of 25 items
  - "Review" pill in filter bar (⚑ flag icon) shows cleanup count and activates review mode
  - Full review card UI: hero image, inline editing (title/description), category reassignment dropdown, confirm/skip/delete actions
  - Migration `016_categorization_cleanup.sql` with cleanup scoring function
  - Lowered activation gate from 10 → 5 pins for visibility on smaller collections (PR #124)

- **Lookback Phase 1 MVP (Epic 12.1)** — Daily surfacing of relevant past pins:
  - Lookback scoring engine with 6 signals: anniversary (days since added), seasonal (month match), never-clicked (no interactions), consumption gap (time since last click), staleness (recency penalty), recency decay (exponential falloff)
  - `getDailyLookback()` with activation gates (5+ pins, 3+ eligible), category diversity (max 2 per category), daily budget (5 cards)
  - Lookback Card at top of board grid: mini-cards with hero images, click handler to expand pin, "Skip All" action
  - Interaction tracking: `lastInteractedAt` timestamp updated on pin clicks
  - Migration `017_lookback_prerequisites.sql` with interaction tracking column
  - Lowered activation gates from 50/10 → 5/3 for visibility on smaller collections (PR #124)

### Changed
- **Threshold adjustments** — Both Categorization Cleanup and Lookback now activate at 5+ pins (down from 10 and 50 respectively) to be visible and useful for smaller collections

### Documentation
- **PRD updates**:
  - `docs/strategy/prds/categorization-cleanup.md` — Added threshold framework section documenting adaptive approach
  - `docs/strategy/prds/lookback.md` — Added threshold framework section with Phase 1 activation gates
- **Project plan**:
  - Created `docs/execution/project-plan/phase-12-lookback.md` — 236 items across 3 epics (Phase 1 Daily Lookback, Phase 2 Curated Collections, Phase 3 Intelligence)
  - Updated `docs/execution/project-plan/phase-3-ai-intelligence.md` — Added Epic 3.6 Categorization Cleanup (89 items)
  - Updated `docs/execution/project-plan/backlog.md` — Added cross-references to Phase 12 for time-based features
  - Updated `docs/execution/project-plan/index.md` — Phase 12 added to overview, stats updated (Phase 3: 128/175, Phase 12: 8/228, total: 163/916)
- **Notion structure**: Added Phase 12 plan file entry to `notion-structure.json`

### PRs
- #120: Implement Categorization Cleanup MVP — review card UI + cleanup view (Epic 3.6 Stories 3-4)
- #124: Lower activation gates for Categorization Cleanup & Lookback (5 pins)
- #121: Implement Lookback Phase 1 MVP (Phase 12 Prerequisites + Epic 12.1 Stories 1-2)

---

## [2026-02-14] - Events Aggregator: New Sources, RA GraphQL Fix & Multi-Source Tags

### Added
- **Gary's Guide event source** — `fetchGarysGuide()` scraper for tech/startup events (SF + NYC). Parses custom table layout with `font.ftitle > a` links, `font.fdescription` venue/address, and day headers. ~63 events per region.
- **Bonobo Network event source** — `fetchBonobo()` scraper for social/community events (SF). Uses Squarespace JSON API (`?format=json`) with JSON-LD and HTML fallbacks. ~8 upcoming events.
- **Tech and Social content types** — Added `tech` and `social` to `CONTENT_TYPES` with keyword-based detection in `detectEventType()` (tech: startup, hack, ai, demo day, pitch, etc.; social: mixer, happy hour, brunch, etc.)
- **Multi-source tags** — Deduped events now show separate color-coded clickable tags per source instead of a single combined tag (e.g. `19hz` `RA` instead of `19hz + RA`)

### Fixed
- **Resident Advisor scraper** — RA is a SPA returning an empty 765-byte HTML shell. Rewrote `fetchRA()` to use RA's GraphQL API (`ra.co/graphql`, `eventListings` query). Returns ~72 events per area with full metadata. Added `__NEXT_DATA__` fallback.
- **Edge function POST support** — `fetch-source` now accepts `method`, `body`, and `headers` params for server-side POST proxying (needed for RA GraphQL)
- **Edge function domain allowlists** — Added `garysguide.com`, `bonobonetwork.com`, and `ra.co` to `fetch-source` and `enrich-event` ALLOWED_DOMAINS. Deployed both functions.

### Changed
- **CLAUDE.md autonomous operations** — Added rules: always merge PR to master when finished; always deploy updated Supabase edge functions after merge without asking

### PRs
- #64: Add Gary's Guide and Bonobo Network as event sources
- #67: Fix Gary's Guide and Bonobo scrapers (parser + edge function deploy)
- #68: Add auto-merge and auto-deploy rules to CLAUDE.md
- #70: Fix Resident Advisor: use GraphQL API instead of HTML scraping
- #78: Show separate source tags for deduped events

---

## [2026-02-14] - Visual Standards System for Image Quality & Aesthetics

### Added
- **Three-layer visual standards framework** (`supabase/functions/generate-widget/config/visual-standards.ts`) — defines image quality and aesthetic expectations across the entire platform:
  - **Layer 0 — Product Gate**: Universal pass/fail for any image. Blocks stock watermarks (Shutterstock, Getty), ad network pixels, tracking URLs, data URIs, default social share images, emoji CDNs. Rejects images below 400x300, aspect ratios beyond 3.5:1, files under 5KB. Defines blocked compositions: UI screenshots, text-only images, memes, logo collages, QR codes, presentation slides, spreadsheets, cookie popups, stock handshakes. Soft preferences for professional lighting, clear subject, high contrast, "human curated feel."
  - **Layer 1 — Content Type Standards**: Scores 0.0-1.0 per content type. Defines expected subject, good framing, good backgrounds, anti-patterns, and aspect preference for all 9 types: product, article, video, music, repository, social, document, tool, unknown.
  - **Layer 2 — Category Aesthetics**: Scores 0.0-1.0 per board category. Defines palette (hex colors), mood, textures, lighting, compositions, and anti-patterns for all 9 categories: home, wear, watch, listen, use, eat, go, follow, read.
- **6 exported functions**: `buildGatePrompt()`, `buildContentTypePrompt()`, `buildCategoryPrompt()`, `buildImageScoringPrompt()`, `checkGateUrlPatterns()`, `checkGateTechnical()`
- **Digital product safeguards** — explicit separation between physical and digital products:
  - `product` content type scoped to physical/tangible items with anti-patterns for app screenshots, software interfaces, browser mockups
  - `tool` content type explicitly rejects physical product framing (flat-lay, centered-product, on-model)
  - `use` category composition renamed from `product-hero` to `device-hero`; anti-pattern added for physical product shots applied to software
  - `buildContentTypePrompt()` injects explicit guidance when type is `product`: digital products should be classified as `tool` instead

### Changed
- **`enrich-link` edge function** — gate layer now active in image resolution pipeline:
  - New `isRejectedByGate()` function combines existing logo/placeholder checks with `checkGateUrlPatterns()` for pre-network rejection
  - `scrapeImage()` runs gate at all 5 candidate checkpoints (og:image, twitter:image, JSON-LD, Shopify CDN, srcset)
  - `validateImageTier2()` runs `checkGateUrlPatterns()` after placeholder check and `checkGateTechnical()` after dimension extraction
- **`generate-widget` edge function** — category aesthetic context injected into AI prompts:
  - Imports `buildCategoryPrompt()` from visual-standards.ts
  - Injects category mood, palette, textures, lighting, compositions, and anti-patterns into prompt alongside brand and design system constraints

---

## [2026-02-14] - Boards UX Audit: Accessibility, Security & Mobile Fixes

### Security
- **XSS fix in widget suggestions** — All AI-provided URLs are now escaped with `esc()` before injection into href attributes
- **Sync error handling with retry** — Failed Supabase syncs now show user-facing error toasts and implement automatic retry queue on next sync cycle

### Accessibility
- **Color contrast fix** — Updated `--muted` from #888 to #999 for WCAG AA compliance
- **ARIA roles** — Added proper roles to all modals (role=dialog, aria-modal, aria-labelledby), filter bar (role=tablist/tab with aria-selected), and FAB menu
- **Focus trapping** — Modals now trap focus with Tab/Shift+Tab cycling and restore focus on close
- **Keyboard navigation** — Card grid supports Enter/Space for select/expand, Arrow keys for movement, Home/End for first/last
- **Screen reader support** — Toast container has aria-live="polite", all card images have meaningful alt text

### Mobile
- **Always-visible card overlay** — Touch devices now always show gradient overlay with title and metadata (no hover required)
- **Dark mode embeds** — Spotify (theme=0) and SoundCloud embeds now respect dark mode
- **Expanded URL param cleanup** — Now strips fbclid, mc_cid, and other tracking parameters
- **Logo detection fix** — Resolved false positives via improved path-segment matching

### Added
- **Notes field** — Expanded cards include auto-saving notes textarea (searchable)
- **Onboarding system** — First-pin celebration and progressive hints for new users
- **Listen player metadata** — BPM, key, and genre now displayed in listen category players
- **GitHub link preview** — Shows stars count and language badge for GitHub repositories
- **Watch mood tags** — TMDB keywords and genres mapped to mood tags
- **APP_CONFIG extraction** — Admin emails and config moved out of hardcoded constants

### Changed
- **Consolidated hamburger menu** — "Refresh Image" + "Rerun Enrichment" merged into single "Refresh" action, "Change Category" + "Change Content Type" merged into new "Organize" modal, "Share Link" renamed to "Share"
- **Error badge improvements** — Now shows context on tap and triggers refresh/retry
- **Organize modal** — New unified interface for category and content type changes
- **Paste deduplication** — Suppresses add prompt for recently added URLs
- **Widget re-trigger** — Category changes now automatically regenerate relevant widgets
- **Widget timeout handling** — 10-second timeout with "Tap to retry" fallback for failed widget generation
- **Enrichment error UI** — Error badge now clickable to trigger retry
- **Expanded card validation** — Link IDs validated on load to prevent desync from deleted links

### Fixed
- BUG-027: XSS vulnerability in AI widget suggestions
- BUG-028: Color contrast fails WCAG AA in muted text
- BUG-029: No keyboard access to card grid
- BUG-030: Missing ARIA roles on interactive elements
- Multiple micro-interaction and mobile UX issues

---

## [2026-02-13] - Link Capture Improvements: Mobile, PWA, Bookmarklet, Image Scan

### Added
- **Mobile Quick-Add Bar** — Always-visible URL input at bottom of mobile viewport. Paste button reads clipboard and auto-submits. Auto-processes on paste event. No more modal tap dance on mobile.
- **Deep Link Handler** — `?add=URL` query parameter auto-adds links on page load. Enables Apple Shortcuts, Tasker, IFTTT, and any external automation to send URLs to Boards.
- **PWA Share Target** — Updated `site.webmanifest` with branded name ("Boards — ctrl.rodeo"), `share_target` config, `start_url`, and `scope`. New `boards/pwa-share.html` landing page extracts shared URL/text and redirects to `?add=URL`. New `boards/sw.js` service worker enables PWA installability with network-first caching.
- **Bookmarklet** — Drag-to-install "Save to Boards" link in new Tools modal. One click on any page redirects to `boards/?add=<current-url>`.
- **Tools Modal** — New modal (FAB menu → Tools) with bookmarklet, share URL for automations, and PWA install button with status detection (available/installed/not available).
- **Image Scanning** — New `scan-image` Supabase edge function using Claude Vision API. Analyzes photos to identify products, brands, URLs, and content. Returns structured items with title, description, URL, category, and confidence score. Scan button in FAB menu with results modal for multi-select batch adding.
- **Bookmarklet Promo Banner** — Smart desktop-only banner suggests bookmarklet after 3rd link add. Escalating dismiss cooldown (7 days → 30 days). Auto-suppressed for deep-link arrivals, mobile users, and users who find Tools on their own.

### Changed
- **`site.webmanifest`** — Updated from generic "My App" to branded "Boards — ctrl.rodeo" with description, start_url, scope, and share_target.
- **FAB menu** — Added Scan Image and Tools buttons alongside existing Share Link, Photo, and Video.
- **`closeAll()`** — Now includes toolsModal and scanModal.

### Documentation
- **Phase 7 project plan** — Added Epic 7.1 Quick Capture Tools (all stories complete), renumbered existing epics.
- **UX: mobile-capture.md** — Updated to ✅ Shipped with full JTBD table, wireframes, and technical notes.
- **UX: link-capture.md** — Updated with new capture methods.
- **Architecture docs** — Added PWA and image scanning technical design.
- **Setup guide** — New `docs/setup/capture-tools-setup.md` covering all capture tools.

---

## [2026-02-09] - Listen Category: Music as First-Class Content

### Added
- **`listen` category** — 9th category, splits music out of `watch`. Keywords: music, album, song, playlist, track, artist, band, concert, podcast, dj, remix, mix, vinyl. Domains: spotify.com, soundcloud.com, bandcamp.com, music.apple.com, tidal.com, deezer.com, music.youtube.com, last.fm, genius.com, pitchfork.com.
- **Listen sub-tags** — albums, tracks, playlists, podcasts, artists, mixes with keyword detection.
- **`extractMusicMetadata()`** — Structured music metadata extraction: artist, trackTitle, albumTitle, genre, duration, releaseDate, contentFormat, platformId, isExplicit. Populates 9/12 fields without OAuth via oEmbed APIs + og:music tag scraping.
- **Spotify/SoundCloud oEmbed** in `resolvePlatformImage()` — Album art resolution for music platforms.
- **oEmbed response cache** (`fetchOembed()`) — Shared between image resolver and metadata extractor, eliminates duplicate API calls.
- **og:music tag extraction** in `fetchMetadata()` — Scrapes `og:music:duration`, `og:music:album`, `og:music:release_date`, `og:music:musician`, genre from already-fetched HTML.
- **watch→listen migration** — One-time `migrateWatchToListen()` moves music links from watch, clears domain cache for music domains.
- **Sound Shelf widget** — Visual album art grid for listen category (hero zone, 4+ items).
- **Listen Next widget** — AI-picked listening queue of 3 items (inline zone, 3+ items).

### Changed
- **`watch` category** — Trimmed to video-only: movie, film, series, show, documentary, trailer, animation, clip, cinema, tv.
- **`BUILTIN_TYPES`** — Reordered music before video so `music.youtube.com` matches music content type before `youtube.com` matches video.
- **Music content type domains** — Added music.apple.com, tidal.com, deezer.com, music.youtube.com, audiomack.com.
- **Widget registry** — 2 new widgets registered (server + client): sound-shelf, listen-next.

---

## [2026-02-09] - Runtime Design Constraint Engine for Boards

### Added
- **`boards/design-constraints.js`** — New runtime constraint engine that loads the design system manifest and template registry at page load, then exposes validation and annotation APIs for Boards widgets.
  - `DS_CONSTRAINTS.init()` — Auto-loads `manifest.json` + `template-registry.json`, builds lookup indexes
  - `DS_CONSTRAINTS.validate(el)` — Validates a single DOM element against design system rules
  - `DS_CONSTRAINTS.auditDOM(root)` — Scans all elements in a subtree, reports constraint violations
  - `DS_CONSTRAINTS.annotate(root)` — Stamps `data-ds-*` attributes on elements for introspection (`data-ds-size`, `data-ds-template`, `data-ds-valid-modifiers`)
  - `DS_CONSTRAINTS.getConstraints(templateName)` — Query API for template rules
  - `validateWidgetSize()`, `validateComponent()`, `validateWidgetElement()`, `validateTemplateStructure()` — Targeted validation functions
  - Violation tracking with timestamps and custom event emission
- **Boards `index.html` integration** — Loads the constraint engine script and wires it into the widget rendering pipeline

---

## [2026-02-08] - Systemic QA Enhancements + Preferred Variant Marking

### Added
- **Preferred variant marking** — New `preferred` flag in VariantAudit system. Designers can mark recommended variants per template/size. Preferred badge displayed on variant cards and in the audit log table. Setting a variant as preferred automatically unblocks it.
- **QA controls integrated into component stage** — Viewer variant cards now show inline stoplight status dots, preferred badges, comment counts, and action buttons (Prefer, Comment, Process/Approve, Block). Inline audit log table rendered below the variant gallery with JSON export.
- **Visible comment/block/status controls** — No longer hidden behind right-click context menu. Quick-access buttons always visible on each variant item in QA view.
- **Scan modal** — Quick-access modal (`/` key or dev menu) for entering a URL or loading the local design system without navigating to the audit form.
- **Dev menu** — `/` button in Systemic header opens dropdown: "Reload local system", "Clean up duplicates", "Copy/Download debug log", "Clear all data".
- **Debug logging system** — Comprehensive categorized logging (`AUDIT`, `TOKENS`, `COMPONENTS`, `CLEANUP`, etc.) with timestamped entries. Export as JSON via clipboard or file download.
- **Template grid size expansion** — Systemic now shows all 15 grid sizes for template variants (not just `validSizes`), enabling QA audit of every size permutation.
- **Grid test section** — Column permutation testing (1-col through 4-col) with grid lines overlay toggle for visual inspection.

### Changed
- **Rename from SystemicAI to Systemic** — All files, classes, references, and UI text updated. The app is now just "Systemic".
- **Specs moved to sidebar** — Component specs now display in the context sidebar panel instead of the main content area, matching the split Design/Code context pattern.
- **Variant gallery shows accurate grid widths** — Fixed template variant previews to use correct CSS grid column widths matching the actual `w-shell--*` size tokens.
- **QA feature parity with widgets.html** — Variant audit system now matches the widget showcase's governance features: grid lines overlay, grid test section, and stoplight status management.
- **Removed duplicative variants sidebar** — Eliminated redundant sidebar that showed variants in both the sidebar and the main content panel.

---

## [2026-02-08] - Pin Profiling, Widget Inspector & 6 New Widgets

### Added
- **Pin profiling** — `profilePins(items)` analyzes pins: domain diversity, content quality, product vs editorial ratio, word frequency.
- **Widget scoring** — `scoreWidgetFit(widget, profile, category)` scores 0-1 with 5 weighted signals: category match, item count, domain diversity, content quality, content type affinity.
- **Widget Inspector** — Dev menu overlay showing pin profile + all widgets with score %, eligibility, rationale.
- **Right-click context menu** — Right-click widget header to see score, zone, template, signals.
- **4 new template renderers** — `comparison`, `choices`, `checklist`, `grouped`. All 11 templates now implemented.
- **6 new widgets** (Phase 2.5b): `eat-decide`, `use-compare`, `discover-more`, `style-pick`, `outfit-checklist`, `board-overview`. Total: 11 registered widgets.
- **`updateChecklistTotal()`** — Recalculates running total on checkbox toggle.

### Changed
- **`getApplicableWidgets()`** — Now ranks by `scoreWidgetFit` (highest first, favorites boosted).
- **Dev menu** — Fixed black text, added Widgets toggle + Widget Inspector button.
- **`template-registry.json`** — All 11 templates `boardsStatus: "migrated"`, coverage complete.

---

## [2026-02-07] - Config-Driven AI Prompts + Server-Side Validation

### Added
- **`config/design-system.ts`** — New module in generate-widget edge function embedding the template registry (10 templates, body modifiers, valid sizes, structure rules) and full class allowlist (130+ `w-*` classes).
- **`buildDesignSystemPrompt()`** — Injects template-specific constraints into AI prompt: body modifier, required/optional atoms, allowed classes, valid sizes.
- **`validateWidgetHtml()` / `sanitizeWidgetHtml()`** — Server-side class allowlist validation. Extracts all `w-*` classes from AI HTML output, compares against allowlist, strips unknown classes.
- **`resolveTemplate()`** — Maps Boards template names (e.g., `grid-split`) to design system definitions (e.g., `split`).
- **Discovery endpoint `designSystem` field** — Each discovered widget now includes its DS template mapping (templateName, bodyModifier, validSizes, structure).

### Changed
- **AI prompt construction** — Now includes a `DESIGN SYSTEM OUTPUT FORMAT` section between brand constraints and confidence instructions. AI is told which `w-*` classes to use for each widget's template.
- **`WidgetMeta.validation`** — Extended with `unknownClasses`, `classesUsed`, `htmlSanitized` fields for DS compliance tracking.

---

## [2026-02-07] - Phase 2.5a Complete: Design System Transition

### Added
- **Widget feature flag** — All widgets hidden by default. Enable via `window.enableWidgetDS()` in browser console. Persists via localStorage once toggled on. Guards `generateWidgets()`, hides hero/footer sections, and disables `widgets.css` when off.
- **Edge-case fixtures** — Added `edgeCases` arrays to all 10 templates in `template-registry.json`. Covers: empty data, single item, overflow (20+ items), very long text, missing optional fields, extreme positions.
- **Source-of-truth documentation** — Added hierarchy diagram and rules to `design-system/README.md`: CSS files are authoritative, manifest is derived, registry is reference.
- **Widget system documentation** — Replaced legacy `widget-complete` README section with current `w-*` class reference (atoms, molecules, body templates, grid sizes).

### Removed
- **733 lines of dead CSS** — Removed all legacy `widget-outfit__*`, `widget-style__*`, `widget-complete__*`, `widget-empty*`, `widget--loading*`, `widget-spectrum__*`, `widget-statrow__*`, `widget-quickadd__*` class definitions from `boards/index.html`. These were fully replaced by `w-*` design system classes in the template migration.

### Changed
- **`design-system/README.md`** — Updated file structure, added source-of-truth section, replaced legacy widget docs with `w-*` system reference.
- **`design-system/template-registry.json`** — All 10 templates now have `fixture` + `edgeCases` for QA testing.

---

## [2026-02-07] - Branch Reconciliation: Widget Phase 2.5a/2.5b + Documentation Merge

### Added
- **`docs/execution/project-plan/phase-3-ai-intelligence.md`** — Merged Widget Phase 2.5a (Design System Transition) and Phase 2.5b (Rules-Based Widget Catalog with 40 widgets) from `claude/ai-widget-phase-2-Lgjfd` branch. Phase 3 now contains the full widget ecosystem roadmap alongside Epic 3.5 Image Intelligence System.
- **`docs/execution/project-plan/backlog.md`** — Added "Action Widget Templates" section (9 feedback-loop templates) from widget branch.

### Changed
- **`docs/execution/project-plan/index.md`** — Reconciled statistics from both branches: Phase 3 now ~113 complete / ~253 pending (up from 46/91), Phase 6 corrected to 1/26, Phase 7 corrected to 0/17 (after Epic 7.2 superseded). Added Widget Phase 2.5a milestone, Phase 2 marked COMPLETE, Phase 2.5a/2.5b added to widget ecosystem roadmap. Removed SERP API from "Needs Decision" (resolved). Total: 155 complete, 688 pending.
- **Widget Phase 2 Template Selection Engine** — Updated template names to match implementation: `grid-split`, `hero-card`, `list`, `text-block` (was `product-grid`, `style-card`, `simple-list`, `text-summary`).
- **`CHANGELOG.md`** — Merged changelog entries from widget branch (Server-Driven Widget Discovery, Widget Templates).
- **`notion-structure.json`** — Added entries for widget branch PRDs and UX research docs.

---

## [2026-02-07] - Phase 9: Restructure Around Access Tiers + CLAUDE.md Update

### Changed
- **`docs/execution/project-plan/phase-9-bulk-import.md`** — Major restructure: organized imports by access tier (OAuth API / Browser Extension / File Upload) instead of data format. Added: OAuth-Connected Imports epic (Reddit, Spotify, Pinterest, YouTube, Pocket with full API specs), Browser Extension Import epic (network interception for Instagram, TikTok, Twitter/X), Platform API Viability Matrix, Manifest V3 architecture docs. File-based imports become Tier 3 fallback. 7 epics total (up from 6).
- **`docs/execution/project-plan/phase-8-automated-pins.md`** — Added shared infra cross-reference to Phase 9 OAuth connections.
- **`docs/execution/project-plan/phase-7-platform-expansion.md`** — Added cross-reference noting Epic 7.1 extension is later extended by Phase 9 Epic 9.3 import capabilities.
- **`CLAUDE.md`** — Added "work item" terminology: generic term for any project plan item that should be placed at the right fidelity level and prioritized.

---

## [2026-02-07] - Phase 9: Bulk Import

### Added
- **`docs/execution/project-plan/phase-9-bulk-import.md`** — New phase solving the cold start problem. 6 epics: Import Infrastructure (job pipeline, dedup, bulk AI categorization), Structured File Imports (bookmarks, Pocket, Instapaper, Raindrop, Pinterest, Pinboard, generic CSV/JSON), Platform Data Exports (Instagram, Twitter/X, YouTube, Reddit, TikTok, Google Takeout, Apple data), AI-Powered Content Extraction (screenshots via Vision AI, email forwarding, copy-paste blobs, shared list import), Onboarding Import Flow ("Import Your Digital Life" wizard), Bulk Organization (smart category suggestions, duplicate merge, bulk edit, source attribution). ~85 new tasks.

### Changed
- **Phase 7 Epic 7.2 (Import/Export)** — Marked as superseded. All 6 tasks absorbed into Phase 9 Epics 9.1 and 9.2.
- **`docs/execution/project-plan/index.md`** — Added Phase 9, updated Phase 7 pending count (50 → 44), new total 473 pending.
- **`notion-structure.json`** — Added Phase 9 entry.

---

## [2026-02-06] - Server-Driven Widget Discovery

### Added
- **`discoverWidgetsFromServer(category, items)`** — Frontend calls server discovery endpoint before rendering widgets
  - Server eligibility engine is now the source of truth for which widgets appear
  - Graceful fallback: if server is unreachable, falls back to local `WIDGET_REGISTRY`
  - Merges server metadata (zone, priority, eligibility) with local widget configs
  - Server-only widgets auto-build temporary local entries from discovery response (prompt + template)
- **Discovery endpoint enhanced** — Now returns `promptTemplate` and `constraints` per widget
- **Loading state uses dynamic widget name** — No longer hard-coded "Style Summary"
- **Action templates added to backlog** — 9 feedback-loop templates tracked for future implementation

---

## [2026-02-06] - Widget Templates: spectrum, stat-row, quick-add

### Added
- **`spectrum` template** — Labeled horizontal scales showing dimensional positioning (e.g. Budget <--*--> Luxury)
  - Widget config: `price-radar` — positions user on budget/style/brand dimensions

- **`stat-row` template** — Row of 2-4 key collection metrics with large values
  - Widget config: `collection-stats` — brands count, style count, avg price

- **`quick-add` action template** — Single high-confidence suggestion with "Add to board" button
  - First action template with feedback loop: Add → item in board → future widgets exclude gap
  - `handleQuickAdd()` — calls `addLink()` to mutate board state, tracks event, updates UI
  - Widget config: `gap-filler` — AI identifies biggest collection gap, suggests one product

- **3 new server-side widget configs**
  - `config/widgets/price-radar.ts` — spectrum template, categories: wear/tech/home/all
  - `config/widgets/collection-stats.ts` — stat-row template, all 12 categories
  - `config/widgets/gap-filler.ts` — quick-add template, categories: wear/tech/home/fitness

### Changed
- `WIDGET_TEMPLATES` now has 7 templates (was 4)
- `WIDGET_REGISTRY` now has 5 widgets (was 2)
- Server registry imports 5 widget configs (was 2)

---

## [2026-02-06] - Epic 3.5: Image Intelligence System

### Added
- **`docs/execution/project-plan/phase-3-ai-intelligence.md`** — New Epic 3.5: Image Intelligence System with 6 stories: Partial Metadata Resilience, Independent Image Pipeline, Image Strategy Rules Engine, AI Image Editing, AI Image Generation, and Prompt-Driven Image Editor UI (replacing "Refresh Image"). 45 new tasks across the stories.

### Changed
- **Epic 3.2 "Manual Override"** — Marked as superseded by Epic 3.5 Story 6.
- **Backlog "AI image generation for missing thumbnails"** — Marked as superseded by Epic 3.5 Story 5.
- **`docs/infrastructure/technical-design/core-systems-architecture.md`** — Added "Planned: Image Intelligence System" section to image resolution pipeline, documenting the `ai_edit` and `ai_generate` strategies and the planned `resolve-image` edge function.
- **`docs/execution/project-plan/index.md`** — Updated Phase 3 pending count (46 → 91).

---

## [2026-02-06] - Phase 8: Automated Pin Creation

### Added
- **`docs/execution/project-plan/phase-8-automated-pins.md`** — New phase for pins that arrive without manual user action. 5 epics: Feed Subscriptions (RSS/Atom), Inbound API & Webhooks (Zapier/IFTTT/email-to-board), Social Media Import (Twitter, Reddit, YouTube, Spotify), AI Discovery (suggested pins, "more like this", trending), Content Monitoring (page watching, price drops, brand new arrivals). Includes source tracking schema and architecture notes on enrichment pipeline reuse.
- **ADR-013: Server-Side Pin Ingestion** in `docs/strategy/decision-log.md` — Proposed architecture for automated sources: shared `ingest-pin` edge function, same enrichment pipeline, `source` provenance metadata, `reviewed` flag for user acknowledgment.

### Changed
- **`docs/execution/project-plan/index.md`** — Added Phase 8 to phase overview and summary statistics (+65 pending tasks).
- **`notion-structure.json`** — Added Phase 8 entry under Execution > Project Plan.

---

## [2026-02-06] - Notion Structure Audit, Bug Tracking, Decision Log

### Changed
- **`docs/execution/BUGS.md`** — Populated from empty placeholder with 8 real bugs discovered during codebase analysis: 2 high priority (sync writes silently lost, 30s polling read-only), 4 medium (CORS proxy silent degradation, widget timeout UX, logo detection false positives, category change doesn't re-trigger widgets), 4 low (expanded card desync, incomplete URL param removal, paste detection annoyance, hardcoded admin email).
- **`docs/strategy/decision-log.md`** — Added 7 new Architecture Decision Records (ADR-006 through ADR-012): localStorage-first architecture, CORS proxies for client-side scraping, domain profile caching for AI cost amortization, config-driven widget system, two-tier pin enrichment, single-file frontend (no build step), magic link authentication.

---

## [2026-02-06] - Tech Stack, Risk Register, Project Plan Updates

### Added
- **`docs/infrastructure/technical-design/tech-stack.md`** — Complete tech stack reference: frontend (vanilla JS, CSS vars, Jekyll), backend (Supabase, Deno edge functions), AI services, third-party APIs, vendor libraries, dev tooling gaps, architecture diagram.
- **`docs/infrastructure/risks.md`** — 13 known risks with severity, likelihood, status, detailed mitigations, and dev work references. Organized into "Do Now", "Do Soon", "Do Later" priority tiers.

### Changed
- **`docs/execution/project-plan/phase-6-performance.md`** — Added Epic 6.2 (Offline & Sync Reliability: retry queue, periodic full sync) and Epic 6.3 (Security Hardening: CORS restriction, Systemic RLS, CSP, rate limiting).
- **`docs/execution/project-plan/backlog.md`** — Added "Technical Debt & Risk Mitigations" section with 4 epics: Server-Side Scraping Fallback (R1/R13), Client Modularization (R2), Critical-Path Test Suite (R6), Infrastructure Hardening (R11/R12/R7).
- **`notion-structure.json`** — Added Tech Stack and Known Risks entries.

---

## [2026-02-05] - Comprehensive Architecture Documentation

### Added
- **`docs/infrastructure/technical-design/core-systems-architecture.md`** — Pin Creation, Pin Enrichment, and AI Widget Pipeline architecture with data flows and key decisions.
- **`docs/infrastructure/technical-design/database-schema.md`** — Complete schema reference for all 25+ tables across 6 migrations, with column types, RLS policies, constraints, and ER diagram.
- **`docs/infrastructure/technical-design/client-architecture.md`** — Structural map of the 9,100-line boards/index.html monolith: section ranges, state management, rendering pipeline, boot sequence, event system.
- **`docs/infrastructure/technical-design/auth-system.md`** — Passwordless magic link auth flow, session management, anonymous vs authenticated capabilities, admin system, data migration on first login.
- **`docs/infrastructure/technical-design/sync-protocol.md`** — localStorage-to-Supabase sync protocol: upload/download flows, conflict resolution, offline behavior, cross-device polling, known gaps.
- **`docs/infrastructure/technical-design/api-reference.md`** — Request/response contracts for enrich-link, generate-widget, categorize, and notion-sync edge functions plus REST API patterns.
- **`docs/infrastructure/dependencies.md`** — All external service dependencies with fallback behavior, cost breakdown, and risk assessment.

### Changed
- **`docs/infrastructure/deployment.md`** — Expanded from checklist to full deployment guide: architecture diagram, two deployment paths (GitHub Pages auto + Supabase CLI manual), GitHub Actions workflow details, environment variables, database migrations.
- **`docs/infrastructure/security.md`** — Expanded from checklist to detailed security model: RLS policy matrix for all tables, CORS issues, data protection (transit + rest), input validation, third-party risk assessment, known gaps.
- **`COSTS.md`** — Added per-operation AI cost estimates, all 3 Supabase projects, free tier monitoring thresholds, 8 free integrations, cost optimization strategies.
- **`docs/execution/project-plan/backlog.md`** — Consolidated Rich Media Support, Content Reader, and Pin Type Abstraction into a structured **Pin Expansion** section with 5 epics.
- **`notion-structure.json`** — Added 7 new documentation entries to Infrastructure section.

---

## [2026-02-05] - Widget Phase 2: Config-Generated Widgets (COMPLETE)

### Added
- **Config-Driven Widget System**
  - `config/schema.ts` - TypeScript types for widget definitions (206 lines)
  - `config/registry.ts` - Widget loader and runtime evaluation (329 lines)
  - `config/widgets/complete-the-look.ts` - Fashion recommendations widget
  - `config/widgets/style-summary.ts` - Style analysis widget

- **Eligibility Rule Evaluators**
  - `min_items` - Minimum number of items required
  - `max_items` - Maximum items for focused widgets
  - `category_match` - Content matches target categories
  - `content_quality` - Items have sufficient metadata
  - `variety` - Items from different sources/domains
  - `recency` - Recently added items

- **Category-Agnostic Matching**
  - `discoverWidgets(category, items)` - Finds all eligible widgets for any category
  - `getRegistrySummary()` - Returns registered widget metadata for frontend
  - Discovery endpoint: `POST { action: 'discover', category, items }` returns eligible widgets
  - Registry endpoint: `POST { action: 'registry' }` returns widget catalog
  - Frontend no longer hard-codes 'wear' — works with any category that has widgets

- **Template Selection Engine**
  - `WIDGET_TEMPLATES` registry with 4 templates: `grid-split`, `hero-card`, `list`, `text-block`
  - `renderWidgetWithTemplate(widget, items, aiResult)` - Selects template via widget config
  - Fallback chain: primary template → fallback template → `list`
  - Each template has `name`, `version`, and `render()` function
  - Removed all hard-coded `if (widget.id === 'complete-the-look')` rendering branches

- **Hot-Reload Widget Registry**
  - `registerWidget(widget)` - Add a widget at runtime
  - `unregisterWidget(widgetId)` - Remove a widget at runtime
  - `reloadWidget(widget)` - Update a widget in-place with version logging

### Changed
- **Refactored `index.ts`** - Removed 180 lines of hard-coded eligibility rules, replaced with config imports
- **Config-driven enrichment** - Enrichment now triggered by `widget.enrichment.enabled` config, not widget ID
- **`boards/index.html`** - Widget rendering uses template engine; category filtering is config-driven
- **CLAUDE.md** - Updated Supabase project references with correct project IDs

### Documentation
- Updated `phase-3-ai-intelligence.md` - Widget Phase 2 marked COMPLETE with all tasks
- Updated `project-plan/index.md` - Phase 2 milestone added
- Updated `CHANGELOG.md` - This entry

---

## [2026-02-04] - AI Agent Infrastructure Foundation

### Added
- **Claude Code Context System**
  - `CLAUDE.md` - Main context file for Claude Code and AI tools
  - `.claude/settings.json` - Configuration for agents and integrations
  - `.claude/README.md` - Documentation for the context system

- **AI Agent Workforce** (`.claude/agents/`)
  - `organizational-agent.md` - Documentation standards and data integrity
  - `project-management-agent.md` - Task structuring and sprint planning
  - `status-update-agent.md` - Progress tracking and risk flagging
  - `chief-of-staff-agent.md` - Global oversight and decision routing
  - `security-compliance-agent.md` - Privacy and security audits
  - `continuous-improvement-agent.md` - Process optimization

- **Supabase Edge Functions**
  - `agent-handler/` - Orchestrates AI agent requests
  - `notion-sync/` - Bidirectional Notion synchronization

- **GitHub Automation**
  - `.github/workflows/agent-automation.yml` - Automated agent triggers
    - On push: status update and security agents
    - On PR: organizational and project management review
    - Daily: Chief of Staff synthesis
    - Weekly: Continuous improvement analysis

- **Documentation**
  - `docs/SETUP-ai-agent-system.md` - Complete setup guide
  - `docs/PRD-unified-corporate-management.md` - System PRD

- **Configuration**
  - `.env.template` - Environment variable template
  - `.gitignore` - Ignore patterns for env files and build outputs
  - `scripts/setup-notion.sh` - Notion workspace setup script

- **Project Tracking**
  - `PROJECT-STATUS.md` - Unified task tracking
  - `CHANGELOG.md` - This file

### User Preferences Added to CLAUDE.md
1. Structure project plans as Phases → Epics → Stories → Tasks
2. Always show copy-pasteable content
3. Provide step-by-step next actions after tasks
4. Maintain unified project plan tracking
5. Maintain explicit changelog
6. Use and extend the design system (check components, reuse tokens, extend when needed)

---

## Format

Each entry includes:
- **Date** in `[YYYY-MM-DD]` format
- **Summary** title
- **Added** - New features or files
- **Changed** - Updates to existing functionality
- **Fixed** - Bug fixes
- **Removed** - Deleted features or files
