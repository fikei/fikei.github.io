# Categories & Filtering

Organization system that lets users group pins into categories and filter their board view.

**Implementation Status**: ✅ Shipped

| Feature | Status | Notes |
|---------|--------|-------|
| Category Filter Bar | ✅ Shipped | Horizontal scrollable tokens |
| AI Category Assignment | ✅ Shipped | Auto-categorize on add |
| Sub-Tags | ✅ Shipped | Secondary filter when category selected |
| Category Counts | ✅ Shipped | Shows count per category |

---

## User Goals

- **Organize pins** into meaningful groups
- **Filter quickly** to find specific content
- **Drill down further** with sub-tags within a category
- **Create categories** that match my mental model
- **See category counts** to understand my collection
- **Assign categories** during or after adding pins

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Add a new pin | Assign it to a category | Keep organized from the start |
| Browse my board | Filter by category | Focus on one type of content |
| Have uncategorized pins | See them separately | Organize them later |
| Need a new category | Create one easily | Adapt my organization |
| Wonder about my collection | See category stats | Understand my patterns |

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

### Category Filter Bar (Mobile - Scrollable)

```
┌────────────────────────────────────┐
│  ◀ [ All ] [ Clothing ] [ Tech ] ▶│
└────────────────────────────────────┘
        ← swipe to see more →
```

### Sub-Tags Bar ✅ IMPLEMENTED

When a category is selected, sub-tags appear below the main filter bar:

```
Category Bar:
┌──────────────────────────────────────────────────────────────┐
│  [ All ] [ Wear ✓ ] [ Home ] [ Use ] [ Watch ] [ Go ]        │
└──────────────────────────────────────────────────────────────┘

Sub-Tags Bar (appears when Wear selected):
┌──────────────────────────────────────────────────────────────┐
│  [ All 47 ] [ Tops 12 ] [ Bottoms 8 ] [ Outerwear 6 ]        │
│  [ Footwear 15 ] [ Accessories 4 ] [ Bags 2 ]                │
└──────────────────────────────────────────────────────────────┘
       ↑ muted style, smaller tokens
```

Sub-tag styling:
- Smaller than category tokens (9px vs 10px)
- Muted color by default (--muted)
- Outline border (--subtle)
- Shows count inline
- "Other" option for untagged items

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

### Category Assignment (During Add)

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  URL: https://example.com/jacket        │
│                                         │
│  Category:                              │
│  ┌─────────────────────────────────┐    │
│  │ [ Select category...        ▾ ] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ ○ Clothing                      │    │
│  │ ○ Tech                          │    │
│  │ ○ Home                          │    │
│  │ ● Wishlist  ← AI suggested      │    │
│  │ ─────────────────────────────   │    │
│  │ [ + Create new category ]       │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [ Cancel ]  [ Add ]           │
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

## Category Rules

### Naming
- Max 30 characters
- No duplicate names (case-insensitive)
- Emoji allowed but not required
- Auto-trim whitespace

### Special Categories
| Category | Behavior |
|----------|----------|
| `All` | System category, shows everything, cannot be deleted |
| `Uncategorized` | System category, pins without assignment |

### AI Category Suggestions
When adding a pin, AI analyzes:
- Pin content type
- Similar pins already categorized
- Domain patterns
- Title/description keywords

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

## Known Extensions / Future States

### Short-term
- **Category colors** - Assign colors for visual distinction
- **Category icons** - Custom emoji/icon per category
- **Category description** - Add notes about what goes in each
- **AI sub-tag detection** - Use image recognition for better tagging

### Medium-term
- ~~**Nested categories** - Sub-categories for deeper organization~~ → Implemented as Sub-Tags
- **Smart categories** - Auto-populate based on rules (e.g., "All products under $50")
- **Category merge** - Combine two categories into one
- **Category split** - Divide a category into two
- **Manual sub-tag editing** - Override auto-detected sub-tags
- **Custom sub-tags** - User-defined sub-tags per category

### Long-term
- **Cross-board categories** - Share categories across multiple boards
- **Collaborative categories** - Team-defined categories
- **Category templates** - Pre-built category sets for common use cases

---

## Technical Notes

### Categories
- Categories stored in Supabase `categories` table
- Filter state stored in URL params for shareability
- Category cache in localStorage for offline access
- AI suggestions via `categorizeWithAI()` function
- Bulk moves handled by `bulkMove()` with batch updates

### Sub-Tags
- Sub-tag definitions in `SUB_TAGS` constant per category
- Detection via `detectSubTag()` using keyword matching
- Cached on link object via `getSubTag()` for performance
- State tracked in `currentSubTag` variable
- UI rendered by `renderSubTags()` function
- File: `boards/index.html`

### CSS Classes
```css
.sub-tags              /* Container bar */
.sub-tags--visible     /* Show state modifier */
.sub-tag               /* Individual tag button */
.sub-tag--active       /* Selected state */
.sub-tag__count        /* Count badge */
```
