# PRD: AI Widgets

**Date**: 2026-02-06
**Status**: Draft
**Owner**: Ian

---

## Problem

Users save links to boards across 8 categories (home, wear, watch, use, eat, go, follow, read). The collection grows, but the app doesn't help users *understand* what they've saved or *do* anything with it. Items sit in a grid. There's no synthesis, no insight, no action.

## Goal

AI widgets turn a passive collection into an active experience. Each widget answers one question the user didn't know they had — and earns its existence by being more useful than the blank space it replaces.

---

## Content Reality

### What a user actually has

Each item on a board is a link with:
- **title** — product name, article headline, restaurant name
- **url** — where it lives
- **image** — hero image (sometimes missing)
- **description** — optional, often empty
- **category** — one of: home, wear, watch, use, eat, go, follow, read
- **domain** — where it came from (nike.com, nytimes.com, etc.)

### What a user does NOT have
- Prices (unless in the title)
- Ratings or reviews
- Structured metadata (color, size, material)
- Intent (are they buying? browsing? comparing?)

### Implication
Widgets must work with **titles, URLs, domains, and images**. Anything beyond that is AI inference — and must be labeled as such.

---

## Categories & What Users Curate

| Category | What they save | Example items |
|----------|---------------|---------------|
| **wear** | Clothing, shoes, accessories | Nike Dunk, Reigning Champ hoodie |
| **home** | Furniture, decor, housewares | CB2 sofa, Hay lamp |
| **watch** | Movies, shows, docs | Letterboxd link, Netflix title |
| **use** | Tools, apps, gadgets | Notion, Arc browser, Dyson |
| **eat** | Restaurants, recipes, ingredients | Resy link, NYT Cooking recipe |
| **go** | Destinations, stays, experiences | Airbnb, Google Maps pin |
| **follow** | People, accounts, creators | Instagram, Twitter, Substack |
| **read** | Books, articles, newsletters | Amazon book, Pocket article |

---

## Widget Principles

1. **Content first** — What data do we actually have? Design the widget around it.
2. **One question per widget** — Each widget answers exactly one question. No dashboards.
3. **Earn existence** — If the widget isn't more useful than blank space, suppress it.
4. **Label inference** — If the AI is guessing, say so. "AI" badge is required.
5. **Base component** — Every widget is built from a design system component, not custom HTML.
6. **No dead ends** — Every widget offers an action: refresh, visit, add, dismiss.

---

## Process: How a Widget Gets Built

```
1. CONTENT     What data exists for this category?
     |         (titles, domains, images, item count)
     v
2. QUESTION    What's the one question users would ask?
     |         ("What's missing?" / "What's my vibe?" / "What should I try next?")
     v
3. COMPONENT   What's the simplest UI that answers it?
     |         (Pick from design system: card, list, meter, tag group, etc.)
     v
4. DATA        Wire AI output into the component
     |         (Prompt → JSON schema → render function)
     v
5. VALIDATE    Does it earn existence?
               (Confidence check, user feedback, suppression rules)
```

---

## Phase 1: What Exists Today (Wear Only)

### Widget: Complete the Look
- **Question**: "What's missing from this outfit?"
- **Content used**: Item titles, images, domains, garment category inference
- **Component**: Grid-split — user's items (left) + AI suggestions (right)
- **Action**: Shop Now → (links to brand site)
- **Status**: Shipped, working

### Widget: Style Summary
- **Question**: "What's my aesthetic?"
- **Content used**: Item titles, brand inference
- **Component**: Hero card — label + sublabel + trait tags
- **Action**: Refresh for new analysis
- **Status**: Shipped, working

### What's NOT working
- Both widgets are wear-only
- Item filtering hard-codes `category === 'wear'`
- No widgets exist for the other 7 categories
- Template/config infrastructure was built (7 templates, 5 configs) but 3 new widgets have never been seen by a user

---

## Phase 2: Fix What's Broken

Before adding anything new, fix the existing experience:

| Task | Why |
|------|-----|
| Make item filtering category-agnostic | Widgets can't work for non-wear categories |
| Wire `--grid-split` CSS class properly | Grid-split body layout broke when we refactored base CSS |
| Fix `handleQuickAdd` cache key mismatch | Quick-add button silently fails |
| Test Complete the Look + Style Summary end-to-end | Verify existing widgets still work after all the refactoring |

---

## Phase 3: One Widget Per Category

For each category, follow the process: Content → Question → Component → Data → Validate.

### wear (existing)
- Complete the Look → grid-split
- Style Summary → hero-card

### home
- **Question**: "What room are you building?"
- **Content**: Furniture/decor titles and domains (CB2, West Elm, IKEA, HAY)
- **Component**: hero-card — room label + style traits ("Scandinavian Minimal", "Mid-Century Warm")
- **Why this component**: Same job as Style Summary — reflect identity back. Titles + domains are enough.

### watch
- **Question**: "What should I watch next?"
- **Content**: Movie/show titles, streaming domains (Netflix, Letterboxd, IMDb)
- **Component**: list — ranked recommendations based on what they've saved
- **Why this component**: Linear recommendations. No images needed — titles are the content.

### use
- **Question**: "What kind of setup are you building?"
- **Content**: Tool/app titles and domains
- **Component**: hero-card — label ("Creative Pro Stack", "Minimal Developer") + tool category tags
- **Why this component**: Reflect identity. Tool names are rich enough for AI inference.

### eat
- **Question**: "What cuisine are you into?"
- **Content**: Restaurant names, recipe titles, food domains
- **Component**: hero-card — cuisine label + trait tags ("Southeast Asian", "Fermentation-heavy")
- **Why this component**: Same pattern — reflect taste back.

### go
- **Question**: "What kind of traveler are you?"
- **Content**: Destination names, Airbnb/hotel domains
- **Component**: hero-card — traveler label + style tags ("Budget Explorer", "Boutique Hotels")
- **Why this component**: Reflect identity from destination choices.

### follow
- **Question**: "What topics do you follow?"
- **Content**: Creator names, platform domains (IG, Twitter, Substack, YouTube)
- **Component**: list — topic clusters extracted from creator descriptions/handles
- **Why this component**: Creators map to topics. List is the right shape.

### read
- **Question**: "What are you reading about?"
- **Content**: Article headlines, book titles, publisher domains
- **Component**: hero-card — reading label + topic tags ("Tech Criticism", "Long-form Narrative")
- **Why this component**: Titles are rich. Reflect reading identity.

### Pattern
6 of 8 categories use **hero-card**. This is the most versatile component for the data we actually have (titles + domains → identity inference). The hero-card template is already built and working.

---

## Phase 4: Prove Action Templates Work

After all 8 categories have at least one consumption widget, pick ONE action template and prove the feedback loop works end-to-end:

- **Candidate**: `quick-add` for wear (gap-filler widget, already built)
- **Test**: Does clicking "Add to board" actually add the item and improve future suggestions?
- **Success criteria**: User adds an item → item appears in grid → next widget generation excludes that gap

---

## What We're NOT Building (Yet)

- Multiple widgets per category (one is enough to start)
- Spectrum/stat-row templates (built but not validated — keep in research)
- Action templates beyond quick-add (9 templates in backlog)
- Cross-category widgets ("Your overall taste profile")
- Widget marketplace or discovery UI

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Widget renders without error | 100% of page loads where items ≥ minItems |
| Suppression rate (low confidence) | < 20% |
| User clicks refresh | > 0 per session (engagement signal) |
| Categories with working widget | 8 of 8 |

---

## Technical Notes

### What's already built (keep)
- Template selection engine (`WIDGET_TEMPLATES` + `renderWidgetWithTemplate`)
- Server-side eligibility engine (`config/registry.ts`)
- Discovery endpoint (server-driven widget selection with local fallback)
- Confidence scoring + suppression
- Widget instrumentation (view/click/refresh/dismiss tracking)
- Hot-reload registry

### What's already built (validate before using)
- `spectrum` template — built, never rendered
- `stat-row` template — built, never rendered
- `quick-add` template + `handleQuickAdd` — built, cache key bug
- `price-radar` widget config — deployed, never triggered
- `collection-stats` widget config — deployed, never triggered
- `gap-filler` widget config — deployed, never triggered

### What needs to happen for each new category widget
1. Create `config/widgets/<category>-profile.ts` (server config, ~60 lines)
2. Add frontend `WIDGET_REGISTRY` entry (prompt + template mapping)
3. Deploy edge function
4. Test with real items

No new templates needed. Hero-card and list cover all 8 categories.
