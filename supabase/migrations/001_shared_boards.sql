-- Shared Boards Schema
-- Run this in Supabase SQL Editor

-- ============================================
-- Shared Boards Table
-- ============================================
CREATE TABLE IF NOT EXISTS shared_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Share settings
  slug VARCHAR(32) UNIQUE NOT NULL, -- Short URL identifier (e.g., "abc123")
  name VARCHAR(100), -- Optional display name
  category VARCHAR(50), -- NULL = all categories, otherwise specific category

  -- Visibility: 'link' (anyone with link), 'public' (discoverable), 'private' (invite only)
  visibility VARCHAR(20) NOT NULL DEFAULT 'link' CHECK (visibility IN ('link', 'public', 'private')),

  -- Update mode: 'live' (always current), 'snapshot' (frozen at share time)
  update_mode VARCHAR(20) NOT NULL DEFAULT 'live' CHECK (update_mode IN ('live', 'snapshot')),

  -- For snapshot mode: store link IDs at time of sharing
  snapshot_link_ids UUID[] DEFAULT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure one share per user per category (NULL category = all)
  UNIQUE(user_id, category)
);

-- ============================================
-- Board Views (Analytics)
-- ============================================
CREATE TABLE IF NOT EXISTS board_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES shared_boards(id) ON DELETE CASCADE,

  -- Viewer info (nullable - anonymous views allowed)
  viewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Basic analytics
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  referrer TEXT,
  user_agent TEXT
);

-- Index for fast view counts
CREATE INDEX IF NOT EXISTS idx_board_views_board_id ON board_views(board_id);
CREATE INDEX IF NOT EXISTS idx_board_views_viewed_at ON board_views(viewed_at);

-- ============================================
-- Saved Links (when viewer saves a link)
-- ============================================
-- Uses existing 'links' table - no new table needed
-- When viewer saves, we just add to their links with source metadata

-- ============================================
-- Board Invites (for future private sharing)
-- ============================================
CREATE TABLE IF NOT EXISTS board_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES shared_boards(id) ON DELETE CASCADE,

  email VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer', 'editor')),

  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,

  UNIQUE(board_id, email)
);

-- ============================================
-- RLS Policies
-- ============================================

-- Enable RLS
ALTER TABLE shared_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_invites ENABLE ROW LEVEL SECURITY;

-- Shared Boards Policies
-- Owner can do everything
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can manage own shared boards' AND tablename = 'shared_boards') THEN
    CREATE POLICY "Users can manage own shared boards"
      ON shared_boards FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Anyone can view link/public boards
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view link or public boards' AND tablename = 'shared_boards') THEN
    CREATE POLICY "Anyone can view link or public boards"
      ON shared_boards FOR SELECT
      USING (visibility IN ('link', 'public'));
  END IF;
END $$;

-- Board Views Policies
-- Anyone can insert a view (anonymous tracking)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can record a view' AND tablename = 'board_views') THEN
    CREATE POLICY "Anyone can record a view"
      ON board_views FOR INSERT
      WITH CHECK (true);
  END IF;
END $$;

-- Board owner can see their views
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owners can view their board analytics' AND tablename = 'board_views') THEN
    CREATE POLICY "Owners can view their board analytics"
      ON board_views FOR SELECT
      USING (
        board_id IN (
          SELECT id FROM shared_boards WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Board Invites Policies
-- Owner can manage invites
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Owners can manage invites' AND tablename = 'board_invites') THEN
    CREATE POLICY "Owners can manage invites"
      ON board_invites FOR ALL
      USING (
        board_id IN (
          SELECT id FROM shared_boards WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- Invitees can see their own invites
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can see their invites' AND tablename = 'board_invites') THEN
    CREATE POLICY "Users can see their invites"
      ON board_invites FOR SELECT
      USING (email = auth.email());
  END IF;
END $$;

-- ============================================
-- Helper function: Generate unique slug
-- ============================================
CREATE OR REPLACE FUNCTION generate_board_slug()
RETURNS VARCHAR(32) AS $$
DECLARE
  new_slug VARCHAR(32);
  slug_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate 8 character alphanumeric slug
    new_slug := lower(substring(md5(random()::text) from 1 for 8));

    -- Check if exists
    SELECT EXISTS(SELECT 1 FROM shared_boards WHERE slug = new_slug) INTO slug_exists;

    EXIT WHEN NOT slug_exists;
  END LOOP;

  RETURN new_slug;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- View for board with stats
-- ============================================
CREATE OR REPLACE VIEW shared_boards_with_stats AS
SELECT
  sb.*,
  COUNT(DISTINCT bv.id) as view_count,
  MAX(bv.viewed_at) as last_viewed_at
FROM shared_boards sb
LEFT JOIN board_views bv ON bv.board_id = sb.id
GROUP BY sb.id;
