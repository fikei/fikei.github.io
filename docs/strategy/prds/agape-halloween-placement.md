# PRD: Agape Halloween placement

**One line:** A one-page planning surface at `/halloween/` that shows the house floor by floor, lists every Call for Collaborators proposal, and lets the planning crew drag proposals into rooms while reading the whole proposal next to the map.

**Status:** Shipped v1.0.0 (2026-09-18). Modeled on the "Agape Halloween Rooms Experiences" FigJam board; the 2026 board annotations still need to be carried over (see Open items).
**Related:** [Recruiting funnel](./agape-recruiting-funnel.md) (same house, same recruiting-society crowd) · Planning sheet: `'26 Halloween XV (Reassemblage): planning sheet` in Drive.

---

## Problem

Proposals arrive in a Google Form and get triaged in a spreadsheet, while the house map lives on a FigJam board. Deciding "which proposal goes in which room" means flipping between a 14-column sheet and a canvas of sticky notes. Nobody can see the full proposal text and the house at the same time, and the board doesn't know when a new proposal lands.

## What it does

- **House layout** — Roof, 3rd, 2nd, 1st, Basement, each a grid of rooms (bedrooms, common rooms, showers, stairs, yard) plus three zones: Roaming, Off-site/TBD, Not this year. Each room shows how it was used in 2025 (from the master schedule) and an editable 2026 note.
- **Proposals list** — every form response, searchable, filterable by status (unplaced / placed / not this year) and by what the artist wants to do (space, experience, perform, roaming, photo, food).
- **Placement** — drag a card onto a room, or pick a room from the "Place in" menu in the detail pane. Placed proposals show as chips inside the room and can be dragged between rooms. Each placement carries a free-text note (time window, sharing arrangement).
- **Detail pane** — the full proposal (where it lives, when, description, participant journey, files, past work, prior Halloweens, extras) stays open beside the map.
- **Fit hints** — when a proposal is selected, rooms whose keywords match the artist's "where does your experience live" answer get highlighted. Input shapes output.
- **Sharing** — placements save to `localStorage`. "Share link" encodes them into a URL; opening it offers to load them. "Export"/"Import" moves them as a JSON file. "Copy summary" writes a room-by-room list for Discord or the planning sheet.
- **Live data** — on load the app reads the bundled snapshot, then tries the sheet's CSV endpoint; when the sheet is link-shareable, new responses appear without a deploy. Otherwise the status pill says "snapshot" and the date. `scripts/halloween-proposals.py <csv>` regenerates the snapshot.

## Data

| Source | Where | Notes |
|---|---|---|
| Proposals | `halloween/data/proposals.json` | Generated from the form-responses sheet. Phone and email are dropped: the site is public. Ids are `sha1(timestamp|name)` so they are stable across re-syncs, and the in-browser CSV parser derives the same ids. |
| House | `halloween/data/house.json` | Floors, rooms, 2025 usage notes, keyword lists for hints, zones. Custom rooms added in the UI live in `localStorage` only. |
| Placements | `localStorage['halloween-placement-v1']` | `{ placements: {id: {room, note}}, roomNotes, houseNotes, customRooms }` |

## Privacy

Proposal text (descriptions, Instagram handles, Drive links) is served from a public GitHub Pages site under `noindex`. Contact details are never bundled. If the crew wants the page gated, reuse the Discord gate from `/applications` (Recruiting Society channel) — the app has no backend, so a gate is the only change.

## Open items

1. **2026 board annotations** — the FigJam board is only view-shared with the connected Figma account, so its "2026" stickies could not be read. Once it is shared for editing (or the notes are pasted), they go into `house.json` as each room's `last`/note, or into the house-notes box.
2. **Shared state** — localStorage plus share links is enough for a small crew passing a link around. If several people place at once, move placements to a Supabase Ops table (`halloween_placements`, keyed by proposal id) and drop the share-link flow.
3. **Live sheet** — needs the responses sheet set to "anyone with the link can view". Until then the snapshot is the source and the sync script is the refresh path.
