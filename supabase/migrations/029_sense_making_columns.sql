-- Migration 028: Sense-Making & Pin Creation Agent schema
--
-- Adds columns needed by the three-function architecture:
--   analyze-content (sense-making): entities, practical_tags, taste_tags, content_structure
--   create-pin (pin creation): hero_score
--   instagram-import (provenance): instagram, extraction, source_url
--
-- These enable:
--   - 6-dimension pin classification (content_type, entity_type, category, structure, practical, taste)
--   - Primary source validation (extraction.source_mismatch)
--   - Taste graph modeling (taste_tags weighted 4x in TF-IDF)
--   - Entity-based pin relationships (shared entities = clustering signal)

-- Sense-Making columns
ALTER TABLE links ADD COLUMN IF NOT EXISTS entities JSONB DEFAULT NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS practical_tags TEXT[] DEFAULT '{}';
ALTER TABLE links ADD COLUMN IF NOT EXISTS taste_tags TEXT[] DEFAULT '{}';
ALTER TABLE links ADD COLUMN IF NOT EXISTS content_structure TEXT DEFAULT NULL;

-- Pin Creation columns
ALTER TABLE links ADD COLUMN IF NOT EXISTS hero_score REAL DEFAULT NULL;

-- Provenance columns (instagram-import)
ALTER TABLE links ADD COLUMN IF NOT EXISTS instagram JSONB DEFAULT NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS extraction JSONB DEFAULT NULL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT NULL;

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_links_practical_tags ON links USING GIN (practical_tags);
CREATE INDEX IF NOT EXISTS idx_links_taste_tags ON links USING GIN (taste_tags);
CREATE INDEX IF NOT EXISTS idx_links_source_url ON links (source_url) WHERE source_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_links_content_structure ON links (content_structure) WHERE content_structure IS NOT NULL;

-- Composite index for entity-based queries (find pins with entities)
CREATE INDEX IF NOT EXISTS idx_links_entities ON links USING GIN (entities) WHERE entities IS NOT NULL;
