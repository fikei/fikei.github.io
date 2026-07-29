# Ops Changelog

Changes to the Notion sync system, GitHub Actions workflows, and operations infrastructure.

---

## [2026-07-29] - Deprecated AI Agent Automation + Notion Sync

### Removed
- **`agent-automation.yml` workflow** — 18 of the last 100 runs failed, all in the notion-sync job (curl exit 6: the Ops Supabase host no longer resolves). The remaining jobs (on-push, on-pull-request, daily-synthesis, weekly-improvement, friday-doc-cleanup, manual-trigger) only echoed logs or auto-filed noise issues; Claude Code sessions handle this work directly now. `scrape-events.yml` is the only remaining workflow.
- **`notion-sync` edge function** (`supabase/functions/notion-sync/`) and `notion-structure.json` — GitHub → Notion doc sync is discontinued. Sync guide archived at `docs/infrastructure/archive/NOTION-SYNC-GUIDE.md`; PRD archived at `docs/strategy/prds/archive/notion-sync-platform.md`.
- Migration 006 sync tables remain in the Ops project but are unused. GitHub secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NOTION_API_KEY`, `ANTHROPIC_API_KEY` are no longer referenced and can be deleted from repo settings.

---

## [2026-02-06] - Content Sync Pipeline & Dedup

### Fixed
- **child_page block preservation in `updatePageContent`** — content sync was deleting `child_page` blocks when pushing markdown, trashing child pages (e.g. Project Plan sub-pages). Now always filters out `child_page` blocks from deletion.
- **Root page missing from workflow API calls** — `update-page` and `check-changes` calls from the workflow didn't include `"root"`, causing all 64 pages to fail with "No root page specified". Now reads root from `notion-structure.json` and passes it in every call.
- **Error reporting showed "unknown error"** — edge function error responses use `{ "error": "msg" }` (singular) but workflow checked `response.get('errors')` (plural). Now checks both keys and dumps raw response as fallback.
- **Empty state table fallback was broken** — `pages_to_sync = []` on line 685 reset the list after the fallback code already populated it. Variable scope bug meant first-time sync never actually pushed pages.
- **child_page block preservation in `updatePageWithBlocks`** — section page link generation was deleting `child_page` blocks. Added `preserveChildPages` flag to skip them during block replacement.

### Added
- **Duplicate page detection in cleanup** — `getChildPagesAll()` method returns all child pages as an array (unlike `getChildPages()` which uses Map and silently drops same-titled pages). Cleanup now deduplicates before orphan detection: finds pages with same title under one parent, keeps first, archives rest.
- **Root page passthrough** — workflow saves `root_page` from `notion-structure.json` to `/tmp/root_page.txt` for the content sync script to read.

---

## [2026-02-05] - Auto-Discovery, Branch Cleanup & Pipeline Fixes

### Added
- **Auto-discovery for untracked docs** — workflow scans `docs/` for `.md` files not in `notion-structure.json`. Creates/updates GitHub issue with `untracked-docs` label listing files to add or archive. Runs on every sync push and during weekly health check.
- **Section page child links** — replaced `generateLinkedTocBlocks` (TOC with "Contents" heading) with `generateChildPageLinks` (flat bulleted list of page mention links). Section pages now show clean links to their children.

### Changed
- **Removed `docs-sync` branch** — eliminated from push triggers and workflow conditions. All Notion sync now triggers from `master`/`main` or `claude/*` branches when doc files change. Updated `CLAUDE.md` references.

### Fixed
- **Health check error handling** — non-200 responses (e.g. 401 JWT) now show HTTP status code and response body with fix suggestions instead of cryptic "Could not parse health report" JSON error.
- **Empty state table fallback** — when `check-changes` returns 0 for both `needsSync` and `upToDate` (empty state table), workflow falls back to syncing ALL pages instead of skipping everything.

---

## [2026-02-05] - Phase A: Similar Pages, Formatting & Review Tracking

### Added
- **Similar page detection** (A.2.3) — `findSimilarPages()` in `validator.ts` uses Jaccard similarity via word-level trigrams (3-word shingles) plus shared heading detection. Configurable threshold (default 0.4).
- **Formatting checks** (A.2.5) — `checkFormatting()` in `validator.ts` detects heading level gaps, mixed list markers, and excessive blank lines.
- **Review tracking** (A.2.6) — `reviewDays` parameter (default 30) in health check. Pages between review threshold and stale threshold flagged as `needsReview`.
- **Health report fields** — `needsReview`, `similarPages`, `formattingIssues` added to `HealthReport` type and wired into health check output and GitHub issue creation.

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
- **`getPageLastEdited`** method on NotionClient for staleness tracking

### Changed
- Workflow condition: sync steps gated behind `docs-filter` check
- PRD updated with Phase A task statuses
- Sync guide updated with `health-check` action reference

---

## [2026-02-05] - NotionSync Pre-Phase: System Cleanup & PRD Rewrite

### Added
- **Modular code architecture** for notion-sync edge function:
  - `types.ts` — TypeScript interfaces for all Notion API responses, requests, and sync types
  - `markdown.ts` — Extracted markdown-to-Notion-blocks converter (+ strikethrough support)
  - `validator.ts` — Schema validation for notion-structure.json
  - `logger.ts` — Structured logging with levels, context, and summary metrics
- **NOTION-SYNC-GUIDE.md** — Full operational guide
- **Workflow metrics summary** — New "Sync Summary" step
- **Workflow claude/* branch support**

### Changed
- **Removed DEFAULT_STRUCTURE** — fully root-agnostic, no hardcoded Notion page names
- **Structure is required** — sync actions require structure in request body
- **Root page resolution** — request body > env var > structure.root > error
- **All actions return `metrics`** — duration, API calls, blocks created/failed
- **PRD rewritten** — three pillars: Documentation Creation, Management, Sync

### Fixed
- Unused variable warnings (`_e` prefix for caught errors)
- Removed duplicate "Content Type System" from default structure

---

## Format

Each entry includes:
- **Date** in `[YYYY-MM-DD]` format
- **Summary** title
- **Added** / **Changed** / **Fixed** / **Removed** sections as applicable
