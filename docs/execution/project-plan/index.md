# Project Plan - ctrl.rodeo

> Single source of truth for all features, stories, and tasks.
> **Last Updated**: 2026-02-09 (Full audit — all branches merged, counts reconciled)

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
| [Phase 3: AI Intelligence](./phase-3-ai-intelligence.md) | IN PROGRESS | 151/413 |
| [Phase 4: Sharing & Collaboration](./phase-4-sharing-collaboration.md) | IN PROGRESS | 11/140 |
| [Phase 5: UX Polish](./phase-5-ux-polish.md) | Pending | 3/60 |
| [Phase 6: Performance & Scale](./phase-6-performance.md) | Pending | 1/15 |
| [Phase 7: Platform Expansion](./phase-7-platform-expansion.md) | Pending | 0/17 |
| [Phase 8: Automated Pin Creation](./phase-8-automated-pins.md) | Pending | 0/54 |
| [Phase 9: Bulk Import](./phase-9-bulk-import.md) | Pending | 0/132 |
| [Phase 10: Image Validation & Enrichment](./phase-10-image-validation.md) | IN PROGRESS | 47/102 |
| [Backlog](./backlog.md) | Future | 1/110 |

---

## Recent Milestones

### Add Pin Stability ✅
**Completed: 2026-02-09 | Verified: 2026-02-13**

- **3 bugs fixed**: UUID generation for link IDs, missing apikey header on categorize, image_scores column removed from sync payload
- **2 edge functions**: `validate-image` deployed, `categorize` redeployed with `--no-verify-jwt`
- **Improved error logging**: `syncLinkToSupabase()` now logs response body on failure
- **Still open**: Migration 007 (image_scores columns) not yet applied; allorigins.win CORS proxy intermittent

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
**Completed: 2026-02-09**

- **Standalone events aggregator** at `/events/index.html`
- ScreenSlate JSON API integration with day/week calendar views
- Location filtering, source filtering with status chips, error handling

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
| Phase 3: AI Intelligence | 151 | 4 | 257 | 0 |
| Phase 4: Sharing & Collaboration | 11 | 1 | 128 | 0 |
| Phase 5: UX Polish | 3 | 0 | 57 | 0 |
| Phase 6: Performance | 1 | 0 | 14 | 0 |
| Phase 7: Platform Expansion | 0 | 0 | 11 | 0 |
| Phase 8: Automated Pins | 0 | 0 | 54 | 0 |
| Phase 9: Bulk Import | 0 | 0 | 132 | 0 |
| Phase 10: Image Validation | 47 | 0 | 55 | 0 |
| Backlog | 1 | 0 | 108 | 0 |
| **TOTAL** | **253** | **5** | **816** | **0** |

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
| Run migration `007_image_validation.sql` against Supabase (Phase 10) | Supabase Dashboard → SQL Editor | Human |
| Deploy `enrich-link` edge function with Tier 2 validation (Phase 10) | `supabase functions deploy enrich-link` | Human |
| ~~Deploy new `validate-image` edge function for Tier 3 (Phase 10)~~ | ~~`supabase functions deploy validate-image`~~ | ~~Done 2026-02-09~~ |
| ~~Verify `ANTHROPIC_API_KEY` is set in Supabase function secrets (Phase 10)~~ | ~~Confirmed working — categorize returns 200~~ | ~~Done 2026-02-13~~ |
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
