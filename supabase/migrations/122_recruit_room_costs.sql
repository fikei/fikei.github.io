-- ============================================
-- Agape recruiting: room costs + global per-person dues
-- Migration 122
--
-- Per-room lease contribution from the "Agape Occupancy & Rent Calculator"
-- sheet (Current System tab, effective July 2026): private share (by sq ft)
-- + public share (equal per room). Food and communal membership dues are the
-- same for every person, so they live in recruit_settings and are editable
-- from the room drawer.
-- ============================================

ALTER TABLE recruit_rooms
  ADD COLUMN IF NOT EXISTS rent_monthly INT,    -- lease total (private + public)
  ADD COLUMN IF NOT EXISTS rent_private INT,    -- sq-ft-weighted share
  ADD COLUMN IF NOT EXISTS rent_public INT;     -- equal per-room share

UPDATE recruit_rooms AS r SET
  rent_monthly = v.lease, rent_private = v.priv, rent_public = v.pub
FROM (VALUES
  (1,  1221, 519,  702),
  (2,  1163, 461,  702),
  (3,  1376, 675,  702),
  (4,  1508, 806,  702),
  (5,  1265, 563,  702),
  (6,  1200, 499,  702),
  (7,  1608, 907,  702),
  (8,  1210, 508,  702),
  (9,  1329, 627,  702),
  (10, 1712, 1011, 702),
  (11, 1294, 592,  702),
  (12, 1519, 817,  702),
  (13, 3112, 2411, 702),
  (14, 984,  984,  0)
) AS v(id, lease, priv, pub)
WHERE r.id = v.id;

-- Global per-person monthly costs (same for everyone).
INSERT INTO recruit_settings (key, value) VALUES
  ('food_monthly', '250'::jsonb),
  ('dues_monthly', '450'::jsonb)
ON CONFLICT (key) DO NOTHING;
