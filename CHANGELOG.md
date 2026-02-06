# Changelog

All notable changes to ctrl.rodeo will be documented in this file.

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
  - `WIDGET_TEMPLATES` registry with 4 templates: `product-grid`, `style-card`, `simple-list`, `text-summary`
  - `renderWidgetWithTemplate(widget, items, aiResult)` - Selects template via widget config
  - Fallback chain: primary template → fallback template → `simple-list`
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
