# NotionSync Platform - Product Brief

**Product**: NotionSync - Documentation Creation, Management & Sync
**Author**: AI-assisted
**Status**: Active
**Last Updated**: 2026-02-05

---

## Executive Summary

NotionSync is a documentation platform built on three pillars: **Creation** (templates and structure), **Management** (agent-driven organization and cleanup), and **Sync** (GitHub ↔ Notion synchronization). The system is root-agnostic — it works with any Notion workspace and any project.

**Current state**: One-way sync (GitHub → Notion) is production-ready. Pre-phase cleanup is complete. Next up: doc management agent and comment support.

---

## Three Pillars

```
┌─────────────────────────────────────────────────────────────────┐
│                    NotionSync Platform                           │
├───────────────────┬───────────────────┬─────────────────────────┤
│   1. CREATION     │   2. MANAGEMENT   │      3. SYNC            │
│                   │                   │                         │
│ • Structure       │ • Doc Agent       │ • GitHub → Notion       │
│   templates       │ • Cleanup &       │ • Notion → GitHub       │
│ • Doc type        │   organization    │ • State tracking        │
│   templates       │ • Comment-driven  │ • Conflict resolution   │
│ • Default vs      │   updates         │ • Incremental blocks    │
│   variable        │ • Health checks   │ • Rate limiting         │
│   sections        │ • Staleness       │ • Metrics               │
│                   │   detection       │                         │
└───────────────────┴───────────────────┴─────────────────────────┘
```

---

## Problem Statement

Teams using both GitHub (for code/docs) and Notion (for collaboration) face:
- **Manual copy-paste** between platforms
- **Version drift** — Notion edits lost, GitHub not updated
- **No single source of truth** — confusion about which is authoritative
- **Doc rot** — outdated, orphaned, or duplicated documentation
- **Setup complexity** — building sync from scratch is hard

---

## Target Users

1. **Engineering Teams** — Sync technical docs, ADRs, runbooks
2. **Product Teams** — PRDs in GitHub, viewable/commentable in Notion
3. **Open Source Projects** — Public docs in repo, internal planning in Notion
4. **Solo Developers** — Personal knowledge base with backup

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Setup time | < 10 minutes |
| Sync latency | < 5 minutes |
| Zero manual intervention | 95% of syncs |
| API calls per sync (no changes) | < 5 |
| API calls per sync (1 page changed) | < 20 |
| Conflict detection accuracy | > 95% |
| Comment response time | < 2 minutes |

---

# Pillar 1: Documentation Creation

## Structure Templates

Structure templates define the page hierarchy for different project types. Each template has **default sections** (always present) and **variable sections** (project-specific).

### Default Sections (Every Project)

These sections are fundamental to any documentation system and are always included:

| Section | Icon | Purpose | Why Default |
|---------|------|---------|-------------|
| **Overview** | 📄 | Project summary, quick links | Every project needs a landing page |
| **Architecture** | 📐 | System design, tech stack | Core technical reference |
| **Getting Started** | 🚀 | Setup, prerequisites, first steps | Onboarding is universal |
| **Changelog** | 📝 | What changed and when | Track history always |

### Variable Sections (Project-Specific)

These sections are included based on project type and can be added/removed:

| Section | Icon | When to Include | Example Content |
|---------|------|-----------------|-----------------|
| **Strategy / PRDs** | 🎯 | Product-driven projects | Vision, roadmap, product requirements |
| **Execution / Sprints** | 🔨 | Active development | Sprint plans, backlog, blockers |
| **User Experience** | 🎨 | UI/UX projects | Wireframes, user flows, design system |
| **AI / ML** | 🤖 | AI-integrated projects | Models, prompts, pipelines |
| **Infrastructure** | 🏗 | Backend/DevOps | Deployment, monitoring, security |
| **API Reference** | 🔌 | API products | Endpoints, schemas, auth |
| **Playground / Labs** | 🧪 | Experimental features | Prototypes, POCs |
| **Operations** | 📅 | Business operations | Costs, agents, workflows |
| **Compliance** | 🔒 | Regulated industries | Policies, audits, certifications |
| **Integrations** | 🔗 | Multi-service projects | Third-party connections |

### Project Type Templates

| Template | Default Sections | Variable Sections |
|----------|-----------------|-------------------|
| **Startup** | Overview, Architecture, Getting Started, Changelog | Strategy, Execution, UX, Infrastructure |
| **Open Source** | Overview, Architecture, Getting Started, Changelog | API Reference, Contributing Guide |
| **Personal** | Overview, Changelog | Any — user picks |
| **Enterprise** | Overview, Architecture, Getting Started, Changelog | Compliance, Infrastructure, Operations, API Reference |
| **AI/ML Project** | Overview, Architecture, Getting Started, Changelog | AI/ML, Infrastructure, Execution |

### Doc Type Templates

Templates for individual documents within sections:

| Template | Key Sections | Example |
|----------|-------------|---------|
| **PRD** | Problem, Users, Requirements, Metrics, Risks | Product requirement doc |
| **Technical Design** | Architecture, API, Data Model, Security, Trade-offs | System design spec |
| **UX Spec** | User Goals, JTBD, Wireframes, Interactions | Feature UX document |
| **ADR** | Context, Decision, Consequences, Status | Architecture decision record |
| **Runbook** | Overview, Steps, Troubleshooting, Contacts | Operational procedure |
| **Meeting Notes** | Attendees, Agenda, Notes, Action Items | Recurring meeting log |
| **Sprint Plan** | Goals, Stories, Capacity, Risks | Iteration planning |
| **Post-Mortem** | Timeline, Impact, Root Cause, Action Items | Incident review |

---

# Pillar 2: Documentation Management

## Doc Management Agent

An AI agent that continuously monitors, organizes, and improves documentation quality.

### Phase A: Health Checks & Cleanup

**Goal**: Detect and fix doc rot automatically

#### Epic A.1: Staleness Detection

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| A.1.1 | Track last-modified dates for all pages | High | complete |
| A.1.2 | Flag pages not updated in > 90 days (configurable threshold) | High | complete |
| A.1.3 | Detect orphaned pages (in Notion but not in structure) | High | complete |
| A.1.4 | Detect duplicate/overlapping content between pages | Medium | complete |
| A.1.5 | Generate health report as GitHub issue (weekly) | Medium | complete |

#### Epic A.2: Auto-Cleanup

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| A.2.1 | Archive empty bot-created pages (autoFix mode) | High | complete |
| A.2.2 | Archive orphaned bot-created pages (autoFix mode) | High | complete |
| A.2.3 | Merge near-duplicate pages with AI assistance | Medium | pending |
| A.2.4 | Detect broken internal links between pages | Medium | complete |
| A.2.5 | Normalize formatting inconsistencies | Low | pending |
| A.2.6 | Add "last reviewed" metadata to pages | Low | pending |

#### Epic A.3: Structure Health

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| A.3.1 | Validate all file paths in notion-structure.json exist | High | complete |
| A.3.2 | Detect pages deeper than 5 levels (performance risk) | Medium | complete |
| A.3.3 | Warn on duplicate page titles | Medium | complete |
| A.3.4 | Detect pages in structure but missing in Notion | High | complete |
| A.3.5 | Suggest restructuring for unbalanced trees | Low | complete |

#### Epic A.4: Workflow Integration

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| A.4.1 | `health-check` action in edge function | High | complete |
| A.4.2 | Weekly scheduled health check job (Fridays) | High | complete |
| A.4.3 | Health report → GitHub issue (auto-created when issues found) | High | complete |
| A.4.4 | Manual trigger via `health-check` agent option | Medium | complete |
| A.4.5 | `docs-sync` branch — dedicated branch for doc sync triggers | Medium | complete |
| A.4.6 | Skip Notion sync on main/master when no doc files changed | Medium | complete |

### Phase B: Comment-Driven Updates

**Goal**: Users interact with docs via Notion comments — the agent responds and updates content.

#### How It Works

```
Human writes comment                 Agent responds
─────────────────────               ─────────────────
"@agent add a metrics               "✅ Added Metrics section
 section here"                       with 4 KPIs. Review?"

"@agent this section is             "✅ Updated section with
 outdated, we use Redis              Redis instead of
 now not Memcached"                  Memcached."

"@agent summarize this              "Here's a 3-bullet
 page in 3 bullets"                  summary: ..."

"Can someone explain                "This page covers X.
 what this page is for?"             Key concepts: ..."
```

#### Supported Commands

| Command | Action | Example |
|---------|--------|---------|
| `@agent add <section>` | Insert new section | `@agent add troubleshooting guide` |
| `@agent update <target>` | Modify existing content | `@agent update the API endpoint to /v2` |
| `@agent fix` | Correct errors in context | `@agent fix the typo in line 3` |
| `@agent delete <target>` | Remove content | `@agent delete the deprecated section` |
| `@agent summarize` | Generate summary | `@agent summarize this in 5 bullets` |
| `@agent expand` | Add more detail | `@agent expand on the auth flow` |
| `@agent move <target>` | Relocate content | `@agent move this section to Architecture` |
| Free-form question | AI responds inline | "What does this config do?" |

#### Epic B.1: Comment Polling

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| B.1.1 | Poll Notion for unresolved comments on tracked pages | High | pending |
| B.1.2 | Filter for `@agent` mentions and free-form questions | High | pending |
| B.1.3 | Store processed comment IDs to avoid duplicates | High | pending |
| B.1.4 | Handle threaded replies (context chain) | Medium | pending |
| B.1.5 | Detect human responses to agent questions | Medium | pending |

#### Epic B.2: Intent Parsing

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| B.2.1 | Parse structured commands (`@agent <action> [target]`) | High | pending |
| B.2.2 | Use Claude for free-form intent classification | High | pending |
| B.2.3 | Extract target section/block from context | Medium | pending |
| B.2.4 | Handle multi-part requests | Medium | pending |
| B.2.5 | Flag low-confidence intents for clarification | Low | pending |

#### Epic B.3: Content Operations

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| B.3.1 | Read current page content from GitHub | High | pending |
| B.3.2 | Apply change via Claude (add, update, delete) | High | pending |
| B.3.3 | Validate output (formatting, length, style match) | Medium | pending |
| B.3.4 | Commit to GitHub with reference to comment ID | Medium | pending |
| B.3.5 | Sync updated content back to Notion | Medium | pending |

#### Epic B.4: Reply & Resolution

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| B.4.1 | Reply to comment with result ("✅ Done", "❌ Failed") | High | pending |
| B.4.2 | Include link to GitHub commit when content changed | Medium | pending |
| B.4.3 | Resolve comment thread after successful processing | Medium | pending |
| B.4.4 | Ask clarifying questions when intent is ambiguous | Medium | pending |

#### Epic B.5: Human-in-the-Loop

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| B.5.1 | Post conflict resolution requests as comments | High | pending |
| B.5.2 | Post verification requests for AI-generated content | Medium | pending |
| B.5.3 | Handle approval/rejection responses | Medium | pending |
| B.5.4 | Timeout handling (no response after X days) | Low | pending |

---

# Pillar 3: Documentation Sync

## Current State (Production)

One-way GitHub → Notion sync with:
- Hash-based change detection (only sync what changed)
- Structure validation before sync
- Human page protection
- Structured logging and metrics
- Root-agnostic design (any Notion workspace)

See [NOTION-SYNC-GUIDE.md](../../infrastructure/NOTION-SYNC-GUIDE.md) for operational details.

## Phase 1: Bidirectional Sync

**Goal**: Two-way sync between GitHub and Notion with conflict detection.

See [NOTION-BIDIRECTIONAL-SYNC.md](../../execution/NOTION-BIDIRECTIONAL-SYNC.md) for detailed task breakdown.

**Key Epics:**
- **1.1**: State tracking & quick check (hash-based change detection)
- **1.2**: Structure sync (detect moves, renames)
- **1.3**: Incremental block sync (update only changed blocks)
- **1.4**: Conflict detection & resolution
- **1.5**: Notion → GitHub export (blocks → markdown, GitHub commit)

## Phase 2: Standalone Package

**Goal**: Extract into reusable tools for any team.

### Epic 2.1: Core Package

| Task | Description | Status |
|------|-------------|--------|
| 2.1.1 | Create `@notionsync/core` npm package | pending |
| 2.1.2 | Extract NotionClient with full API coverage | pending |
| 2.1.3 | Extract markdown↔blocks converter as module | pending |
| 2.1.4 | Structure validator with JSON schema | pending |
| 2.1.5 | Comprehensive test suite | pending |

### Epic 2.2: GitHub Action

| Task | Description | Status |
|------|-------------|--------|
| 2.2.1 | Create `notionsync/action` GitHub Action | pending |
| 2.2.2 | Support inputs: notion_token, root_page, structure_file | pending |
| 2.2.3 | Auto-detect changed files and sync only those | pending |
| 2.2.4 | Publish to GitHub Marketplace | pending |

### Epic 2.3: CLI Tool

| Task | Description | Status |
|------|-------------|--------|
| 2.3.1 | `notionsync init` — interactive setup wizard | pending |
| 2.3.2 | `notionsync sync` — manual sync trigger | pending |
| 2.3.3 | `notionsync status` — show sync state | pending |
| 2.3.4 | `notionsync validate` — check structure file | pending |

## Phase 3: Web Platform (Future)

| Epic | Description | Status |
|------|-------------|--------|
| 3.1 | OAuth integration (Notion + GitHub) | pending |
| 3.2 | No-code setup wizard | pending |
| 3.3 | Dashboard (sync history, errors, manual trigger) | pending |

---

# Pre-Phase: System Cleanup

**Status**: Complete

### Epic 0.1: Code Cleanup & Refactoring

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.1.1 | Extract hardcoded DEFAULT_STRUCTURE — system is now root-agnostic | High | complete |
| 0.1.2 | Remove duplicate "Content Type System" (resolved by removing defaults) | High | complete |
| 0.1.3 | Extract markdown→blocks into `markdown.ts` module | Medium | complete |
| 0.1.4 | Add TypeScript types in `types.ts` for all API responses | Medium | complete |
| 0.1.5 | Replace console.log with structured `logger.ts` | Low | complete |

### Epic 0.2: Structure Optimization

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.2.1 | Audit notion-structure.json — all 57 file paths valid | High | complete |
| 0.2.2 | Verify all file paths exist | High | complete |
| 0.2.3 | Add schema validation (`validator.ts`) | Medium | complete |
| 0.2.4 | Duplicate title detection in validator | Medium | complete |

### Epic 0.3: Workflow Efficiency

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.3.1 | Add sync summary step with metrics | High | complete |
| 0.3.2 | Enable workflow on claude/* branches | Medium | complete |
| 0.3.3 | Add response metrics (duration, API calls, blocks) | Medium | complete |

### Epic 0.4: Documentation

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.4.1 | Create NOTION-SYNC-GUIDE.md with all actions documented | High | complete |
| 0.4.2 | Troubleshooting guide in sync guide | High | complete |
| 0.4.3 | Architecture diagram in sync guide | Medium | complete |
| 0.4.4 | Updated PRD with three-pillar structure | Medium | complete |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Notion API rate limits | Sync failures | Batch operations, exponential backoff |
| Large file handling | Timeout/truncation | 40KB limit, auto-split code blocks |
| Merge conflicts | Data loss | GitHub source of truth, conflict detection (planned) |
| Comment spam | Agent overload | Rate limit comments, ignore non-@agent mentions |
| API breaking changes | System down | Version lock APIs, monitor changelogs |
| Stale detection false positives | Good docs flagged | Human review for flagged pages, configurable thresholds |

---

## Open Questions

1. **Comment polling frequency**: How often should we check for new comments? (5min? 1min? Webhooks?)
2. **Agent autonomy level**: Should the agent auto-commit, or always ask for approval?
3. **Template marketplace**: Should users be able to share/publish their structure templates?
4. **Multi-workspace**: One repo synced to multiple Notion workspaces?

---

## File Structure

```
supabase/functions/notion-sync/
├── index.ts           # Main handler, routing, NotionClient
├── types.ts           # All TypeScript interfaces
├── markdown.ts        # Markdown ↔ Notion blocks converter
├── validator.ts       # Structure validation
├── logger.ts          # Structured logging
└── state-manager.ts   # Sync state tracking (Supabase)
```
