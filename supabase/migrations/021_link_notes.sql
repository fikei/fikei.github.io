-- Migration 021: Add notes column to links
-- User-generated annotations on pins (free-text)

ALTER TABLE links ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN links.notes IS 'User-generated free-text notes on a pin';
