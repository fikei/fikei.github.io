# NotionSync Platform - Product Brief

**Product**: NotionSync - GitHub↔Notion Documentation Sync
**Author**: AI-assisted
**Status**: Draft
**Last Updated**: 2026-02-05

---

## Executive Summary

Package our battle-tested Notion sync system as a reusable tool for any team. Users connect a GitHub repo to Notion, define their doc structure, and get automatic bidirectional sync with intelligent features.

**Immediate opportunity**: Clean up our current implementation to serve as the reference architecture, then extract into a packageable tool.

---

## Problem Statement

Teams using both GitHub (for code/docs) and Notion (for collaboration) face:
- **Manual copy-paste** between platforms
- **Version drift** - Notion edits lost, GitHub not updated
- **No single source of truth** - confusion about which is authoritative
- **Setup complexity** - building sync from scratch is hard

**Our Solution**: A plug-and-play sync system that treats GitHub as source of truth while enabling Notion as the collaboration layer.

---

## Target Users

1. **Engineering Teams** - Sync technical docs, ADRs, runbooks
2. **Product Teams** - PRDs in GitHub, viewable/commentable in Notion
3. **Open Source Projects** - Public docs in repo, internal planning in Notion
4. **Solo Developers** - Personal knowledge base with backup

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Setup time | < 10 minutes |
| Sync latency | < 5 minutes |
| Zero manual intervention | 95% of syncs |
| User retention (30-day) | > 60% |

---

# Project Plan

## Pre-Phase: Current System Cleanup

**Goal**: Optimize our own workflow before packaging

### Epic 0.1: Code Cleanup & Refactoring

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.1.1 | Extract hardcoded values to config (DEFAULT_STRUCTURE cleanup) | High | pending |
| 0.1.2 | Remove duplicate "Content Type System" in structure | High | pending |
| 0.1.3 | Consolidate markdown→blocks logic into single module | Medium | pending |
| 0.1.4 | Add TypeScript types for all API responses | Medium | pending |
| 0.1.5 | Remove console.log debugging, use structured logging | Low | pending |

### Epic 0.2: Structure Optimization

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.2.1 | Audit notion-structure.json for orphaned entries | High | pending |
| 0.2.2 | Verify all file paths exist and are valid | High | pending |
| 0.2.3 | Standardize icon usage across doc types | Medium | pending |
| 0.2.4 | Add schema validation for notion-structure.json | Medium | pending |

### Epic 0.3: Workflow Efficiency

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.3.1 | Reduce workflow run time (parallel where possible) | High | pending |
| 0.3.2 | Add workflow run summary with metrics | Medium | pending |
| 0.3.3 | Cache Notion page IDs to reduce API calls | Medium | pending |
| 0.3.4 | Add dry-run mode for testing changes | Low | pending |

### Epic 0.4: Documentation

| Task | Description | Priority | Status |
|------|-------------|----------|--------|
| 0.4.1 | Document all notion-sync actions in README | High | pending |
| 0.4.2 | Add troubleshooting guide for common errors | High | pending |
| 0.4.3 | Create architecture diagram | Medium | pending |
| 0.4.4 | Write CLAUDE.md section specifically for sync system | Medium | pending |

---

## Phase 1: Standalone Package

**Goal**: Extract into reusable npm package + GitHub Action

### Epic 1.1: Core Package Extraction

| Task | Description | Status |
|------|-------------|--------|
| 1.1.1 | Create `@notionsync/core` package structure | pending |
| 1.1.2 | Extract NotionClient class with full API coverage | pending |
| 1.1.3 | Extract markdown↔blocks converter as separate module | pending |
| 1.1.4 | Create structure validator with JSON schema | pending |
| 1.1.5 | Add comprehensive test suite | pending |
| 1.1.6 | Publish to npm | pending |

### Epic 1.2: GitHub Action

| Task | Description | Status |
|------|-------------|--------|
| 1.2.1 | Create `notionsync/action` GitHub Action | pending |
| 1.2.2 | Support inputs: notion_token, root_page, structure_file | pending |
| 1.2.3 | Auto-detect changed files and sync only those | pending |
| 1.2.4 | Output sync summary as workflow annotation | pending |
| 1.2.5 | Publish to GitHub Marketplace | pending |

### Epic 1.3: CLI Tool

| Task | Description | Status |
|------|-------------|--------|
| 1.3.1 | Create `notionsync` CLI with commander.js | pending |
| 1.3.2 | `notionsync init` - interactive setup wizard | pending |
| 1.3.3 | `notionsync sync` - manual sync trigger | pending |
| 1.3.4 | `notionsync status` - show sync state | pending |
| 1.3.5 | `notionsync validate` - check structure file | pending |

---

## Phase 2: Template Library

**Goal**: Pre-built templates for common documentation patterns

### Epic 2.1: Doc Type Templates

| Template | Sections | Status |
|----------|----------|--------|
| PRD | Goals, User Stories, Requirements, Metrics | pending |
| Technical Design | Architecture, API, Data Model, Security | pending |
| UX Spec | User Goals, JTBD, Wireframes, Interactions | pending |
| ADR (Architecture Decision Record) | Context, Decision, Consequences | pending |
| Runbook | Overview, Steps, Troubleshooting, Contacts | pending |
| Meeting Notes | Attendees, Agenda, Notes, Action Items | pending |

### Epic 2.2: Structure Templates

| Template | Use Case | Status |
|----------|----------|--------|
| Startup | PRDs, Tech Specs, UX, Execution | pending |
| Open Source | README sync, Contributing, Docs | pending |
| Personal | Notes, Projects, Resources | pending |
| Enterprise | Governance, Compliance, Architecture | pending |

---

## Phase 3: Web Platform (Future)

**Goal**: No-code setup for non-technical users

### Epic 3.1: OAuth Integration

| Task | Description | Status |
|------|-------------|--------|
| 3.1.1 | Create Notion OAuth app | pending |
| 3.1.2 | Create GitHub OAuth app | pending |
| 3.1.3 | Build auth flow with token storage | pending |

### Epic 3.2: Setup Wizard

| Task | Description | Status |
|------|-------------|--------|
| 3.2.1 | Step 1: Connect services UI | pending |
| 3.2.2 | Step 2: Select root page picker | pending |
| 3.2.3 | Step 3: Doc type selector | pending |
| 3.2.4 | Step 4: Template importer | pending |
| 3.2.5 | Generate and commit files to repo | pending |

### Epic 3.3: Dashboard

| Task | Description | Status |
|------|-------------|--------|
| 3.3.1 | Sync history view | pending |
| 3.3.2 | Error notifications | pending |
| 3.3.3 | Manual sync trigger | pending |
| 3.3.4 | Structure editor | pending |

---

## Immediate Actions (This Week)

### High Priority Cleanup

1. **Fix duplicate entry**: Remove duplicate "Content Type System" from Technical Design (keeping the one with correct file path)

2. **Validate structure**: Run validation to find any broken file paths

3. **Improve logging**: Add sync metrics to workflow output:
   - Pages created/updated/skipped
   - Total sync time
   - Any errors with context

4. **Document the system**: Add `docs/infrastructure/NOTION-SYNC-GUIDE.md` with:
   - How to add new pages
   - How to reorganize
   - Troubleshooting common issues

### Code Quality

5. **Type safety**: Add proper TypeScript interfaces for all Notion API responses

6. **Error handling**: Wrap all API calls with retry logic and meaningful error messages

7. **Testing**: Add basic integration test that syncs a test page

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Current Architecture                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  GitHub Repo                    Notion Workspace            │
│  ┌─────────────┐               ┌─────────────┐             │
│  │ docs/*.md   │               │ Root Page   │             │
│  │ notion-     │    ──────►    │ ├─ Section  │             │
│  │ structure   │    Sync       │ │  └─ Page  │             │
│  │ .json       │               │ └─ Section  │             │
│  └─────────────┘               └─────────────┘             │
│        │                              │                     │
│        ▼                              ▼                     │
│  ┌─────────────┐               ┌─────────────┐             │
│  │ GitHub      │               │ Notion API  │             │
│  │ Actions     │──────────────►│ via Supabase│             │
│  │ Workflow    │               │ Edge Fn     │             │
│  └─────────────┘               └─────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Notion API rate limits | Sync failures | Batch operations, exponential backoff |
| Large file handling | Timeout/truncation | Chunk large files, warn user |
| Merge conflicts | Data loss | GitHub always wins, notify on Notion changes |
| API breaking changes | System down | Version lock APIs, monitor changelogs |

---

## Open Questions

1. **Bidirectional sync**: How aggressively should we sync Notion→GitHub?
2. **Pricing model**: Free tier limits? What differentiates paid?
3. **Multi-workspace**: One repo to many Notion workspaces?
4. **Real-time**: Webhooks for instant sync vs polling?

---

## Appendix: Current Capabilities

### Sync Actions Available
| Action | Description |
|--------|-------------|
| `sync-structure` | Create/update full page hierarchy |
| `update-page` | Update single page content |
| `cleanup` | Archive orphaned pages |
| `detect-moves` | Find pages moved in Notion |
| `create-structure` | Initialize default structure |

### Configuration Options
| Option | Description |
|--------|-------------|
| `root` | Override root page name |
| `targetSection` | Sync specific section only |
| `skipContent` | Structure only, no content |
| `dryRun` | Preview changes |
| `protectHuman` | Don't delete human-created pages |
