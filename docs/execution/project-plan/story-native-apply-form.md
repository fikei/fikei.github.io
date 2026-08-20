# Story: Native application form (/apply)

**Status:** built — in soft launch
**Replaces:** Google Form → Google Sheet → `recruit-ingest` as the primary application path

## What shipped

- **ctrl.rodeo/apply** — Typeform-style application: one question per screen, Sassy dark theme, progress line, keyboard-first (Enter advances, number keys pick radio options).
- **Applicant login** — email OTP (`signInWithOtp` + inline `verifyOtp`, no redirect). Auth is question one, so every later answer autosaves server-side; applicants return any time to finish or edit.
- **Edit-until-decision** — applications stay editable while `stage = 'review'`; the `recruit_apply_save` RPC enforces the lock server-side. Locked view shows status.
- **Row claiming** — a sheet-era applicant signing in with the same (verified) email adopts their existing row rather than creating a twin.
- **Schema** (migration 170): `recruit_applicants` + `user_id`, `is_submitted`, `updated_at`, `source (sheet|native|manual)`; RPCs `recruit_apply_load/save/submit` (SECURITY DEFINER — applicants only ever see form columns, never internal notes).
- **Triage app v3.77.0** — hides native drafts, shows a `native` badge and "updated Xh ago" on edited applications. No pipeline changes.
- **Ingest v1.7.0** — stamps `source: 'sheet'`; email dedupe protects native rows from being twinned or shadowed.

## Revised field set (vs. the Google Form)

Email became the auth step; first/last name share one screen; residency and budget became structured choices; move-in became a date ("soonest you could move in" + flexible toggle, copy notes that people who can move when a spot opens are prioritized); an interstitial before the three essays says a real person reads every application. Phone + social share one optional closing screen. Values store as label strings in the existing TEXT columns, so triage and ingest needed no mapping changes.

## Re-apply path (v1.1.0, migration 171)

A rejected/archived applicant sees "Apply again" on the locked view (with the house's "check back around {month}" hint when `exit_reason='future'`). `recruit_apply_reapply` reopens the SAME row: prior outcome is snapshotted into a System comment, votes/decision/exit fields clear (a stale veto would instantly re-reject), the row becomes a hidden draft, and resubmitting stamps a fresh `submitted_at` so it sorts as new in the Inbox. Comments from the earlier round stay visible to reviewers.

## Soft launch → cutover checklist

- [ ] Test cohort completes /apply end-to-end (watch `apply_step` vitals in /analytics for drop-off)
- [ ] Native submissions triaged alongside sheet rows for 2–4 weeks
- [ ] Flip the public application link to ctrl.rodeo/apply
- [ ] Close the Google Form with a redirect message
- [ ] Sheet ingest cron stays as fallback for manual sheet additions (decommission decision later)

## References

- Migration: `supabase/migrations/170_recruit_native_apply.sql`
- Form: `apply/index.html`, `apply/js/form.js`, `apply/css/form.css`
- Dual-path ingest: `docs/infrastructure/recruiting-sheet-ingest.md` § Dual ingestion
- Wizard CSS classes: `design-system/README.md` § Apply wizard
