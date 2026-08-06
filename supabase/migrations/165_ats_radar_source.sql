-- 165_ats_radar_source — job-radar ATS sweeps as a first-class
-- recommendation source, plus the Track A (production soft goods) search
-- track.
--
-- The /job-radar skill sweeps ~64 outdoor/soft-goods boards locally via
-- first-party ATS APIs and pushes each run into job.ats_radar_scans (one
-- row per company per run). The 'ats-radar' source plugin then feeds the
-- verified-open postings through the normal pull-recommendations worker —
-- same dedupe, grading, bullets, and liveness as every other source.
--
-- Prime directive carried over from the skill: a role is only "open" if it
-- appeared in a first-party fetch THIS run. Boards that errored (ok=false)
-- are UNVERIFIED — they surface as a health note and can never close recs.

-- ── Scan staging ────────────────────────────────────────────────────────
create table if not exists job.ats_radar_scans (
  id            uuid primary key default gen_random_uuid(),
  scan_run_at   timestamptz not null,          -- summary.json run_at; groups one sweep
  company       text not null,
  company_slug  text not null,                 -- registry file stem, stable per company
  ats_type      text,                          -- greenhouse | lever | workday | …
  segments      text[] default '{}',
  location      text,
  careers_url   text,
  kind          text not null,                 -- structured | html-text | no-board | error
  ok            boolean not null default false,
  fetched_at    timestamptz,                   -- per-company proof of liveness
  jobs          jsonb not null default '[]'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  unique (scan_run_at, company_slug)           -- re-pushing a run is idempotent
);

create index if not exists ats_radar_scans_run_idx
  on job.ats_radar_scans (scan_run_at desc);

alter table job.ats_radar_scans enable row level security;
-- Service-role writes only (ingest endpoint + worker); no user policies.

-- Keep only the last 10 runs' rows on insert-side housekeeping (the ingest
-- endpoint prunes); no pg_cron needed for a table this small.

-- ── Track tag on scored rows ────────────────────────────────────────────
-- 'digital' (Track B, default) or 'production' (Track A). Written by the
-- grading path so the UI can show which bar a role was measured against.
alter table job.recommended_roles add column if not exists track text;
alter table job.pipeline_roles    add column if not exists track text;

-- ── Track A vision fields ───────────────────────────────────────────────
-- Ported from .claude/skills/job-radar/references/profile.md. Titles drive
-- both the ats-radar firehose gate and track classification at grading
-- time; the comp floor replaces the $200k Track B floor for production
-- roles; the notes feed the Haiku grading prompt verbatim.
do $$
declare
  uid uuid;
begin
  select user_id into uid from job.vision_field limit 1;
  if uid is null then
    select user_id into uid from public.user_profile order by onboarding_complete_at desc nulls last limit 1;
  end if;
  if uid is null then raise notice '165: no user found — skipping vision seed'; return; end if;

  insert into job.vision_field (user_id, name, value, kind, display_name, description, source) values
    (uid, 'track_a_titles',
      to_jsonb(array[
        'product line manager', 'plm',
        'product developer', 'product development manager',
        'soft goods', 'softgoods',
        'equipment designer', 'equipment design', 'pack designer', 'bag designer',
        'design director', 'design manager',
        'sourcing manager', 'materials manager', 'materials developer',
        'head of product development', 'director of product development',
        'category manager', 'merchandis'
      ]),
      'string_array', 'Production track titles',
      'Track A — production side of soft goods. A posting whose title matches any of these is classified and graded as a production role (its own fit criteria and comp floor), never averaged against the digital PM bar.',
      'migrate-job'),
    (uid, 'track_a_comp_floor', to_jsonb(70000), 'number',
      'Production comp floor',
      'Acceptable base floor for Track A production roles (~$70–125K is the market band). Track B digital roles keep the standard comp floor.',
      'migrate-job'),
    (uid, 'track_a_notes',
      to_jsonb('Track A — production side of physical soft goods. Entry credibility, best first: (1) Product Line Manager — PM rigor + design degree beats career soft-goods developers on line planning, assortment, and business ownership; STRONG at Senior/II+ level. (2) Soft Goods Product Developer — concept-to-production, tech packs, factory communication; the transferable story is medical-device + design-systems work. (3) Equipment/pack design leadership — senior design-leadership roles score higher than portfolio-gated IC design. (4) Sourcing/Materials/Quality at senior level only. Geography ordering: Bay Area > Remote-US > California (Ventura, Torrance, Morgan Hill) > outdoor hubs requiring relocation (SLC, Denver/Boulder, Portland, Seattle, Bozeman, Austin) > international (note visa explicitly). Comp reality: production roles typically pay $70–125K vs $150–220K+ digital PM market rate — state the trade-off plainly, never hide it, and ~$70–125K is acceptable for the right production role.'::text),
      'text_md', 'Production track framing',
      'How Track A roles are pitched and graded — PM-rigor-transfers framing, geography ordering, and the explicit comp trade-off tolerance.',
      'migrate-job')
  on conflict (user_id, name) do nothing;
end $$;

-- ── Seed the ats-radar source row ───────────────────────────────────────
-- Push-triggered: the ingest endpoint force-runs it after each upload, and
-- the daily cron tick re-runs it cheaply (re-reads the latest scan, which
-- refreshes liveness). min_score 0 = surface everything; read-time floors
-- and the below-bar drawer do the filtering, same as every other source.
insert into job.user_sources (user_email, type, label, config, enabled, schedule_cron, min_score)
select user_email, 'ats-radar', 'ATS boards (job-radar)', '{}'::jsonb, true, '0 14 * * *', 0
  from job.user_sources
 where type = 'gmail-jobs'
   and not exists (select 1 from job.user_sources where type = 'ats-radar')
 limit 1;
