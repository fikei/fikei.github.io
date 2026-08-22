# Phase 17 build session plan (2026-08-21)

> The working plan for the Phase 17 implementation session. Canonical epic list: [phase-17-program-listings.md](../phase-17-program-listings.md) · PRD: [agape-program-listings.md](../../../strategy/prds/agape-program-listings.md)

## Decisions in force

1. Legal consult before opening; "residency application fee" framing everywhere.
2. Payment before final submit (form completed first, fee is the last gate).
3. Public "up to three months"; per-cohort winner count decided privately (`capacity`).
4. Duration is a listing-setup parameter; first test = one 2-month residency, house funds backstop.
5. Filmed public set as an offer-email condition.
6. Scores display-only — sortable, never a gate.
7. One application per cohort; cohorts never open concurrently (`listing_id` on the applicant, no join table).

## What this session builds

| Piece | File | Version |
|---|---|---|
| Schema: program listings, DJ fields, payments, scores, RPCs, draft seed | `supabase/migrations/178_program_listings.sql` | new |
| Kind-of-stay listing options, branching DJ question set, `?listing=` deep link, Stripe payment step | `apply/js/form.js`, `apply/index.html` | v1.7.0 |
| Haiku first-pass scorer (display-only) | `supabase/functions/recruit-score-apps/index.ts` | v1.0.0 |
| Housing auto-match excludes program listings | `supabase/functions/recruit-match/index.ts` | v1.14.0 |
| Landing page (doorbell knock concept, live listing card) | `residency/index.html` | v1.0.0 |
| Triage: track filter, score display/sort, Score inbox, DJ profile section, listing editor program fields + draft lifecycle, promote-to-resident | `applications/js/app.js`, `applications/index.html` | v3.85.0 |

## Key mechanics

- **Form branching:** questions carry `when:` predicates; `AQ()` filters the active set. Housing-only: budget, why_agape. Program-only: artist_name, based_in, mix_links, performance_history, gear_notes, sound_essay. The submit RPC requires why_agape OR sound_essay.
- **Listing link:** selecting a program option on Kind of Stay calls `recruit_apply_set_listing(slug)` after the row-creating save; `recruit_apply_load` returns the listing context (slug, title, dates, deadline, fee, payment link).
- **Payment:** submit → redirect to the listing's Stripe Payment Link (`prefilled_email`, `client_reference_id` = applicant id). Return URL `/apply/?payment=success` → `recruit_apply_mark_paid()` (provisional). Weekly CSV reconciliation is authoritative — runbook: [docs/infrastructure/dj-residency-payments.md](../../../infrastructure/dj-residency-payments.md).
- **Scoring:** `recruit-score-apps` (user-JWT + Recruiting-membership gate, Haiku `claude-haiku-4-5-20251001`, key chain RECRUIT_ANTHROPIC_API_KEY → ANTHROPIC_API_KEY → LADDER). Batch of 10, dedupes on `scored_at`, failures stamped into `score_notes` so nothing wedges the sweep.
- **Draft lifecycle:** migration seeds one draft listing `dj-residency` (placeholder window Oct 1 – Nov 30, deadline Sep 15, $20, capacity 1, priest room) — the listing editor sets real dates and opens it.

## Deploy steps (after merge)

1. Run migration 178 against the Boards project (`yfhudwakpgzswiylhfbh`) — management API with the keychain `sbp_` token, or dashboard SQL editor.
2. `supabase functions deploy recruit-score-apps --project-ref yfhudwakpgzswiylhfbh`
3. `supabase functions deploy recruit-match --project-ref yfhudwakpgzswiylhfbh`
4. Static pages ship with the merge (GitHub Pages).

## Human setup before opening the listing

- Create the $20 Stripe Payment Link; set its after-payment redirect to `https://ctrl.rodeo/apply/?payment=success`; paste the link URL into the listing editor.
- Set the real residency window + deadline in the listing editor, then Open.
- Legal read on the paid application (decision 1).
- Point the Instagram link-in-bio at `https://ctrl.rodeo/residency/`.

## Deferred (unchanged from the phase doc)

Stripe webhook reconciliation, bulk status comms, offer/rejection email template variants in recruit-gmail, set-delivery tracking UI, alumni page, deadline auto-close cron, recruit-ingest program ping.
