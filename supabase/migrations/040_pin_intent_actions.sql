-- ============================================================
-- 040_pin_intent_actions.sql
-- Action tracking columns on pin_intent table
-- Captures when users act on or dismiss intent suggestions.
-- Feeds into the feedback loop for classifier improvement.
-- All additive — no existing columns modified.
-- ============================================================

ALTER TABLE pin_intent ADD COLUMN IF NOT EXISTS acted_at TIMESTAMPTZ;
ALTER TABLE pin_intent ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE pin_intent ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
ALTER TABLE pin_intent ADD COLUMN IF NOT EXISTS dismiss_reason TEXT;
