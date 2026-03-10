-- Recipe Metadata System
-- Adds structured recipe metadata storage for eat category items

ALTER TABLE links ADD COLUMN IF NOT EXISTS recipe JSONB DEFAULT NULL;

COMMENT ON COLUMN links.recipe IS 'Structured recipe metadata: title, description, servings, servings_text, prep_time, cook_time, total_time, ingredients[], instructions[], cuisine, difficulty, source_name, server_enriched_at';

-- Index for querying pinned recipes
CREATE INDEX IF NOT EXISTS idx_links_recipe ON links USING GIN (recipe) WHERE recipe IS NOT NULL;
