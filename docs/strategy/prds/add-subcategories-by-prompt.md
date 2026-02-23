# PRD: Add Subcategories by Prompt

**Version:** 1.0
**Date:** 2026-02-23
**Status:** Draft

---

## Overview

ctrl.rodeo currently uses hardcoded sub-tag dimensions for filtering within categories — `wear` has Type (tops, bottoms, outerwear...), `listen` has Type (albums, tracks, playlists...), and so on. These work well for the predefined 9 categories but they're rigid: the tags are developer-defined, keyword-matched, and can't adapt to what a user actually saves.

"Add Subcategories by Prompt" lets users create custom subcategories within any board or category by describing what they want to see. Instead of relying on hardcoded keyword lists, the user writes a short prompt — "organize by decade", "split by price range", "group by mood" — and the AI analyzes the board's pins to generate meaningful subcategory tags and assign each pin to one.

This is especially powerful for user-created boards (see [Create a Board](./create-a-board.md)), which have no predefined sub-tags at all. But it also works on AI-generated categories, letting users override or supplement the built-in dimensions with their own organizational logic.

---

## Goals

1. Let users organize any board's contents by criteria that matter to them, not just what was hardcoded
2. Use AI to analyze existing pins and generate meaningful subcategory groupings
3. Support multiple simultaneous dimensions (e.g., "by type" AND "by price range")
4. Extend the existing sub-tags infrastructure rather than replacing it
5. Keep the interaction fast — prompt in, subcategories out, no manual tagging

---

## Who This Serves

### Primary Personas

| Persona | Why This Matters |
|---------|-----------------|
| **The Visual Collector** | Has 60 pins in `wear` and the built-in Type dimension isn't enough. Wants to also filter by "brand tier" (luxury vs. streetwear vs. vintage) or "season" (spring, summer, fall, winter). A prompt like "organize by season" instantly creates a new filter dimension. |
| **The DJ** | `listen` has 40+ links. The built-in Type dimension (albums, tracks, playlists) is useful but doesn't capture the real organizational need: genre, energy level, or era. "Split by genre" creates electronic, jazz, hip-hop subcategories from the actual content. |
| **The Multidisciplinary Maker** | User-created board "Studio Renovation" has 20 pins but no sub-tags at all. "Group by room area" creates living, workspace, kitchen subcategories without any built-in keyword matching. |

### Secondary Personas

| Persona | Why This Matters |
|---------|-----------------|
| **The Researcher** | `read` category has 50 articles. "Organize by topic" creates subcategories like methodology, case studies, theory — based on actual article content, not keyword guessing. |
| **The Deep-Dive Enthusiast** | User-created board "Japanese Denim" has 30 pins. "Split by brand" creates subcategories the system could never have predicted from hardcoded keywords. |

### Jobs To Be Done

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Have too many pins in one board | Ask the AI to organize them into groups | Find what I'm looking for faster |
| Need a specific way to filter | Describe my filtering criteria in natural language | Get custom subcategories without manual work |
| See the AI's groupings | Review and adjust them | Trust the organization before committing |
| Want multiple filter dimensions | Add more than one prompt-based grouping | Cross-filter by type AND season AND brand |
| Revisit a board after adding new pins | Have new pins auto-assigned to existing subcategories | Keep the organization current without re-prompting |

---

## Design Principles

| Brand Principle | Application |
|-----------------|-------------|
| **Input shapes output** | The user's prompt shapes how their collection is organized. Different prompts reveal different structures in the same content. |
| **Organize as you go** | Adding subcategories is a 10-second interaction — type a prompt, review the result. No manual tagging of individual pins. |
| **One place, whole life** | Works across all boards — AI-generated categories, user-created boards, even future collaborative boards. One organizational tool everywhere. |
| **Show, don't decorate** | Subcategories appear as the same filter tokens already used for sub-tags. No new UI paradigm. |
| **Expand with the user** | Starts with built-in sub-tags for common categories. Users add their own when they need more. Progressive complexity. |

---

## Core Features

### 1. Prompt-Based Subcategory Creation

**What it is:** A text input that lets users describe how they want a board's contents organized.

**Entry point:** A `[+ Filter]` button at the end of the sub-tags bar (or below the category filter if no sub-tags bar exists yet).

**Creation flow:**

```
Sub-tags bar (existing):
┌─────────────────────────────────────────────────────────┐
│  Type: [All] [Tops] [Bottoms] [Outerwear] [Footwear]   │
│                                            [+ Filter]   │
└─────────────────────────────────────────────────────────┘
                                                ↓ tap

Prompt input (inline expansion):
┌─────────────────────────────────────────────────────────┐
│  Type: [All] [Tops] [Bottoms] [Outerwear] [Footwear]   │
│                                                         │
│  Add a filter dimension:                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │ organize by brand tier                            │  │
│  └───────────────────────────────────────────────────┘  │
│  [Cancel]  [Create]                                     │
└─────────────────────────────────────────────────────────┘
                                                ↓ submit

Result (new dimension added):
┌─────────────────────────────────────────────────────────┐
│  Type: [All] [Tops] [Bottoms] [Outerwear] [Footwear]   │
│  Brand Tier: [All] [Luxury] [Streetwear] [Vintage] [×] │
│                                            [+ Filter]   │
└─────────────────────────────────────────────────────────┘
```

**Behavior:**

- User types a natural language prompt describing the grouping criterion
- Prompt is sent to the AI along with the board's pin data (titles, descriptions, domains, categories)
- AI returns:
  - A dimension label (e.g., "Brand Tier")
  - A set of subcategory tags (e.g., "luxury", "streetwear", "vintage", "contemporary")
  - Assignment of each pin to a tag (or null if not applicable)
- The new dimension appears in the sub-tags bar alongside any existing dimensions
- The `[×]` button on the dimension label removes the prompt-based dimension
- Multiple prompt-based dimensions can coexist with each other and with hardcoded dimensions
- Filtering works the same as existing sub-tags: AND across dimensions, OR within a dimension (single-select per dimension)

**Prompt examples:**

| Prompt | Generated Dimension | Generated Tags |
|--------|-------------------|----------------|
| "organize by brand tier" | Brand Tier | luxury, streetwear, vintage, contemporary |
| "split by decade" | Decade | 2020s, 2010s, 2000s, 90s, classic |
| "group by mood" | Mood | energetic, chill, dark, uplifting |
| "by price range" | Price Range | under-50, 50-150, 150-500, 500+ |
| "separate tutorials from inspiration" | Content | tutorials, inspiration, reference |

---

### 2. AI Analysis & Tag Generation

**What it is:** The AI analyzes pins in context and generates appropriate subcategory tags.

**Input to AI:**

```json
{
  "prompt": "organize by brand tier",
  "board": "wear",
  "pins": [
    {
      "id": "abc123",
      "title": "Nike Air Max 90",
      "description": "Classic sneaker...",
      "domain": "nike.com",
      "url": "https://nike.com/air-max-90"
    },
    {
      "id": "def456",
      "title": "Maison Margiela Tabi Boots",
      "description": "Iconic split-toe...",
      "domain": "maisonmargiela.com",
      "url": "https://maisonmargiela.com/tabi"
    }
  ]
}
```

**Output from AI:**

```json
{
  "dimension": {
    "id": "brand-tier",
    "label": "Brand Tier",
    "tags": ["luxury", "streetwear", "contemporary", "vintage"]
  },
  "assignments": {
    "abc123": "streetwear",
    "def456": "luxury",
    "ghi789": null
  }
}
```

**Behavior:**

- The AI examines each pin's title, description, domain, and URL to determine tag assignment
- Tags are generated from the actual content — not from a predefined list
- The number of tags adapts to the content: 2-8 tags depending on diversity
- Pins that don't clearly fit any tag are assigned `null` (displayed as "Other" in the filter bar)
- If the AI can't generate meaningful tags from the prompt (e.g., "asdfghjk"), return an error: "Couldn't create subcategories from that prompt. Try something like 'organize by type' or 'split by decade'."
- Pin data sent to the AI is minimal — only title, description, domain, and URL (no images or full page content)

**Rate limiting:**

- Max 5 prompt-based dimensions per board
- Max 3 AI calls per board per session (creating + refreshing)
- Cached results persist in localStorage until explicitly removed

---

### 3. Auto-Assignment for New Pins

**What it is:** When new pins are added to a board that has prompt-based subcategories, they're automatically assigned to the appropriate tag.

**Behavior:**

- When a pin is added to a board (manually, from suggestions, or from the internet), check if the board has prompt-based dimensions
- For each prompt-based dimension, run a lightweight client-side classification:
  1. Compare the new pin's title/description/domain against existing tagged pins
  2. Use keyword overlap and domain similarity to find the closest tag
  3. If confidence is high enough (> 0.6), assign the tag
  4. If uncertain, assign `null` (shows in "Other")
- This is client-side only — no AI call for individual pin assignment
- Periodically (or on user request), a full AI re-analysis can re-assign all pins

**Why client-side:** Calling the AI for every individual pin add would be slow and expensive. The initial prompt-based analysis establishes the tag definitions; subsequent assignments use lightweight pattern matching. The user can always trigger a full re-analysis if assignments drift.

---

### 4. Dimension Management

**What it is:** Controls for editing, refreshing, and removing prompt-based dimensions.

**Actions:**

| Action | Trigger | Behavior |
|--------|---------|----------|
| **Remove dimension** | `[×]` on dimension label | Removes the dimension and all tag assignments. Pins aren't moved — only the filter is removed. |
| **Refresh assignments** | Long-press dimension label → "Re-analyze" | Re-sends all pins to AI with the original prompt. Updates tag assignments. Useful after adding many new pins. |
| **Edit prompt** | Long-press dimension label → "Edit prompt" | Opens the prompt input pre-filled with the original prompt. Submitting regenerates the dimension entirely. |
| **Rename tag** | Tap-and-hold individual tag → "Rename" | Renames the tag label. Doesn't change assignments. |
| **Merge tags** | Drag one tag onto another (desktop) | Combines two tags into one. All pins from the source tag move to the target. |

**Dimension label context menu (long-press):**

```
┌──────────────────────┐
│  Re-analyze pins     │
│  Edit prompt         │
│  ──────────────────  │
│  Remove filter       │
└──────────────────────┘
```

---

### 5. Interaction with Existing Sub-Tags

**What it is:** Rules for how prompt-based dimensions coexist with the hardcoded `SUB_TAGS` system.

**Coexistence model:**

```
Category: wear

Built-in dimension (from SUB_TAGS):
  Type: [All] [Tops] [Bottoms] [Outerwear] [Footwear] [Accessories] [Bags]

Prompt-based dimensions (from user):
  Brand Tier: [All] [Luxury] [Streetwear] [Vintage] [Contemporary] [×]
  Season: [All] [Spring] [Summer] [Fall] [Winter] [×]
                                                        [+ Filter]
```

**Rules:**

- Built-in dimensions appear first, without a `[×]` button (they can't be removed)
- Prompt-based dimensions appear after built-in ones, each with a `[×]` button
- Filtering works the same across both: selecting Type: Tops AND Brand Tier: Luxury shows only pins tagged as both
- The `[+ Filter]` button always appears at the end, allowing more dimensions to be added
- If a category has no built-in sub-tags (like user-created boards), the sub-tags bar only appears when the user adds their first prompt-based dimension

**On user-created boards:**

User-created boards (from [Create a Board](./create-a-board.md)) have no built-in sub-tags. The `[+ Filter]` button appears directly below the board's pins, with a gentle prompt:

```
┌─────────────────────────────────────────────────────────┐
│  No filters yet. Organize this board's pins:            │
│  ┌───────────────────────────────────────────────────┐  │
│  │ e.g., "group by type" or "split by brand"         │  │
│  └───────────────────────────────────────────────────┘  │
│  [Create]                                               │
└─────────────────────────────────────────────────────────┘
```

This surfaces only when the board has 5+ pins (below that, filtering isn't useful).

---

## User Flows

### Flow 1: Add Dimension to Existing Category

```
1. User is viewing "wear" category (45 pins)
2. Built-in sub-tags show: Type: [All] [Tops] [Bottoms] ...
3. User taps [+ Filter]
4. Prompt input appears inline
5. User types: "organize by season"
6. Taps [Create]
7. Loading state: "Analyzing 45 pins..."
8. AI returns dimension: Season with tags spring, summer, fall, winter
9. New row appears: Season: [All] [Spring (12)] [Summer (8)] [Fall (15)] [Winter (10)] [×]
10. User taps "Summer" — grid filters to 8 summer items
11. User can also combine: Type: Tops + Season: Summer → 3 results
```

### Flow 2: Organize a User-Created Board

```
1. User created board "Studio Renovation" with 18 pins
2. No sub-tags bar visible (user-created boards have none by default)
3. Below the grid: "No filters yet. Organize this board's pins:"
4. User types: "group by room area"
5. Taps [Create]
6. AI analyzes pins — returns: Room Area with tags workspace, living, kitchen, bathroom
7. Sub-tags bar appears: Room Area: [All (18)] [Workspace (6)] [Living (5)] [Kitchen (4)] [Bathroom (3)] [×]
8. User taps [+ Filter] to add another: "by priority"
9. Second dimension: Priority: [All] [Must-have (8)] [Nice-to-have (7)] [Someday (3)] [×]
10. User filters: Room Area: Kitchen + Priority: Must-have → 2 results
```

### Flow 3: New Pin Auto-Assignment

```
1. User has "wear" with prompt-based dimension "Season" (spring, summer, fall, winter)
2. User adds new pin: "Patagonia Down Jacket" from patagonia.com
3. Client-side classification compares against existing tagged pins
4. High confidence match: jacket → fall/winter outerwear patterns
5. Pin assigned to "Fall" in the Season dimension
6. Pin appears correctly when filtering by Season: Fall
```

### Flow 4: Refresh After Bulk Add

```
1. User has "listen" with prompt-based dimension "Genre"
2. User adds 15 new music links via paste
3. Some get auto-assigned, some land in "Other"
4. User long-presses "Genre" label → "Re-analyze"
5. AI re-processes all 55 pins with the original prompt
6. Tags may update — new genre "jazz" appears because enough jazz links now exist
7. Previously "Other" pins get properly assigned
```

### Flow 5: Remove Dimension

```
1. User has two prompt-based dimensions on "wear": Brand Tier and Season
2. Brand Tier isn't useful anymore
3. User taps [×] on Brand Tier
4. Confirmation: "Remove Brand Tier filter? Pins won't be affected."
5. User confirms — dimension disappears from sub-tags bar
6. Season dimension remains, [+ Filter] still available
```

---

## Data Model

### Prompt-Based Dimensions Storage

Stored in localStorage alongside existing board data:

```javascript
// New key in localStorage: `board-dimensions-${category}`
{
  "dimensions": [
    {
      "id": "brand-tier",
      "label": "Brand Tier",
      "prompt": "organize by brand tier",
      "tags": ["luxury", "streetwear", "contemporary", "vintage"],
      "assignments": {
        "pin-id-1": "luxury",
        "pin-id-2": "streetwear",
        "pin-id-3": null
      },
      "created_at": "2026-02-23T12:00:00Z",
      "last_analyzed_at": "2026-02-23T12:00:00Z"
    },
    {
      "id": "season",
      "label": "Season",
      "prompt": "organize by season",
      "tags": ["spring", "summer", "fall", "winter"],
      "assignments": {
        "pin-id-1": "winter",
        "pin-id-2": "summer",
        "pin-id-3": "fall"
      },
      "created_at": "2026-02-23T12:05:00Z",
      "last_analyzed_at": "2026-02-23T12:05:00Z"
    }
  ]
}
```

### Supabase Schema (Future)

For multi-device sync, a new table:

```sql
CREATE TABLE user_dimensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  board_slug VARCHAR(100) NOT NULL,
  dimension_id VARCHAR(100) NOT NULL,
  label VARCHAR(100) NOT NULL,
  prompt TEXT NOT NULL,
  tags TEXT[] NOT NULL,
  assignments JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  last_analyzed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, board_slug, dimension_id)
);

CREATE INDEX idx_user_dimensions_user_board ON user_dimensions(user_id, board_slug);
```

**MVP approach:** localStorage only. Migrate to Supabase when multi-device sync ships.

### Integration with Existing SUB_TAGS

The rendering code checks both `SUB_TAGS[currentFilter]` (hardcoded) and `board-dimensions-${currentFilter}` (prompt-based):

```javascript
function getAllDimensions(category) {
  const builtIn = SUB_TAGS[category]?.dimensions || [];
  const promptBased = getPromptDimensions(category); // from localStorage
  return [
    ...builtIn.map(d => ({ ...d, removable: false })),
    ...promptBased.map(d => ({ ...d, removable: true }))
  ];
}
```

---

## Technical Architecture

### AI Subcategory Generation

New edge function or extension of existing infrastructure:

```
POST /functions/v1/generate-subcategories
{
  "prompt": "organize by brand tier",
  "board_name": "wear",
  "pins": [
    { "id": "abc", "title": "...", "description": "...", "domain": "..." },
    ...
  ]
}

Response:
{
  "dimension": {
    "id": "brand-tier",
    "label": "Brand Tier"
  },
  "tags": ["luxury", "streetwear", "contemporary", "vintage"],
  "assignments": {
    "abc": "luxury",
    "def": "streetwear",
    ...
  }
}
```

**AI prompt template:**

```
You are organizing a collection of saved links into subcategories.

The user wants to: {{prompt}}
Board/category: {{board_name}}

Here are the pins:
{{pins as JSON}}

Instructions:
1. Analyze the pins and create 2-8 subcategory tags based on the user's prompt
2. Tags should be short (1-2 words), lowercase, concrete nouns or adjectives
3. Assign each pin to the most appropriate tag, or null if it doesn't fit
4. The dimension label should be a clear 1-3 word name for this grouping
5. Return valid JSON matching the response schema
```

### Client-Side Auto-Assignment

For new pins added after initial analysis:

```javascript
function autoAssignTag(pin, dimension) {
  const tagScores = {};

  for (const tag of dimension.tags) {
    // Find pins already assigned to this tag
    const tagPins = Object.entries(dimension.assignments)
      .filter(([, t]) => t === tag)
      .map(([id]) => findPin(id))
      .filter(Boolean);

    if (tagPins.length === 0) continue;

    // Score based on keyword overlap with existing tagged pins
    const pinText = `${pin.title} ${pin.description || ''} ${pin.domain}`.toLowerCase();
    let score = 0;

    for (const existing of tagPins) {
      const existingText = `${existing.title} ${existing.description || ''} ${existing.domain}`.toLowerCase();
      const commonWords = getCommonWords(pinText, existingText);
      score += commonWords.length * 0.1;

      // Domain match bonus
      if (pin.domain === existing.domain) score += 0.3;
    }

    tagScores[tag] = score / tagPins.length; // Normalize by tag size
  }

  const best = Object.entries(tagScores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0.15 ? best[0] : null; // Threshold for confidence
}
```

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Dimension creation (AI call) | < 5s for 50 pins, < 10s for 200 pins |
| Auto-assignment (client-side) | < 50ms per pin |
| Sub-tags bar render | < 100ms including prompt-based dimensions |
| Max pins sent to AI | 200 (sample if board is larger) |
| Offline support | Existing dimensions work offline; creating new ones requires network |
| Storage footprint | < 50KB per dimension (assignments for 500 pins) |

---

## Implementation Phases

### Phase 1: Core Prompt-to-Dimension
- [ ] `[+ Filter]` button in sub-tags bar
- [ ] Inline prompt input UI
- [ ] `generate-subcategories` edge function
- [ ] Dimension rendering in sub-tags bar (alongside hardcoded dimensions)
- [ ] AND filtering across built-in and prompt-based dimensions
- [ ] localStorage persistence for prompt-based dimensions
- [ ] `[×]` remove dimension

### Phase 2: Management & Polish
- [ ] Long-press context menu (Re-analyze, Edit prompt, Remove)
- [ ] Re-analyze flow (re-send all pins to AI)
- [ ] Edit prompt flow (regenerate dimension)
- [ ] Loading states and error handling
- [ ] Rate limiting (5 dimensions per board, 3 AI calls per session)

### Phase 3: Auto-Assignment
- [ ] Client-side auto-assignment for new pins
- [ ] "Other" count update on pin add
- [ ] Periodic staleness indicator ("12 new pins since last analysis")

### Phase 4: User-Created Board Integration
- [ ] "No filters yet" prompt on user-created boards with 5+ pins
- [ ] Placeholder suggestions (e.g., "group by type", "split by brand")
- [ ] Ensure dimensions persist across board views

### Phase 5: Supabase Sync (Future)
- [ ] `user_dimensions` table migration
- [ ] Sync dimensions on login / device switch
- [ ] Conflict resolution for dimensions edited on multiple devices

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Board has < 3 pins | AI can't generate meaningful subcategories. Show: "Add more pins to enable filtering." |
| Prompt is too vague ("organize these") | AI does its best to find natural groupings. May return content-type based split. |
| Prompt is contradictory or nonsensical | AI returns error message. User prompted to try a different description. |
| All pins assigned to same tag | Dimension is created but not useful. User can remove it. No automatic removal. |
| Board has 200+ pins | Send a representative sample (first 200 by recency) to the AI. Apply assignments to sampled pins; rest go to "Other" until re-analyzed. |
| Pin deleted that had tag assignments | Assignment entry removed from dimension data on next render. |
| Two prompt dimensions produce similar tags | Allowed — user may want overlapping but distinct views (e.g., "by mood" and "by energy" on music). |
| Hardcoded dimension and prompt dimension have same label | Prompt dimension gets a suffix: "Type (custom)" to distinguish from built-in "Type". |
| Shared/collaborative board view | Prompt-based dimensions are visible to all viewers (they're part of the board's organization, unlike suggestions which are creation tools). |

---

## Open Questions

1. **Visibility on shared boards** — Should prompt-based dimensions be visible to shared board viewers? They reveal organizational structure, which could be useful or could clutter the view. Leaning toward visible (they're organizational, not creation-related).
2. **AI model choice** — Should this use Claude Haiku (fast, cheap) or a larger model? For 50 pins, Haiku is likely sufficient. For 200+ pins with nuanced prompts, Sonnet may produce better groupings.
3. **Tag evolution** — When re-analyzing, should the AI try to preserve existing tag names (even if the content has shifted), or generate fresh tags each time? Preserving tags prevents filter state from breaking.
4. **Bulk dimensions** — Should there be a "Quick organize" button that generates 2-3 useful dimensions automatically without a prompt? The AI would analyze the board and suggest dimensions it thinks would be useful.
5. **Pin-level override** — Should users be able to manually change a pin's tag assignment within a prompt-based dimension? This adds complexity but prevents frustration when the AI gets it wrong.

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Dimension creation rate | 30% of users with 20+ pins in a category create at least one | Boards with prompt-based dimensions / eligible boards |
| Dimension retention | 70% of created dimensions still exist after 7 days | Dimensions present at T+7 / dimensions created |
| Filter usage after dimension creation | 80% of users who create a dimension use it to filter within 24 hours | Filter interactions / dimension creators |
| Re-analyze rate | < 20% of dimensions need re-analysis within 7 days | Re-analyze actions / dimensions created |
| Assignment accuracy | > 75% of auto-assigned tags are correct (user doesn't re-assign) | Stable assignments / total assignments |

---

## Future Considerations

1. **Suggested dimensions** — AI proactively suggests useful dimensions based on board content: "Your wear board has items from 12 different brands. Want to filter by brand?"
2. **Cross-board dimensions** — Apply a dimension across multiple boards (e.g., "price range" on both `wear` and `home`)
3. **Dimension templates** — Pre-built dimensions users can apply with one tap: "By price range", "By brand", "By date added"
4. **Collaborative dimensions** — On shared boards, any editor can add dimensions. Dimension attribution shows who created each filter.
5. **Smart re-analysis** — Automatically re-analyze when 10+ new pins have been added since last analysis, rather than requiring manual trigger
6. **Dimension sharing** — Share a dimension configuration so others can apply the same organizational logic to their boards

---

## Related Documents

- [PRD: Create a Board](./create-a-board.md) — User-created boards that benefit most from prompt-based subcategories
- [PRD: Boards MVP](./boards-mvp.md) — Core categorization and sub-tag system
- [PRD: Categorization Cleanup](./categorization-cleanup.md) — Related concept: AI-assisted organization with human review
- [TECH: AI Widget System](../../infrastructure/technical-design/ai-widget-system.md) — Existing AI infrastructure for edge functions
- [TECH: Database Schema](../../infrastructure/technical-design/database-schema.md) — Current schema
- [UX: Boards Index](../../ux/boards/index.md) — Board UX documentation
