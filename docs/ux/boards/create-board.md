# Create a Board

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go; Input shapes output
> **Key Personas:** Visual Collector (critical), Multidisciplinary Maker (critical), Deep-Dive Enthusiast (high)
>
> Back to [UX Index](./index.md)

User-created boards let people define their own named collections with an optional context prompt, then immediately seed them from their existing library using AI-ranked suggestions.

| Feature | Status | Notes |
|---------|--------|-------|
| Create Board Modal | ✅ Shipped | Name + optional context prompt |
| FAB Menu Entry Point | ✅ Shipped | "✦ Board" item in the floating action button menu |
| Filter Bar "+ Board" Button | ✅ Shipped | Dashed button always visible at end of filter bar |
| ✦ Prefix in Filter Bar | ✅ Shipped | User-created boards distinguished from AI categories |
| Board Sort Order | ✅ Shipped | Pinned AI → user boards → unpinned AI categories |
| Empty Board Visibility | ✅ Shipped | User boards visible at 0 pins (AI categories hide when empty) |
| Library Seed Panel | ✅ Shipped | Horizontal scroll cards with ranked suggestions from existing pins |
| TF-IDF Cosine Ranking | ✅ Shipped | Weighted TF-IDF + recency boost; legacy fallback for <10 pins |
| Add / Add All Actions | ✅ Shipped | Add individual or all suggested pins to the board |
| Seed Threshold Auto-Hide | ✅ Shipped | Suggestions hidden automatically once board reaches 5 pins |
| Dismiss Persistence | ✅ Shipped | Dismissed seed panel per board stored in localStorage |
| Board Persistence to Supabase | ✅ Shipped | Board metadata (name, prompt, pinned) survives reload + syncs cross-device |

---

## User Goals

- **Create a new collection quickly** without friction
- **Give the board intent** through a name and optional context prompt
- **Seed from what I already have** instead of starting from scratch
- **See AI-ranked suggestions** that match the board's theme
- **Have my boards survive reload** and appear on other devices

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Start a new project or theme | Create a named board in seconds | Begin organizing around a specific intent |
| Want to give AI context | Add a prompt to the new board | Get better-matched suggestions from my library |
| Create a new board | See pins from my library that fit | Quickly populate it without browsing manually |
| Browse the filter bar | Distinguish my boards from AI categories | Know at a glance which collections I created |
| Add several suggested pins | Use "Add All" | Seed the board in one action |
| Decide suggestions aren't useful | Dismiss the seed panel | Keep the view clean without being forced to engage |
| Come back later or use another device | See my boards exactly as I left them | Trust that my organization is durable |

---

## Wireframes

### Create Board Modal

```
┌──────────────────────────────────────────┐
│  New Board                          [X]  │
├──────────────────────────────────────────┤
│                                          │
│  Name                                    │
│  ┌──────────────────────────────────┐    │
│  │ e.g. Running Gear                │    │
│  └──────────────────────────────────┘    │
│                                          │
│  What's this board for? (optional)       │
│  ┌──────────────────────────────────┐    │
│  │ Training shoes, race outfits,    │    │
│  │ gear reviews...                  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │          Create Board            │    │
│  └──────────────────────────────────┘    │
│                                          │
└──────────────────────────────────────────┘
```

### Filter Bar with User Boards

```
┌─────────────────────────────────────────────────────────────┐
│  [Search...] [All] [Clothing] [Tech] [✦ Running] [+ Board]  │
└─────────────────────────────────────────────────────────────┘
                                   ↑
                        User-created board: ✦ prefix,
                        visible even at 0 pins
```

Sort order in filter bar:
```
[Pinned AI categories] → [User boards (✦)] → [Unpinned AI categories] → [+ Board]
```

### FAB Menu with Create Board

```
        ┌─────────────────┐
        │  ✦  New Board   │
        │  ▶  Upload Video│
        │  ⊙  Scan Image  │
        │  ◻  Photo       │
        │  +  Add Link    │
        └─────────────────┘
              [+]  ← FAB trigger
```

### Board Seed Panel (Library Suggestions)

Appears below the filter bar when viewing a new user-created board with fewer than 5 pins.

```
┌─────────────────────────────────────────────────────────────┐
│  From your library                                    [×]   │
├─────────────────────────────────────────────────────────────┤
│  ← ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│    │  [img]   │  │  [img]   │  │  [img]   │  │  [img]   │  │
│    │ Title    │  │ Title    │  │ Title    │  │ Title    │  │
│    │ domain   │  │ domain   │  │ domain   │  │ domain   │  │
│    │  [Add]   │  │  [Add]   │  │  [Add]   │  │  [Add]   │  │
│    └──────────┘  └──────────┘  └──────────┘  └──────────┘  →│
├─────────────────────────────────────────────────────────────┤
│                                          [ Add All ]        │
└─────────────────────────────────────────────────────────────┘
```

States:
```
Dismissed:                       Threshold reached (5+ pins):
Panel hidden, board visible      Panel hidden, board visible normally
as normal empty board            with its pinned content
```

---

## Board Data Model

User-created boards extend the category metadata object:

| Field | Type | Description |
|-------|------|-------------|
| `isUserBoard` | boolean | True for user-created boards |
| `displayName` | string | Preserved casing of the user-supplied name |
| `prompt` | string \| null | Optional context prompt for AI ranking |
| `createdAt` | ISO string | Timestamp of creation |
| `pinned` | boolean | Whether pinned to front of filter bar |

AI-generated categories omit `isUserBoard`, `displayName`, and `prompt`.

---

## TF-IDF Ranking Algorithm

Suggestions are ranked by cosine similarity between the board's intent vector and each pin's document vector.

**Query construction**: Board name (weighted 3x) + context prompt (1x), tokenized and lowercased.

**Pin document**: Title (3x weight), domain + category (2x), genres + tags (2x), description + summary (1x).

**Scoring**:
1. Compute IDF across entire library corpus (cached, invalidated on change)
2. Build TF-IDF vector for query
3. Build TF-IDF vector for each candidate pin (cached per pin)
4. Cosine similarity score (dot product / magnitude product)
5. Recency boost: 10% weight, exponential decay over 90-day half-life
6. Sort descending, return top 12 with score > 0.01

**Fallback**: For libraries with fewer than 10 pins, uses a legacy substring matcher (token overlap scoring across title, description, category, domain).

**Corpus stopwords**: Tokens appearing in more than 60% of documents are pruned before IDF computation.

---

## Known Extensions / Future States

### Short-term
- **Board prompt editing** — Edit the context prompt after creation
- **Board rename** — Rename a board from its settings
- **Board deletion** — Remove a user-created board (with confirm)

### Medium-term
- **AI subcategory boards** — Create boards from "Add Subcategories by Prompt" PRD
- **Re-run suggestions** — Refresh seed panel after adding more pins to library
- **Pinned board ordering** — Drag to reorder boards in filter bar

### Long-term
- **Board templates** — Start from a pre-defined collection intent
- **Smart boards** — Auto-populate based on ongoing rules (similar to the seed panel, but continuous)
- **Board sharing** — Share a user-created board with collaborators

---

## Technical Notes

- Category data model extended with `isUserBoard`, `displayName`, `prompt`, `createdAt` fields (`boards/index.html:12562`)
- `createCategory(name, opts)` creates the slug, initializes metadata, and calls `saveBoardMetadata()` (`boards/index.html:12562`)
- `saveBoardMetadata(categories)` upserts a `board_metadata` row per user (JSONB payload) to Supabase (`boards/index.html:11756`)
- Board metadata table: `supabase/migrations/019_board_metadata.sql` — one row per user, JSONB column, RLS enforced
- `fetchFromSupabase()` merges `board_metadata` onto reconstructed categories at load time, restoring user boards on reload and cross-device (`boards/index.html:12020`)
- Filter bar rendering: `✦ ${meta.displayName}` label applied when `meta.isUserBoard === true` (`boards/index.html:12930`)
- Filter sort order: pinned AI → user boards → unpinned AI by pin count (`boards/index.html:12911`)
- User boards visible at 0 pins: `counts[n] > 0 || meta.isUserBoard` condition in filter render (`boards/index.html:12910`)
- FAB menu entry: `#fabCreateBoard` button with ✦ icon (`boards/index.html:5462`)
- Filter bar "+ Board" button: `filter-token--new-board` CSS class, rendered after all categories (`boards/index.html:12936`)
- Create Board modal: `#createBoardModal` (`boards/index.html:6014`)
- Seed panel: `#boardSeedPanel` section with `#boardSeedBody`, `#boardSeedDismiss`, `#boardSeedAddAll` (`boards/index.html:5379`)
- `BOARD_SEED_THRESHOLD = 5` — seed panel hidden once board has 5+ pins (`boards/index.html:15808`)
- Dismissed state persisted per board slug in `localStorage` key `boards-seed-dismissed`
- TF-IDF ranker: `PinRanker` IIFE module (`boards/index.html:15636–15803`) — `rankPinsForBoard()`, `computeIDF()`, `tfidfVector()`, `cosineSimilarity()`, `getPinVector()`, `warmCache()`
- IDF cache invalidated when corpus size changes; pin vectors cached per `pin.id`
- Cache warm-up triggered via `requestIdleCallback` after data load
- `getLibrarySuggestions()` dispatches to TF-IDF ranker or legacy fallback (`boards/index.html:15856`)
