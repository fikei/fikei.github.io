# Project Plan - ctrl.rodeo

> Single source of truth for all features, stories, and tasks.
> **Last Updated**: 2026-08-21 (Added Phase 18: Agape Family Dinners — spec)

---

## How to Use This Document

- **Epics**: Major feature areas (collapsible sections)
- **Stories**: User-facing functionality with clear value
- **Tasks**: Specific implementation steps with checkboxes
- **Status**: Complete | In Progress | Pending | Blocked

---

## Phase Overview

| Phase | Status | Progress |
|-------|--------|----------|
| [Phase 1: Foundation](./phase-1-foundation.md) | SHIPPED | 24/24 |
| [Phase 2: Core Experience](./phase-2-core-experience.md) | SHIPPED | 15/15 |
| [Phase 3: AI Intelligence](./phase-3-ai-intelligence.md) | IN PROGRESS | 192/560 |
| [Phase 4: Sharing & Collaboration](./phase-4-sharing-collaboration.md) | IN PROGRESS | 11/140 |
| [Phase 5: UX Polish](./phase-5-ux-polish.md) | Pending | 3/60 |
| [Phase 6: Performance & Scale](./phase-6-performance.md) | Pending | 1/15 |
| [Phase 7: Platform Expansion](./phase-7-platform-expansion.md) | IN PROGRESS | 21/38 |
| [Phase 8: Automated Pin Creation](./phase-8-automated-pins.md) | Pending | 0/54 |
| [Phase 9: Bulk Import](./phase-9-bulk-import.md) | Pending | 0/132 |
| [Phase 10: Image Validation & Enrichment](./phase-10-image-validation.md) | IN PROGRESS | 68/126 |
| [Phase 11: Instagram Import](./phase-11-instagram-import.md) | Pending | 0/73 |
| [Phase 12: Lookback](./phase-12-lookback.md) | IN PROGRESS | 47/249 |
| [Phase 13: Boards React Rewrite](./phase-13-react-rewrite.md) | Pending | 0/272 |
| [Phase 14: Gmail → Jobs Pipe](./phase-14-gmail-jobs-pipe.md) | IN PROGRESS | 0/73 |
| [Phase 15: Gmail Application Tracker](./phase-15-gmail-application-tracker.md) | IN PROGRESS | 23/25 |
| [Phase 16: Ladder Easy Apply](./phase-16-easy-apply.md) | Pending | 0/40 |
| [Phase 17: Program Listings & DJ Residency](./phase-17-program-listings.md) | Pending | 0/48 |
| [Phase 18: Agape Family Dinners](./phase-18-family-dinners.md) | Spec | 0/22 |
| [Backlog](./backlog.md) | Future | 1/118 |

---

## Recent Milestones

### Recruiting — Agape family dinners (spec)
**Added: 2026-08-21** — Phase 18 filed from [PRD: Agape family dinners](/docs/strategy/prds/agape-family-dinners.md). The quarterly family-dinner Google Sheet becomes a Dinners view in the triage app: 5-role weekly signup grid, guests + can't-make-it RSVPs, quotas prorated from `recruit_stays`, Discord Sunday summary + head-chef nag. Access gated on Agape guild resident/subletter roles (new `is_house_member` flag on `user_discord_membership`). Tech design: [family-dinners.md](/docs/infrastructure/technical-design/family-dinners.md).

### Recruiting — program listings & DJ residency (planned)
**Added: 2026-08-21** — Phase 17 filed from [PRD: Program Listings & the DJ Residency](/docs/strategy/prds/agape-program-listings.md). `recruit_listings` becomes a general program-listing engine (draft → open → filled/closed, application deadline, fee, public slug); open program listings surface on the /apply "Kind of stay" step and branch the question flow; $20 Stripe Payment Link gates review; Haiku first-pass scoring makes ~1,000-application triage feasible; finalists reuse the existing vote → interview → stay machinery (`recruit_stays kind='dj_resident'`). Draft listings are a general soft-launch concept for future programs.

### Recruiting — native application form (/apply) with applicant login
**Shipped: 2026-08-20** — the Agape application moves off Google Forms onto ctrl.rodeo/apply: Typeform-style one-question-per-screen flow on the Sassy design system, email-OTP login as question one so every answer autosaves server-side, and applications stay editable until the house decides. Sheet-era applicants signing in with the same email claim their existing row. Soft launch: unlisted URL, sheet ingest still live as fallback. Details: [story-native-apply-form.md](./story-native-apply-form.md)
- Versions: apply v1.0.0 (new), applications v3.76.0→v3.77.0, recruit-ingest v1.6.0→v1.7.0, migration 170

### Ladder — ATS boards (job-radar) source + two-track grading
**Shipped: 2026-08-06** — the `/job-radar` skill's local ATS sweep (~64 outdoor/soft-goods boards, first-party APIs only) now feeds Ladder as a peer of the Gmail source. `push_to_ladder.py` → `ats-radar-ingest` → `job.ats_radar_scans` staging → `ats-radar` source plugin through the normal pull-recommendations stack (gate, dedupe, Haiku grading, bullets). Liveness honors the skill's prime directive: only boards verified this scan can close recs; unverified boards surface as a Sources-row health note, never as "no openings". Track A (production soft goods — PLM / product developer / equipment design leadership / senior sourcing) added to /ladder/vision/ Targets with its own titles, framing, and ~$70k comp floor; grading measures each role against its own track instead of averaging.
- Versions: ladder v2.40.2→v2.41.0, pull-recommendations v0.30.4→v0.31.0, recommendations v0.22.1→v0.23.0, add-role v0.7.0→v0.7.1, ats-radar-ingest v1.0.0 (new), migration 165
- Trigger is manual for v1 (push script at the end of each `/job-radar` run); scheduling deliberately deferred — the sweep itself is local-only.

### Ladder — For You Quality Floors & Wildcards
**Shipped: 2026-07-02** — PRs #984, #986, #989, #991, #993, #994. Candidate-score floor raised 30→50; floored view (fit ≥ 50, candidate ≥ 50, no hard fails; ungraded hidden as pending) is default with "show all" toggle. Wildcards strip (candidate≥65, fit<50) pressure-tests search criteria. Pre-save rec detail page (single rec lookup, fit/strength breakdowns, Save/Dismiss). Wellfound sender fix (domain-suffix match). Badge truthfulness + dismissed roles dedup.
- Versions: ladder v2.13.0→v2.14.2, recommendations v0.14.0→v0.15.0-merged, pull-recommendations v0.23.1→v0.25.1
- Flooring impact: ~90% of For You roles now hidden by default (candidate<50)

### Gmail → Jobs Pipe — Phase 1 Shipped
**Updated: 2026-05-10** — Phase 1 narrowed to recs-only after schema collision with existing `job.companies` (career history). Canonical-URL enrichment carved out into Phase 1.5.

- **Phase 1 (shipped)**: Gmail OAuth via `gmail-auth` (Option B split, shared `_shared/google-tokens.ts`), `user_google_tokens` keyed by `(user_id, scope_set)`, `GmailJobsSource` plugin with sender allowlist + Haiku extraction + digest skip-and-log, `job.gmail_skipped` audit, `job.gmail_scan_state` cursor. Roles emit with the aggregator URL (LinkedIn / Wellfound / Otta) — user clicks through to the listing page for JD + apply.
- **Phase 1.5 (next)**: Canonical-URL enrichment via `enrich-job-source` + `job.hiring_companies` cache. Brief: [gmail-jobs-pipe-phase-1-5-enrichment.md](/docs/strategy/prds/gmail-jobs-pipe-phase-1-5-enrichment.md). `enrich-job-source` function and the cache table design already exist on disk; Phase 1.5 is plumbing them in.
- **Phase 2 (deferred)**: contacts graph, LinkedIn CSV upload, network overlay, paid enrichment APIs.

### Systemic v2 — Planned
**Added: 2026-04-10** — 16 stories filed from [PRD: Systemic v2](/docs/strategy/prds/systemic-v2.md)

- **Track 1 — Three Input Sources**: URL crawl (existing), Figma/Paper design files, and production code (GitHub repo or local path) as equal-weight entry points; file + line attribution for code source
- **Track 2 — Lifelike Component State Rendering**: Multi-state examples (hover, focus, error, disabled, etc.) rendered side-by-side with contextual placeholder content; replaces the static "Examples" section
- **Track 3 — Component Usage Inspector**: Drill-down view showing every instance of a component type across the source; right-side drawer with rendered preview, syntax-highlighted source, surrounding context, and variant classification
- **Filed to**: Backlog (SystemicAI section, new Systemic v2 epics)

### Boards React Rewrite — Planned
**Added: 2026-03-05** — Phase 13 filed from [PRD: Boards React Rewrite](/docs/strategy/prds/boards-react-rewrite.md)

- **5 sub-phases (R1–R5)** covering Foundation → Core Display → Capture & CRUD → Auth/Sharing/Advanced → Hardening
- **Security fixes in R1**: `fetch-metadata` edge function (eliminates CORS proxy URL leakage), extended `classify` function (eliminates client-side Anthropic API key exposure)
- **Platform migration**: 20,040-line monolith → React 18 + TypeScript 5.x + Vite on Cloudflare Pages
- **Data layer**: 16+ localStorage keys replaced by Dexie.js (IndexedDB) with typed schema and migration utility
- **DNS cutover at R5**: `ctrl.rodeo/boards/` moves from GitHub Pages to Cloudflare Pages; monolith archived

### Create a Board — Infrastructure Sprint ⚡
**Completed: 2026-02-23** — PR #143

- **TF-IDF `PinRanker` module** — vector-space ranking replaces broken substring matching for library suggestions; corpus IDF from all links, cosine similarity per pin, domain + category affinity bonuses
- **`board_metadata` table** — Supabase persistence for user-created board metadata (`019_board_metadata.sql`); `saveBoardMetadata()` client function; RLS-protected
- **Unified `tags TEXT[]` column** on `links` table — `computeLinkTags(link)` derives tags from genre/category/domain metadata; GIN index for fast queries (`020_link_tags.sql`)
- **Expanded `GENRE_NORMALIZE` map** — 19 video genre synonyms + 22 music genre synonyms for richer tag computation
- Migrations `019` and `020` still need to be run against Boards Supabase project (see Blocked Items)

### Visual Standards System ✅
**Completed: 2026-02-14**

- **Three-layer framework** for image quality and aesthetics (`visual-standards.ts`)
- **Layer 0 — Product Gate**: synchronous URL pattern + technical checks, wired into enrich-link at all scrape checkpoints
- **Layer 1 — Content Type Standards**: per-type framing/anti-pattern definitions for all 9 content types
- **Layer 2 — Category Aesthetics**: per-category palette/mood/texture/lighting/compositions for all 9 categories
- **Digital product safeguards**: product type scoped to physical items, tool type rejects product-shot framing
- **generate-widget integration**: category aesthetic context injected into AI prompts

### Quick Capture Tools ✅
**Completed: 2026-02-13**

- **Mobile quick-add bar** — always-visible URL input on mobile, paste button, auto-submit
- **Deep linking** — `?add=URL` query param for universal link capture
- **PWA Share Target** — Boards appears in mobile share sheets (manifest + service worker)
- **Bookmarklet** — drag-to-install for one-click desktop capture
- **Tools modal** — centralized access to all capture methods + PWA install
- **Image scanning** — Claude Vision API extracts products/brands/URLs from photos

### Listen Category ✅
**Completed: 2026-02-09**

- **9th category** splitting music out of `watch` — keywords, domains, sub-tags
- **Music metadata extraction** via oEmbed APIs + og:music scraping (9/12 fields)
- **2 new widgets**: Sound Shelf (album art grid), Listen Next (AI listening queue)
- **watch→listen migration** for existing pins

### Runtime Design Constraint Engine ✅
**Completed: 2026-02-09**

- **`boards/design-constraints.js`** — validates widgets against design system at runtime
- Loads manifest + registry, exposes `validate()`, `auditDOM()`, `annotate()` APIs

### Events Page ✅
**Completed: 2026-02-09 | Updated: 2026-02-14**

- **Standalone events aggregator** at `/events/index.html`
- ScreenSlate JSON API integration with day/week calendar views
- Location filtering, source filtering with status chips, error handling
- **Resident Advisor** — GraphQL API scraper (`eventListings` query, ~72 events/area)
- **Gary's Guide** — Tech/startup events (SF + NYC, ~63 events/region via table parsing)
- **Bonobo Network** — Social/community events (SF, ~8 events via Squarespace JSON)
- **Tech & Social content types** with keyword detection
- **Multi-source dedup tags** — events from multiple sources show separate color-coded tags
- **Edge function POST proxy** — `fetch-source` supports custom method/body/headers for GraphQL

### Brand Positioning & Persona Framework ✅
**Completed: 2026-02-08**

- **Tagline**: "Your likes. Your saves. Your life — organized."
- **5 brand principles**, **8 named personas**, **persona-to-feature matrix**
- See [Brand Positioning](../../strategy/brand-positioning.md) and [User Personas](../../ux/personas.md)

### Widget Phase 2.5a: Design System Transition ⚡
**Started: 2026-02-07** — **~90% complete**

- All 11 template renderers migrated to `w-*` classes (including 4 new: comparison, choices, checklist, grouped)
- Design system manifest, template registry, self-scan in Systemic
- Config-driven AI prompts + server-side validation (class allowlist)
- Runtime constraint engine, Systemic QA enhancements
- **Remaining**: CI validation pipeline, visual diff screenshots

### Widget Phases 0-2 ✅
**Completed: 2026-02-05**

- **21 widget configs** across all categories, **11 template types**
- Config-driven eligibility, confidence scoring, template selection engine
- SERP API integration, client instrumentation, hot-reload registry

See [Phase 3: AI Intelligence](./phase-3-ai-intelligence.md#epic-33-generative-widget-ecosystem) for full details.

---

## Summary Statistics

| Category | Complete | In Progress | Pending | Blocked |
|----------|----------|-------------|---------|---------|
| Phase 1: Foundation | 24 | 0 | 0 | 0 |
| Phase 2: Core Experience | 15 | 0 | 0 | 0 |
| Phase 3: AI Intelligence | 192 | 4 | 360 | 4 |
| Phase 4: Sharing & Collaboration | 11 | 1 | 128 | 0 |
| Phase 5: UX Polish | 3 | 0 | 57 | 0 |
| Phase 6: Performance | 1 | 0 | 14 | 0 |
| Phase 7: Platform Expansion | 21 | 0 | 17 | 0 |
| Phase 8: Automated Pins | 0 | 0 | 54 | 0 |
| Phase 9: Bulk Import | 0 | 0 | 132 | 0 |
| Phase 10: Image Validation | 68 | 0 | 58 | 0 |
| Phase 11: Instagram Import | 0 | 0 | 73 | 0 |
| Phase 12: Lookback | 47 | 0 | 197 | 5 |
| Phase 13: React Rewrite | 0 | 0 | 272 | 0 |
| Backlog | 1 | 0 | 116 | 0 |
| **TOTAL** | **356** | **5** | **1513** | **9** |

---

## Generative Widget Ecosystem Roadmap

| Phase | Name | Automation | Status |
|-------|------|------------|--------|
| 0 | Deterministic MVP | Very Low | ~95% Complete |
| 1 | Rule-Driven Automation | Low→Medium | **COMPLETE** |
| 2 | Config-Generated Widgets | Medium→High | **COMPLETE** |
| 2.5a | Design System Transition | Medium→High | **IN PROGRESS** ⚡ |
| 2.5b | Rules-Based Widget Catalog | Medium→High | Pending (blocked by 2.5a) |
| 3 | Self-Selecting Widgets | High | Pending |
| 4 | Self-Optimizing System | Full | Pending |

---

## Blocked Items

| Item | Blocker | Owner |
|------|---------|-------|
| Push notifications | FCM/APNs setup required | Human |
| Run migration `019_board_metadata.sql` (Phase 3, Epic 3.7) | Supabase Dashboard → SQL Editor | Human |
| Run migration `020_link_tags.sql` (Phase 3, Epic 3.7) | Supabase Dashboard → SQL Editor | Human |
| Run migration `016_categorization_cleanup.sql` (Phase 3, Epic 3.6) | Supabase Dashboard → SQL Editor | Human |
| Run migration `017_lookback_prerequisites.sql` (Phase 12) | Supabase Dashboard → SQL Editor | Human |
| Run migration `018_lookback_external.sql` (Phase 12, Epic 12.2) | Supabase Dashboard → SQL Editor | Human |
| Add `RESEND_API_KEY` for digest emails (Phase 12, Epic 12.2) | Supabase Dashboard → Edge Functions → Secrets | Human |
| Run migration `007_image_validation.sql` against Supabase (Phase 10) | Supabase Dashboard → SQL Editor | Human |
| Deploy `enrich-link` edge function with Tier 2 validation (Phase 10) | `supabase functions deploy enrich-link` | Human |
| Deploy new `validate-image` edge function for Tier 3 (Phase 10) | `supabase functions deploy validate-image` | Human |
| Verify `ANTHROPIC_API_KEY` is set in Supabase function secrets (Phase 10) | Dashboard → Edge Functions → Secrets | Human |
| Backfill Tier 1 scores for existing pins via console script (Phase 10) | Run `imageQualityReport()` after deploy to baseline | Human |

---

## Needs Decision

| Item | Options | Impact |
|------|---------|--------|
| Collaborative pricing model | Free vs premium tiers | Revenue, feature gating |
| Mobile app platform | iOS first vs cross-platform | Development timeline |
| Analytics provider | Privacy-friendly options | User trust, compliance |

---

*This document consolidates: BACKLOG.md, PROJECT-STATUS.md, sprint.md, shipped.md, and all docs/execution/ plans.*
