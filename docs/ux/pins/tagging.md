# Flexible Tagging & Metadata

> **Status:** ⚠️ Partial
> **Brand Principle:** Organize as you go
> **Key Personas:** DJ (critical), Design Technologist (critical), Multidisciplinary Maker (high), Researcher (high)
>
> Back to [UX Index](../index.md)

Organization should be fluid. Categories are a start, but power users need freeform tags, custom metadata, and the ability to find things their way.

---

## User Goals

- **Organize pins** into meaningful groups
- **Filter quickly** to find specific content
- **Drill down further** with sub-tags within a category
- **Create categories** that match my mental model
- **See category counts** to understand my collection
- **Tag pins freely** beyond single-category assignment

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Add a new pin | Assign it to a category | Keep organized from the start |
| Browse my board | Filter by category | Focus on one type of content |
| Have uncategorized pins | See them separately | Organize them later |
| Need a new category | Create one easily | Adapt my organization |
| Want more detail | Add tags beyond the category | Find things multiple ways |

---

## What's Shipped

### Categories

| Feature | Status | Notes |
|---------|--------|-------|
| Category Filter Bar | ✅ Shipped | Horizontal scrollable tokens |
| AI Category Assignment | ✅ Shipped | Auto-categorize on add |
| Category Counts | ✅ Shipped | Shows count per category |
| Create Category | ✅ Shipped | Dynamic creation, max 30 chars |
| Move Between Categories | ✅ Shipped | Single or bulk move |
| Bulk Category Assignment | ✅ Shipped | Select multiple pins, assign together |

#### Category Rules

| Rule | Detail |
|------|--------|
| Max length | 30 characters |
| Duplicates | Not allowed (case-insensitive) |
| Special chars | Emoji allowed |
| System categories | `All` (everything), `Uncategorized` (no assignment) — cannot delete |

### Sub-Tags

| Feature | Status | Notes |
|---------|--------|-------|
| Sub-Tags on Cards | ✅ Shipped | Shows sub-tag when filtered into category |
| Sub-Tags Bar | 🧪 Beta | Enable via `window.enableSubTagsBar()` |

Sub-tags are auto-detected from keywords in pin title/description. Within a category, they provide a second level of filtering.

### Content Types
- 9 content types assigned by AI (see [AI Categorization](./ai-categorization.md))
- Content type visible on cards as badge
- Filterable in search

---

## Wireframes

### Category Filter Bar

```
┌──────────────────────────────────────────────────────────────┐
│  [ All (156) ] [ Clothing (47) ] [ Tech (23) ] [ Home (18) ] │
│  [ Wishlist (12) ] [ Inspiration (34) ] [ Uncategorized (22)]│
└──────────────────────────────────────────────────────────────┘
     ↑ active                              scrollable →

Active state (inverted colors):
┌────────────┐
│ ████████████│  ← white bg, black text
│ █ All (156)█│
│ ████████████│
└────────────┘
```

### Category Filter Bar (Mobile)

```
┌────────────────────────────────────┐
│  ◀ [ All ] [ Clothing ] [ Tech ] ▶│
└────────────────────────────────────┘
        ← swipe to see more →
```

### Sub-Tags on Cards

```
"All" View - shows category:
┌─────────────────┐
│  [WEAR]         │  ← Category shown
│  ┌───────────┐  │
│  │   image   │  │
│  └───────────┘  │
│  Title...       │
└─────────────────┘

"Wear" View - shows sub-tag:
┌─────────────────┐
│  [OUTERWEAR]    │  ← Sub-tag shown (detected from title/description)
│  ┌───────────┐  │
│  │   image   │  │
│  └───────────┘  │
│  Puffer Jacket  │
└─────────────────┘
```

### Sub-Tags Bar (Beta)

Enable via console: `window.enableSubTagsBar()`

```
Sub-Tags Bar (appears when Wear selected):
┌──────────────────────────────────────────────────────────────┐
│  [ All 47 ] [ Tops 12 ] [ Bottoms 8 ] [ Outerwear 6 ]        │
│  [ Footwear 15 ] [ Accessories 4 ] [ Bags 2 ]                │
└──────────────────────────────────────────────────────────────┘
```

### Create Category Modal

```
┌─────────────────────────────────────────┐
│  Create Category                  [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Category name:                         │
│  ┌─────────────────────────────────┐    │
│  │ Summer Outfits                  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Suggested names:                       │
│  [ Fashion ] [ Style ] [ Seasonal ]     │
│                                         │
│           [ Cancel ]  [ Create ]        │
└─────────────────────────────────────────┘
```

### Bulk Category Assignment

```
┌──────────────────────────────────────────────────────┐
│  ☑ 5 selected                [ Move to... ▾ ] [ × ] │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────┐                 │
│  │ ○ Clothing (12)                 │                 │
│  │ ○ Tech (8)                      │                 │
│  │ ● Wishlist (3)  ← move here     │                 │
│  │ ─────────────────────────────   │                 │
│  │ [ + Create new category ]       │                 │
│  └─────────────────────────────────┘                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Filtering Behavior

```
Filter: All
└── Shows: All pins
└── Sub-tags: Hidden

Filter: Wear
└── Shows: Only pins in "Wear" category
└── Sub-tags: Tops, Bottoms, Outerwear, Footwear, Accessories, Bags, Other

Filter: Wear → Footwear
└── Shows: Only "Wear" pins matching footwear keywords
└── Keywords: shoe, sneaker, boot, sandal, loafer, trainer, etc.

Filter: Wear → Other
└── Shows: "Wear" pins that don't match any sub-tag keywords

Multiple filters: Not supported (single select per level)
```

### Sub-Tag Keywords by Category

**Wear:**
- `tops`: shirt, tee, sweater, hoodie, blouse, cardigan, vest
- `bottoms`: pants, jeans, shorts, skirt, joggers, chinos
- `outerwear`: jacket, coat, blazer, parka, bomber, puffer
- `footwear`: shoe, sneaker, boot, sandal, loafer, trainer
- `accessories`: hat, scarf, belt, watch, sunglasses, jewelry, ring
- `bags`: bag, backpack, tote, messenger, clutch, purse

**Home:**
- `furniture`: chair, sofa, table, desk, bed, shelf, cabinet
- `lighting`: lamp, light, chandelier, sconce, pendant
- `decor`: art, print, rug, mirror, vase, plant, pillow
- `kitchen`: cookware, pan, knife, appliance, dish, mug
- `bedding`: sheet, duvet, comforter, blanket, mattress
- `storage`: basket, bin, box, organizer, rack

**Use:**
- `tech`: phone, laptop, headphone, speaker, camera, charger
- `tools`: tool, drill, hammer, screwdriver, wrench
- `fitness`: weight, dumbbell, yoga, mat, gym, workout
- `outdoor`: tent, camping, hiking, bike, kayak, ski
- `office`: pen, notebook, planner, stapler, stationery
- `travel`: luggage, suitcase, carry-on, adapter, toiletry

---

## What's Planned

### Custom Tags
- User-applied freeform tags on any pin
- Autocomplete from existing tag vocabulary
- Multiple tags per pin (not just single category)
- Tag management: rename, merge, delete
- Filter board view by one or more tags
- Bulk tag operations: select multiple pins, apply/remove tags

### Structured Metadata
Pin-type-specific fields beyond title/description:
- Music pins: BPM, key, energy level, mood
- Image pins: dimensions, color palette, EXIF
- Event pins: date, venue, lineup
- Custom fields per user or per board

### Smart Tags
- AI-suggested tags based on pin content and user patterns
- "You might want to tag this as..." suggestions
- Tag trends: see which tags are growing in your collection

### Category Extensions
- Category colors — assign colors for visual distinction
- Category icons — custom emoji/icon per category
- Category description — notes about what goes in each
- AI sub-tag detection — use image recognition for better tagging
- Smart categories — auto-populate based on rules (e.g., "All products under $50")
- Category merge/split — combine or divide categories
- Manual sub-tag editing — override auto-detected sub-tags
- Custom sub-tags — user-defined sub-tags per category
- Cross-board categories — share categories across multiple boards

---

## Key Files

| File | Purpose |
|------|---------|
| `boards/index.html` | Category filter UI, sub-tag detection, `SUB_TAGS` constant, `detectSubTag()`, `getSubTag()` |

### CSS Classes

```css
.grid-item__category   /* Tag display on cards */
.sub-tags              /* Container bar (beta) */
.sub-tags--visible     /* Show state modifier */
.sub-tag               /* Individual tag button */
.sub-tag--active       /* Selected state */
.sub-tag__count        /* Count badge */
```

---

## Persona Fit

| Persona | What They Need |
|---------|---------------|
| DJ | BPM, key, energy, mood as first-class metadata — not just categories |
| Design Technologist | Cross-domain tags (a pin can be "typography" AND "algorithm" AND "generative") |
| Multidisciplinary Maker | Tags that bridge "work" and "personal" without artificial separation |
| Researcher | Theme tags for building arguments across sources |

---

## Technical Notes

- Sub-tag definitions in `SUB_TAGS` constant per category
- Detection via `detectSubTag()` using keyword matching
- Cached on link object via `getSubTag()` for performance
- Card display: shows sub-tag when filtered into category, category when in "All"
- Beta bar feature: `showSubTagsBar` flag, enable via `window.enableSubTagsBar()`
- Sub-tag bar styling: 9px font, muted color, outline border, count inline, "Other" for untagged

---

*See also: [AI Categorization](./ai-categorization.md) · [Search & Retrieval](../boards/search.md) · [Cross-Category Connections](../boards/cross-category.md)*
