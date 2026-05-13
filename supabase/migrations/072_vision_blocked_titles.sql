-- Migration 072_vision_blocked_titles.sql
-- Adds the agent-writable blocked/required arrays to job.vision so the
-- chat agent's update_preferences tool persists directly into the same
-- vision row that pull-recommendations already reads from.
--
-- Why dedicated columns instead of reusing deal_breakers / anti_mission_terms:
--   - deal_breakers is human-prose (e.g. "no contract roles", "won't relo")
--     consumed by Fit scoring, not a substring-title filter.
--   - anti_mission_terms is for mission-alignment exclusions (e.g. defense,
--     gambling) read by a different code path.
-- blocked_titles + must_have_keywords are simple lowercase phrase lists
-- the pull-recommendations filter substring-matches against posting
-- titles before invoking Fit scoring.

alter table job.vision
  add column if not exists blocked_titles text[] not null default '{}',
  add column if not exists must_have_keywords text[] not null default '{}';

comment on column job.vision.blocked_titles is
  'Lowercase phrases that, if substring-matched in a posting title, exclude the role from recommendations. Written by the agent chat tool update_preferences after expanding the user''s vague ask (e.g. "developer jobs" → 12 specific titles).';

comment on column job.vision.must_have_keywords is
  'Lowercase phrases that must appear in a posting (title or description) for it to be recommended. Written by update_preferences.';
