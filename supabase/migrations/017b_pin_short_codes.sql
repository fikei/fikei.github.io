-- Add short_code column to links for branded pin share links (ctrl.rodeo/p/{code})
-- Generated on first share, not on link creation, to avoid unnecessary overhead.

ALTER TABLE links
ADD COLUMN IF NOT EXISTS short_code TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_links_short_code ON links (short_code) WHERE short_code IS NOT NULL;

COMMENT ON COLUMN links.short_code IS '8-char alphanumeric code for branded share links (ctrl.rodeo/p/{code})';
