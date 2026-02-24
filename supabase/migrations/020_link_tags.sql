-- Unified tags column — denormalizes scattered genre/sub-category/content-type data
-- into a single indexable TEXT[] column for TF-IDF ranking and future server-side search

ALTER TABLE links ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- GIN index for efficient array containment queries (e.g., tags @> ARRAY['thriller'])
CREATE INDEX IF NOT EXISTS idx_links_tags ON links USING GIN (tags);

COMMENT ON COLUMN links.tags IS 'Unified tags: normalized genres, SUB_TAGS sub-categories, content types. Populated client-side via computeLinkTags().';
