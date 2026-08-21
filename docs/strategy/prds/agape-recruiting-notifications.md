# Agape recruiting notifications

> **2026-08-21 (v3.82.0):** the "waiting N days for review" nags are retired —
> `review_stalled` and `review_backlog` no longer detect (old rows still render).
> The application signal is now: **application_new** (with a "could fit {room}"
> line, and an *applied again* variant for re-applications, keyed per
> submission), and **application_updated** — fired only when the applicant's own
> edit (`self_updated_at`, migration 177 trigger: stamped only by their own
> session) makes the application material: it now fits an open listing and the
> stated budget clears the $1,500 floor. The card's second fact
> (`payload.body`) now rides the Discord line too. — applicants, openings, occupants

**One line:** one ledger records **every** notification as a running in-app log,
and Discord carries the ones addressed to all housemates on one of three lanes
(now / daily / weekly) — so the house learns about a stalled review or an
emptying room before it costs them a month's rent, and can always answer "did
anyone ever get back to her?"

Status: **Phase 1 shipped** (migration 142, `recruit-discord` v1.16.0,
`/applications` v3.45.0) — ledger, dispatcher, Activity view, and four detectors
live and verified against real data. Phases 2–4 planned.

**Currently automation-only.** `notify_house_posts = false`, so every
notification, escalation, and digest goes to `#recruiting-automation` and nothing
reaches Recruiting Society. Flipping that one setting is the release.

---

## The catalogue

Every notification that currently exists — trigger, copy, action, lane, and
repeat rule — is listed in
[docs/ux/recruiting-notifications-catalog.md](../../ux/recruiting-notifications-catalog.md),
which is kept current as detectors are added. This document is the reasoning;
that one is the register.

## Why now

The funnel is complete end to end (application → review → opening → screening →
trial → resident, v3.43.0). Every stage transition exists in the data. But the
house only hears about **four** of them, and three of those are about a single
screening call. Everything else is discovered by someone opening
`/applications` and noticing.

The failures that follow are all the same shape — *nobody was told, so nobody
acted*:

- An application sits in the Inbox for two weeks because the ping scrolled past.
- A room empties on Sep 1 and the listing gets created on Aug 20 — three weeks
  is not enough funnel to fill it.
- A draft listing generated from an occupancy gap is never opened, so
  auto-placement (which only sees `open`) never runs.

None of these need new intelligence. They need a dispatcher.

---

## What exists today

| # | Notification | Trigger | Where | Cadence | Dedupe |
|---|---|---|---|---|---|
| 1 | New application | `stage='review'`, no votes, no ping, ≤14d old | ping channel (`RECRUITING_PING_CHANNEL_ID`, falls back to `#recruiting-notes`) | 20-min gmail scan | `discord_ping_at` |
| 2 | Screening claim post | availability submitted | `#recruiting-automation` + notes mirror | on submit | `recruit_claim_posts` |
| 3 | Claim post stuck | claim post unclaimed | same message, edited | 20-min scan (`remindStuckPosts` / `notifyStuck`) | message state |
| 4 | Interview in ~1h | `recruit_screenings.status='scheduled'` | DM to claimer | 15-min tick | `reminder_sent_at` |
| 5 | Call is live / recording + summary | calendar + Recall | notes channel | 15-min tick | `recording_posted_at` |
| 6 | Trial check-in / decision, 7d ahead | `recruit_stays.checkin_on` / `decision_on` | `#recruiting-automation` | 15-min tick | `*_reminded_at` |
| 7 | Unmatched call link nudge | calendar event with no applicant | DM | 15-min tick | per-event |

**Infrastructure already in place** — this is the important part; the proposal
adds almost no new plumbing:

- **Three crons**, all nonce-authenticated (migration 123 pattern):
  `recruit_screening_reminder_tick` (`*/15`, → `recruit-discord/remind`),
  `recruit_gmail_scan_tick` (`*/20`, → `recruit-gmail/scan`),
  `recruit_application_ingest_tick` (hourly, → `recruit-ingest/pull`).
- **Discord helpers** in `_shared/discord.ts`: `postChannelEmbed`,
  `postResilient` (cross-channel fallback), `auditMirror`, `dmUser`,
  channel constants for automation + notes.
- **The dedupe idiom**, already used four times: a `*_reminded_at` / `*_at`
  column, cleared when the underlying date moves, plus a
  "backdated more than 14 days → stamp silently" rule (v3.39.0). Generalising
  this is most of the work.
- **Settings as a table** (`recruit_settings`), so cadence and mutes are
  config, not deploys.
- **A digest precedent**: the new-application ping already collapses 4+ into
  one embed.

**What's missing:** any notion of a notification that isn't hard-coded at its
call site. Six functions each own their own dedupe column, channel choice, and
volume rule. Adding the eleven notifications below the same way would be
unmaintainable and would flood the channel.

---

## Lifecycles

### Applicant

```
submitted → review ─┬─ not_fit ──→ rejected → (update email) → archived
   (Inbox)          ├─ needs_input → stays in review
                    └─ forward ───→ candidate
candidate → auto-placed into every qualifying open listing (Openings)
   → screening request → availability → claim → call → recording
   → house decision → trial stay → resident (+ onboarding checklist)
                                 └─ trial_ended → archived
```

Signals that exist in data and are currently silent: verdict recorded,
`needs_input` asked, placement gained/lost, no qualifying listing, update email
owed, applicant gone cold, and **every inbound reply that isn't availability** —
a reschedule, a withdrawal, a changed move-in date, and an unanswered question
are all currently indistinguishable from each other (all four are just a dot on
a row).

### Opening (`recruit_listings`)

```
draft (auto from occupancy gap) → open → shortlist fills by placement sweep
   → screening → filled | closed
                              └─ start date passes while open = lost rent
```

Silent today: draft created, draft rotting, open with an empty shortlist,
shortlist gained its first candidate, move-in date approaching, start date
passed, filled-but-no-stay-on-the-calendar.

### Occupant (`recruit_stays`)

```
stay opens (resident | sublet | candidate | shared)
   candidate: → check-in (+1mo) → decision (−1mo) → promote → resident
                                                  └─ not staying → exit
   any: ends_on approaches → room becomes a gap → draft listing
```

Silent today: any non-trial stay ending, promotion, onboarding items
outstanding, overlapping or expired stays.

---

## Proposed notifications

Lane key: **Now** = the next 15-min tick. **Daily** = one section of the 8:30am
PT digest. **Weekly** = Monday roll-up. **Audit** = `#recruiting-automation`
only, unbatched, never news.

### Applicants

| ID | Notification | Trigger | Lane | Repeat / reset |
|---|---|---|---|---|
| A1 | New application | *(exists — #1)* | Now, ≤3 individually; ≥4 as one embed | once per applicant |
| A2 | **Waiting on a review** | `review`, zero verdicts, 48h since the house could have known | Daily | escalates at 5 days into its own `#recruiting-automation` notification |
| A3 | **Another read wanted** | verdict `needs_input` written | Now | once per verdict row; names the asker + quotes their comment |
| A4 | **Passed review — and where they landed** | `stage → candidate` | Now | once; body lists auto-placements, or says *no open room fits*, which is itself the signal |
| A5 | **Candidate parked** | `candidate` ≥14d, zero active placements, no screening | Weekly | repeats weekly while true |
| A6 | **Applicant replied** | inbound email, active stages only | *by intent* — see [Reply intents](#reply-intents) | per message |
| A7 | Availability with no claim | *(exists — #3)* | Now | + new: 72h unclaimed → escalation in `#recruiting-automation` |
| A8 | Interview reminders / recording | *(exists — #4, #5)* | Now | unchanged |
| A10 | **Gone cold** | active stage, last outbound >10d, nothing inbound since | Weekly | repeats weekly |

### Reply intents

"An applicant replied" is not a notification — it's a fact with eight different
consequences. A reschedule request an hour before a call and a question about
whether the room is furnished do not belong in the same line of the same digest.
So inbound replies are classified by **intent**, and the intent — not the reply
— is what routes.

This is nearly free: `recruit-gmail`'s scan already runs Haiku on every inbound
reply body (`extractAvailability`, which today returns `windows`, `platform`,
`timezone_note`, `needs_human`). Intent is **three more fields on that same
call** — no new pass, no new API cost, no new latency.

| Intent | What it looks like | Lane | Routes to |
|---|---|---|---|
| `availability` | times offered, "Tue or Wed afternoon works" | **Daily** (+ the claim post fires immediately, as today) | the claim post asks *someone* to take the call; the digest line and log entry tell *the house* she replied. Both. |
| `reschedule` | move or cancel a booked call | **Now** + DM the claimer | the screening. Most urgent thing in the inbox: the alternative is a no-show on both sides. |
| `plans_changed` | move-in date, budget, or duration moved | **Now** | the profile's Move-in / budget facts — this changes auto-placement qualification, so it can silently invalidate a shortlist |
| `withdrawing` | took another place, no longer looking | **Now** | archive with `exit_reason='opted_out'`. They're holding a shortlist slot until someone acts. |
| `post_acceptance` | lease, keys, move-in day, parking | **Now** | Occupancy / onboarding, not the funnel |
| `question` | rent, rooms, housemates, process | **Daily**, question quoted verbatim | whoever's on-call; escalates to Now if unanswered 48h |
| `info_provided` | references, proof of income, socials, the thing we asked for | **Daily** | the profile — read and attach |
| `nudge` | "just following up", "any update?" | **Daily**, with *how long they've waited* | the stalled thing they're waiting on. A nudge is a reputational clock, and the wait time is the whole message. |
| `unclear` | can't tell, or confidence below floor | **Daily** | a human reads the thread. Generalises the existing `needs_human` flag. |

**Rules**

1. **One primary intent routes; secondaries annotate.** A reply that offers
   times *and* asks about parking is `availability` + `question` — the digest
   says "Maya sent times and asked something", the claim post still fires, and
   the log records both intents against the message. Store `intent` (primary,
   drives the lane) and `intents` (array, drives the copy).
2. **Extraction outranks the classifier on its own turf.** If `windows.length >
   0`, `availability` is in the array no matter what the classifier said — the
   parse is ground truth, the label is an opinion.
3. **Confidence floor 0.6 → `unclear`.** Below that a human reads it. Same
   discipline as `detectAgreedTime`'s "when in doubt, false": a misrouted
   withdrawal is worse than an unrouted one.
4. **Intent routes attention, never action.** No auto-reply, no auto-archive on
   `withdrawing`, no auto-edit of a move-in window on `plans_changed`. Each
   Now-lane post carries the *button* for the obvious action; a person presses it.
5. **Active stages only for routing.** Inbound mail on an `archived` /
   `resident` applicant is logged and not classified — no LLM cost, and it still
   appears in the log as a plain reply.
6. **Dedupe per message, digest per applicant.** `dedupe_key =
   'reply_<intent>:<email_id>'`, because two questions deserve two answers; but
   the daily digest collapses to one line per person.
7. **Each intent is its own `kind`** in the ledger — so each has its own lane
   and its own entry in `notify_muted`. If `nudge` turns out to be noise, it
   gets switched off without touching the other eight.

**Schema:** `recruit_emails` gains `intent TEXT`, `intents TEXT[]`,
`intent_confidence REAL`, `intent_summary TEXT` (one line, the actual ask in the
applicant's words — this is what the digest prints, not the snippet).

**In-app:** the existing reply dot on Openings/Screening rows gains the intent
label, so the rail and the digest say the same word. Row-state and chip grammar
to be added to [recruiting-row-states.md](../../ux/recruiting-row-states.md).

**Digest shape:**

```
💬 Replies (4)
  ⏰ Reschedule · Maya wants to move Thu 3pm → DM'd Kate
  📅 Plans changed · Tom's move-in slipped to Oct 1 — recheck his placements
  ❓ Question · Priya: "is the room furnished?" · waiting 2 days
  👋 Nudge · Sam followed up · waiting 9 days on a screening request
```

### Openings

| ID | Notification | Trigger | Lane | Repeat / reset |
|---|---|---|---|---|
| O1 | **Draft listing created** | `status='draft'`, `source` in (`gap`,`leaving`) | Now if <3, else Daily line-list | once per listing; buttons: open it / dismiss |
| O2 | **Draft still untouched** | `draft` ≥7d | Weekly | weekly while draft |
| O3 | **Nobody qualifies** | `open` ≥7d, zero qualifying candidates | Weekly | includes *why* — track / budget / date is the blocker |
| O4 | **Opening at risk** | `open`, `starts_on` ≤21d out | Daily | escalates to Now at 7 days; resets if `starts_on` moves |
| O5 | **First qualifying candidate** | shortlist 0 → ≥1 | Now | once per listing; this is the cue to send a screening request |
| O6 | **Start date passed, still open** | `open`, `starts_on` < today | Now | once, then Daily until resolved — this one is literally lost rent |
| O7 | **Filled but no stay** | `filled` 24h with no `recruit_stays` row covering the window | Audit + Daily | until reconciled |
| O8 | Rent / window edited on an open listing | update to an `open` row | Audit | every time |

### Occupants

| ID | Notification | Trigger | Lane | Repeat / reset |
|---|---|---|---|---|
| C1 | **Room emptying** | current stay `ends_on` ≤45d, no follow-on stay and no listing for that room | Daily | resets if `ends_on` moves; 45d ≈ one full funnel (review → screening → decision → move) |
| C2 | Trial check-in in 7d | *(exists — #6)* | Now | unchanged |
| C3 | Trial decision in 7d | *(exists — #6)* | Now | + new: decision date passed, stay still `candidate` → Daily until resolved |
| C4 | **Welcomed in** | `recruit_promote_stay` / `recruit_promote_candidate` succeeds | Now | once; links the onboarding checklist. *(PRD v3.43.0 flagged this as deliberately not built — the ledger removes the objection, since it no longer needs a bespoke authenticated route.)* |
| C5 | **Onboarding still owed** | `recruit_onboarding` rows unticked 14d after promotion | Weekly | names the items; weekly while open |
| C6 | **Occupancy integrity** | overlapping stays in one room; open-ended stay whose room also has a later stay; `ends_on` in the past still treated as current | Audit, Daily | one summary post, not one per conflict |

New, non-existing notifications: **24** (16 above + 8 reply intents). Existing,
absorbed onto the ledger: **7**.

---

## Surfaces

Three surfaces, and they are not alternatives — a notification can land on all
three. What decides each one is different:

| Surface | Gets | Decided by |
|---|---|---|
| **The log** — in-app Activity view **and** `#recruiting-automation` | **everything, always** — every notification, every kind, in order, retained forever | nothing. There is no filter, no batching, no mute. |
| **Discord members channel** | anything addressed to **all housemates**, batched | audience. If the house collectively needs to know or act, it goes where the house is. |
| **DM** | anything owned by **one named person** | ownership — and only real ownership: the claimer of a specific call. |

The log has **two locations, one content**: the Activity view for browsing and
filtering, `#recruiting-automation` for the same stream arriving live and
unbatched. Neither is a subset of the other. `#recruiting-automation` is not an
"audit mirror" as earlier drafted — it is the running log itself, in Discord
form, and it is where on-call lives (below).

**Double-notify is correct, not a bug.** The same fact reaching a housemate twice
through two surfaces is two different messages: the claim post asks *someone* to
pick a call up; the digest line tells *the house* that Maya sent times; the log
entry is the record that it happened at all. Suppressing the second and third
because the first fired is how a house ends up unable to answer "did anyone ever
get back to her?" So the earlier "never double-notify" rule is dropped — every
notification is logged, and Discord routing is decided on audience alone.

**Muting never loses information.** `notify_muted` suppresses the *Discord*
post for a kind. The log entry is written regardless. This is what makes it safe
to switch a noisy kind off — nothing disappears, it just stops shouting.

### The in-app log

A rail view (**Activity**, under the house group next to Occupancy) rendering
`recruit_notifications` newest-first: timestamp, kind icon, the same one-line
body Discord got, the subject as a link into its rail, and whether it went to
Discord, a DM, or nowhere. Filterable by subject type (applicant / opening /
occupant), by kind, and by subject — so "everything that ever happened to Maya"
is one filter, and it's also the answer to "what did we send this week".

Because the ledger is written by the detect pass before anything is dispatched,
the log is complete by construction — it is not a copy of what Discord received,
it is the source Discord reads from.

### Reaching out to all housemates

Anything the recruiting system asks of the house as a body posts to Discord, at
the moment of asking — these are the ones where silence is the failure:

| | Ask | Currently |
|---|---|---|
| H1 | **New application needs a review** | exists (#1) — keep |
| H2 | **A screening needs claiming** | exists (#2) — keep |
| H3 | **A house decision is open** | `recruit_decision_votes` collecting after a screening — **silent today**. Triggered by the clock, not by voting: see below |
| H4 | **A second read is wanted** | `needs_input` (A3) — the asker is asking the house, not one person |
| H5 | **A trial decision is due** | exists (#6) — keep |
| H6 | **Someone was welcomed in** | C4 — the house should meet their new housemate |
| H7 | **The daily digest** | everything standing, one embed |

#### H3 — the open house decision, on a soft clock

After a screening, `recruit_decision_votes` starts collecting and nothing
announces it. The obvious fix — post when the first vote lands — is wrong: it
nags about a decision with a month of runway, then goes quiet exactly when the
date gets close and someone actually needs to decide.

So H3 is **triggered by the deadline, softly**:

| When | Lane | Copy |
|---|---|---|
| **14 days** before the date | Daily digest | "Maya's decision is open — 3 of 8 have weighed in. Moves in 2 weeks." |
| **7 days** | Daily, moved to the top of the section | names who hasn't voted |
| **3 days** | escalation in `#recruiting-automation` | the room is at stake, not just the vote |
| date passes, still open | Daily until resolved | reads as the miss it is |

**The date** is the first of: the applicant's recruiter-confirmed
`move_in_from`; the `starts_on` of the listing they're placed in; else the
screening date + 30 days as a fallback so a decision without a room still has a
clock. Whichever it is, it resets when edited — the standard reset rule.

**Only the clock triggers.** Vote activity never fires a notification; it only
changes the *copy* (the tally, and who's outstanding). That keeps a lively
decision quiet and a stalled one loud, which is the correct way round.

---

The general rule: **if the ask has no single owner, it is house-wide and it goes
to the members channel.** Only genuine ownership converts it to a DM — the claimer of a
specific call getting their interview reminder. Escalations are *not* DMs; see
on-call.

### On-call is a channel, not a person

**The members of `#recruiting-automation` are on-call.** The channel's
membership *is* the roster — nobody maintains a rotation, nobody holds a pager,
and the roster is self-service: you join the channel to be on-call and leave it
to stop.

Consequences:

- **No `notify_oncall` setting.** There is no Discord user id to configure, and
  no stale-owner failure mode when someone travels or leaves the house.
- **Escalations post to `#recruiting-automation`, not to a DM, and carry no
  mention.** A2 at 5 days and A7 at 72h unclaimed post there as their own
  notification. No `@here`: the channel's members are on-call by definition, so
  the message already reaches exactly the right people, and a channel that
  buzzes phones gets muted — which costs far more than a late reply.
- **The escalation is the second post, not a re-post.** The original notification
  is already in the channel as a log line. The escalation references it and
  raises the volume; it doesn't repeat it.
- **DMs are reserved for one case:** the claimer of a scheduled call, who owns
  something nobody else can do for them. Everything else that would have been a
  DM is a channel post.

---

## Batching

Batching applies **only to Discord**. The log is never batched — that's the
point of having it. At current scale — 14 rooms, a handful of applications a
week — per-event posting would put ~30 messages a week into a channel where the
house currently sees ~3, and the channel would be muted inside a month. So, for
Discord:

1. **Three lanes, and the default is Daily.** A notification earns the Now lane
   only if a human should act *today* and the trigger is genuinely rare
   (a verdict written, a promotion, a shortlist's first candidate). Anything
   that's a *standing condition* rather than an *event* — waiting on a review,
   emails owed, openings at risk — is a digest section by construction.
2. **The daily digest is one embed with counted sections**, in this order:
   Needs a review · Update emails owed · Openings at risk · Rooms emptying ·
   Trials due · Reconcile. Each section is a count plus at most five links, then
   "+n more" into the matching rail view.
3. **Zero state posts nothing** *to Discord*. No "all clear" message, ever — a
   quiet channel must be trustworthy as a quiet channel. The log, of course,
   simply has nothing new in it that day, which reads correctly on its own.
4. **Same-lane collapse.** Any lane firing ≥4 notifications of one kind in one
   pass collapses them to a line-list — the existing new-application rule,
   generalised.
5. **Escalation replaces repetition.** A condition doesn't re-post daily on the
   Now lane; it moves lanes as it gets urgent (A2 at 5 days, O4 at 7 days,
   O6 immediately). One post per escalation step.
6. **Silent stamp for backdated facts.** A date corrected after the fact isn't
   news — the v3.39.0 >14-day rule, applied to every kind.
7. **Audit gets everything, always.** `#recruiting-automation` is the unbatched
   firehose, so digesting never loses information. Existing `auditMirror`
   convention.
8. **Never notify the applicant from this system.** Every lane here is
   house-facing. Applicant email stays in `recruit-gmail`, human-triggered.

Projected steady-state volume: **~1–3 Now posts/day, one digest, one weekly
roll-up** in Discord — against a log that records every one of the ~30 weekly
events in full.

---

## Mechanism

### `recruit_notifications` — the ledger

One row per notification, written by the detect pass **before** anything is
dispatched — so the row is the log entry, and every delivery is a stamp on it.

```
id             uuid pk
kind           text          -- 'review_stalled', 'reply_reschedule', ...
subject_type   text          -- 'applicant' | 'listing' | 'stay'
subject_id     text
dedupe_key     text unique   -- '<kind>:<subject_id>[:<step>]'
audience       text          -- 'house' | 'oncall' | 'person'
recipient_id   uuid          -- set only when audience='person' (a call's claimer)
lane           text          -- 'now' | 'daily' | 'weekly'  (members-channel timing)
payload        jsonb         -- title, body, links, digest section
due_at         timestamptz   -- when it becomes eligible to broadcast
created_at     timestamptz   -- == when it entered the log
log_at         timestamptz   -- posted to #recruiting-automation (the log's Discord half)
members_at     timestamptz   -- posted to the members channel (null = not yet / muted)
dm_at          timestamptz   -- delivered as a DM
digest_id      uuid          -- which digest carried it
muted          boolean       -- suppressed from the members channel; still logged
acked_at       timestamptz   -- resolved in-app, so the log, rail, and digest agree
```

`audience='oncall'` is an escalation: it posts to `#recruiting-automation`
without resolving to any user id and without a mention.

The shape change from a single `sent_at` matters: **the row's existence is the
notification; the timestamps are only deliveries.** A row with every delivery
column null is still a complete log entry, which is exactly what a muted kind
produces. Queries follow from it — the log is `SELECT * ORDER BY created_at`
with no predicate at all; the digest is `discord_at IS NULL AND NOT muted AND
lane='daily'`; the rail badge is `acked_at IS NULL`.

`dedupe_key` unique + `ON CONFLICT DO NOTHING` is the whole once-only guarantee
— it replaces six bespoke `*_at` columns. A reset (date moved) deletes the
unsent row for that key; an escalation is a new key with a `:step` suffix.

### The dispatcher

A `/notify` route on `recruit-discord`, called from the **existing 15-minute
tick** — no new cron, same as v3.39.0. Three passes:

1. **Detect** — one SQL query per kind against applicants / listings / stays,
   inserting into the ledger. Detection is pure and idempotent; running it twice
   changes nothing. **The log is complete the instant this pass finishes**,
   whether or not anything is ever broadcast.
2. **Log** — every row with `log_at IS NULL` posts to `#recruiting-automation`,
   unbatched, muted or not. This pass runs *first* among the delivery passes, so
   the channel is never behind the members channel.
3. **Broadcast Now** — `lane='now'`, `audience='house'`, `members_at IS NULL`,
   not muted → members channel, collapsing ≥4 of a kind; stamp `members_at`.
4. **Escalate** — `audience='oncall'` rows → `#recruiting-automation`, stamped
   `escalated_at` (its own column: an escalation is not a house post, and the log
   must not claim it was).
5. **DM** — `audience='person'` rows → the claimer; stamp `dm_at`.
6. **Digests** — when the tick lands in the 8:30am PT window (or Monday 8:30 for
   weekly) and no digest was sent today, drain that lane's undelivered rows into
   one members-channel embed. Clock is read from the tick, not scheduled — the
   pattern already used for milestone horizons.

Config in `recruit_settings`: `notify_digest_hour` (default 8),
`notify_members_channel`, `notify_muted` (array of kinds — a bad notification is
switched off, not redeployed; the log keeps recording it). No on-call setting:
`#recruiting-automation`'s membership is the roster.

### In-app: the log and the rails

Both read the same ledger, at different altitudes:

- **Activity view** — the complete running log, unfiltered by default. Nothing
  is hidden from it, including muted kinds and DMs (marked as such).
- **Rail badges** — `acked_at IS NULL` rows scoped to each view's subject type.
  Acting in the app stamps `acked_at`, so the next digest doesn't ask for
  something already handled, and the log shows *when it was resolved* rather
  than deleting the entry.

This is the [Ladder Updates queue](../../../ladder/DESIGN.md) pattern extended
by one surface: one source of truth, three readers (log, rail, Discord).

---

## Phasing

- **Phase 1 — spine + log + the four expensive silences.** Migration (ledger +
  settings), dispatcher, daily digest, **and the Activity view**. Kinds: **A2,
  A9, O4, C1**, plus the seven existing notifications rewritten to write ledger
  rows — which is what makes the log a real history rather than a history of the
  four newest things. Migrate A1's dedupe onto the ledger to prove the pattern
  against something live.

  The Activity view belongs in Phase 1, not Phase 4: it's a read-only list over
  a table that already exists by then (~half a day), and it's the only way to
  debug the dispatcher. Shipping digests before the log means shipping a
  notification system you can't audit.
- **Phase 2 — moments of action.** **A3, A4, O1, O5, O6, C4.** Now lane.
- **Phase 2b — reply intents.** Widen the `extractAvailability` prompt +
  4 columns on `recruit_emails`, then wire the nine intents to their lanes.
  Separable from 2 and worth shipping on its own: the three Now-lane intents
  (`reschedule`, `withdrawing`, `plans_changed`) are each a currently-invisible
  failure with a real cost — a no-show, a held shortlist slot, and a stale
  placement. Ship `unclear` + `question` first as the safety net, then the
  routed ones once the classifier's confidence distribution is visible in the
  data.
- **Phase 3 — house-wide asks + the slow rot.** **H3** on its soft clock. Weekly
  roll-up: **A5, A10, O2, O3, O7, C5, C6.**
- **Phase 4 — control.** `acked_at` round-trip from every rail action, log
  filters by subject/kind, per-member mutes.

## Decisions taken (2026-07-29)

| Question | Decision |
|---|---|
| Do declined / passed / archived applicants owe an update? | **No.** A closed applicant is closed and the house owes them nothing. The planned "update emails owed" queue (A9) was cut — chasing a debt that doesn't exist just teaches people to ignore the channel. Sending an update stays a choice on the profile. |
| Mentions on escalations? | **None.** `#recruiting-automation`'s members are on-call, so a post there already reaches them; an `@here` only buzzes phones, and a channel that buzzes gets muted. |
| Notification copy | **Kind + linked subject, nothing else.** No kind slugs, no lane/audience tags, no clause after an em dash, no buttons. The subject text is the hyperlink; detail lives in the Activity view, which has room for a second line. |
| Who is on-call? | **The members of `#recruiting-automation`.** Channel membership is the roster; no setting, no rotation, no user id. |
| Where does the running log live? | **Two places, one content:** the in-app Activity view and `#recruiting-automation`. Not a mirror of the members channel — it is the log. |
| Double-notify? | **Yes.** The same fact on two surfaces is two messages with two audiences. Nothing is suppressed because something else already fired. |
| Log retention | **Forever.** A few thousand rows a year, and its value is answering questions about the past. No pruning, no archive tier. |
| H3 trigger | **The clock, softly** — 14 / 7 / 3 days before the move-in date. Vote activity changes the copy, never fires a post. |
| Intent classifier rollout | **Shadow mode** (defined below) for two weeks before the Now lane opens. |

### Shadow mode, defined

The classifier runs and records, but is not yet allowed to route anything
consequential:

- Every inbound reply is classified; `intent`, `intents`, `intent_confidence`,
  `intent_summary` are written to `recruit_emails`.
- Ledger rows are created for **all** intents, so the Activity view and
  `#recruiting-automation` show exactly what the system *would* have broadcast.
- Only `question` and `unclear` reach the members channel. `reschedule`,
  `withdrawing`, `plans_changed`, and `post_acceptance` stay log-only —
  implemented as their default entries in `notify_muted`, so opening the lane is
  a settings edit, not a deploy.
- After two weeks: read the confidence distribution and the false-positive rate
  against real replies, then unmute.

The failure it exists to prevent: a "sorry, still deciding" classified as
`withdrawing` would, on the Now lane, push someone to archive a live candidate.
In shadow mode that mistake is a line in a log — free to be wrong, and it
produces real calibration data instead of a guessed confidence floor.

## Open questions

1. **Does C1 auto-create the draft listing?** Detecting "room emptying, no
   listing" is one query from generating the draft (Phase C of the funnel PRD,
   still unbuilt). Recommend keeping them separate: notify in Phase 1,
   auto-draft later, so a bad gap detector doesn't litter the Openings rail.
