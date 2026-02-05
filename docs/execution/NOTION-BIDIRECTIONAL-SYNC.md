# Notion Bidirectional Sync - Project Plan

Enable two-way synchronization between Notion and GitHub, allowing content edits in Notion to flow back to GitHub as the source of truth, plus comment-driven workflows.

---

## Phase 1: Notion → GitHub Content Sync

### Epic 1.1: Content Change Detection

**Goal:** Detect when page content has been modified in Notion

#### Story 1.1.1: Track Page Last Edited Timestamps
As a system, I need to track when pages were last edited in Notion so I can detect changes.

| Task | Description | Status |
|------|-------------|--------|
| 1.1.1.1 | Add `getPageMetadata()` method to NotionClient to fetch `last_edited_time` | pending |
| 1.1.1.2 | Store last sync timestamps in Supabase `notion_sync_state` table | pending |
| 1.1.1.3 | Create comparison logic to identify pages edited since last sync | pending |
| 1.1.1.4 | Add `detect-changes` action to notion-sync function | pending |

#### Story 1.1.2: Content Diff Generation
As a system, I need to extract page content and generate diffs against the GitHub version.

| Task | Description | Status |
|------|-------------|--------|
| 1.1.2.1 | Add `getPageContent()` method to extract all blocks as markdown | pending |
| 1.1.2.2 | Implement Notion blocks → Markdown converter (reverse of current flow) | pending |
| 1.1.2.3 | Handle tables, code blocks, callouts, toggles in reverse conversion | pending |
| 1.1.2.4 | Generate unified diff between Notion content and GitHub file | pending |

---

### Epic 1.2: GitHub Commit Workflow

**Goal:** Commit Notion changes back to GitHub repository

#### Story 1.2.1: GitHub API Integration
As a system, I need to commit content changes to GitHub via API.

| Task | Description | Status |
|------|-------------|--------|
| 1.2.1.1 | Add GitHub API client to notion-sync function | pending |
| 1.2.1.2 | Implement `createOrUpdateFile()` using GitHub Contents API | pending |
| 1.2.1.3 | Handle authentication via `GITHUB_TOKEN` secret | pending |
| 1.2.1.4 | Support committing to configurable branch (default: main) | pending |

#### Story 1.2.2: Automated Commit Creation
As a system, I need to create meaningful commits for Notion changes.

| Task | Description | Status |
|------|-------------|--------|
| 1.2.2.1 | Generate commit message from page title and change type | pending |
| 1.2.2.2 | Include "Synced from Notion" attribution in commit message | pending |
| 1.2.2.3 | Batch multiple page changes into single commit when appropriate | pending |
| 1.2.2.4 | Add `sync-to-github` action to notion-sync function | pending |

#### Story 1.2.3: Conflict Resolution
As a system, I need to handle conflicts when both Notion and GitHub have changes.

| Task | Description | Status |
|------|-------------|--------|
| 1.2.3.1 | Detect when GitHub file changed since last sync | pending |
| 1.2.3.2 | Implement "last write wins" with timestamp comparison | pending |
| 1.2.3.3 | Create conflict notification system (Notion comment or GitHub issue) | pending |
| 1.2.3.4 | Add manual resolution option via workflow dispatch | pending |

---

### Epic 1.3: Scheduled Sync Workflow

**Goal:** Run bidirectional sync on a schedule

#### Story 1.3.1: Cron-Based Sync Trigger
As a user, I want changes to sync automatically without manual intervention.

| Task | Description | Status |
|------|-------------|--------|
| 1.3.1.1 | Add cron schedule to agent-automation.yml (e.g., every 15 minutes) | pending |
| 1.3.1.2 | Create `notion-to-github` job in workflow | pending |
| 1.3.1.3 | Add rate limiting to avoid API quota issues | pending |
| 1.3.1.4 | Implement backoff when no changes detected | pending |

#### Story 1.3.2: Manual Sync Trigger
As a user, I want to manually trigger a sync when needed.

| Task | Description | Status |
|------|-------------|--------|
| 1.3.2.1 | Add `sync_direction` input to workflow dispatch (github→notion, notion→github, both) | pending |
| 1.3.2.2 | Add curl command examples to CLAUDE.md | pending |
| 1.3.2.3 | Create sync status endpoint to check last sync time | pending |

---

## Phase 2: Comment-Driven Workflows

### Epic 2.1: Comment Detection & Parsing

**Goal:** Read and understand comments on Notion pages

#### Story 2.1.1: Fetch Page Comments
As a system, I need to retrieve comments from Notion pages.

| Task | Description | Status |
|------|-------------|--------|
| 2.1.1.1 | Add `getPageComments()` method using Notion Comments API | pending |
| 2.1.1.2 | Parse comment metadata (author, timestamp, resolved status) | pending |
| 2.1.1.3 | Handle threaded/reply comments | pending |
| 2.1.1.4 | Store processed comment IDs to avoid re-processing | pending |

#### Story 2.1.2: Comment Intent Classification
As a system, I need to understand what action a comment is requesting.

| Task | Description | Status |
|------|-------------|--------|
| 2.1.2.1 | Define comment command syntax (e.g., `@claude fix typo`, `@claude expand section`) | pending |
| 2.1.2.2 | Implement keyword-based intent detection | pending |
| 2.1.2.3 | Add AI classification for natural language requests | pending |
| 2.1.2.4 | Create intent types: edit, question, task, feedback | pending |

---

### Epic 2.2: Comment Response System

**Goal:** Respond to comments with actions or replies

#### Story 2.2.1: Reply to Comments
As a system, I need to post replies to Notion comments.

| Task | Description | Status |
|------|-------------|--------|
| 2.2.1.1 | Add `replyToComment()` method using Notion Comments API | pending |
| 2.2.1.2 | Format response messages with status indicators | pending |
| 2.2.1.3 | Handle rate limiting for comment replies | pending |
| 2.2.1.4 | Mark comments as resolved after processing | pending |

#### Story 2.2.2: Content Updates from Comments
As a user, I want to request content changes via comments and have them applied.

| Task | Description | Status |
|------|-------------|--------|
| 2.2.2.1 | Implement "fix typo" command - find and correct spelling errors | pending |
| 2.2.2.2 | Implement "expand section" command - add more detail to a section | pending |
| 2.2.2.3 | Implement "update status" command - change task statuses | pending |
| 2.2.2.4 | Implement "add task" command - append new tasks to tables | pending |
| 2.2.2.5 | Apply changes to both Notion page and GitHub file | pending |

#### Story 2.2.3: Question Answering
As a user, I want to ask questions in comments and get answers.

| Task | Description | Status |
|------|-------------|--------|
| 2.2.3.1 | Detect question-type comments | pending |
| 2.2.3.2 | Use AI to answer questions based on page context | pending |
| 2.2.3.3 | Post answer as comment reply | pending |
| 2.2.3.4 | Link to relevant documentation when applicable | pending |

---

### Epic 2.3: Comment Processing Workflow

**Goal:** Process comments automatically on schedule

#### Story 2.3.1: Scheduled Comment Processing
As a system, I need to check for new comments periodically.

| Task | Description | Status |
|------|-------------|--------|
| 2.3.1.1 | Add `process-comments` action to notion-sync function | pending |
| 2.3.1.2 | Create comment processing job in workflow (every 5 minutes) | pending |
| 2.3.1.3 | Track processed comments in Supabase to avoid duplicates | pending |
| 2.3.1.4 | Add comment processing to sync workflow | pending |

#### Story 2.3.2: Comment Notifications
As a user, I want to be notified when comments require manual attention.

| Task | Description | Status |
|------|-------------|--------|
| 2.3.2.1 | Create GitHub issue for comments that can't be auto-processed | pending |
| 2.3.2.2 | Include comment context and suggested actions in issue | pending |
| 2.3.2.3 | Link issue back to Notion page | pending |

---

## Phase 3: Advanced Features

### Epic 3.1: Incremental Content Sync

**Goal:** Update only changed blocks instead of replacing entire page content

#### Story 3.1.1: Block-Level Change Detection
As a system, I need to detect which specific blocks changed rather than replacing all content.

| Task | Description | Status |
|------|-------------|--------|
| 3.1.1.1 | Store block IDs and content hashes in sync state table | pending |
| 3.1.1.2 | Compare current blocks against stored state to find changes | pending |
| 3.1.1.3 | Categorize changes as: insert, update, delete, reorder | pending |
| 3.1.1.4 | Generate minimal change set for sync operation | pending |

#### Story 3.1.2: Incremental Block Updates
As a system, I need to apply only the changed blocks instead of full page reload.

| Task | Description | Status |
|------|-------------|--------|
| 3.1.2.1 | Use Notion `PATCH /blocks/{id}` for updating existing blocks | pending |
| 3.1.2.2 | Use Notion `POST /blocks/{id}/children` for inserting new blocks | pending |
| 3.1.2.3 | Use Notion `DELETE /blocks/{id}` for removing deleted blocks | pending |
| 3.1.2.4 | Handle block reordering via delete + insert at new position | pending |
| 3.1.2.5 | Preserve block IDs to maintain Notion comments/links | pending |

#### Story 3.1.3: Markdown Diff to Block Operations
As a system, I need to convert markdown diffs into Notion block operations.

| Task | Description | Status |
|------|-------------|--------|
| 3.1.3.1 | Parse unified diff output to identify changed lines | pending |
| 3.1.3.2 | Map line changes to corresponding Notion blocks | pending |
| 3.1.3.3 | Handle structural changes (new headings, table rows) | pending |
| 3.1.3.4 | Optimize for minimal API calls (batch where possible) | pending |

#### Story 3.1.4: Sync State Persistence
As a system, I need to persist block state between syncs for comparison.

| Task | Description | Status |
|------|-------------|--------|
| 3.1.4.1 | Create `notion_block_state` table with block_id, page_id, content_hash | pending |
| 3.1.4.2 | Update state after each successful sync | pending |
| 3.1.4.3 | Handle state recovery if sync fails mid-operation | pending |
| 3.1.4.4 | Add cleanup job for orphaned block states | pending |

---

### Epic 3.2: Selective Sync Control

#### Story 3.2.1: Page-Level Sync Settings
As a user, I want to control which pages sync bidirectionally.

| Task | Description | Status |
|------|-------------|--------|
| 3.2.1.1 | Add `sync: bidirectional | github-only | notion-only` to structure | pending |
| 3.2.1.2 | Respect sync settings in both directions | pending |
| 3.2.1.3 | Default human pages to bidirectional, AI pages to github-only | pending |

### Epic 3.3: Sync History & Audit

#### Story 3.3.1: Sync Activity Log
As a user, I want to see a history of sync operations.

| Task | Description | Status |
|------|-------------|--------|
| 3.3.1.1 | Create `notion_sync_log` table in Supabase | pending |
| 3.3.1.2 | Log all sync operations with timestamps and changes | pending |
| 3.3.1.3 | Add `get-sync-history` action to retrieve recent activity | pending |

---

## Technical Notes

### Notion API Endpoints Needed
- `GET /pages/{page_id}` - Get page metadata including last_edited_time
- `GET /blocks/{block_id}/children` - Get page content blocks
- `GET /comments` - List comments (filter by page)
- `POST /comments` - Create comment reply
- `PATCH /comments/{comment_id}` - Resolve comment

### GitHub API Endpoints Needed
- `GET /repos/{owner}/{repo}/contents/{path}` - Get file content
- `PUT /repos/{owner}/{repo}/contents/{path}` - Create or update file
- `POST /repos/{owner}/{repo}/issues` - Create issue for conflicts

### Database Schema (Supabase)

```sql
-- Track sync state per page
CREATE TABLE notion_sync_state (
  page_id TEXT PRIMARY KEY,
  page_title TEXT,
  file_path TEXT,
  last_synced_at TIMESTAMP,
  last_notion_edit TIMESTAMP,
  last_github_edit TIMESTAMP,
  sync_direction TEXT DEFAULT 'bidirectional'
);

-- Track block state for incremental sync (Phase 3)
CREATE TABLE notion_block_state (
  block_id TEXT PRIMARY KEY,
  page_id TEXT REFERENCES notion_sync_state(page_id),
  block_type TEXT,
  content_hash TEXT,
  position INTEGER,
  parent_block_id TEXT,
  last_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_block_state_page ON notion_block_state(page_id);

-- Log sync operations
CREATE TABLE notion_sync_log (
  id SERIAL PRIMARY KEY,
  operation TEXT,
  page_id TEXT,
  file_path TEXT,
  direction TEXT,
  status TEXT,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Track processed comments
CREATE TABLE notion_comments_processed (
  comment_id TEXT PRIMARY KEY,
  page_id TEXT,
  intent TEXT,
  action_taken TEXT,
  processed_at TIMESTAMP DEFAULT NOW()
);
```

### Environment Variables
- `GITHUB_TOKEN` - GitHub API token with repo write access
- `GITHUB_REPO` - Repository in format `owner/repo`
- `GITHUB_BRANCH` - Target branch (default: main)

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Notion→GitHub sync latency | < 5 minutes |
| Comment response time | < 2 minutes |
| Sync conflict rate | < 5% |
| Comment auto-resolution rate | > 80% |

---

## Dependencies

- Notion API access (existing)
- GitHub API token with write access (new)
- Supabase database tables (new)
- AI API for comment understanding (existing Claude integration)
