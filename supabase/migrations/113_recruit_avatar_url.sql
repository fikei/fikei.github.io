-- ============================================
-- Migration 113: resolved avatar per applicant
--
-- The recruit-avatar edge fn probes unavatar (rate-limited, server-side,
-- once per applicant) for the social links we extracted and stores the
-- first working image URL. NULL = not yet checked, '' = checked, none found.
-- Clients render the stored URL directly — no per-browser probing.
-- ============================================

ALTER TABLE recruit_applicants ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;
