# Phase 9: Bulk Import

> Back to [Project Plan](./index.md)

Solve the cold start problem. People arrive with years of saved content fractured across platforms that were never designed for retrieval — browser bookmark folders they haven't opened since 2019, Instagram saves that are just Reels of restaurant recs, Twitter bookmarks that are an unsorted graveyard. The content is valuable but the formats are hostile to access and organization.

This phase turns ctrl.rodeo into the place you consolidate your scattered digital life. Import everything, let AI organize it, and finally have one board that reflects what you actually care about.

**Supersedes**: [Phase 7 Epic 7.2: Import/Export](./phase-7-platform-expansion.md) (absorbed and expanded here)

**Prerequisite**: Partial Metadata Resilience (Epic 3.5 Story 1) — imported pins will frequently have incomplete metadata and need graceful handling.

---

## Access Tiers

Every platform import has three possible access methods. We prioritize the one with the least friction:

| Tier | Friction | How It Works | Platforms |
|------|----------|-------------|-----------|
| **Tier 1: OAuth API** | One-click | Authorize → select what to import → done | Reddit, Spotify, Pinterest, YouTube (partial), Pocket |
| **Tier 2: Browser Extension** | Low | Navigate to your saves page → extension captures data from the page's own API calls | Instagram, TikTok, Twitter/X |
| **Tier 3: File Upload** | Medium | Export from platform → upload file to ctrl.rodeo | Browser bookmarks, Google Maps, Instapaper, Raindrop, Pinboard, generic CSV/JSON |

File upload remains a universal fallback for all platforms — if OAuth is down or the extension isn't installed, users can always request their data export and upload it.

---

## Epic 9.1: Import Infrastructure

The shared pipeline that all import sources flow through regardless of access tier. Handles queuing, deduplication, bulk enrichment, and progress tracking.

| Story | Tasks | Status |
|-------|-------|--------|
| **Import Job Model** | | Pending |
| | Create `import_jobs` table: `{ id, user_id, source, access_tier, status, total_items, processed, enriched, failed, started_at, completed_at }` | Pending |
| | Job state machine: `queued → parsing → deduplicating → enriching → review → complete` | Pending |
| | RLS: users can only see their own import jobs | Pending |
| **Bulk Import Edge Function** | | Pending |
| | Create `bulk-import` edge function — accepts parsed items array, raw file upload, or OAuth token + platform ID | Pending |
| | Rate-limited processing: 50 pins/batch, 2s pause between batches | Pending |
| | Progress callback via Supabase Realtime (broadcast job status updates) | Pending |
| | Graceful failure: individual pin failures don't stop the batch | Pending |
| **Deduplication Engine** | | Pending |
| | URL-based exact match (normalized, tracking params stripped) | Pending |
| | Fuzzy title match for pins without URLs (Levenshtein distance < 3) | Pending |
| | Domain + path match (catch URL variants: with/without www, http/https, trailing slash) | Pending |
| | Duplicate resolution UI: skip, replace, keep both | Pending |
| | Dedup summary: "Found 23 duplicates out of 340 items" | Pending |
| **Bulk AI Categorization** | | Pending |
| | Batch classify imported pins via Claude (group by domain to maximize cache hits) | Pending |
| | Domain profile cache warmup: process one pin per unique domain first, then bulk-apply | Pending |
| | Category confidence review: flag low-confidence pins for manual review | Pending |
| | Cost estimation before import: "This will use ~$0.04 in AI calls" | Pending |
| **Import Progress UI** | | Pending |
| | Modal with real-time progress bar (items parsed → deduplicated → enriched) | Pending |
| | Live feed of imported pins appearing on board | Pending |
| | Error log: which items failed and why | Pending |
| | "Pause" / "Cancel" controls for long-running imports | Pending |
| | Import complete summary: items added, duplicates skipped, categories assigned | Pending |

---

## Epic 9.2: OAuth-Connected Imports (Tier 1)

One-click imports via platform APIs. User authorizes, selects what to import, done. No file downloads, no waiting.

> **Shared infra with Phase 8**: [Epic 8.3 (Social Media Import)](./phase-8-automated-pins.md) uses the same OAuth connections for ongoing sync. Build the OAuth flow once, use it for both bulk import (Phase 9) and continuous sync (Phase 8).

### OAuth Infrastructure

| Story | Tasks | Status |
|-------|-------|--------|
| **OAuth Connection Manager** | | Pending |
| | Create `connected_accounts` table: `{ user_id, platform, access_token_enc, refresh_token_enc, scopes, connected_at, last_used, status }` | Pending |
| | Encrypt tokens at rest (Supabase Vault or application-level encryption) | Pending |
| | Token refresh flow: auto-refresh before expiry, handle revocation gracefully | Pending |
| | "Connected Accounts" section in user settings | Pending |
| | Connect / disconnect per platform with confirmation | Pending |
| | Show last sync date and item count per connected account | Pending |

### Reddit (Free, excellent API)

| Story | Tasks | Status |
|-------|-------|--------|
| **Reddit OAuth & Import** | | Pending |
| | Register Reddit OAuth app (type: web app) at reddit.com/prefs/apps | Pending |
| | OAuth 2.0 flow with scopes: `identity`, `history`, `read` | Pending |
| | Fetch `GET /user/{username}/saved` (paginated, 100 items/page) | Pending |
| | Extract: link posts → URL pins, text posts → note pins, comments → note pins with parent URL | Pending |
| | Map subreddit → category (AI-assisted: r/malefashionadvice → `wear`, r/food → `eat`) | Pending |
| | Preserve Reddit score and save date as metadata | Pending |

### Spotify (Free, comprehensive API)

| Story | Tasks | Status |
|-------|-------|--------|
| **Spotify OAuth & Import** | | Pending |
| | Register Spotify app at developer.spotify.com/dashboard | Pending |
| | OAuth 2.0 PKCE flow with scopes: `user-library-read`, `playlist-read-private` | Pending |
| | Fetch `GET /v1/me/tracks` (liked songs, paginated 50/page) | Pending |
| | Fetch `GET /v1/me/playlists` → `GET /v1/playlists/{id}/tracks` for each playlist | Pending |
| | Map to pins: Spotify URL, track name + artist as title, album art as image | Pending |
| | Map playlist names → categories, default unmatched to `follow` | Pending |

### Pinterest (Free, open API v5)

| Story | Tasks | Status |
|-------|-------|--------|
| **Pinterest OAuth & Import** | | Pending |
| | Register at developers.pinterest.com | Pending |
| | OAuth 2.0 flow with scopes: `boards:read`, `pins:read`, `user_accounts:read` | Pending |
| | Fetch `GET /v5/boards` → `GET /v5/boards/{id}/pins` for each board | Pending |
| | Extract: pin source URL (if exists), description, image | Pending |
| | Map Pinterest board names → categories | Pending |
| | Handle image-only pins (no source URL) → import as image pins | Pending |

### YouTube (Free, partial — liked videos + playlists, NOT Watch Later)

| Story | Tasks | Status |
|-------|-------|--------|
| **YouTube OAuth & Import** | | Pending |
| | Register Google Cloud project, enable YouTube Data API v3 | Pending |
| | OAuth 2.0 flow with scope: `https://www.googleapis.com/auth/youtube.readonly` | Pending |
| | Fetch liked videos: get `likes` playlist ID from channel, then `playlistItems.list` | Pending |
| | Fetch user playlists: `playlists.list` → `playlistItems.list` for each | Pending |
| | Map to pins: YouTube URL, title, channel name, thumbnail, duration | Pending |
| | Map playlist names → categories | Pending |
| | Note in UI: "Watch Later and Watch History are not accessible via YouTube's API — use Google Takeout for those" | Pending |

### Pocket (Free API, alternative to file export)

| Story | Tasks | Status |
|-------|-------|--------|
| **Pocket OAuth & Import** | | Pending |
| | Register at getpocket.com/developer | Pending |
| | Pocket OAuth flow (non-standard: uses request token → redirect → access token) | Pending |
| | Fetch `GET /v3/get` with `state=all` (paginated) | Pending |
| | Map Pocket tags → categories (AI-assisted for unmapped tags) | Pending |
| | Preserve read/unread status and favorite flag | Pending |

---

## Epic 9.3: Browser Extension Import (Tier 2)

For platforms with no usable API (Instagram, TikTok) or prohibitively expensive APIs (Twitter/X at $200/mo). The browser extension intercepts the platform's own internal API calls while the user is logged in — yielding structured JSON data without scraping the DOM.

> **Extends [Phase 7 Epic 7.1: Browser Extension](./phase-7-platform-expansion.md)**. The base extension (save to board) gets import capabilities added as a second mode.

### Extension Import Infrastructure

| Story | Tasks | Status |
|-------|-------|--------|
| **Network Interception Framework** | | Pending |
| | Manifest V3 content script that injects a page-context script via `<script>` tag | Pending |
| | Page-context script monkey-patches `window.fetch()` and `XMLHttpRequest` | Pending |
| | Interceptor filters for platform-specific API URL patterns (e.g., Instagram GraphQL endpoints) | Pending |
| | Captured JSON sent to content script via `window.postMessage()` | Pending |
| | Content script forwards to service worker via `chrome.runtime.sendMessage()` | Pending |
| | Service worker batches captured items and sends to ctrl.rodeo `bulk-import` endpoint | Pending |
| **Import Mode UI (Extension Popup)** | | Pending |
| | "Import" tab in extension popup alongside "Save" tab | Pending |
| | Platform detection: auto-detect which site the user is on | Pending |
| | Instructions per platform: "Scroll through your saves — we'll capture them as you go" | Pending |
| | Live counter: "47 items captured so far..." | Pending |
| | "Send to Board" button to push captured batch to ctrl.rodeo | Pending |
| | Progress indicator during upload | Pending |

### Instagram (No API for saved posts)

| Story | Tasks | Status |
|-------|-------|--------|
| **Instagram Saved Posts Import** | | Pending |
| | `host_permissions`: `https://www.instagram.com/*` | Pending |
| | Intercept Instagram GraphQL API calls for saved posts (`/graphql/query/?query_hash=...`) | Pending |
| | Parse GraphQL response: extract post URL, caption, media URLs, post type (photo/video/carousel/reel) | Pending |
| | AI caption analysis: extract locations, brands, product names, restaurant names from captions | Pending |
| | Handle Reels: extract caption text, tagged location, mentioned accounts → structured pin metadata | Pending |
| | Download media before CDN URLs expire (Instagram URLs expire ~48h) → store in Supabase Storage | Pending |
| | Auto-scroll helper: extension can programmatically scroll the saved posts page to load more items | Pending |

### TikTok (No consumer API)

| Story | Tasks | Status |
|-------|-------|--------|
| **TikTok Favorites Import** | | Pending |
| | `host_permissions`: `https://www.tiktok.com/*` | Pending |
| | Intercept TikTok API calls when user navigates to their favorites/liked page | Pending |
| | Parse response: extract video URL, description, creator, sounds, hashtags | Pending |
| | AI content extraction from descriptions: product recs, restaurant names, locations, brand mentions | Pending |
| | Map hashtags and content to categories | Pending |
| | Download video thumbnails before they expire | Pending |

### Twitter/X (API exists but costs $200/mo — extension is free)

| Story | Tasks | Status |
|-------|-------|--------|
| **Twitter/X Bookmarks Import** | | Pending |
| | `host_permissions`: `https://x.com/*`, `https://twitter.com/*` | Pending |
| | Intercept Twitter's internal GraphQL API calls for bookmarks endpoint | Pending |
| | Parse response: extract tweet URL, text, quoted tweet URLs, media, author | Pending |
| | Resolve t.co shortened URLs to real destinations | Pending |
| | Thread detection: group chained tweets into a single pin | Pending |
| | Extract URLs from tweet text → primary pin URL | Pending |
| | Fallback: also support file-based import from Twitter data export (Epic 9.4) | Pending |

---

## Epic 9.4: File-Based Imports (Tier 3)

Upload-and-parse imports for platforms that are inherently file-based (browser bookmarks) or where API/extension access isn't available. Universal fallback for everything.

| Story | Tasks | Status |
|-------|-------|--------|
| **Browser Bookmarks** | | Pending |
| | Parse Netscape Bookmark HTML format (Chrome, Firefox, Safari, Edge all use this) | Pending |
| | Preserve folder hierarchy → map to categories or tags | Pending |
| | Handle nested folders: flatten with breadcrumb context ("Tech > JavaScript > Frameworks") | Pending |
| | Import date preservation (ADD_DATE attribute → `addedAt`) | Pending |
| | Preview: show folder tree, let user select which folders to import | Pending |
| **Google Takeout (Maps, Keep, YouTube Watch Later)** | | Pending |
| | Guide: how to use Google Takeout (takeout.google.com) to export specific services | Pending |
| | Parse Google Maps Saved Places CSV: place name, address, Google Maps URL, list label | Pending |
| | Map Google Maps labels (Want to Go, Favorites, Starred) → categories | Pending |
| | Parse Google Keep notes HTML: extract URLs, preserve note text as note pins | Pending |
| | Parse YouTube Watch Later / Watch History (not available via API, only Takeout) | Pending |
| **Instapaper** | | Pending |
| | Parse Instapaper CSV export (URL, Title, Selection, Folder) | Pending |
| | Map Instapaper folders → categories | Pending |
| | Preserve highlights/selections as pin notes | Pending |
| **Raindrop.io** | | Pending |
| | Parse Raindrop CSV export (or HTML) | Pending |
| | Map Raindrop collections → categories | Pending |
| | Preserve tags and notes | Pending |
| **Pinboard / del.icio.us** | | Pending |
| | Parse Pinboard JSON export | Pending |
| | Map tags → categories | Pending |
| | Preserve descriptions and toread flag | Pending |
| **Apple Data** | | Pending |
| | Parse Safari Reading List from iCloud export (or `~/Library/Safari/Bookmarks.plist`) | Pending |
| | Parse Apple Notes export: extract URLs, preserve note content | Pending |
| **Twitter/X Data Export** (file fallback for Epic 9.3 extension) | | Pending |
| | Parse `like.js` and `bookmark.js` from Twitter archive zip | Pending |
| | Extract URLs from tweet text (t.co → resolve to real URL) | Pending |
| | Thread detection: group tweet chains into single pins | Pending |
| **Instagram Data Export** (file fallback for Epic 9.3 extension) | | Pending |
| | Parse `saved_posts.json` / `saved_media.json` from Instagram data download zip | Pending |
| | Handle expired CDN URLs — download and re-host during import window | Pending |
| | AI caption analysis: extract locations, brands, recommendations from post text | Pending |
| **Generic CSV / JSON** | | Pending |
| | Column mapping UI: "Which column is the URL? Title? Category?" | Pending |
| | Auto-detect columns by header name (url, link, title, name, category, tag, date) | Pending |
| | Preview first 10 rows before importing | Pending |

---

## Epic 9.5: AI-Powered Content Extraction

For content locked inside hostile formats — screenshots of Instagram posts, forwarded emails, copy-pasted message threads. AI does the heavy lifting to turn unstructured media into structured pins.

| Story | Tasks | Status |
|-------|-------|--------|
| **Screenshot Import** | | Pending |
| | Upload one or more screenshots (drag-and-drop or file picker) | Pending |
| | Vision AI analysis: extract visible URLs, app names, product names, locations | Pending |
| | OCR text extraction from screenshots | Pending |
| | Context detection: "This is an Instagram post about a restaurant" → create pin with category `eat` | Pending |
| | Batch screenshot processing: import a camera roll folder of saved screenshots | Pending |
| **Email / Newsletter Forwarding** | | Pending |
| | Forward emails to import address (reuse Phase 8 email-to-board infra) | Pending |
| | AI parses email body: extract all URLs with surrounding context | Pending |
| | Newsletter detection: identify newsletter format, extract article links vs ads vs navigation | Pending |
| | "Forward your top 10 newsletters" onboarding prompt | Pending |
| **Copy-Paste Blob** | | Pending |
| | Paste unstructured text (iMessage thread, Slack convo, Notes dump) into import modal | Pending |
| | AI extraction: find URLs, product names, place names, recommendations | Pending |
| | Entity resolution: "that place on 5th" + context → real URL if possible | Pending |
| | Structured output: list of extracted items with confidence, user confirms before import | Pending |
| **Shared List Import** | | Pending |
| | Paste a Google Doc / Notion page / Are.na channel URL | Pending |
| | Fetch and parse the shared content | Pending |
| | Extract all links with context from the document | Pending |
| | Handle common list formats: bullet lists, numbered lists, tables of links | Pending |

---

## Epic 9.6: Onboarding Import Flow

Make bulk import the first thing new users do. Don't show them an empty board — show them a path to populating it from sources they already have.

| Story | Tasks | Status |
|-------|-------|--------|
| **"Import Your Digital Life" Wizard** | | Pending |
| | First-run detection: if board is empty, show import wizard instead of empty state | Pending |
| | Platform grid: show logos with access tier badges (Instant, Extension, Upload) | Pending |
| | Tier 1 platforms: "Connect" button → OAuth flow → import | Pending |
| | Tier 2 platforms: "Install Extension" prompt → guide to saves page → import | Pending |
| | Tier 3 platforms: step-by-step export guide with annotated screenshots → file upload | Pending |
| | "I'll do this later" skip option with reminder prompt after 3 manual pins | Pending |
| **Platform Export Guides** (Tier 3 fallback) | | Pending |
| | One-page guide per platform with annotated screenshots | Pending |
| | Deep links where possible (link directly to platform's export settings page) | Pending |
| | Estimated wait times for data requests (Instagram: ~48h, Twitter: ~24h, etc.) | Pending |
| | "Request sent" reminder: email or in-app notification when data should be ready | Pending |
| **Post-Import Review Queue** | | Pending |
| | After import, show review screen: pins sorted by AI confidence (low first) | Pending |
| | Quick-swipe category assignment for uncategorized pins | Pending |
| | Bulk actions: "These 40 pins are all 'eat' — confirm?" | Pending |
| | "Looks good" button to accept all AI assignments and skip review | Pending |
| **Import Dashboard** | | Pending |
| | Persistent "Import" section in settings (not just onboarding) | Pending |
| | Show connected accounts with sync status | Pending |
| | Show past imports with source, date, count | Pending |
| | "Import more" button — always accessible | Pending |

---

## Epic 9.7: Bulk Organization

After import, help users make sense of the flood. AI-driven organization for hundreds or thousands of pins.

| Story | Tasks | Status |
|-------|-------|--------|
| **Smart Category Suggestions** | | Pending |
| | Post-import analysis: "You have 200 pins — here's how I'd organize them" | Pending |
| | Show category distribution pie chart | Pending |
| | Suggest new categories if existing 8 don't cover the content well | Pending |
| | One-click accept suggested organization | Pending |
| **Duplicate Merge UI** | | Pending |
| | After import, show duplicate clusters: "These 3 pins are the same URL from different sources" | Pending |
| | Side-by-side comparison: which version has better metadata? | Pending |
| | "Keep best" auto-merge (pick the version with the most complete metadata) | Pending |
| | Batch merge: "Merge all 15 duplicate clusters using best metadata" | Pending |
| **Bulk Edit** | | Pending |
| | Multi-select mode: tap pins to select, show bulk action bar | Pending |
| | Bulk recategorize: move selected pins to a different category | Pending |
| | Bulk delete: remove selected pins | Pending |
| | Bulk tag: add a label to selected pins (e.g., "imported from instagram") | Pending |
| | Select by source: "Select all pins imported from Twitter" | Pending |
| **Source Attribution** | | Pending |
| | Show import source badge on pin cards (Instagram, Twitter, Pocket, etc.) | Pending |
| | Filter by import source: "Show only Pocket imports" | Pending |
| | Import timeline: "Jan 15: 200 pins from Chrome bookmarks, Jan 20: 50 from Instagram" | Pending |

---

## Why This Is a Separate Phase

This is distinct from [Phase 8: Automated Pin Creation](./phase-8-automated-pins.md):

| | Phase 8: Automated Pins | Phase 9: Bulk Import |
|-|------------------------|---------------------|
| **Direction** | Forward-looking — ongoing ingestion | Backward-looking — historical migration |
| **Frequency** | Continuous (feeds poll, APIs receive) | One-time per platform (with re-import option) |
| **Volume** | Trickle (1-10 pins/day per source) | Flood (50-5,000 pins in one batch) |
| **Data quality** | High (structured feed/API data) | Variable (screenshots, expired URLs, video captions) |
| **AI role** | Light (standard enrichment) | Heavy (Vision AI, OCR, caption parsing, entity resolution) |
| **User intent** | Set-and-forget automation | Active migration, requires review |
| **Problem solved** | "Keep my board fresh" | "I need a starting point" |

**Shared infrastructure**: Both phases use the same OAuth connections (build once in Phase 9, reuse in Phase 8 for ongoing sync) and the same `ingest-pin` / `bulk-import` edge functions.

---

## Architecture Notes

### Three-Tier Import Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      TIER 1: OAuth API                       │
│  Reddit, Spotify, Pinterest, YouTube, Pocket                │
│                                                              │
│  ctrl.rodeo server ──OAuth──► Platform API ──► parsed items │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                      TIER 2: Browser Extension               │
│  Instagram, TikTok, Twitter/X                                │
│                                                              │
│  Extension content script ──intercepts──► platform's own     │
│  internal API calls (GraphQL, REST) ──► structured JSON      │
│  ──► service worker ──► ctrl.rodeo bulk-import endpoint      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┼──────────────────────────────────┐
│                      TIER 3: File Upload                     │
│  Bookmarks, Google Takeout, Instapaper, Raindrop, CSV/JSON  │
│                                                              │
│  User uploads file ──► client-side parser ──► parsed items   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │    IMPORT PIPELINE     │
              │  (shared across tiers) │
              │                        │
              │  Deduplicate           │
              │  Batch AI categorize   │
              │  Batch enrich          │
              │  Progress tracking     │
              │  Review queue          │
              └────────────────────────┘
```

### Platform API Viability Matrix

| Platform | API Access | Auth | Cost | Rate Limit | Saved Content Endpoint |
|----------|-----------|------|------|------------|----------------------|
| **Reddit** | Full | OAuth 2.0 | Free (<100 QPM) | 100 req/min | `GET /user/{name}/saved` |
| **Spotify** | Full | OAuth 2.0 PKCE | Free | Rolling 30s window | `GET /v1/me/tracks`, `GET /v1/me/playlists` |
| **Pinterest** | Full | OAuth 2.0 | Free | Standard | `GET /v5/boards`, `GET /v5/boards/{id}/pins` |
| **YouTube** | Partial | OAuth 2.0 | Free (10K units/day) | Quota-based | Liked: yes, Watch Later: **NO** (since 2016) |
| **Pocket** | Full | Custom OAuth | Free | Standard | `GET /v3/get` |
| **Twitter/X** | Exists | OAuth 2.0 PKCE | **$200/mo minimum** | 180 req/15min | `GET /2/users/{id}/bookmarks` |
| **Instagram** | **None** | N/A | N/A | N/A | No saved posts endpoint |
| **TikTok** | Research only | OAuth 2.0 | Free (if approved) | Restricted | Research API only, no consumer access |
| **Google Keep** | Enterprise only | OAuth 2.0 | Workspace license | N/A | Locked to Google Workspace admin |
| **Google Maps** | **None** | N/A | N/A | N/A | No personal saved places endpoint |

### Browser Extension Technical Approach

**Network interception over DOM scraping**. Modern SPAs (Instagram, TikTok, Twitter) render with React and have constantly-changing class names. DOM scraping breaks on every deploy. Instead, the extension intercepts the platform's own internal API calls (GraphQL for Instagram, REST for TikTok) and captures the structured JSON before it reaches the DOM.

```
Manifest V3 Architecture:

content_script.js (runs in page context)
  │
  ├─ Injects page_interceptor.js via <script> tag
  │   └─ Monkey-patches window.fetch() and XMLHttpRequest
  │   └─ Filters for platform API URL patterns
  │   └─ Sends captured JSON via window.postMessage()
  │
  ├─ Receives postMessage, forwards via chrome.runtime.sendMessage()
  │
  └─ service_worker.js (background)
      └─ Batches captured items
      └─ Sends to ctrl.rodeo bulk-import endpoint via fetch()
```

**Why not just use the platform's API?**
- Instagram: API has no saved posts endpoint at all
- TikTok: API restricted to approved academic researchers
- Twitter/X: API works but costs $200/month — extension is free

### Shared OAuth Infrastructure with Phase 8

The `connected_accounts` table and OAuth flows built here are reused by [Phase 8 Epic 8.3 (Social Media Import)](./phase-8-automated-pins.md) for ongoing automated sync. The difference:
- **Phase 9**: one-time bulk pull ("import everything I've ever saved")
- **Phase 8**: ongoing incremental sync ("check for new saves every day")

Same tokens, same connection UI, different scheduling.

### Cost Considerations

Bulk import of 1,000 pins:
- AI categorization: ~$0.10 (domain cache makes repeat domains near-free)
- Image enrichment: ~$0.80 (most expensive — 1,000 scrape + search attempts)
- Vision AI for screenshots: ~$0.01/screenshot (if using Claude Haiku)
- OAuth API calls: free for all Tier 1 platforms
- **Total estimate for a typical import: $0.50-$2.00**

Domain profile caching is critical here — if someone imports 200 bookmarks and 50 are from youtube.com, only the first one triggers an AI classification call.

### Data Expiry Problem

Platform data exports and API responses include CDN URLs that expire:
- Instagram media URLs: ~48 hours
- Twitter image URLs: persistent but t.co links may rot
- TikTok thumbnails: variable

The import pipeline must download and re-host media assets during the import window, not just store the original CDN URL. Supabase Storage handles this.

---

*Last updated: 2026-02-07*
