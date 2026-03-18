-- ============================================================
-- 042_intent_hypothesis_gaps.sql
-- Gap logging for the hypothesis engine.
-- Records when Pass 2 fails or returns low confidence,
-- building training signal for future model improvement.
-- ============================================================

CREATE TABLE IF NOT EXISTS intent_hypothesis_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_pin_id TEXT,
  pin_count_at_call INTEGER,
  reason TEXT,
  top_tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intent_gaps_user
  ON intent_hypothesis_gaps(user_id, created_at DESC);

ALTER TABLE intent_hypothesis_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY intent_hypothesis_gaps_user
  ON intent_hypothesis_gaps FOR ALL USING (auth.uid() = user_id);
