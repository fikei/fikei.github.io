# PRD: Program Listings & the DJ Residency

**One line:** Agape opens paid, deadline-driven program applications (first: a DJ residency in the priest room) by extending `recruit_listings` into a general program-listing concept that drives the /apply "Kind of stay" step, branches the application flow, and scales triage to ~1,000 applications with AI first-pass scoring.

**Status:** Planned — see [Phase 17 build plan](../../execution/project-plan/phase-17-program-listings.md).
**Related:** [Recruiting funnel](./agape-recruiting-funnel.md) · [Screening claim automation](./agape-screening-claim-automation.md) · [Move-in onboarding](./agape-move-in-onboarding.md) · [Recruiting notifications](./agape-recruiting-notifications.md)

---

## Decisions (2026-08-21)

1. **Legal read + framing:** informal legal consult before opening; all copy (landing, form, Stripe) says "residency application fee" — never anything tenancy-shaped.
2. **Payment before final submit** — the form is completed first, payment is the last gate; no unpaid app is reviewable.
3. **Capacity messaging:** publicly "up to three residency months across the year"; the actual winner count per cohort is decided privately after fee totals land (`capacity` on the listing).
4. **Duration is a listing-setup parameter** (`starts_on`/`ends_on`), not fixed at one month. First test: a single **2-month residency**, backstopped by existing house funds.
5. **Set deliverable:** filmed live set at a house party in the final week, published publicly (resident keeps rights, Agape may post); written into the offer email as a condition of the residency.
6. **Scores are display-only:** shown in triage (breakdown + total), never a gate — no shortlist floor, no auto-decisions on score.
7. **One application per cohort; cohorts are never published concurrently** — at most one program listing is open at a time. Applying to a later cohort is a new application (existing re-apply machinery).

## Program overview: the DJ residency

- Residencies in the priest room; duration set per listing at setup (first test: one 2-month residency; later cohorts may be one month — exact dates TBD by the house).
- Applications open on Instagram: reel → link in bio → landing page → /apply.
- $20 application fee funds the program; all proceeds go to rent and growing the residency. The house guarantees one month's rent if applications fall short; if income is short, only one cohort is granted.
- Residents receive one month room & board, access to the Neptune sound system and Pioneer decks, and time to work in a creative community.
- Expectation: by end of month, each resident records or performs a one-hour Boiler Room-style set in the basement.
- Goal: 1,000 applications and a sustainable arts program that keeps the priest room available as a flexible artist space.

### Funnel

```
Instagram reel (link in bio)
        ↓
/residency landing page (adapted from an /interactions "knock" concept)
        ↓
/apply?listing=dj-sept  (deep link; DJ flow with listing context)
        ↓
$20 Stripe Payment Link → payment_status='paid'
        ↓
Volume triage (/applications: listing filter, Haiku auto-score, bulk actions)
        ↓
Finalists → Recruiting Society votes (existing 1–5 + veto)
        ↓
Interview (existing screening-claim machinery) + house approval
        ↓
Offer → recruit_stays kind='dj_resident' (listing → filled)
        ↓
Residency month → set recorded (set_delivered_at / set_url)
        ↓
Alumni archive (deferred)
```

---

## Features & extensions

### 1. Program listing type

`recruit_listings` (migration 109: room-bound `kind: sublet|resident`, `status: open|filled|closed`) becomes the engine for programs:

| New column | Purpose |
|---|---|
| `listing_type` | `room` (default, current behavior) \| `dj_residency` (extensible for future programs) |
| `title` | Public name, e.g. "DJ Residency — September" |
| `public_blurb` | Short public description shown on Kind of Stay and landing surfaces |
| `application_deadline` | Date applications close (auto-close eligible) |
| `fee_cents` | Application fee (2000 for the DJ residency; null = free) |
| `payment_link` | Stripe Payment Link URL for this listing |
| `capacity` | Winners per cohort (default 1) |
| `public_slug` | URL-safe id for deep links, e.g. `dj-sept` |

Existing `starts_on`/`ends_on` are the cohort start/end — **duration is set at listing setup** (the first test is a 2-month listing). One listing per cohort, pegged to the priest room's `room_id`, so occupancy stays truthful. **At most one program listing is open at a time**; later cohorts are drafted and opened sequentially.

### 2. Draft & soft-launch lifecycle (general concept)

`status` gains `draft`: **draft → open → filled | closed**.

- **Draft:** invisible to /apply and public RPCs; recruiters can preview the full flow via the slug (`?listing=slug&preview=1`, gated on Recruiting membership). This is how the DJ listings are staged before launch and how any future program (artist month, writer residency) soft-launches.
- **Open:** appears on Kind of Stay and accepts applications until `application_deadline` (auto-close via existing cron surface, or manual).
- **Filled/Closed:** existing semantics; filling a program listing happens at promotion (feature 9).

### 3. Kind of Stay driven by open listings

The /apply step "What kind of stay are you looking for?" ([form.js:28](../../../apply/js/form.js)) keeps its hardcoded Full-time / Sublet options and dynamically appends one checkable option per **open program listing**, with basic details: title, dates, deadline, fee.

- New anon-safe RPC `recruit_open_program_listings()` returns only the public subset (title, blurb, dates, deadline, fee, slug) for `status='open'` listings — in practice zero or one, since cohorts never run concurrently.
- Checking the program option records the applicant → listing link (`listing_id` on the applicant). One application per cohort; a later cohort means a fresh application via the existing re-apply flow.

### 4. Branching downstream flow

Question sets are keyed by what's checked on Kind of Stay, reusing the existing multi-track parsing (`parseTracks`):

- **Housing only** (Full-time and/or Sublet): current 12-question flow, unchanged.
- **DJ residency only:** DJ question set below; housing-only questions dropped.
- **Both:** union of the two sets (housing questions + DJ questions, each asked once).

### 5. DJ data capture

**Added when a DJ listing is selected:**

| Field | Column | Notes |
|---|---|---|
| Artist name | `artist_name` | Display name in triage alongside legal name |
| Mix/set links | `mix_links` (JSONB) | SoundCloud / Bandcamp / YouTube / etc. |
| Music socials | `socials` | IG/TikTok handles for the artist project |
| Your sound | `sound_essay` | Replaces `why_agape` phrasing for the residency |
| Performance history | `performance_history` | Where they've played, sets performed |
| Gear needs | `gear_notes` | Beyond Neptune + Pioneer baseline |
| Based in / travel | `based_in` | City/country; can they relocate for the month |

**Removed when DJ is selected exclusively:** budget bands, move-in date (listing dates replace it), full-time/sublet framing.
**Kept always:** first/last name, pronouns, about, community, heard_from, phone, social, anything_else.

### 6. Unique deep-link URL

`/apply?listing=<public_slug>` skips the generic entry: the listing is pre-checked, a context banner shows title/dates/fee/deadline, and the DJ question set starts immediately. The `/residency/` landing page (adapted from an /interactions knock concept — "interaction is the filter") carries this link as its CTA; Instagram link-in-bio points at the landing page.

### 7. $20 payment step (Stripe Payment Links)

- Payment step sits in the DJ flow before final submit ("payment is the commitment"); redirects to the listing's `payment_link`.
- Applicant columns: `payment_status` (`pending|paid|failed`), `payment_ref`, `paid_at`.
- v1 reconciliation: weekly Stripe CSV export matched on email + timestamp (runbook in the phase plan). Stripe webhook → automatic reconciliation is Phase 2.
- Unpaid applications are visible in triage but flagged un-reviewable; free listings (`fee_cents` null) skip the step entirely.

### 8. Volume triage (1,000 applications)

- **Filter:** Inbox filters by listing / listing_type (housing vs program), persisted in URL.
- **AI first pass:** new `recruit-score-apps` edge function (Haiku, same pattern as `classify-apply-ease`) scores five dimensions — credentials, sound, fit, logistics, excitement — 1–5 each, plus `score_total` (5–25) and a two-sentence note. Deduped on `scored_at`; manual "Score inbox" button first, cron later. **Scores are display-only**: shown in triage (breakdown + total, sortable), never a gate — no shortlist floor, no auto-advance or auto-reject on score.
- **Bulk actions:** multi-select → advance to finalists, reject (queues the v3.83 bulk rejection email), flag for review, rescore.
- **Finalists only** get the existing collective review: votes 1–5 + veto via `recruit_recompute_stage` — unchanged.

### 9. Offer → stay → set delivery

- Offer + interview reuse the screening-claim machinery (availability → Discord claim → GCal).
- New RPC `recruit_promote_program_resident(applicant, listing)` creates a `recruit_stays` row `kind='dj_resident'` with `listing_id`, marks the listing `filled` (respecting `capacity`), sets stage `resident`, and seeds a DJ onboarding checklist variant (Discord role, intro announcement, sound-system orientation, set-recording schedule).
- `recruit_stays` gains `set_delivered_at` / `set_url` for the Boiler Room set; tracking UI and a public alumni archive are Phase 2+.

---

## Schema deltas (migration 178, sketch)

- `recruit_listings`: + `listing_type`, `title`, `public_blurb`, `application_deadline`, `fee_cents`, `payment_link`, `capacity`, `public_slug`; `status` CHECK gains `draft`.
- `recruit_applicants`: + `listing_id` (FK, one application per cohort — no join table needed since cohorts never run concurrently), `artist_name`, `mix_links` JSONB, `socials`, `sound_essay`, `performance_history`, `gear_notes`, `based_in`, `payment_status`, `payment_ref`, `paid_at`, five `score_*` columns + `score_total`, `score_notes`, `scored_at`, `flag_for_review`. `application_type` is derived from the linked listing (no duplicate source of truth).
- `recruit_stays`: + `listing_id`, `set_delivered_at`, `set_url`; `kind` CHECK gains `dj_resident`.
- `recruit_apply_columns()` extended with the new applicant-editable fields.
- New RPCs: `recruit_open_program_listings()` (anon-safe), `recruit_promote_program_resident()` (member-gated).
- Indexes on `(listing_type, status)` and DJ `score_total DESC`.

## What stays untouched

Vote model and thresholds, `recruit_recompute_stage`, screening claims + Gmail/GCal machinery, move-in onboarding for housing, occupancy views (dj_resident stays appear like any stay), sheet-ingest fallback, Discord gating.

---

## Risks (flagged for house review — not resolved here)

1. **Paid-application optics / fair housing:** charging to apply for lodging may carry legal or reputational risk. Decision 1 commits to a pre-launch legal consult and "residency application fee" framing throughout.
2. **Chargebacks & reconciliation drift:** email-matched Payment Links are lossy at volume; budget for a small unmatched tail and move to webhooks if volume materializes.
3. **1,000-application load:** human review without the AI first pass is infeasible; expect scoring false positives/negatives — finalists always get human eyes.
4. **Occupancy collisions:** sequential cohorts avoid concurrent-listing complexity, but confirm each listing's dates against occupancy before opening it; the first 2-month test takes the priest room off sublet income for that window (house funds backstop it).
5. **Set-delivery accountability:** the set condition lives in the offer email and onboarding checklist in v1; tracked fields (`set_delivered_at`/`set_url`) in Phase 2.

## Open questions for the house

1. Exact dates for the first 2-month test listing?
2. Interview logistics: who schedules, video or in-person, vote format afterward?
3. Who owns the Instagram campaign and landing-page copy?
4. Alumni sets public, members-only, or private? (Default lean: public — the sets are the flywheel for future cohorts.)
