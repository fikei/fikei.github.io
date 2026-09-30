# PRD: Agape Halloween theater run of show

**One line:** A light planning page at `/halloween/theater.html` that puts every theater act on one clock (arrive and pre-party setup before doors, then changeover and show during the party) and tracks what each act still needs.

**Status:** Shipped v1.0.0 (2026-09-30). Seeded from the Agape XV selection email threads.
**Related:** [Halloween placement](./agape-halloween-placement.md) (same party; the theater is the "2nd floor room under the rear stairs").

---

## Problem

The theater acts are being negotiated one email thread at a time. Every thread asks the same three things (setup time, run time, earliest/latest) and each answer changes the order of the night. Nobody can see at a glance who arrives when, whether two acts' changeovers collide, or which asks (AV, comps, grants, Discord) are still open.

## What it does

- **Acts list** — one card per act: status (confirmed / pending / declined), show times, arrival time, count of things to resolve, open needs. A "Theater room" card holds production needs that belong to the room rather than an act.
- **Timeline** — noon on party day to 9am, two lanes:
  - **Arrive · pre-party setup** — load-in and soundcheck blocks before doors (9pm).
  - **Theater · during party** — a hatched changeover block (setup during the party) right before each show block.
  - Drag any block to move it in 5-minute steps. Dashed blocks mean a length is still TBD and a default is drawn. Red borders mean a conflict. Selecting an act shades its availability window.
- **Conflict checks** — show + changeover overlapping another act, a slot before doors, starting before an act's earliest or ending after its latest, pre-party setup running past doors, two load-ins in the room at once, and any TBD run/changeover/arrival.
- **Needs** — per-act checklists tagged Info / AV / Setup / Tickets / Money / Comms, plus a roll-up across all acts with totals (comps committed vs asked, grants offered vs asked, how many acts have arrival and run times).
- **Sharing** — edits save to `localStorage`. "Share link" encodes the whole schedule in the URL (`#t=`); "Copy run of show" writes arrivals, the theater order and all open needs as text for Discord; Export/Import moves it as JSON; Reset reloads the email snapshot.

## Data

| Source | Where | Notes |
|---|---|---|
| Seed | `halloween/data/theater.json` | Acts, draft times and needs pulled from the Gmail threads on 2026-09-30. Phone numbers and email addresses are left out (public site); each act links to its Gmail thread instead. |
| Edits | `localStorage['halloween-theater-v1']` | `{ event, acts, updated }` — the whole seed shape, edited in place. |

Times are stored as `HH:MM`. Anything before noon counts as the next morning, so `01:30` sorts after `23:00`.

## Acts at seed time

| Act | Status | From the thread |
|---|---|---|
| The Wizards (Carla Bagdonas + crew) | Confirmed | Roaming all night + at least one closed-door theater round, 9pm–2am. Kyle is point of contact while Carla is away. 5 comps. |
| Blood of the Dragon (Ja'Shon Wright) | Confirmed | ~1 hr setup, 30–45 min show, window 9pm–12:30am. Asked for a $300 contribution vs the $150 standard. |
| Garden of Eternal Party (Jonathan Schoonhoven) | Confirmed | Shadow puppet musical with screen, projector, mics, PAs. Setup/run/window still to come. |
| Jordan Corey | Confirmed | Acoustic set, midnight–late. Needs PA/mixer, a sound engineer, soundcheck; asked for a 3rd comp for a videographer. |
| Tasya Abbot | Pending | Replacing Spheresay. Vocal/looping set before 3:30am, optional harp set after 5am. |
| Spheresay (Andy Maag) | Declined | Out of state that weekend. |

## Open items

1. **Replies** — every act was asked for setup time, run time and window on Sep 30. As answers land, update the act (or re-seed `theater.json`).
2. **AV plan** — the room's PA/mixer/lighting plan is still pending and blocks several needs.
3. **Shared state** — same limit as Placement: localStorage plus share links. If more than one person edits, move to a Supabase Ops table.
