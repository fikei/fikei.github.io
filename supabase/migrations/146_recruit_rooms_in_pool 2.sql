-- 146: rooms can leave the recruiting pool without being deleted.
--
-- The Studio is a shared basement space, not a bedroom anyone applies for, so
-- its lane on the occupancy timeline was noise — but deleting the room would
-- take its history with it and pretend the space doesn't exist.
--
-- in_pool is the honest distinction: the room is real, it just isn't something
-- the recruiting funnel places people into.
ALTER TABLE recruit_rooms
  ADD COLUMN IF NOT EXISTS in_pool BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN recruit_rooms.in_pool IS
  'False = a real room the recruiting funnel does not place people into (shared spaces). Hidden from the occupancy timeline and room pickers.';

-- The Studio (Basement, 300 sq ft) holds one placeholder "Shared" stay and has
-- never had a listing.
UPDATE recruit_rooms SET in_pool = FALSE WHERE name = 'Studio' AND floor = 'Basement';
