# Agape recruiting funnel — collective review + staged pipeline

**One line:** `/applications` moves from single-decider triage (Inbox → Outreach/Hold/Archive) to a staged funnel — Review (collective votes) → Candidates → Openings → Screening → Archive — with server-side stage computation.

Status: **Phase A shipped (v3.0.0, migration 120); auto-placement shipped early (v3.2.0, migration 123)** · Phases B + D planned.

### v3.2.0 amendments (2026-07-22)
- "Review" is named **Inbox**; Openings sits in the House rail group under Occupancy.
- Legacy Hold applicants went back to Inbox — hold ≠ passed review.
- **AI listing suggestions removed** from profiles. Replaced by deterministic auto-placement: candidates land in **every** open listing they qualify for (`recruit_listing_candidates`; qualification = track match, budget ≥ rent when both known, move-in dates must fall inside the listing window — no padding; only explicit "flexible" rides any window, ASAP fits rooms opening within a month, unparseable dates never auto-place). Recruiter removals are tombstoned so the sweep never re-adds them. This delivers most of old Phase C — remaining Phase C scope is only auto-*generating* draft listings from occupancy gaps.

---

## The funnel

1. **Someone applies** → the sheet pushes the row to `recruit-ingest` on submit and they land in the Inbox (`stage = 'review'`) automatically — see [recruiting-sheet-ingest.md](../../infrastructure/recruiting-sheet-ingest.md).
2. **Application review** — quality of character + culture fit, judged collectively:
   - 3+ Recruiting Society members score 1–5 ("would you live with them?").
   - A single veto rejects — **auto-archived** immediately, update email owed.
   - Auto-flags (budget < $1,500/mo; disqualifiers like pets as they're added) also auto-archive.
   - Score ≥ threshold (avg ≥ 3.5 across ≥ 3 votes) → Candidates.
   - Everyone who doesn't pass **receives an update email** (Phase B queue).
3. **Room openings** — listings generated from the occupancy calendar; candidates bucketed into the listing that fits best (move-in date weighted heaviest). Same-date openings share one general pool; the room is assigned later. A Recruiting member sends the screening request from the listing shortlist.
4. **Screening request** — availability asked in natural language; replies trigger the claim flow in `#recruiting-automation` (see [agape-screening-claim-automation.md](./agape-screening-claim-automation.md), built in a parallel effort — `recruit-discord` is shared infrastructure).

Out of scope for now (manual): post-screening accept/vote, house tour, onboarding (Notion, Google permissions, buddy matching).

## Decisions taken (2026-07-22)

| Question | Decision |
|---|---|
| Where do residents vote? | Hybrid — Discord ping links into the app; Discord-native voting revisited after the claim endpoint ships. |
| Veto semantics | Separate toggle from the 1–5 scale; note required; tally blind until you cast your own vote. Veto/auto-flag → **immediate auto-archive**, no confirmation step. |
| Rejection emails | Queued with one-click batch send (Phase B); flip to full-auto after a clean month. |
| Auto-generated listings | Created as drafts from occupancy; one click to open; bucketing only sees `open` listings (Phase C). |

## Technical shape

**Migration 120** (`supabase/migrations/120_recruit_votes.sql`):
- `recruit_applicants.stage` — `review | candidate | rejected | archived`. `rejected` = archived with an update email owed; `archived` = closed, nothing owed (historical backfill).
- `recruit_votes` — one row per (applicant, voter); `score 1–5`, explicit `veto` (note required), RLS: members read all, write own.
- Thresholds in `recruit_settings` (`vote_min_count = 3`, `vote_pass_avg = 3.5`).
- Trigger `recruit_recompute_stage` on vote writes is the single source of truth; manual moves via `recruit_set_stage(applicant, stage)` RPC (applicants table stays read-only to clients).
- Backfill: old decisions map outreach/hold → candidate, pass → archived.

**Client (v3.0.0):** rail = Review / Candidates / Openings / Screening / Archive (+ Occupancy). Review overlay footer is contextual — vote bar (1–5 + veto + note) in Review, Not a fit / Add to listing for Candidates, Reopen for archived. Legacy URLs (`?view=inbox|outreach|hold`) redirect.

## Phasing

- **A (done):** voting core, stage machine, rail restructure.
- **B:** Discord ping on new application; rejection-email queue + template in Archive (`recruit-gmail` gains a `rejection` kind; needs a `update_email_sent_at` marker).
- **C:** auto-generate draft listings from occupancy gaps (`recruit_listings.source='auto'`, `pool_key` for same-date grouping); auto-bucket candidates via `recruit-match` on pool entry.
- **D:** "Request screening" action + integration with the screening-claim automation.

### v3.3.0 (2026-07-22): recruiter-confirmed move-in
Structured `move_in_from`/`move_in_to` window on the applicant (migration 124, set via `recruit_set_move_in` RPC, attributed). Editable from the profile's Move-in fact — the applicant's typed answer stays on top, the confirmed window sits underneath. When set it is exact (no "flexible" escape hatch) and overrides the parsed text in sublines, filters, and placement qualification; saving re-runs the placement sweep.

### v3.39.0 (2026-07-29): trial check-in + decision dates
A trial candidate's two decision moments now live on the stay (migration 139,
`recruit_stays.checkin_on` / `decision_on`), not in someone's head:

- **Check-in** — defaults to `starts_on + 1 month`. Far enough in to have signal,
  early enough that a fixable problem is still fixable.
- **Decision** — defaults to `ends_on - 1 month`, usually the end of month two of a
  three-month sublet. Both sides need a month to make other plans.

Both are prefilled in the occupancy drawer whenever the stay's type is **Trial
candidate**, and both are editable — the defaults are a starting point, not a rule.
Milestones must fall inside the trial window and the decision must follow the
check-in. Changing a stay's type to anything else clears them.

**Reminders.** `recruit-discord` v1.15.0 posts one embed per milestone to
`#recruiting-automation`, seven days ahead, on the existing 15-minute `/remind`
tick — no new cron. `checkin_reminded_at` / `decision_reminded_at` make each post
once-only; moving a date in the app clears the stamp so the new date gets its own
reminder. Milestones backdated more than 14 days are stamped silently — a date
corrected after the fact isn't news.

Backfilled on the two live trials (Alejandra, Sophia); Andy's finished Jan–Feb
trial was left alone.

### v3.41.0 (2026-07-29): candidate → resident
The end of the funnel finally exists. Migration 141:

- **`recruit_stays.applicant_id`** — the missing link. Until now the person in
  the room was a free-text name with no way back to the application they came
  from, so nothing could join the two halves of the app together. Nullable:
  most residents predate the funnel.
- **`stage = 'resident'`** — a terminal state that isn't a rejection. Drops
  them out of the auto-placement sweep and every applicant rail for free.
- **`recruit_onboarding`** — a checklist seeded on promotion, ticked by hand,
  each row carrying who ticked it. Deliberately **not** a provisioning
  integration: it's the house's shared memory of what a new resident is still
  owed (Google Group, Notion, Discord role, buddy, chore rotation, keys).
- **`recruit_promote_stay` / `recruit_promote_candidate`** — one transaction:
  close the trial the day before, open an open-ended residency, move the
  stage, retire their listing placements. Two entry points because two kinds
  of people get promoted — a candidate the funnel knows, and whoever is in a
  trial stay. Two of the three trials on the board right now (Sophia, Andy)
  have no application row at all, so a promotion keyed only on
  `recruit_applicants` would have been useless for them.

**UX.** The residency-decision reminder links into Occupancy. A trial stay's
drawer leads with **Welcome them in**, which expands to room + start date
(defaulting to the trial room and the day after the trial ends) and confirms.
The candidate profile shows the same action and hands off to the drawer rather
than duplicating the form. Saying no uses the existing Remove… sheet, which
gains a **Trial ended — not staying** reason (shown only for someone actually
on a trial) so the archive can tell "we lived with them and it didn't work"
apart from "we never got that far".

Not built: a Discord announcement on promotion. It needs an authenticated
route on `recruit-discord`, and the checklist already gives the house the
signal. Worth revisiting if promotions start getting missed.

### Design reference
Row states, chip taxonomy, and subcopy grammar for Inbox/Candidates/Openings: [docs/ux/recruiting-row-states.md](../../ux/recruiting-row-states.md) (v3.5.0 — response dot, room pills, note bubble, ✕ removal, see-more bar).
