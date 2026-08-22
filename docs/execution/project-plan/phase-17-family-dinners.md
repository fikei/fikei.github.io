# Phase 17: Agape Family Dinners

> Back to [Project Plan](./index.md)
>
> **Reference**: [PRD: Agape family dinners](/docs/strategy/prds/agape-family-dinners.md) · [Technical design](/docs/infrastructure/technical-design/family-dinners.md)
>
> **Vision**: the quarterly family-dinner Google Sheet becomes a Dinners view inside the triage app — tap-to-claim shifts, quota math computed from `recruit_stays`, and Discord reminders on autopilot. The app replaces the sheet.

---

## Goal

Housemates (Discord resident/subletter role — a new gate, separate from Recruiting Society) sign up for the 5 weekly dinner roles, register guests, mark absences, and see quarterly shift tallies. Admins generate quarters and edit rules. `recruit-discord` posts the Sunday crew summary and nags on empty head-chef slots.

## Success Criteria

- [ ] A housemate with only the resident/subletter Discord role signs in and sees Dinners (and no recruiting views)
- [ ] A full quarter is generated, staffed, and tallied in-app with zero sheet edits
- [ ] Claims are race-safe: two people tapping the same slot resolves to one signup + one friendly toast
- [ ] Sunday summary posts automatically to the dinners channel; head-chef nag fires <48h before an unstaffed dinner
- [ ] Subletter quotas prorate from `recruit_stays` without any manual roster upkeep

## Decisions locked (per PRD)

1. App replaces the sheet — one-time import of the in-flight quarter, no ongoing sync, sheet retired after one quarter of overlap.
2. Access gate = Agape guild roles `resident`/`subletter`, cached as `is_house_member` on `user_discord_membership`. Recruiting gate untouched.
3. Roles fixed at 5: `head_chef`, `sous_chef`, `trash_fluff`, `cleanup_1`, `cleanup_2`; one person per slot, multiple slots per person allowed.
4. Check-in dinner monthly: housemates only, guests blocked.
5. Guest limit (default 2/housemate/dinner), resident quota (default 5), and rules markdown live in `recruit_settings`.

---

## Epic 17-A: Access & schema

**Story: house-member gate**
- [ ] `discord-membership`: read guild roles from the existing member fetch; cache `is_house_member` + `house_role` on `user_discord_membership` (new columns); minor version bump
- [ ] Client gate: membership result carries house flags; house-only users land on Dinners, recruiting views hidden

**Story: dinner tables**
- [ ] Migration: `recruit_dinners`, `recruit_dinner_signups` (unique `(dinner_id, role)`), `recruit_dinner_rsvps` (unique `(dinner_id, user_id)`) — see technical design for DDL
- [ ] RLS: house-member read/write, own-row update/delete for non-admins
- [ ] Seed `recruit_settings`: `dinner_guest_limit`, `dinner_quota_resident`, `dinner_rules` (from sheet notes), `dinner_channel_id`

## Epic 17-B: Dinners view MVP

**Story: quarter grid**
- [ ] Rail item Dinners (House group); route + view scaffold in `applications/js/app.js`
- [ ] Grid: Mondays × 5 roles, month separators, check-in badges, per-dinner notes, own-cell highlight; mobile per-week cards
- [ ] Claim/release: insert/delete own signup; unique-violation → toast + refresh

**Story: quarter generation (admin)**
- [ ] Settings → Dinners: generate quarter (start month → insert Mondays, skip existing)
- [ ] Dinner drawer admin actions: assign/clear any slot, edit note/time, check-in toggle, cancel dinner
- [ ] `applications` → v3.85.0

## Epic 17-C: Guests, RSVPs, tallies

- [ ] Dinner drawer: add guests (capped by `dinner_guest_limit`, blocked on check-ins), can't-make-it toggle, computed headcount
- [ ] Tally sidebar: roster from `recruit_stays` overlapping the quarter; per-person taken/target chips (subletters prorated); quarter taken / remaining / total
- [ ] Rules panel rendering `dinner_rules` markdown; admin editor in Settings

## Epic 17-D: Discord automation

- [ ] `recruit-discord` cron tick: Sunday crew summary post (crew, guests, outs, unfilled slots, deep link), dedup-stamped
- [ ] Head-chef nag: <48h out + `head_chef` empty → one @-mention post
- [ ] Minor version bump; `dinner_channel_id` wiring

## Epic 17-E: Cutover

- [ ] One-time import script: remaining weeks of the in-flight sheet quarter → tables
- [ ] Announce on Discord; sheet marked read-only
- [ ] Retire sheet after one full in-app quarter
