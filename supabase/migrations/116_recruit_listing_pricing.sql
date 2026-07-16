-- ============================================
-- Migration 116: per-listing pricing
-- Rent + house dues (communal goods) + shared groceries, matching the
-- structure in the house's room-ad copy. NULL = not set yet.
-- ============================================

ALTER TABLE recruit_listings ADD COLUMN IF NOT EXISTS rent_monthly INT CHECK (rent_monthly BETWEEN 0 AND 10000);
ALTER TABLE recruit_listings ADD COLUMN IF NOT EXISTS dues_monthly INT CHECK (dues_monthly BETWEEN 0 AND 5000);
ALTER TABLE recruit_listings ADD COLUMN IF NOT EXISTS groceries_monthly INT CHECK (groceries_monthly BETWEEN 0 AND 5000);
