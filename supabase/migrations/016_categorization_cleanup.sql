-- Epic 3.6: Categorization Cleanup
-- Add user_reviewed_at column to track when users explicitly confirmed or corrected a pin
-- Pins with user_reviewed_at set are excluded from the cleanup queue

ALTER TABLE links ADD COLUMN user_reviewed_at TIMESTAMPTZ DEFAULT NULL;

-- Index for cleanup queue performance
CREATE INDEX idx_links_user_reviewed ON links(user_id, user_reviewed_at);
