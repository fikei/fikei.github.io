# Agape recruiting funnel — collective review + staged pipeline

**One line:** `/applications` moves from single-decider triage (Inbox → Outreach/Hold/Archive) to a staged funnel — Review (collective votes) → Candidates → Openings → Screening → Archive — with server-side stage computation.

Status: **Phase A shipped (v3.0.0, migration 120); auto-placement shipped early (v3.2.0, migration 123)** · Phases B + D planned.

### v3.2.0 amendments (2026-07-22)
- "Review" is named **Inbox**; Openings sits in the House rail group under Occupancy.
- Legacy Hold applicants went back to Inbox — hold ≠ passed review.
- **AI listing suggestions removed** from profiles. Replaced by deterministic auto-placement: candidates land in **every** open listing they qualify for (`recruit_listing_candidates`; qualification = track match, budget ≥ rent when both known, move-in dates must fall inside the listing window — no padding; only explicit "flexible" rides any window, ASAP fits rooms opening within a month, unparseable dates never auto-place). Recruiter removals are tombstoned so the sweep never re-adds them. This delivers most of old Phase C — remaining Phase C scope is only auto-*generating* draft listings from occupancy gaps.

---

## The funnel

1. **Someone applies** → lands in Review (`stage = 'review'`).
2. **Application review** — quality of character + culture fit, judged collectively:
   - 3+ Recruiting Society members score 1–5 ("would you live with them?").
   - A single veto rejects — **auto-archived** immediately, update email owed.
   - Auto-flags (budget < $1,500/mo; disqualifiers like pets as they're added) also auto-archive.
   - Score ≥ threshold (avg ≥ 3.5 across ≥ 3 votes) → Candidates.
   - Everyone who doesn't pass **receives an update email** (Phase B queue).
3. **Room openings** — listings generated from the occupancy calendar; candidates bucketed into the listing that fits best (move-in date weighted heaviest). Same-date openings share one general pool; the room is assigned later. A Recruiting member sends the screening request from the listing shortlist.
4. **Screening request** — availability asked in natural language; replies trigger the claim flow in `#recruiting-interviews` (see [agape-screening-claim-automation.md](./agape-screening-claim-automation.md), built in a parallel effort — `recruit-discord` is shared infrastructure).

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
