# Phase 17: Program Listings & DJ Residency

> Back to [Project Plan](./index.md) · PRD: [Program Listings & the DJ Residency](../../strategy/prds/agape-program-listings.md)

---

## Overview

Extends `recruit_listings` into a general program-listing concept (draft → open → filled/closed lifecycle, application deadline, fee, public slug) and launches the first program: a paid DJ residency in the priest room. Open program listings surface on the /apply "Kind of stay" step and branch the question flow; a $20 Stripe Payment Link gates review; a Haiku auto-scorer makes 1,000-application triage feasible; finalists flow through the existing vote → interview → stay machinery.

**Status:** Pending

**Files touched:**

| File | Version | Change |
|---|---|---|
| `supabase/migrations/178_program_listings.sql` | new | Listing type + lifecycle, applicant listing join, DJ/payment/score fields, RPCs |
| `apply/js/form.js` | v1.6.0 → v1.7.0 | Dynamic Kind of Stay options, DJ question set, `?listing=` deep link, payment step |
| `applications/index.html` | v3.84.0 → v3.85.0 | Listing filter, score sort, bulk actions, DJ profile view, listing editor (draft/open) |
| `supabase/functions/recruit-score-apps/index.ts` | v1.0.0 (new) | Haiku first-pass scoring |
| `supabase/functions/recruit-ingest/index.ts` | v1.7.0 → v1.8.0 | Program-application Discord ping |
| `supabase/functions/recruit-gmail/index.ts` | v1.37.x → v1.38.0 | Confirmation/offer templates for program track |
| `residency/index.html` | new | Landing page from an /interactions knock concept |

---

## Epic 17.1: Listing-type schema + draft lifecycle

| Story | Tasks |
|---|---|
| **Program listing schema** | Migration 178: `recruit_listings` + `listing_type`, `title`, `public_blurb`, `application_deadline`, `fee_cents`, `payment_link`, `capacity`, `public_slug`; `status` CHECK gains `draft` |
| | `recruit_applicants.listing_id` FK (one application per cohort; cohorts never open concurrently) |
| | `recruit_applicants` DJ/payment/score columns; extend `recruit_apply_columns()` |
| | `recruit_stays` + `listing_id`, `set_delivered_at`, `set_url`; `kind` gains `dj_resident` |
| | Indexes: `(listing_type, status)`, DJ `score_total DESC NULLS LAST` |
| **Public listing RPC** | `recruit_open_program_listings()` — anon-safe subset (title, blurb, dates, deadline, fee, slug) of open listings |
| **Draft / soft-launch lifecycle** | Drafts hidden from public RPC; recruiter preview via `?listing=slug&preview=1` (membership-gated) |
| | Deadline auto-close (cron or check-on-read); manual open/close in listing editor |
| **Listing editor (triage app)** | Create/edit program listings in /applications Openings view: draft by default, open button, all program criteria fields incl. duration (`starts_on`/`ends_on` set at setup) |
| | Guard: at most one program listing `open` at a time |
| | Seed one draft DJ listing: the 2-month test residency, pegged to the priest room (house funds backstop) |

## Epic 17.2: Kind of Stay + branching form (apply v1.7.0)

| Story | Tasks |
|---|---|
| **Dynamic Kind of Stay** | Fetch open program listings on load; append checkable options (title, dates, deadline, fee) after Full-time/Sublet |
| | Record `listing_id` on the applicant on save (via `recruit_apply_save`) |
| **Branching question sets** | DJ question set: artist_name, mix_links, socials, sound_essay, performance_history, gear_notes, based_in |
| | DJ-exclusive: drop budget, move_in, full-time/sublet framing; Both: union, each question once |
| **Deep link** | `?listing=<slug>` pre-checks the listing + context banner (title, dates, fee, deadline); invalid/closed slug falls back gracefully |
| **Versioning** | form.js → v1.7.0; console pattern `[apply] v1.7.0 - ...` |

## Epic 17.3: Payment (Stripe Payment Links)

| Story | Tasks |
|---|---|
| **Stripe setup** | Create $20 Payment Link per DJ listing; store URL on the listing row |
| **Payment step** | Step before final submit when the selected listing has `fee_cents`; redirect out, handle `?payment=succeeded/canceled` return; set `payment_status`/`paid_at` |
| **Reconciliation runbook** | Weekly Stripe CSV export → match email + timestamp → mark paid; document unmatched-tail handling (docs/infrastructure/) |
| **Triage gate** | Unpaid apps visible but flagged un-reviewable; free listings skip the step |

## Epic 17.4: Volume triage (applications v3.85.0 + recruit-score-apps)

| Story | Tasks |
|---|---|
| **recruit-score-apps edge fn** | Haiku scores 5 dimensions (credentials, sound, fit, logistics, excitement) 1–5 + total + note; batch unscored apps; dedupe on `scored_at`; auth same as recruit-ingest |
| | Manual "Score inbox" button in triage first; cron later |
| **Inbox filter + sort** | Filter by listing / listing_type (URL-persisted); sort by score_total, submitted_at, paid_at |
| **Bulk actions** | Multi-select → advance to finalists, reject (v3.83 bulk email queue), flag for review, rescore |
| **DJ profile view** | Artist name prominent; clickable mix links; gear/based-in chips; score breakdown panel (display-only — scores never gate or auto-decide) |
| **Finalist votes** | Existing 1–5 + veto + `recruit_recompute_stage`, unchanged — verify it fires for program applicants |

## Epic 17.5: Landing + comms

| Story | Tasks |
|---|---|
| **/residency landing** | Adapt an /interactions knock concept; program details, gear specs, CTA → `/apply?listing=<slug>`; Sassy, dark-first, mobile |
| **Email templates** | Payment/application confirmation; offer (next steps + interview scheduling); program rejection (respectful, reapply invite) — via recruit-gmail v1.38.0 |
| **Discord** | recruit-ingest v1.8.0: program-application ping (digest at volume, not per-app); open/finalists announcements |

## Epic 17.6: Offer flow

| Story | Tasks |
|---|---|
| **Interview** | Reuse screening-claim flow for finalist interviews (availability → claim → GCal) |
| **Promotion RPC** | `recruit_promote_program_resident(applicant, listing, dates)`: stay `kind='dj_resident'` + `listing_id`, listing → `filled` (capacity-aware), stage → `resident`; idempotency guard |
| **DJ onboarding checklist** | Variant items: Discord role, intro announcement, sound-system + decks orientation, set-recording schedule |

## Epic 17.7: Integration, QA, launch

| Story | Tasks |
|---|---|
| **End-to-end test** | Draft listing → preview → open → deep-link apply → pay (test link) → score → bulk advance → vote → interview → promote → occupancy + checklist verified |
| **Reconciliation test** | Test payment → CSV export → runbook → `paid_at` set |
| **Launch checklist** | Migration deployed; edge fns deployed; form v1.7.0 + applications v3.85.0 live; landing live; templates approved; Stripe links live; house trained on scoring; Instagram reel + link-in-bio live; week-1 monitoring (payment success rate, volume, score sanity) |

---

## Deferred

- **Phase 2:** Stripe webhook reconciliation; bulk status comms beyond rejections; set-delivery tracking UI; notification catalog entries.
- **Phase 3:** `/residency/alumni` archive with embedded sets.
- **Phase 4:** Auto-advance on unanimous votes; deadline reminders; auto-generated offer emails.

## Reuse map

| Existing machinery | Reused for |
|---|---|
| `recruit_apply_save` RPC + edit-lock | DJ field autosave |
| Re-apply flow (migration 171) | Applying to a later cohort (one application per cohort) |
| `recruit_recompute_stage` trigger + vote UI | Finalist review |
| v3.83 bulk rejection-email queue | Program rejections at volume |
| Screening claims (recruit-gmail/discord) + GCal | Finalist interviews |
| `classify-apply-ease` pattern | recruit-score-apps scorer |
| Occupancy views + `recruit_stays` | dj_resident stays |
| Sheet-ingest fallback | Unchanged safety net |
