# Notion Sync Guide

Operational guide for the GitHub-to-Notion sync system. This system is **root-agnostic** — it works with any Notion workspace and any root page name.

---

## Quick Start

### Prerequisites

1. A Notion workspace with API integration enabled
2. A root page in Notion (any name — e.g., "My Project", "Docs", "Wiki")
3. Supabase project with the `notion-sync` edge function deployed
4. `NOTION_API_KEY` set in Supabase secrets

### Minimal Setup

1. Create a `notion-structure.json` in your repo root:

```json
{
  "root": "My Project",
  "sections": [
    {
      "title": "Documentation",
      "icon": "📚",
      "children": [
        {
          "title": "Getting Started",
          "icon": "🚀",
          "file": "docs/getting-started.md"
        }
      ]
    }
  ]
}
```

2. The GitHub Actions workflow syncs automatically on push to master/main/claude/* branches.

---

## Architecture

```
GitHub Repo                     Notion Workspace
┌─────────────────┐            ┌─────────────────┐
│ docs/*.md        │            │ Root Page        │
│ notion-structure │  ──────►   │ ├─ Section A     │
│   .json          │  Sync     │ │  ├─ Page 1     │
│                  │            │ │  └─ Page 2     │
└─────────────────┘            │ └─ Section B     │
        │                       └─────────────────┘
        ▼
┌─────────────────┐            ┌─────────────────┐
│ GitHub Actions   │───────────►│ Supabase Edge   │
│ Workflow         │            │ Function         │
└─────────────────┘            └─────────────────┘
```

**Flow:**
1. Push to GitHub triggers workflow
2. Workflow reads `notion-structure.json` and computes file hashes
3. Calls `check-changes` to find pages that changed since last sync
4. Calls `sync-structure` to create/update page hierarchy (structure only)
5. Calls `cleanup` to archive orphaned pages
6. Calls `update-page` for each changed page (content sync)

---

## Actions Reference

### `sync-structure`
Creates/updates the page hierarchy in Notion. Does not touch content unless `skipContent: false`.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "sync-structure",
    "skipContent": true,
    "structure": { "root": "My Project", "sections": [...] }
  }'
```

**Options:**
- `skipContent: true` — Only create pages, no content (faster)
- `targetSection: "Section Name"` — Only sync one section
- `root: "Override"` — Override the root page name

### `update-page`
Updates a single page's content. Auto-creates the page if it doesn't exist and `parentPageTitle` is provided.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "update-page",
    "page": {
      "pageTitle": "Getting Started",
      "content": "# Hello\n\nWelcome to the project.",
      "pagePath": "docs/getting-started.md",
      "contentHash": "abc123...",
      "parentPageTitle": "Documentation",
      "icon": "🚀"
    }
  }'
```

### `cleanup`
Archives pages in Notion that aren't in the expected structure. Human-created pages with content are protected.

```bash
# Dry run (preview only)
curl -X POST "$SUPABASE_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "cleanup",
    "dryRun": true,
    "protectHuman": true,
    "structure": { "root": "My Project", "sections": [...] }
  }'
```

### `check-changes`
Compares file hashes against stored state to find pages that need syncing.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "check-changes",
    "contentHashes": {
      "docs/getting-started.md": "sha256hash...",
      "docs/api-reference.md": "sha256hash..."
    }
  }'
```

**Response includes:**
- `needsSync` — Pages that need updating (priority ordered)
- `newPages` — Never synced before
- `changedPages` — Content changed since last sync
- `upToDate` — No changes needed

### `detect-moves`
Finds pages that were reorganized in Notion (different parent than expected).

### `get-state`
Returns the current sync state for all tracked pages.

### `update-state`
Batch updates sync state after successful syncs.

---

## Structure File Format

The `notion-structure.json` file defines your Notion page hierarchy.

### Schema

```json
{
  "root": "string (required) — Notion root page title",
  "sections": [
    {
      "title": "string (required) — Page title in Notion",
      "icon": "string (required) — Emoji icon",
      "file": "string (optional) — Relative path to markdown file",
      "source": "ai | human (optional) — Who created this page",
      "children": [ "...nested pages..." ]
    }
  ]
}
```

### Rules
- `root` can be any page name — the system is root-agnostic
- `file` paths are relative to the repo root
- `source` controls cleanup behavior: `human` pages with content are protected
- Nesting is unlimited but > 5 levels may impact performance
- Duplicate titles generate warnings but won't block syncing
- The structure file is validated before every sync

---

## Common Tasks

### Adding a New Page

1. Create the markdown file (e.g., `docs/new-feature.md`)
2. Add an entry to `notion-structure.json`:
```json
{
  "title": "New Feature",
  "icon": "✨",
  "file": "docs/new-feature.md",
  "source": "ai"
}
```
3. Push — the page will be created automatically

### Moving a Page

1. Move the entry in `notion-structure.json` to its new parent
2. Push — the cleanup step will archive the old location, structure sync creates the new one

### Removing a Page

1. Remove the entry from `notion-structure.json`
2. (Optionally) delete the markdown file
3. Push — cleanup will archive the orphaned Notion page

### Reorganizing Sections

1. Rearrange sections in `notion-structure.json`
2. Push — structure sync creates new hierarchy, cleanup archives orphans

### Changing the Root Page

1. Create a new root page in Notion
2. Update `"root"` in `notion-structure.json`
3. Update `NOTION_ROOT_PAGE` env var in Supabase (or just rely on the JSON)
4. Push — all pages will be created under the new root

### Force Full Re-sync

Trigger the workflow manually with `force_full_sync: true`:
```bash
gh workflow run agent-automation.yml -f force_full_sync=true
```

---

## Troubleshooting

### "Root page not found"
- The root page title in `notion-structure.json` must exactly match the Notion page title
- The Notion API integration must have access to the root page (share it with the integration)

### "Page not found" for update-page
- Structure sync must run before content sync
- Ensure `parentPageTitle` is provided so the page can be auto-created
- Check that the parent page exists in Notion

### Pages not appearing
- Notion search API can take a few seconds to index new pages
- The workflow waits 10s after structure sync for this reason
- If still missing, re-run the workflow

### Rate limit errors
- The system has built-in rate limiting (100-200ms between operations)
- For very large syncs (100+ pages), failures will auto-retry up to 3 times
- Reduce batch size by using `targetSection` to sync one section at a time

### Content truncated
- Max 40KB per page content (Notion API limit)
- Code blocks limited to 2000 chars per block (auto-split)
- Very large files will be truncated with a warning

### Duplicate page titles
- The system uses title-based page lookup — duplicate titles cause ambiguity
- Use unique titles across your entire structure
- The validator will warn about duplicates

---

## Metrics

Every sync response includes a `metrics` object:

```json
{
  "metrics": {
    "startTime": 1706000000000,
    "endTime": 1706000015000,
    "durationMs": 15000,
    "pagesProcessed": 12,
    "apiCalls": 45,
    "blocksCreated": 230,
    "blocksFailed": 0
  }
}
```

The workflow summary step prints these at the end of each run.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NOTION_API_KEY` | Yes | Notion integration token |
| `NOTION_ROOT_PAGE` | No | Default root page name (overridden by JSON) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key |

---

## Limitations

| Limitation | Details | Workaround |
|-----------|---------|------------|
| One-way sync | GitHub → Notion only | Bidirectional sync planned |
| No conflict detection | GitHub always wins | Don't edit synced pages in Notion |
| 40KB page limit | Content truncated | Split large docs into multiple pages |
| 2000 char code blocks | Auto-split into chunks | Keep code examples concise |
| Search limit 100 | May miss pages in large workspaces | Use unique, specific page titles |
| Polling only | No real-time sync | Scheduled + push-triggered |
| Full page replace | No incremental block updates | Incremental sync planned |
