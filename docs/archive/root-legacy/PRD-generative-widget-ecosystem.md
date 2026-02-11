# Product Requirements Document

## Scalable Generative Widget Ecosystem
### Automation-First Phased Rollout (Boards Project)

**Version:** 1.3
**Status:** Active - Phase 0 In Progress
**Last Updated:** 2026-02-03
**Implementation:** Claude Code (Boards repository)

---

## 1. Executive Summary

The objective is to build a fully automated generative widget ecosystem inside the Boards project. The system should autonomously determine:

- Which widgets should exist
- What content populates them
- How they are structured
- How they render consistently across platforms
- How they improve over time

This document reframes the original MVP as a multi-phase automation roadmap, where each phase removes manual configuration, hard-coded logic, and human intervention. The end state is a system that is **category-agnostic**, **content-type-agnostic**, **template-optional**, and **continuously self-optimizing**.

The MVP begins with the `wear` category, but no phase introduces assumptions that would block expansion to other domains.

---

## 2. Automation Philosophy

Automation is introduced progressively across four dimensions:

| Dimension | Description |
|-----------|-------------|
| **Decision Automation** | The system decides whether a widget should exist at all |
| **Data Automation** | The system determines which content populates each widget |
| **Structure Automation** | The system selects layouts, components, and hierarchy |
| **Optimization Automation** | The system learns and improves without manual tuning |

Each phase increases autonomy across all four dimensions while preserving debuggability and design system integrity.

---

## 3. Phase Overview

| Phase | Name | Automation Level | Status |
|-------|------|------------------|--------|
| **0** | Deterministic MVP | Very Low | 🔧 In Progress |
| **1** | Rule-Driven Automation | Low to Medium | 📋 Planned |
| **2** | Config-Generated Widgets | Medium to High | 📋 Planned |
| **3** | Self-Selecting Widgets | High | 📋 Planned |
| **4** | Self-Optimizing System | Full | 📋 Planned |

---

## 4. Phase 0 – Deterministic MVP (Baseline)

### Purpose
Establish the complete end-to-end pipeline with minimal automation and maximum control.

### System Characteristics
- Only the `wear` category is supported
- Exactly two widgets exist: **Complete the Look** and **Style Definition**
- Widgets are always generated when basic conditions are met
- Templates and layouts are explicitly chosen
- Content grouping follows static heuristics

### Manual Elements
- Widget types are predefined
- Widget order is fixed
- Design templates are selected by humans
- No confidence or relevance scoring

### Outcome
A stable but brittle system that proves feasibility and serves as the control case for automation.

> This phase exists solely to validate architecture and cross-platform rendering.

### Implementation Status (as of 2026-02-03)

#### What's Built
- [x] Edge Function (`generate-widget`) with Claude 3 Haiku
- [x] Widget Registry pattern (client-side)
- [x] Multi-zone layout (hero, inline, footer)
- [x] Client + server caching
- [x] **Complete the Look** widget (active)
- [ ] **Style Definition** widget (not started)

#### What's Working
- [x] AI generates complementary suggestions (not variants)
- [x] Brand validation prevents hallucinations
- [x] Brand-category constraints (Bellroy can't suggest belts)
- [x] JSON parsing handles AI preamble text
- [x] Per-widget refresh (isolated state)

#### What's Broken
- [ ] **Image scraping blocked** - Bot protection on brand sites
- [ ] Need SERP API or alternative image source

#### Key Learnings (Inform Future Phases)

| Issue | Root Cause | Lesson for Automation |
|-------|------------|----------------------|
| AI suggests variants not complements | Prompt ambiguity | Constraints must be ABSOLUTE, not suggestive |
| Unsupported brands leak through | AI ignores soft constraints | Server-side validation required at every phase |
| Image scraping unreliable | Bot protection varies by brand | Need pluggable strategies with health tracking |
| JSON parsing failures | AI adds preamble | Always extract, never trust raw response |
| Widget duplication | Global state pollution | Per-widget state isolation is critical |

---

## 5. Phase 1 – Rule-Driven Automation

### Purpose
Automate widget eligibility and data population using explicit rules.

### What Becomes Automated
- Widgets are generated **conditionally** rather than by default
- Content inclusion becomes automatic
- Relevance and confidence thresholds are introduced

### System Behavior
- The system evaluates available content and determines which widgets qualify
- Widgets can **fail eligibility** and not render
- Confidence scores influence widget inclusion

### What Remains Manual
- Widget definitions are still human-authored
- Layouts and component structures are fixed
- Category logic is still explicit

### Outcome
> Widgets must "earn" existence.

The system begins making decisions, but only within narrow, predefined boundaries.

### Prerequisites from Phase 0
- [ ] Validation Engine operational (track what works)
- [ ] Widget feedback collection (what do users click?)
- [ ] Confidence scoring in AI responses

### Key Deliverables
- [ ] Widget eligibility rules (min items, category match, content quality)
- [ ] Confidence threshold system (0.0-1.0 scores)
- [ ] Widget suppression (don't show low-confidence widgets)
- [ ] Eligibility logging (why did widget appear/not appear?)

---

## 6. Phase 2 – Config-Generated Widgets

### Purpose
Remove hard-coded widget logic and move generation rules into configuration.

### What Becomes Automated
- Widget eligibility is defined **declaratively**
- Categories are no longer hard-coded
- Template selection is automated
- Widget constraints are machine-readable

### System Behavior
- Widgets are generated from **configuration, not code**
- Adding a new widget type no longer requires logic changes
- The same system supports multiple categories without branching

### Human Role
- Humans define capabilities and constraints
- Humans no longer decide when widgets appear
- Humans no longer write widget-specific logic

### Outcome
> The system transitions from "coded widgets" to "described widgets."

This is the first phase where the system **scales horizontally**.

### Key Deliverables
- [ ] Widget Definition Schema (declarative format)
- [ ] Category-agnostic widget matching
- [ ] Template selection engine
- [ ] Widget registry becomes data, not code

### Example Widget Definition (Target Format)
```yaml
widget:
  id: complete-the-look
  version: 2.0

  eligibility:
    min_items: 2
    categories: [wear]  # Later: inferred, not listed
    content_types: [product]
    confidence_threshold: 0.7

  generation:
    model: claude-3-haiku
    prompt_template: prompts/complete-the-look.md
    constraints:
      - no_same_category_as_input
      - supported_brands_only
      - max_suggestions: 4

  enrichment:
    strategies: [shopify_api, serp_api, placeholder]
    timeout_ms: 5000

  rendering:
    zone: inline
    template: two-column-suggestions
    fallback: text-only
```

---

## 7. Phase 3 – Self-Selecting Widgets

### Purpose
Enable the system to decide which widget types are most relevant, without being explicitly told.

### What Becomes Automated
- Widget **type** selection
- Widget prioritization and ordering
- Widget suppression when value is low

### System Behavior
- The system generates multiple **candidate widgets**
- Widgets compete based on confidence and relevance
- Only the strongest widgets are rendered
- Different boards may show different widget mixes

### Human Role
- Humans define design system boundaries
- Humans set global guardrails, not widget logic

### Outcome
> The system behaves like a curator rather than a renderer.

Widgets are no longer guaranteed, and **absence becomes a meaningful signal**.

### Key Deliverables
- [ ] Widget candidate generation (propose N widgets)
- [ ] Ranking system (confidence × relevance × novelty)
- [ ] Slot allocation (limited screen real estate)
- [ ] A/B testing framework for widget selection

---

## 8. Phase 4 – Self-Optimizing System

### Purpose
Enable continuous improvement without manual tuning.

### What Becomes Automated
- Threshold adjustment
- Layout and component selection optimization
- Widget lifecycle management

### System Behavior
- The system learns which widgets perform well
- Poor-performing widgets degrade or disappear
- Strong widget patterns reinforce themselves
- New widget forms can emerge within constraints

### Human Role
- Define success metrics
- Monitor system health
- Update design system primitives as needed

### Outcome
> The widget ecosystem becomes adaptive, resilient, and largely self-governing.

At this stage, humans design the system, not the widgets.

### Key Deliverables
- [ ] Engagement tracking (clicks, saves, dismissals)
- [ ] Automated threshold tuning
- [ ] Widget lifecycle states (emerging, stable, deprecated)
- [ ] Anomaly detection (widget suddenly failing)

---

## 9. Design System Role Across Phases

Throughout all phases, the design system remains:

- The **single source of truth**
- **Immutable at runtime**
- The **constraint boundary** for all generation

> Automation never bypasses the design system.
> Instead, automation operates entirely within its rules.

This ensures:
- Brand consistency
- Platform parity
- Safe generative behavior

---

## 10. Risks and Safeguards

### Primary Risks
| Risk | Mitigation |
|------|------------|
| Loss of predictability | Confidence thresholds, decision logging |
| Widget sprawl | Slot limits, quality gates |
| Design drift | Design system as hard constraint |
| Performance degradation | Timeout budgets, graceful degradation |

### Safeguards
- Confidence thresholds at every phase
- Versioned templates
- Strict constraint enforcement
- Observable decision logs
- Validation Engine tracking what works

---

## 11. End State Vision

At full maturity, the system:

- Accepts **arbitrary content**
- Infers **meaning and relevance**
- Generates **appropriate widgets**
- Selects **optimal structures**
- Learns from **outcomes**
- Requires **minimal human input**

> The system is no longer a widget renderer.
> It is a **generative presentation layer for meaning**.

---

## 12. Appendix: Infrastructure Dependencies

These systems support all phases and should be built as foundational infrastructure:

| System | Purpose | PRD Status |
|--------|---------|------------|
| **Validation Engine** | Track what works, auto-disable failures | P0 in backlog |
| **Taste Profiling** | Personalize without filter bubbles | P1 in backlog |
| **Brand Intelligence** | Centralized brand knowledge | Story in backlog |
| **Image Pipeline** | Pluggable image resolution strategies | Story in backlog |
| **Widget Feedback** | Collect user signals | Built (basic) |

---

## 13. Success Metrics by Phase

| Phase | Primary Metric | Target |
|-------|---------------|--------|
| 0 | Widget renders correctly | 100% of eligible boards |
| 1 | Widget relevance | >70% user engagement |
| 2 | New widget creation time | <1 hour (config only) |
| 3 | Widget mix optimization | +20% engagement vs static |
| 4 | Self-correction | <24h to adapt to failures |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | - | Initial PRD |
| 1.2 | - | Reworked for full automation |
| 1.3 | 2026-02-03 | Added implementation status, key learnings, infrastructure dependencies |
