-- ============================================================
-- 035_intent_engine_tables.sql
-- Intent Engine: Session + Journey + Prediction tables (L2-L5)
-- All additive — no existing tables modified
-- ============================================================

-- ============================================================
-- intent_sessions: L2 — temporal pin clusters
-- A session is a group of pins saved within a 60-min rolling
-- window. Minimum 2 pins to form a session. Immutable once
-- computed — represents a historical activity window.
-- ============================================================
CREATE TABLE IF NOT EXISTS intent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  pin_ids TEXT[] NOT NULL DEFAULT '{}',
  category_mix JSONB DEFAULT '{}',
  topic_tags TEXT[] DEFAULT '{}',
  intent_mix JSONB DEFAULT '{}',
  session_length_minutes REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intent_sessions_user ON intent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_intent_sessions_started ON intent_sessions(user_id, started_at DESC);

-- ============================================================
-- intent_journeys: L3 — multi-session goal arcs
-- A journey connects sessions by topic overlap. Mutable —
-- grows as new sessions attach, state evolves over time.
-- hypothesis column holds the L4 LLM goal statement inline.
-- ============================================================
CREATE TABLE IF NOT EXISTS intent_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_ids UUID[] NOT NULL DEFAULT '{}',
  pin_ids TEXT[] NOT NULL DEFAULT '{}',
  topic_tags TEXT[] NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'exploring'
    CHECK (state IN ('exploring', 'researching', 'deciding', 'acquiring', 'done', 'dormant', 'abandoned')),
  hypothesis TEXT,
  confidence REAL DEFAULT 0.3,
  first_pin_at TIMESTAMPTZ NOT NULL,
  last_pin_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intent_journeys_user ON intent_journeys(user_id);
CREATE INDEX IF NOT EXISTS idx_intent_journeys_state ON intent_journeys(user_id, state);
CREATE INDEX IF NOT EXISTS idx_intent_journeys_last_pin ON intent_journeys(user_id, last_pin_at DESC);

-- ============================================================
-- intent_predictions: L5 — actionable suggestions (one per user)
-- Regenerated when journeys change. Short-lived.
-- ============================================================
CREATE TABLE IF NOT EXISTS intent_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  predictions JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  model_version TEXT,
  pin_count_at_generation INTEGER,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_intent_predictions_user ON intent_predictions(user_id);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE intent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY intent_sessions_user ON intent_sessions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY intent_journeys_user ON intent_journeys FOR ALL USING (auth.uid() = user_id);
CREATE POLICY intent_predictions_user ON intent_predictions FOR ALL USING (auth.uid() = user_id);
