# Systemic: QA + Docs Merge — Design Spec

> **Status:** Design  
> **Date:** 2026-04-10  
> **Scope:** Merge the standalone QA Variant Audit view into the Docs Viewer as a mode toggle

---

## Problem

Two separate "pick a component" UIs exist in Systemic. The **Docs viewer** has `#component-select` (hierarchical optgroups). The **QA view** has `#qa-component-filter` (flat list). Both source from the same `designSystem.components[]` array. Switching views loses component context and forces re-selection.

## Solution

Replace the standalone QA view with a **Docs | QA mode toggle** in the docs nav bar. One component dropdown drives both modes.

---

## Layout Architecture

### Nav Bar (persistent across modes)

Uses existing `.docs-nav` container (flex, `gap: var(--space-4)`, `align-items: center`).

```
┌─────────────────────────────────────────────────────────────────────────┐
│ .docs-nav                                                               │
│                                                                         │
│  .breadcrumb          .docs-nav__link(s)     .docs-nav__spacer          │
│  Systems / Acme DS  │ Color Typo Space ...                              │
│                                                                         │
│  RIGHT SIDE (after spacer):                                             │
│  ┌─────────────────┐ ┌────────────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ #component-select│ │ #variant-select│ │ .state-  │ │ .view-toggle │  │
│  │ .docs-nav__select│ │ .docs-nav__sel │ │ toggles  │ │ --mode       │  │
│  │ Component...     │ │ Variant...     │ │ ○ ◉ ◎ ◌  │ │ Docs │ QA   │  │
│  └─────────────────┘ └────────────────┘ └──────────┘ └──────────────┘  │
│                                                                         │
│  (Design|Code toggle REMOVED from nav — moves into context sidebar)     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Mode toggle** reuses `.view-toggle` + `.toggle-btn` pattern:
```html
<div class="view-toggle view-toggle--mode">
  <button class="toggle-btn active" data-mode="docs">Docs</button>
  <button class="toggle-btn" data-mode="qa">QA</button>
</div>
```

**Conditional visibility by mode:**

| Element | Docs mode | QA mode |
|---------|-----------|---------|
| `#component-select` | visible | visible |
| `#variant-select` | visible (when variants exist) | hidden |
| `.state-toggles` | visible | hidden |
| `.view-toggle` (Design/Code) | visible | hidden |
| `.qa-nav-controls` (variant filter + gridlines) | hidden | visible |
| `.view-toggle--mode` (Docs/QA) | visible | visible |

**QA nav controls** — new inline group that replaces state toggles + Design/Code toggle when QA mode is active:
```html
<div class="qa-nav-controls" hidden>
  <select class="docs-nav__select" id="qa-variant-filter-nav">
    <option value="">All variants</option>
  </select>
  <button class="btn btn--sm" id="qa-gridlines-nav">Grid lines</button>
  <span class="filter-bar__stats" id="qa-stats-nav"></span>
</div>
```

---

### Docs Mode — Content Area

Uses existing `.viewer-container` grid (`1fr var(--systemic-context-width)`).

```
┌──────────────────────────────────────┬──────────────────────────┐
│ .component-stage                     │ .context-sidebar (360px) │
│                                      │                          │
│  .showcase (20px grid bg)            │  [Design│Code] toggle    │
│  ┌──────────────────────────────┐    │  ─────────────────────   │
│  │                              │    │  Specifications          │
│  │   Component preview          │    │  Description             │
│  │   (rendered variant)         │    │  When to Use             │
│  │                              │    │  When Not to Use         │
│  └──────────────────────────────┘    │  Accessibility           │
│                                      │  Detected States         │
│                                      │                          │
│                                      │  ─── OR (Code tab) ───  │
│                                      │  Tokens                  │
│                                      │  CSS                     │
│                                      │  HTML                    │
│                                      │  React                   │
└──────────────────────────────────────┴──────────────────────────┘
```

**Change:** Design/Code toggle moves from nav bar into the sidebar header. This frees nav space and keeps the toggle co-located with the content it controls.

---

### QA Mode — Content Area

Replaces `.component-stage` + `.context-sidebar` with a single full-width QA container.

```
┌─────────────────────────────────────────────────────────────────────┐
│ .qa-inline (full width of .viewer-container, grid-column: 1 / -1)   │
│                                                                     │
│  ┌─ #usage-inspector-inline ──────────────────────────────────────┐ │
│  │ 3 instances across 2 sources                                   │ │
│  │ ├─ crawl: homepage (2x)                                        │ │
│  │ └─ figma: card-grid (1x)                                       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  .qa-variant-grid (flex column, gap: var(--space-6))                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ .qa-variant-item--sm (200px)                                 │   │
│  │ .qa-variant-label                                            │   │
│  │ ┌─────────┐                                                  │   │
│  │ │ 🟢 sm    │ .qa-variant-actions (opacity: 0 → 1 on hover)  │   │
│  │ │         │ [Prefer] [Comment] [Block]                       │   │
│  │ └─────────┘                                                  │   │
│  │ .qa-variant-preview                                          │   │
│  │ ┌──────────────────┐                                         │   │
│  │ │                  │                                         │   │
│  │ │  rendered widget │                                         │   │
│  │ │                  │                                         │   │
│  │ └──────────────────┘                                         │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ .qa-variant-item--med (420px)                                │   │
│  │ 🟡 med  [1 comment]                    [Prefer] [Comment]   │   │
│  │ ┌────────────────────────────────────┐                       │   │
│  │ │                                    │                       │   │
│  │ │  rendered widget                   │                       │   │
│  │ │                                    │                       │   │
│  │ └────────────────────────────────────┘                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  .qa-blocked-toggle                                                 │
│  ▶ Blocked (1) ──────────────────────────────────────               │
│                                                                     │
│  .qa-grid-test-section                                              │
│  Grid Size Permutations                                             │
│  [5 col] [4 col] [3 col] [Grid lines]                              │
│  ┌────┬────┬────┬────┬────┐                                        │
│  │    │    │    │    │    │                                         │
│  └────┴────┴────┴────┴────┘                                        │
│                                                                     │
│  .qa-audit-output                                                   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ component │ size │ status │ note        [Export] [Clear]     │   │
│  │ card      │ sm   │ 🟢     │                                  │   │
│  │ card      │ med  │ 🟡     │ needs review                     │   │
│  │ card      │ lg   │ 🔴     │ deprecated                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CSS Token Usage

All new styles compose existing design system tokens. No new tokens introduced.

### New Classes

| Class | Purpose | Tokens Used |
|-------|---------|-------------|
| `.view-toggle--mode` | Distinguishes Docs/QA toggle from Design/Code toggle | Inherits all `.view-toggle` styles |
| `.qa-inline` | Full-width QA container inside `.viewer-container` | `grid-column: 1 / -1` |
| `.qa-nav-controls` | Inline group for QA-specific nav controls | `display: flex; gap: var(--space-3)` |

### Modified Classes

| Class | Change | Reason |
|-------|--------|--------|
| `.viewer-container` | No change — `.qa-inline` uses `grid-column: 1 / -1` to span both columns | Avoids modifying the grid definition |
| `.qa-container` | Removed (standalone QA view eliminated) | Content moves into `.qa-inline` |

---

## Interaction States

### Component Selection Flow
```
User selects from #component-select
  ↓
app.selectComponentGlobal(type)
  ├─ Persists to localStorage: selected-component:{systemId}
  ├─ If docs mode: viewer.selectComponent(comp)
  ├─ If qa mode: variantAudit.showVariants()
  └─ Always: usageInspector.show(comp)
```

### Mode Toggle Flow
```
User clicks [QA] toggle button
  ↓
app.componentViewMode = 'qa'
  ├─ .toggle-btn.active swaps
  ├─ .component-stage hidden = true
  ├─ .context-sidebar hidden = true
  ├─ .qa-inline hidden = false
  ├─ .state-toggles hidden = true
  ├─ .view-toggle (Design/Code) hidden = true
  ├─ .qa-nav-controls hidden = false
  └─ If selectedComponentType: variantAudit.showVariants()
```

### Deep Link Routing
```
#docs/component/button      → docs mode, button selected
#docs/qa/button              → qa mode, button selected
#qa/button (legacy)          → redirects to #docs/qa/button
```

---

## Component Data Flow

```
designSystem.components[]
  │
  ├─ app.renderDocsNav()
  │   └─ Builds #component-select with <optgroup> hierarchy
  │       Groups: Components | Widget Atoms | Widget Molecules | Templates
  │
  ├─ viewer.load(designSystem)
  │   └─ Stores designSystem for selectComponent() rendering
  │
  └─ variantAudit.registerFromDesignSystem(designSystem)
      └─ Builds this.components[] with variant/size metadata
          (NO LONGER populates its own dropdown — uses global #component-select)
```

---

## Persistence

| Key | Value | Scope |
|-----|-------|-------|
| `selected-component:{systemId}` | Component type string | Per-system, survives refresh |
| `component-view-mode:{systemId}` | `'docs'` or `'qa'` | Per-system, survives refresh |
| `variant-audit:{systemId}` | Audit entries (flags, notes, preferred) | Per-system (unchanged) |

---

## Migration: What Gets Removed

1. **`#qa-view` section** in `index.html` (lines 284-330) — entire standalone view
2. **`<a href="#qa">QA</a>` nav link** — replaced by toggle button
3. **`#qa-component-filter`** — replaced by global `#component-select`
4. **`populateFilters()` in variant-audit.js** — no longer needed
5. **`#qa` route handling** in app.js — redirects to `#docs/qa/...`
6. **`.qa-header`** — description text moves into nav stats area
7. **`.qa-container .filter-bar`** — controls move into nav bar

## What Stays Unchanged

- All variant-audit.js audit logic (flags, notes, comments, preferred, export)
- All QA CSS for variant items, stoplight badges, blocked state, context menu
- Grid test section
- Audit table
- Usage inspector (just re-mounted)
