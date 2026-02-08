# Project Plan - Boards

> Single source of truth for all features, stories, and tasks.
> **Last Updated**: 2026-02-07 (Widget Phase 2 COMPLETE, Phase 2.5a IN PROGRESS, Phases 8 & 9 planned)

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
| [Phase 1: Foundation](./phase-1-foundation.md) | SHIPPED | 18/18 |
| [Phase 2: Core Experience](./phase-2-core-experience.md) | SHIPPED | 12/12 |
| [Phase 3: AI Intelligence](./phase-3-ai-intelligence.md) | IN PROGRESS | ~113/370 |
| [Phase 4: Sharing & Collaboration](./phase-4-sharing-collaboration.md) | IN PROGRESS | 8/90 |
| [Phase 5: UX Polish](./phase-5-ux-polish.md) | Pending | 3/70 |
| [Phase 6: Performance & Scale](./phase-6-performance.md) | Pending | 1/27 |
| [Phase 7: Platform Expansion](./phase-7-platform-expansion.md) | Pending | 0/17 |
| [Phase 8: Automated Pin Creation](./phase-8-automated-pins.md) | Pending | 0/65 |
| [Phase 9: Bulk Import](./phase-9-bulk-import.md) | Pending | 0/105 |
| [Phase 10: Image Validation & Enrichment](./phase-10-image-validation.md) | Pending | 0/102 |
| [Backlog](./backlog.md) | Future | 0/83 |

---

## Recent Milestones

### Widget Phase 2.5a: Design System Transition ⚡
**Started: 2026-02-07**

- **Design System Manifest**: `manifest.json` generated from CSS (12 atoms, 8 molecules, 11 body modifiers, 15 sizes)
- **Template Registry**: `template-registry.json` maps 10 canonical templates to Boards implementations
- **Self-Scan**: Systemic loads local design system without crawling
- **Template Migration**: All 7 Boards renderers migrated from `widget-*` to `w-*` classes
- **Design System Extensions**: Added `w-items`, `w-item`, `w-body--stats`, `w-divider__label`; updated marker, header, suggestion layout
- **Token Bridge**: Boards `:root` maps DS token names to Boards values (visual parity preserved)
- **Next**: Visual verification → legacy CSS cleanup → config-driven AI prompts → CI validation

### Widget Phase 2: Config-Generated Widgets ✅
**Completed: 2026-02-05**

- **Widget Definition Schema**: TypeScript types in `config/schema.ts`
- **Config-Driven Eligibility**: Rules defined declaratively, not in code
- **Registry as Data**: `config/registry.ts` with runtime evaluators
- **Two Widgets Migrated**: `complete-the-look`, `style-summary`
- **180+ lines removed**: Hard-coded eligibility logic replaced with config
- **Template Selection Engine**: Auto-select + fallback chain
- **Hot-reload**: registerWidget() / unregisterWidget() / reloadWidget()

### Widget Phase 1: Rule-Driven Automation ✅
**Completed: 2026-02-05**

- **Eligibility Engine**: Widgets must pass rules to render
- **Confidence Scoring**: AI returns 0.0-1.0 confidence, threshold gates rendering
- **Validation Engine**: Track success/failure for optimization
- **SERP API Integration**: Reliable image fallback strategy
- **Client Instrumentation**: Event tracking for views, clicks, dismissals

See [Phase 3: AI Intelligence](./phase-3-ai-intelligence.md#epic-33-generative-widget-ecosystem) for full details.

---

## Summary Statistics

| Category | Complete | In Progress | Pending | Blocked |
|----------|----------|-------------|---------|---------|
| Phase 1: Foundation | 18 | 0 | 0 | 0 |
| Phase 2: Core Experience | 12 | 0 | 0 | 0 |
| Phase 3: AI Intelligence | 113 | 3 | 253 | 0 |
| Phase 4: Sharing & Collaboration | 8 | 8 | 72 | 2 |
| Phase 5: UX Polish | 3 | 0 | 67 | 0 |
| Phase 6: Performance | 1 | 0 | 26 | 0 |
| Phase 7: Platform Expansion | 0 | 0 | 17 | 0 |
| Phase 8: Automated Pins | 0 | 0 | 65 | 0 |
| Phase 9: Bulk Import | 0 | 0 | 105 | 0 |
| Phase 10: Image Validation | 0 | 0 | 102 | 0 |
| Backlog | 0 | 0 | 83 | 0 |
| **TOTAL** | **155** | **11** | **790** | **2** |

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
| Email invitations for collaborative boards | Resend API setup required | Human |
| Push notifications | FCM/APNs setup required | Human |

---

## Needs Decision

| Item | Options | Impact |
|------|---------|--------|
| Collaborative pricing model | Free vs premium tiers | Revenue, feature gating |
| Mobile app platform | iOS first vs cross-platform | Development timeline |
| Analytics provider | Privacy-friendly options | User trust, compliance |

---

*This document consolidates: BACKLOG.md, PROJECT-STATUS.md, sprint.md, shipped.md, and all docs/execution/ plans.*
