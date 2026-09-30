# PRD: Agape Halloween theater run of show

**One line:** A light planning page at `/halloween/theater.html` that puts every theater act on one clock (arrive and pre-party setup before doors, then changeover and show during the party) and tracks what each act still needs.

**Status:** Shipped v1.4.2 (2026-09-30). Seeded from the Agape XV selection email threads, Ian's notes (vac bed, parlor games), the planning sheet's 📝 Collaborators tab (Location = "Theater stage - Justine&Colin's room") and each act's "When might your experience be?" form answer (shown in the detail pane as *Asked for*).
**Related:** [Halloween placement](./agape-halloween-placement.md) (same party; the theater is the "2nd floor room under the rear stairs").

---

## Problem

The theater acts are being negotiated one email thread at a time. Every thread asks the same three things (setup time, run time, earliest/latest) and each answer changes the order of the night. Nobody can see at a glance who arrives when, whether two acts' changeovers collide, or which asks (AV, comps, grants, Discord) are still open.

## What it does

- **Acts list** — one card per act: status (confirmed / pending / declined), show times, arrival time, count of things to resolve, open needs. A "Theater room" card holds production needs that belong to the room rather than an act.
- **Timeline** — the party runs 9pm–9am; theater shows start at 10pm (both editable on the Theater room card).
  - **Theater · during party** — a hatched changeover block (setup during the party) before an act's first show, a shorter *reset* before each repeat show, and a *strike* block after its last show.
  - **Arrive · pre-party setup** — load-in/soundcheck lane before doors. Hidden for now (`SHOW_PREP = false` in `theater.js`); arrival data is kept, and flipping the flag brings back the lane, the noon start and the arrival fields.
  - Drag any block to move it in 5-minute steps. With **Auto-shift later shows** on (default, remembered per browser), the dropped show keeps its time and every show that would now collide keeps its order and is pushed later just enough to fit its own changeover/reset (and the previous act's strike). Shows that finish before the dropped show's changeover don't move; gaps are never closed automatically. **Close gaps** packs every show back-to-back from the first one, in the current order. A show pushed past 9am, or outside an act's window, is flagged rather than blocked. Dashed blocks mean a length is still TBD and a default is drawn. Red borders mean a conflict. Selecting an act shades its availability window.
- **Conflict checks** — show + changeover/strike overlapping another act, repeat shows overlapping each other, a slot before doors or before shows start, starting before an act's earliest or ending after its latest, pre-party setup running past doors, two load-ins in the room at once, and any TBD run/changeover/arrival.
- **Needs** — per-act checklists tagged Info / AV / Setup / Tickets / Artist pay / Comms, plus a roll-up across all acts with totals (comps we give vs requested, what we pay artists vs requested — money only flows from Agape to the acts, how many acts have arrival and run times).
- **Sharing** — edits save to `localStorage`. "Share link" encodes the whole schedule in the URL (`#t=`); "Copy run of show" writes arrivals, the theater order and all open needs as text for Discord; Export/Import moves it as JSON; Reset reloads the email snapshot.

## Data

| Source | Where | Notes |
|---|---|---|
| Seed | `halloween/data/theater.json` (`rev` bumps when the seed changes; saved edits get new acts merged in once, and a toast points to Reset for new draft times) | Acts, draft times and needs pulled from the Gmail threads on 2026-09-30. Phone numbers and email addresses are left out (public site); each act links to its Gmail thread instead. |
| Edits | `localStorage['halloween-theater-v1']` | `{ event, acts, updated }` — the whole seed shape, edited in place. |

Times are stored as `HH:MM`. Anything before noon counts as the next morning, so `01:30` sorts after `23:00`.

## Acts at seed time

| Act | Status | From the thread |
|---|---|---|
| The Wizards (Carla Bagdonas + crew) | Confirmed | Roaming all night + at least one closed-door theater round, 9pm–2am. Kyle is point of contact while Carla is away. 5 comps. |
| Blood of the Dragon (Ja'Shon Wright) | Confirmed | ~1 hr setup, 30–45 min show, window 9pm–12:30am. Asked for a $300 contribution vs the $150 standard. |
| Garden of Eternal Party (Jonathan Schoonhoven) | Confirmed | Shadow puppet musical, 10–15 min shows × 3–5. Rear-projection screen, digital + overhead projectors, 3 mics, 2 PAs + mixer, aux. Long setup/strike; needs 5+ comps. |
| Jordan Corey | Confirmed | Acoustic set, midnight–late. Needs PA/mixer, a sound engineer, soundcheck; asked for a 3rd comp for a videographer. |
| Tasya Abbot | Pending | Replacing Spheresay. Vocal/looping set before 3:30am, optional harp set after 5am. |
| Latex vac bed (Bizzie Bisignani) | Pending | From Ian: 2am+, about 2 hours. Sheet: 2 tickets. |
| The Body is an Archive (Jyotsna, housemate) | Pending | From the sheet ($150) + proposal: ~10 min dance/physical theater, 2–3 runs, midnight/late, needs flat floor + audience circle. |
| Parlor games | Pending | From Ian: late night. Host TBD (possibly The Preposterous Game Parlour). |
| Spheresay (Andy Maag) | Declined | Out of state that weekend. |

## Planning-sheet mismatches (Sep 30)

- Ja'Shon: settled Sep 30 at $300 total (house $200 + $100), paid after the event — sheet still says $200.
- Jordan: sheet 4 tickets vs email 2 (+1 asked).
- Garden: 5 tickets, confirmed by email Sep 30 — matches the sheet.
- Spheresay still listed (declined); Tasya and Parlor games not listed.
- Lina Bond (cabbage lamps + cushions, $300) is room decor, tracked on the Theater room card.
- The "Theater stage - Justine&Colin's room" tab itself isn't readable through the Drive connector (not indexed; file too large to export).

## Open items

1. **Replies** — every act was asked for setup time, run time and window on Sep 30. As answers land, update the act (or re-seed `theater.json`).
2. **AV plan** — the room's PA/mixer/lighting plan is still pending and blocks several needs.
3. **Shared state** — same limit as Placement: localStorage plus share links. If more than one person edits, move to a Supabase Ops table.
