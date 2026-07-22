-- ============================================
-- Agape recruiting: date-based stays + room details
-- Migration 120
--
-- 1. recruit_stays replaces the month-grid recruit_occupancy as the source
--    of truth for who is in a room and when. A stay is a continuous stretch
--    with exact dates; ends_on NULL = open-ended (current resident).
--    recruit_occupancy is kept (not dropped) but no longer written by the app.
-- 2. recruit_rooms gains the room-detail columns from the
--    "Agape Occupancy & Rent Calculator" sheet (Private Room Data tab):
--    square footage, closet, ceiling height, share of private space, notes.
-- ============================================

CREATE TABLE IF NOT EXISTS recruit_stays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id INT NOT NULL REFERENCES recruit_rooms(id) ON DELETE CASCADE,
  occupant TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'resident'
    CHECK (kind IN ('resident', 'sublet', 'candidate', 'shared')),
  starts_on DATE NOT NULL,
  ends_on DATE,                       -- NULL = open-ended
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS idx_recruit_stays_room ON recruit_stays(room_id, starts_on);

ALTER TABLE recruit_stays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruiting members read stays" ON recruit_stays
  FOR SELECT TO authenticated USING (is_recruiting_member());
CREATE POLICY "Recruiting members write stays" ON recruit_stays
  FOR ALL TO authenticated
  USING (is_recruiting_member()) WITH CHECK (is_recruiting_member());

-- Backfill from the 2026 month grid: contiguous months with the same
-- occupant + kind collapse into one stay. Resident/shared stretches that run
-- through Dec 2026 are treated as ongoing (open-ended) — the Dec cutoff was
-- an artifact of the year-bounded grid, not a real move-out date.
INSERT INTO recruit_stays (room_id, occupant, kind, starts_on, ends_on)
SELECT room_id, occupant, kind, MIN(month),
  CASE WHEN MAX(month) = DATE '2026-12-01' AND kind IN ('resident', 'shared')
       THEN NULL
       ELSE (MAX(month) + INTERVAL '1 month - 1 day')::date END
FROM (
  SELECT o.*,
    o.month - (INTERVAL '1 month' * ROW_NUMBER() OVER (
      PARTITION BY o.room_id, o.occupant, o.kind ORDER BY o.month)) AS grp
  FROM recruit_occupancy o
  WHERE o.kind <> 'vacant' AND (o.occupant <> '' OR o.kind = 'shared')
) runs
WHERE NOT EXISTS (SELECT 1 FROM recruit_stays)
GROUP BY room_id, occupant, kind, grp;

-- Room details from the sheet (names excluded by design).
ALTER TABLE recruit_rooms
  ADD COLUMN IF NOT EXISTS sqft INT,
  ADD COLUMN IF NOT EXISTS closet_sqft INT,
  ADD COLUMN IF NOT EXISTS total_sqft INT,
  ADD COLUMN IF NOT EXISTS cubic_ft INT,
  ADD COLUMN IF NOT EXISTS ceiling_ft NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS pct_private NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS details_notes TEXT NOT NULL DEFAULT '';

UPDATE recruit_rooms AS r SET
  sqft = v.sqft, closet_sqft = v.closet_sqft, total_sqft = v.total_sqft,
  cubic_ft = v.cubic_ft, ceiling_ft = v.ceiling_ft, pct_private = v.pct_private,
  details_notes = v.details_notes
FROM (VALUES
  (1,  141, 17,  158, 1740, 11.00, 4.56,  'Take into account shelfing, measure ceiling height'),
  (2,  113, 11,  140, NULL, 11.00, 4.05,  'Asset value adjusts for reduction of living space'),
  (3,  206, 0,   206, 2055, 10.00, 5.93,  ''),
  (4,  226, 20,  246, 2455, 10.00, 7.08,  ''),
  (5,  154, 17,  172, 1716, 10.00, 4.95,  ''),
  (6,  136, 16,  152, 1493, 9.83,  4.38,  ''),
  (7,  257, 19,  276, 2762, 10.00, 7.97,  ''),
  (8,  115, 40,  155, 1445, 9.33,  4.47,  ''),
  (9,  159, 32,  191, 1910, 10.00, 5.51,  ''),
  (10, 299, 9,   308, 3079, 10.00, 8.88,  ''),
  (11, 156, 24,  180, 1413, 7.83,  5.20,  ''),
  (12, 239, 10,  249, 1949, 7.83,  7.18,  ''),
  (13, 475, 295, 734, NULL, NULL,  21.18, 'Closet value adjusts for reduction of living space'),
  (14, 300, 118, 300, 2222, 7.42,  8.64,  '')
) AS v(id, sqft, closet_sqft, total_sqft, cubic_ft, ceiling_ft, pct_private, details_notes)
WHERE r.id = v.id;
