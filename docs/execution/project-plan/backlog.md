# Backlog: Future Considerations

> Back to [Project Plan](./index.md)
>
> Items are derived from [Brand Positioning](../../strategy/brand-positioning.md) and [User Personas](../../ux/personas.md). Persona tags indicate which personas a feature primarily serves.

---

## Taste & Pattern Intelligence

Surfaces connections and patterns in what users collect. Directly supports brand principle #1: **Input shapes output.**

> Personas: Visual Collector, Sound & Scene Curator, DJ, Researcher, Cultural Omnivore

| Story | Status |
|-------|--------|
| **Taste profile** — Auto-generated summary of what a user collects most (domains, categories, content types) | Pending |
| **"You save a lot of X" insights** — Surface collection patterns via widget or dashboard card | Pending |
| **Trend detection** — Identify emerging themes across recent saves (e.g. "3 brutalist architecture links this week") | Pending |
| **Cross-category connections** — Surface related pins across categories ("these pins share a theme") | Pending |
| **Collection timeline** — Visual timeline of saves over time, filterable by category | Pending |
| **Monthly digest widget** — Auto-generated summary of that month's curation activity | Pending |

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

## SystemicAI

Design system analyzer and documentation generator.

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

---

## Progressive Web App & Onboarding

Deepening engagement through install prompts and discovery features.

| Story | Status |
|-------|--------|
| **PWA install prompt** (#68) — Show install prompt after repeated visits with "Add to Home Screen" flow | Pending |
| **Keyboard shortcuts reference** (#69) — Press `?` to show keyboard shortcuts overlay | Pending |
| **Unread / Read Later tracking** (#44) — Track read/unread state on article pins, filter by unread | Pending |
| **Recently viewed tracking** (#57) — Track which pins were recently opened/visited, show as a filter or view | Pending |
| **Widget preference granularity** (#45) — Per-category or per-widget-type enable/disable instead of all-or-nothing | Pending |
| **Smart auto-boards** (#46) — Rule-based auto-organization (e.g. "all Nike links → Sneakers board") | Pending |
| **Streaming availability notifications** (#61) — Notify when a Watch pin becomes available on a subscribed streaming service | Pending |
| **Widget suggestion preview on hover** (#77) — Preview widget content on hover before committing to view | Pending |

---

## Visual Similarity & AI Search

Advanced content discovery features requiring ML infrastructure.

> Personas: Visual Collector, Multidisciplinary Maker, Design Technologist

| Story | Status |
|-------|--------|
| **Visual similarity search** (#17) — "Find more like this" using CLIP/image embeddings to surface visually similar pins | Pending |
| **Grid gap rounding fix** (#70) — Fix sub-pixel rounding inconsistencies at grid edges | Pending |
