-- Migration: Image Resolution System
-- Creates tables for image strategies and performance tracking

-- ============================================
-- Image Strategies Registry
-- ============================================
CREATE TABLE IF NOT EXISTS image_strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL REFERENCES content_types(name),
  name TEXT NOT NULL,
  pipeline JSONB NOT NULL,
  -- pipeline: [{ method: "scrape", config: {}, timeout_ms: 1000 }, ...]
  card_template TEXT NOT NULL DEFAULT 'image_dominant',
  -- card_template: image_dominant, text_dominant, hybrid, icon_based
  style JSONB DEFAULT '{}',
  -- style: { overlay_opacity: 0.7, text_position: "bottom" }
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_type, name)
);

-- Insert default strategies for each content type
INSERT INTO image_strategies (content_type, name, pipeline, card_template, style) VALUES
  ('product', 'default',
   '[{"method": "scrape", "config": {"selector": "og:image"}, "timeout_ms": 2000},
     {"method": "scrape", "config": {"headless": true}, "timeout_ms": 5000},
     {"method": "search", "config": {"query_template": "{title}"}, "timeout_ms": 3000},
     {"method": "template", "config": {"type": "product_card"}, "timeout_ms": 100}]',
   'image_dominant', '{"overlay_opacity": 0.6}'),

  ('article', 'default',
   '[{"method": "scrape", "config": {"selector": "og:image"}, "timeout_ms": 2000},
     {"method": "generate", "config": {"style": "abstract_editorial"}, "timeout_ms": 5000},
     {"method": "template", "config": {"type": "text_card"}, "timeout_ms": 100}]',
   'image_dominant', '{"overlay_opacity": 0.7}'),

  ('video', 'default',
   '[{"method": "platform_api", "config": {"platform": "auto"}, "timeout_ms": 2000},
     {"method": "scrape", "config": {"selector": "og:image"}, "timeout_ms": 2000},
     {"method": "template", "config": {"type": "video_card"}, "timeout_ms": 100}]',
   'image_dominant', '{"overlay_opacity": 0.5}'),

  ('music', 'default',
   '[{"method": "platform_api", "config": {"platform": "auto"}, "timeout_ms": 2000},
     {"method": "search", "config": {"query_template": "{title} album cover"}, "timeout_ms": 3000},
     {"method": "template", "config": {"type": "music_card"}, "timeout_ms": 100}]',
   'hybrid', '{"overlay_opacity": 0.6}'),

  ('repository', 'default',
   '[{"method": "platform_api", "config": {"platform": "github"}, "timeout_ms": 2000},
     {"method": "template", "config": {"type": "repo_card"}, "timeout_ms": 100}]',
   'text_dominant', '{}'),

  ('social', 'default',
   '[{"method": "platform_api", "config": {"platform": "auto"}, "timeout_ms": 2000},
     {"method": "scrape", "config": {"selector": "og:image"}, "timeout_ms": 2000},
     {"method": "template", "config": {"type": "social_card"}, "timeout_ms": 100}]',
   'hybrid', '{"overlay_opacity": 0.6}'),

  ('document', 'default',
   '[{"method": "scrape", "config": {"selector": "og:image"}, "timeout_ms": 2000},
     {"method": "template", "config": {"type": "document_card"}, "timeout_ms": 100}]',
   'text_dominant', '{}'),

  ('tool', 'default',
   '[{"method": "scrape", "config": {"selector": "og:image"}, "timeout_ms": 2000},
     {"method": "scrape", "config": {"selector": "favicon", "min_size": 128}, "timeout_ms": 2000},
     {"method": "template", "config": {"type": "tool_card"}, "timeout_ms": 100}]',
   'hybrid', '{"overlay_opacity": 0.5}'),

  ('unknown', 'default',
   '[{"method": "scrape", "config": {"selector": "og:image"}, "timeout_ms": 2000},
     {"method": "generate", "config": {"style": "abstract"}, "timeout_ms": 5000},
     {"method": "template", "config": {"type": "text_card"}, "timeout_ms": 100}]',
   'text_dominant', '{}')
ON CONFLICT (content_type, name) DO NOTHING;

-- ============================================
-- Strategy Performance Tracking
-- ============================================
CREATE TABLE IF NOT EXISTS strategy_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type TEXT NOT NULL REFERENCES content_types(name),
  strategy_name TEXT NOT NULL,
  method_used TEXT NOT NULL,
  -- Metrics
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  override_count INTEGER DEFAULT 0,
  total_time_ms BIGINT DEFAULT 0,
  -- Period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_type, strategy_name, method_used, period_start)
);

CREATE INDEX IF NOT EXISTS idx_strategy_performance_period
ON strategy_performance(period_start, period_end);

-- ============================================
-- Add image resolution fields to links
-- ============================================
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_source TEXT DEFAULT 'scraped';
-- image_source: scraped, searched, generated, uploaded, platform_api, template

ALTER TABLE links ADD COLUMN IF NOT EXISTS image_method TEXT;
-- Specific method that worked, e.g., "scrape:og:image"

ALTER TABLE links ADD COLUMN IF NOT EXISTS image_resolved_at TIMESTAMPTZ;

-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE image_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_performance ENABLE ROW LEVEL SECURITY;

-- Strategies are readable by all
CREATE POLICY "Image strategies are readable by all"
ON image_strategies FOR SELECT
USING (true);

-- Performance data is readable by all (for transparency)
CREATE POLICY "Strategy performance is readable by all"
ON strategy_performance FOR SELECT
USING (true);

-- Only system can insert performance data (via service role)
CREATE POLICY "System can insert performance data"
ON strategy_performance FOR INSERT
WITH CHECK (true);
