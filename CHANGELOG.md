# Changelog

All notable changes to ctrl.rodeo will be documented in this file.

---

## [2026-02-05] - Phase A: Docs Health Check & docs-sync Branch

### Added
- **`health-check` action** in notion-sync edge function (`health.ts`):
  - Staleness detection (configurable threshold, default 90 days)
  - Empty page detection with auto-archive for bot-created pages
  - Orphaned page detection (in Notion but not in structure)
  - Missing-in-Notion detection (in structure but not in Notion)
  - Duplicate title detection
  - `autoFix` mode to archive empty/orphaned bot-created pages
- **Weekly health check workflow job** (`docs-health-check`):
  - Runs every Friday alongside weekly improvement analysis
  - Creates GitHub issue with actionable checklist when problems found
  - Also triggerable manually via `health-check` agent option
- **`docs-sync` branch strategy**:
  - Dedicated `docs-sync` branch always triggers Notion sync
  - `master`/`main` only syncs when `.md` or `notion-structure.json` files changed
  - Prevents unnecessary syncs on code-only pushes
- **`getPageLastEdited`** method on NotionClient for staleness tracking

### Changed
- Workflow condition: sync steps gated behind `docs-filter` check
- PRD updated with Phase A task statuses (staleness, cleanup, structure health, workflow)
- Sync guide updated with `health-check` action reference and `docs-sync` branch docs

---

## [2026-02-05] - NotionSync Pre-Phase: System Cleanup & PRD Rewrite

### Added
- **Modular code architecture** for notion-sync edge function:
  - `types.ts` — TypeScript interfaces for all Notion API responses, requests, and sync types
  - `markdown.ts` — Extracted markdown-to-Notion-blocks converter as standalone module (+ strikethrough support)
  - `validator.ts` — Schema validation for notion-structure.json (file paths, duplicates, depth, sources)
  - `logger.ts` — Structured logging with levels, context, and summary metrics
- **NOTION-SYNC-GUIDE.md** — Full operational guide: actions reference, troubleshooting, architecture, setup
- **Workflow metrics summary** — New "Sync Summary" step in agent-automation.yml showing duration, API calls, pages
- **Workflow claude/* branch support** — notion-sync now runs on claude/* branches too

### Changed
- **Removed DEFAULT_STRUCTURE** — System is now fully root-agnostic, no hardcoded Notion page names
- **Structure is required** — `sync-structure`, `create-structure`, `cleanup`, and `detect-moves` now require structure in request body (no silent fallback)
- **Root page resolution** — Checked from: request body > env var > structure.root > error (clear precedence)
- **All actions return `metrics`** — duration, API calls, blocks created/failed in every response
- **PRD rewritten** around three pillars: Documentation Creation, Documentation Management, Documentation Sync
  - Added Doc Management Agent phases (staleness detection, auto-cleanup, structure health)
  - Added Comment-Driven Updates phase (commands, free-form, intent parsing, reply & resolution)
  - Added default vs variable structure template system (project type templates)
  - Marked all pre-phase tasks as complete

### Fixed
- Unused variable warnings (`_e` prefix for caught errors)
- Removed duplicate "Content Type System" from default structure (structure removed entirely)

---

## [2026-02-05] - Widget Phase 2: Config-Generated Widgets

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

### Changed
- **Refactored `index.ts`** - Removed 180 lines of hard-coded eligibility rules, replaced with config imports
- **CLAUDE.md** - Updated Supabase project references with correct project IDs:
  - Boards (`yfhudwakpgzswiylhfbh`): generate-widget, enrich-link
  - Ops (`ycilriwjnmcelkspmfmg`): notion-sync
  - Systemic (`atdqdfpdeytfuvvpsasz`): design system tools

### Documentation
- Updated `ai-widget-system.md` to v5.0 with Phase 2 architecture
- Updated `phase-3-ai-intelligence.md` with Phase 2 completion status
- Added widget testing curl commands to CLAUDE.md

### Deployed
- `generate-widget` function deployed to Supabase (Boards project)
- Tested and verified config-driven eligibility working

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
