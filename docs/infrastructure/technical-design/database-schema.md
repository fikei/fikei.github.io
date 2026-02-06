# Database Schema

> Complete schema reference for all Supabase PostgreSQL tables

---

## Overview

The database spans two Supabase projects and six migrations. All tables use UUIDs as primary keys and have RLS enabled.

| Project | Ref ID | Tables |
|---------|--------|--------|
| **Boards** | `yfhudwakpgzswiylhfbh` | links, link_order, expanded_cards, shared_boards, board_views, board_invites, content_types, domain_profiles, classification_log, image_strategies, strategy_performance |
| **Ops** | `ycilriwjnmcelkspmfmg` | sync_state, block_state, sync_log, structure_state |
| **Systemic** | `atdqdfpdeytfuvvpsasz` | audit_jobs, design_systems, design_tokens, design_components, crawl_pages, ghost_components, component_relationships |

---

## Core Tables (User Data)

### links

Primary pin storage. One row per saved URL per user.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK | Hash of URL |
| `user_id` | uuid | NOT NULL | FK → auth.users(id) |
| `url` | text | | Normalized URL |
| `title` | text | | From OG tags or generated |
| `description` | text | | From meta tags |
| `image` | text | | Hero image URL |
| `domain` | text | | Extracted hostname |
| `category` | text | | home, wear, watch, use, eat, go, follow, read |
| `confidence` | numeric | | Category confidence (0-1) |
| `created_at` | timestamptz | | When pin was added |
| `updated_at` | timestamptz | | Last modification |
| `content_type` | text | `'unknown'` | product, article, video, etc. (migration 003) |
| `type_confidence` | real | | Content type confidence (migration 003) |
| `type_signals` | jsonb | `'[]'` | Classification signals (migration 003) |
| `image_source` | text | `'scraped'` | scraped, platform, searched, generated, template (migration 004) |
| `image_method` | text | | Resolution method used (migration 004) |
| `image_resolved_at` | timestamptz | | When image was resolved (migration 004) |

**RLS**: Owner-only access (`auth.uid() = user_id`)

**Source**: `boards/index.html` ~L6202, `supabase/migrations/003_content_type_system.sql`, `supabase/migrations/004_image_resolution_system.sql`

### link_order

Persists the order of pins per user. One row per user.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `user_id` | uuid | PK | FK → auth.users(id) |
| `order_ids` | uuid[] | | Ordered array of link IDs |

**RLS**: Owner-only access

**Source**: `boards/index.html` ~L6225

### expanded_cards

Persists which cards are expanded/collapsed per user. One row per user.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `user_id` | uuid | PK | FK → auth.users(id) |
| `cards` | jsonb | | Map of card ID → expansion state |

**RLS**: Owner-only access

**Source**: `boards/index.html` ~L6121

---

## Sharing Tables (Migration 001, 002)

**Source**: `supabase/migrations/001_shared_boards.sql`, `supabase/migrations/002_*.sql`

### shared_boards

Board sharing configuration. One row per shared board.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `user_id` | uuid | NOT NULL | FK → auth.users(id) ON DELETE CASCADE |
| `slug` | varchar(32) | UNIQUE, NOT NULL | URL slug (e.g., "abc123") |
| `name` | varchar(100) | | Display name |
| `category` | varchar(50) | | NULL = all categories |
| `visibility` | varchar(20) | `'link'` | CHECK: link, public, private |
| `update_mode` | varchar(20) | `'live'` | CHECK: live, snapshot |
| `snapshot_link_ids` | uuid[] | | Frozen set of links (snapshot mode) |
| `expanded_cards` | jsonb | `'{}'` | Card expansion state for shared view (migration 002) |
| `link_order` | text[] | `'{}'` | Pin order for shared view (migration 002) |
| `owner_email` | text | | Denormalized for display (migration 002) |
| `created_at` | timestamptz | NOW() | |
| `updated_at` | timestamptz | NOW() | |

**Constraints**: UNIQUE(user_id, category)

**RLS**:
- Owner: full access (`auth.uid() = user_id`)
- Public: SELECT where `visibility IN ('link', 'public')`

**Helper function**: `generate_board_slug()` — generates 8-char alphanumeric slug

### board_views

Analytics for shared board visits.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `board_id` | uuid | NOT NULL | FK → shared_boards(id) ON DELETE CASCADE |
| `viewer_id` | uuid | | FK → auth.users(id) ON DELETE SET NULL (nullable for anonymous) |
| `viewed_at` | timestamptz | NOW() | |
| `referrer` | text | | HTTP referrer |
| `user_agent` | text | | Browser user agent |

**Indexes**: `idx_board_views_board_id`, `idx_board_views_viewed_at`

**RLS**: Anyone can INSERT (anonymous view tracking). Owner can SELECT their board's views.

### board_invites

Access invitations for private boards.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `board_id` | uuid | NOT NULL | FK → shared_boards(id) ON DELETE CASCADE |
| `email` | varchar(255) | NOT NULL | Invitee email |
| `role` | varchar(20) | `'viewer'` | CHECK: viewer, editor |
| `invited_at` | timestamptz | NOW() | |
| `accepted_at` | timestamptz | | NULL until accepted |

**Constraints**: UNIQUE(board_id, email)

**RLS**: Owner manages, invitee can see own invites (`email = auth.email()`)

### shared_boards_with_stats (View)

Aggregates shared_boards with view counts.

```sql
SELECT sb.*, COUNT(bv.id) as view_count, MAX(bv.viewed_at) as last_viewed_at
FROM shared_boards sb LEFT JOIN board_views bv ON sb.id = bv.board_id
GROUP BY sb.id
```

---

## Content Classification Tables (Migration 003)

**Source**: `supabase/migrations/003_content_type_system.sql`

### content_types

Registry of known content types.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `name` | text | UNIQUE, NOT NULL | product, article, video, etc. |
| `definition` | text | NOT NULL | Human-readable description |
| `status` | text | `'builtin'` | CHECK: builtin, discovered, proposed |
| `signals` | jsonb | `'{}'` | `{ domains: [], url_patterns: [], keywords: [] }` |
| `sample_count` | integer | 0 | How many links classified as this type |
| `discovered_at` | timestamptz | | When type was first seen |
| `created_at` | timestamptz | NOW() | |
| `updated_at` | timestamptz | NOW() | |

**Builtin types**: product, article, video, music, repository, social, document, tool, unknown

**RLS**: Readable by all. No public writes.

### domain_profiles

Learned domain → content type mappings. The key optimization for skipping AI calls.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `domain` | text | UNIQUE, NOT NULL | e.g., "nike.com" |
| `classification` | text | `'unknown'` | CHECK: single_type, multi_type, unknown |
| `primary_type` | text | | FK → content_types(name) |
| `path_patterns` | jsonb | `'[]'` | URL path → type mappings |
| `types_seen` | jsonb | `'{}'` | `{ "product": 12, "article": 1 }` |
| `path_samples` | jsonb | `'[]'` | Example paths per type |
| `sample_count` | integer | 0 | Total classifications for this domain |
| `confidence` | real | 0 | Overall confidence (0-1) |
| `created_at` | timestamptz | NOW() | |
| `updated_at` | timestamptz | NOW() | |

**Index**: `idx_domain_profiles_domain`

**RLS**: Readable by all. Authenticated users can upsert.

### classification_log

Audit trail for content type decisions. Used to train future improvements.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `link_id` | uuid | | Reference to classified link |
| `user_id` | uuid | | Who triggered classification |
| `url` | text | NOT NULL | |
| `domain` | text | NOT NULL | |
| `path` | text | NOT NULL | |
| `title` | text | | |
| `description` | text | | |
| `predicted_type` | text | | FK → content_types(name) |
| `confidence` | real | | |
| `signals` | jsonb | `'[]'` | What signals led to this classification |
| `is_uncertain` | boolean | false | Flagged for human review |
| `user_override` | text | | If user corrected the classification |
| `created_at` | timestamptz | NOW() | |

**Index**: `idx_classification_log_uncertain` (partial: `is_uncertain = true`)

**RLS**: Users see own logs only.

---

## Image Resolution Tables (Migration 004)

**Source**: `supabase/migrations/004_image_resolution_system.sql`

### image_strategies

Defines how to find images per content type.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `content_type` | text | NOT NULL | FK → content_types(name) |
| `name` | text | NOT NULL | Strategy name |
| `pipeline` | jsonb | NOT NULL | `[{ method, config, timeout_ms }]` |
| `card_template` | text | `'image_dominant'` | CHECK: image_dominant, text_dominant, hybrid, icon_based |
| `style` | jsonb | `'{}'` | Rendering style overrides |
| `is_active` | boolean | true | |
| `created_at` | timestamptz | NOW() | |
| `updated_at` | timestamptz | NOW() | |

**Constraints**: UNIQUE(content_type, name)

**RLS**: Readable by all.

### strategy_performance

Tracks success/failure rates per image resolution strategy.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK, gen_random_uuid() | |
| `content_type` | text | NOT NULL | FK → content_types(name) |
| `strategy_name` | text | NOT NULL | |
| `method_used` | text | NOT NULL | scrape, platform, search, template |
| `success_count` | integer | 0 | |
| `failure_count` | integer | 0 | |
| `override_count` | integer | 0 | User replaced the image |
| `total_time_ms` | bigint | 0 | Cumulative resolution time |
| `period_start` | date | NOT NULL | |
| `period_end` | date | NOT NULL | |
| `created_at` | timestamptz | NOW() | |

**Constraints**: UNIQUE(content_type, strategy_name, method_used, period_start)

**Index**: `idx_strategy_performance_period`

**RLS**: Readable by all. Service role inserts.

---

## Systemic Tables (Migration 005)

**Source**: `supabase/migrations/005_systemic_ai.sql`

Design system analysis tables for the Systemic tool.

### audit_jobs

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK | |
| `url` | text | NOT NULL | Target site to analyze |
| `name` | text | | Job name |
| `status` | text | `'pending'` | CHECK: pending, crawling, analyzing, complete, failed |
| `config` | jsonb | `'{}'` | |
| `progress` | jsonb | `'{...}'` | `{ pagesCrawled, pagesTotal, tokensExtracted, componentsFound }` |
| `error_message` | text | | |
| `created_at` | timestamptz | NOW() | |
| `started_at` | timestamptz | | |
| `completed_at` | timestamptz | | |

### design_systems, design_tokens, design_components, crawl_pages, ghost_components, component_relationships

See `supabase/migrations/005_systemic_ai.sql` for full definitions. These support the design system reverse-engineering tool and are not part of the core Boards product.

---

## Notion Sync Tables (Migration 006)

**Source**: `supabase/migrations/006_notion_sync_state.sql`

Located in the **Ops** Supabase project.

### sync_state

Tracks which markdown files have been synced to Notion.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `page_path` | text | PK | e.g., "docs/execution/BUGS.md" |
| `notion_page_id` | text | | Notion page UUID |
| `github_hash` | text | | MD5 of markdown content |
| `notion_last_edited` | timestamptz | | |
| `last_synced_at` | timestamptz | | |
| `sync_direction` | text | `'bidirectional'` | CHECK: bidirectional, github-only, notion-only |
| `block_count` | integer | 0 | |
| `source` | text | `'ai'` | CHECK: ai, human |
| `created_at` | timestamptz | NOW() | |
| `updated_at` | timestamptz | NOW() | |

### block_state

Per-block sync state for incremental updates.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `block_id` | text | PK | Notion block UUID |
| `page_path` | text | | FK → sync_state(page_path) ON DELETE CASCADE |
| `content_hash` | text | | |
| `block_type` | text | | |
| `position` | integer | | |
| `parent_block_id` | text | | |
| `markdown_line_start` | integer | | |
| `markdown_line_end` | integer | | |
| `last_synced_at` | timestamptz | | |
| `created_at` | timestamptz | NOW() | |

### sync_log

Audit trail for all sync operations.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | serial | PK | |
| `operation` | text | NOT NULL | CHECK: structure, content, conflict, cleanup |
| `page_path` | text | | |
| `direction` | text | | CHECK: github_to_notion, notion_to_github, structure_only |
| `status` | text | NOT NULL | CHECK: success, failed, skipped, conflict |
| `blocks_changed` | integer | 0 | |
| `details` | jsonb | `'{}'` | |
| `created_at` | timestamptz | NOW() | |

### structure_state

Single-row table tracking the last synced `notion-structure.json` hash.

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | integer | PK, DEFAULT 1 | CHECK (id = 1) — singleton |
| `structure_hash` | text | | MD5 of notion-structure.json |
| `last_synced_at` | timestamptz | | |
| `page_count` | integer | 0 | |
| `updated_at` | timestamptz | NOW() | |

**Helper functions**: `get_dirty_pages()`, `log_sync()`

**RLS**: Service role only (all operations via edge function).

---

## Entity Relationship Diagram

```
auth.users
    │
    ├──< links (user_id)
    │       │
    │       └──> content_types (content_type → name)
    │
    ├──< link_order (user_id)
    │
    ├──< expanded_cards (user_id)
    │
    └──< shared_boards (user_id)
            │
            ├──< board_views (board_id)
            │
            └──< board_invites (board_id)

content_types
    │
    ├──< domain_profiles (primary_type → name)
    │
    ├──< classification_log (predicted_type → name)
    │
    ├──< image_strategies (content_type → name)
    │
    └──< strategy_performance (content_type → name)

audit_jobs
    │
    ├──< design_systems (audit_job_id)
    │       │
    │       ├──< design_tokens (design_system_id)
    │       ├──< design_components (design_system_id)
    │       └──< ghost_components (design_system_id)
    │
    └──< crawl_pages (audit_job_id)

design_components
    │
    └──< component_relationships (component_id, related_component_id)

sync_state
    │
    └──< block_state (page_path)
```

---

## Migration Files

| Migration | File | Tables Added |
|-----------|------|-------------|
| 001 | `supabase/migrations/001_shared_boards.sql` | shared_boards, board_views, board_invites |
| 002 | `supabase/migrations/002_*.sql` | (alters shared_boards) |
| 003 | `supabase/migrations/003_content_type_system.sql` | content_types, domain_profiles, classification_log |
| 004 | `supabase/migrations/004_image_resolution_system.sql` | image_strategies, strategy_performance |
| 005 | `supabase/migrations/005_systemic_ai.sql` | audit_jobs, design_systems, design_tokens, design_components, crawl_pages, ghost_components, component_relationships |
| 006 | `supabase/migrations/006_notion_sync_state.sql` | sync_state, block_state, sync_log, structure_state |

---

*Last updated: 2026-02-05*
