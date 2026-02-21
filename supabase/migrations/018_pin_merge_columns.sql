-- Pin Merge System
-- Adds columns for tracking merged/duplicate pins

ALTER TABLE links ADD COLUMN IF NOT EXISTS is_merged BOOLEAN DEFAULT FALSE;
ALTER TABLE links ADD COLUMN IF NOT EXISTS sources JSONB DEFAULT NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS merged_at TIMESTAMPTZ DEFAULT NULL;
