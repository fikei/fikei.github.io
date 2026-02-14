# Phase 11: Instagram Import

> Back to [Project Plan](./index.md)

Turn Instagram Reels & Saves into structured, actionable pins. The system transcribes video, extracts entities (places, products, music) via AI, resolves them to stable URLs, and creates categorized pins with backlinks to the source reel.

**PRD**: [Instagram Reels & Saves Import](../../strategy/prds/instagram-import.md)

**Depends on**: Phase 9.1 (Import Infrastructure) for batch job tracking. Single-URL import works independently.

---

## Epic 11.1: Instagram Import Edge Function

The core server-side pipeline that processes Instagram posts into source + derived pins.

| Story | Tasks | Status |
|-------|-------|--------|
| **Instagram URL Detection** | | Pending |
| | Detect `instagram.com/reel/*`, `/p/*`, `/tv/*` URLs in add modal | Pending |
| | Route detected URLs to `instagram-import` edge function instead of `enrich-link` | Pending |
| | Show "Analyzing reel..." UI state in add modal for Instagram URLs | Pending |
| **`instagram-import` Edge Function — Acquire** | | Pending |
| | Create `supabase/functions/instagram-import/index.ts` scaffolding | Pending |
| | Single mode: fetch Instagram oEmbed API for public post metadata | Pending |
| | Batch mode: accept pre-parsed JSON array from extension | Pending |
| | Download thumbnail image to Supabase Storage (`instagram-media/{user_id}/{shortcode}.jpg`) | Pending |
| | Download video to temp buffer for transcription | Pending |
| | Create Supabase Storage bucket `instagram-media` with user-scoped access policy | Pending |
| **`instagram-import` Edge Function — Transcribe** | | Pending |
| | Integrate Deepgram Nova-2 REST API (POST video buffer, receive transcript) | Pending |
| | Configure: `model=nova-2`, `smart_format=true`, `diarize=false`, `detect_language=true` | Pending |
| | Handle transcription failure gracefully (proceed with caption-only) | Pending |
| | Skip transcription for photo-only posts | Pending |
| | Cost optimization: skip transcription if caption yields 3+ high-confidence entities | Pending |
| **`instagram-import` Edge Function — Extract Entities** | | Pending |
| | Claude Haiku prompt: caption + transcript + tagged location + tagged accounts + audio track → entities array | Pending |
| | Entity schema: `{ type, name, location_hint, category, confidence, source }` | Pending |
| | Merge caption entities + transcript entities with deduplication (Levenshtein < 3) | Pending |
| | Keep highest confidence score when merging duplicates | Pending |
| **`instagram-import` Edge Function — Resolve Entities** | | Pending |
| | Place resolution: Google Maps Places API `findplacefromtext` → Place ID URL | Pending |
| | Brand resolution: check widget brand registry (47+ brands), then `{username}.com` | Pending |
| | Music resolution: Spotify Search API (free, no auth for search endpoint) | Pending |
| | Product resolution: DuckDuckGo Instant Answer API fallback | Pending |
| | Confidence filtering: only resolve entities with confidence >= 0.7 | Pending |
| | Place lookup cache: `place:{name}:{city}` → Place ID (30-day TTL) | Pending |
| | Brand lookup cache: `brand:{username}` → URL (30-day TTL) | Pending |
| | Song lookup cache: `song:{name}:{artist}` → Spotify track ID (30-day TTL) | Pending |
| **`instagram-import` Edge Function — Create Pins** | | Pending |
| | Create source pin: reel URL, category `follow`, content_type `social`, `instagram` JSONB metadata | Pending |
| | Store transcript in `instagram.transcript` field on source pin | Pending |
| | Create derived pins: one per resolved entity, category from AI, backlink via `source_url` | Pending |
| | Set `extraction` JSONB on derived pins: method, source_shortcode, confidence, entity_type, source_quote | Pending |
| | Queue derived pins for standard `enrich-link` pipeline | Pending |
| | Return result: `{ source_pins, derived_pins, review_queue, transcription_used }` | Pending |

---

## Epic 11.2: Schema Extensions

Database changes to support Instagram metadata, extraction provenance, and backlinks.

| Story | Tasks | Status |
|-------|-------|--------|
| **Instagram Metadata Column** | | Pending |
| | Create migration: `ALTER TABLE links ADD COLUMN IF NOT EXISTS instagram JSONB DEFAULT NULL` | Pending |
| | JSONB schema: `{ shortcode, media_type, author_username, tagged_location, tagged_accounts, audio_track, transcript, extracted_entities_count, import_job_id }` | Pending |
| **Extraction Provenance Column** | | Pending |
| | Create migration: `ALTER TABLE links ADD COLUMN IF NOT EXISTS extraction JSONB DEFAULT NULL` | Pending |
| | JSONB schema: `{ method, source_platform, source_shortcode, confidence, entity_type, source_quote, resolved_via }` | Pending |
| **Backlink Column** | | Pending |
| | Create migration: `ALTER TABLE links ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT NULL` | Pending |
| | Index: `CREATE INDEX idx_links_source_url ON links(source_url) WHERE source_url IS NOT NULL` | Pending |
| **Client-Side Schema Sync** | | Pending |
| | Update `addLink()` in `boards/index.html` to handle `instagram`, `extraction`, and `source_url` fields | Pending |
| | Update `syncLinkToSupabase()` to include new columns | Pending |

---

## Epic 11.3: Single URL Import UX

The paste/share flow for importing one Reel at a time.

| Story | Tasks | Status |
|-------|-------|--------|
| **Add Modal Instagram State** | | Pending |
| | Detect Instagram URLs in paste input (regex: `instagram\.com/(reel|p|tv)/`) | Pending |
| | Show "Analyzing reel..." spinner state with Instagram-specific messaging | Pending |
| | Display extracted entities as selectable list: name, category, confidence | Pending |
| | Allow user to accept all, edit categories, remove individual entities, or cancel | Pending |
| | "Add All" button creates source pin + selected derived pins | Pending |
| **PWA Share Target Integration** | | Pending |
| | Existing `pwa-share.html` handles Instagram URLs (no changes needed — URL detection in add modal) | Pending |
| | Verify share from Instagram app → ctrl.rodeo works on iOS and Android | Pending |

---

## Epic 11.4: Provenance UI

Show where derived pins came from — backlink badges and source reel links.

| Story | Tasks | Status |
|-------|-------|--------|
| **"via Instagram" Badge on Pin Cards** | | Pending |
| | Detect `source_url` containing `instagram.com` on pin data | Pending |
| | Render small "via IG" badge on pin card (design system component) | Pending |
| | Badge links to source reel URL (opens in new tab) | Pending |
| **Expanded Pin Provenance** | | Pending |
| | In expanded pin view, show "From @username reel" with link to source | Pending |
| | Show extraction confidence and source quote context | Pending |
| **Source Pin Entity Count** | | Pending |
| | On source reel pins in `follow`, show "3 pins extracted" count | Pending |
| | Clicking count filters board to show derived pins from that reel | Pending |
| **Filter by Import Source** | | Pending |
| | Add "Instagram imports" filter option | Pending |
| | Filter shows all pins with `source='social'` AND `source_id='instagram'` | Pending |

---

## Epic 11.5: Review Queue

Handle low-confidence entities that need manual resolution.

| Story | Tasks | Status |
|-------|-------|--------|
| **Review Queue Modal** | | Pending |
| | Show after import completes if review_queue > 0 | Pending |
| | Display each ambiguous entity with source context (caption snippet, thumbnail) | Pending |
| | Show confidence score and entity type | Pending |
| | Offer suggested resolutions (if partial match found) | Pending |
| | Allow: select resolution, enter URL manually, skip entity | Pending |
| | "Skip All" to dismiss entire review queue | Pending |
| | Resolved entities create derived pins via standard flow | Pending |

---

## Epic 11.6: Batch Import (depends on Phase 9.1 + 9.3)

Extension-driven bulk import of Instagram saves. Depends on browser extension infrastructure from Phase 9.3 and import job tracking from Phase 9.1.

| Story | Tasks | Status |
|-------|-------|--------|
| **Instagram-Specific Extension Logic** | | Pending |
| | Add Instagram GraphQL interception to Phase 9.3 extension framework | Pending |
| | Filter for `SavedPostsQuery` and `SavedCollectionsQuery` endpoints | Pending |
| | Extract per post: shortcode, caption, media_type, tagged_location, tagged_accounts, media_urls, audio_track | Pending |
| | "Send to Board" triggers batch POST to `instagram-import` edge function | Pending |
| **Batch Progress UI** | | Pending |
| | Import progress modal with Supabase Realtime updates | Pending |
| | Show: current step (downloading/transcribing/extracting/resolving), count, ETA | Pending |
| | Live entity extraction feed: "Found: Blue Bottle Coffee → eat" | Pending |
| | Pause / Cancel controls | Pending |
| | Cost estimate shown before starting: "This will process 47 Reels. Estimated cost: ~$0.70" | Pending |
| **Post-Import Summary** | | Pending |
| | Category breakdown: source pins + derived pins per category | Pending |
| | Review queue count with "Review Now" button | Pending |
| | Total cost spent | Pending |
| **Rate Limiting & Cost Controls** | | Pending |
| | Process 1 post/second sustained throughput | Pending |
| | Batch Google Maps lookups (max 10 concurrent) | Pending |
| | Domain profile cache warmup (existing) | Pending |
| | Place name cache to avoid repeat Google Maps API calls | Pending |

---

## Epic 11.7: External Service Setup

API accounts and secrets needed for the pipeline.

| Story | Tasks | Status |
|-------|-------|--------|
| **Deepgram Account** | | Pending |
| | Create Deepgram account and API key | Pending |
| | Add `DEEPGRAM_API_KEY` to Supabase function secrets (Boards project) | Pending |
| | Verify Nova-2 model access and rate limits | Pending |
| **Google Maps Places API** | | Pending |
| | Enable Places API in Google Cloud project | Pending |
| | Create API key with Places API restriction | Pending |
| | Add `GOOGLE_MAPS_API_KEY` to Supabase function secrets | Pending |
| | Verify free tier quota (28K requests/month) | Pending |
| **Spotify Web API** | | Pending |
| | Verify search endpoint works without auth (public endpoint) | Pending |
| | If auth needed: register Spotify app, get client credentials | Pending |

---

*Last updated: 2026-02-14*
