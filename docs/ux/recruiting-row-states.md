# Recruiting app — row states & subcopy reference

Design documentation for `/applications` list rows (v3.10.0). One row = one applicant; every visual state derives from four inputs: `stage` (server-owned), `placements`, `email state`, and `your vote`. Nothing else may add chrome to a row.

## Shared row anatomy

```
[response dot?] [avatar] [name / subline] ......... [chips] [note bubble?] [action?] [✕?]
```

- **Row tap always opens the review overlay.** There is never an "Open" button; the only row-level action buttons are verbs that do something else (Vote, Send email, Add).
- **Response dot** — 8px blue (`--accent`) dot in the row's left gutter, vertically centered, *beside* the avatar (never on top of it). Meaning: their last email to the house is unanswered-by-us / newest. Tooltip carries recency ("They replied — 3h ago"). Replaces the old "↙ Replied" chip in every view.
- **Note bubble** — filled square speech bubble (rounded rect, tail centered on the bottom edge), accent-colored, with the note count inside in knockout text. Hover shows a styled tooltip (same mechanics as the info-dot): "N house notes · latest — Author: 'first 140 chars…'". Replaces the old "✎ N" text count.
- **Chips** are pills, 24px tall. Color taxonomy: gray = informational (vote progress), blue = placement, green = positive/confirmed, red/amber reserved for Archive states.

## Inbox (`stage = 'review'`)

| State | Visual | Logic |
|---|---|---|
| Fresh | no chip · **Vote** button | zero votes |
| Others voted, you haven't | gray chip `2/3 votes` (count only — **average stays blind until you cast**) · **Vote** | votes > 0, `myVote` null |
| You voted, below threshold | gray chip `2/3 · avg 3.5` · no button | `myVote` set; scored < `vote_min_count` or avg < `vote_pass_avg` |
| They replied | blue response dot (stacks with any chip) | last email direction = in |
| Has notes | note bubble with count | comment count > 0 |

Exit paths are instant and server-side (rows never render in these states): any veto → Archive (update queued) · 3+ votes with avg ≥ 3.5 → Candidates · budget under $1,500 → auto-archived at load. The "Vetoed" and passing-blue chips exist in code but are unreachable in the Inbox.

## Candidates (`stage = 'candidate'`)

| State | Visual | Logic |
|---|---|---|
| Placed | **one pill per room**: `Priest · 9/1` (room name · open date M/D), tooltip = full listing line | one pill per active placement in an open listing |
| Waiting | no pills, no button | no open listing passes `qualifiesFor` (dates/track/budget) |
| Replied / notes | dot and bubble stack as everywhere | email/comment state |

Pills fall back to `In N listings` for the beat before house data loads.

## Openings (rows = active placements, grouped per open listing)

Every row carries grip ⠿ + rank, **one contextual CTA**, and **✕** at the far right. The CTA is a state machine — never a generic "Send email":

| Micro-state | CTA | Logic |
|---|---|---|
| Nothing sent yet | **Reach out** (primary) — opens the AI email draft | no email either direction |
| Waiting on them | muted `sent 3h ago` + **Follow up** | last email direction = out |
| Invite promised | gray chip `Invite promised` + **Follow up** | last outbound reads like manual scheduling ("I'll send an invite", "let's chat tomorrow") — regex on the snippet |
| They replied | blue response dot + **Reply** — opens the Emails tab to read first | last email direction = in, no availability parsed |
| Availability in hand | **Pick a time** (accent, THE primary) + context-line link *"Ask for coverage"* (opens the Discord preview modal) | `recruit_availability` has windows, no screening booked. Discord copy describes the goal (housemates claim), never the transport ("post to Discord") |
| Call booked | slot chip `Fri, Jul 25, 9:00 AM` + **Join call** when a Meet link exists | scheduled row in `recruit_screenings` — booked in-app **or picked up from the shared calendar**: the scan sweeps upcoming events and matches attendees to applicants (application address or any address they've replied from), so manually-sent invites become screening rows automatically |

**✕** removes from *this* listing only — tombstones the placement so the auto-sweep never re-adds; tooltip says so.

### "See other qualified applicants (N)" — full-width see-more bar

Ladder-style expander (`.inbox-more__btn` pattern): full-width, centered, muted, chevron ▾ that flips when open. Sits between the shortlist card and the next listing. Rows inside:

| State | Visual | Logic |
|---|---|---|
| Still in the Inbox | `gathering votes` (or their vote chip) · no button, row tap opens review | `stage='review'` and qualifies |
| Removed by a recruiter | `removed` · **Add** (re-activates the tombstoned placement) | `stage='candidate'`, tombstoned |

Because the sweep places every qualifying candidate, this set is provably {still in review} ∪ {tombstoned} — no third case.

## Row subcopy grammar

`[track badge] [pronouns] · [move-in]` — segments drop out when unknown, never render placeholders.

| Segment | Values |
|---|---|
| track badge | The same `listing-kind` pill as listing headers, xs size: `Full-time` (resident tint) \| `Sublet` (sublet tint). Always first; never plain text. |
| pronouns | lowercase, only when given — `she/her` |
| move-in | **One canonical set:** `Sep 5, 2026` (day known) · `Sep 2026` (month) · `Aug–Sep 2026` (month range) · `Jul 28 → Aug 29` (known in→out window — replaces the old "N-week stay") · `ASAP` · `Flexible` · omitted when unparseable. The `· flexible` suffix never renders in sublines (the raw answer lives behind the profile info-dot). A recruiter-confirmed window replaces the parsed value everywhere: `Sep 1, 2026` or `Sep 1 → Oct 15`. |
| email recency | Openings, awaiting state only: `sent 3h ago` → `2d ago` → date |

There is no stay-length segment — sublet durations read as move-in → move-out dates.

## Empty states & page subtitles

| Surface | Copy |
|---|---|
| Inbox empty | "All caught up — every application has its votes." |
| Any view, filters active | "No applicants match these filters." |
| Listing with no one placed | "No qualifying candidates yet — they land here automatically when they pass review." |
| Other views empty | "Nothing here yet." |
| Inbox subtitle | "N applicants gathering votes · 3 needed, one veto rejects" |
| Candidates subtitle | "N applicants passed review — waiting for a room" |
| Elsewhere | "N applicants" (with "X of Y" when filtered) |

## Known gaps (accepted for now)

1. Waiting candidates don't say *why* nothing fits (dates vs budget vs no open listing).
3. Auto vs manual placements are visually identical.

## Copy rule (2026-07-22)
Downstyle (sentence case) everywhere in buttons, banners, badges, and chips; capitalize proper nouns only (Discord, Agape, Gmail, view names like Inbox). "Post to Discord" ✓ · "Post To Discord" ✗ · "Agape intro call" ✓.


## The two-tier right rail (v3.14.0)
Every Openings row's right side is a stack:
- **Top tier — exactly one primary** (accent button when it's your move, chip when it's someone else's).
- **Context tier — quiet caption below**: timestamps (`replied 2h ago`, `sent 3d ago`), the secondary action as a text link (`Ask for coverage`, `▶ rewatch`), or who/when (`Fri, Jul 25 · 9:00 AM · Sam`).
If a row needs two buttons, the state machine is wrong — demote one to the context tier.

## Call tab (v3.14.0)
Watch opens a **Call** tab on the applicant profile (not a modal): recording player, AI call summary, and comments — the shared `recruit_comments` store, with a "comment at current time" button that prefixes the comment with the video timestamp. The tab appears whenever a screening is scheduled or recorded.

## v3.17 amendments
- **Review availability** (blue) replaces Pick a time; context tier shows `N windows offered`. Opens a modal: bookable slot chips per window, a **How we read it** bullet list (their verbatim snippet + date, timezone conversion note, platform request, the day-part mapping rules), and the secondary path at the bottom: *"Doesn't work with your schedule? Ask the house on Discord"* (→ claim-post preview).
- **Post-screening primary is Schedule a visit** (blue, opens the email draft); Watch demotes to a small inline green ▶ icon beside it — an icon secondary doesn't violate the one-primary rule.
- **Row ⋯ menu** (grip back on the left edge): Open profile · Copy availability link · Remove from this listing · **Pass on [name]…** (confirm → stage `rejected`, update email queued — passing always requires outreach). *Superseded in v3.26 — see below.*


## v3.23 (2026-07-27) — the outstanding list
- **Phase B live**: scan pings the recruiting channel about new review-stage applicants (one post each; 4+ collapse to a digest; `discord_ping_at` dedup). Archive shows the **update tray** — pending rejections with Edit email / Skip and **Send all** (individually drafted community notes via `draft_update`, sent via `send-update` which stamps `update_email_sent_at` and archives clean).
- **Draft listings**: 28+ day occupancy gaps in the next six months become `status='draft'` listings (dashed cards atop Openings; Open listing / Dismiss). Bucketing only sees `open`.
- **Awaiting claim** is a real row state: coverage ask posted → `◆ sent to housemates` chip + `unclaimed Nd · book it yourself` context.
- **Give decision**: post-screening yes/no + note per housemate (`recruit_decision_votes`); the watch-state context tier carries `give your decision` / `N decisions in`; also in the row ⋮. Tally is advisory — moving the person stays human. *Amended in v3.36 — see below.*
- **Follow-up staleness** implemented: grey under 3 quiet days, amber after.
- **Schedule a visit** drafts a visit-specific invite (`emailType: 'visit'`).
- **Flexible dial**: bare "Flexible" rides any window; "month + flexible" = that month ±1.
- **Auto-post toggle**: `discord_auto_post` setting (rail footer checkbox) — the manual→auto claim cutover without a deploy.

## v3.24 — dropped out *(superseded by v3.26)*
Row ⋮ in Openings gains **"[name] dropped out…"**. A withdrawal is not a rejection: it archives clean (`stage='archived'`, **no update email owed**), pulls them off every listing with tombstones so the auto-sweep can't re-add them, and records `reason='dropped-out'` for the CSV. Archive shows a neutral **Dropped out** chip instead of "Update queued".

*This is now the **Opted out** option in the v3.26 Remove sheet.* The menu item and its confirm dialog are gone; historical `reason='dropped-out'` rows are backfilled to `exit_reason='opted_out'` by migration 135 and still render their **Dropped out** chip via `stageChip`.

## v3.25 — automation audit channel
`#recruiting-interviews` was renamed **`#recruiting-automation`** (same channel id). It is now the audit hub: `auditMirror()` in `_shared/discord.ts` posts a one-line record of **every** automation — channel posts, pings, notes, recordings, live-call announcements, and DMs — alongside the real message at its intended target. Skipped when the target already is the automation channel; failures are logged, never propagated. New-application pings target **#recruiting-society** (the members channel) with a 14-day floor so enabling them never dumps the backlog.

## v3.26 (2026-07-29) — removing someone

`Pass` collapsed three different outcomes into one destructive action that always archived **and** queued a rejection email. They're now four, behind one gesture.

### The ⋯ menu

Navigation on top, a rule, then one item:

```
Open profile
Copy availability link
Give decision…            (only when a recording exists)
──────────────────────
Remove…
```

The four outcomes live in a **sheet**, not a submenu — each needs a consequence line that a menu can't carry, and hover submenus are unreliable on a touch surface where the row is already a drag handle.

### The Remove sheet

| Option | Hint | Stage | Placements | Email owed |
|---|---|---|---|---|
| **From this listing** | still a candidate for other rooms | unchanged | tombstones *this* one | none |
| **Save for future** | right person, wrong time — pick when to bring them back | `candidate` | all cleared | none |
| **Opted out** | they withdrew — no update email owed | `archived` | all cleared | **none** |
| **Not a fit** | our no — queues an update email | `rejected` | all cleared | queued in the update tray |

*From this listing* only appears when the sheet is opened from an Openings row — there's no "this listing" to scope to from a profile. *Save for future* expands a date field inline (defaults to three months out).

Ordered least → most final; only *Not a fit* is red.

### Where they show up afterward

| Outcome | Openings | Candidates | Archive |
|---|---|---|---|
| From this listing | leaves that group; reachable under "See other qualified applicants" with `removed` + **Add** | unchanged | — |
| Save for future | gone until the date | `saved for future · Mar 1, 2027` chip; foot offers **Bring back now** | — |
| Opted out | gone | — | `opted out` chip |
| Not a fit | gone | — | `not a fit` chip |

**Save for future auto-returns.** `returnDueCandidates()` runs at load: anyone whose `exit_until` has passed has the exit cleared, and the placement sweep re-places them in the same pass. Without the return trip it would just be Archive with extra steps.

### Transparency exit (never strike-through)

Picking an option doesn't write immediately. The row fades to `opacity: .45` — the same value `.inbox-row.is-dragging` uses, i.e. "in motion, not settled" — swaps its actions for the outcome chip plus **Undo**, and holds 6s. It never moves while the window is open, so nothing reflows under the cursor. Undo is a no-op rather than a compensating write; any re-render flushes held rows so a pending write can't be silently lost.

**Strike-through is not used anywhere in this design system.** Removed, deferred, and archived states are all expressed with transparency.

### Cross-listing drag

Dragging a row onto **another** listing moves the placement (add target, delete source). Dropping inside the same group still reorders. The whole `.inbox-group` is a drop target, so a listing with no rows yet is reachable; it outlines while hovered.

The source placement is **deleted, not tombstoned** — a tombstone means "never here again", which isn't what a move means. If the person doesn't auto-qualify for the target, the toast says so (the manual placement will stick).

### Schema

Migration 135: `recruit_applicants.exit_reason` (`future` | `opted_out` | `not_a_fit`), `exit_until` (DATE, only valid with `future`), `exit_note`, `exit_by_name`, `exit_at`. Writes go through the `recruit_set_exit` RPC — the table stays client-read-only, same pattern as `recruit_set_stage`. Passing a NULL reason clears the exit (that's Bring back now). "From this listing" is *not* recorded here — `recruit_listing_candidates.status` already holds that tombstone.

## v3.27 — "claim" becomes "screener scheduler"
The Discord post that offers an applicant's open times is a **screener scheduler**; a housemate **signs up** for a slot and becomes the **screener**. Row copy reads *"no screener yet · 2d"*, the app action stays **Ask for coverage**, and the preview modal is *"Ask housemates for coverage"* → **Post the scheduler**.

"Claim" survives only where changing it would break things: the `recruit_claim_posts` table and `claimed_*` columns (a rename buys nothing), and Discord `custom_id`s — **live posted buttons carry `claim|…`, so that wire format is frozen**. The edge function accepts both `scheduler-preview`/`scheduler-post` and the legacy `claim-*` action names so a cached browser keeps working.

## Copy rule: no jargon facing housemates
Anything a housemate can read — Discord posts, DMs, audit lines, in-app copy — uses plain language. Never the words that only make sense inside the system: *ingested, extracted, payload, webhook, upsert, token, API, bot permissions, rejected*.

| Was | Now |
|---|---|
| 7 applications ingested from the sheet | 7 new applications |
| Direct message | Message sent |
| Sign-in helper posted | Phone sign-in message posted |
| Posted here because <#x> **rejected it** — check the bot's permissions | Posting this in <#x> didn't work, so it's here instead — check the bot's permissions there |
| no concrete times could be read | didn't name specific times |

**The test is whether the reader can act on it, not whether the word sounds technical.** "Check the bot's permissions" stays — it names the fix. "Rejected it" goes — it only describes our internals. Same logic keeps technical detail in function logs and in the ops DM that fires when posting fails everywhere.

## v3.36 — one home per action

`give your decision` sat in the row's context tier **and** in the row ⋮, which put the same action in two places a few pixels apart. The context tier now carries only the tally — `2 decisions in — yours counted` / `2 decisions in — yours isn't` / `no decisions yet` — and the action lives solely in the ⋮.

This narrows the two-tier rule stated above: the context tier may hold a secondary action as a text link **only when that link is the tier's own explanation**. `no recording — add a link` earns its place, because the caption exists to say why there's no Watch button and the link is the remedy. A bare duplicate of a menu item does not.

The ⋮ entry was gated on a recording existing (`screeningState.watch`); it now also shows for a finished call with no recording (`.done`), which is exactly the case where the row link used to be the only way in.

## Amendment — v3.34–3.36

- **Inbox action reads "Review →"** and matches Ladder's recommendation rows exactly: `btn btn--sm inbox-row__review`, small type, 36px target, quiet `--bg-surface` fill, and the trailing arrow (`aria-hidden`, so screen readers just hear "Review").
- **The blue dot is context-dependent.** In the Inbox it means *you personally haven't opened this application yet* — tracked per housemate in `recruit_applicant_views`, so it clears on your account only and stays cleared across devices. Everywhere else it keeps its original meaning: *they replied and it's waiting on you*. Tooltips say which.
- **A veto always means archived.** Vetoed applicants can never appear in the Inbox: the view filter drops them defensively, and Reopen clears the standing veto (with a confirm naming who vetoed) rather than returning someone to the Inbox with an unresolvable veto attached.
- **Reload shows a spinner, never the sign-in card.** The gate card is hidden while a session is restoring or loading; any gate message reveals it again so a failure can't spin forever.
- **New-application Discord pings carry buttons** — "Open the inbox", plus "Review <name>" on single-applicant pings.
## v3.37 — one listing per applicant

A candidate used to be auto-placed into **every** open listing they qualified for, so the same person appeared under three rooms and three housemates could each believe they were handling them. A shortlist that contains everyone isn't a shortlist.

Now exactly one active placement per applicant, enforced by a partial unique index (`migration 139`) rather than by convention — the auto-sweep, the accordion, drag-and-drop, and the outreach sheet all write to this table, and only an index covers every path. Tombstones are exempt: a person may be `removed` from many listings over time, they just can't be **active** in more than one.

**Which listing the sweep picks**, in order: closest start date to their confirmed move-in, then earliest start, then lowest id so the choice is stable run to run. A listing they've been tombstoned from is never re-picked. Anyone already placed is left alone — the sweep must never pull someone out from under whoever is working them.

**Every placement is now a move.** `addPlacement()` drops the previous active row before inserting, which turns all four call sites into moves at once without each having to know. Copy follows: *Add* → **Move here** on the accordion when they're already placed, *Add to another listing* → **Move to a different listing** in the review foot.

Reconciling the two existing duplicates preferred a manual placement over an auto one — a recruiter chose it — then fell back to the same date-fit ordering.

## Amendment — v3.40 (one reviewer, three verdicts)

The Inbox is no longer a group vote. One housemate's read decides, and every review requires a comment.

| Verdict | What happens | Row state |
|---|---|---|
| **Not a fit** | Archived immediately; an update email is owed | `Not a fit` chip, tooltip names the reviewer |
| **Needs input** | Stays in the Inbox, explicitly asking for another read | `Needs input` chip, tooltip names who asked |
| **Move forward** | Candidates, plus auto-placement into every listing they qualify for | leaves the Inbox |

- **The review bar is select-then-confirm.** Picking a verdict arms the bar and focuses the comment; the confirm button then names the consequence ("Archive them", "Ask for another read", "Move forward") rather than saying "Save". It stays disabled until a verdict is picked, and the comment is required — a review with no why is rejected client-side and by a CHECK constraint.
- **Verdict tints:** not a fit reads in the error tint, move forward in the accent green, needs input in a neutral overlay. Only the selected chip fills in.
- **No scores, no averages, no veto.** Nothing is hidden until you vote any more, because there is no tally to anchor against; the reviews thread shows each verdict with its comment.
- **Reopening softens rather than deletes.** A decisive verdict becomes "needs input" and keeps its comment, since the trigger would otherwise send the applicant straight back out.
- **The rejection email is offered, never forced.** Archiving surfaces "Write their update" with "Skip the email" beside it; the draft is a fixed community template plus one paragraph written from the applicant's own survey answers, and an optional newsletter link. Closing the editor leaves it unsent.
- **Reviews can arrive from the application sheet.** Comment threads on the sheet import as reviews attributed to their author's roster email, so a review written by someone who has never opened the app still shows under their name — and becomes editable by them the moment their sign-in maps to that email. Imported rows are labelled "from the application sheet".

## Amendment — v3.43 (openings cleanup after the review-model change)

- **"See other qualified applicants" only lists people still in play**, in two groups: *moved forward* (reviewed, passed — ready to add) then *not reviewed yet* (dates fit, nobody has read them). Archived applicants are excluded outright — the old filter keyed on stage `review | candidate` without checking for a decisive verdict, so someone archived by a sheet-imported review still appeared. Anyone reviewed but **not** moved forward is excluded too: "needs input" is a question, not a shortlist.
- **Tags follow the new model.** "gathering votes" is gone — there is no tally to gather. Rows read `not reviewed yet`, `moved forward`, or `taken off this listing` (was the bare "removed", which never said off *what*).
- **The opening date leads its header**, at body size in full contrast (`.listing-when`) while the rest of the meta stays muted. The date decides who qualifies, so it shouldn't read as fine print.
- **"Reach out" → "Get started"** — the first-contact CTA on an outreach row.
- **The play control is labelled "Watch"** rather than a bare triangle. Still the secondary of the pair: it shrinks first and keeps its own tint.
- **The update email's default is a house preference** (`recruit_settings.update_email_default`, rail footer: "Offer an update email by default"). The checkbox on a Not-a-fit decision starts from it, and can still be changed per person.

## v3.64 (2026-08-02) — status rows, kebab-first actions, the house-tour cycle

Three structural changes at once; each supersedes earlier sections where they conflict.

### 1. The row shows status; the ⋮ menu holds every verb

The singular highlighted CTA (**Get started / Follow up / Reply / Review times / Schedule visit**) is gone. An Openings row's right side is now **one status chip** (with a tooltip that names where the action lives) plus the ⋮ menu. The two-tier right rail (v3.14) collapses to one tier.

| Micro-state | Chip |
|---|---|
| Nothing sent yet | `no outreach yet` |
| Waiting on them | `sent 3h ago` (amber tint once stale) |
| They replied | `replied 2h ago` (green tint) |
| Availability in hand | `times in · 2 windows` |
| Coverage ask posted | `◆ sent to housemates` |
| Call booked | slot chip `Fri, Jul 25, 9:00 AM` |
| Call done | `call done · 2 weighed in` |
| Tour ask sent | `tour ask sent` |
| House poll open | `house poll open` |
| Tour confirmed | `visit Tue, Aug 11, 5:30 PM` |

The **only** clickable thing left in the row is **Join**, which exists solely for the ~10 minutes a call is live — a live-call entry buried in a menu would defeat its purpose.

The ⋮ menu is context-aware and ordered: **suggested next step first** (same funnel logic the old CTA ran on, rendered unstyled — no accent, per "no singular highlighted action"), then the two schedule actions (**Schedule intro call**, **Schedule house tour**), then Watch recording / Decide / Open profile / Add recording, rule, **Remove…**.

### 2. The scheduling link is dead

`Copy link` (row ⋮ and Emails toolbar) and the `/applications/schedule/?t=` URL in email drafts are removed. Availability is asked for **and parsed** in natural language — the applicant just replies with times, and the existing Gmail extraction turns the reply into windows. The legacy schedule page stays deployed only so links already in the wild don't 404; nothing generates new ones. Counterpart backlog item: accept *their* scheduler links (cal.com/Calendly).

### 3. The house-tour cycle (second schedule action)

`Schedule house tour` (⋮ menu, or **Invite them** on the profile's House visit stage row) runs a five-step cycle, tracked in `recruit_tours` (migration 160), one row per applicant:

1. **Ask** — the email draft (emailType `tour`) asks for times in the next two weeks and states the preference plainly: *Tuesday–Thursday evenings between 5 and 7pm work best on our end*. The reasoning (most roommates around; clear of family dinner, which tour guests never join) is deliberately **never** in the email — it lives only in Settings hints and this doc. If the thread holds unanswered questions from the applicant, the drafter folds the answers in after the ask and the compose modal shows an **"Also added to this email"** callout (`.email-added`) listing each addition with its why, so the sender knows before sending.
2. **Reply** — the scan's availability extraction claims the windows for the tour (an open tour ask suppresses the screener-scheduler claim post for that reply, so one email never spawns two Discord asks).
3. **Poll** — the bot posts an emoji poll to the house: their windows ∩ Tue–Thu 5–7pm as numbered slots (1️⃣ 2️⃣ …), reactions pre-seeded. No overlap → their raw windows post with an off-hours ⚠️ for a human call.
4. **Confirm** — the scan tick counts reactions; a future slot with **more than `tour_confirm_votes`** (default 4) housemates auto-sends the confirmation email — the house address (Settings → House, required: no address, no auto-send) plus the shape of the visit: *a casual conversation in the kitchen and a tour of the house* — then edits the poll to a green ✅ announcement.
5. **Row state** — the tour cycle owns the row chip while active (`tour ask sent` → `house poll open` → `visit <slot>`); the profile's House visit stage row narrates the same states.

New settings: `house_address` (House), `tour_confirm_votes` (House). New table: `recruit_tours` (member-read, service-role write).

### v3.64.1 — Watch returns to the row
The recording is the review artifact; hiding it made every decision one menu deeper. Rows in the watch state show the small **Watch** button beside the `call done` chip — still no primary CTA, and every other verb stays in the ⋮.

### v3.65 — tour polls publish every recommended start; scheduling asks reach the society channel
- A qualifying Tue–Thu day publishes **all** recommended starts — 5, 6, and 7pm — as separate emoji slots (up to 10 emojis), so "any evening works" becomes a real choice instead of ratifying the first slot. Slot seeding now paces reaction adds (~350ms apart, 429-retry) so every emoji ships pre-seeded.
- **Scheduling asks post to #recruiting-society** — house-visit polls and screener schedulers, gated by the new `society_scheduling_posts` setting (Automations, default on). Narrower than the held `RECRUITING_SOCIETY_POSTS` env switch, which still gates notes/recordings. Test applicants (`e2e-*`/`test-*` ids) never post there — they stay in #recruiting-automation.

### v3.66 (backend) — tour polls vote with buttons; availability-update notification
- **Buttons, not reactions.** One button per slot with the live count in its label ("Tue, Aug 4 · 5:00p · 3 in"; filled style once anyone's in). A tap toggles your vote (`recruit_tour_votes`, migration 161) and the message re-renders in place; crossing the threshold confirms within seconds from the button handler itself (`_shared/recruit-tours.ts`), with the scan sweep as the safety net. Any housemate who can see the poll can vote — the channel is the gate; no app sign-in needed. Reaction seeding and its rate-limit pain are gone.
- **Availability updates notify.** A fresh poll announces itself, but a refresh edits the message silently — so `tour_availability` ledger entries cover both: daily log line on first post, `now`-lane interrupt when an applicant *updates* their availability ("{name} updated their house-tour availability — the poll now shows {times}").

### v3.66 — emails readable + a home for availability
- **Email rows expand reliably.** loadAll hydrates threads without `body_text`, so first paint rendered every row as a disabled (un-tappable) button and the panel only repainted when the message *count* changed — on phones that meant taps did nothing. The panel now always repaints after the per-applicant sync returns full rows.
- **Clean bodies.** Server: Gmail base64 now decodes as real UTF-8 (`b64ToUtf8`) — no more `â€™` mojibake on new mail. Client: `demojibake()` repairs legacy rows on display, and `cleanEmailBody()` drops quoted history ("On … wrote:", `>` lines) and collapses blank runs.
- **Availability section on the profile** (`availabilityHtml`, between "Where they are" and the calendar): parsed windows as chips (Pacific), then a blockquote of the applicant's own words the extraction came from, sourced by date with an "open the thread" jump. Trust the parse by being able to check it.
- **Sync path posts tour polls too** — a manual Emails-tab sync that beat the cron used to mark the reply processed without ever posting the poll.

### v3.67 — one decider for the post-call decision
The post-screening "Would you accept them?" flow now matches the Inbox review model: **one housemate's verdict IS the house decision** — no tally, no quorum. The most recent write is canonical; anyone can overrule by deciding again (the sheet shows the standing decision, any earlier reads as history, and says plainly that saving replaces it). Row chips read `accept — Sam` / `pass — Sam` (green/gray) or `call done · needs a decision`; the ⋮ item flips to **Change decision** once one exists. Server side, `decision_open` notifications stop the moment any decision exists.

### v3.68 — Decide and Remove converge on the no-path
"Decide — no" and "Remove — not a fit" were two ways to say the same thing, one without consequences and one that didn't count as deciding. Now they are one path:
- **Decide → "No — not a fit…"** routes into the Remove sheet with *Not a fit* preselected and the note carried over — verdict + archive + update email are one gesture (the transparency hold/Undo still applies).
- **Remove → Not a fit**, reached directly, also **writes the house decision row** (`writeHouseDecision`, the single writer both paths share) — the decision chip, the sheet, and the archive tell one story.
- **Decide — yes** is unchanged (house decision recorded; next step is the tour/offer). The other Remove outcomes (off this listing / save for future / opted out / trial ended) remain logistics exits, not verdicts.

### v3.69 — set a time by hand (manual override for call + visit)
Both schedule actions gain a manual path that bypasses the ask/poll machinery when a human already knows the time — the phone call where you just agreed on Thursday at 6 shouldn't require an email round-trip to book.
- **Set call time… / Set visit time…** in the row ⋮ (and a small **Set a time** link on the profile's stage rows) open one shared modal: date-time picker + length. Booking is the progression — invites go out immediately, no separate confirm step.
- **Intro call** reuses the existing `schedule` action end-to-end: house-calendar event with Meet, invites to applicant + you (`sendUpdates=all`), intro email, open claim post closed.
- **House visit** is new backend (`recruit-gmail schedule-visit` → `confirmTourManually` in `_shared/recruit-tours.ts`): books a real event on the **house calendar** (the poll path only emailed) with applicant + setter as attendees and the house address as location, sends the same confirmation email the poll would, stamps `recruit_tours` to `confirmed` (`gcal_event_id`, `confirmed_by_name` — migration 163), and flips any open Discord poll to the ✅ edit so voting stops. Votes already cast for the chosen slot are kept as `confirmed_count`.
- Guardrails: archived applicants can't be booked; no email on file, no invites; past times rejected client- and server-side. Missing `house_address` no longer blocks the manual path — the calendar invite carries the time; the email just omits the address line.

### 2026-08-16 — v3.74.0: cached gate verdict shortens the boot wait
Boot vitals (5 days, n=37 across `boot_access`/`boot_access.deep`) showed the Discord membership check outrunning `loadAll` — `boot_access.deep` p75 1647ms vs `boot_data.deep` p75 1298ms, a 27% gap. `_checkMembershipAndEnter` now caches a successful verdict (`agape:gate` in localStorage: userId, username, isAdmin, timestamp) and, on a match under 6 hours old, enters immediately instead of awaiting the network round trip — the real check still runs in the background and, if it comes back refused, clears the cache and drops back to the gate. A refused or failed check is never cached.
