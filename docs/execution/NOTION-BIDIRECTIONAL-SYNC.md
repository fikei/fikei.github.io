# Notion Bidirectional Sync - Project Plan

Two-phase system for GitHub ↔ Notion synchronization and comment-driven content management.

---

## Overview

| Phase | Name | Purpose | Dependency |
|-------|------|---------|------------|
| 1 | Efficient Content Sync | Keep GitHub ↔ Notion in sync with minimal API calls | None |
| 2 | Comment Agent | Process user requests via Notion comments | Phase 1 |

---

## Phase 1: Efficient Content Sync

**Goal:** Bidirectional sync between GitHub (source of truth) and Notion with:
- Hash-based change detection (skip unchanged content)
- Incremental block updates (don't replace entire pages)
- Structure sync (detect moves, renames, new pages)
- Conflict detection and resolution

### Sync Flow

```
0. QUICK CHECK (per-page)
   ├─ GitHub: MD5(file) vs stored hash
   ├─ Notion: last_edited_time vs stored timestamp
   └─ Output: changed_pages[] (union of both)

1. STRUCTURE CHECK
   ├─ GitHub: diff notion-structure.json
   ├─ Notion: check page titles/parents
   └─ Output: structure_changes[] (moves, renames, new, deleted)

2. STRUCTURE RESOLVE
   ├─ GitHub wins for AI pages
   ├─ Notion wins for human pages
   ├─ Conflict → flag for review
   └─ Create missing pages (structure only)

3. BLOCK DIFF (only changed_pages)
   ├─ Fetch Notion blocks for dirty pages
   ├─ Convert markdown → blocks (don't send)
   ├─ Diff: inserts, deletes, updates, reorders
   └─ Output: block_operations[] per page

4. APPLY CHANGES
   ├─ Batch deletes (parallel, 10 at a time)
   ├─ Batch inserts (sequential for order)
   ├─ Batch updates (parallel)
   └─ Update sync_state with new hashes
```

---

### Epic 1.1: State Tracking & Quick Check

**Goal:** Skip unchanged content to minimize API calls

#### Story 1.1.1: Sync State Table
Track per-page state for change detection.

| Task | Description | Status |
|------|-------------|--------|
| 1.1.1.1 | Create `sync_state` table in Supabase (schema below) | pending |
| 1.1.1.2 | Add `getSyncState(page_path)` method to notion-sync | pending |
| 1.1.1.3 | Add `updateSyncState()` after successful sync | pending |
| 1.1.1.4 | Add migration script for initial state population | pending |

#### Story 1.1.2: GitHub Change Detection
Detect file changes without reading full content.

| Task | Description | Status |
|------|-------------|--------|
| 1.1.2.1 | Compute MD5 hash of markdown file content | pending |
| 1.1.2.2 | Compare hash against stored `github_hash` | pending |
| 1.1.2.3 | Use git file modification time as secondary signal | pending |
| 1.1.2.4 | Build `github_changed[]` list of dirty files | pending |

#### Story 1.1.3: Notion Change Detection
Detect page changes with minimal API calls.

| Task | Description | Status |
|------|-------------|--------|
| 1.1.3.1 | Fetch `last_edited_time` for all tracked pages (batch API) | pending |
| 1.1.3.2 | Compare against stored `notion_last_edited` | pending |
| 1.1.3.3 | Build `notion_changed[]` list of dirty pages | pending |
| 1.1.3.4 | Merge into `changed_pages[]` union list | pending |

---

### Epic 1.2: Structure Sync

**Goal:** Keep page hierarchy in sync between GitHub and Notion

#### Story 1.2.1: Structure Change Detection
Detect when pages are moved, renamed, added, or deleted.

| Task | Description | Status |
|------|-------------|--------|
| 1.2.1.1 | Store structure hash to detect `notion-structure.json` changes | pending |
| 1.2.1.2 | Fetch current Notion page hierarchy via API | pending |
| 1.2.1.3 | Compare titles and parent relationships | pending |
| 1.2.1.4 | Categorize: `new`, `moved`, `renamed`, `deleted` | pending |

#### Story 1.2.2: Structure Resolution
Apply structure changes respecting source ownership.

| Task | Description | Status |
|------|-------------|--------|
| 1.2.2.1 | For AI pages: GitHub structure wins | pending |
| 1.2.2.2 | For human pages: Notion structure wins, update JSON | pending |
| 1.2.2.3 | Detect conflicts (both changed) → log warning, skip | pending |
| 1.2.2.4 | Auto-commit structure.json changes from Notion | pending |

#### Story 1.2.3: Page Creation & Deletion
Handle new and removed pages.

| Task | Description | Status |
|------|-------------|--------|
| 1.2.3.1 | Create new Notion pages for new GitHub files | pending |
| 1.2.3.2 | Archive (not delete) Notion pages removed from structure | pending |
| 1.2.3.3 | Handle empty pages (structure only, content later) | pending |

---

### Epic 1.3: Incremental Block Sync

**Goal:** Update only changed blocks instead of full page replacement

#### Story 1.3.1: Block State Tracking
Store block-level state for diff comparison.

| Task | Description | Status |
|------|-------------|--------|
| 1.3.1.1 | Create `block_state` table (schema below) | pending |
| 1.3.1.2 | Store block_id, content_hash, position for each block | pending |
| 1.3.1.3 | Update state after each successful page sync | pending |
| 1.3.1.4 | Handle orphaned blocks cleanup | pending |

#### Story 1.3.2: Block Diff Algorithm
Generate minimal change set from markdown diff.

| Task | Description | Status |
|------|-------------|--------|
| 1.3.2.1 | Parse markdown into block-equivalent units | pending |
| 1.3.2.2 | Hash each unit and compare to stored hashes | pending |
| 1.3.2.3 | Identify: inserts, deletes, updates, reorders | pending |
| 1.3.2.4 | Map markdown line ranges to Notion block IDs | pending |

#### Story 1.3.3: Block Operations
Apply incremental changes via Notion API.

| Task | Description | Status |
|------|-------------|--------|
| 1.3.3.1 | `PATCH /blocks/{id}` for content updates | pending |
| 1.3.3.2 | `DELETE /blocks/{id}` in parallel batches | pending |
| 1.3.3.3 | `POST /blocks/{parent}/children` for inserts with `after` param | pending |
| 1.3.3.4 | Handle reorders via delete + insert at new position | pending |
| 1.3.3.5 | Preserve block IDs to maintain comments/links | pending |

---

### Epic 1.4: Conflict Detection & Resolution

**Goal:** Handle cases where both GitHub and Notion changed

#### Story 1.4.1: Conflict Detection
Identify when same content was edited in both places.

| Task | Description | Status |
|------|-------------|--------|
| 1.4.1.1 | Compare timestamps: github_edit vs notion_edit vs last_sync | pending |
| 1.4.1.2 | If both newer than last_sync → conflict | pending |
| 1.4.1.3 | Generate conflict report with both versions | pending |

#### Story 1.4.2: Conflict Resolution
Handle conflicts based on page ownership.

| Task | Description | Status |
|------|-------------|--------|
| 1.4.2.1 | AI pages: GitHub wins (overwrite Notion) | pending |
| 1.4.2.2 | Human pages: Notion wins (commit to GitHub) | pending |
| 1.4.2.3 | Manual override via `force_source` parameter | pending |
| 1.4.2.4 | Log all conflict resolutions for audit | pending |

---

### Epic 1.5: Notion → GitHub Sync

**Goal:** Commit Notion changes back to GitHub

#### Story 1.5.1: Content Export
Convert Notion blocks to markdown.

| Task | Description | Status |
|------|-------------|--------|
| 1.5.1.1 | Implement blocks → markdown converter (reverse of current) | pending |
| 1.5.1.2 | Handle tables, code blocks, callouts, toggles | pending |
| 1.5.1.3 | Preserve frontmatter if present | pending |
| 1.5.1.4 | Normalize whitespace and formatting | pending |

#### Story 1.5.2: GitHub Commit
Commit changes via GitHub API.

| Task | Description | Status |
|------|-------------|--------|
| 1.5.2.1 | Add GitHub API client to notion-sync | pending |
| 1.5.2.2 | Implement `createOrUpdateFile()` via Contents API | pending |
| 1.5.2.3 | Generate commit message: "Sync from Notion: {page}" | pending |
| 1.5.2.4 | Batch multiple changes into single commit | pending |

---

## Phase 2: Comment Agent

**Goal:** Process Notion comments as a task queue for AI-assisted content updates with bidirectional human-system communication.

### Comment Flow

```
Human → System                    System → Human
─────────────────                 ─────────────────
"@agent add metrics"              "@user conflict detected - which
"@agent update this"               version to keep?"
"@agent fix typo"
                                  "@user please verify: AI generated
                                   this content - looks correct?"

                                  "@user decision needed: move to
                                   Backlog or delete?"
```

---

### Epic 2.1: Comment Polling & Detection

**Goal:** Detect new comments across all tracked pages

#### Story 2.1.1: Comment Fetching
Retrieve unprocessed comments from Notion.

| Task | Description | Status |
|------|-------------|--------|
| 2.1.1.1 | Add `getPageComments()` using Notion Comments API | pending |
| 2.1.1.2 | Filter for unresolved comments only | pending |
| 2.1.1.3 | Store processed comment IDs in `comment_tasks` table | pending |
| 2.1.1.4 | Handle threaded replies | pending |

#### Story 2.1.2: Comment Filtering
Identify actionable comments.

| Task | Description | Status |
|------|-------------|--------|
| 2.1.2.1 | Filter for @agent or @bot mentions | pending |
| 2.1.2.2 | Ignore system-generated comments | pending |
| 2.1.2.3 | Detect human responses to system questions | pending |
| 2.1.2.4 | Build task queue from filtered comments | pending |

---

### Epic 2.2: Intent Parsing

**Goal:** Understand what action the user is requesting

#### Story 2.2.1: Command Parsing
Parse structured commands.

| Task | Description | Status |
|------|-------------|--------|
| 2.2.1.1 | Define command syntax: `@agent <action> [target] [details]` | pending |
| 2.2.1.2 | Parse action keywords: add, update, delete, move, fix | pending |
| 2.2.1.3 | Extract target: section, block, table, page | pending |
| 2.2.1.4 | Extract details/context from rest of comment | pending |

#### Story 2.2.2: AI Intent Classification
Handle natural language requests.

| Task | Description | Status |
|------|-------------|--------|
| 2.2.2.1 | Send ambiguous comments to Claude for classification | pending |
| 2.2.2.2 | Return structured intent: `{action, target, context}` | pending |
| 2.2.2.3 | Handle multi-part requests | pending |
| 2.2.2.4 | Flag low-confidence intents for clarification | pending |

---

### Epic 2.3: Content Generation

**Goal:** Generate or modify content based on requests

#### Story 2.3.1: Content Operations
Apply requested changes to markdown.

| Task | Description | Status |
|------|-------------|--------|
| 2.3.1.1 | Read current markdown from GitHub | pending |
| 2.3.1.2 | Apply change via AI (add section, update content, etc.) | pending |
| 2.3.1.3 | Validate output (formatting, length, relevance) | pending |
| 2.3.1.4 | Commit to GitHub with reference to comment ID | pending |

#### Story 2.3.2: AI Content Generation
Use Claude for intelligent content updates.

| Task | Description | Status |
|------|-------------|--------|
| 2.3.2.1 | Build prompt with page context + user request | pending |
| 2.3.2.2 | Generate content that matches existing style | pending |
| 2.3.2.3 | Handle "expand", "summarize", "rewrite" commands | pending |
| 2.3.2.4 | Respect page structure (don't break formatting) | pending |

---

### Epic 2.4: Human-in-the-Loop

**Goal:** Bidirectional communication for decisions and verification

#### Story 2.4.1: System-Initiated Comments
Post comments when human input needed.

| Task | Description | Status |
|------|-------------|--------|
| 2.4.1.1 | Post conflict resolution requests | pending |
| 2.4.1.2 | Post verification requests for AI-generated content | pending |
| 2.4.1.3 | Post clarification requests for ambiguous commands | pending |
| 2.4.1.4 | Post decision requests (delete vs archive, etc.) | pending |

#### Story 2.4.2: Response Processing
Handle human responses to system questions.

| Task | Description | Status |
|------|-------------|--------|
| 2.4.2.1 | Detect replies to system comments | pending |
| 2.4.2.2 | Parse approval/rejection/choice responses | pending |
| 2.4.2.3 | Resume paused tasks with human input | pending |
| 2.4.2.4 | Handle timeouts (no response after X days) | pending |

---

### Epic 2.5: Reply & Resolution

**Goal:** Close the loop on processed comments

#### Story 2.5.1: Comment Replies
Respond to processed requests.

| Task | Description | Status |
|------|-------------|--------|
| 2.5.1.1 | Add `replyToComment()` using Notion API | pending |
| 2.5.1.2 | Format success replies: "✅ Done - {summary}" | pending |
| 2.5.1.3 | Format error replies: "❌ Failed - {reason}" | pending |
| 2.5.1.4 | Include link to commit when content changed | pending |

#### Story 2.5.2: Comment Resolution
Mark comments as resolved.

| Task | Description | Status |
|------|-------------|--------|
| 2.5.2.1 | Resolve comment after successful processing | pending |
| 2.5.2.2 | Keep unresolved if failed or awaiting input | pending |
| 2.5.2.3 | Update `comment_tasks` table with final status | pending |

---

## Database Schema

```sql
-- Phase 1: Sync state per page
CREATE TABLE sync_state (
  page_path TEXT PRIMARY KEY,
  notion_page_id TEXT,
  github_hash TEXT,                    -- MD5 of markdown content
  notion_last_edited TIMESTAMPTZ,      -- from Notion API
  last_synced_at TIMESTAMPTZ,
  sync_direction TEXT DEFAULT 'bidirectional',  -- bidirectional | github-only | notion-only
  block_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 1: Block state for incremental sync
CREATE TABLE block_state (
  block_id TEXT PRIMARY KEY,
  page_path TEXT REFERENCES sync_state(page_path) ON DELETE CASCADE,
  content_hash TEXT,                   -- MD5 of block content
  block_type TEXT,
  position INTEGER,
  parent_block_id TEXT,
  markdown_line_start INTEGER,         -- map to source file
  markdown_line_end INTEGER,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_block_state_page ON block_state(page_path);

-- Phase 1: Sync operation log
CREATE TABLE sync_log (
  id SERIAL PRIMARY KEY,
  operation TEXT,                      -- structure | content | conflict
  page_path TEXT,
  direction TEXT,                      -- github→notion | notion→github
  status TEXT,                         -- success | failed | skipped
  blocks_changed INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 2: Comment task queue
CREATE TABLE comment_tasks (
  comment_id TEXT PRIMARY KEY,
  page_path TEXT,
  block_id TEXT,                       -- if comment on specific block
  author_id TEXT,
  raw_text TEXT,
  parsed_intent JSONB,                 -- {action, target, context}
  status TEXT DEFAULT 'pending',       -- pending | processing | awaiting_human | done | failed
  github_commit TEXT,                  -- commit SHA if content changed
  reply_text TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_comment_tasks_status ON comment_tasks(status);
```

---

## API Endpoints

### Notion API
- `GET /pages/{id}` - Page metadata (last_edited_time)
- `GET /blocks/{id}/children` - Page blocks
- `PATCH /blocks/{id}` - Update block content
- `DELETE /blocks/{id}` - Delete block
- `POST /blocks/{id}/children` - Insert blocks
- `GET /comments` - List comments (filter by page)
- `POST /comments` - Create comment
- `PATCH /comments/{id}` - Resolve comment

### GitHub API
- `GET /repos/{owner}/{repo}/contents/{path}` - File content + SHA
- `PUT /repos/{owner}/{repo}/contents/{path}` - Create/update file

---

## Environment Variables

```bash
# Existing
NOTION_API_KEY=secret_xxx
NOTION_ROOT_PAGE=Ctrl

# New for Phase 1
GITHUB_TOKEN=ghp_xxx           # with repo write access
GITHUB_REPO=owner/repo
GITHUB_BRANCH=main

# New for Phase 2
CLAUDE_API_KEY=sk-ant-xxx      # for intent parsing & content generation
```

---

## Success Metrics

| Phase | Metric | Target |
|-------|--------|--------|
| 1 | API calls per sync (no changes) | < 5 |
| 1 | API calls per sync (1 page changed) | < 20 |
| 1 | Sync latency | < 30 seconds |
| 1 | Conflict detection accuracy | > 95% |
| 2 | Comment response time | < 2 minutes |
| 2 | Intent parsing accuracy | > 90% |
| 2 | Auto-resolution rate | > 80% |

---

## Implementation Priority

### Phase 1 Order
1. **Epic 1.1** - State tracking (foundation for everything)
2. **Epic 1.2** - Structure sync (fix current issues)
3. **Epic 1.4** - Conflict detection (safety)
4. **Epic 1.3** - Incremental sync (performance)
5. **Epic 1.5** - Notion → GitHub (bidirectional)

### Phase 2 Order
1. **Epic 2.1** - Comment polling (detect input)
2. **Epic 2.2** - Intent parsing (understand input)
3. **Epic 2.5** - Reply system (close the loop)
4. **Epic 2.3** - Content generation (do the work)
5. **Epic 2.4** - Human-in-the-loop (handle edge cases)
