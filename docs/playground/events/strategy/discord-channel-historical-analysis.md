# Agape #events — Historical Channel Analysis

**Date:** 2026-07-02
**Scope:** Full channel history — 3,328 messages, 2022-04-01 → 2026-07-01
**Channel:** Agape server `952961396121931838`, #events `952974850476085308`
**Method:** Raw export via `scrape-discord-events` v1.2.0 `export` action → heuristic candidate filter (660 msgs) → AI classification per message (is_event, platform, organizer, category, venue, overlap)
**Purpose:** Ground the "Agape recommended" integration design — especially dedup strategy — in what the channel actually contains.

---

## 1. Headline Numbers

| Metric | Value |
|---|---|
| Total messages | 3,328 |
| Unique authors | 81 |
| Confirmed event announcements | **568** |
| Events per year | 2022: 82 · 2023: 135 · 2024: 131 · 2025: 150 · 2026 (half-yr): 70 |
| Steady-state rate | **~2.5–3 events/week** |
| Messages with image flyers | 258 (many image-only announcements) |
| Replies (discussion/RSVPs) | 993 (30% of channel) |

## 2. Where Events Are Hosted (Platform Mix)

| Platform | Events | Share | Notes |
|---|---|---|---|
| Discord text only (no link) | 125 | 22% | Free-form text or flyer image; AI extraction is the only path |
| **Partiful** | 103 | 18% | Dominant since 2024 (34/yr → 42/yr); house parties & member events |
| Venue websites | 70 | 12% | Gray Area, Club Fugazi, SF Symphony, The Lab, etc. |
| Eventbrite | 56 | 10% | Mixed public events |
| Resident Advisor | 47 | 8% | Member DJ gigs + club nights |
| Luma | 37 | 7% | Growing fast — 2 in 2023 → 16 in 2025 |
| Instagram / Facebook | 44 | 8% | Links to posts, weak structured data |
| Tixr / Dice / SeeTickets / other ticketing | 26 | 5% | Club ticketing |
| secretparty.io | 12 | 2% | Underground/renegade parties, invite-gated |
| Meetup / Google Forms / other | 48 | 8% | Long tail |

**Trend:** Facebook/Eventbrite era (2022–23) → Partiful/Luma era (2024–26). Any parser investment should prioritize **Partiful, Luma, RA, Eventbrite** — those four cover ~43% of linked events and all have scrapeable/structured pages.

## 3. Who Organizes

| Organizer | Events | Share |
|---|---|---|
| Agape house / house members | 273 | **48%** |
| External orgs & promoters (unnamed in post) | 270 | 48% |
| Named external orgs | 25 | 4% |

- **House talent anchors the channel.** A handful of members (marrryna, toshbeats, carlicita, irisumbra, clizzin, sophiaas) generate a large share of events — DJ sets at Public Works / Great Northern / 1015 Folsom / f8, writing circles, studio sessions.
- **Recurring series** (strong "Agape recommended" candidates): Agape Underground (basement party series), CATS open-mic salon, Wordsy Wednesday (writing), Endzeit at The Loom (RA-listed), D&B Society (monthly), monthly movie nights, SF Neo-Futurists shows.
- **Cross-co-op network (2025+):** The Village, Frontier Tower, Beacon, Uzay, Edge City — a co-living event circuit that exists nowhere in public aggregators.
- Named external venues/orgs: Hoodslam, Public Works, The Loom, ODC Dance, Internet Archive, SF Symphony, Robot Heart, Rickshaw Stop.

## 4. Categories (app taxonomy)

| Category | Events | Share |
|---|---|---|
| Music (music + dj-set + live-music + festival) | 230 | **40%** |
| Social | 117 | 21% |
| Art / exhibition / design | 61 | 11% |
| Tech | 41 | 7% |
| Theater | 19 | 3% |
| Film | 16 | 3% |
| Wellness | 14 | 2% |
| Literary / poetry | 11 | 2% |
| Comedy | 6 | 1% |
| Other | 53 | 9% |

Music + Social = 61% of the channel. The "social" bucket (house dinners, potlucks, river trips, co-op tours) is the category the current app has the least coverage of — and it's nearly all Partiful/Discord-only.

## 5. Dedup Exposure vs Existing Sources

Estimated overlap with current stock sources (would the event *also* appear there):

| Existing source | Overlapping events | Share |
|---|---|---|
| **None — unique to Discord** | 441 | **77%** |
| Resident Advisor SF | 52 | 9% |
| 19hz Bay Area | 45 | 8% |
| Luma SF discover feed | 18 | 3% |
| Screen Slate SF | 11 | 2% |
| Gary's Guide SF | 1 | <1% |

**Implication:** ~23% of Discord events will collide with existing sources — almost entirely in the **music/nightlife** slice (RA + 19hz + Tixr/Dice ticketed club events). The other 77% (house parties, Partiful invites, co-op events, salons) are net-new inventory.

### Dedup design notes (from observed data)

1. **URL-first dedup is the highest-precision signal.** Partiful/Luma/RA/Eventbrite URLs are canonical per event. Normalize (strip query params) and match on URL before any fuzzy matching. Also catches the *intra-channel* duplicate pattern: the same Partiful link posted by multiple members.
2. **Fuzzy `(date, name, venue)` matching** (already specced in PRD §14) is needed only for the ~15% that are club events announced as text/flyer while listed on 19hz/RA.
3. **Venue whitelist boosts dedup recall:** Public Works, Great Northern, The Midway, 1015 Folsom, f8, Gray Area — a Discord event at these venues is very likely in 19hz/RA already → flag as "Agape recommended" on the existing record rather than inserting.
4. **House-venue events never dedup:** anything at "Agape" or member homes is always insert-as-new.

## 6. Data-Quality Realities

- **Image-only flyers (258 msgs):** a meaningful share of announcements have no extractable text. Phase-3 OCR/vision extraction is worth more than the PRD assumed — likely 15–20% of events are image-only.
- **Replies carry signal:** 993 replies include RSVPs, corrections ("moved to 9pm"), and cancellations. V1 should ignore them for extraction but the volume suggests a future "heat" signal for ranking.
- **Relative dates are common** in text-only posts ("this Friday", "tonight") — extraction must resolve against message timestamp (already in the prompt design).
- **7-day lookback is fine for steady state** (~3 events/wk ≈ 20–30 msgs/wk), but initial backfill should run with the export action, not the standard scrape path.

## 7. Recommendations for the Integration

1. **Flag, don't just insert.** Implement "Agape recommended" as a source tag merged onto existing events (URL match → venue+date fuzzy match), inserting new events only when no match — consistent with PRD §14 merge strategy.
2. **Parse platform URLs before AI.** For Partiful/Luma/RA/Eventbrite links, fetch the page (or API — Luma has iCal/API) for canonical title/date/venue instead of trusting free-text extraction. Discord message text becomes the *recommendation context*, not the source of truth.
3. **Categorize with the channel's real distribution in mind:** default uncertain events toward `social`, not `other` — this channel skews social/community.
4. **Prioritize the recurring series** for recognition (Agape Underground, CATS, Wordsy Wednesday, D&B Society, Endzeit) — stable names that make good curated collections.
5. **Keep the `export` action** (shipped in v1.2.0, service-role-gated) for future backfills and re-analysis.

---

*Raw data: full export + per-message classifications live in session scratchpad (`all_messages.json`, `events_classified_all.json`); regenerate anytime via the `export` action.*
