# Changelog

All notable changes to ctrl.rodeo will be documented in this file.

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
  - CSS: `.widget-spectrum__axes`, `.widget-spectrum__track`, `.widget-spectrum__marker`
  - Renders 2-4 axes from AI `{ axes: [{ leftLabel, rightLabel, position, note }] }` response
  - Widget config: `price-radar` — positions user on budget/style/brand dimensions

- **`stat-row` template** — Row of 2-4 key collection metrics with large values
  - CSS: `.widget-statrow__grid`, `.widget-statrow__value`, `.widget-statrow__label`
  - Renders stats from AI `{ stats: [{ value, label }] }` response
  - Widget config: `collection-stats` — brands count, style count, avg price

- **`quick-add` action template** — Single high-confidence suggestion with "Add to board" button
  - CSS: `.widget-quickadd__content`, `.widget-quickadd__btn--primary/secondary`
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
- Research doc: 7 of 30 templates now built (was 4)

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
  - `WIDGET_TEMPLATES` registry with 4 UX-pattern templates: `grid-split`, `hero-card`, `list`, `text-block`
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
