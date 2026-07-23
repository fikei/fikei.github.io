# Screening-call claim automation — brief + prompt

**One line:** an applicant's scheduling reply becomes a claimable post in a Discord channel; the first housemate to claim a slot closes the post, and both parties get a calendar invite from `live.at.agapesf@gmail.com`.

This is the "claim" model from the recruiting pipeline doc (first-to-claim runs the interview — no rotation, no paid round-robin), wired to plumbing that already exists in `/applications`.

---

## What already exists (build on, don't rebuild)

| Piece | Where | Status |
|---|---|---|
| Inbound scan of the shared inbox, matched to applicants | `recruit-gmail` fn, `scan` action | live |
| Availability extraction from prose replies (Haiku) | `recruit-gmail` → `extractAvailability` → `recruit_availability` | live |
| Applicant self-service picker | `/applications/schedule/?t=<token>` | live |
| Slot → calendar event on the shared account, inviting applicant + housemate, Meet link | `recruit-gmail` `schedule` action → `recruit_screenings` | live |
| Discord identity → house member (user id, email) | `user_discord_membership` + `auth.users` | live |
| Bot token in the Agape guild | `DISCORD_BOT_TOKEN` (scraper bot) | live |

**The only genuinely new pieces:** (1) posting to Discord when availability lands, (2) a Discord interactions endpoint to handle claim button clicks.

---

## Flow

```
Applicant replies with availability (email)  ──┐
Applicant uses the /schedule picker ───────────┤
                                               ▼
                        recruit_availability updated (existing)
                                               ▼
                 NEW: post to #recruiting-interviews (bot message)
                 One message per applicant. Buttons = concrete
                 30-min slots derived from their windows (max ~8,
                 spread across days) + "Other time…"
                                               ▼
                 Housemate taps a slot button (claim)
                                               ▼
      NEW: interactions endpoint verifies the tap, then:
      1. resolve claimer → user_discord_membership → email + display name
      2. call recruit-gmail `schedule` (existing) → GCal event on
         live.at.agapesf@gmail.com invites BOTH, Meet link attached
      3. edit the Discord message: buttons removed, marked
         "✅ Claimed by @name — Fri Jul 25, 9:00 AM · invite sent"
      4. DM the claimer the confirmation + Meet link
                                               ▼
                 recruit_screenings row (existing) — app shows it
```

Dedup rules: one open post per applicant (re-availability edits the existing post); claim is first-write-wins (second tap gets an ephemeral "already claimed by @X"); a post with no claim after 96h pings the channel once (the pipeline doc's stuck-metric).

## Channel

**`#recruiting-interviews`** (ID `1529576830514762029`) — bot-writable, visible to the Recruiting Society role. Keep it single-purpose: posts and claims only, discussion goes to the applicant thread in `#recruiting`.

## Hosting

Preferred: a third Supabase edge fn `recruit-discord` (`--no-verify-jwt`, Discord signature verification with the app public key) handling interactions; posting happens from `recruit-gmail` at the end of `scan`/availability writes. Cloudflare Worker (per the pipeline doc) is the fallback if edge-fn latency ever misses Discord's 3-second interaction deadline.

---

## The extraction prompt (v2 — supersedes the current one once adopted)

The live prompt handles clean cases. Real replies are messier — the Marisa email below adds three wrinkles: foreign timezone phrased relative to ours, "morning your time" vagueness, and a platform request (IG video call). Prompt:

> Today is {date} ({TZ}). You are extracting scheduling information from an email a housing applicant sent to Agape (San Francisco, Pacific time).
>
> Extract:
> 1. `windows`: every availability window they offer, as `[{date:"YYYY-MM-DD", start:"HH:MM", end:"HH:MM"}]` in Pacific time.
>    - Resolve relative days ("next Tuesday", "the 25th") to concrete dates, never in the past.
>    - If they name their own timezone or location ("I'm in Europe", "CET", "9 hour difference"), convert to Pacific. When they say "morning your time" they mean Pacific morning — take them at their word.
>    - Vague day-parts map to: morning 09:00–12:00, afternoon 12:00–17:00, evening 17:00–21:00, a bare day 09:00–18:00.
>    - Windows must be ≥30 minutes. Cap at 10.
> 2. `platform`: if they request a specific medium (Instagram video, WhatsApp, phone, "not video"), return `{kind, handle?}`; else null. Default assumption is Google Meet — only capture explicit requests.
> 3. `timezone_note`: one short string when a conversion happened ("applicant is in Europe, +9h from PT — windows converted"), else null.
> 4. `needs_human`: true when you cannot produce at least one concrete window (e.g. "whenever works!", questions instead of times) — the Discord post will ask for a manual read instead of showing wrong buttons.
>
> Return one JSON object: `{windows, platform, timezone_note, needs_human}`. No prose.

### The Discord post (composed from the extraction)

> **Marisa** ([why-they-applied one-liner]) offered times for a screening call:
> `Fri Jul 25 · 9:00a` `9:30a` `10:00a` `10:30a` `11:00a` … `[Other time]`
> ⚠️ She's in Europe (+9h) — these are already Pacific. She asked to do it over Instagram video (@aroundwespin).
> *Tap a time to claim the call — you'll both get a calendar invite.*

Platform requests and timezone notes render as the ⚠️ line; `needs_human: true` posts "couldn't parse concrete times — read the thread and coordinate manually" with a link to the app.

---

## Example corpus

**#1 — Marisa (real, 2026-07):**
> hi! yay! I'm in europe so it's a nine hour time difference—could we do like July 25, morning your time, evening mine? and could we do it over ig? mine is aroundwespin :)

Expected: `windows: [{date: 2026-07-25, start: 09:00, end: 12:00}]`, `platform: {kind: "instagram", handle: "aroundwespin"}`, `timezone_note` set, `needs_human: false`.

**#2+ — to be harvested.** The shared Gmail isn't connected yet, so `recruit_emails` holds no inbound mail. Once connected, run the scan over the full history (`newer_than:180d` variant), then pull `direction='in'` bodies and fold 5–10 real replies into this corpus as eval cases before tuning the prompt. Cases to specifically hunt for: pure Calendly links, "any evening works", replies that answer a different question entirely, and multi-recipient couples.

---

## Decisions (adopted 2026-07-22, shipped in v1)

1. **Claim scope** — anyone in Recruiting Society can claim. Revisit an opt-in "interviewer" role when volume demands it.
2. **Instagram-call requests** — steer to Meet by default; the IG handle and context are surfaced to the claimer (post warning line + their confirmation DM) so they can DM the applicant about it.
3. **Applicant confirmation email** — yes: `sendApplicantConfirmation` sends a short "you're confirmed with {name}, {time}" email in addition to the GCal invite, logged to `recruit_emails` as `sent_by_name: 'auto'`.

## Implementation notes (v1, 2026-07-22)

- The v2 extraction prompt above is live in `recruit-gmail` v1.4.0, with one refinement: `needs_human` is only true for emails that are *about scheduling* but yield no concrete window — non-scheduling replies return `windows: []` + `needs_human: false` and produce no Discord post (otherwise every "thanks!" would spam the channel).
- New pieces: migration 121 (`recruit_claim_posts`), `_shared/recruit-schedule.ts` (scheduling + confirmation email, shared by app and Discord paths), `_shared/discord.ts` (post/edit/DM/slot derivation), `recruit-discord` fn v1.0.0 (Ed25519-verified interactions; public key fetched via the bot token, no new secrets).
- Button `custom_id`s are `claim|<applicantId>|<epochMs>` (ISO timestamps contain `:`; epoch avoids delimiter collisions).
- Claim is first-write-wins via `UPDATE ... WHERE status='open'`; the 3s interaction deadline is met by ACKing with DEFERRED_UPDATE_MESSAGE and doing GCal/edit/DM/email in `EdgeRuntime.waitUntil`. Calendar failure after a claim never reopens the post (no double-booking) — the post flips to a ⚠️ state and the claimer is DM'd to book manually.
- App-side booking (`schedule` action in /applications) also closes any open claim post for that applicant.
- The 96h stuck nudge piggybacks on `recruit-gmail scan` (no new cron).
