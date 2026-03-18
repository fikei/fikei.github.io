-- ============================================================
-- 041_intent_hypotheses.sql
-- Hypothesis engine (Pass 2) output storage.
-- Stores pattern-level hypotheses about user intent across
-- multiple pins. V1: logged only, not surfaced in UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS intent_hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_pin_id TEXT REFERENCES links(id) ON DELETE SET NULL,
  hypotheses JSONB NOT NULL DEFAULT '[]',
  confidence REAL,
  model_version TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  acted_at TIMESTAMPTZ,
  action_type TEXT,
  dismissed_at TIMESTAMPTZ,
  dismiss_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_intent_hypotheses_user
  ON intent_hypotheses(user_id, generated_at DESC);

ALTER TABLE intent_hypotheses ENABLE ROW LEVEL SECURITY;

CREATE POLICY intent_hypotheses_user
  ON intent_hypotheses FOR ALL USING (auth.uid() = user_id);
