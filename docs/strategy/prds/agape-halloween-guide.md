# PRD: Agape Halloween guest guide

**One line:** A mobile-first guide at `/halloween/guide/` where guests tap a room — on a map or in a list — and see the art in it, colour-coded by medium. Discord sign-in (and membership in the Agape server) is required, as a way to bring guests onto the Discord.

**Status:** Shipped v1.0.0 (2026-10-01).
**Related:** [Theater run of show](./agape-halloween-theater.md) (theater times come from its shared schedule) · [Halloween placement](./agape-halloween-placement.md).

---

## What it does

- **Gate:** "Continue with Discord" → the `halloween-guide-member` edge function checks the Agape guild via the bot. Not in the server → *Join the Agape Discord* (invite link) + *I've joined — check again*. A yes is cached in the browser for 24 h.
- **Rooms as stories:** a horizontal row of room circles (Instagram stories), each ring split by the mediums inside; tapping opens the room. Rooms you've opened dim, like seen stories.
- **Map mode:** floor tabs (Roof · 3rd · 2nd · 1st · Basement · Yard · Roaming) with a schematic grid of room tiles — medium dots, a count, and a colour bar. Layout follows the 2026 FigJam floors; it is schematic, not to scale.
- **List mode:** floors → rooms → piece cards, filterable by medium.
- **Room sheet:** full-screen, swipe or ‹ › between rooms with art. Piece cards expand to *About* and *What to expect* (the artist's own words from the form) and *Where*.
- **Bottom tab bar:** Map · List · You (Discord name, open the Discord, colour key, sign out).
- **Preview vs live:** before Oct 24 9pm PT every piece shows. From 9pm to 9am it shows only what's on now (pieces with a time window covering the current minute), plus anything without a time yet (marked *TBA*). `?now=2026-10-24T23:30` previews live mode.

## Mediums (colour key)

| Medium | Colour |
|---|---|
| Theater & performance | magenta (`--accent-magenta`) |
| Music & DJ | cyan (`--accent-cyan`) |
| Installation & space | amber (`--accent-amber`) |
| Interactive experience | green (`--accent-green`) |
| Photo & film | violet (`#b48cff`) |
| Food & drink | coral (`#ff7a59`) |

## Data

| Source | Where | Notes |
|---|---|---|
| Who's in + which room | Planning sheet — 📝 Performers (*Confirmed to play?* = YES) and 📝 Collaborators (*Location*) | Curated into `scripts/halloween-guide.py` (`FLOORS`, `PIECES`). Only confirmed artists. |
| What the art is | Call for Collaborators form (`halloween/data/proposals.json`) | Matched by proposal id. Sentences about tickets, grants, budgets or fees are stripped; contact details never copied. Some pieces get hand-written one-line blurbs. |
| Theater times | `halloween/data/theater.json`, refreshed at runtime from Supabase `halloween_theater` | The guide follows edits made on the theater page. |
| Output | `halloween/data/guide.json` | Rebuild: `python3 scripts/halloween-guide.py`. |

## Privacy

`guide.json` is a public static file, so the Discord gate is a nudge onto the server, not access control. It holds only names, titles and the artists' own descriptions — no emails, phones, pay or ticket asks.

## Open items

1. **Music set times** — the Lineup tab is still a draft; music shows *Set time TBA*. Add `times` per act in `PIECES` once the lineup is final.
2. **Untimed pieces** — Mise en Pièces and Dental Damned need times (or `all night`) for live mode.
3. **Rooms on the map** — floors for person-named rooms were read off the FigJam board; correct `FLOORS` if any room is on the wrong floor.
4. **Pending acts** — Tasya Abbot, Spheresay's replacement and Parlor games aren't listed until confirmed.
