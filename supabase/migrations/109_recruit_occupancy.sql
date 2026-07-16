-- ============================================
-- Agape recruiting: rooms, occupancy, listings
-- Migration 109
--
-- Models the "Agape Occupancy & Rent Calculator" sheet (2026 tab) for the
-- /applications viewer:
-- 1. recruit_rooms — the 14 rooms, sheet order preserved.
-- 2. recruit_occupancy — one row per room per month. kind classifies the
--    occupant: resident (canonical), sublet (short-term), candidate
--    (resident candidate on trial), shared (Studio), vacant (empty / "?").
-- 3. recruit_listings — a sublet or resident opening for a room over a
--    future window. Created from occupancy gaps, from marking a resident
--    as leaving, or manually. status: open → filled | closed.
-- All gated on is_recruiting_member(); members can write occupancy and
-- listings (shared house state, like decisions).
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_rooms (
  id INT PRIMARY KEY,
  name TEXT NOT NULL,
  floor TEXT DEFAULT '',
  resident TEXT DEFAULT '',          -- canonical resident label from the sheet
  sort INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recruit_occupancy (
  room_id INT NOT NULL REFERENCES recruit_rooms(id) ON DELETE CASCADE,
  month DATE NOT NULL,               -- first of month
  occupant TEXT DEFAULT '',          -- as written in the sheet ("Sam / ?")
  kind TEXT NOT NULL DEFAULT 'vacant'
    CHECK (kind IN ('resident', 'sublet', 'candidate', 'shared', 'vacant')),
  PRIMARY KEY (room_id, month)
);

CREATE TABLE IF NOT EXISTS recruit_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id INT NOT NULL REFERENCES recruit_rooms(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'sublet' CHECK (kind IN ('sublet', 'resident')),
  starts_on DATE NOT NULL,
  ends_on DATE,                      -- null = open-ended (resident search)
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'filled', 'closed')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('gap', 'leaving', 'manual')),
  notes TEXT DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recruit_listings_room ON recruit_listings(room_id, status);

ALTER TABLE recruit_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruit_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruiting members read rooms" ON recruit_rooms
  FOR SELECT TO authenticated USING (is_recruiting_member());

CREATE POLICY "Recruiting members read occupancy" ON recruit_occupancy
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members write occupancy" ON recruit_occupancy
  FOR ALL TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());

CREATE POLICY "Recruiting members read listings" ON recruit_listings
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members insert listings" ON recruit_listings
  FOR INSERT TO authenticated
  WITH CHECK (is_recruiting_member() AND created_by = auth.uid());
CREATE POLICY "Recruiting members update listings" ON recruit_listings
  FOR UPDATE TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());
CREATE POLICY "Recruiting members delete listings" ON recruit_listings
  FOR DELETE TO authenticated USING (is_recruiting_member());
