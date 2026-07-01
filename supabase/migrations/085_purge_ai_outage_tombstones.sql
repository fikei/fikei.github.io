-- 085_purge_ai_outage_tombstones.sql
--
-- Self-healing cleanup for the gmail-jobs pipeline.
--
-- Before v0.23.0, a Haiku extraction failure caused by the Anthropic API
-- being unavailable (credit balance exhausted, 429 rate-limit, 5xx/overload)
-- was logged to job.gmail_skipped with reason='parse_error'. That skip row
-- is a permanent dedup tombstone, so even after credits were topped up the
-- affected job-alert emails were never re-extracted — a whole window of
-- roles silently vanished (observed 2026-06-27 → 2026-07-01).
--
-- v0.23.0 stops creating these tombstones (transient AI outages now abort
-- the run without advancing the cursor, so the next tick re-drains). This
-- migration removes any tombstones the old code already wrote for an AI
-- outage, so those messages fall back into the scan and get re-extracted.
-- Genuine parse failures (bad JSON, empty body, etc.) are left intact.
--
-- Idempotent: safe to re-run; matches only outage-caused rows.
delete from job.gmail_skipped
 where reason = 'parse_error'
   and (
        details->>'reason' ilike '%credit balance is too low%'
     or details->>'reason' ilike '%overloaded%'
     or details->>'reason' ~* 'anthropic\s+(429|500|502|503|529)'
     or details->>'reason' ilike '%rate limit%'
     or details->>'reason' ilike '%rate_limit%'
   );
