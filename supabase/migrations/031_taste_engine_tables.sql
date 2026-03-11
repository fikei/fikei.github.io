-- ============================================================
-- 030_taste_engine_tables.sql
-- Taste Engine: Multi-level preference model
-- Creates 6 tables for the 5-level taste hierarchy + intent
-- All additive — no existing tables modified
-- ============================================================

-- ============================================================
-- taste_affinities: Level 2 — weighted interest scores
-- Dimensions are freeform strings derived from the user's own
-- tag vocabulary. No predefined taxonomy.
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_affinities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5 CHECK (strength BETWEEN 0 AND 1),
  signal_count INTEGER NOT NULL DEFAULT 1,
  source_tags TEXT[] DEFAULT '{}',
  source_categories TEXT[] DEFAULT '{}',
  signal_type TEXT NOT NULL DEFAULT 'derived',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reinforced TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, dimension)
);

CREATE INDEX IF NOT EXISTS idx_affinities_user ON taste_affinities(user_id);
CREATE INDEX IF NOT EXISTS idx_affinities_strength ON taste_affinities(user_id, strength DESC);

-- ============================================================
-- taste_domains: Level 3 — emergent taste clusters
-- NOT locked to board categories. A domain can span any
-- combination of categories.
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  summary TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  constituent_affinities TEXT[] NOT NULL DEFAULT '{}',
  spanning_categories TEXT[] DEFAULT '{}',
  pin_ids UUID[] DEFAULT '{}',
  signal_count INTEGER NOT NULL DEFAULT 1,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reinforced TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_user ON taste_domains(user_id);

-- ============================================================
-- taste_axes: Level 4 — continuous aesthetic dimensions
-- Starts with seed axes but can grow as the engine discovers
-- new dimensions in the user's data.
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_axes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  axis TEXT NOT NULL,
  position REAL NOT NULL DEFAULT 0.5 CHECK (position BETWEEN 0 AND 1),
  low_label TEXT NOT NULL,
  high_label TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  contributing_tags TEXT[] DEFAULT '{}',
  is_seed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, axis)
);

CREATE INDEX IF NOT EXISTS idx_axes_user ON taste_axes(user_id);

-- ============================================================
-- taste_summaries: LLM-injectable natural language
-- Scoped to domains or global
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  pin_count_at_generation INTEGER NOT NULL,
  source_snapshot JSONB DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  model_version TEXT,
  UNIQUE(user_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_summaries_user ON taste_summaries(user_id);

-- ============================================================
-- taste_snapshots: Monthly preference state for drift detection
-- ============================================================
CREATE TABLE IF NOT EXISTS taste_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  affinities JSONB NOT NULL,
  domains JSONB NOT NULL,
  axes JSONB NOT NULL,
  pin_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user ON taste_snapshots(user_id);

-- ============================================================
-- pin_intent: Per-pin intent and action state
-- Parallel to taste (which is per-user). Intent is per-pin.
-- ============================================================
CREATE TABLE IF NOT EXISTS pin_intent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  intent TEXT NOT NULL DEFAULT 'appreciate' CHECK (intent IN ('acquire', 'reference', 'appreciate')),
  action_state TEXT NOT NULL DEFAULT 'unprocessed' CHECK (action_state IN ('unprocessed', 'active', 'done', 'archived')),
  horizon TEXT DEFAULT 'someday' CHECK (horizon IN ('now', 'soon', 'someday', 'ongoing')),
  confidence REAL NOT NULL DEFAULT 0.3,
  inferred_from TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, link_id)
);

CREATE INDEX IF NOT EXISTS idx_pin_intent_user ON pin_intent(user_id);
CREATE INDEX IF NOT EXISTS idx_pin_intent_intent ON pin_intent(user_id, intent);
CREATE INDEX IF NOT EXISTS idx_pin_intent_action ON pin_intent(user_id, action_state);

-- ============================================================
-- Row Level Security — all tables user-scoped
-- ============================================================
ALTER TABLE taste_affinities ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_axes ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_intent ENABLE ROW LEVEL SECURITY;

CREATE POLICY taste_affinities_user ON taste_affinities FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_domains_user ON taste_domains FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_axes_user ON taste_axes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_summaries_user ON taste_summaries FOR ALL USING (auth.uid() = user_id);
CREATE POLICY taste_snapshots_user ON taste_snapshots FOR ALL USING (auth.uid() = user_id);
CREATE POLICY pin_intent_user ON pin_intent FOR ALL USING (auth.uid() = user_id);
