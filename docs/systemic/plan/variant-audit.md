# Project Plan — Systemic Variant Audit

**PRD:** [Variant Audit PRD](prd-variant-audit.md)
**Status:** In Progress
**Last Updated:** 2026-02-07

---

## Phase 1: Extract & Modularize ✅

Extracted working prototype from `design-system/widgets.html` into standalone modules inside Systemic.

### Epic 1.1: CSS Extraction ✅

- **Story 1: Extract variant audit styles into `systemic/css/variant-audit.css`** — Complete
  - Extracted all variant, context menu, comment, stoplight, blocked, grid, and audit table styles
  - Renamed classes from `.variant-*` to `.qa-*` namespace
  - Replaced print-design grid overlay with Systemic viewer's 20px grid background
  - Verified styles load alongside `systemic.css` and `viewer.css`

### Epic 1.2: JavaScript Extraction ✅

- **Story 2: Create `systemic/js/variant-audit.js` module** — Complete
  - All audit state CRUD, status computation, variant rendering, grid management, context menu, comment system, audit table, stats, and filter persistence extracted
  - Wrapped in `VariantAudit` class with public API

- **Story 3: Define the public API** — Complete
  - Constructor: `new VariantAudit({ container, systemId, onToast })`
  - Registration: `registerComponents(...)`, `registerFromDesignSystem(ds)`
  - Methods: `show(name)`, `getReport()`, `clearAudit()`, `init()`
  - Namespaced localStorage: `variant-audit:{systemId}`, `variant-filter:{systemId}`

### Epic 1.3: HTML Extraction ✅

- **Story 4: Create audit view markup in `systemic/index.html`** — Complete
  - `#qa-view` section with toolbar, filters, grids, blocked section, audit output
  - QA nav link in header
  - Route handling in `app.js` with deep link support (`#qa/{component}`)

### Epic 1.4: Verify Extraction

- **Story 5: Prototype still works after extraction**
  - Task 1: Update `widgets.html` to import extracted CSS/JS instead of inline — Deferred (keeping inline for now as independent prototype)
  - Task 2: Verify all interactions in Systemic QA view — Pending
  - Task 3: Verify audit state persistence across refresh — Pending
  - Task 4: Verify grid overlay on both active and blocked grids — Pending
  - Task 5: Verify export produces correct JSON — Pending

---

## Phase 2: Navigation & App Shell

Fix navigation gaps, add system context awareness, and make the app usable end-to-end.

### Epic 2.1: System Context Header

The biggest nav gap: once you open a system, there's no indication of which system you're viewing, no way to switch, and no shared context across Docs/QA views.

- **Story 6: Add system context bar below header**
  - Task 1: Add a secondary header bar that shows when a system is loaded — Pending
  - Task 2: Show system name + URL + date scanned — Pending
  - Task 3: Add system switcher dropdown (populated from saved systems) — Pending
  - Task 4: Persist selected system ID in URL hash or localStorage — Pending
  - Task 5: When system changes, update both Viewer and QA with new data — Pending
  - Task 6: Show empty state when no system loaded (with "Run a scan" CTA) — Pending

- **Story 7: Unify system loading across views**
  - Task 1: Extract system loading into a shared `loadSystem(id)` method — Pending
  - Task 2: `loadSystem()` calls `viewer.load()` + `variantAudit.registerFromDesignSystem()` — Pending
  - Task 3: Store `currentSystemId` on app instance — Pending
  - Task 4: Auto-load last-used system on page load — Pending

### Epic 2.2: Route State Persistence

Refresh loses component selection. Bookmarks break. Fix the router.

- **Story 8: Full route persistence on refresh**
  - Task 1: Store last-visited hash in localStorage per system — Pending
  - Task 2: On page load, if system exists but no hash, restore last hash — Pending
  - Task 3: When navigating to `#docs` with no section, show system overview instead of defaulting to color — Pending
  - Task 4: Ensure `#docs/component/{type}` restores the correct component after refresh — Pending

- **Story 9: System overview landing page**
  - Task 1: Create a system overview panel shown at `#docs` (no sub-route) — Pending
  - Task 2: Show system stats: token count, component count, variant count — Pending
  - Task 3: Show coverage summary from QA audit (if data exists) — Pending
  - Task 4: List recently viewed components — Pending

### Epic 2.3: Cross-View Linking

Docs and QA are disconnected. Each view should link to the other.

- **Story 10: Link Docs → QA**
  - Task 1: Add "QA this component" button in Docs viewer context sidebar — Pending
  - Task 2: Button navigates to `#qa/{component-type}` — Pending
  - Task 3: Show stoplight dot next to component names in Docs sidebar — Pending

- **Story 11: Link QA → Docs**
  - Task 1: Add "View in Docs" link in QA variant label context menu — Pending
  - Task 2: Link navigates to `#docs/component/{type}` — Pending

### Epic 2.4: Collapsible Sidebar

Context sidebar takes 360px permanently. Sidebar nav hidden on mobile.

- **Story 12: Collapsible context sidebar (Docs view)**
  - Task 1: Add collapse/expand toggle button to sidebar header — Pending
  - Task 2: Collapsed state: sidebar shrinks to 48px, shows icons only — Pending
  - Task 3: Persist collapsed state in localStorage — Pending
  - Task 4: Keyboard shortcut to toggle (e.g., `]`) — Pending

- **Story 13: Mobile component navigation**
  - Task 1: Replace hidden sidebar with slide-out drawer on < 900px — Pending
  - Task 2: Add hamburger toggle button in stage header — Pending
  - Task 3: Drawer overlays content, closes on selection or outside click — Pending
  - Task 4: Component search works in drawer mode — Pending

### Epic 2.5: Header Nav Cleanup

- **Story 14: Rationalize header navigation**
  - Task 1: Add Audit as a proper nav link (currently only "Run a scan" button) — Pending
  - Task 2: Visually distinguish active view more clearly (underline or bottom border) — Pending
  - Task 3: Disable Docs and QA nav links when no system is loaded (show tooltip "Load a system first") — Pending
  - Task 4: Move "Run a scan" into nav or make it a secondary action — Pending

---

## Phase 3: Systemic Integration

Wire the extracted module into Systemic's existing architecture.

### Epic 3.1: Component Discovery

- **Story 15: Auto-populate component list from design system**
  - Task 1: Scan loaded design system for component types (from ComponentConsolidator output) — Pending
  - Task 2: Populate QA dropdown with discovered components — Pending
  - Task 3: Detect variant axes from component class names (e.g., `--sm`, `--lg` → size axis) — Pending
  - Task 4: Populate template dropdown from detected variant groups — Pending
  - Task 5: Fall back to manual axis definition if auto-detection fails — Pending

- **Story 16: Support CTRL widget components specifically**
  - Task 1: Register all 15 CTRL widget sizes as the size axis — Pending
  - Task 2: Register 10 CTRL widget templates as the template axis — Pending
  - Task 3: Pre-populate widget dropdown with CTRL widget catalog — Pending

### Epic 3.2: Audit State Namespacing

- **Story 17: Namespace audit data per design system**
  - Task 1: Prefix localStorage key with design system ID: `variant-audit:{systemId}` — Complete
  - Task 2: Scope filter state per system: `variant-filter:{systemId}` — Complete
  - Task 3: Handle migration from legacy un-namespaced keys — Pending
  - Task 4: Add system selector to QA view when multiple systems loaded — Pending

### Epic 3.3: Viewer Integration

- **Story 18: Connect audit status to Systemic's existing component viewer**
  - Task 1: Show stoplight dot next to component names in viewer sidebar — Pending
  - Task 2: Show audit summary (N blocked, N to process) in viewer header — Pending
  - Task 3: Add "Open in QA" button from viewer to jump to `#qa/{component}` — Pending (see Story 10)

---

## Phase 4: Generalization

Make the audit tool work with any component library, not just CTRL widgets.

### Epic 4.1: Generic Variant Rendering

- **Story 19: Support arbitrary component variant generation**
  - Task 1: Accept component definitions as `{ name, element, axes }` — Pending
  - Task 2: Render variants by applying axis values via class swapping — Pending
  - Task 3: Render variants by applying axis values via CSS variable overrides — Pending
  - Task 4: Render variants by applying axis values via data attributes — Pending
  - Task 5: Support custom render functions for complex axis application — Pending

- **Story 20: Multi-axis variant matrix**
  - Task 1: UI for selecting which axes to cross (e.g., size × state) — Pending
  - Task 2: Generate matrix of all combinations — Pending
  - Task 3: Render matrix as a 2D grid (rows = axis 1, columns = axis 2) — Pending
  - Task 4: Limit combinatorial explosion (max 50 variants per view) — Pending

### Epic 4.2: Custom Axis Definition

- **Story 21: Manual axis editor**
  - Task 1: UI for adding custom axes (name + values) — Pending
  - Task 2: Persist axis definitions in design system data — Pending
  - Task 3: Map axis values to CSS class patterns (e.g., `btn--{value}`) — Pending
  - Task 4: Support axis value aliases (e.g., "small" → `--sm`) — Pending

### Epic 4.3: Import External Components

- **Story 22: Load components from external sources**
  - Task 1: Accept raw HTML + CSS as component input — Pending
  - Task 2: Render in sandboxed iframe for style isolation — Pending
  - Task 3: Support loading components from a URL (via existing CORS proxy) — Pending

---

## Phase 5: Export & CI Integration

### Epic 5.1: Export Formats

- **Story 23: Expanded export capabilities**
  - Task 1: JSON export (existing — verify schema) — Pending
  - Task 2: CSV export for spreadsheet workflows — Pending
  - Task 3: Markdown export for documentation (table format) — Pending
  - Task 4: YAML export for CI config files — Pending

### Epic 5.2: CI/CD Gate

- **Story 24: Blocked variant enforcement**
  - Task 1: Define `.systemic-audit.json` config file format — Pending
  - Task 2: CLI script to check if blocked variants exist in production CSS — Pending
  - Task 3: GitHub Action that reads audit export and fails if violations found — Pending
  - Task 4: Document CI setup in README — Pending

---

## Phase 6: Collaboration & AI

### Epic 6.1: Shared Audit State

- **Story 25: Persist audit state to Supabase**
  - Task 1: Create `audit_entries` table in Supabase project — Pending
  - Task 2: Sync localStorage ↔ Supabase on load/save — Pending
  - Task 3: Handle conflict resolution (last-write-wins) — Pending
  - Task 4: Add user attribution to comments — Pending

### Epic 6.2: AI-Assisted Auditing

- **Story 26: Auto-detect broken variants**
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
| 1.1 | 2026-02-07 | Mark Phase 1 complete. Add Phase 2 (Navigation & App Shell). Renumber phases 3-6. |
