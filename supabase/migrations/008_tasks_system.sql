-- ============================================
-- Tasks System - AI-Powered Email Triage
-- Migration 008
-- ============================================

-- User profiles and Google OAuth tokens
CREATE TABLE IF NOT EXISTS tasks_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supabase_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expires_at TIMESTAMPTZ,
  task_list_id TEXT,
  settings JSONB DEFAULT '{
    "auto_create_threshold": 0.7,
    "daily_digest_enabled": true,
    "daily_digest_time": "08:00",
    "realtime_notifications": false,
    "categories_enabled": ["pay_purchase", "schedule_rsvp", "confirm_approve", "reply_required", "review_read", "action_required"],
    "tier": "free"
  }',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Processed email log (dedup + history)
CREATE TABLE IF NOT EXISTS tasks_processed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tasks_users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT NOT NULL,
  sender TEXT,
  subject TEXT,
  action_type TEXT CHECK (action_type IN (
    'pay_purchase', 'schedule_rsvp', 'confirm_approve',
    'reply_required', 'review_read', 'action_required'
  )),
  urgency TEXT CHECK (urgency IN ('high', 'medium', 'low')),
  confidence FLOAT,
  suggested_title TEXT,
  due_date DATE,
  google_task_id TEXT,
  status TEXT NOT NULL DEFAULT 'auto_created' CHECK (status IN (
    'auto_created', 'confirmed', 'dismissed', 'review', 'skipped'
  )),
  reasoning TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, gmail_message_id)
);

-- User-defined rules
CREATE TABLE IF NOT EXISTS tasks_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES tasks_users(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'sender_priority', 'sender_block', 'domain_block', 'category_override'
  )),
  match_value TEXT NOT NULL,
  action JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gmail watch state (Pub/Sub)
CREATE TABLE IF NOT EXISTS tasks_watches (
  user_id UUID PRIMARY KEY REFERENCES tasks_users(id) ON DELETE CASCADE,
  history_id TEXT NOT NULL,
  watch_expiration TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_processed_user_date
  ON tasks_processed(user_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_processed_thread
  ON tasks_processed(user_id, gmail_thread_id);

CREATE INDEX IF NOT EXISTS idx_tasks_processed_status
  ON tasks_processed(user_id, status);

CREATE INDEX IF NOT EXISTS idx_tasks_rules_user
  ON tasks_rules(user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_watches_expiration
  ON tasks_watches(watch_expiration);

-- Row Level Security
ALTER TABLE tasks_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks_processed ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks_watches ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users manage own data
CREATE POLICY "Users manage own profile"
  ON tasks_users FOR ALL
  USING (auth.uid() = supabase_user_id);

CREATE POLICY "Users manage own processed emails"
  ON tasks_processed FOR ALL
  USING (user_id IN (
    SELECT id FROM tasks_users WHERE supabase_user_id = auth.uid()
  ));

CREATE POLICY "Users manage own rules"
  ON tasks_rules FOR ALL
  USING (user_id IN (
    SELECT id FROM tasks_users WHERE supabase_user_id = auth.uid()
  ));

CREATE POLICY "Users manage own watches"
  ON tasks_watches FOR ALL
  USING (user_id IN (
    SELECT id FROM tasks_users WHERE supabase_user_id = auth.uid()
  ));

-- Service role bypass for edge functions
CREATE POLICY "Service role full access to tasks_users"
  ON tasks_users FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to tasks_processed"
  ON tasks_processed FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to tasks_rules"
  ON tasks_rules FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access to tasks_watches"
  ON tasks_watches FOR ALL
  USING (auth.role() = 'service_role');
