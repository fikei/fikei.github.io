# Backlog: Future Considerations

> Back to [Project Plan](./index.md)
>
> Items are derived from [Brand Positioning](../../strategy/brand-positioning.md) and [User Personas](../../ux/personas.md). Persona tags indicate which personas a feature primarily serves.

---

## Taste & Pattern Intelligence

→ Moved to [Phase 12: Lookback](./phase-12-lookback.md).

Items absorbed: taste profile (Epic 12.3), "you save a lot of X" insights (Epic 12.3), trend detection (Epic 12.3), cross-category connections (Epic 12.3), collection timeline (Epic 12.2), monthly digest (Epic 12.2).

---

## Flexible Tagging & Metadata

User-defined metadata beyond AI categories. Critical for DJ, Design Technologist, and power users.

> Personas: DJ, Design Technologist, Multidisciplinary Maker, Researcher

| Story | Status |
|-------|--------|
| **Custom tags** — User-applied tags on any pin, with autocomplete from existing tags | Pending |
| **Tag management** — Rename, merge, delete tags; view all pins by tag | Pending |
| **Structured metadata fields** — Pin-type-specific fields (BPM/key/energy for music, dimensions for images) | Pending |
| **Filter by tags** — Filter board view by one or more tags | Pending |
| **Smart tags** — AI-suggested tags based on pin content and user patterns | Pending |
| **Bulk tag operations** — Select multiple pins, apply/remove tags in batch | Pending |

---

## Pin Expansion

Everything related to supporting multiple pin types, organized by epic. The Pin Type Abstraction epic is the prerequisite — start there before building any new pin type.

> See: [Core Systems Architecture](../../infrastructure/technical-design/core-systems-architecture.md) for the enrichment extensibility model.
>
> Personas: all — Multi-format content is critical for Sound & Scene Curator, DJ, Multidisciplinary Maker, Design Technologist

### Epic 0: Pin Type Abstraction (Pre-requisite)

Refactor the codebase from link-only to a generic pin system. Start this when implementing the first non-link pin type.

| Story | Status |
|-------|--------|
| **Introduce `Pin` base type** — Abstract `Link` into a `Pin` with `pin_type` discriminator field | Pending |
| **Refactor `addLink()` → `addPin()`** — Generalize creation flow to dispatch by pin type | Pending |
| **Refactor `syncLinkToSupabase()` → `syncPinToSupabase()`** — Type-agnostic persistence | Pending |
| **Enrichment strategy registry** — Map `pin_type` → `{ clientEnrich(), serverEnrich() }` | Pending |
| **Rename `enrich-link` edge function → `enrich-pin`** — Accept any pin type, route to type-specific handler | Pending |
| **Database migration: `links` → `pins`** — Add `pin_type` column, backfill existing rows as `link` | Pending |
| **Update widget eligibility** — Widgets declare which pin types they operate on | Pending |
| **Pin type visual differentiation** — Distinct card rendering per pin type (icon, layout, actions) | Pending |

### Epic 1: Link Pin Enhancements

Richer experiences for URL-based pins that already exist. No abstraction needed — these extend the current `link` type.

| Story | Status |
|-------|--------|
| **Video embeds** — YouTube/Vimeo thumbnails, duration badge, inline preview | Pending |
| **Music embeds** — Spotify/SoundCloud album art, artist info, audio preview | Pending |
| **Article reader** — Detect article content, clean reader mode, save text locally | Pending |
| **Newsletter reader** — Detect newsletter content, strip tracking/formatting | Pending |
| **PDF reader** — Detect PDF links, inline preview, full-screen reader, extract text for thumbnails | Pending |
| **Text view mode** — Toggle visual vs text-focused card layout, reading time estimates | Pending |
| **Offline reading** — Cache article/newsletter text for offline access | Pending |

### Epic 2: Note Pins

Text-first pins without a URL. For capturing thoughts, snippets, quotes.

| Story | Status |
|-------|--------|
| **Note creation UI** — Text input in Add modal (detect no URL → note mode) | Pending |
| **Note card rendering** — Text-forward card layout, markdown support | Pending |
| **Client enrichment** — Parse markdown, extract inline URLs as related links | Pending |
| **Server enrichment** — NLP: topic extraction, entity recognition, auto-categorize | Pending |
| **Note editing** — Inline edit, expand to full editor | Pending |

### Epic 3: Image Pins

Direct image uploads, not just links to images.

| Story | Status |
|-------|--------|
| **Image upload UI** — Drag-and-drop or file picker in Add modal | Pending |
| **Supabase Storage integration** — Upload to bucket, generate public URL | Pending |
| **Image card rendering** — Full-bleed image card, EXIF display | Pending |
| **Client enrichment** — Read EXIF data, generate thumbnail, detect dimensions | Pending |
| **Server enrichment** — Vision AI: describe content, suggest category, detect objects | Pending |

### Epic 4: File Pins

Document and file uploads — PDFs, CSVs, other file types.

| Story | Status |
|-------|--------|
| **File upload UI** — File picker with type detection and size limits | Pending |
| **Supabase Storage integration** — Upload with content-type metadata | Pending |
| **File card rendering** — File type icon, size, preview thumbnail | Pending |
| **Client enrichment** — File type detection, size/format metadata | Pending |
| **Server enrichment** — Content extraction (PDF text, CSV preview), AI summarize | Pending |

---

## Action Widget Templates

Templates that collect user input and close a feedback loop (choices train AI, adds update boards). See [Widget Template Patterns research](../../ux/research/widget-template-patterns.md) for wireframes.

> Personas: Visual Collector, Sound & Scene Curator, DJ, Deep-Dive Enthusiast

| Story | Template | Verb | Status |
|-------|----------|------|--------|
| Pick between two options | `pick-one` | Choose | Pending |
| Rapid preference building (pass/save stack) | `swipe-stack` | Pass / Save | Pending |
| Suggest an upgrade/alternative | `swap` | Keep / Replace | Pending |
| Ready-to-buy list with total | `commit-list` | Select + open | Pending |
| Binary direction choice | `vote-split` | Pick direction | Pending |
| Free-text constraint input | `prompt` | Type + submit | Pending |
| Save a curated set at once | `bundle` | Save set | Pending |
| Goal tracking with progress | `goal` | Add + set target | Pending |
| Time-sensitive deal or restock | `alert` | Visit / Dismiss | Pending |

---

## Technical Debt & Risk Mitigations

Derived from [Known Risks](../../infrastructure/risks.md). Items here are longer-term; quick fixes are tracked in Phase 6.

### Server-Side Scraping Fallback (R1, R13)

| Story | Status |
|-------|--------|
| **Build `scrape-metadata` edge function** — Server-side URL fetching without CORS proxies | Pending |
| Route authenticated users through server scrape instead of CORS proxies | Pending |
| Keep CORS proxies as anonymous-user fallback | Pending |
| Add scrape health monitoring (success rates per domain) | Pending |

### Client Modularization (R2)

| Story | Status |
|-------|--------|
| **Extract widget system** (~1,000 lines) into `boards/js/widgets.js` | Pending |
| **Extract sync layer** (~500 lines) into `boards/js/sync.js` | Pending |
| **Extract enrichment pipeline** (~400 lines) into `boards/js/enrichment.js` | Pending |
| **Extract auth module** (~200 lines) into `boards/js/auth.js` | Pending |
| Update `boards/index.html` to load via `<script>` tags | Pending |
| Maintain IIFE pattern in each extracted file | Pending |

### Critical-Path Test Suite (R6)

| Story | Status |
|-------|--------|
| **URL extraction/normalization tests** — Pure function tests for `extractUrls`, `normalizeUrl`, `generateId` | Pending |
| **Classification rule tests** — Verify category/content type rules against known URLs | Pending |
| **Widget eligibility tests** — Test config evaluator against sample pin sets | Pending |
| **Edge function tests** — Deno test for enrich-link and generate-widget request handling | Pending |
| Add test runner to GitHub Actions CI | Pending |

### Infrastructure Hardening

| Story | Status |
|-------|--------|
| **Self-host Supabase SDK** (R11) — Download and serve from repo, eliminate jsDelivr dependency | Pending |
| **CI/CD for edge functions** (R12) — GitHub Actions workflow to deploy on push to main | Pending |
| **Anonymous save prompt** (R7) — Prompt anonymous users to sign in after N pins | Pending |

---

## Taste Engine Signal Quality

Improvements to per-pin metadata extraction and taste engine signal processing. Gaps 1-3 shipped (PR #381, #382). These two remain.

| Story | Status |
|-------|--------|
| **Visual analysis for taste_tags (Gap 4)** — Add optional Claude Haiku vision pass on pin images (`hero_score > 0.5`) to extract visual aesthetic tags: color palette, style, material, mood. Enables axes like minimal↔maximalist and warm↔cool to have real visual signal. ~$0.01/pin. | Pending |
| **Engagement-weighted signals (Gap 5)** — Weight taste signals by user engagement: pins with notes, revisits (`last_interacted_at`), read/watched=true, or shared (short_code used) contribute 2-3x the signal of untouched impulse saves. Data already exists in DB — taste-engine just needs to read it. | Pending |
| **Model migration sweep** — Update all edge functions from retired `claude-3-haiku-20240307` / `claude-3-5-haiku-20241022` to `claude-haiku-4-5-20251001`. Currently only analyze-content and taste-engine are updated. | Pending |

---

## Advanced AI Features

| Story | Status |
|-------|--------|
| Multi-type domain learning | Pending |
| Path pattern learning for complex domains | Pending |
| Type discovery pipeline (clustering + AI analysis) | Pending |
| ~~AI image generation for missing thumbnails~~ | Superseded → [Epic 3.5: Image Intelligence](./phase-3-ai-intelligence.md#epic-35-image-intelligence-system-pending) |
| User-customizable AI prompts | Pending |

---

## Admin Enhancements

| Story | Status |
|-------|--------|
| Content type management (add/edit types) | Pending |
| Visual guidelines management | Pending |
| System metrics dashboard | Pending |
| Scraping health monitor | Pending |
| Widget A/B testing framework | Pending |

---

## Sharing Enhancements

> Personas: Multidisciplinary Maker, Deep-Dive Enthusiast, Researcher, Cultural Omnivore, Design Technologist

| Story | Status |
|-------|--------|
| Board fork/copy | Pending |
| Persistent saved link state | Pending |
| Advanced analytics (clicks, saves, trends) | Pending |
| Custom share URLs (ctrl.rodeo/b/my-board) | Pending |
| QR code sharing | Pending |
| Embed widget for websites | Pending |
| Comment system on shared boards | Pending |
| Pin suggestions from viewers | Pending |
| Follow boards (notifications) | Pending |
| Board marketplace/discovery | Pending |

---

## Internationalization

| Story | Status |
|-------|--------|
| Language selection in settings | Pending |
| RTL support | Pending |
| Date/time localization | Pending |

---

## Generic Widget Architecture Risks

Risks identified during v6.0 generic widget consolidation (2026-02-09). Ordered by impact.

### Server-Side Generic Prompts (Risk #6 — Highest)

Server widget configs have hardcoded category-specific prompts (e.g. `complete-the-look` says "outfit"). The client resolves `{{domain}}` vars but the server ignores the client prompt and uses its own. Expanding widgets to new categories requires new server configs with matching prompts.

| Story | Status |
|-------|--------|
| **Adopt template variables in server widget configs** — Replace hardcoded domain words with `{{domain}}`/`{{noun}}`/`{{analyst}}` in server prompt fields | Pending |
| **Add `resolveWidgetVars()` to edge function** — Server-side template var resolution using category from request body | Pending |
| **Consolidate server configs** — Merge 18 individual server configs into 10 generic ones with template vars, mirroring client architecture | Pending |
| **Remove WIDGET_SERVER_MAP from client** — Once server handles generic IDs natively, the routing layer is unnecessary | Pending |

### Category Expansion Requires 3 Touchpoints (Risk #5 — Medium)

Adding a widget to a new category requires updating WIDGET_CATEGORY_MAP, WIDGET_SERVER_MAP, and adding a server config. Missing any one = silent failure.

| Story | Status |
|-------|--------|
| **Add `validateWidgetMaps()` startup check** — Cross-validate that every allowlist entry has a matching server map entry, log warnings for gaps | Pending |
| **CLI tooling for widget expansion** — Script that takes (widget, category) and updates all 3 touchpoints + generates server config stub | Pending |

### Discovery Response Mapping (Risk #4 — Medium)

Server discovery returns specific widget IDs that need reverse-mapping to generic IDs. Unknown widgets fall through to temp entries without local config.

| Story | Status |
|-------|--------|
| **Server discovery returns generic IDs** — After server consolidation, discovery endpoint returns generic widget IDs directly | Pending |
| **Fallback widget template** — When a discovered widget has no local config, use a safe default renderer instead of building temp entry from server data | Pending |

### Cache Key Consistency (Risk #3 — Medium)

Client cache uses generic widget ID but server call uses server widget ID. Cache invalidation is consistent but key format differs from what the server sees.

| Story | Status |
|-------|--------|
| **Unified cache key strategy** — Document cache key format, ensure server cache and client cache align on key structure | Pending |

---

## Standard UI Enhancements

| Story | Status |
|-------|--------|
| **Collection stats in standard UI** — Move collection stats (item count, domain count, brand count, price range) out of the AI widget system and into the standard category UI. Show as a persistent stats bar or summary row visible for every category, not gated behind AI. Stats should update instantly on add/remove without an AI call. | Pending |
| **Empty filtered state messaging** (#8) — When filtering to an empty category, show "No [Category] pins yet" with clear-filter and add-pin CTAs instead of blank screen | Pending |
| **Search term highlighting** (#39) — Wrap matched search terms in `<mark>` tags for visual feedback | Pending |
| **Scroll position preservation** (#42) — Restore scroll position after filter change or re-render instead of jumping to top | Pending |
| **Category pills horizontal scroll** (#51) — On mobile, category filter bar should scroll horizontally instead of wrapping to multiple lines | Pending |
| **Toast notification stacking** (#49) — Queue toasts, dedup identical messages, support priority levels so errors aren't buried | Pending |
| **Grid density control** (#63) — User-selectable compact/normal/comfortable grid density | Pending |
| **Image zoom / lightbox** (#60) — Tap card image to open full-resolution lightbox view | Pending |
| **FAB menu labels on mobile** (#35) — Show text labels alongside icons in the floating action button menu on touch devices | Pending |
| **Filter combination (AND logic)** (#52) — Support filtering by category AND sub-tag simultaneously | Pending |
| **Widget suggestion rationale** (#53) — Show "because you saved X" hint text below widget cards, tap to dismiss | Pending |
| **Pin duplication to multiple categories** (#38) — Allow a pin to appear in more than one category | Pending |
| **Pin templates** (#41) — Pre-built field templates for common pin types (review, research paper, recipe) | Pending |
| **Search operators** (#56) — Support `"exact match"`, `-exclude`, `domain:` operators in search | Pending |
| **Pin archiving (soft delete)** (#59) — Archive pins instead of permanent delete, with restore option | Pending |
| **Empty filter bar optimization** (#75) — When "All" filter is selected, collapse or hide the filter bar to save space | Pending |

---

## Accessibility

| Story | Status |
|-------|--------|
| **WCAG AA color contrast compliance** | Complete |
| **ARIA roles for modals and interactive elements** | Complete |
| **Focus management (trap, restore)** | Complete |
| **Keyboard navigation for grid** | Complete |
| **Meaningful alt text for images** | Complete |
| **aria-live announcements for dynamic content** | Complete |
| **Keyboard drag-drop alternative** (#21) — Add "Move up/down" to kebab menu and Shift+Arrow for reorder, so keyboard users can sort pins | Pending |
| **Sub-tag pill touch target size** (#72) — Increase sub-tag pills from 24px to 44px minimum for WCAG touch target compliance | Pending |
| High contrast mode | Pending |
| Reduced motion option | Pending |
| Screen reader optimization (full audit) | Pending |

---

## Events & Venue Integration

Connecting digital curation to real-world experiences. Supports brand principle #3: **One place, whole life.**

> Personas: Sound & Scene Curator, DJ, Cultural Omnivore

| Story | Status |
|-------|--------|
| **Event pin type** — Save events with date, venue, lineup; auto-enrich from event pages | Pending |
| **Venue pin type** — Save venues/locations with map preview, hours, links | Pending |
| **Calendar view** — Upcoming saved events in timeline/calendar format | Pending |
| **"Events near you" widget** — Location-based suggestions from saved venues and event sources | Pending |
| **Event → pin linking** — Associate regular pins with events ("I found this at that show") | Pending |
| **Past events archive** — Auto-move past events to archive, preserve as part of collection history | Pending |

---

## Mobile Capture Enhancements

Zero-friction capture from anywhere. Supports brand principle #2: **Organize as you go.**

> Personas: Visual Collector, DJ, Multidisciplinary Maker — all mobile-critical

| Story | Status |
|-------|--------|
| **Share sheet integration** — Save to ctrl.rodeo from any app's share menu (iOS/Android) | Pending |
| **Photo-to-pin** — Capture photo, AI extracts context (product, artwork, event poster) | Pending |
| **Audio snippet capture** — Record a few seconds at a show/club, use audio fingerprinting to identify | Pending |
| **Quick capture widget** — Home screen widget for instant URL/note/photo capture | Pending |
| **Offline capture queue** — Save pins offline, sync when back online | Pending |

---

## Collection Export & Sharing

Making collections useful beyond the platform. Supports brand principle #5: **Expand with the user.**

> Personas: Multidisciplinary Maker, Deep-Dive Enthusiast, Researcher, Design Technologist

| Story | Status |
|-------|--------|
| **Export as mood board** — Generate visual PDF/image of a filtered collection | Pending |
| **Export as playlist** — For music-heavy collections, export track list to Spotify/Apple Music | Pending |
| **Shareable collection pages** — Public URL showing a curated subset of a board | Pending |
| **Collection templates** — Pre-built board structures (e.g. "DJ Crate", "Design Research", "Trip Plan") | Pending |
| **Recommendation sharing** — "My top picks for X" exportable list | Pending |

---

## Systemic v2

Three-track upgrade to the design system analyzer. See [PRD: Systemic v2](../../strategy/prds/systemic-v2.md).

### Epic: Track 1 — Three Input Sources

| Story | Status |
|-------|--------|
| **Input source selection screen** — Replace single URL input with three-source entry screen (Live Page, Design File, Production Code) with distinct icons and descriptions | Pending |
| **Code source: GitHub repo parser** — Fetch and statically parse HTML/CSS/JS from a GitHub repo URL via GitHub Contents API; extract component instances with file + line attribution | Pending |
| **Code source: local path bridge** — Deno local bridge server + `systemic-crawl` edge function for reading files from a local filesystem path | Pending |
| **Figma integration** — PAT-based auth, Figma REST API calls to fetch components, variants, published styles (design tokens), and frame names as location context | Pending |
| **Paper canvas integration** — Read active Paper canvas via MCP context; same normalization output as Figma parser | Pending |
| **Extend ComponentRecord shape** — Add `instances[]` array with location (file path + line, page URL, or Figma frame name), instance HTML, surrounding context, and thumbnail | Pending |

### Epic: Track 2 — Lifelike Component State Rendering

| Story | Status |
|-------|--------|
| **State renderer module** — Generate one rendered example per discovered CSS state rule; apply state styles inline to a static copy of the example HTML | Pending |
| **State sets per component type** — Button (5 states), Input (5), Dropdown (4), Card (3), Navigation (3), Checkbox/Radio (4), Badge (variants), Toggle (3) | Pending |
| **Contextual placeholder content** — Replace lorem ipsum with component-type-appropriate labels, field names, and body text via lookup table | Pending |
| **State badges** — Small badge in top-right of each state example showing state name ("hover", "disabled", "error", etc.) | Pending |
| **Replace Examples section** — Component docs view becomes the multi-state examples view; current "Examples" page is removed | Pending |

### Epic: Track 3 — Component Usage Inspector

| Story | Status |
|-------|--------|
| **Instance grid view** — Select a component type from dropdown; show all instances across source in a scrollable grid with thumbnail, location, and variant badge | Pending |
| **Right-side drawer** — Click instance to open ~40% width drawer with rendered preview, syntax-highlighted source code block, surrounding context, and variant classification + confidence | Pending |
| **Drawer navigation** — Previous/Next arrows inside drawer to cycle through instances without closing; keyboard Escape to dismiss | Pending |
| **Filter controls** — Location path search and variant filter above instance grid; live count updates | Pending |
| **Thumbnail generation** — Lazy client-side thumbnail rendering for instance grid using html2canvas; generated on scroll | Pending |

### Epic: Docs Viewer UX

| Story | Status |
|-------|--------|
| **Hash-based routing** — `#systems`, `#docs/color`, `#docs/component/button` | Complete |
| **Breadcrumb navigation** — Systems / CTRL / Color | Complete |
| **Progressive universal nav** — Single nav bar adapts per view (systems, audit, docs) | Complete |
| **Showcase layout** — widgets.html-style scrollable content area with grid texture | Complete |
| **Examples section** — Atoms + Molecules showcase using extracted tokens | Complete |
| **Left-hand sidebar navigation** — Collapsible sidebar for filtering foundations/components alongside top nav | Pending |
| **Component search/filter** — Quick-filter components by name or type from sidebar | Pending |
| **Responsive sidebar** — Drawer-based sidebar on mobile with toggle | Pending |

### Epic: Documentation Generation

| Story | Status |
|-------|--------|
| Auto-generate usage guidelines per component | Pending |
| Export design system as static HTML report | Pending |
| Diff two audits of the same system | Pending |

### Epic: Crawler Improvements

| Story | Status |
|-------|--------|
| SPA/JavaScript rendering support | Pending |
| CSS-in-JS token extraction | Pending |
| Multi-page crawl depth optimization | Pending |

---

## Listen: Unified Player

| Story | Status |
|-------|--------|
| **Replace platform-specific iframe embeds with a single custom audio player** — Consistent UI regardless of source platform | Pending |
| **Support full track playback across Spotify, SoundCloud, Apple Music, YouTube Music, Bandcamp** — All major music platforms | Pending |
| **Investigate platform APIs/SDKs for playback** — Spotify Web Playback SDK, SoundCloud Widget API, etc. | Pending |
| **DJ metadata (BPM, key, energy)** (#12) — Integrate GetSongBPM or Spotify Audio Features API for BPM, musical key, and energy level on Listen pins. Critical for DJ persona set prep workflow | Pending |
| **Related PRs** — #35, #36, #38, #40, #41 | Reference |

---

## Bulk Actions & Multi-Select

Selection model and batch operations for power users managing large collections.

> Personas: Researcher, Deep-Dive Enthusiast, DJ, Multidisciplinary Maker

| Story | Status |
|-------|--------|
| **Multi-select mode** (#34) — Long-press to enter select mode (gesture-first), tap to toggle, floating action bar for bulk delete/move/export | Pending |
| **Bulk re-enrichment** (#55) — Select multiple pins, re-run enrichment on all of them in batch | Pending |
| **Batch import from Pocket/Pinterest/Instagram** (#43) — Import existing collections via file upload or API | Pending |
| **Export to Notion/Airtable** (#40) — Export filtered collection to external tools via API or structured file | Pending |

---

## Sync & Data Integrity

Reliability improvements for cross-device sync and error handling.

> Personas: all — sync failures are invisible and affect everyone

| Story | Status |
|-------|--------|
| **Sync failure notification** (#2) — Show persistent "Changes not synced" banner on network failure with retry queue and sync status indicator | Pending |
| **Expanded card state cross-device sync** (#29) — Sync expanded/collapsed card state to Supabase so it persists across devices | Pending |
| **Bookmarklet completion** (#28) — Complete and test the save-to-boards bookmarklet for one-click capture from any browser | Pending |
| **Pin edit history / versioning** (#54) — Track edit history on pins, allow reverting to previous state | Pending |
| **Watch "Watched" toggle cross-device sync** (#76) — Persist watched/unwatched state to Supabase for cross-device consistency | Pending |

---

## Micro-Interactions & Polish

Animation, haptic, and refinement work. Low priority but improves perceived quality.

| Story | Status |
|-------|--------|
| **Card expansion reflow smoothing** (#47) — Animate card expansion on mobile to prevent layout jank | Pending |
| **Progressive image loading** (#48) — Add blur-up placeholder or skeleton screens while card images load | Pending |
| **FAB rotation animation variety** (#64) — Vary or reduce the FAB rotation animation to prevent repetition fatigue | Pending |
| **Theme toggle haptic feedback** (#65) — Add haptic response on dark/light mode toggle on supported devices | Pending |
| **Consistent slide-in direction** (#66) — Align new pin and widget entry animations for visual consistency | Pending |
| **Branded loading spinner** (#67) — Replace generic spinner with Swiss Grid-styled loading indicator | Pending |
| **Filter change animation** (#73) — Add crossfade or slide transition when switching category filters | Pending |
| **Duplicate detection URL normalization** (#74) — Normalize URLs (trailing slashes, www prefix, protocol) before duplicate checking | Pending |
| **Widget dismissal memory** (#58) — Track dismissed widgets and suppress future suggestions of the same type | Pending |
| **Category pill colors** (#78) — Allow users to customize category pill colors for visual differentiation | Pending |
| **Cleanup review card design polish** — Refine review card layout, transitions between cards, swipe gestures on mobile, empty-state illustration, and visual feedback on confirm/skip/delete actions | Pending |
| **Lookback card design polish** — Refine lookback card visual hierarchy, add entry animation, improve mini-card image treatment, context label styling, and "See all" view design | Pending |

---

## Progressive Web App & Onboarding

Deepening engagement through install prompts and discovery features.

| Story | Status |
|-------|--------|
| **PWA install prompt** (#68) — Show install prompt after repeated visits with "Add to Home Screen" flow | Pending |
| **Keyboard shortcuts reference** (#69) — Press `?` to show keyboard shortcuts overlay | Pending |
| **Unread / Read Later tracking** (#44) — Track read/unread state on article pins, filter by unread | Pending |
| ~~**Recently viewed tracking** (#57)~~ → Moved to [Phase 12: Lookback](./phase-12-lookback.md) Prerequisites (interaction tracking) | Moved |
| **Widget preference granularity** (#45) — Per-category or per-widget-type enable/disable instead of all-or-nothing | Pending |
| **Smart auto-boards** (#46) — Rule-based auto-organization (e.g. "all Nike links → Sneakers board") | Pending |
| ~~**Streaming availability notifications** (#61)~~ → Moved to [Phase 12: Lookback](./phase-12-lookback.md) Epic 12.2 (release calendar) | Moved |
| **Widget suggestion preview on hover** (#77) — Preview widget content on hover before committing to view | Pending |

---

## Visual Similarity & AI Search

Advanced content discovery features requiring ML infrastructure.

> Personas: Visual Collector, Multidisciplinary Maker, Design Technologist

| Story | Status |
|-------|--------|
| **Visual similarity search** (#17) — "Find more like this" using CLIP/image embeddings to surface visually similar pins | Pending |
| **Grid gap rounding fix** (#70) — Fix sub-pixel rounding inconsistencies at grid edges | Pending |

---

## /job — Pipeline & Career KB

Improvements flagged while shipping the /job product (PRs #633–#645). Tracked here until promoted into Phase 1+ work.

> See: [Job product PRD](../../strategy/prds/job-product.md), [Tech design](../../infrastructure/technical-design/job-product.md).

### Performance & caching

| Story | Status |
|-------|--------|
| **gen-asset KB caching** — Cache the 01-job-history + 02-goals-intents KB load per Edge Function instance (5-min TTL). Currently ~30 GitHub blob fetches on every generate call adds ~3-5s. | Pending |
| **gen-asset selective context** — Send only the companies / projects / skills relevant to the target role (matched by sector + role title) instead of the entire KB. Cuts prompt tokens by ~70%. | Pending |
| **jobs-pipe response cache** — 5-min in-memory cache so back-to-back `/job/jobs/` loads don't re-pull the sheet + GitHub tree on every navigation. | Pending |
| **kb-read response cache** — Per-path 60s LRU cache (deferred from #635 to avoid stale-after-edit issues; revisit with shared KV store). | Pending |
| **kb-manifest endpoint** — Single endpoint that returns `{ slug → route }` so the wiki-link resolver in markdown.js can drop its prefix-based heuristic. | Pending |

### Voice rules + sync

| Story | Status |
|-------|--------|
| **Auto-sync cover-letter rules** — `gen-asset/prompts.ts` mirrors `~/.claude/projects/.../memory/cover_letter_rules.md` by hand. Either pull at runtime via a public URL, or commit the rules into fikei/job and read via kb-read. | Pending |
| **Auto-sync resume voice rules** — Same problem, less acute (resume rules are shorter and changed less often). | Pending |
| **Vision-driven RELEVANCE.md sync** — When Vision is edited in /job, propagate the changes back to `~/.claude/skills/jobs/RELEVANCE.md` so the /jobs scan skill stays in sync. (Tech-design open question #2.) | Pending |

### Slug + sheet schema

| Story | Status |
|-------|--------|
| **Stable slug column** — Slugs derive from `{company}-{first-3-words-of-title}`. Renaming a role in the sheet orphans the previously-generated 03-jobs/{slug}/ files. Add an explicit `Slug` column or a stable role ID. | Pending |
| **Geo column** — Sheet has no geo signal; fit-score Geo dimension defaults neutral. Add a Location/Remote column and update fit.ts. | Pending |
| **Stage column** — Stage is currently inferred from investor names. Add an explicit Stage column for accuracy. | Pending |
| **Last-seen / first-seen columns** — PRD called for these; current sheet doesn't have them. Add so /jobs skill can detect "Not Listed" reliably. | Pending |
| **Header-driven column mapping** — jobs-pipe hardcodes the column layout (A=Status header, B=Rank, C=Status, …). Read row 1 and look up by header so the function survives a column reshuffle. | Pending |

### Per-role workflow

| Story | Status |
|-------|--------|
| **Status next-step prompts** — When a role moves to Talking, surface a small checklist (interview prep, send thank-you, decision date). When Applied, show a "follow up in N days" reminder. | Pending |
| **PDF export** — Resume + cover letter as Calibri 11pt PDFs matching the format rules in cover_letter_rules.md. Calls a typst/wkhtmltopdf-style service or generates client-side. | Pending |
| **Asset diff on regenerate** — Show a diff between current and regenerated asset before saving so the user can keep edits they already made. | Pending |
| **Per-role notes** — A free-text notes tab on the per-role detail page, stored at 03-jobs/{slug}/notes.md. | Pending |
| **Multi-vision support** — Save multiple Vision configurations (e.g. "fractional only", "founding PM only") and switch the active one to see how the pipeline reranks. | Pending |
| **Fit-score tuning UI** — Sliders to adjust the seven dimension weights, persisted in Vision. Deferred from v1. | Pending |

### Narratives

| Story | Status |
|-------|--------|
| **Persist Career Opportunities in BE** — Save AI-flagged opportunities to a `job.*` table so they survive page reload. On load, only re-audit when a new narrative (or work-history change) since the last audit could plausibly satisfy one of the open opportunities; otherwise serve the cached list. Mark opportunities `resolved` when a matching story lands. | Pending |

### Drilldown polish

| Story | Status |
|-------|--------|
| **Backlinks on company / project / skill pages** — Show incoming `[[wiki-links]]` so a project page lists the skills + wins that reference it. | Pending |
| **Edit affordance on history drilldown** — Same kb-write flow as the role detail page — Edit / Save / Cancel on company / project / skill pages. | Pending |
| **Vision view + edit** — Currently a placeholder. Reads 02-goals-intents/, sectioned editor (narrative-arc, deal-breakers, voice rules). Milestone (h) of Phase 1. | Pending |

### Operational

| Story | Status |
|-------|--------|
| **Supabase URL allow-list** (one-time config) — Add `https://ctrl.rodeo/job/**` to the Boards project's Auth → URL Configuration → Redirect URLs so sign-in returns to /job/, not /boards/. | Pending |
| **Rotate GITHUB_PAT to fine-grained PAT** — Currently using the broadly-scoped `gh auth token`. Generate a fine-grained PAT scoped to `fikei/job` only and `supabase secrets set GITHUB_PAT=<token>`. | Pending |
| **CTRL theme alternate** (Phase 1 milestone i) — Author tokens-ctrl-{light,dark}.css against the abstract token contract; enable in the rail's theme picker. | Pending |
| **Asset existence detection scaling** — jobs-pipe currently fetches the entire repo tree on every GET to compute hasResume/hasCoverLetter flags. Cache or scope to 03-jobs/. | Pending |
