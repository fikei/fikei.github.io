# Client-Side Architecture

> Structural map of boards/index.html and how the client app works

---

## Overview

The Boards app is a single-file monolith at `boards/index.html` (~9,100 lines). Everything is wrapped in an IIFE (`(function() { 'use strict'; ... })()`) that creates module scope without polluting globals. There's no build step, no bundler, no framework — vanilla JS with direct DOM manipulation.

---

## Structural Map

| Section | Lines | Purpose |
|---------|-------|---------|
| HTML + CSS | 1-3483 | Markup, styles, modals, layout |
| **IIFE Start** | **3484** | `(function() { 'use strict';` |
| Constants & Config | 3490-3517 | VERSION, Supabase URL/key, admin emails |
| Content Type System | 3519-3606 | BUILTIN_TYPES, domain cache, rule-based classification |
| AI Classification | 3608-3692 | `classifyByRules()`, `classifyByAI()`, `classifyContentType()` |
| Widget System | 3694-4680 | Widget registry, generation, feedback, rendering |
| Image Resolution | 5136-5370 | `processImageQueue()`, `resolveImage()`, platform resolvers |
| Enrichment Pipeline | 5377-5550 | `callEnrichmentAPI()`, `processEnrichmentQueue()` |
| URL Processing | 5581-5640 | `extractUrls()`, `normalizeUrl()`, `extractDomain()`, `generateId()` |
| Metadata Scraping | 5645-5772 | `fetchMetadata()`, CORS proxy logic |
| Category Patterns | 5774-5960 | PATTERNS object, `categorize()`, `smartCategorize()` |
| Genre Normalization | ~10916-10986 | `GENRE_NORMALIZE` map, `normalizeGenre()`, `resolveGenre()` |
| Sub-Tag System | ~11002-11268 | `SUB_TAGS` config, `detectTags()`, `renderSubTags()` |
| Tag Aggregation | ~11269-11325 | `computeLinkTags()` — unified `tags[]` builder |
| Board Metadata | ~11756-11796 | `saveBoardMetadata()` — fire-and-forget Supabase upsert |
| Storage Layer | 6110-6170 | `load()`, `save()`, `getAllLinks()`, `getCategories()`, auth token helpers |
| Supabase Sync | 6173-6390 | `syncLinkToSupabase()`, `fetchFromSupabase()`, `migrateLocalToSupabase()` |
| Link CRUD | 6393-6580 | `addLink()`, `updateLink()`, `deleteLink()`, `findByUrl()` |
| Rendering | 6588-7189 | `renderFilters()`, `renderSubTags()`, `renderGrid()` |
| Add Links Flow | 7020-7200 | Form submission, URL extraction, background enrichment |
| Share System | 8058-8380 | `loadAllShares()`, `createOrUpdateShare()`, share UI |
| Auth System | 8562-8735 | `handleLogin()`, `handleLogout()`, `onAuthStateChange()` |
| Boot Sequence | 8860-8959 | `init()` function |
| Event Listeners | 8960-9089 | Clipboard, paste, visibility, click handlers |
| **PinRanker Module** | **~15538-15803** | TF-IDF vector-space ranking IIFE |
| Board Seed Panel | ~15806+ | Library suggestions panel, `getLibrarySuggestions()` |
| **IIFE End** | **~17600** | `})()` |

---

## State Management

### Pattern

In-memory variables (IIFE scope) backed by localStorage, with async sync to Supabase. No reactive framework — state changes trigger manual re-renders.

```
User action → handler() → mutate state → save(data) → render*() → syncToSupabase()
```

### Global State Variables

| Variable | Type | Persisted | Purpose |
|----------|------|-----------|---------|
| `currentUser` | Object/null | Supabase auth | Logged-in user (id, email) |
| `isOnline` | boolean | Memory only | Connectivity status |
| `currentFilter` | string | localStorage | Active category filter |
| `domainProfileCache` | Object | localStorage | Domain → content type cache |
| `widgetCache` | Object | localStorage | Widget AI results |
| `widgetPrefs` | Object | localStorage | Favorites, dismissed, hidden widgets |
| `widgetFeedback` | Object | localStorage | User ratings and comments |
| `expandedCards` | Set | localStorage + Supabase | Expanded card IDs |
| `widgetRefreshCounters` | Object | Memory only | Per-widget variation counter |
| `widgetEventBuffer` | Array | localStorage | Instrumentation events |
| `syncInProgress` | boolean | Memory only | Prevents concurrent syncs |
| `PinRanker.idfCache` | Map | Memory only | IDF scores for current corpus |
| `PinRanker.pinDocCache` | Map | Memory only | pinId → tokenized token arrays |
| `PinRanker.pinVectorCache` | Map | Memory only | pinId → TF-IDF weight vectors |

### localStorage Keys

| Key | Contents |
|-----|----------|
| `things-i-like` | Core data: `{ links, categories, linkOrder }` |
| `sb-yfhudwakpgzswiylhfbh-auth-token` | Supabase auth session |
| `boards_filter` | Current category filter string |
| `boards_expanded` | Expanded card IDs |
| `boards_username` | Display name |
| `boards_domain_profiles` | Domain classification cache |
| `widget_cache` | Widget AI results (keyed by hash) |
| `widget_status` | Widget generation status |
| `widget_prefs` | Widget preferences (favorites, dismissed, hidden) |
| `widget_feedback` | User widget feedback |
| `widget_events` | Instrumentation event buffer |
| `pending_saves` | Offline queue for anonymous users |
| `boards-seed-dismissed` | Set of board slugs where seed panel was dismissed |

---

## Data Flow

### Read Path

```
User opens page
    │
    ▼
init() loads from localStorage     ◄── instant, offline-capable
    │
    ▼
renderFilters() + renderGrid()     ◄── immediate UI
    │
    ▼
[if logged in] fetchFromSupabase() ◄── background, async
    │
    ▼
merge cloud data → save() → re-render
```

### Write Path

```
User adds/edits/deletes a pin
    │
    ▼
addLink() / updateLink() / deleteLink()
    │
    ├── save(data) → localStorage      ◄── synchronous, instant
    │
    ├── renderGrid()                    ◄── re-render affected cards
    │
    └── syncLinkToSupabase()            ◄── async, fire-and-forget
        syncOrderToSupabase()               (silent failure)
```

---

## Rendering Pipeline

Three core render functions rebuild the DOM. No virtual DOM, no diffing — they replace innerHTML or rebuild element trees directly.

### renderFilters() (~L6588)

Builds the horizontal category filter bar. Reads from `getCategories()` and counts links per category. Attaches click handlers to filter tokens.

**Triggers**: init, link add/delete, category change, cloud sync

### renderSubTags() (~L6627)

Builds sub-category filters (content type badges within a category). Only visible when a category is selected.

**Triggers**: filter change

### renderGrid() (~L6706)

The main rendering function. Builds the card grid from filtered/sorted links.

For each link:
1. Create card element with image, title, domain, category badge
2. Apply expansion state (1x1, 2x2, 3x2 sizes)
3. Attach click handlers (expand, kebab menu, overlay actions)
4. Queue image resolution if image is missing

Accepts an optional `newIds` parameter to animate newly added cards.

**Triggers**: init, filter/search change, link CRUD, cloud sync, card expansion

---

## Boot Sequence

`init()` at ~L8860, called at ~L9065:

```
1.  Load saved theme from localStorage
2.  Get stored Supabase session (quick check)
3.  Process pending saves (anonymous user queue)
4.  Validate saved filter still exists in categories
5.  Render from localStorage (renderFilters, renderGrid)     ◄── first paint
6.  Initialize widget system
7.  Generate widgets for hero/footer zones
8.  Register service worker for PWA support                   ◄── offline + share target
9.  Register supabase.auth.onAuthStateChange() listener
10. Check URL hash for magic link callback
11. Check URL query params for deep link (?add=URL)           ◄── handle PWA shares
12. Get session from Supabase
13. [if logged in] Fetch cloud data → merge → re-render       ◄── second paint
14. Process pending saves to Supabase
15. Re-categorize any uncategorized items
16. Check clipboard for URLs
17. Start 30s polling for cross-device sync
```

---

## Event System

No event bus or pub/sub. Direct DOM event listeners attached during init and render.

### Input Events

| Event | Element | Handler |
|-------|---------|---------|
| Auth form submit | `authForm` | `handleLogin()` |
| Add links form submit | `addForm` | URL extraction + enrichment pipeline |
| Search input | `searchInput` | Debounced filter + re-render |
| Filter token click | `.filter-token` | Set `currentFilter`, re-render |
| Card click | `.card` | Toggle expansion |
| Kebab menu click | `.kebab-btn` | Show context menu |
| Paste | `document` | Check for URLs, offer to add |
| Visibility change | `document` | Check clipboard on tab focus |
| Deep link | `?add=URL` param | Auto-open add modal with URL pre-filled |
| PWA share | Share sheet → share_target | Redirect to `?add=URL` |

### Side Effects

State changes don't propagate automatically. Each handler is responsible for:
1. Updating in-memory state
2. Calling `save(data)` for localStorage
3. Calling the appropriate `render*()` function
4. Calling the appropriate `sync*ToSupabase()` function

---

## Module-Like Boundaries

While there's no formal module system, the code is organized into logical groups that could be extracted:

| Would-be Module | Functions | Dependencies |
|----------------|-----------|-------------|
| **Storage** | `load()`, `save()`, `getAllLinks()`, `getCategories()` | localStorage |
| **Sync** | `syncLinkToSupabase()`, `fetchFromSupabase()`, `migrateLocalToSupabase()` | Storage, Auth |
| **Auth** | `handleLogin()`, `handleLogout()`, `onAuthStateChange()`, `getAccessToken()` | Supabase client |
| **Enrichment** | `fetchMetadata()`, `callEnrichmentAPI()`, `processEnrichmentQueue()` | CORS proxies, Supabase functions |
| **Classification** | `classifyByRules()`, `classifyByAI()`, `smartCategorize()`, `categorize()` | Anthropic API, PATTERNS |
| **Widgets** | Widget registry, generation, rendering, feedback, caching | Claude API, Storage |
| **Rendering** | `renderFilters()`, `renderSubTags()`, `renderGrid()` | Storage, DOM |
| **Link CRUD** | `addLink()`, `updateLink()`, `deleteLink()`, `findByUrl()` | Storage, Sync, Rendering |

---

## Public API (Window Functions)

These functions are exposed on `window` for use in inline event handlers on dynamically rendered HTML:

```
toggleWidgetFavorite(widgetId)
dismissWidget(widgetId)
hideWidget(widgetId)
restoreDismissedWidget(widgetId)
unhideWidget(widgetId)
rateWidget(widgetId, rating)
submitWidgetFeedback(widgetId)
setWidgetPreferences(prefs)
exportWidgetFeedback()
```

---

## PinRanker Module

The `PinRanker` module (`boards/index.html` ~L15538) is a self-contained IIFE that provides TF-IDF vector-space ranking for the "Create a Board" library suggestion feature. It scores pins from across the user's entire library against a board's name and prompt to surface the most relevant candidates.

### Architecture

```
Board name + prompt
    │
    ▼
tokenize() → queryTokens[]
    │
    ▼
tfidfVector(queryTokens, idf) → queryVec (Map<token, weight>)
    │                                   ▲
    │                                   │
    ├── For each candidate pin:          computeIDF(allPins) ← IDF cache (memory)
    │       buildPinDocument(pin)        └── df per token across corpus
    │       tokenize(doc) → tokens[]         IDF = log((N+1)/(df+1)) + 1
    │       tfidfVector(tokens, idf)         Prune: >60% docs OR <2 docs
    │       → pinVec
    │
    ▼
cosineSimilarity(queryVec, pinVec)
    │   dot(A,B) / (|A| × |B|)
    │
    └── + recency boost (10% weight, e^(-days/90) decay)
    │
    ▼
ranked pins[] sorted by score, filtered > 0.01
```

### Functions

#### `tokenize(text)`

Converts raw text to a normalized token array. Strips URLs (`https?://...`), collapses punctuation (hyphens preserved for genre tokens like `hip-hop`), filters:
- Tokens shorter than 3 characters
- Tokens in `BOARD_STOPWORDS` (union of web noise + common English words)
- Pure numbers

#### `buildPinDocument(pin)`

Constructs a weighted text representation of a pin for TF-IDF indexing. Field weights are implemented via text repetition (repeating a field N times gives its tokens N× the TF score):

| Field | Weight | Notes |
|-------|--------|-------|
| `title` | 3x | Highest signal |
| `domain` (cleaned) | 2x | Brand signal; strips TLD |
| `category` | 2x | |
| `tags[]` | 2x | Unified tags: genres, sub-categories, content types |
| `video.genres`, `video.creator`, `video.keywords` | 2x | |
| `music.artist` | 3x | |
| `music.genre`, `music.genreTags` | 2x | |
| `book.author`, `book.genre` | 2x | |
| `content_type` | 1x | |
| `description`, `video.summary`, `book.summary` | 1x | |
| `video.tags` (top 10), `video.type` | 1x | |

#### `computeIDF(pins)`

Computes corpus-wide Inverse Document Frequency scores with in-memory caching. Invalidated when the corpus size changes (new pin added or deleted).

- **Formula**: `IDF(t) = log((N + 1) / (df(t) + 1)) + 1` (smoothed)
- **Pruning rules**:
  - Tokens appearing in > 60% of documents: too common, pruned
  - Tokens appearing in < 2 documents: too rare, pruned
- **Cache invalidation**: `idfCorpusSize` is compared on each call; mismatch triggers full recompute. Also invalidated explicitly by `save()` when the link list changes.

#### `cosineSimilarity(vecA, vecB)`

Standard dot-product cosine: `A · B / (|A| × |B|)`. Returns 0 for zero-magnitude vectors.

#### `rankPinsForBoard(boardSlug, allLinks, categories, limit = 12)`

Main entry point. Builds the query vector from the board's `displayName` (3x) + `prompt` (1x), then scores all pins not already on the target board. Pins in `loading` state or `uncategorized` are excluded from candidates.

**Recency boost**: 10% of final score is a recency signal — exponential decay `e^(-ageDays / 90)` — so pins added in the last 90 days rank slightly higher at equal cosine scores.

**Fallback**: For corpora with fewer than 10 pins, the legacy substring matcher (`getLibrarySuggestionsLegacy()`) is used instead.

#### `warmCache(allLinks)`

Schedules a background IDF precompute via `requestIdleCallback` so the first user-initiated ranking call returns instantly. Only runs if corpus has 10+ pins. Called once during `init()`.

#### `invalidateCache()`

Clears all three in-memory caches (`idfCache`, `pinDocCache`, `pinVectorCache`) and removes any persisted IDF data from localStorage. Called automatically by `save()` when the link corpus changes.

### Public API

```javascript
PinRanker.rankPinsForBoard(boardSlug, allLinks, categories, limit)  // → Link[]
PinRanker.warmCache(allLinks)                                        // → void
PinRanker.invalidateCache()                                          // → void
PinRanker.tokenize(text)                                             // → string[] (for testing)
PinRanker.buildPinDocument(pin)                                      // → string (for testing)
```

---

## Genre Normalization

The `GENRE_NORMALIZE` map (`boards/index.html` ~L10917) is a shared lookup table used by PinRanker, `detectTags()`, and `computeLinkTags()` to normalize raw genre strings from AI enrichment into consistent tokens.

### Design Principles

- **Video genres**: Many-to-one normalization — synonyms and TMDB genre names roll up to canonical tokens (e.g., `"science fiction"` → `"sci-fi"`, `"biographical"` → `"documentary"`). Coverage: 19 expanded genre mappings added in PR #143.
- **Music genres**: Synonym-only normalization — only normalizes spelling variants and spacing to a canonical hyphenated form (e.g., `"hip hop"` → `"hip-hop"`, `"drum and bass"` → `"dnb"`). Sub-genres are **not** rolled up to parent genres — `"death-metal"` stays `"death-metal"`, not `"metal"`. This preserves ranking precision. Coverage: 22 music genre synonym mappings added in PR #143.

### `normalizeGenre(raw)`

Lowercases and trims the input, then looks it up in `GENRE_NORMALIZE`. Returns the canonical form if found, or the lowercased original if no mapping exists — unknown genres are preserved rather than discarded.

```javascript
normalizeGenre('Science Fiction')  // → 'sci-fi'
normalizeGenre('drum and bass')    // → 'dnb'
normalizeGenre('hyperpop')         // → 'hyperpop'  (no mapping, kept as-is)
normalizeGenre(null)               // → null
```

### `resolveGenre(link)`

Tries each entry in `link.video.genres[]` in order, returning the first non-null normalized result. Falls back to `link.video.genre` (singular). Used for display in sub-tag filters.

---

## Unified Tags System

`computeLinkTags(link)` (`boards/index.html` ~L11269) aggregates all genre, sub-category, and content-type signals from a pin into a single flat `TEXT[]` array. This array is:

1. **Persisted** to the `links.tags` column in Supabase (via `syncLinkToSupabase()`, `updateLink()`, and enrichment merge)
2. **Indexed** with a GIN index for server-side array queries (`tags @> ARRAY['thriller']`)
3. **Used by PinRanker** as a 2x-weighted field in `buildPinDocument()`

### Sources Aggregated

| Source | Fields |
|--------|--------|
| Content type | `link.content_type` |
| SUB_TAGS sub-category | `detectTags(link)` → all dimension values |
| Video genres | `link.video.genres[]`, `link.video.genre` (normalized) |
| Video type | `link.video.type` |
| YouTube tags | `link.video.tags[]` (first 10, min 3 chars) |
| Music genre | `link.music.genre` (normalized) |
| Music genre tags | `link.music.genreTags[]` (normalized) |
| Music content format | `link.music.contentFormat` |
| Book genre | `link.book.genre` (lowercased) |
| Book format | `link.book.format` |

### When Computed

- **Enrichment merge** (`processEnrichmentQueue` result handler, ~L10328): when AI enrichment data arrives for a pin
- **`updateLink()`** (~L10368): on any manual pin update
- **`syncLinkToSupabase()`** (~L11892): included in every cloud sync payload
- **Full fetch merge** (`fetchFromSupabase()`, ~L12534): backfills tags for existing pins on full cloud sync

---

## Board Metadata Persistence

`saveBoardMetadata(categories)` (`boards/index.html` ~L11756) persists user-created board properties to the `board_metadata` Supabase table so boards survive page reload and sync across devices.

### Pattern

Follows the same fire-and-forget upsert pattern as `saveExpandedCards()`:

```javascript
saveBoardMetadata(categories)
  └── filter categories → only boards with { isUserBoard, displayName, or prompt }
  └── POST board_metadata with Prefer: resolution=merge-duplicates
  └── fire-and-forget (errors logged, not surfaced to user)
```

### Persisted Fields Per Board

```json
{
  "my-board-slug": {
    "isUserBoard": true,
    "displayName": "Street Photography",
    "prompt": "urban, candid, black and white",
    "createdAt": "2026-02-20T...",
    "pinned": false
  }
}
```

### Read Path

`fetchFromSupabase()` fetches `board_metadata` in parallel with links. On merge, saved metadata is applied onto reconstructed category objects, restoring `isUserBoard`, `displayName`, `prompt`, and `pinned` state. Empty boards (no pins yet) survive reload because their metadata is preserved independently of the pin list.

---

## PWA Infrastructure

Boards is a Progressive Web App with offline support, installability, and native share sheet integration.

### Service Worker (`boards/sw.js`)

Registered during `init()` at ~L11714. Provides:
- **Offline support**: Cache-first strategy for core pages (`/boards/`, `/boards/index.html`, `/boards/pwa-share.html`)
- **Installability**: Meets PWA criteria (manifest, HTTPS, service worker, display mode)
- **Share target handling**: Intercepts OS-level shares and routes to the share landing page

**Cache strategy**:
- HTML navigation: Network-first with cache fallback (stay current, work offline)
- Other requests: Network-only (don't cache API calls or dynamic content)

**Version**: `boards-v1` — increment cache name to force refresh on deploy

### Web App Manifest (`images/icons/favicons/site.webmanifest`)

Linked in `<head>` at ~L11. Defines:
- **Identity**: "Boards — ctrl.rodeo" with black theme
- **Icons**: 192x192 and 512x512 PNG icons for home screen
- **Display mode**: `standalone` (hides browser chrome when installed)
- **Start URL**: `/boards/` (open to main app on launch)
- **Share target**: OS share sheet → `/boards/pwa-share.html?url=...&text=...&title=...`

### Share Target Flow

```
User shares URL from another app (Safari, Chrome, social media)
    │
    ▼
OS invokes share_target action
    │
    ▼
GET /boards/pwa-share.html?url={url}&text={text}&title={title}
    │
    ▼
pwa-share.html extracts URL from params (priority: url > text > title)
    │
    ▼
JavaScript redirect: window.location.replace('/boards/?add=' + encodeURIComponent(url))
    │
    ▼
Main app init() detects ?add=URL query param
    │
    ▼
Auto-open add modal with URL pre-filled
    │
    ▼
URL cleaned from address bar (replaces state to hide query param)
```

**Why the intermediate page?** The share_target action must be a GET request to a static page. We can't directly open the main app with `start_url` params because the manifest's `start_url` is fixed. So `pwa-share.html` acts as a thin redirect layer that normalizes the shared data and forwards to the main app.

### Deep Link Handler

Query param support added to `init()` at ~L11751:

```javascript
const urlParams = new URLSearchParams(window.location.search);
const addUrl = urlParams.get('add');
if (addUrl) {
  // Auto-open add modal with URL
  // Clean URL bar: window.history.replaceState({}, '', cleanLocation)
}
```

**Use cases**:
1. **PWA share target**: `?add=https://example.com` (from OS share sheet)
2. **Bookmarklet**: `javascript:void(window.location='https://ctrl.rodeo/boards/?add='+encodeURIComponent(window.location.href))`
3. **Share link**: Manual URL like `https://ctrl.rodeo/boards/?add=https://example.com`

All three produce the same result: the add modal opens with the URL pre-filled and ready to save.

---

*Last updated: 2026-02-23*
