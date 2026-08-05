-- ============================================
-- Migration 163: Manual house-visit confirmation
--
-- A housemate can now set the visit time directly in the app instead of
-- waiting for the ask → reply → poll cycle. The manual path books a real
-- calendar event on the house calendar (the poll path only emails), so
-- the tour row learns to remember which event it created and who set it.
-- ============================================

ALTER TABLE recruit_tours ADD COLUMN IF NOT EXISTS gcal_event_id TEXT;
ALTER TABLE recruit_tours ADD COLUMN IF NOT EXISTS confirmed_by_name TEXT;
