-- Migration 007: Image Validation & Enrichment Engine
-- Adds scoring columns to links table and creates validation cache.
-- Part of Phase 10: Image Validation & Enrichment (Epic 10.1)

-- ========================================
-- 1. Extend links table with validation fields
-- ========================================

-- Composite image quality scores from Tier 1/2/3 validation
-- Schema: { accuracy, visual_quality, aesthetic_fit, distinctiveness, safety,
--           composite, tier, evaluated_at, evaluation_method,
--           dimensions: { width, height }, file_size, tier2_checks: [...] }
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_scores JSONB;

-- Number of enrichment attempts made for this pin's image
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_enrichment_attempts INT DEFAULT 0;

-- Log of enrichment attempts with before/after scores
-- Schema: [{ attempt, strategy, result, score_before, score_after, timestamp }]
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_enrichment_log JSONB DEFAULT '[]';

-- ========================================
-- 2. Image validation cache
-- ========================================
-- Caches AI vision (Tier 3) results by image URL so the same
-- image is never re-evaluated. Keyed by SHA256 hash of normalized URL.

CREATE TABLE IF NOT EXISTS image_validation_cache (
    image_url_hash TEXT PRIMARY KEY,
    image_url TEXT NOT NULL,
    scores JSONB NOT NULL,
    evaluated_at TIMESTAMPTZ DEFAULT NOW(),
    ttl_days INT DEFAULT 30,
    source_domain TEXT,
    content_type TEXT
);

-- Look up validations by domain (analytics, domain-level quality tracking)
CREATE INDEX IF NOT EXISTS idx_validation_cache_domain
    ON image_validation_cache(source_domain);

-- Find lowest-scored cached images (for re-enrichment batch jobs)
CREATE INDEX IF NOT EXISTS idx_validation_cache_score
    ON image_validation_cache((scores->>'composite')::NUMERIC);

-- ========================================
-- 3. Extend strategy performance tracking
-- ========================================
-- These columns track how well each sourcing strategy performs
-- across the validation dimensions. Used by the feedback loop
-- to auto-adjust strategy priority.

ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS avg_accuracy_score NUMERIC(3,2);
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS avg_aesthetic_score NUMERIC(3,2);
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS avg_composite_score NUMERIC(3,2);
ALTER TABLE strategy_performance ADD COLUMN IF NOT EXISTS override_rate NUMERIC(3,2);

-- ========================================
-- 4. Index on links.image_scores for finding low-quality images
-- ========================================
CREATE INDEX IF NOT EXISTS idx_links_image_composite
    ON links((image_scores->>'composite')::NUMERIC)
    WHERE image_scores IS NOT NULL;

-- Index for finding pins that haven't been validated yet
CREATE INDEX IF NOT EXISTS idx_links_no_scores
    ON links(created_at)
    WHERE image IS NOT NULL AND image_scores IS NULL;
