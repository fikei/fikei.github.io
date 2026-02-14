# PRD: Instagram Reels & Saves Import

**Version:** 1.0
**Date:** 2026-02-14
**Status:** Draft

---

## Overview

Instagram is where your taste lives — restaurants you want to try, clothes you want to buy, places you want to go, music you want to hear. But Instagram buries all of that in a flat, unsearchable saves folder. You can't filter by type, you can't find "that coffee shop from three weeks ago", and you definitely can't see the pattern in what you've been collecting.

Instagram Import solves this by treating every Reel and saved post as a **source document** — not a bookmark. The system watches the video, transcribes what's spoken, reads the caption, and extracts the actual things being referenced: the coffee shop, the jacket, the song, the neighborhood. Each extracted entity becomes its own pin in the right category (eat, wear, go, listen), with a stable URL (Google Maps, brand site, Spotify) and a backlink to the original reel.

One saved Reel about a restaurant recommendation becomes:
- 1 source pin (the reel itself, in `follow`)
- 1 `eat` pin for the restaurant (Google Maps link)
- 1 `listen` pin for the background song (Spotify link)
- 1 `wear` pin for the jacket the creator was wearing (brand site link)

Your saves stop being a graveyard. They become your board.

---

## Goals

1. **Turn Instagram saves into actionable pins** — extract real entities (places, products, music) from captions and spoken audio, not just bookmark the reel
2. **Zero-friction mobile capture** — share a Reel from the Instagram app, get structured pins back without manual categorization
3. **Batch import for migration** — import hundreds of saved posts at once via browser extension to solve the cold start problem
4. **Stable, permanent URLs** — resolve mentions to Google Maps, brand sites, Spotify — not ephemeral Instagram CDN links
5. **Backlink integrity** — every derived pin traces back to the source reel for provenance

---

## Who This Serves

### Primary Personas

| Persona | Why Instagram Import Matters |
|---------|------------------------------|
| **The Visual Collector** | Pulls references from Instagram constantly. 40+ browser tabs of IG finds. Needs to capture and categorize without friction. |
| **The Sound & Scene Curator** | Saves music, venues, visual artists for collaborations from IG. Loses tracks in screenshots and DM threads. |
| **The DJ** | Tracks music discoveries, gig opportunities from IG. Mobile-first — discoveries happen in the wild. |

### Secondary Personas

| Persona | Why Instagram Import Matters |
|---------|------------------------------|
| **The Cultural Omnivore** | Attends events, discovers restaurants, follows trends via IG. Wants a record of experiences. |
| **The Design Technologist** | Follows creative coding projects, artists on IG. Needs to track repos, artists, studios. |

### Jobs to Be Done

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Save an Instagram Reel about a restaurant | Have the restaurant appear as an `eat` pin with a Google Maps link | Actually find and visit the place later |
| See a product recommendation in a Reel | Get a pin with a link to buy it, without manually searching | Purchase when I'm ready, not impulsively in the moment |
| Hear a song in a Reel | Get a `listen` pin with a Spotify link | Add it to a playlist or listen again |
| Realize I have 500+ Instagram saves | Import them all at once and see what I've actually been collecting | Understand my own taste and stop losing discoveries |
| Share a Reel from Instagram on my phone | Have it processed automatically without opening a laptop | Capture in the moment, organize later |

---

## Design Principles

### Alignment with Brand

| Brand Principle | How It Manifests |
|----------------|-----------------|
| **Input shapes output** | Instagram saves are raw input → structured, categorized pins are the output. The system reveals patterns in what you've been collecting. |
| **Organize as you go** | AI handles entity extraction, categorization, and URL resolution. User just shares/pastes. Zero manual work. |
| **One place, whole life** | Instagram content stops being siloed in Instagram. The coffee shop lives next to your other `eat` pins, the song next to your other `listen` pins. |
| **Show, don't decorate** | No Instagram-branded UI chrome. Derived pins look like any other pin. Only a small provenance badge shows origin. |

---

## Core Features

### 1. Content Acquisition

Four entry points — mobile and desktop:

| Method | Platform | Friction | Volume | How It Works |
|--------|----------|----------|--------|-------------|
| **PWA Share Target** | Mobile (iOS/Android) | Lowest | Single | Tap share in Instagram → ctrl.rodeo appears → URL sent to `?add=` handler → routed to `instagram-import` edge function |
| **Paste URL** | Any | Low | Single | Paste `instagram.com/reel/AbC123/` in add modal → detected as Instagram → server-side processing |
| **Browser Extension** | Desktop | Low | Batch (50-5,000) | Extension intercepts Instagram GraphQL while user scrolls saved posts → captures structured JSON → sends batch to edge function |
| **File Upload** | Any | Medium | Batch | Upload `saved_posts.json` from Instagram data export → parse and process (CDN URLs may be expired) |

**Instagram URL Detection:**

```
URL matches:
  instagram.com/reel/*
  instagram.com/p/*
  instagram.com/tv/*

→ Route to instagram-import instead of standard enrich-link
```

**PWA Share Target** (existing infrastructure in `boards/pwa-share.html`):
- Extract URL from share intent query params
- Redirect to `/boards/?add=<encoded-url>`
- Add modal detects Instagram domain → shows "Analyzing reel..." instead of standard enrichment

**Browser Extension** (Phase 9.3 architecture):
- Manifest V3 content script injects page interceptor
- Monkey-patches `window.fetch()` to capture GraphQL responses
- Filters for `SavedPostsQuery` and `SavedCollectionsQuery` endpoints
- Extracts per post: shortcode, caption, media type, tagged location, tagged accounts, media URLs
- Batches captured items, sends to `instagram-import` endpoint

**GraphQL Response Fields Captured:**

```
node.shortcode           → construct permalink
node.edge_media_to_caption.edges[0].node.text → caption
node.location.name       → tagged location
node.edge_media_to_tagged_user → tagged accounts
node.display_url         → thumbnail (expires ~48h)
node.video_url           → video file (expires ~48h)
node.is_video            → media type detection
node.__typename          → GraphSidecar (carousel), GraphVideo (reel), GraphImage
```

---

### 2. Audio Transcription

Many Reels have minimal captions. The real content is spoken: "you HAVE to try this place" while pointing at a restaurant, or "I found the best jacket" while holding up a product.

**Service: Deepgram Nova-2**

| Property | Value |
|----------|-------|
| Cost | $0.0043/minute |
| Speed | ~10x realtime (30 sec Reel = 3 sec to transcribe) |
| Input formats | MP4, MOV, WAV, MP3 (accepts video directly — no audio extraction needed) |
| API | REST (Deno-compatible, no SDK required) |
| Features | Smart formatting (punctuation, paragraphs), language detection |

**Transcription Flow:**

```
1. Download Reel video from CDN URL (or oEmbed video_url)
2. POST video buffer to Deepgram REST API
   - model: "nova-2"
   - smart_format: true
   - diarize: false (single speaker typical for Reels)
   - detect_language: true
3. Receive transcript text (~3 sec for 30 sec video)
4. Store transcript on source pin for future re-analysis
```

**When transcription runs:**
- Always for Reels (video content)
- Always for IGTV / video posts
- Never for photo-only posts or carousels without video
- Skip if caption alone yields 3+ high-confidence entities (cost optimization)

**Fallback:** If Deepgram is unavailable, proceed with caption-only extraction. Transcription is additive, never blocking.

---

### 3. Entity Extraction

AI-powered analysis of caption text AND transcript text to identify real-world entities.

**AI Model: Claude 3 Haiku**

**Input (combined from all sources):**

```
Caption: "Best coffee spot! @bluebottlecoffee on Valencia St.
          Try the oat milk latte"
Transcript: "Okay so I've been coming here every morning this week.
             Blue Bottle on Valencia, if you're in the Mission,
             this is the spot. The oat milk cortado changed my life.
             Also the playlist in here is incredible, they're playing
             Khruangbin right now."
Tagged Location: "Blue Bottle Coffee"
Tagged Accounts: ["bluebottlecoffee"]
Instagram Audio: "Khruangbin - Maria También"
```

**Extraction Prompt Structure:**

```
Analyze this Instagram post. Extract every real-world entity mentioned
or referenced — places, products, brands, songs, restaurants, events,
people, recipes, tools, etc.

For each entity:
- type: place | product | brand | song | food | event | person | generic
- name: canonical name (e.g., "Blue Bottle Coffee" not "this coffee spot")
- location_hint: any geographic context (e.g., "Valencia St, San Francisco")
- category: which ctrl.rodeo category (eat, go, wear, watch, listen, use, follow, read)
- confidence: 0.0-1.0
- source: "caption" | "transcript" | "tagged_location" | "tagged_account" | "audio_track"

Be aggressive about extraction. If someone says "this place" while tagged
at a location, that's a place entity. If a song is playing, that's a song entity.
If they mention a brand, that's a brand entity even if the product isn't named.
```

**Output:**

```json
{
  "entities": [
    {
      "type": "place",
      "name": "Blue Bottle Coffee",
      "location_hint": "Valencia St, Mission District, San Francisco",
      "category": "eat",
      "confidence": 0.97,
      "source": "caption+transcript+tagged_location"
    },
    {
      "type": "food",
      "name": "Oat Milk Cortado",
      "location_hint": null,
      "category": "eat",
      "confidence": 0.75,
      "source": "transcript"
    },
    {
      "type": "song",
      "name": "Maria También",
      "artist": "Khruangbin",
      "category": "listen",
      "confidence": 0.90,
      "source": "transcript+audio_track"
    }
  ],
  "post_category": "eat",
  "post_intent": "recommendation"
}
```

**Entity Merging (caption + transcript):**
- Deduplicate by name similarity (Levenshtein distance < 3 OR fuzzy match > 0.85)
- When merging duplicates, keep the highest confidence score
- Keep the most specific location hint
- Combine source attributions (e.g., "caption+transcript")

---

### 4. Entity Resolution

Convert extracted names into stable, permanent URLs that won't expire.

| Entity Type | Resolution Strategy | Stable URL Format | API |
|---|---|---|---|
| **Place / Restaurant** | Google Maps Places API `findplacefromtext` | `google.com/maps/place/?q=place_id:ChIJ...` | Google Maps ($0.017/req after 28K free/mo) |
| **Brand** (@mention) | Check widget brand registry (47+ brands), then `{username}.com` | `patagonia.com` | Local registry + DNS check |
| **Product** | Brand site search if brand known, else DuckDuckGo top result | Product page URL | DuckDuckGo Instant Answer (free) |
| **Song / Music** | Spotify Search API | `open.spotify.com/track/...` | Spotify Web API (free, no auth for search) |
| **Food / Recipe** | No URL resolution — create as note pin | None (note pin in `eat`) | — |
| **Event** | Google search fallback | Event page URL | DuckDuckGo (free) |
| **Person / Creator** | Instagram profile URL (already have it from @mention) | `instagram.com/{username}` | — |
| **Generic** | DuckDuckGo Instant Answer API | Best match URL | DuckDuckGo (free) |

**Confidence Threshold: 0.7**
- `>= 0.7`: Auto-create derived pin
- `0.5 - 0.7`: Show in review queue with suggested resolution
- `< 0.5`: Discard (too vague to resolve)

**Caching:**

| Cache Key | TTL | Purpose |
|-----------|-----|---------|
| `place:{name}:{city}` | 30 days | Avoid repeat Google Maps lookups |
| `brand:{username}` | 30 days | Resolved brand URLs |
| `song:{name}:{artist}` | 30 days | Spotify track IDs |
| `domain_profile:{domain}` | Existing | AI classification cache |

---

### 5. Pin Creation

Each Instagram post creates **1 source pin + N derived pins**.

#### Source Pin (the Reel itself)

```javascript
{
  id: 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
  url: 'https://instagram.com/reel/AbC123/',
  title: 'Reel by @username',
  description: '<original caption text, truncated to 200 chars>',
  image: 'https://yfhudwakpgzswiylhfbh.supabase.co/storage/v1/object/public/instagram-media/{user_id}/AbC123.jpg',
  domain: 'instagram.com',
  category: 'follow',
  content_type: 'social',
  type_confidence: 1.0,
  source: 'social',
  source_id: 'instagram',
  instagram: {
    shortcode: 'AbC123',
    media_type: 'reel',           // reel | photo | carousel | video
    author_username: 'username',
    tagged_location: 'Blue Bottle Coffee',
    tagged_accounts: ['bluebottlecoffee'],
    audio_track: 'Khruangbin - Maria También',
    transcript: '<full transcription text>',
    extracted_entities_count: 3,
    import_job_id: 'uuid'         // links to batch import if applicable
  }
}
```

**Why store the transcript?** Enables re-analysis when entity extraction improves. Transcription costs money — don't re-transcribe, just re-analyze stored text.

#### Derived Pin (one per resolved entity)

```javascript
{
  id: 'link_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
  url: 'https://www.google.com/maps/place/?q=place_id:ChIJ...',
  title: 'Blue Bottle Coffee',
  description: 'From @username: "Best coffee spot on Valencia St — try the oat milk cortado"',
  image: null,                    // Enriched by standard enrich-link pipeline
  domain: 'google.com',
  category: 'eat',
  content_type: 'place',
  type_confidence: 0.97,
  source: 'social',
  source_url: 'https://instagram.com/reel/AbC123/',  // BACKLINK
  extraction: {
    method: 'ai-caption+transcript',
    source_platform: 'instagram',
    source_shortcode: 'AbC123',
    confidence: 0.97,
    entity_type: 'place',
    source_quote: 'Best coffee spot on Valencia St',
    resolved_via: 'google-maps-places-api'
  }
}
```

**Backlink mechanism:** `source_url` field on every derived pin points to the Instagram reel permalink. UI renders as "via @username on Instagram" badge on pin cards.

**Enrichment:** Derived pins are regular pins. They flow through the existing `enrich-link` pipeline for image resolution (scrape OG image from Google Maps, brand site, etc.). No changes to enrichment needed.

---

### 6. Media Re-hosting

Instagram CDN URLs expire in ~48 hours. All media must be downloaded and re-hosted immediately during import.

**Storage: Supabase Storage**

```
Bucket: instagram-media
Path:   {user_id}/{shortcode}.{ext}

Example: usr_abc123/AbC123.jpg  (thumbnail)
         usr_abc123/AbC123.mp4  (video, if stored)
```

**What to store:**

| Media | Store? | Reason |
|-------|--------|--------|
| Thumbnail image | Always | Source pin hero image |
| Video file | Only if transcribed | Transcript stored as text; video only needed for future frame analysis |
| Carousel images | First image only | Source pin hero image |

**Storage cost estimate:**
- 1,000 thumbnails @ ~200KB each = ~200MB
- Supabase Storage: 1GB free, then $0.021/GB/month
- Within free tier for most users

---

### 7. Review Queue

Low-confidence entities don't auto-create pins — they go to a review queue.

**Triggers review:**
- Entity confidence 0.5-0.7
- Entity resolution failed (place not found on Google Maps)
- Multiple possible resolutions (ambiguous name)

**Review UI:**

```
+------------------------------------------------------+
| Review Extracted Content (13 items)                   |
|                                                       |
| From @foodie_sf Reel:                                |
| +-----------------------------------------------------+
| | "that place on 5th"                              |  |
| | Type: place  Category: eat  Confidence: 0.55     |  |
| |                                                   |  |
| | Did you mean:                                     |  |
| | o The Mill (736 Divisadero St, SF)               |  |
| | o Tartine Manufactory (595 Alabama St, SF)       |  |
| | o Skip this entity                                |  |
| | o Enter URL manually: [________________]          |  |
| +-----------------------------------------------------+
|                                                       |
| [ Skip All ] [ Apply ]                                |
+------------------------------------------------------+
```

---

### 8. Import Progress (Batch)

Real-time progress tracking for extension batch imports via Supabase Realtime.

**Progress States:**

```
Queued -> Downloading media -> Transcribing -> Extracting entities ->
Resolving URLs -> Creating pins -> Complete
```

**Progress Modal:**

```
+------------------------------------------------------+
| Importing Instagram Saves                             |
|                                                       |
| ████████████░░░░░░░░░░ 23 / 47 reels                |
|                                                       |
| Currently: Transcribing audio...                      |
|                                                       |
| Extracted so far:                                     |
|  eat: 12 pins  *  go: 8  *  wear: 5  *  listen: 3   |
|                                                       |
| Estimated cost: $0.71                                 |
| Estimated time remaining: ~2 min                      |
|                                                       |
| [ Pause ]  [ Cancel ]                                 |
+------------------------------------------------------+
```

**Post-Import Summary:**

```
+------------------------------------------------------+
| Import Complete                                       |
|                                                       |
| 47 Instagram posts -> 47 source pins + 112 derived   |
|                                                       |
|  follow: 47 (source reels)                           |
|  eat:    34                                           |
|  go:     28                                           |
|  wear:   22                                           |
|  listen: 15                                           |
|  use:    8                                            |
|  read:   5                                            |
|                                                       |
|  Review queue: 13 low-confidence entities             |
|                                                       |
| Total cost: $0.71                                     |
|                                                       |
| [ Review Queue (13) ]  [ Done ]                       |
+------------------------------------------------------+
```

---

## Technical Architecture

### New Edge Function: `instagram-import`

**Location:** `supabase/functions/instagram-import/index.ts`
**Project:** Boards (`yfhudwakpgzswiylhfbh`)

**Request:**

```json
{
  "mode": "single | batch",
  "posts": [
    {
      "url": "https://instagram.com/reel/AbC123/",
      "shortcode": "AbC123",
      "caption": "Best coffee spot!...",
      "media_type": "reel",
      "tagged_location": "Blue Bottle Coffee",
      "tagged_accounts": ["bluebottlecoffee"],
      "audio_track": "Khruangbin - Maria También",
      "media_urls": {
        "thumbnail": "https://instagram.fcdn.net/...",
        "video": "https://instagram.fcdn.net/..."
      },
      "timestamp": "2026-01-15T10:30:00Z"
    }
  ],
  "user_id": "uuid",
  "import_job_id": "uuid"
}
```

**Processing Pipeline (per post):**

```
1. ACQUIRE
   +-- Single mode: fetch oEmbed -> get metadata + video URL
   +-- Batch mode: use pre-parsed data from extension
   -> Download thumbnail to Supabase Storage
   -> Download video to temp (for transcription)

2. TRANSCRIBE (video/reel only)
   -> POST video to Deepgram Nova-2 REST API
   -> Receive transcript text (~3 sec per 30 sec Reel)
   -> Store transcript on source pin

3. EXTRACT ENTITIES
   -> Send to Claude Haiku: caption + transcript + tags + audio track
   -> Receive: array of { type, name, location_hint, category, confidence }
   -> Merge caption + transcript entities, dedup by name similarity

4. RESOLVE ENTITIES (confidence >= 0.7 only)
   -> place -> Google Maps Places API (cached)
   -> brand -> widget brand registry -> {brand}.com
   -> song -> Spotify Search API
   -> product -> DuckDuckGo search
   -> Each resolved entity gets a stable URL

5. CREATE PINS
   -> 1 source pin (reel, category: follow)
   -> N derived pins (one per resolved entity, various categories)
   -> Set source_url backlink on each derived pin
   -> Queue derived pins for standard enrich-link pipeline

6. REPORT
   -> Single: return full result to client
   -> Batch: broadcast progress via Supabase Realtime
```

**Rate Limits:**
- 1 post/second (Deepgram: 100 concurrent, but pace for cost control)
- Google Maps: batch 10 concurrent lookups
- Claude Haiku: existing rate limits
- Spotify: 30 requests/second (generous)

### Schema Extensions

```sql
-- New JSONB column for Instagram metadata (source pins)
ALTER TABLE links ADD COLUMN IF NOT EXISTS instagram JSONB DEFAULT NULL;
-- { shortcode, media_type, author_username, tagged_location, tagged_accounts,
--   audio_track, transcript, extracted_entities_count, import_job_id }

-- New JSONB column for extraction provenance (derived pins)
ALTER TABLE links ADD COLUMN IF NOT EXISTS extraction JSONB DEFAULT NULL;
-- { method, source_platform, source_shortcode, confidence, entity_type,
--   source_quote, resolved_via }

-- Backlink column (derived pins -> source)
ALTER TABLE links ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT NULL;
```

Follows pattern of existing `video` and `music` JSONB columns (migration `014_music_watched_columns.sql`).

### Integration with Existing Systems

| System | Integration | Changes Required |
|--------|------------|-----------------|
| `enrich-link` | Derived pins queue for standard enrichment | None — they're regular pins |
| `addLink()` (client) | Instagram URL detection -> route to import | Detect `instagram.com` domain, show different UI |
| PWA Share Target | Existing `?add=` handler works | None — URL detection happens in add modal |
| Domain profile cache | Instagram.com classified once, reused | None — existing cache works |
| Supabase Realtime | Batch progress broadcasting | New channel: `import-progress:{job_id}` |

---

## User Flows

### Flow 1: Share Reel from Instagram (Mobile)

```
1. User watching Reel in Instagram app
2. Tap share -> select "ctrl.rodeo" from share sheet
3. PWA share target receives URL
4. Redirects to /boards/?add=<instagram-reel-url>
5. Add modal opens with "Analyzing reel..." state
6. Edge function: downloads video, transcribes, extracts entities
7. Modal updates: "Found: Blue Bottle Coffee (eat), Khruangbin (listen)"
8. User taps "Add All" (or edits/removes entities)
9. Source pin created in follow + derived pins in their categories
10. Board refreshes, new pins visible
```

### Flow 2: Paste Reel URL (Desktop)

```
1. User copies Reel URL from Instagram web or DM
2. Opens ctrl.rodeo, clicks "+"
3. Pastes instagram.com/reel/AbC123/
4. System detects Instagram URL -> routes to instagram-import
5. Same processing as Flow 1, steps 6-10
```

### Flow 3: Extension Batch Import (Desktop)

```
1. User installs ctrl.rodeo browser extension
2. Opens instagram.com, navigates to Saved posts
3. Extension popup shows "Import Instagram Saves"
4. User scrolls through saves — extension captures GraphQL responses
5. Counter updates: "147 posts captured"
6. User clicks "Send to Board"
7. Redirect to ctrl.rodeo with import modal
8. Progress bar: "Processing 147 posts..."
9. Real-time updates: entity counts by category
10. Import complete summary with category breakdown
11. Review queue for 23 low-confidence entities
12. User resolves or skips review items
13. Board shows all new pins in their categories
```

### Flow 4: Review Low-Confidence Entities

```
1. Import completes with 13 items in review queue
2. User clicks "Review Queue (13)"
3. Modal shows each ambiguous entity with:
   - Source reel context (caption snippet, thumbnail)
   - Entity name and type
   - Confidence score
   - Suggested resolutions (if any)
4. User selects correct resolution or skips
5. Resolved entities become derived pins
6. Skipped entities are discarded
```

### Flow 5: View Pin Provenance

```
1. User browsing eat category, sees "Blue Bottle Coffee" pin
2. Small "via IG" badge visible on card
3. User taps/clicks badge
4. Opens source reel (instagram.com/reel/AbC123/) in new tab
5. OR: taps pin to expand -> sees "From @username reel" with link
```

---

## Content Type Handling

| Instagram Post Type | Transcribe? | Entity Extraction Source | Source Pin Category |
|---------------------|------------|------------------------|-------------------|
| **Reel** | Yes | Caption + transcript + tags + audio track | follow |
| **Photo post** | No | Caption + tags only | follow |
| **Carousel** | Video slides only | Caption + transcript (if video) + tags | follow |
| **IGTV / Video** | Yes | Caption + transcript + tags | follow |
| **Story (if saved)** | Yes | Caption + transcript + tags (minimal captions typical) | follow |

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Single Reel import time | < 15 seconds (transcription + extraction + resolution) |
| Batch import throughput | 1 post/second sustained |
| Entity extraction accuracy | > 80% of entities identified (measured against manual audit) |
| Entity resolution accuracy | > 70% of resolved URLs are correct |
| Transcription accuracy | > 90% word accuracy (Deepgram Nova-2 baseline) |
| Media download reliability | > 99% success within 48h CDN window |
| Cost per Reel (with transcription) | < $0.02 average |

---

## Cost Model

### Per-Reel Breakdown (average)

| Step | Cost |
|------|------|
| Deepgram transcription (30 sec avg) | $0.0022 |
| Claude Haiku entity extraction | $0.00025 |
| Google Maps lookup (~1.2 places/reel avg) | $0.020 |
| Spotify lookup (~0.3 songs/reel avg) | Free |
| DuckDuckGo lookup (~0.5 products/reel avg) | Free |
| Supabase Storage (thumbnail) | Free tier |
| Standard enrichment (derived pins) | $0.002 |
| **Total per Reel** | **~$0.015** |

### Batch Estimates

| Volume | Cost | Time |
|--------|------|------|
| 10 Reels (quick test) | ~$0.15 | ~30 sec |
| 100 Reels (typical import) | ~$1.50 | ~2 min |
| 500 Reels (power user) | ~$7.50 | ~10 min |
| 1,000 Reels (full archive) | ~$15.00 | ~20 min |

**Cost dominated by Google Maps lookups.** Place name caching reduces this significantly for repeat locations.

---

## Privacy & Data Handling

| Data | Storage | Retention | Access |
|------|---------|-----------|--------|
| Instagram caption text | `links.description` + `links.instagram.transcript` | Permanent (user's data) | User only (RLS) |
| Transcription text | `links.instagram.transcript` | Permanent | User only (RLS) |
| Reel thumbnail | Supabase Storage | Permanent | User only (bucket policy) |
| Reel video | Not stored (transcribed and discarded) | Temporary (processing only) | — |
| Google Maps API key | Supabase secrets | — | Edge function only |
| Deepgram API key | Supabase secrets | — | Edge function only |

- No Instagram credentials stored — extension uses user's active session
- No Instagram API tokens — GraphQL interception uses user's own auth
- Video files deleted after transcription — only transcript text retained
- All data scoped to user via Supabase RLS

---

## Future Considerations (Out of Scope for v1)

1. **Frame analysis** — Claude Vision analyzing video frames for products, signage, visible text. Expensive ($0.01-0.05/frame), requires frame sampling strategy.
2. **TikTok import** — Same architecture, different GraphQL interceptor. Extension needs `tiktok.com` host permission.
3. **YouTube Shorts import** — YouTube API available for some content. Transcription via YouTube's auto-captions (free) before Deepgram.
4. **Ongoing sync** (Phase 8) — Auto-import new Instagram saves daily instead of one-time batch.
5. **iOS Shortcuts automation** — Shortcut that watches for Instagram shares and auto-posts to API.
6. **Re-processing** — Re-analyze stored transcripts with improved extraction model.
7. **Carousel deep analysis** — Per-slide entity extraction for multi-image posts.
8. **Music auto-extraction** — Instagram's audio track metadata as automatic `listen` pins.

---

## Open Questions

1. **Private Reels**: Extension can capture private saves (user's own session), but single-URL paste via oEmbed only works for public posts. Accept this limitation or find workaround?
2. **Carousel handling**: One source pin per carousel, or one per slide? One caption covers all slides, so one source pin seems right.
3. **Video storage**: Store full Reel video for future frame analysis, or discard after transcription? Storage costs vs future capability.
4. **Music in Reels**: Instagram shows song name/artist in the audio track field. Auto-create `listen` pins for every Reel with music, or only when music is explicitly discussed in caption/transcript?
5. **Deepgram fallback**: Evaluate OpenAI Whisper as backup? More expensive but potentially more accurate for noisy/musical audio.
6. **Duplicate derived pins**: If two different Reels mention the same restaurant, create one pin or two? Dedup by resolved URL seems right — second Reel adds a second backlink.
7. **Cost allocation**: Should users see cost per import? Transparency vs UX friction.

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Entity extraction recall | > 80% of real entities found | Manual audit of 50 Reels |
| Entity extraction precision | > 85% of extracted entities are real | Manual audit |
| Resolution accuracy | > 70% of URLs point to correct entity | Manual spot check |
| Auto-categorization accepted | > 75% of derived pins not recategorized by user | Track category changes on source=social pins |
| Review queue size | < 25% of total entities | Review queue count / total entities |
| Import completion rate | > 90% of started imports complete | Import job status tracking |
| Mobile share adoption | > 50% of Instagram imports via PWA share | Source tracking |
| Time to first derived pin (single) | < 15 seconds | Client timing |
| Cost per Reel | < $0.02 average | API cost tracking |

---

## Dependencies

| Dependency | Status | Blocks |
|------------|--------|--------|
| Supabase Edge Functions (Boards project) | Available | Nothing — ready to build |
| Deepgram API account | Need to create | Transcription |
| Google Maps Places API key | Need to create | Place resolution |
| Spotify Web API | Available (no auth for search) | Music resolution |
| Browser extension infrastructure (Phase 9.3) | Not built | Batch import only — single URL works without it |
| Import job tracking (Phase 9.1) | Not built | Batch progress — single URL works without it |
| `source_url` schema column | Not built | Backlinks |
| `instagram` JSONB column | Not built | Instagram metadata storage |
| `extraction` JSONB column | Not built | Provenance tracking |

---

## Related Documents

- [Phase 11: Instagram Import](../../execution/project-plan/phase-11-instagram-import.md) — Implementation plan
- [Phase 9: Bulk Import](../../execution/project-plan/phase-9-bulk-import.md) — Parent plan for all import features
- [Phase 8: Automated Pins](../../execution/project-plan/phase-8-automated-pins.md) — Ongoing sync (uses same OAuth, different scheduling)
- [PRD: Content Type System](./content-type-system.md) — How pins are classified
- [TECH: Database Schema](../../infrastructure/technical-design/database-schema.md) — Current schema reference
- [TECH: AI Widget System](../../infrastructure/technical-design/ai-widget-system.md) — Brand registry for entity resolution
- [User Personas](../../ux/personas.md) — Persona details and JTBD
