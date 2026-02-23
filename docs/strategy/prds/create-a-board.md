# PRD: Create a Board

**Version:** 1.0
**Date:** 2026-02-23
**Status:** Draft

---

## Overview

Currently, categories in Boards emerge automatically from AI classification — users don't create them. "Create a Board" introduces an explicit, user-initiated way to create a board (category) with a title and optional prompt that guides what belongs in it. Once created, the system suggests relevant pins from the user's existing library and from the internet, making it easy to populate a new board immediately. User-created boards are visually distinguished from AI-generated ones in tab navigation.

This complements the existing emergent categorization system by giving users a top-down organizational tool. Instead of waiting for the AI to notice a pattern, users can declare intent: "I want a board for X" and the system helps fill it.

---

## Goals

1. Let users create purpose-driven boards that reflect how they think, not just what the AI detects
2. Surface relevant existing pins that belong in a new board, reducing manual re-categorization
3. Provide internet-sourced suggestions to seed new boards with fresh content
4. Visually distinguish user-created boards from AI-generated categories
5. Keep suggestions private — shared board viewers should never see suggestion surfaces

---

## Who This Serves

### Primary Personas

| Persona | Why This Matters |
|---------|-----------------|
| **The Visual Collector** | Wants to curate boards like "Spring Lookbook" or "Brutalist Interiors" — specific themes that don't map to generic categories like `wear` or `home`. Manual board creation gives full creative control. |
| **The Multidisciplinary Maker** | Needs project-specific boards — "Client X Moodboard", "Studio Renovation" — that cut across existing categories. A prompt like "furniture, lighting, and layout inspiration for a small studio" tells the system exactly what to suggest. |
| **The DJ** | Creates set-planning boards — "Summer Festival Set", "Deep Cuts for Vinyl Night" — and wants the system to surface relevant tracks from their library and discover new ones from the internet. |

### Secondary Personas

| Persona | Why This Matters |
|---------|-----------------|
| **The Deep-Dive Enthusiast** | Creates boards for ongoing research — "Japanese Denim", "Mechanical Keyboards" — and benefits from internet suggestions that expand their knowledge. |
| **The Cultural Omnivore** | Curates boards around themes — "Things That Feel Like Autumn", "Design I'd Steal" — that span content types. Prompt-guided suggestions surface connections they wouldn't find manually. |

### Jobs To Be Done

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Have a new interest or project | Create a board with a clear name | Organize content intentionally from the start |
| Create a board with a specific focus | Describe what belongs in it via prompt | Get smarter suggestions without manual sorting |
| See pins suggested from my library | Add them individually or all at once | Quickly populate the board without re-browsing everything |
| Want to discover new content for a board | Browse internet suggestions | Expand my collection with relevant finds |
| Share a board I created | Know that suggestions are hidden | Keep my curation process private |
| See my boards in navigation | Distinguish ones I made from auto-generated | Understand my board landscape at a glance |

---

## Design Principles

| Brand Principle | Application |
|-----------------|-------------|
| **Input shapes output** | The user's prompt is input; suggested pins are output. The system connects what you already saved to what you're now building. |
| **Organize as you go** | Creating a board isn't a chore — it's a quick declaration of intent. The system does the heavy lifting of finding what fits. |
| **One place, whole life** | Boards cut across existing categories. A "Gift Ideas" board can pull from `wear`, `use`, `eat`, and `read`. |
| **Show, don't decorate** | The creation flow is minimal — title, optional prompt, done. Suggestions surface below without cluttering the creation step. |
| **Expand with the user** | Simple boards need only a title. Power users can add prompts for smarter suggestions. Complexity is opt-in. |

---

## Core Features

### 1. Board Creation

**What it is:** A flow to create a new board with a title and optional descriptive prompt.

**Entry point:** A `[+]` button in the category/tab navigation bar, positioned after the last category token.

**Creation flow:**

```
┌─────────────────────────────────────────────┐
│  Create Board                         [X]   │
├─────────────────────────────────────────────┤
│                                             │
│  Name                                       │
│  ┌─────────────────────────────────────┐    │
│  │ Gift Ideas for Mom                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Describe what belongs here (optional)      │
│  ┌─────────────────────────────────────┐    │
│  │ Thoughtful gifts — skincare, books, │    │
│  │ kitchenware, experiences she'd love │    │
│  └─────────────────────────────────────┘    │
│                                             │
│                    [Cancel]  [Create]        │
│                                             │
└─────────────────────────────────────────────┘
```

**Behavior:**

- **Name** is required. Must be unique across the user's boards. 1-50 characters.
- **Prompt** is optional. Free-text description that guides suggestion ranking. Up to 200 characters.
- On submit: board is created immediately and becomes the active filter. The grid is empty (no pins yet). Suggestions load below.
- The board slug is derived from the name: lowercased, spaces replaced with hyphens, special characters stripped. Collisions append a numeric suffix.
- If the name matches an existing AI-generated category exactly, the user is prompted: "A category named [X] already exists. Use it instead?" with options to use existing or create a new board with a modified name.

**Data model additions:**

```
Board metadata stored in categories object:
{
  "gift-ideas-for-mom": {
    "pinned": false,
    "user_created": true,
    "display_name": "Gift Ideas for Mom",
    "prompt": "Thoughtful gifts — skincare, books, kitchenware, experiences she'd love",
    "created_at": "2026-02-23T12:00:00Z"
  }
}
```

New fields on category metadata:
- `user_created` (boolean) — `true` for user-created boards, absent/`false` for AI-generated
- `display_name` (string) — preserves original casing and spacing (slug is the key)
- `prompt` (string, optional) — guides suggestion ranking

---

### 2. Library Suggestions

**What it is:** After creating a board, the system scans the user's existing pins and suggests ones that match the board's name and prompt.

**Display:**

```
┌─────────────────────────────────────────────────────┐
│  YOUR PINS                                          │
│                                                     │
│  From your library                    [Add All (8)] │
│  ────────────────────────────────────────────────── │
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │  [img]  │  │  [img]  │  │  [img]  │             │
│  │ Title   │  │ Title   │  │ Title   │  ...        │
│  │ domain  │  │ domain  │  │ domain  │             │
│  │  [Add]  │  │  [Add]  │  │  [Add]  │             │
│  └─────────┘  └─────────┘  └─────────┘             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Behavior:**

- Appears below the (empty) grid when viewing a user-created board
- Scans all user pins across all categories
- Ranks by relevance to the board's name + prompt using string matching and, when available, the AI categorization signals stored on each pin
- Shows up to 20 suggestions in a horizontal scrollable row or responsive grid
- Each suggestion shows the pin card (image, title, domain) with an `[Add]` button
- `[Add]` moves the pin from its current category to this board. The pin disappears from the suggestion row with a subtle animation.
- `[Add All]` moves all suggested pins at once. Shows a confirmation count: "Move 8 pins to Gift Ideas for Mom?"
- Moving a pin updates its `category` field — it leaves the old category
- Suggestions are recomputed on each board view (not cached), so they reflect the current library state
- If no suggestions match, show: "No matching pins in your library yet."
- Suggestions disappear once the board has 5+ pins (the board is considered "seeded")

**Ranking algorithm:**

1. Exact title/description match against board name and prompt keywords (highest)
2. Domain match (e.g., board prompt mentions "skincare" and pin is from sephora.com)
3. Category affinity (e.g., prompt mentions "books" and pin is in `read` category)
4. Recency (newer pins ranked higher among equal relevance)

---

### 3. Internet Suggestions

**What it is:** AI-powered suggestions of content from the internet that matches the board's name and prompt.

**Display:**

```
┌─────────────────────────────────────────────────────┐
│  FROM THE INTERNET                                  │
│                                                     │
│  Suggestions for "Gift Ideas for Mom" [Add All (6)] │
│  ────────────────────────────────────────────────── │
│                                                     │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │  [img]  │  │  [img]  │  │  [img]  │             │
│  │ Title   │  │ Title   │  │ Title   │  ...        │
│  │ domain  │  │ domain  │  │ domain  │             │
│  │  [Add]  │  │  [Add]  │  │  [Add]  │             │
│  └─────────┘  └─────────┘  └─────────┘             │
│                                                     │
│  [Refresh suggestions]                              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Behavior:**

- Appears below Library Suggestions
- Uses the board's name and prompt to generate a search/recommendation request
- Powered by the existing AI infrastructure (Claude Haiku via `generate-widget` edge function or a new dedicated function)
- Returns 6-12 suggested links with title, URL, description, and image
- Each suggestion looks like a pin card with an `[Add]` button
- `[Add]` creates a new pin from the internet suggestion — runs it through the standard enrichment pipeline (`enrich-link`) before adding to the board
- `[Add All]` adds all internet suggestions as new pins. Shows confirmation: "Add 6 new pins to Gift Ideas for Mom?"
- `[Refresh]` generates a new set of suggestions (rate-limited: max 3 refreshes per board per session)
- Internet suggestions are cached for 1 hour per board to avoid redundant AI calls
- If the board has no prompt, suggestions are based solely on the board name
- If the AI returns no suggestions (e.g., ambiguous name, no prompt), show: "Add a description to get smarter suggestions."

**Duplicate handling:**

- Internet suggestions are checked against the user's entire library (not just this board)
- If a suggested URL already exists as a pin, it's excluded from internet suggestions and may appear in library suggestions instead

---

### 4. Suggestion Visibility Rules

**What it is:** Suggestions (both library and internet) are private — they only appear for the board owner.

**Rules:**

| Context | Library Suggestions | Internet Suggestions |
|---------|-------------------|---------------------|
| Owner viewing own board | Visible | Visible |
| Shared board (link/public) | Hidden | Hidden |
| Collaborative board (future) | Hidden | Hidden |
| Board has 5+ pins | Hidden (seeded) | Still visible |

**Why:** Suggestions are a creation tool, not a presentation feature. Viewers of a shared board should see the curated result, not the raw suggestions the AI offered. Showing suggestions on shared boards would also leak information about what the owner hasn't added yet, which feels like exposing drafts.

---

### 5. Creator Indicator in Navigation

**What it is:** User-created boards are visually distinguished from AI-generated categories in the tab bar.

**Display:**

```
Category navigation:
[All] [Wear] [Watch] [Listen] [✦ Gift Ideas] [✦ Studio Reno] [⚑ Review (3)]
                                ↑               ↑
                          User-created boards (✦ prefix)
```

**Behavior:**

- User-created boards display with a `✦` prefix (or similar subtle indicator) in the filter token
- The indicator is purely visual — it doesn't affect filtering behavior
- User-created boards are sorted after AI-generated categories, ordered by creation date (newest last)
- If a user-created board is empty (0 pins), it still appears in navigation (unlike AI categories which hide when empty)
- The `✦` indicator uses the same color as the token text — no accent colors

**CSS class:** `filter-token--user-created`

**Alternative indicators considered:**

| Option | Pros | Cons |
|--------|------|------|
| `✦` prefix | Subtle, scannable | Slightly increases token width |
| Underline/border style | No text change | Easy to miss |
| Different font weight | Minimal | Hard to distinguish at small sizes |
| Icon after name | Clear | Too busy with many boards |

**Recommendation:** `✦` prefix — minimal, clear, and consistent with the typographic-first design language.

---

## User Flows

### Flow 1: Create and Populate Board

```
1. User taps [+] in category navigation
2. "Create Board" modal opens
3. User types name: "Studio Renovation"
4. User adds prompt: "furniture, lighting, layout inspo for a small creative studio"
5. Taps [Create]
6. Board created, filter switches to "Studio Renovation"
7. Grid is empty
8. Below grid: "From your library" shows 5 matching pins (an IKEA desk, a lamp, etc.)
9. User taps [Add] on 3 of them — pins move to this board
10. Below that: "From the internet" shows 8 suggestions
11. User taps [Add] on 2 — they're enriched and added as new pins
12. User now has 5 pins in "Studio Renovation"
13. Library suggestions section disappears (5+ pins = seeded)
14. Internet suggestions remain available for future visits
```

### Flow 2: Quick Board (No Prompt)

```
1. User taps [+]
2. Types name: "Wishlist"
3. Leaves prompt empty
4. Taps [Create]
5. Board created — library suggestions based on name alone
6. "From the internet" shows: "Add a description to get smarter suggestions."
7. User can add a prompt later via board settings
```

### Flow 3: Shared Board Viewing

```
1. Owner creates "Best of 2026" board with prompt and suggestions
2. Owner adds 12 pins from suggestions + manual adds
3. Owner shares the board via share link
4. Viewer opens share link
5. Viewer sees 12 curated pins — no suggestion sections visible
6. Viewer has no indication that suggestions were used to build the board
```

### Flow 4: Name Collision with AI Category

```
1. User taps [+]
2. Types name: "Watch" (which already exists as AI category)
3. System shows: "A category named 'Watch' already exists. Use it instead?"
4. Options: [Use Existing] or [Create "My Watch"]
5. If "Use Existing": navigates to watch category, no new board created
6. If "Create 'My Watch'": creates user board "My Watch" as separate board
```

---

## Data Model

### Changes to Category Metadata

The existing `categories` object in localStorage gains new optional fields for user-created boards:

```javascript
// Existing AI-generated category
{
  "wear": {
    "pinned": false
  }
}

// New user-created board
{
  "studio-renovation": {
    "pinned": false,
    "user_created": true,
    "display_name": "Studio Renovation",
    "prompt": "furniture, lighting, layout inspo for a small creative studio",
    "created_at": "2026-02-23T12:00:00Z"
  }
}
```

### Supabase Schema Changes

No new tables required. New columns on the `links` table's associated category metadata (or a new `user_boards` table if the categories object grows too large for localStorage):

**Option A: Extend localStorage categories (MVP)**

- Categories object already supports arbitrary keys
- Add `user_created`, `display_name`, `prompt`, `created_at` fields
- Sync to Supabase via existing category sync mechanism

**Option B: New `user_boards` table (if scaling requires it)**

```sql
CREATE TABLE user_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  slug VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, slug)
);

CREATE INDEX idx_user_boards_user ON user_boards(user_id);
```

**Recommendation:** Start with Option A for MVP. The categories object is small and localStorage can handle dozens of boards. Migrate to Option B when multi-device sync or 50+ boards becomes a real use case.

### Internet Suggestion Cache

```javascript
// sessionStorage key: `board-suggestions-${slug}`
{
  "board_slug": "gift-ideas-for-mom",
  "suggestions": [...],
  "generated_at": "2026-02-23T12:05:00Z",
  "refresh_count": 1
}
```

---

## Technical Architecture

### Suggestion Ranking (Library)

Client-side function — no API call needed:

```javascript
function suggestFromLibrary(allLinks, boardName, boardPrompt, boardSlug) {
  const keywords = extractKeywords(boardName + ' ' + (boardPrompt || ''));

  return allLinks
    .filter(link => link.category !== boardSlug) // Don't suggest pins already in this board
    .map(link => ({
      link,
      score: computeRelevance(link, keywords)
    }))
    .filter(({ score }) => score > 0.2) // Minimum relevance threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map(({ link }) => link);
}

function computeRelevance(link, keywords) {
  let score = 0;
  const text = `${link.title} ${link.description || ''} ${link.domain}`.toLowerCase();

  for (const kw of keywords) {
    if (text.includes(kw)) score += 0.3;
    if (link.title?.toLowerCase().includes(kw)) score += 0.2; // Title match bonus
  }

  // Recency boost (last 30 days)
  const age = Date.now() - new Date(link.addedAt).getTime();
  if (age < 30 * 24 * 60 * 60 * 1000) score += 0.1;

  return Math.min(score, 1.0);
}
```

### Internet Suggestions (AI-Powered)

Uses the existing edge function infrastructure. Either extend `generate-widget` or create a new `suggest-for-board` function:

```
Client request:
POST /functions/v1/suggest-for-board
{
  "board_name": "Gift Ideas for Mom",
  "prompt": "Thoughtful gifts — skincare, books, kitchenware, experiences she'd love",
  "exclude_domains": ["already-saved.com"],
  "count": 8
}

Response:
{
  "suggestions": [
    {
      "url": "https://example.com/gift",
      "title": "The 25 Best Gifts for Mom in 2026",
      "description": "Curated gift guide...",
      "image": "https://example.com/image.jpg",
      "relevance_note": "Skincare and kitchenware gifts"
    },
    ...
  ]
}
```

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Board creation | < 500ms (local storage write + render) |
| Library suggestions | < 200ms (client-side computation on 1,000 pins) |
| Internet suggestions | < 3s (AI generation + response) |
| Board name validation | Instant (on-keystroke uniqueness check) |
| Suggestion rendering | Lazy-loaded images, skeleton cards during load |
| Offline support | Board creation works offline; internet suggestions require network |

---

## Implementation Phases

### Phase 1: Board Creation + Navigation
- [ ] `[+]` button in category navigation
- [ ] Create board modal (name + prompt)
- [ ] Category metadata extension (`user_created`, `display_name`, `prompt`)
- [ ] `✦` indicator in filter tokens for user-created boards
- [ ] Empty state for new boards
- [ ] Name collision detection

### Phase 2: Library Suggestions
- [ ] `suggestFromLibrary` ranking function
- [ ] Suggestion row UI below grid
- [ ] `[Add]` individual pin to board
- [ ] `[Add All]` bulk move with confirmation
- [ ] Seeding threshold (hide after 5+ pins)

### Phase 3: Internet Suggestions
- [ ] `suggest-for-board` edge function (or extend `generate-widget`)
- [ ] Internet suggestion row UI
- [ ] `[Add]` with enrichment pipeline
- [ ] `[Add All]` bulk add with enrichment
- [ ] Session cache + refresh limit
- [ ] Fallback messaging when no prompt provided

### Phase 4: Sharing Integration
- [ ] Hide suggestion sections on shared board views
- [ ] Hide suggestions on collaborative board views
- [ ] Ensure `✦` indicator appears correctly on shared boards

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| User creates board with same name as AI category | Prompt to use existing or create with modified name |
| User deletes all pins from a user-created board | Board persists (unlike AI categories that auto-hide at 0 pins) |
| Internet suggestion is a duplicate of existing pin | Excluded from internet suggestions; may appear in library suggestions |
| User creates 50+ boards | Works in localStorage; consider migration to `user_boards` table |
| Board prompt is abusive/nonsensical | AI returns empty suggestions; no moderation needed on client (AI handles it) |
| User adds a pin manually to a board then visits suggestions | Pin is excluded from library suggestions (already in this board) |
| Offline user creates board | Board created locally; internet suggestions deferred until online |

---

## Open Questions

1. **Board editing** — Should there be a "Board Settings" surface to edit name, prompt, or delete the board? Or are these handled through the existing category management UX?
2. **Board limit** — Should there be a max number of user-created boards? localStorage has ~5MB limit. 50 boards with prompts is negligible, but consider future growth.
3. **Prompt editing** — If a user edits the prompt after initial creation, should internet suggestions regenerate automatically or require explicit refresh?
4. **Cross-board pins** — Should a pin exist in multiple boards simultaneously (like tags), or should adding to a board move it out of its current category (current behavior)?
5. **Seeding threshold** — Is 5 pins the right threshold to hide library suggestions? Should it be configurable or adaptive?

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Boards created per user | 2+ within first month | Count of `user_created: true` categories |
| Suggestion acceptance rate | > 40% of suggested pins added | Add actions / suggestions shown |
| Internet suggestion engagement | > 30% of board creators use internet suggestions | Sessions with internet suggestion adds / board creation sessions |
| Board retention | > 70% of created boards still have pins after 30 days | Boards with pins at T+30 / boards created |
| Time to first pin in new board | < 30 seconds (from board creation) | Time between board creation and first pin add |

---

## Future Considerations

1. **Board templates** — Pre-built boards with prompts for common use cases ("Wishlist", "Moodboard", "Reading List")
2. **Smart re-suggestions** — As the user's library grows, periodically surface new pins that match existing board prompts
3. **Board cover image** — Auto-generate a hero image from the board's contents or prompt
4. **Board ordering** — Allow users to reorder their boards in the nav bar
5. **Board merge** — Merge a user-created board into an AI category or vice versa
6. **Prompt-to-category evolution** — If a user-created board's prompt closely matches an AI category, suggest promotion to a permanent category

---

## Related Documents

- [PRD: Boards MVP](./boards-mvp.md) — Core categorization system
- [PRD: Collaborative Boards](./collaborative-boards.md) — Multi-user board sharing
- [PRD: Categorization Cleanup](./categorization-cleanup.md) — Review and correct AI decisions
- [PRD: Add Subcategories by Prompt](./add-subcategories-by-prompt.md) — AI-driven subcategory creation
- [UX: Sharing](../../ux/boards/sharing.md) — Shared board viewer experience
- [TECH: Database Schema](../../infrastructure/technical-design/database-schema.md) — Current schema
