-- SystemicAI Database Schema
-- Design System Auditing and Generation Engine

-- Audit Jobs: Track crawl and analysis tasks
CREATE TABLE IF NOT EXISTS audit_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  name TEXT, -- User-provided name for the audit
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'crawling', 'analyzing', 'complete', 'failed')),
  config JSONB DEFAULT '{}'::jsonb,
  progress JSONB DEFAULT '{"pagesCrawled": 0, "pagesTotal": 0, "tokensExtracted": 0, "componentsFound": 0}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Design Systems: Generated output from audits
CREATE TABLE IF NOT EXISTS design_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_job_id UUID REFERENCES audit_jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_url TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  material_theme JSONB DEFAULT '{}'::jsonb, -- Material Design theme mapping
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Design Tokens: Extracted color, typography, spacing tokens
CREATE TABLE IF NOT EXISTS design_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id UUID REFERENCES design_systems(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('color', 'typography', 'spacing', 'elevation', 'shape', 'motion')),
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  css_variable TEXT, -- e.g., --sys-color-primary
  semantic_name TEXT, -- e.g., primary, secondary, surface
  material_mapping TEXT, -- Material Design equivalent token
  usage_count INTEGER DEFAULT 0,
  sources JSONB DEFAULT '[]'::jsonb, -- URLs where this token was found
  context JSONB DEFAULT '{}'::jsonb, -- Additional context (element types, classes)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(design_system_id, category, name)
);

-- Design Components: Extracted UI components
CREATE TABLE IF NOT EXISTS design_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id UUID REFERENCES design_systems(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT, -- button, input, card, navigation, etc.
  intent TEXT, -- primary-action, form-control, container, etc.
  variants JSONB DEFAULT '[]'::jsonb, -- [{name, styles, screenshot}]
  states JSONB DEFAULT '[]'::jsonb, -- hover, focus, active, disabled
  tokens_used JSONB DEFAULT '[]'::jsonb, -- Token IDs used by this component
  html_template TEXT,
  css_styles TEXT,
  computed_styles JSONB DEFAULT '{}'::jsonb,
  usage_guidelines TEXT, -- AI-generated guidelines
  accessibility_notes TEXT, -- AI-generated a11y notes
  screenshot_url TEXT,
  source_urls JSONB DEFAULT '[]'::jsonb,
  usage_count INTEGER DEFAULT 0,
  material_mapping TEXT, -- Material Design component equivalent
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crawl Pages: Track individual page crawls for incremental reruns
CREATE TABLE IF NOT EXISTS crawl_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_job_id UUID REFERENCES audit_jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  dom_hash TEXT, -- For change detection on reruns
  style_hash TEXT, -- Hash of extracted styles
  components_found JSONB DEFAULT '[]'::jsonb,
  tokens_found JSONB DEFAULT '[]'::jsonb,
  screenshot_url TEXT,
  crawl_depth INTEGER DEFAULT 0,
  crawled_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(audit_job_id, url)
);

-- Ghost Components: Inconsistency detection
CREATE TABLE IF NOT EXISTS ghost_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id UUID REFERENCES design_systems(id) ON DELETE CASCADE,
  canonical_component_id UUID REFERENCES design_components(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  selector TEXT NOT NULL,
  source_url TEXT,
  similarity_score DECIMAL(3,2), -- 0.00 to 1.00
  deviations JSONB DEFAULT '[]'::jsonb, -- [{type, property, expected, actual}]
  fix_css TEXT, -- Generated CSS to fix deviations
  status TEXT DEFAULT 'detected' CHECK (status IN ('detected', 'reviewed', 'fixed', 'ignored')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- Component Relationships: Track related components
CREATE TABLE IF NOT EXISTS component_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id UUID REFERENCES design_components(id) ON DELETE CASCADE,
  related_component_id UUID REFERENCES design_components(id) ON DELETE CASCADE,
  relationship_type TEXT CHECK (relationship_type IN ('variant', 'parent', 'child', 'similar', 'alternative')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(component_id, related_component_id, relationship_type)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_jobs_status ON audit_jobs(status);
CREATE INDEX IF NOT EXISTS idx_design_systems_audit_job ON design_systems(audit_job_id);
CREATE INDEX IF NOT EXISTS idx_design_tokens_system ON design_tokens(design_system_id);
CREATE INDEX IF NOT EXISTS idx_design_tokens_category ON design_tokens(design_system_id, category);
CREATE INDEX IF NOT EXISTS idx_design_components_system ON design_components(design_system_id);
CREATE INDEX IF NOT EXISTS idx_design_components_category ON design_components(design_system_id, category);
CREATE INDEX IF NOT EXISTS idx_crawl_pages_job ON crawl_pages(audit_job_id);
CREATE INDEX IF NOT EXISTS idx_ghost_components_system ON ghost_components(design_system_id);
CREATE INDEX IF NOT EXISTS idx_ghost_components_status ON ghost_components(status);

-- Enable Row Level Security
ALTER TABLE audit_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghost_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE component_relationships ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (adjust as needed for auth)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'audit_jobs') THEN
    CREATE POLICY "Allow public read access" ON audit_jobs FOR SELECT USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public insert' AND tablename = 'audit_jobs') THEN
    CREATE POLICY "Allow public insert" ON audit_jobs FOR INSERT WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public update' AND tablename = 'audit_jobs') THEN
    CREATE POLICY "Allow public update" ON audit_jobs FOR UPDATE USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'design_systems') THEN
    CREATE POLICY "Allow public read access" ON design_systems FOR SELECT USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public insert' AND tablename = 'design_systems') THEN
    CREATE POLICY "Allow public insert" ON design_systems FOR INSERT WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public update' AND tablename = 'design_systems') THEN
    CREATE POLICY "Allow public update" ON design_systems FOR UPDATE USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'design_tokens') THEN
    CREATE POLICY "Allow public read access" ON design_tokens FOR SELECT USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public insert' AND tablename = 'design_tokens') THEN
    CREATE POLICY "Allow public insert" ON design_tokens FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'design_components') THEN
    CREATE POLICY "Allow public read access" ON design_components FOR SELECT USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public insert' AND tablename = 'design_components') THEN
    CREATE POLICY "Allow public insert" ON design_components FOR INSERT WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public update' AND tablename = 'design_components') THEN
    CREATE POLICY "Allow public update" ON design_components FOR UPDATE USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'crawl_pages') THEN
    CREATE POLICY "Allow public read access" ON crawl_pages FOR SELECT USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public insert' AND tablename = 'crawl_pages') THEN
    CREATE POLICY "Allow public insert" ON crawl_pages FOR INSERT WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'ghost_components') THEN
    CREATE POLICY "Allow public read access" ON ghost_components FOR SELECT USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public insert' AND tablename = 'ghost_components') THEN
    CREATE POLICY "Allow public insert" ON ghost_components FOR INSERT WITH CHECK (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public update' AND tablename = 'ghost_components') THEN
    CREATE POLICY "Allow public update" ON ghost_components FOR UPDATE USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public read access' AND tablename = 'component_relationships') THEN
    CREATE POLICY "Allow public read access" ON component_relationships FOR SELECT USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow public insert' AND tablename = 'component_relationships') THEN
    CREATE POLICY "Allow public insert" ON component_relationships FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Function to update design_systems.updated_at
CREATE OR REPLACE FUNCTION update_design_system_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE design_systems SET updated_at = NOW() WHERE id = NEW.design_system_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to update timestamps
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_design_system_on_token_change') THEN
    CREATE TRIGGER update_design_system_on_token_change
      AFTER INSERT OR UPDATE ON design_tokens
      FOR EACH ROW EXECUTE FUNCTION update_design_system_timestamp();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_design_system_on_component_change') THEN
    CREATE TRIGGER update_design_system_on_component_change
      AFTER INSERT OR UPDATE ON design_components
      FOR EACH ROW EXECUTE FUNCTION update_design_system_timestamp();
  END IF;
END $$;
