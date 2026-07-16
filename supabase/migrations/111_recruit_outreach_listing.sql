-- ============================================
-- Migration 111: attach an outreach decision to a listing
--
-- Moving an applicant to Outreach can target a specific open listing
-- (a sublet window or a resident trial). listing_id NULL on an outreach
-- decision means General interest — kept warm for future room availability.
-- ============================================

ALTER TABLE recruit_decisions
  ADD COLUMN IF NOT EXISTS listing_id UUID REFERENCES recruit_listings(id) ON DELETE SET NULL;
