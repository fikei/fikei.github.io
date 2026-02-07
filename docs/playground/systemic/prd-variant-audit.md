# Product Requirements Document

## Systemic — Variant Audit

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-02-07
**Depends On:** Systemic Design System Analyzer (existing), CTRL Widget Design System

---

## 1. Executive Summary

Systemic currently crawls external websites to extract and document design systems. Variant Audit extends Systemic from **discovery** ("what components exist") to **governance** ("which variants should ship"). It provides a designer-led QA workflow where AI generates every possible component variant, and the designer audits, comments on, and blocks the ones that shouldn't exist.

This feature is currently prototyped inside `design-system/widgets.html` as an embedded tool. This PRD defines how to extract, generalize, and integrate it as a first-class Systemic feature.

### Core Principles

1. **Generate-then-filter** — AI produces exhaustive variants; designers curate the subset that ships
2. **Stoplight governance** — Every variant has a visible status (green/yellow/orange/red) so nothing slips through
3. **System-agnostic** — Works with any component library, not just CTRL widgets
4. **Non-destructive** — Audit state is additive metadata; it never modifies source components

---

## 2. Problem Statement

Design systems grow organically. Components acquire size variants, state combinations, and template permutations that nobody explicitly approved. Without governance:

- Variants that look broken in certain grid sizes ship to production
- Design debt accumulates as unused variants persist
- There's no record of _why_ a variant was blocked or what the designer wanted changed
- No workflow to track comment → action → review cycles between designers and developers

### Current State (Prototype)

The prototype in `widgets.html` proves the concept but has limitations:

| Aspect | Prototype | Target |
|--------|-----------|--------|
| Scope | CTRL widgets only | Any design system |
| Variant axis | Grid sizes (15 sizes) | Sizes + states + themes + breakpoints |
| Storage | localStorage | Systemic DB (localStorage + export) |
| Integration | Standalone page | Systemic viewer mode |
| Collaboration | Single user | Export/import audit reports |

---

## 3. Feature Specification

### 3.1 Variant Matrix Generation

Given a component, generate every valid variant by crossing its axes:

```
Component: w-shell (widget container)
├── Size axis:      sm, med, wide, banner, tall, lg, xl, pano, col, poster, max, cinema, board, wall, full
├── Template axis:  choices, comparison, grouped, list, narrative, spectrum, suggestion, verdict
├── State axis:     default, loading, error, empty, overflow
└── Theme axis:     dark, light (if applicable)

Total variants = |sizes| × |templates| × |states| × |themes|
```

The system should:
- Auto-detect axes from the component's CSS classes and data attributes
- Allow manual axis definition for custom components
- Support filtering to a subset of axes (e.g., "show all sizes for this template")
- Render each variant at its natural dimensions

### 3.2 Stoplight Status System

Every variant carries a four-state stoplight:

| Status | Color | Meaning | Trigger |
|--------|-------|---------|---------|
| **Green** | `#22c55e` | No updates needed | Default state, or after approval |
| **Yellow** | `#eab308` | To process | Designer adds a comment |
| **Orange** | `#f97316` | Needs review | Developer marks comment as processed |
| **Red** | `#ef4444` | Blocked | Designer blocks variant from shipping |

**Lifecycle:**

```
                     ┌─────────────────────────┐
                     │                         │
    ┌──────┐   comment   ┌────────┐   process   ┌────────┐   approve   ┌───────┐
    │ GREEN ├───────────►│ YELLOW ├────────────►│ ORANGE ├───────────►│ GREEN │
    └──┬───┘            └───┬────┘             └───┬────┘            └───────┘
       │                    │                      │
       │ block              │ block                │ block
       ▼                    ▼                      ▼
    ┌──────┐            ┌──────┐               ┌──────┐
    │ RED  │            │ RED  │               │ RED  │
    └──┬───┘            └──────┘               └──────┘
       │
       │ unblock
       ▼
    ┌──────┐
    │ GREEN │
    └──────┘
```

### 3.3 Audit Interactions

**Right-click context menu** on any variant:

| Action | When Available | Effect |
|--------|---------------|--------|
| Block | Not blocked | Dims to 20%, shows "Blocked" overlay, moves to blocked section |
| Unblock | Blocked | Returns to active grid in sorted position |
| Add comment | No comment exists | Opens inline textarea |
| Edit comment | Comment exists | Opens inline textarea with existing text |
| Mark processed | Status is yellow | Advances to orange (developer acted on feedback) |
| Approve | Status is orange | Clears comment, returns to green |

**Comment system:**
- Inline textarea appears at bottom of variant card
- Auto-saves on blur or Escape
- Editing a processed comment resets status to yellow
- Comment text shown as tooltip on badge and in audit log

### 3.4 Blocked Variant Separation

Active variants and blocked variants live in separate grids:

```
┌─────────────────────────────────────────────┐
│ Variant Audit                               │
│ widget-name (template) — 12 active, 3       │
│ blocked. Right-click for options.           │
│                                             │
│ [Grid lines]                  2 to process  │
├─────────────────────────────────────────────┤
│                                             │
│ ● sm (1x1)                              [1]│
│ ┌──────────────────────┐                    │
│ │  [widget rendered     │                   │
│ │   at 200px]           │                   │
│ └──────────────────────┘                    │
│                                             │
│ ● med (2x1)                                │
│ ┌──────────────────────────────────────┐    │
│ │  [widget rendered at 420px]          │    │
│ └──────────────────────────────────────┘    │
│                                             │
│ ...more active variants...                  │
│                                             │
│ ┌─────────────────────────────────────┐     │
│ │ Show 3 blocked                      │     │
│ └─────────────────────────────────────┘     │
│                                             │
│ (collapsed blocked variants)                │
│                                             │
├─────────────────────────────────────────────┤
│ AUDIT LOG                                   │
│ Widget    Size   Grid  Status      Note     │
│ name      sm     1x1   ● Blocked           │
│ name      wide   3x1   ● To process  "..." │
└─────────────────────────────────────────────┘
```

### 3.5 Grid Overlay

A print-design-style grid overlay spans across all variant cards:

- 12-column grid with 1px vertical lines at `calc(100% / 12)` intervals
- 40px baseline grid with horizontal lines
- Toggled via toolbar button
- Applies to both active and blocked grids
- Helps designers assess alignment and rhythm across variants

### 3.6 Audit Log & Export

The audit log table shows all variants with non-green status:

**Columns:** Component, Size, Grid, Status (with stoplight dot), Note

**Export formats:**
- **JSON** — Machine-readable for CI/CD integration
- **Clipboard** — One-click copy

**JSON export schema:**
```json
[
  {
    "name": "watch-deadline",
    "size": "wide",
    "grid": "3x1",
    "status": "blocked",
    "note": "Content overflows at this width"
  },
  {
    "name": "watch-deadline",
    "size": "sm",
    "grid": "1x1",
    "status": "to-process",
    "note": "Needs tighter line-height"
  }
]
```

### 3.7 Section Filtering

When a component or template is selected:
- Hide unrelated sections (layouts, priority examples, grid test beds)
- Show only atoms and molecules used by the selected component
- If widget + template combination has no match, fall back to the most recently changed filter with an alert banner

### 3.8 State Persistence

| Data | Storage | Key |
|------|---------|-----|
| Audit entries (flags, notes, processed) | localStorage | `widget-variant-audit` |
| Filter selections, blocked section state | localStorage | `widget-filter-state` |

Both persist across page refresh and browser sessions.

---

## 4. Systemic Integration Plan

### 4.1 New Systemic View: Audit Mode

Add a fourth view to Systemic's hash-based routing:

| View | Hash | Purpose |
|------|------|---------|
| Systems List | `#systems` | Browse saved design systems |
| Website Audit | `#audit` | Crawl and extract |
| Documentation | `#docs` | View generated docs |
| **Variant Audit** | **`#qa`** | **QA component variants** |

### 4.2 Data Flow

```
Systemic Crawler → Component Detection → Variant Matrix → Audit UI
                                              ↓
                                     Audit State (localStorage)
                                              ↓
                                     Export (JSON / CI config)
```

### 4.3 File Structure (Target)

```
systemic/
├── js/
│   ├── app.js                      # Add #qa route + view management
│   ├── variant-audit.js            # NEW — extracted audit engine
│   │   ├── VariantAudit class
│   │   │   ├── state management (load/save/get/set)
│   │   │   ├── status computation (getStatus)
│   │   │   ├── variant rendering (buildVariantItem)
│   │   │   ├── grid management (reflow, blocked section)
│   │   │   ├── context menu
│   │   │   ├── comment system
│   │   │   ├── audit table + export
│   │   │   └── filter state persistence
│   │   └── Exports: VariantAudit
│   └── ... (existing files unchanged)
├── css/
│   ├── systemic.css                # Existing
│   └── variant-audit.css           # NEW — extracted audit styles
└── index.html                      # Add #qa section markup
```

### 4.4 Generalization Requirements

To work with any design system (not just CTRL widgets):

1. **Component registry** — Accept component definitions as `{ name, element, axes: { size: [...], state: [...], theme: [...] } }`
2. **Variant renderer** — Clone component, apply axis values via class/attribute/CSS variable swapping
3. **Axis detection** — Auto-detect axes from CSS classes (e.g., `btn--sm`, `btn--lg` → size axis)
4. **Custom axes** — Allow users to define arbitrary axes (e.g., brand, density, locale)
5. **Audit namespace** — Prefix audit keys with design system ID to support multi-system audits

---

## 5. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Variant coverage | 100% | All size/template combos generated |
| Audit adoption | >50% | Variants with non-green status after first session |
| Export usage | Weekly | JSON exports downloaded or copied |
| Status cycle time | <48h | Yellow → Orange → Green turnaround |
| Zero blocked variants in prod | 100% | CI checks audit export before deploy |

---

## 6. Future Extensions

| Extension | Description | Phase |
|-----------|-------------|-------|
| CI/CD gate | Block deploys if blocked variants exist in production code | Phase 2 |
| Diff view | Show before/after when a variant changes between runs | Phase 2 |
| Multi-axis matrix | Cross size × state × theme in a single view | Phase 2 |
| Figma sync | Push audit status back to Figma component variants | Phase 3 |
| AI suggestions | Auto-flag variants that look broken (overflow, truncation) | Phase 3 |
| Team collaboration | Share audit state via Supabase, resolve conflicts | Phase 3 |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-07 | Initial PRD — extracted from widgets.html prototype |
