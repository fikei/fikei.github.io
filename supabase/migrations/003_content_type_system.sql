-- Migration: Content Type System
-- Creates tables for content type detection, caching, and evolution

-- ============================================
-- Content Types Registry
-- ============================================
CREATE TABLE IF NOT EXISTS content_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  definition TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'builtin', -- builtin, discovered, proposed
  signals JSONB DEFAULT '{}',
  -- signals: { domains: [], url_patterns: [], keywords: [] }
  sample_count INTEGER DEFAULT 0,
  discovered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert builtin content types
INSERT INTO content_types (name, definition, status, signals) VALUES
  ('product', 'E-commerce product pages, items for sale', 'builtin',
   '{"domains": ["amazon.com", "ebay.com", "etsy.com", "shopify.com"], "keywords": ["buy", "price", "add to cart", "shop"]}'),
  ('article', 'Blog posts, news articles, long-form written content', 'builtin',
   '{"domains": ["medium.com", "substack.com"], "url_patterns": ["/blog/", "/post/", "/article/"], "keywords": ["read", "published", "author"]}'),
  ('video', 'Video content from platforms or embedded videos', 'builtin',
   '{"domains": ["youtube.com", "vimeo.com", "tiktok.com", "twitch.tv"], "keywords": ["watch", "video", "stream"]}'),
  ('music', 'Music tracks, albums, playlists, podcasts', 'builtin',
   '{"domains": ["spotify.com", "soundcloud.com", "apple.com/music", "bandcamp.com"], "keywords": ["listen", "track", "album", "playlist"]}'),
  ('repository', 'Code repositories, open source projects', 'builtin',
   '{"domains": ["github.com", "gitlab.com", "bitbucket.org"], "keywords": ["code", "repository", "commit", "branch"]}'),
  ('social', 'Social media posts, profiles, threads', 'builtin',
   '{"domains": ["twitter.com", "x.com", "linkedin.com", "instagram.com", "threads.net"], "keywords": ["post", "tweet", "profile"]}'),
  ('document', 'PDFs, documents, spreadsheets, presentations', 'builtin',
   '{"url_patterns": [".pdf", ".doc", ".xls", ".ppt", "docs.google.com", "drive.google.com"], "keywords": ["document", "download"]}'),
  ('tool', 'Web applications, SaaS tools, utilities', 'builtin',
   '{"url_patterns": ["app.", ".app", "/app/", "/dashboard"], "keywords": ["tool", "app", "dashboard", "sign up"]}'),
  ('unknown', 'Unclassified content', 'builtin', '{}')
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Domain Profiles (for caching)
-- ============================================
CREATE TABLE IF NOT EXISTS domain_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT UNIQUE NOT NULL,
  classification TEXT NOT NULL DEFAULT 'unknown', -- single_type, multi_type, unknown
  primary_type TEXT REFERENCES content_types(name),
  path_patterns JSONB DEFAULT '[]',
  -- path_patterns: [{ pattern: "^/blog/", type: "article", confidence: 0.9, examples: [] }]
  types_seen JSONB DEFAULT '{}',
  -- types_seen: { "article": 5, "product": 12 }
  path_samples JSONB DEFAULT '[]',
  -- path_samples: [{ path: "/blog/post-1", type: "article" }]
  sample_count INTEGER DEFAULT 0,
  confidence REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domain_profiles_domain ON domain_profiles(domain);

-- ============================================
-- Classification Log (for type discovery)
-- ============================================
CREATE TABLE IF NOT EXISTS classification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID,
  user_id UUID,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  description TEXT,
  predicted_type TEXT REFERENCES content_types(name),
  confidence REAL,
  signals JSONB DEFAULT '[]',
  is_uncertain BOOLEAN DEFAULT false,
  user_override TEXT, -- if user changed the type
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classification_log_uncertain
ON classification_log(is_uncertain, created_at)
WHERE is_uncertain = true;

-- ============================================
-- Add content_type to links table
-- ============================================
ALTER TABLE links ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'unknown';
ALTER TABLE links ADD COLUMN IF NOT EXISTS type_confidence REAL;
ALTER TABLE links ADD COLUMN IF NOT EXISTS type_signals JSONB DEFAULT '[]';

-- ============================================
-- RLS Policies
-- ============================================
ALTER TABLE content_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE classification_log ENABLE ROW LEVEL SECURITY;

-- Content types are readable by all
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Content types are readable by all' AND tablename = 'content_types') THEN
    CREATE POLICY "Content types are readable by all"
    ON content_types FOR SELECT
    USING (true);
  END IF;
END $$;

-- Domain profiles are readable by all (cache is shared)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Domain profiles are readable by all' AND tablename = 'domain_profiles') THEN
    CREATE POLICY "Domain profiles are readable by all"
    ON domain_profiles FOR SELECT
    USING (true);
  END IF;
END $$;

-- Domain profiles can be created/updated by authenticated users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Authenticated users can upsert domain profiles' AND tablename = 'domain_profiles') THEN
    CREATE POLICY "Authenticated users can upsert domain profiles"
    ON domain_profiles FOR ALL
    USING (auth.role() = 'authenticated');
  END IF;
END $$;

-- Classification log: users can only see their own
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can view their own classification logs' AND tablename = 'classification_log') THEN
    CREATE POLICY "Users can view their own classification logs"
    ON classification_log FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users can insert their own classification logs' AND tablename = 'classification_log') THEN
    CREATE POLICY "Users can insert their own classification logs"
    ON classification_log FOR INSERT
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
