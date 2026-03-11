-- ============================================================
-- 032_fix_pin_ids_type.sql
-- Fix: taste_domains.pin_ids must be TEXT[] not UUID[]
-- links.id is TEXT (mixed short IDs + UUIDs), so pin_ids
-- cannot be UUID[].
-- ============================================================

ALTER TABLE taste_domains ALTER COLUMN pin_ids TYPE TEXT[] USING pin_ids::TEXT[];
