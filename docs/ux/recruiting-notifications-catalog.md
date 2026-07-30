# Recruiting notifications — the catalogue

**Every notification the recruiting system can send.** One row per kind: what
fires it, what it says, what you can do about it, and how it repeats.

**Keep this current.** Adding a detector without adding its row here is how the
catalogue stops being trusted. The invariants at the bottom are checkable — if
one of them stops holding, that's a bug, not a documentation gap.

**All the words live in one file:** `supabase/functions/_shared/recruit-copy.ts`
— every label, every sentence template, every action. Detectors decide what is
true and name a copy key; they contain no prose. Read that file top to bottom to
read all the copy at once.

Source of truth for behaviour: `_shared/recruit-notify.ts` (detectors, dispatch)
and `recruit-gmail/index.ts` (reply intents). Design rationale:
[agape-recruiting-notifications.md](../strategy/prds/agape-recruiting-notifications.md).

## Editing the copy

**Without a deploy.** Rows in `recruit_copy` override the module's defaults.
From the Supabase SQL editor:

```sql
select recruit_set_copy(
  'review_stalled',
  '{subject} has been waiting {days} for someone to read their application.',
  array['subject','days']          -- what this notification can use
);
```

The third argument is checked: a template using a placeholder the detector
doesn't supply is refused, so a typo can't ship a sentence with a hole in it.
`recruit_reset_copy('review_stalled')` puts one back; `select * from
recruit_copy_status` shows everything currently changed and by whom.

**See it before it sends.** `POST /recruit-discord/remind?dry=1` runs the real
detectors through the real renderer and returns every line it *would* say,
marking which already exist. It writes nothing and posts nothing.

Checking an edit by deleting rows and forcing a real tick is a **re-send, not a
preview** — it re-posts every row it recreates.

**With a deploy.** Edit `_shared/recruit-copy.ts` and redeploy `recruit-discord`
and `recruit-gmail`. That is the version that ships and is reviewable in a PR;
the table holds only deliberate divergence from it.

---

## How to read this

**Lane** — when it reaches Discord. `Now` = the next 15-minute tick. `Daily` =
one section of the 8:30am PT digest. `Weekly` = Monday roll-up. The lane governs
Discord only; the in-app log is never batched or delayed.

**Audience** — `house` goes to the members channel, `oncall` is an escalation
into `#recruiting-automation` (its membership *is* the on-call roster; no
mentions), `none` is a profile event that is recorded and never sent.

**Currently everything lands in `#recruiting-automation`** — `notify_house_posts`
is `false` and `NOTES_CHANNEL_ID` is held to the automation channel. Two switches
release it: `notify_house_posts = true` in `recruit_settings`, and
`RECRUITING_SOCIETY_POSTS=true` in the function env.

**Copy structure** — one prose sentence with the subject hyperlinked inside it.
No kind slugs, no lane tags, no clause after an em dash, no buttons, no
mentions. `{}` in a sentence marks where the linked subject goes.

**Owner** — the housemate on the hook, when one is known: the screener who took
the call, the reviewer who asked for a second read. Stored on the row
(`owner_name`, `owner_user_id`) as well as named in the sentence, so the log can
answer *what is Kate on the hook for*. It reads as "yours" in the app when it is
you. **Unowned is the common case and is often the news itself** — "nobody has
reviewed this" is precisely a notification with no owner.

A name only counts as an owner if it's a person. Calls swept off the shared
calendar carry the organiser's display name — "Agape Internal Calendar", "the
house" — and those resolve to no owner rather than claiming a calendar is taking
a call. Ownership populates for calls booked through the app; a swept one has
nobody attached.

**Repeat** — the `dedupe_key` shape. A key fires exactly once; a key with a step
or date segment re-fires when that segment changes.

---

## Applicants

| Kind | Fires when | Says | Action | Lane · audience | Repeat |
|---|---|---|---|---|---|
| 📥 `application_new` | a new application is stamped by the gmail scan | *{} applied for a sublet, from September 1st.* | Review them | Now · house | once per applicant |
| ⏳ `review_stalled` | in review, no verdict, 48h since the house could have known¹ | *{} has been waiting 24 days for a review.* | Review them | Daily · house → **oncall at 5 days** | one per step (`waiting`, `escalated`) |
| 📚 `review_backlog` | applications older than 30 days that nobody ever reviewed | *48 applications have never been reviewed, all of them older than 30 days.* | Open the inbox | Weekly · house | once per ISO week |
| 🙋 `needs_input` | a reviewer records a `needs_input` verdict | *Kate wants another read on {}.* | Read the application | Now · house | once per verdict row |
| ✅ `candidate_placed` | passed review and the sweep found rooms | *{} passed review and fits Priest.* | Open the shortlist | Now · house | re-fires when the room set changes |
| 🚧 `candidate_parked` | passed review, no open room fits, no call booked | *{} passed review but no open room fits them.* | Open their profile | Weekly · house | monthly per person |
| 💤 `gone_cold` | active, we wrote >10 days ago, never answered, no call | *{} never answered the last email, sent 12 days ago.* | Open their profile | Weekly · house | one per week waited |
| 📊 `decision_open` | screened, and the date they'd move is ≤14 days out | *The house needs to decide on {} before Aug 12, 9 days away.* | Open their profile | Daily · house → **oncall at ≤3 days** | one per step |
| ⌛ `screening_followup` | interviewed, and silence since² | *{} was interviewed 6 days ago and the house still hasn't decided.* | Write to them | Day 3 Daily, day 5+ Now · **oncall past 10 days** | day 3, day 5, then every 5 |
| 🎉 `candidate_promoted` | a resident stay opens against an applicant | *{} moved into Priest on Aug 1 as a resident.* | Open the calendar | Now · house | once per stay |

¹ The clock is `COALESCE(discord_ping_at, submitted_at)`, windowed to 30 days.
Keying on the ping alone once reported "nothing waiting" while 53 applications
sat unreviewed, because 50 had never been pinged.

² Measured from the later of the call and our last message, so a holding email
resets it. Stops when they leave the candidate stage.

---

## Replies — what an applicant sends

Classified by Haiku on the same call that already reads each reply for
availability windows. `intent` routes; `intents` keeps everything the message was
doing. Confidence below **0.6** becomes `unclear` and goes to a human. Parsed
availability windows override the label — the parse is ground truth, the label is
an opinion.

All carry the same action (**Read the thread**) and the same repeat (once per
message) unless noted.

| Kind | Says | Lane |
|---|---|---|
| 📅 `reply_availability` | *{} is free Wed, Jul 29 10:15–10:45am · Thu, Jul 30 10–10:30am.* | Daily |
| ⏰ `reply_reschedule` | *{} wants to move their call.* | **Now** |
| 🔄 `reply_plans_changed` | *{} told us that they can't move until July.* | **Now** |
| 👋 `reply_withdrawing` | *{} is no longer looking.* | **Now** |
| 🔑 `reply_post_acceptance` | *{} is asking about moving in.* | **Now** |
| ❓ `reply_question` | *{} asked whether the room is furnished.* | Daily |
| 📎 `reply_info_provided` | *{} sent something over.* | Daily |
| 🔔 `reply_nudge` | *{} is following up.* | Daily |
| 🤔 `reply_unclear` | *{} replied and it needs a read.* | Daily |

**Availability is special twice over.** It collapses to one entry per person per
day — arranging a call is a back-and-forth and every leg parses as availability,
which once produced eight identical lines from one thread. And it is suppressed
entirely once a call exists for that person, or once every window it offers has
passed: *"Katie is free Fri Jul 24"* is not news when Katie was interviewed on
the 23rd. What she is owed then is `screening_followup`.

**Question, plans_changed** splice the applicant's ask into the sentence as a
clause. The model returns a third-person noun phrase completing "they asked ___";
anything that still arrives shaped like a sentence is dropped rather than
spliced, because a mangled sentence makes the whole channel look automated.

---

## The call

| Kind | Fires when | Says | Action | Lane · audience | Repeat |
|---|---|---|---|---|---|
| 📣 `screening_unclaimed` | times offered >72h ago, no call booked³ | *{} offered times 4 days ago and nobody has taken the call.* | Take the call | Now · **oncall** | one per 3-day block |
| 🤝 `screening_booked` | a screening is scheduled **and still ahead**⁴ | *{}'s intro call is booked for Wednesday, Jul 29 at 10:15 AM.* | Open their profile | Now · house | re-fires if the call moves |
| 📞 `screening_today` | a scheduled call is today and wasn't booked today | *{} has an intro call today at 5 PM with Kate.* | Open their profile | Now · house | once per call per day |
| 📝 `screening_notes` | the recording and summary land | *{}'s recording & summary are ready.* | Read the notes | Now · house | once per screening |

³ Read from `recruit_availability`, not claim posts. Claim posts only exist when
`discord_auto_post` is on — it is off — so keying on them meant the funnel's most
damaging failure could never fire.

⁴ Keyed on `recruit_screenings`, so it catches all three booking routes: the
Claim button, a time agreed in email, and someone booking by hand. The screener
is named only when the name is a person — swept calendar events carry the shared
calendar's display name, and *"Agape Internal Calendar is taking Keerti's call"*
reads as machine output.

---

## Openings

| Kind | Fires when | Says | Action | Lane · audience | Repeat |
|---|---|---|---|---|---|
| 📄 `listing_draft` | a draft appears from an occupancy gap | *{} came up as a draft opening from Sep 8.* | Open the listing | Now · house | once per listing |
| 🐌 `listing_draft_stale` | a draft sits ≥7 days | *{} has sat as a draft for 9 days and is not collecting candidates yet.* | Open the listing | Weekly · house | monthly |
| 🎯 `listing_has_candidates` | an open listing's shortlist stops being empty | *{} has 4 candidates on its shortlist and is ready for screening requests.* | Open the shortlist | Now · house | once per listing |
| 🚫 `listing_no_qualifiers` | open ≥7 days with an empty shortlist | *Nobody qualifies for {} because the rent is above what most candidates can pay.* | Open the listing | Weekly · house | monthly |
| 🏠 `opening_at_risk` | open, starts within 21 days | *{} opens Aug 12, 14 days away, and is still unfilled.* | Open the shortlist | Daily · house → **Now at ≤7 days** | one per step |
| 🔴 `opening_overdue` | open, start date already passed | *{} should have opened Jul 20, 9 days ago, and is still empty.* | Open the shortlist | Now · **oncall** | one per step |
| 📋 `listing_filled_no_stay` | marked filled, nobody booked on the calendar | *{} is marked filled from Sep 1 but nobody is booked into it on the calendar.* | Open the calendar | Weekly · house | monthly |

`listing_no_qualifiers` names *which* of the three gates is closing everyone out
— track, budget, or dates — because each has a different fix and "no candidates"
alone is not actionable.

---

## The house

| Kind | Fires when | Says | Action | Lane · audience | Repeat |
|---|---|---|---|---|---|
| 📦 `room_emptying` | a stay ends within 45 days, no follow-on, no listing⁵ | *{} empties Sep 7 when Chris leaves, and has no listing yet.* | Open the calendar | Daily · house → **oncall at ≤21 days** | one per step |
| 🎁 `onboarding_owed` | checklist rows unticked 14 days after moving in | *{} moved in 21 days ago and is still owed 3 things.* | Open the calendar | Weekly · house | one per week |
| ❗ `occupancy_conflict` | two stays overlap in one room | *2 rooms have two people booked over the same dates.* | Open the calendar | Weekly · house | monthly, one summary |

⁵ 45 days is roughly one full funnel — review, screening, decision, move — so it
fires at the last moment the house can still fill the room without rushing.

---

## Trial votes

The two moments the house weighs in on someone already living here: the
**month 1 check-in** and the **final decision**. Both dates live on the trial
stay (`recruit_stays.checkin_on` / `decision_on`, migration 139) and both are
answered by a copy of the housemate feedback form linked next to the date
(`checkin_form_url` / `decision_form_url`, migration 152).

**The ballot closes at a Monday meeting, not on the milestone.** The house
decides out loud, at the last Monday meeting *strictly before* the milestone —
so responses are only useful if they are in before that meeting, and every
sentence names it. A milestone that itself falls on a Monday closes at the
meeting a week earlier: the answers are wanted going into the day, not on it.

| Kind | Fires when | Says | Action | Lane · audience | Repeat |
|---|---|---|---|---|---|
| 📮 `trial_vote_open` | 7 days before the closing meeting | *Keerti is up for their month 1 check-in on Sep 3, and the house votes at the meeting on Aug 31.* | Open ballot | Daily · house | once per milestone |
| 📢 `trial_vote_due` | 3 days before the milestone⁶ | *Keerti's month 1 check-in lands Sep 3, so the ballot has to be in before the meeting on Aug 31.* | Open ballot | Now · house | once per milestone |
| 🚨 `trial_vote_last_call` | the day of the closing meeting | *The meeting on Aug 31 is the last one before Keerti's month 1 check-in on Sep 3.* | Open ballot | Now · house | once per milestone |
| 🟥 `trial_vote_overdue` | the milestone passed with nothing settled | *The house still has not settled Keerti's final decision, which was due Sep 3.* | Open ballot | Now · **oncall** | once per milestone |

⁶ Skipped when three days out already falls *after* the closing meeting — a
milestone early in the week. By then last call is the truer sentence, and two
lines for one fact is what "one notification per fact" forbids.

**A trial that already turned into a residency owes no vote.** The promotion
was the answer, so a resident stay for the same person starting at or after the
trial's start silences both milestones. A milestone more than 14 days past is
history rather than news and is dropped silently — a date backdated in the app
is a correction.

**No ballot collapses the ladder, it doesn't silence it.** With no form link
attached, every rung becomes the one line that says so — *"{} is up for their
month 1 check-in on Sep 3 and has no ballot attached yet."* — posted once.
Chasing people three times toward a link that doesn't exist is noise, but a
milestone days away with no ballot is worse news than one with an unfilled
ballot, not better. `trial_vote_overdue` is exempt: it escalates the missed
decision itself, which no form would have fixed.

### Naming the form copies

One copy per person per milestone — never a shared form, because answers about
two people in one response sheet can't be read separately. Copy
[the housemate feedback form](https://docs.google.com/forms/d/1UpVuMOeSItoSvXpDn2LukBOl6_y0VWfSrrqXs3RWNrk/edit)
into an Agape-owned `Housemate votes/{year}` folder (the template's own folder
isn't writable by the house) and name it:

```
Agape vote · {member} · {Month 1 | Final decision} · {YYYY-MM-DD}
```

```
Agape vote · Keerti Sharma · Month 1 · 2026-08-31
Agape vote · Keerti Sharma · Final decision · 2026-11-30
```

- **`{member}`** is the name on the stay, so the form and the calendar agree.
- **The milestone is one of exactly two strings.** They match the two date
  fields on the stay and the two sentences above; anything else and a person's
  two ballots stop sorting next to each other.
- **The date is the closing meeting, not the milestone.** It is the deadline,
  it is what the nudges say, and ISO keeps the folder in chronological order.
  The drawer shows the computed date under the milestone fields — copy it.

The responses sheet inherits the name with `(Responses)` appended, so a ballot
and its answers stay findable as a pair.

---

## Profile events — `audience: none`

Recorded in the log and on the profile's Activity tab, **never sent anywhere**.
Written by `recruit_log_event` at the moment a housemate acts, because only the
client knows who did it and why.

| Kind | Written when |
|---|---|
| 🔖 `event_verdict` | a review is saved |
| 🚪 `event_passed` | an application is archived (derived on the profile) |
| 🔀 `event_stage` | someone moves an applicant by hand |
| 📤 `event_email` | any outbound message |
| 📌 `event_placement` | added to or taken off a listing |
| 🧳 `event_move_in` | a move-in window is confirmed |
| 💬 `event_comment` | a house note is added |

The profile Activity tab does **not** read these alone — it composes from the
source tables (reviews, notes, placements, decisions, email, calls) so history
predating the ledger is complete, and folds the ledger in only for notifications
those tables can't explain.

---

## Batching

Batching applies to Discord only; the log is never batched.

1. **The default lane is Daily.** `Now` is earned by a rare event where someone
   should act today. A *standing condition* is a digest section by construction.
2. **The digest is one embed with counted sections**, five rows each, then
   "+n more".
3. **Zero state posts nothing.** No "all clear", ever.
4. **≥4 of one kind in a pass collapse to a line-list.**
5. **Escalation replaces repetition** — a condition changes lane as it gets
   urgent rather than re-posting daily.
6. **Backdated facts are stamped silently.** A date corrected after the fact
   isn't news (>14 days).

---

## Invariants

These are the rules that keep the catalogue honest. Each is checkable.

- **Every kind has an action.** All 37 payloads carry `links[0]`, which becomes
  the hyperlink on the subject. A notification you can't act on is just news.
- **Every kind is in `KINDS`.** An unmapped kind renders as `•` with a de-slugged
  label; `icon()`/`label()` warn once when that happens. A merge once dropped two
  thirds of the map and turned the channel into a wall of bullets.
- **Single-codepoint emoji only.** Anything needing U+FE0F renders as an empty
  box in Discord.
- **No relative dates in stored copy.** The ledger keeps a line forever, so
  "today" is true the day it's written and wrong every day after.
- **One notification per fact.** Two kinds describing the same condition get
  merged, not both sent — "hasn't heard back" and "nobody has voted" were one
  situation and became one sentence.
- **The house reaches one decision.** Housemates weigh in on it; it is never
  a tally of votes needing a quorum.
- **Muting never loses information.** `notify_muted` suppresses the broadcast;
  the ledger row is written either way.
- **Refreshing copy on a delivered row is a re-send, not an edit.** Deleting and
  re-detecting an already-posted notification posts it again.
