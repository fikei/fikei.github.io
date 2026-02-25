# Project Plan - ctrl.rodeo

> Single source of truth for all features, stories, and tasks.
> **Last Updated**: 2026-02-23 (PR #143: TF-IDF board suggestions, board_metadata, link tags, GENRE_NORMALIZE expansion)

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
| [Phase 12: Lookback](./phase-12-lookback.md) | IN PROGRESS | 34/236 |
| [Backlog](./backlog.md) | Future | 1/102 |

---

## Recent Milestones

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
| Phase 12: Lookback | 34 | 0 | 197 | 5 |
| Backlog | 1 | 0 | 100 | 0 |
| **TOTAL** | **343** | **5** | **1225** | **9** |

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
