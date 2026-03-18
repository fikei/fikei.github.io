-- ============================================================
-- 039_intent_classification.sql
-- Intent classification columns on links table
-- Stores the result of classify-intent (Pass 1) directly on
-- the pin for fast rendering without extra joins.
-- All additive — no existing columns modified.
-- ============================================================

ALTER TABLE links ADD COLUMN IF NOT EXISTS intent_type TEXT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS intent_confidence REAL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS intent_metadata JSONB;
ALTER TABLE links ADD COLUMN IF NOT EXISTS intent_classified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_links_intent_type ON links(user_id, intent_type)
  WHERE intent_type IS NOT NULL;
