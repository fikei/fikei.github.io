# Changelog

All notable changes to ctrl.rodeo will be documented in this file.

For Notion sync and ops infrastructure changes, see [docs/infrastructure/ops-changelog.md](docs/infrastructure/ops-changelog.md).

---

## [2026-02-07] - Config-Driven AI Prompts + Server-Side Validation

### Added
- **`config/design-system.ts`** — New module in generate-widget edge function embedding the template registry (10 templates, body modifiers, valid sizes, structure rules) and full class allowlist (130+ `w-*` classes).
- **`buildDesignSystemPrompt()`** — Injects template-specific constraints into AI prompt: body modifier, required/optional atoms, allowed classes, valid sizes.
- **`validateWidgetHtml()` / `sanitizeWidgetHtml()`** — Server-side class allowlist validation. Extracts all `w-*` classes from AI HTML output, compares against allowlist, strips unknown classes.
- **`resolveTemplate()`** — Maps Boards template names (e.g., `grid-split`) to design system definitions (e.g., `split`).
- **Discovery endpoint `designSystem` field** — Each discovered widget now includes its DS template mapping (templateName, bodyModifier, validSizes, structure).

### Changed
- **AI prompt construction** — Now includes a `DESIGN SYSTEM OUTPUT FORMAT` section between brand constraints and confidence instructions. AI is told which `w-*` classes to use for each widget's template.
- **`WidgetMeta.validation`** — Extended with `unknownClasses`, `classesUsed`, `htmlSanitized` fields for DS compliance tracking.

---

## [2026-02-07] - Phase 2.5a Complete: Design System Transition

### Added
- **Widget feature flag** — All widgets hidden by default. Enable via `window.enableWidgetDS()` in browser console. Persists via localStorage once toggled on. Guards `generateWidgets()`, hides hero/footer sections, and disables `widgets.css` when off.
- **Edge-case fixtures** — Added `edgeCases` arrays to all 10 templates in `template-registry.json`. Covers: empty data, single item, overflow (20+ items), very long text, missing optional fields, extreme positions.
- **Source-of-truth documentation** — Added hierarchy diagram and rules to `design-system/README.md`: CSS files are authoritative, manifest is derived, registry is reference.
- **Widget system documentation** — Replaced legacy `widget-complete` README section with current `w-*` class reference (atoms, molecules, body templates, grid sizes).

### Removed
- **733 lines of dead CSS** — Removed all legacy `widget-outfit__*`, `widget-style__*`, `widget-complete__*`, `widget-empty*`, `widget--loading*`, `widget-spectrum__*`, `widget-statrow__*`, `widget-quickadd__*` class definitions from `boards/index.html`. These were fully replaced by `w-*` design system classes in the template migration.

### Changed
- **`design-system/README.md`** — Updated file structure, added source-of-truth section, replaced legacy widget docs with `w-*` system reference.
- **`design-system/template-registry.json`** — All 10 templates now have `fixture` + `edgeCases` for QA testing.

---

## [2026-02-07] - Branch Reconciliation: Widget Phase 2.5a/2.5b + Documentation Merge

### Added
- **`docs/execution/project-plan/phase-3-ai-intelligence.md`** — Merged Widget Phase 2.5a (Design System Transition) and Phase 2.5b (Rules-Based Widget Catalog with 40 widgets) from `claude/ai-widget-phase-2-Lgjfd` branch. Phase 3 now contains the full widget ecosystem roadmap alongside Epic 3.5 Image Intelligence System.
- **`docs/execution/project-plan/backlog.md`** — Added "Action Widget Templates" section (9 feedback-loop templates) from widget branch.

### Changed
- **`docs/execution/project-plan/index.md`** — Reconciled statistics from both branches: Phase 3 now ~113 complete / ~253 pending (up from 46/91), Phase 6 corrected to 1/26, Phase 7 corrected to 0/17 (after Epic 7.2 superseded). Added Widget Phase 2.5a milestone, Phase 2 marked COMPLETE, Phase 2.5a/2.5b added to widget ecosystem roadmap. Removed SERP API from "Needs Decision" (resolved). Total: 155 complete, 688 pending.
- **Widget Phase 2 Template Selection Engine** — Updated template names to match implementation: `grid-split`, `hero-card`, `list`, `text-block` (was `product-grid`, `style-card`, `simple-list`, `text-summary`).
- **`CHANGELOG.md`** — Merged changelog entries from widget branch (Server-Driven Widget Discovery, Widget Templates).
- **`notion-structure.json`** — Added entries for widget branch PRDs and UX research docs.

---

## [2026-02-07] - Phase 9: Restructure Around Access Tiers + CLAUDE.md Update

### Changed
- **`docs/execution/project-plan/phase-9-bulk-import.md`** — Major restructure: organized imports by access tier (OAuth API / Browser Extension / File Upload) instead of data format. Added: OAuth-Connected Imports epic (Reddit, Spotify, Pinterest, YouTube, Pocket with full API specs), Browser Extension Import epic (network interception for Instagram, TikTok, Twitter/X), Platform API Viability Matrix, Manifest V3 architecture docs. File-based imports become Tier 3 fallback. 7 epics total (up from 6).
- **`docs/execution/project-plan/phase-8-automated-pins.md`** — Added shared infra cross-reference to Phase 9 OAuth connections.
- **`docs/execution/project-plan/phase-7-platform-expansion.md`** — Added cross-reference noting Epic 7.1 extension is later extended by Phase 9 Epic 9.3 import capabilities.
- **`CLAUDE.md`** — Added "work item" terminology: generic term for any project plan item that should be placed at the right fidelity level and prioritized.

---

## [2026-02-07] - Phase 9: Bulk Import

### Added
- **`docs/execution/project-plan/phase-9-bulk-import.md`** — New phase solving the cold start problem. 6 epics: Import Infrastructure (job pipeline, dedup, bulk AI categorization), Structured File Imports (bookmarks, Pocket, Instapaper, Raindrop, Pinterest, Pinboard, generic CSV/JSON), Platform Data Exports (Instagram, Twitter/X, YouTube, Reddit, TikTok, Google Takeout, Apple data), AI-Powered Content Extraction (screenshots via Vision AI, email forwarding, copy-paste blobs, shared list import), Onboarding Import Flow ("Import Your Digital Life" wizard), Bulk Organization (smart category suggestions, duplicate merge, bulk edit, source attribution). ~85 new tasks.

### Changed
- **Phase 7 Epic 7.2 (Import/Export)** — Marked as superseded. All 6 tasks absorbed into Phase 9 Epics 9.1 and 9.2.
- **`docs/execution/project-plan/index.md`** — Added Phase 9, updated Phase 7 pending count (50 → 44), new total 473 pending.
- **`notion-structure.json`** — Added Phase 9 entry.

---

## [2026-02-06] - Server-Driven Widget Discovery

### Added
- **`discoverWidgetsFromServer(category, items)`** — Frontend calls server discovery endpoint before rendering widgets
  - Server eligibility engine is now the source of truth for which widgets appear
  - Graceful fallback: if server is unreachable, falls back to local `WIDGET_REGISTRY`
  - Merges server metadata (zone, priority, eligibility) with local widget configs
  - Server-only widgets auto-build temporary local entries from discovery response (prompt + template)
- **Discovery endpoint enhanced** — Now returns `promptTemplate` and `constraints` per widget
- **Loading state uses dynamic widget name** — No longer hard-coded "Style Summary"
- **Action templates added to backlog** — 9 feedback-loop templates tracked for future implementation

---

## [2026-02-06] - Widget Templates: spectrum, stat-row, quick-add

### Added
- **`spectrum` template** — Labeled horizontal scales showing dimensional positioning (e.g. Budget <--*--> Luxury)
  - Widget config: `price-radar` — positions user on budget/style/brand dimensions

- **`stat-row` template** — Row of 2-4 key collection metrics with large values
  - Widget config: `collection-stats` — brands count, style count, avg price

- **`quick-add` action template** — Single high-confidence suggestion with "Add to board" button
  - First action template with feedback loop: Add → item in board → future widgets exclude gap
  - `handleQuickAdd()` — calls `addLink()` to mutate board state, tracks event, updates UI
  - Widget config: `gap-filler` — AI identifies biggest collection gap, suggests one product

- **3 new server-side widget configs**
  - `config/widgets/price-radar.ts` — spectrum template, categories: wear/tech/home/all
  - `config/widgets/collection-stats.ts` — stat-row template, all 12 categories
  - `config/widgets/gap-filler.ts` — quick-add template, categories: wear/tech/home/fitness

### Changed
- `WIDGET_TEMPLATES` now has 7 templates (was 4)
- `WIDGET_REGISTRY` now has 5 widgets (was 2)
- Server registry imports 5 widget configs (was 2)

---

## [2026-02-06] - Epic 3.5: Image Intelligence System

### Added
- **`docs/execution/project-plan/phase-3-ai-intelligence.md`** — New Epic 3.5: Image Intelligence System with 6 stories: Partial Metadata Resilience, Independent Image Pipeline, Image Strategy Rules Engine, AI Image Editing, AI Image Generation, and Prompt-Driven Image Editor UI (replacing "Refresh Image"). 45 new tasks across the stories.

### Changed
- **Epic 3.2 "Manual Override"** — Marked as superseded by Epic 3.5 Story 6.
- **Backlog "AI image generation for missing thumbnails"** — Marked as superseded by Epic 3.5 Story 5.
- **`docs/infrastructure/technical-design/core-systems-architecture.md`** — Added "Planned: Image Intelligence System" section to image resolution pipeline, documenting the `ai_edit` and `ai_generate` strategies and the planned `resolve-image` edge function.
- **`docs/execution/project-plan/index.md`** — Updated Phase 3 pending count (46 → 91).

---

## [2026-02-06] - Phase 8: Automated Pin Creation

### Added
- **`docs/execution/project-plan/phase-8-automated-pins.md`** — New phase for pins that arrive without manual user action. 5 epics: Feed Subscriptions (RSS/Atom), Inbound API & Webhooks (Zapier/IFTTT/email-to-board), Social Media Import (Twitter, Reddit, YouTube, Spotify), AI Discovery (suggested pins, "more like this", trending), Content Monitoring (page watching, price drops, brand new arrivals). Includes source tracking schema and architecture notes on enrichment pipeline reuse.
- **ADR-013: Server-Side Pin Ingestion** in `docs/strategy/decision-log.md` — Proposed architecture for automated sources: shared `ingest-pin` edge function, same enrichment pipeline, `source` provenance metadata, `reviewed` flag for user acknowledgment.

### Changed
- **`docs/execution/project-plan/index.md`** — Added Phase 8 to phase overview and summary statistics (+65 pending tasks).
- **`notion-structure.json`** — Added Phase 8 entry under Execution > Project Plan.

---

## [2026-02-06] - Notion Structure Audit, Bug Tracking, Decision Log

### Changed
- **`docs/execution/BUGS.md`** — Populated from empty placeholder with 8 real bugs discovered during codebase analysis: 2 high priority (sync writes silently lost, 30s polling read-only), 4 medium (CORS proxy silent degradation, widget timeout UX, logo detection false positives, category change doesn't re-trigger widgets), 4 low (expanded card desync, incomplete URL param removal, paste detection annoyance, hardcoded admin email).
- **`docs/strategy/decision-log.md`** — Added 7 new Architecture Decision Records (ADR-006 through ADR-012): localStorage-first architecture, CORS proxies for client-side scraping, domain profile caching for AI cost amortization, config-driven widget system, two-tier pin enrichment, single-file frontend (no build step), magic link authentication.

---

## [2026-02-06] - Tech Stack, Risk Register, Project Plan Updates

### Added
- **`docs/infrastructure/technical-design/tech-stack.md`** — Complete tech stack reference: frontend (vanilla JS, CSS vars, Jekyll), backend (Supabase, Deno edge functions), AI services, third-party APIs, vendor libraries, dev tooling gaps, architecture diagram.
- **`docs/infrastructure/risks.md`** — 13 known risks with severity, likelihood, status, detailed mitigations, and dev work references. Organized into "Do Now", "Do Soon", "Do Later" priority tiers.

### Changed
- **`docs/execution/project-plan/phase-6-performance.md`** — Added Epic 6.2 (Offline & Sync Reliability: retry queue, periodic full sync) and Epic 6.3 (Security Hardening: CORS restriction, Systemic RLS, CSP, rate limiting).
- **`docs/execution/project-plan/backlog.md`** — Added "Technical Debt & Risk Mitigations" section with 4 epics: Server-Side Scraping Fallback (R1/R13), Client Modularization (R2), Critical-Path Test Suite (R6), Infrastructure Hardening (R11/R12/R7).
- **`notion-structure.json`** — Added Tech Stack and Known Risks entries.

---

## [2026-02-05] - Comprehensive Architecture Documentation

### Added
- **`docs/infrastructure/technical-design/core-systems-architecture.md`** — Pin Creation, Pin Enrichment, and AI Widget Pipeline architecture with data flows and key decisions.
- **`docs/infrastructure/technical-design/database-schema.md`** — Complete schema reference for all 25+ tables across 6 migrations, with column types, RLS policies, constraints, and ER diagram.
- **`docs/infrastructure/technical-design/client-architecture.md`** — Structural map of the 9,100-line boards/index.html monolith: section ranges, state management, rendering pipeline, boot sequence, event system.
- **`docs/infrastructure/technical-design/auth-system.md`** — Passwordless magic link auth flow, session management, anonymous vs authenticated capabilities, admin system, data migration on first login.
- **`docs/infrastructure/technical-design/sync-protocol.md`** — localStorage-to-Supabase sync protocol: upload/download flows, conflict resolution, offline behavior, cross-device polling, known gaps.
- **`docs/infrastructure/technical-design/api-reference.md`** — Request/response contracts for enrich-link, generate-widget, categorize, and notion-sync edge functions plus REST API patterns.
- **`docs/infrastructure/dependencies.md`** — All external service dependencies with fallback behavior, cost breakdown, and risk assessment.

### Changed
- **`docs/infrastructure/deployment.md`** — Expanded from checklist to full deployment guide: architecture diagram, two deployment paths (GitHub Pages auto + Supabase CLI manual), GitHub Actions workflow details, environment variables, database migrations.
- **`docs/infrastructure/security.md`** — Expanded from checklist to detailed security model: RLS policy matrix for all tables, CORS issues, data protection (transit + rest), input validation, third-party risk assessment, known gaps.
- **`COSTS.md`** — Added per-operation AI cost estimates, all 3 Supabase projects, free tier monitoring thresholds, 8 free integrations, cost optimization strategies.
- **`docs/execution/project-plan/backlog.md`** — Consolidated Rich Media Support, Content Reader, and Pin Type Abstraction into a structured **Pin Expansion** section with 5 epics.
- **`notion-structure.json`** — Added 7 new documentation entries to Infrastructure section.

---

## [2026-02-05] - Widget Phase 2: Config-Generated Widgets (COMPLETE)

### Added
- **Config-Driven Widget System**
  - `config/schema.ts` - TypeScript types for widget definitions (206 lines)
  - `config/registry.ts` - Widget loader and runtime evaluation (329 lines)
  - `config/widgets/complete-the-look.ts` - Fashion recommendations widget
  - `config/widgets/style-summary.ts` - Style analysis widget

- **Eligibility Rule Evaluators**
  - `min_items` - Minimum number of items required
  - `max_items` - Maximum items for focused widgets
  - `category_match` - Content matches target categories
  - `content_quality` - Items have sufficient metadata
  - `variety` - Items from different sources/domains
  - `recency` - Recently added items

- **Category-Agnostic Matching**
  - `discoverWidgets(category, items)` - Finds all eligible widgets for any category
  - `getRegistrySummary()` - Returns registered widget metadata for frontend
  - Discovery endpoint: `POST { action: 'discover', category, items }` returns eligible widgets
  - Registry endpoint: `POST { action: 'registry' }` returns widget catalog
  - Frontend no longer hard-codes 'wear' — works with any category that has widgets

- **Template Selection Engine**
  - `WIDGET_TEMPLATES` registry with 4 templates: `grid-split`, `hero-card`, `list`, `text-block`
  - `renderWidgetWithTemplate(widget, items, aiResult)` - Selects template via widget config
  - Fallback chain: primary template → fallback template → `list`
  - Each template has `name`, `version`, and `render()` function
  - Removed all hard-coded `if (widget.id === 'complete-the-look')` rendering branches

- **Hot-Reload Widget Registry**
  - `registerWidget(widget)` - Add a widget at runtime
  - `unregisterWidget(widgetId)` - Remove a widget at runtime
  - `reloadWidget(widget)` - Update a widget in-place with version logging

### Changed
- **Refactored `index.ts`** - Removed 180 lines of hard-coded eligibility rules, replaced with config imports
- **Config-driven enrichment** - Enrichment now triggered by `widget.enrichment.enabled` config, not widget ID
- **`boards/index.html`** - Widget rendering uses template engine; category filtering is config-driven
- **CLAUDE.md** - Updated Supabase project references with correct project IDs

### Documentation
- Updated `phase-3-ai-intelligence.md` - Widget Phase 2 marked COMPLETE with all tasks
- Updated `project-plan/index.md` - Phase 2 milestone added
- Updated `CHANGELOG.md` - This entry

---

## [2026-02-04] - AI Agent Infrastructure Foundation

### Added
- **Claude Code Context System**
  - `CLAUDE.md` - Main context file for Claude Code and AI tools
  - `.claude/settings.json` - Configuration for agents and integrations
  - `.claude/README.md` - Documentation for the context system

- **AI Agent Workforce** (`.claude/agents/`)
  - `organizational-agent.md` - Documentation standards and data integrity
  - `project-management-agent.md` - Task structuring and sprint planning
  - `status-update-agent.md` - Progress tracking and risk flagging
  - `chief-of-staff-agent.md` - Global oversight and decision routing
  - `security-compliance-agent.md` - Privacy and security audits
  - `continuous-improvement-agent.md` - Process optimization

- **Supabase Edge Functions**
  - `agent-handler/` - Orchestrates AI agent requests
  - `notion-sync/` - Bidirectional Notion synchronization

- **GitHub Automation**
  - `.github/workflows/agent-automation.yml` - Automated agent triggers
    - On push: status update and security agents
    - On PR: organizational and project management review
    - Daily: Chief of Staff synthesis
    - Weekly: Continuous improvement analysis

- **Documentation**
  - `docs/SETUP-ai-agent-system.md` - Complete setup guide
  - `docs/PRD-unified-corporate-management.md` - System PRD

- **Configuration**
  - `.env.template` - Environment variable template
  - `.gitignore` - Ignore patterns for env files and build outputs
  - `scripts/setup-notion.sh` - Notion workspace setup script

- **Project Tracking**
  - `PROJECT-STATUS.md` - Unified task tracking
  - `CHANGELOG.md` - This file

### User Preferences Added to CLAUDE.md
1. Structure project plans as Phases → Epics → Stories → Tasks
2. Always show copy-pasteable content
3. Provide step-by-step next actions after tasks
4. Maintain unified project plan tracking
5. Maintain explicit changelog
6. Use and extend the design system (check components, reuse tokens, extend when needed)

---

## Format

Each entry includes:
- **Date** in `[YYYY-MM-DD]` format
- **Summary** title
- **Added** - New features or files
- **Changed** - Updates to existing functionality
- **Fixed** - Bug fixes
- **Removed** - Deleted features or files
