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

## Appendix A — Complete Link-Destination List

Every domain that confirmed event messages link to (counts = events referencing that domain; one event can reference several). Domains canonicalized (`luma.com`→`lu.ma`, `youtu.be`→`youtube.com`, Eventbrite subdomains merged); Discord CDN / GIF domains excluded.

### Event platforms & ticketing

| Domain | Events | | Domain | Events |
|---|---|---|---|---|
| partiful.com | 104 | | dice.fm (+link.dice.fm) | 3 |
| eventbrite.com | 60 | | shotgun.live | 2 |
| ra.co (+links, de.ra.co) | 48 | | momence.com | 2 |
| lu.ma (+o.lu.ma) | 37 | | bandsintown.com | 2 |
| secretparty.io | 23 | | earthling.fyi | 2 |
| tixr.com | 16 | | ticketfairy.com | 1 |
| seetickets.us | 7 | | ticketweb.com | 1 |
| meetup.com | 4 | | songkick.com | 1 |
| mobilize.us | 3 | | app.gopassage.com | 1 |
| | | | cityboxoffice.com | 1 |
| | | | sweatpals.com | 1 |
| | | | app.sola.day | 1 |
| | | | par.tf | 1 |

### Social & content platforms (weak structured data)

| Domain | Events |
|---|---|
| instagram.com | 28 |
| facebook.com | 22 |
| youtube.com | 6 |
| open.spotify.com | 4 |
| soundcloud.com | 3 |
| bandcamp / laylo / lnk.to / ffm.to (artist pages) | 5 |
| twitter.com, vimeo.com | 2 |

### DIY / self-serve (forms, docs, calendars)

| Domain | Events |
|---|---|
| docs.google.com | 8 |
| forms.gle | 3 |
| doodle.com, calendar.app.google, mailchi.mp | 3 |

### Venue & organization websites (long tail, 1–4 each)

grayarea.org, sfneofuturists.org, sf.funcheap.com, westcoastcraft.com, thelab.org, sfsymphony.org, sfcm.edu, sfmoma.org, thelostchurch (salesforce-sites), odcsf (salesforce-sites) / odc.dance, thechapelsf.com, bottomofthehill.com, brickandmortarmusic.com, bimbos365club.com, thenewparish.com, thefoxoakland.com, rickshawstop (via other), berkeleyrep.org, broadwaysf.com, roxie.com, 4-star-movies.com, frameline.org, exploratorium.edu, commonwealthclub.org, themoth.org, oddsalon.com, sf.nerdnite.com, portolamusicfestival.com, sterngrove.org, lapena.org, citydancesf.com, envelop.us, sfsound.org, saintjosephsartssociety.com, zinnbookfair.org, churchofclown.org, sunsetmercantilesf.com, blackbirdsf.com, dothebay.com, iwannahotbox.com, bumbumtrain.com, onetable.org, plus ~15 personal-artist / misc one-offs (airbnb.com, yelp.com, maps.app.goo.gl, news links).

**Takeaways:** 9 platforms/ticketers cover the overwhelming majority of linked events — **Partiful, Eventbrite, RA, Luma, secretparty.io, Tixr, SeeTickets, Dice, Meetup** (302 of ~390 platform-linked events). The venue-site long tail (~50 domains at 1–4 events each) is not worth per-site parsers; those events should flow through AI extraction of the message text, with the link kept as the event URL.

---

## Appendix B — Breakdown by Venue & Organizer

### Venues

291 of 568 events name an identifiable venue; 277 are vague or venue-less ("SF", "Mission", online, or house parties with no address in the post). Variants merged (e.g. "Agape" / "Agape house").

**Top venues (3+ events)**

| Venue | Events | | Venue | Events |
|---|---|---|---|---|
| **Agape (house)** | 50 | | 1015 Folsom | 4 |
| Public Works | 20 | | Noisebridge | 4 |
| The Midway | 11 | | Internet Archive | 4 |
| The Loom (Oakland) | 9 | | Dolores Park | 3 |
| Gray Area | 6 | | Studio Collective | 3 |
| The Great Northern | 5 | | Cow Palace | 3 |
| F8 \| 1192 Folsom | 5 | | Stage Werx / 447 Minna | 3 |
| Frontier Tower | 5 | | | |

**2 events each:** Corona Heights, Hibernia Bank, Greek Theatre Berkeley, The Lab, SF Symphony, Exploratorium, Brick & Mortar Music Hall, Manny's, Golden Gate Park, The Foundry, The Lost Church, The Chapel, ODC, Moomin, Stanford, New Theory, Garfield Park, Studio Aurora, Fort Mason, Envelop SF, Adobe Books, Dolo, River.

**1 event each (~20):** Berkeley Rep, Chapel of the Chimes, Audio SF, El Rio, UndergroundSF, Danzhaus, Monument SF, SF Conservatory of Music, Church of 8 Wheels, Bottom of the Hill, Alamo Drafthouse, Bombay Beach, Rickshaw Stop, and other one-offs.

**Venue tiers for dedup:**
- **Nightlife venues on 19hz/RA** (Public Works, The Midway, Great Northern, F8, 1015 Folsom, Audio, UndergroundSF, The Great Northern — ~50 events): high collision probability → match-and-flag, don't insert.
- **Community/DIY spaces** (Agape, The Loom, Noisebridge, Frontier Tower, Studio Collective, Adobe Books — ~75 events): near-zero collision → insert as new.
- **Institutional venues** (SF Symphony, Exploratorium, Gray Area, Internet Archive, theaters): occasional Luma/Eventbrite/Funcheap presence — URL match is sufficient.

### Organizers

The classifier resolved organizers into three buckets: **Agape house/members (273, 48%)**, **external unnamed (270, 48%)** — promoter identifiable only from flyer/link, not message text — and **named external orgs (25, 4%)**: Hoodslam (3), Public Works (3), The Loom, Moomin, ODC Dance, Internet Archive (2 each), SF Symphony, New Parish, Robot Heart, The Chapel, Endzeit, Langton Labs, Rickshaw Stop, SF Philharmonic, Enzyme SF, Four Star Theater (1 each).

Because posts rarely name the promoter, the **posting member is the best organizer proxy** for house events (author ≈ host) and the curation signal for external ones:

| Member | House events posted | External events shared |
|---|---|---|
| thatmre | 36 | 29 |
| subfeels | 34 | 29 |
| marrryna | 22 | 14 |
| prime_lemur_26983 | 21 | 3 |
| toshbeats | 20 | 17 |
| parmigianna | 17 | — |
| micha.online | 10 | 17 |
| carlicita | 12 | 6 |
| jamesjulius. | 6 | 15 |
| yoyoyc | — | 15 |
| kstoreyf | 7 | 14 |

~15 members account for the large majority of all event posts. For the integration, storing `posted_by` per event enables both organizer attribution for house events and a per-member taste signal ("recommended by") later.

---

*Raw data: full export + per-message classifications live in session scratchpad (`all_messages.json`, `events_classified_all.json`); regenerate anytime via the `export` action.*
