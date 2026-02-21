-- Phase 12 Prerequisites: Lookback Interaction Tracking Schema
--
-- Adds columns and tables to support tracking user interactions with pins
-- for the Lookback feature's scoring algorithms.

-- Add last_interacted_at column to links table
ALTER TABLE links ADD COLUMN last_interacted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient lookback queries (user's pins with no interaction)
CREATE INDEX idx_links_last_interacted ON links(user_id, last_interacted_at);

-- Interaction log for detailed analytics (future use)
CREATE TABLE pin_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  link_id UUID REFERENCES links NOT NULL,
  interaction_type TEXT NOT NULL, -- 'click', 'expand', 'share', 'lookback_view', 'lookback_dismiss'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX idx_pin_interactions_link ON pin_interactions(link_id);
CREATE INDEX idx_pin_interactions_user_date ON pin_interactions(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE pin_interactions ENABLE ROW LEVEL SECURITY;

-- Users can only see their own interactions
CREATE POLICY pin_interactions_user ON pin_interactions
  FOR ALL USING (auth.uid() = user_id);
