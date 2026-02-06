# Backlog: Future Considerations

> Back to [Project Plan](./index.md)

---

## Pin Expansion

Everything related to supporting multiple pin types, organized by epic. The Pin Type Abstraction epic is the prerequisite — start there before building any new pin type.

> See: [Core Systems Architecture](../../infrastructure/technical-design/core-systems-architecture.md) for the enrichment extensibility model.

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
| AI image generation for missing thumbnails | Pending |
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

## Accessibility

| Story | Status |
|-------|--------|
| High contrast mode | Pending |
| Reduced motion option | Pending |
| Screen reader optimization | Pending |
| Focus indicators | Pending |
