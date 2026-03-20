-- ============================================================
-- 046_suggested_actions.sql
-- Suggested next actions for pins
-- Stores AI-generated next-best-actions from suggest-actions
-- edge function. Additive only — no existing columns modified.
-- ============================================================

ALTER TABLE links ADD COLUMN IF NOT EXISTS suggested_actions JSONB;

CREATE INDEX IF NOT EXISTS idx_links_suggested_actions ON links(user_id)
  WHERE suggested_actions IS NOT NULL;
