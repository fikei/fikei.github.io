-- Migration 037: Image Storage Proxy
-- Adds Supabase Storage bucket for proxied link images
-- Images are downloaded during enrichment and served from our CDN

-- 1. New columns on links table
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_original_url TEXT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS image_proxied BOOLEAN DEFAULT false;

-- 2. Create the link-images storage bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('link-images', 'link-images', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policies

-- Anyone can read images (public bucket)
CREATE POLICY "link-images public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'link-images');

-- Service role can upload images
CREATE POLICY "link-images service write"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'link-images');

-- Service role can overwrite images (upsert)
CREATE POLICY "link-images service update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'link-images');

-- Service role can delete images (cleanup)
CREATE POLICY "link-images service delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'link-images');

-- 4. Index for backfill queries (find non-proxied links with images)
CREATE INDEX IF NOT EXISTS idx_links_not_proxied
ON links(created_at DESC)
WHERE image IS NOT NULL AND image_proxied = false;
