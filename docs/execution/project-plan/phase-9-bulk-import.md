# Phase 9: Bulk Import

> Back to [Project Plan](./index.md)

Solve the cold start problem. People arrive with years of saved content fractured across platforms that were never designed for retrieval — browser bookmark folders they haven't opened since 2019, Instagram saves that are just Reels of restaurant recs, Twitter bookmarks that are an unsorted graveyard. The content is valuable but the formats are hostile to access and organization.

This phase turns ctrl.rodeo into the place you consolidate your scattered digital life. Import everything, let AI organize it, and finally have one board that reflects what you actually care about.

**Supersedes**: [Phase 7 Epic 7.2: Import/Export](./phase-7-platform-expansion.md) (absorbed and expanded here)

**Prerequisite**: Partial Metadata Resilience (Epic 3.5 Story 1) — imported pins will frequently have incomplete metadata and need graceful handling.

---

## Epic 9.1: Import Infrastructure

The pipeline that all import sources flow through. Handles queuing, deduplication, bulk enrichment, and progress tracking regardless of where the data came from.

| Story | Tasks | Status |
|-------|-------|--------|
| **Import Job Model** | | Pending |
| | Create `import_jobs` table: `{ id, user_id, source, status, total_items, processed, enriched, failed, started_at, completed_at }` | Pending |
| | Job state machine: `queued → parsing → deduplicating → enriching → review → complete` | Pending |
| | RLS: users can only see their own import jobs | Pending |
| **Bulk Import Edge Function** | | Pending |
| | Create `bulk-import` edge function — accepts parsed items array or raw file upload | Pending |
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

## Epic 9.2: Structured File Imports

Platforms that export clean, parseable data — CSV, JSON, HTML. The easy wins.

| Story | Tasks | Status |
|-------|-------|--------|
| **Browser Bookmarks** | | Pending |
| | Parse Netscape Bookmark HTML format (Chrome, Firefox, Safari, Edge all use this) | Pending |
| | Preserve folder hierarchy → map to categories or tags | Pending |
| | Handle nested folders: flatten with breadcrumb context ("Tech > JavaScript > Frameworks") | Pending |
| | Import date preservation (ADD_DATE attribute → `addedAt`) | Pending |
| | Preview: show folder tree, let user select which folders to import | Pending |
| **Pocket** | | Pending |
| | Parse Pocket HTML export (`ril_export.html` from getpocket.com/export) | Pending |
| | Map Pocket tags → categories (AI-assisted for unmapped tags) | Pending |
| | Preserve read/unread status as pin metadata | Pending |
| **Instapaper** | | Pending |
| | Parse Instapaper CSV export (URL, Title, Selection, Folder) | Pending |
| | Map Instapaper folders → categories | Pending |
| | Preserve highlights/selections as pin notes | Pending |
| **Raindrop.io** | | Pending |
| | Parse Raindrop CSV export (or HTML) | Pending |
| | Map Raindrop collections → categories | Pending |
| | Preserve tags and notes | Pending |
| **Pinterest** | | Pending |
| | Parse Pinterest JSON data export (GDPR request: Settings > Privacy > Request data) | Pending |
| | Extract pin URLs, board names, descriptions | Pending |
| | Map Pinterest board names → categories | Pending |
| | Handle image-only pins (no source URL) → import as image pins | Pending |
| **Pinboard / del.icio.us** | | Pending |
| | Parse Pinboard JSON export | Pending |
| | Map tags → categories | Pending |
| | Preserve descriptions and toread flag | Pending |
| **Generic CSV / JSON** | | Pending |
| | Column mapping UI: "Which column is the URL? Title? Category?" | Pending |
| | Auto-detect columns by header name (url, link, title, name, category, tag, date) | Pending |
| | Preview first 10 rows before importing | Pending |

---

## Epic 9.3: Platform Data Exports

Using GDPR/data-download features platforms are legally required to provide. The data is technically accessible but buried in zip archives with weird structures.

| Story | Tasks | Status |
|-------|-------|--------|
| **Instagram Data Export** | | Pending |
| | Guide: how to request Instagram data download (Settings > Your Activity > Download Your Information) | Pending |
| | Parse `saved_posts.json` / `saved_media.json` from export zip | Pending |
| | Extract external URLs from captions (regex + NLP for "link in bio" references) | Pending |
| | Map Instagram post types: Reel → video pin, Photo → image pin, Carousel → multiple pins | Pending |
| | Handle expired CDN URLs (Instagram media URLs expire ~48h) — download and re-host during import window | Pending |
| | AI caption analysis: extract locations, brands, recommendations from post text | Pending |
| **Twitter/X Data Export** | | Pending |
| | Guide: how to request Twitter archive (Settings > Your Account > Download Archive) | Pending |
| | Parse `like.js` and `bookmark.js` from export archive | Pending |
| | Extract URLs from tweet text (t.co → resolve to real URL) | Pending |
| | Handle quote tweets: extract both the tweet URL and any URLs in the quoted content | Pending |
| | Thread detection: group tweet chains into single pins | Pending |
| **YouTube Takeout** | | Pending |
| | Guide: how to use Google Takeout for YouTube data | Pending |
| | Parse `watch-later.json`, `playlists/` from export | Pending |
| | Map playlist names → categories | Pending |
| | Extract video metadata: title, channel, duration, thumbnail URL | Pending |
| **Reddit Data Export** | | Pending |
| | Guide: how to request Reddit data (Settings > Request Your Data) | Pending |
| | Parse saved posts and comments from CSV | Pending |
| | Extract link posts as URL pins, text posts as note pins | Pending |
| | Subreddit → category mapping (AI-assisted) | Pending |
| **TikTok Data Export** | | Pending |
| | Guide: how to request TikTok data (Settings > Account > Download Your Data) | Pending |
| | Parse `Favorite Videos.json` from export | Pending |
| | AI analysis of video descriptions: extract product recs, restaurant names, locations | Pending |
| | Map creator name + description into structured pin metadata | Pending |
| **Google Takeout (Keep, Maps)** | | Pending |
| | Parse Google Keep notes: extract URLs, preserve note text as note pins | Pending |
| | Parse Google Maps Saved Places: extract place name, address, URL, category | Pending |
| | Map Google Maps labels (Want to Go, Favorites, Starred) → categories | Pending |
| **Apple Data** | | Pending |
| | Parse Safari Reading List from iCloud export (or `~/Library/Safari/Bookmarks.plist`) | Pending |
| | Parse Apple Notes export: extract URLs, preserve note content | Pending |
| | Parse Apple Maps favorites if available | Pending |

---

## Epic 9.4: AI-Powered Content Extraction

For the platforms where the data format is the problem. Content locked inside videos, screenshots, messages, and emails. AI does the heavy lifting to turn unstructured media into structured pins.

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
| **Social Media Profile Scan** | | Pending |
| | Enter an Instagram/TikTok/Twitter profile URL | Pending |
| | Scrape recent posts/bookmarks (public only, respecting robots.txt) | Pending |
| | AI analysis: "This account posts about fashion and food — here are the product/place links" | Pending |
| | Rate-limited, authenticated users only | Pending |

---

## Epic 9.5: Onboarding Import Flow

Make bulk import the first thing new users do. Don't show them an empty board — show them a path to populating it from sources they already have.

| Story | Tasks | Status |
|-------|-------|--------|
| **"Import Your Digital Life" Wizard** | | Pending |
| | First-run detection: if board is empty, show import wizard instead of empty state | Pending |
| | Platform grid: show logos for importable platforms (browser, Instagram, Twitter, Pocket, etc.) | Pending |
| | Difficulty indicators per platform: Easy (file upload), Medium (data request, ~24h wait), Hard (manual) | Pending |
| | Step-by-step guide per platform: screenshots showing exactly where to click to export | Pending |
| | "I'll do this later" skip option with reminder prompt after 3 manual pins | Pending |
| **Platform Export Guides** | | Pending |
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
| | Show past imports with source, date, count | Pending |
| | "Import more" button — always accessible | Pending |
| | Platform connection status: which exports are pending, which are done | Pending |

---

## Epic 9.6: Bulk Organization

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

---

## Architecture Notes

### Shared Infrastructure with Phase 8

Both phases use the same `ingest-pin` edge function and enrichment pipeline. The difference is volume and data quality:

```
Phase 8 (ongoing):     Source → ingest-pin → enrich → done
Phase 9 (bulk):        File/AI → parse → deduplicate → batch-ingest → batch-enrich → review
                                                         ↑
                                            import job orchestrator
                                            (rate limiting, progress, error handling)
```

### Cost Considerations

Bulk import of 1,000 pins:
- AI categorization: ~$0.10 (domain cache makes repeat domains near-free)
- Image enrichment: ~$0.80 (most expensive — 1,000 scrape + search attempts)
- Vision AI for screenshots: ~$0.01/screenshot (if using Claude Haiku)
- **Total estimate for a typical import: $0.50-$2.00**

Domain profile caching is critical here — if someone imports 200 bookmarks and 50 are from youtube.com, only the first one triggers an AI classification call.

### Data Expiry Problem

Platform data exports include CDN URLs that expire:
- Instagram media URLs: ~48 hours
- Twitter image URLs: persistent but t.co links may rot
- TikTok: variable

The import pipeline must download and re-host media assets during the import window, not just store the original CDN URL. Supabase Storage handles this.

---

*Last updated: 2026-02-07*
