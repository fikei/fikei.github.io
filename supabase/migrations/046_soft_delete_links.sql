-- Add soft-delete support to links table.
-- Instead of hard-deleting rows, set deleted_at = now().
-- fetchFromSupabase filters deleted_at=is.null so deleted pins never return.
-- This fixes the bug where deleted pins resurrect on other devices because
-- tombstones were only stored in localStorage (device-local).

ALTER TABLE links ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Index for efficient filtering of non-deleted links
CREATE INDEX IF NOT EXISTS idx_links_deleted_at ON links (deleted_at) WHERE deleted_at IS NULL;

-- Soft-delete the 4 known zombie pins immediately
UPDATE links SET deleted_at = now() WHERE id IN ('0vmuiqn4', 'nxfql1nz', 'zu922eiy', 'e00rxh0c');
