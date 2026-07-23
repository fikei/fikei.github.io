# Recruiting app — row states & subcopy reference

Design documentation for `/applications` list rows (v3.5.0). One row = one applicant; every visual state derives from four inputs: `stage` (server-owned), `placements`, `email state`, and `your vote`. Nothing else may add chrome to a row.

## Shared row anatomy

```
[response dot?] [avatar] [name / subline] ......... [chips] [note bubble?] [action?] [✕?]
```

- **Row tap always opens the review overlay.** There is never an "Open" button; the only row-level action buttons are verbs that do something else (Vote, Send email, Add).
- **Response dot** — 8px blue (`--accent`) dot in the row's left gutter, vertically centered, *beside* the avatar (never on top of it). Meaning: their last email to the house is unanswered-by-us / newest. Tooltip carries recency ("They replied — 3h ago"). Replaces the old "↙ Replied" chip in every view.
- **Note bubble** — filled square speech bubble (rounded rect, tail centered on the bottom edge), accent-colored, with the note count inside in knockout text. Tooltip: "N house notes". Replaces the old "✎ N" text count.
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

| State | Visual | Logic |
|---|---|---|
| On the shortlist | grip ⠿ + rank · **Send email** · **✕** at the far right | placement `status='active'`; the same person can appear under several listings |
| Awaiting their reply | muted `sent 3h ago` before the buttons | last email direction = out |
| They replied | blue response dot | last email direction = in |

**✕** removes from *this* listing only — tombstones the placement so the auto-sweep never re-adds; tooltip says so.

### "See other qualified applicants (N)" — full-width see-more bar

Ladder-style expander (`.inbox-more__btn` pattern): full-width, centered, muted, chevron ▾ that flips when open. Sits between the shortlist card and the next listing. Rows inside:

| State | Visual | Logic |
|---|---|---|
| Still in the Inbox | `gathering votes` (or their vote chip) · no button, row tap opens review | `stage='review'` and qualifies |
| Removed by a recruiter | `removed` · **Add** (re-activates the tombstoned placement) | `stage='candidate'`, tombstoned |

Because the sweep places every qualifying candidate, this set is provably {still in review} ∪ {tombstoned} — no third case.

## Row subcopy grammar

`[pronouns] · [track] · [move-in] · [stay] · applied [date]` — segments drop out when unknown, never render placeholders.

| Segment | Values |
|---|---|
| pronouns | lowercase, only when given — `she/her` |
| track | `Full-time` \| `Sublet` (from the residency answer) |
| move-in (parsed) | `Sep 2026` · `Sep 5, 2026` · `Aug–Sep 2026` · `ASAP` · `Flexible` · any + `· flexible` · omitted when unparseable |
| move-in (confirmed) | recruiter-confirmed window **replaces** the parsed value everywhere: `Sep 1, 2026` or `Sep 1 – Oct 15, 2026` (green + ✓ on the profile only; plain in sublines) |
| stay (sublets) | `6-week stay`; under 21 days `12-day stay` — from the confirmed window when set, else the parsed range |
| applied | `applied Jul 1` — main rows only; accordion rows omit it |
| email recency | Openings, awaiting state only: `sent 3h ago` → `2d ago` → date |

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
2. Openings rows don't surface a booked screening — that lives only in the Screening view.
3. Auto vs manual placements are visually identical.
