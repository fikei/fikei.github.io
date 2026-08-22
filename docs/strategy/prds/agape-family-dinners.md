# Agape family dinners — signup, quotas, and reminders in the triage app

**One line:** the quarterly family-dinner Google Sheet becomes a Dinners view inside
ctrl.rodeo/applications — tap-to-claim shifts, automatic quota math from the occupancy
calendar, and Discord reminders nobody has to remember to post.

Status: **spec** (2026-08-21). Companion docs:
[technical design](../../infrastructure/technical-design/family-dinners.md) ·
[phase 17 plan](../../execution/project-plan/phase-17-family-dinners.md).
Source of the requirements: the [AGAPE FAMILY DINNER sheet](https://docs.google.com/spreadsheets/d/1h3zgmOarD-3VgQyh5_h4VBgd7Hay9AoaTKggFIDl5KY/)
(quarterly tabs, Aug–Oct 2026 is current).

## Problem

Family dinner runs on a shared spreadsheet that someone rebuilds every quarter by hand:
copy the tab, retype the Mondays, fix the tally formulas, chase signups on Discord.
The sheet has no mobile-friendly signup, no reminders, silently breaks when rows shift
(the current tab's tally block disagrees with itself), and guests / can't-make-it
entries are free-text a chef has to decode. The house already lives in the triage app
for occupancy and recruiting — dinners belong next to them, driven by the same
who-lives-here data.

## What the sheet encodes today (requirements source)

- **Weekly Monday dinner at 7pm**, one row per date, grouped by month, for a 3-month
  quarter. Delays announced on Discord.
- **Five role slots per dinner:** Head Chef, Sous Chef, Trash to/from Curb + Fluff,
  Clean Up 1, Clean Up 2. The same person sometimes takes two slots.
- **Monthly check-in dinner** (marked "Meeting 🍽"): housemates only, no guests.
- **Guests column:** other weeks each housemate may bring up to 2 guests (policy has
  varied by quarter); head chef needs to know in advance for headcount.
- **Can't make it column:** absence RSVP per dinner.
- **Quota block:** residents sign up for 4–5 shifts per quarter; subletters take a
  prorated number. Tallies per person plus quarter totals (taken / remaining / total).
- **Rules and notes:** cook vegan + GF (peanut allergy too), $100 budget (reimbursed
  or house CC via Instacart), aim for 7pm, post ETA on Discord, chefs clean as they
  go; duty checklists for trash/fluff (bins to curb, set the table, bins back next
  day) and clean-up (dishes, label leftovers); moment of silence + appreciation each
  week; per-date notes ("Ian Bday (13th)").

## Decisions

- **The app replaces the sheet.** One-time import of the current quarter at cutover;
  no ongoing sync. The sheet is retired after one quarter of overlap.
- **Access = Discord resident/subletter role** on the Agape guild — a looser,
  separate gate from the Recruiting Society channel gate that protects recruiting
  views. Housemates who aren't recruiters get Dinners (and only Dinners); recruiters
  who don't live in the house keep recruiting views and don't see Dinners.
- **Admins** (existing `#recruiting-automation` check) generate quarters, toggle
  check-in dinners, edit any signup, and edit the rules panel.

## Users

| Who | Gate | Can do |
|-----|------|--------|
| Housemate (resident/subletter Discord role) | `is_house_member` | View schedule, claim/release own shifts, add guests, mark can't-make-it, see tallies + rules |
| Admin (`#recruiting-automation` access) | existing admin check | Everything above + generate quarter, edit any slot, check-in toggles, cancel/reschedule dinners, edit rules/settings |
| Recruiting Society member without house role | existing recruiting gate | Recruiting views only; no Dinners rail item |

## Functional requirements

1. **Quarter schedule** — admin generates a quarter: one dinner per Monday for 3
   months, 7pm default. Per-dinner free-text note (birthdays, holidays). One dinner
   per month flagged as the **check-in dinner** (housemates only; guests blocked;
   badge in the grid). Any dinner can be cancelled or moved to another date/time.
2. **Role signup** — 5 slots per dinner (`head_chef`, `sous_chef`, `trash_fluff`,
   `cleanup_1`, `cleanup_2`). One person per slot; a person may hold multiple slots
   in the same dinner. Tap an empty slot to claim it; tap your own to release it.
   Admins can assign or clear anyone. Claims are race-safe (first write wins).
3. **Guests** — a housemate registers guests for a dinner (names + count), capped by
   a per-housemate limit (setting, default 2), disabled on check-in dinners. The
   dinner detail shows total expected headcount for the chef.
4. **Can't make it** — one tap marks you out for a dinner; shows in the dinner
   detail and feeds the headcount.
5. **Quota & tallies** — the roster is derived from `recruit_stays` overlapping the
   quarter (no separate roster to maintain). Residents' target is 4–5; subletters'
   target prorates by weeks in residence. Per-person chips show taken/target;
   quarter summary shows taken / remaining / total (dinners × 5). No formulas to
   break — always computed from signups.
6. **Rules panel** — dietary constraints, budget, dinner-time norms, and per-role
   duty checklists, rendered beside the schedule; editable by admins in Settings.
7. **Discord automation** — in the dinners channel: a Sunday post naming Monday's
   crew + any unfilled slots (with a signup deep link), and a nag when a dinner is
   <48h out with no head chef. Reuses the existing `recruit-discord` cron tick.

## Non-goals

Menu planning, grocery ordering / reimbursement workflow, attendance tracking beyond
"can't make it", two-way sheet sync, and any change to the recruiting funnel.

## Success criteria

- A full quarter runs without the sheet: quarter generated in-app, every dinner
  staffed via in-app claims, tallies never hand-corrected.
- Housemates without Recruiting Society access sign in and use Dinners unaided.
- The Sunday Discord post replaces the manual "who's cooking tomorrow?" ping.
