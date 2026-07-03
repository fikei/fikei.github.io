# Product Requirements Document

## Events — Source Architecture, Visibility & Agape Curation

**Version:** 0.1 (Draft)
**Status:** Draft — pending review
**Last Updated:** 2026-07-02
**Depends On:** Events Aggregator (`/events/`), [Discord Channel Source PRD](./prd-discord-channel-source.md), [Agape #events Historical Analysis](./discord-channel-historical-analysis.md)

---

## 1. Executive Summary

The Agape #events historical analysis (568 events, 2022–2026) showed that the app's single "source" concept conflates three independent things: the **feed** we fetch from, the **platform** an event links to, and the **venue/organizer/curator** identity users actually care about. It also showed that 77% of community events exist on no public feed and must be treated as private.

This PRD defines:
1. A **source taxonomy** (4 classes) that all current and future feeds slot into
2. A **visibility policy** — which events render publicly, which are hidden for now
3. The **coexistence/dedup model** between the Agape Discord feed and public feeds
4. A **venue-calendar backlog** derived from the historical analysis
5. The **filter hierarchy** for the events UI

### Core Principles

1. **Curation is the product** — Agape's channel is a trust filter over the event universe, not another feed
2. **Visibility by corroboration** — an event is public only if a discoverable public source lists it
3. **Facts from structured feeds, trust from the community** — field-level merge precedence
4. **Venue-first coverage** — expand public coverage via venue calendars, not long-tail discovery platforms

---

## 2. Source Taxonomy

Every source belongs to exactly one class. Class determines default visibility, dedup role, and merge precedence.

| Class | Definition | Examples | Default visibility of its events |
|---|---|---|---|
| **1. Venues / Communities** | A specific physical venue or community org publishing its own calendar | Public Works, Gray Area, The Chapel, Internet Archive, Noisebridge, SF Symphony | **Public** |
| **2. Discovery Feeds** | Aggregators/listings that index other people's events | 19hz, Screen Slate, Gary's Guide, Luma discover · *(demoted:)* Eventbrite search, Bandsintown, Funcheap, DoTheBay | **Curated feeds: public** · **Demoted feeds: hidden unless Agape-published** |
| **3. Public Event Ticketing** | Ticketing platforms with public, discoverable event pages | RA, Luma, Dice, Shotgun, Tixr, SeeTickets | **Public** |
| **4. Private Ticketing / Invites** | Invite-native platforms with no discovery surface | Partiful, secretparty.io, Google Forms, Discord text-only announcements | **Hidden (for now)** |

**The Agape Discord channel is not a class-member — it is the curation layer.** It contributes the `recommended_by: agape` signal and `posted_by` attribution to events in any class. It is also the *only* ingestion path for class-4 events.

### 2.1 Demotion rule (long-tail discovery platforms)

Eventbrite location/category search, Bandsintown-by-city, Funcheap, and DoTheBay have high volume and low signal. Their events are:
- **Ingested** (needed for dedup corroboration and URL matching)
- **Not rendered** in the app by default
- **Rendered only when the same event was published to the Agape #events channel** (i.e., carries the `agape` curation tag)

This makes the demoted platforms function as *metadata enrichers* for Agape-recommended events rather than firehoses.

### 2.2 Private events rule (for now)

Events whose **only** source is class 4 — a Partiful/secretparty link, a Google Form, or a text/flyer-only Discord post — are stored with `visibility: private` and **not rendered anywhere** in the current release. They are retained in the store so that:
- A later "members-only" authenticated view can surface them without re-ingestion
- If the same event later appears on a public source, the merge upgrades it to public automatically

The "Agape recommended" badge and `posted_by` attribution are **always private**, even on public events: public visitors see the plain event card; the badge renders only in authenticated views (future).

---

## 3. Visibility Policy Matrix

Visibility is computed from the event's merged `sources[]`, never set manually:

| Event's sources include… | Rendered publicly? | Notes |
|---|---|---|
| Any class-1 venue/community feed | ✅ Yes | |
| Any curated class-2 discovery feed (19hz, Screen Slate, Gary's Guide, Luma discover) | ✅ Yes | |
| Any class-3 public ticketing page | ✅ Yes | Reachable URL alone is NOT enough — must come from a discoverable listing/feed |
| Only demoted class-2 feeds | ❌ No — unless also Agape-published | Demotion rule §2.1 |
| Only class-4 (Partiful, secretparty, Google Form, Discord text) | ❌ No | Private events rule §2.2 |
| Agape channel + any public source | ✅ Yes (event) / 🔒 badge private | Corroboration model |

**Required infrastructure change:** `discord_event_cache` currently has RLS "Anyone can read cache." The canonical event store must add a `visibility` column with RLS restricting private rows to authorized users, and client fetch paths for private data must require auth (no anon-key fallback).

---

## 4. Coexistence & Dedup (summary)

Full design rationale in the [historical analysis](./discord-channel-historical-analysis.md) §5–7. All feeds write into one canonical event store through an identity-resolution ladder:

1. **Canonical URL match** (strip params; Partiful/RA/Luma/Eventbrite/Dice URLs are unique per event) → auto-merge
2. **Venue + date + fuzzy name** (PRD-discord §14 rules) → auto-merge **only within the nightlife-venue tier** (Public Works, The Midway, Great Northern, F8, 1015 Folsom, etc.) where collision probability is high
3. **No match** → insert new

Merge mechanics:
- **Field-level precedence:** structured feeds (classes 1–3) win for facts (time, price, ages, lineup); the Agape channel wins for curation fields (`recommended_by`, `posted_by`, message context)
- **Stable merges:** canonical event keeps its ID; later-arriving sources fold in (handles Discord posting weeks before/after public listings). Resolution re-runs at every cache refresh
- **Conservative policy:** prefer occasional duplicate cards over falsely-merged (lost) events; house/DIY-venue events never fuzzy-match
- **Dedup runs server-side** in the cache pipeline, not per-client

### 4.1 Design considerations carried over from the historical analysis

Concrete implementation constraints observed in the real data (568 events, 3,328 messages):

**Extraction & data quality**
- **Parse platform URLs before AI.** For class-3/demoted-class-2 links (Partiful, Luma, RA, Eventbrite, Dice), fetch the page or API (Luma has iCal/API) for canonical title/date/venue. The Discord message text becomes *recommendation context*, not the source of truth — free-text extraction is the fallback, not the default.
- **Image-only flyers are 15–20% of events** (258 messages carry images, many with no extractable text). OCR/vision extraction is worth more than the original Discord PRD assumed; until it ships, these events are silently missed — track them as a known coverage gap.
- **Relative dates are common** in text-only posts ("this Friday", "tonight") — extraction must resolve against the message timestamp, and assume the message's year, not the current year.
- **Categorization prior:** this channel skews social/community (21% social). Default uncertain events toward `social`, not `other`.

**Dedup specifics**
- **Same-link reposts are the top intra-channel duplicate pattern** — the same Partiful/RA URL posted by multiple members. URL canonicalization (strip query params) must dedupe within the Discord feed itself, not just across feeds.
- **Venue whitelist boosts dedup recall:** an event at Public Works, Great Northern, The Midway, 1015 Folsom, F8, or Gray Area is very likely already on 19hz/RA → prefer match-and-flag over insert.
- **House-venue events never dedup:** anything at Agape or a member's home always inserts as new — fuzzy matching there only creates false merges.
- **Expected collision rate ~23%**, concentrated in music/nightlife. Use this as the baseline when validating the dedup ladder: materially higher merge rates suggest over-merging; near-zero suggests the fuzzy tier isn't firing.

**Ingestion & signals**
- **Steady-state volume is ~2.5–3 events/week** (~20–30 messages/week) — the existing 7-day lookback and 4-hour cache refresh are sufficient. Historical backfill must use the `export` action (shipped in `scrape-discord-events` v1.2.0, service-role-gated), not the standard scrape path.
- **Store `posted_by` per event.** ~15 members generate the large majority of posts; author ≈ organizer for house events and is the curation signal for external ones. This field powers organizer attribution now and per-member "recommended by" taste signals later.
- **Replies carry signal (993 messages, 30% of channel):** RSVPs, corrections ("moved to 9pm"), cancellations. V1 ignores them for extraction, but they are the future "heat"/update signal — don't discard them at ingest.
- **Recognize the recurring series** as first-class curated collections: Agape Underground, CATS open mic, Wordsy Wednesday, D&B Society, Endzeit at The Loom, monthly movie nights, SF Neo-Futurists. Stable names, high community value, and easy to match across recurrences.

---

## 5. Venue / Community Calendar Backlog

Derived from Appendix B of the historical analysis (events = count in Agape history, a proxy for community relevance). Feed columns to be verified during implementation.

### Wave 1 — Nightlife venues (also the dedup collision zone; mostly covered by 19hz/RA already — add only if gaps found)

| Venue | Agape events | Likely feed |
|---|---|---|
| Public Works | 20 | Website calendar / RA |
| The Midway | 11 | Website calendar / SeeTickets |
| The Great Northern | 5 | Website / Tixr |
| F8 \| 1192 Folsom | 5 | Website / 19hz |
| 1015 Folsom | 4 | Website / RA |
| Audio SF, UndergroundSF, El Rio, Monument | 1–2 each | 19hz coverage likely sufficient |

### Wave 2 — Arts, culture & institutional (biggest net-new coverage; most have iCal/RSS or structured calendars)

| Venue | Agape events | Likely feed |
|---|---|---|
| Gray Area | 6 | grayarea.org calendar |
| Internet Archive | 4 | Website / Eventbrite org page |
| The Lab | 2 | thelab.org |
| SF Symphony | 2 | sfsymphony.org |
| Exploratorium | 2 | exploratorium.edu (After Dark) |
| SFMOMA | 2 | sfmoma.org |
| The Chapel | 2 | thechapelsf.com |
| The Lost Church | 2 | Salesforce-sites ticketing |
| ODC Dance | 2 | odc.dance |
| Brick & Mortar, Bottom of the Hill, Rickshaw Stop, Bimbo's, New Parish, Fox Oakland | 1–2 each | Venue sites / Bandsintown org pages |
| Roxie, Alamo Drafthouse, 4-Star | 1–2 each | Screen Slate covers; verify gaps |
| Berkeley Rep, Club Fugazi, Broadway SF, Stern Grove, La Peña, Commonwealth Club, The Moth, Saint Joseph's Arts Society | 1 each | Venue sites |

### Wave 3 — Communities & DIY spaces (few public calendars; mostly reach us via Agape channel or Luma)

| Community | Agape events | Likely feed |
|---|---|---|
| Noisebridge | 4 | Wiki / iCal |
| Frontier Tower | 5 | Luma org page |
| Studio Collective, Envelop SF, Adobe Books, Manny's, The Foundry, Church of 8 Wheels | 1–3 each | Mixed: Luma / Eventbrite org / websites |
| The Village, Edge City, other co-ops | — | No public feed; Agape channel is the source |

**Backlog process:** each venue becomes a stock-source candidate story; verify feed type → add to `STOCK_SOURCES` → measure new-event yield vs. the 568-event ground-truth set. Stop expanding a wave when corroboration rate for non-house Agape events plateaus.

---

## 6. Filter Hierarchy (UI)

User-facing facets, in priority order:

1. **When** — date navigation (existing, primary)
2. **Recommended by** — Agape / everything (authenticated views only, while badge is private)
3. **Category** — existing tabs; promote `social` (21% of community events)
4. **Venue** — typeahead over normalized venue list; house/DIY vs. venue toggle
5. **Price / Free**

Explicitly **not** filters: ticket platform (attribute → outbound link icon), feed provenance (event-card badge only).

---

## 7. Scope & Phasing

### Phase 1 — Foundation ✅ Shipped (migration 089, cache-events v1.6.0, scrape-discord-events v1.3.0, scrape-events v1.4.0)
- [x] Canonical event store extensions: `visibility`, `canonical_url`, `recommended_by`, `posted_by` on `events`; `source_class` + `demoted` on `event_sources`
- [x] Visibility engine per §3 matrix + RLS fix (public read restricted to `visibility='public'`; anon write policies removed)
- [x] Dedup ladder (URL-first canonical adoption + nightlife-tier fuzzy match) server-side in `cache-events`
- [x] Agape Discord feed → canonical store: `scrape-discord-events` forwards extracted events (with per-message `posted_by` attribution and `recommended_by=['agape']`) into `cache-events`; kicked every 2h by `scrape-events`

### Phase 2 — Coverage (partial)
- [x] Demotion machinery: `demoted` flag + corroboration visibility upgrades (both directions) in `cache-events` — dormant until demoted feeds are registered
- [ ] Demoted-platform parsers (Eventbrite location search, Bandsintown) — needs new parser types
- [x] Venue calendar Wave 2/3 backlog registered in `event_sources` (14 rows, disabled pending feed verification; enable = verify feed → set type → flip `enabled`, no deploy)
- [ ] Wave 2 feed verification & enablement (per-venue stories)
- [x] Coverage metric: `agape_coverage` view (corroboration % of Agape events vs public feeds)
- [x] Event-platform domains (Partiful, Luma, Tixr, etc.) added to `enrich-event` allowlist per §4.1

### Phase 3 — Curation surface (partial)
- [x] "★ Agape" filter + "Past events" toggle in the events app (v1.15.0); private rows visible to authenticated users (migration 091 — §8.1 resolved: any Supabase-authenticated user)
- [x] Metrics dashboard at `/events/metrics.html` (agape_coverage, source health, scrape runs, enrichment queue)
- [x] Greenlit Eventbrite orgs with Agape signal via `eventbrite-org` parser (§8.4 resolved: class per-source) — Public Works, Manny's, Hoodslam, The Center SF, Envelop, Flux Vertical Theatre (migration 090)
- [ ] Agape badge + `posted_by` display on event cards
- [ ] Private-event view polish (class-4 events) for members
- [ ] Venue Waves 1 & 3 gap-fill; Internet Archive org id lookup

---

## 8. Open Questions

1. **Auth model for the private view** — Supabase auth per user, or a shared link-token for Agape members? (Determines how the badge/private events are gated.)
2. **Image-only flyers** (15–20% of Discord events) — Phase 3 of the Discord PRD proposes OCR/vision extraction; does it make this roadmap or wait?
3. **Curator expansion** — when a second community channel is added, does `recommended_by` become an array (multi-curator events)? Schema should assume yes.
4. **Eventbrite org pages vs. search** — org-specific Eventbrite feeds (e.g., Internet Archive's) are high-signal; are they class 1 (venue calendar) rather than demoted class 2? Proposed: yes, class is assigned per-source, not per-platform.

---

## 9. References

- [Agape #events Historical Analysis](./discord-channel-historical-analysis.md) — data behind every threshold in this doc
- [Discord Channel Source PRD](./prd-discord-channel-source.md) — extraction pipeline, §14 dedup matching rules
- Events app source types & STOCK_SOURCES — `events/index.html`
