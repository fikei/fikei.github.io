-- Notion Sync State Schema
-- Phase 1: Efficient Content Sync - State tracking for hash-based change detection

-- Sync State: Track per-page sync status and hashes
CREATE TABLE IF NOT EXISTS sync_state (
  page_path TEXT PRIMARY KEY,              -- GitHub file path (e.g., docs/execution/BUGS.md)
  notion_page_id TEXT,                     -- Notion page UUID
  github_hash TEXT,                        -- MD5 hash of markdown content
  notion_last_edited TIMESTAMPTZ,          -- last_edited_time from Notion API
  last_synced_at TIMESTAMPTZ,              -- When we last synced this page
  sync_direction TEXT DEFAULT 'bidirectional' CHECK (sync_direction IN ('bidirectional', 'github-only', 'notion-only')),
  block_count INTEGER DEFAULT 0,           -- Number of blocks in Notion page
  source TEXT DEFAULT 'ai' CHECK (source IN ('ai', 'human')),  -- Page ownership
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Block State: Track individual blocks for incremental sync
CREATE TABLE IF NOT EXISTS block_state (
  block_id TEXT PRIMARY KEY,               -- Notion block UUID
  page_path TEXT REFERENCES sync_state(page_path) ON DELETE CASCADE,
  content_hash TEXT,                       -- MD5 hash of block content
  block_type TEXT,                         -- paragraph, heading_1, table, etc.
  position INTEGER,                        -- Order within parent
  parent_block_id TEXT,                    -- Parent block (null if direct child of page)
  markdown_line_start INTEGER,             -- Map to source file line
  markdown_line_end INTEGER,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_block_state_page ON block_state(page_path);
CREATE INDEX IF NOT EXISTS idx_block_state_parent ON block_state(parent_block_id);

-- Sync Log: Audit trail of sync operations
CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('structure', 'content', 'conflict', 'cleanup')),
  page_path TEXT,
  direction TEXT CHECK (direction IN ('github_to_notion', 'notion_to_github', 'structure_only')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped', 'conflict')),
  blocks_changed INTEGER DEFAULT 0,
  details JSONB DEFAULT '{}'::jsonb,       -- Additional context (error messages, diff summary)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_log_page ON sync_log(page_path);
CREATE INDEX IF NOT EXISTS idx_sync_log_created ON sync_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(status);

-- Structure State: Track notion-structure.json hash
CREATE TABLE IF NOT EXISTS structure_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- Single row table
  structure_hash TEXT,                     -- MD5 of notion-structure.json
  last_synced_at TIMESTAMPTZ,
  page_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize structure state
INSERT INTO structure_state (id, structure_hash, last_synced_at, page_count)
VALUES (1, NULL, NULL, 0)
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE block_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE structure_state ENABLE ROW LEVEL SECURITY;

-- Policies for service role access (notion-sync function uses service key)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access' AND tablename = 'sync_state') THEN
    CREATE POLICY "Allow service role full access" ON sync_state FOR ALL USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access' AND tablename = 'block_state') THEN
    CREATE POLICY "Allow service role full access" ON block_state FOR ALL USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access' AND tablename = 'sync_log') THEN
    CREATE POLICY "Allow service role full access" ON sync_log FOR ALL USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow service role full access' AND tablename = 'structure_state') THEN
    CREATE POLICY "Allow service role full access" ON structure_state FOR ALL USING (true);
  END IF;
END $$;

-- Function to update sync_state.updated_at
CREATE OR REPLACE FUNCTION update_sync_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sync_state_updated_at') THEN
    CREATE TRIGGER sync_state_updated_at
      BEFORE UPDATE ON sync_state
      FOR EACH ROW EXECUTE FUNCTION update_sync_state_timestamp();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'structure_state_updated_at') THEN
    CREATE TRIGGER structure_state_updated_at
      BEFORE UPDATE ON structure_state
      FOR EACH ROW EXECUTE FUNCTION update_sync_state_timestamp();
  END IF;
END $$;

-- Helper function: Get pages that need sync (changed since last sync)
CREATE OR REPLACE FUNCTION get_dirty_pages()
RETURNS TABLE (
  page_path TEXT,
  notion_page_id TEXT,
  github_changed BOOLEAN,
  notion_changed BOOLEAN,
  last_synced_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.page_path,
    s.notion_page_id,
    -- GitHub changed if hash doesn't match (caller must provide current hash)
    FALSE as github_changed,
    -- Notion changed if last_edited > last_synced
    COALESCE(s.notion_last_edited > s.last_synced_at, TRUE) as notion_changed,
    s.last_synced_at
  FROM sync_state s
  WHERE s.notion_last_edited > s.last_synced_at
     OR s.last_synced_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Helper function: Log a sync operation
CREATE OR REPLACE FUNCTION log_sync(
  p_operation TEXT,
  p_page_path TEXT,
  p_direction TEXT,
  p_status TEXT,
  p_blocks_changed INTEGER DEFAULT 0,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER AS $$
DECLARE
  log_id INTEGER;
BEGIN
  INSERT INTO sync_log (operation, page_path, direction, status, blocks_changed, details)
  VALUES (p_operation, p_page_path, p_direction, p_status, p_blocks_changed, p_details)
  RETURNING id INTO log_id;
  RETURN log_id;
END;
$$ LANGUAGE plpgsql;
