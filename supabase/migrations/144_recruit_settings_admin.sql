-- 144: house-wide settings become admin-only, and get an audit trail.
--
-- Admin is not a role the app maintains — it is derived from Discord: whoever
-- can see #recruiting-automation can change how recruiting behaves. That check
-- needs the bot token, so it happens in the discord-membership function and
-- lands here. The client can read this table but never write it, which is why
-- the flag does NOT live on recruit_profiles (members write their own profile
-- row, so they could grant themselves admin).

CREATE TABLE IF NOT EXISTS recruit_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_user_id TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE recruit_admins ENABLE ROW LEVEL SECURITY;

-- Readable so the UI can say "you can't change this" instead of failing a write.
DROP POLICY IF EXISTS "Recruiting members read admins" ON recruit_admins;
CREATE POLICY "Recruiting members read admins" ON recruit_admins
  FOR SELECT TO authenticated USING (is_recruiting_member());
-- No INSERT/UPDATE/DELETE policy on purpose: service role only.

CREATE OR REPLACE FUNCTION is_recruiting_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM recruit_admins WHERE user_id = auth.uid());
$$;

-- Settings: everyone reads, admins write. The old policy was FOR ALL to any
-- recruiting member, so a staleness window could change with no trace.
DROP POLICY IF EXISTS "Recruiting members write settings" ON recruit_settings;
DROP POLICY IF EXISTS "Recruiting admins write settings" ON recruit_settings;
CREATE POLICY "Recruiting admins write settings" ON recruit_settings
  FOR ALL TO authenticated
  USING (is_recruiting_admin()) WITH CHECK (is_recruiting_admin());

-- updated_by_name already exists; the uuid makes the trail joinable.
ALTER TABLE recruit_settings ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id);

-- Dead config from the collective-vote model, superseded by the single decider
-- on 2026-07-29 (migration 140). Nothing reads these.
DELETE FROM recruit_settings WHERE key IN ('vote_min_count', 'vote_pass_avg');

-- Automation status for the Settings view. cron.* is not reachable over the
-- REST API, so this is the one door to it — read-only, and it exposes nothing
-- but the schedule and the last outcome of jobs this app owns.
CREATE OR REPLACE FUNCTION recruit_cron_status()
RETURNS TABLE (
  jobname TEXT,
  schedule TEXT,
  active BOOLEAN,
  last_run TIMESTAMPTZ,
  last_status TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = cron, public
AS $$
  SELECT
    j.jobname::TEXT,
    j.schedule::TEXT,
    j.active,
    r.start_time,
    r.status::TEXT
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT d.start_time, d.status
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC
    LIMIT 1
  ) r ON TRUE
  WHERE j.jobname IN (
    'recruit_screening_reminder_tick',
    'recruit_application_ingest_tick',
    'recruit_gmail_scan_tick',
    'pipeline-invariants-6h'
  );
$$;

REVOKE ALL ON FUNCTION recruit_cron_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recruit_cron_status() TO authenticated;

COMMENT ON TABLE recruit_admins IS
  'Derived from Discord: who can see #recruiting-automation. Written by the discord-membership function (service role) only.';
COMMENT ON FUNCTION recruit_cron_status() IS
  'Read-only last-run status for the recruiting cron jobs, for Settings → Automations.';
