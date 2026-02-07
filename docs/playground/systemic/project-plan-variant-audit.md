# Project Plan — Systemic Variant Audit

**PRD:** [Variant Audit PRD](prd-variant-audit.md)
**Status:** Planning
**Last Updated:** 2026-02-07

---

## Phase 1: Extract & Modularize

Extract the working prototype from `design-system/widgets.html` into standalone modules that can run inside Systemic.

### Epic 1.1: CSS Extraction

- **Story 1: Extract variant audit styles into `systemic/css/variant-audit.css`**
  - Task 1: Extract all `.variant-*` classes from `widgets.html` `<style>` block — Pending
  - Task 2: Extract `.variant-ctx-menu*` context menu styles — Pending
  - Task 3: Extract `.variant-comment*` inline comment styles — Pending
  - Task 4: Extract `.variant-stoplight*` stoplight indicator styles — Pending
  - Task 5: Extract `.variant-blocked*` blocked section styles — Pending
  - Task 6: Extract `.variant-grid--gridlines` grid overlay styles — Pending
  - Task 7: Extract `.audit-table*` audit log table styles — Pending
  - Task 8: Replace hardcoded colors with CTRL design token variables — Pending
  - Task 9: Verify styles work when loaded alongside `systemic.css` — Pending

### Epic 1.2: JavaScript Extraction

- **Story 2: Create `systemic/js/variant-audit.js` module**
  - Task 1: Extract audit state CRUD (`loadAudit`, `saveAudit`, `getAuditEntry`, `setFlag`, `setNote`, `setProcessed`) — Pending
  - Task 2: Extract status computation (`getStatus`, `STATUS_LABELS`, `SIZE_LABELS`, `ALL_SIZES`) — Pending
  - Task 3: Extract variant rendering (`buildVariantItem`, `showVariants`) — Pending
  - Task 4: Extract grid management (`reflowVariant`, `toggleBlockedSection`, `updateBlockedToggle`) — Pending
  - Task 5: Extract context menu (`showContextMenu`, `closeContextMenu`, `toggleBlock`) — Pending
  - Task 6: Extract comment system (`openComment`, `closeComment`, `updateNoteIndicator`) — Pending
  - Task 7: Extract audit table (`renderAuditTable`, `exportAudit`, `clearAudit`) — Pending
  - Task 8: Extract stats and filtering (`updateStats`, `filterSections`) — Pending
  - Task 9: Extract state persistence (`saveFilterState`, `restoreFilterState`) — Pending
  - Task 10: Wrap in a `VariantAudit` class with a public API — Pending

- **Story 3: Define the public API**
  - Task 1: Define constructor: `new VariantAudit({ container, components, onExport })` — Pending
  - Task 2: Define component registration: `audit.register(name, element, axes)` — Pending
  - Task 3: Define programmatic methods: `audit.show(name)`, `audit.getReport()`, `audit.clearAll()` — Pending
  - Task 4: Emit custom events for state changes (`audit:block`, `audit:comment`, `audit:approve`) — Pending

### Epic 1.3: HTML Extraction

- **Story 4: Create audit view markup in `systemic/index.html`**
  - Task 1: Add `#qa` route section to Systemic's view container — Pending
  - Task 2: Add component/template filter dropdowns (populated dynamically) — Pending
  - Task 3: Add variant toolbar (grid lines toggle, stats counter) — Pending
  - Task 4: Add active variant grid container — Pending
  - Task 5: Add blocked section with toggle button — Pending
  - Task 6: Add audit log output container — Pending
  - Task 7: Add nav link for "QA" alongside existing Audit/Systems/Docs — Pending

### Epic 1.4: Verify Extraction

- **Story 5: Prototype still works after extraction**
  - Task 1: Update `widgets.html` to import extracted CSS/JS instead of inline — Pending
  - Task 2: Verify all interactions (block, unblock, comment, process, approve) — Pending
  - Task 3: Verify audit state persistence across refresh — Pending
  - Task 4: Verify grid overlay on both active and blocked grids — Pending
  - Task 5: Verify export produces correct JSON — Pending

---

## Phase 2: Systemic Integration

Wire the extracted module into Systemic's existing architecture.

### Epic 2.1: Route & View Management

- **Story 6: Add QA view to Systemic app**
  - Task 1: Add `#qa` hash route in `app.js` `handleNavigation()` — Pending
  - Task 2: Add view toggle logic (show/hide QA section) — Pending
  - Task 3: Add "QA" nav item in Systemic header — Pending
  - Task 4: Handle deep links (e.g., `#qa/watch-deadline`) — Pending

### Epic 2.2: Component Discovery

- **Story 7: Auto-populate component list from design system**
  - Task 1: Scan loaded design system for component types (from Systemic's ComponentConsolidator output) — Pending
  - Task 2: Populate widget dropdown with discovered components — Pending
  - Task 3: Detect variant axes from component class names (e.g., `--sm`, `--lg` → size axis) — Pending
  - Task 4: Populate template dropdown from detected variant groups — Pending
  - Task 5: Fall back to manual axis definition if auto-detection fails — Pending

- **Story 8: Support CTRL widget components specifically**
  - Task 1: Register all 15 CTRL widget sizes as the size axis — Pending
  - Task 2: Register 8 CTRL widget templates as the template axis — Pending
  - Task 3: Pre-populate widget dropdown with CTRL widget catalog — Pending

### Epic 2.3: Audit State Namespacing

- **Story 9: Namespace audit data per design system**
  - Task 1: Prefix localStorage key with design system ID: `variant-audit:{systemId}` — Pending
  - Task 2: Scope filter state per system: `filter-state:{systemId}` — Pending
  - Task 3: Handle migration from legacy un-namespaced keys — Pending
  - Task 4: Add system selector to QA view when multiple systems loaded — Pending

### Epic 2.4: Viewer Integration

- **Story 10: Connect audit status to Systemic's existing component viewer**
  - Task 1: Show stoplight dot next to component names in viewer sidebar — Pending
  - Task 2: Show audit summary (N blocked, N to process) in viewer header — Pending
  - Task 3: Add "Open in QA" button from viewer to jump to `#qa/{component}` — Pending

---

## Phase 3: Generalization

Make the audit tool work with any component library, not just CTRL widgets.

### Epic 3.1: Generic Variant Rendering

- **Story 11: Support arbitrary component variant generation**
  - Task 1: Accept component definitions as `{ name, element, axes }` — Pending
  - Task 2: Render variants by applying axis values via class swapping — Pending
  - Task 3: Render variants by applying axis values via CSS variable overrides — Pending
  - Task 4: Render variants by applying axis values via data attributes — Pending
  - Task 5: Support custom render functions for complex axis application — Pending

- **Story 12: Multi-axis variant matrix**
  - Task 1: UI for selecting which axes to cross (e.g., size × state) — Pending
  - Task 2: Generate matrix of all combinations — Pending
  - Task 3: Render matrix as a 2D grid (rows = axis 1, columns = axis 2) — Pending
  - Task 4: Limit combinatorial explosion (max 50 variants per view) — Pending

### Epic 3.2: Custom Axis Definition

- **Story 13: Manual axis editor**
  - Task 1: UI for adding custom axes (name + values) — Pending
  - Task 2: Persist axis definitions in design system data — Pending
  - Task 3: Map axis values to CSS class patterns (e.g., `btn--{value}`) — Pending
  - Task 4: Support axis value aliases (e.g., "small" → `--sm`) — Pending

### Epic 3.3: Import External Components

- **Story 14: Load components from external sources**
  - Task 1: Accept raw HTML + CSS as component input — Pending
  - Task 2: Render in sandboxed iframe for style isolation — Pending
  - Task 3: Support loading components from a URL (via Systemic's existing CORS proxy) — Pending

---

## Phase 4: Export & CI Integration

### Epic 4.1: Export Formats

- **Story 15: Expanded export capabilities**
  - Task 1: JSON export (existing — verify schema) — Pending
  - Task 2: CSV export for spreadsheet workflows — Pending
  - Task 3: Markdown export for documentation (table format) — Pending
  - Task 4: YAML export for CI config files — Pending

### Epic 4.2: CI/CD Gate

- **Story 16: Blocked variant enforcement**
  - Task 1: Define `.systemic-audit.json` config file format — Pending
  - Task 2: CLI script to check if blocked variants exist in production CSS — Pending
  - Task 3: GitHub Action that reads audit export and fails if violations found — Pending
  - Task 4: Document CI setup in Systemic README — Pending

---

## Phase 5: Collaboration & AI

### Epic 5.1: Shared Audit State

- **Story 17: Persist audit state to Supabase**
  - Task 1: Create `audit_entries` table in Systemic Supabase project — Pending
  - Task 2: Sync localStorage ↔ Supabase on load/save — Pending
  - Task 3: Handle conflict resolution (last-write-wins) — Pending
  - Task 4: Add user attribution to comments — Pending

### Epic 5.2: AI-Assisted Auditing

- **Story 18: Auto-detect broken variants**
  - Task 1: Screenshot each variant using html2canvas or similar — Pending
  - Task 2: Detect text overflow, truncation, empty states — Pending
  - Task 3: Auto-flag variants that fail heuristic checks (yellow status) — Pending
  - Task 4: Generate suggested comment text for flagged variants — Pending

---

## Dependencies

| Dependency | Required By | Status |
|------------|-------------|--------|
| CTRL Design System tokens (`tokens.css`) | Phase 1 | Available |
| Systemic app shell (`app.js`) | Phase 2 | Available |
| ComponentConsolidator output format | Phase 2 | Available |
| Systemic Supabase project (`atdqdfpdeytfuvvpsasz`) | Phase 5 | Available |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Combinatorial explosion (100+ variants) | Performance, UX overwhelm | Cap at 50 variants per view, paginate |
| Style leakage from host page into variants | Incorrect rendering | Sandboxed rendering, CSS reset per variant |
| localStorage limits (~5MB) | Data loss for large audits | Namespace + prune old entries, Supabase sync |
| Multi-user conflict on shared audits | Lost comments | Last-write-wins with conflict UI in Phase 5 |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-07 | Initial project plan |
