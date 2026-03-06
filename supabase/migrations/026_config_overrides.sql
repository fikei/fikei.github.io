-- ============================================
-- Config Overrides for Auto-Repair
-- Migration 026
-- Stores AI-suggested parameter overrides permanently until manually cleared.
-- When auto-repair diagnoses a parser parameter issue (e.g. pageSize too large),
-- the fix is saved here so it persists across page loads without expiry.
-- ============================================

ALTER TABLE source_health
  ADD COLUMN IF NOT EXISTS config_overrides JSONB DEFAULT NULL;

COMMENT ON COLUMN source_health.config_overrides IS
  'Permanent AI-suggested parameter overrides (e.g. {"pageSize": 100}). Persists until manually cleared via Reset Repairs.';
