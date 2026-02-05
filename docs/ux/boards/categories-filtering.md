# Categories & Filtering

Organization system that lets users group pins into categories and filter their board view.

---

## User Goals

- **Organize pins** into meaningful groups
- **Filter quickly** to find specific content
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

Filter: Clothing
└── Shows: Only pins in "Clothing" category

Filter: Uncategorized
└── Shows: Only pins without a category

Multiple filters: Not supported (single select)
```

---

## Known Extensions / Future States

### Short-term
- **Category colors** - Assign colors for visual distinction
- **Category icons** - Custom emoji/icon per category
- **Category description** - Add notes about what goes in each

### Medium-term
- **Nested categories** - Sub-categories for deeper organization
- **Smart categories** - Auto-populate based on rules (e.g., "All products under $50")
- **Category merge** - Combine two categories into one
- **Category split** - Divide a category into two

### Long-term
- **Cross-board categories** - Share categories across multiple boards
- **Collaborative categories** - Team-defined categories
- **Category templates** - Pre-built category sets for common use cases

---

## Technical Notes

- Categories stored in Supabase `categories` table
- Filter state stored in URL params for shareability
- Category cache in localStorage for offline access
- AI suggestions via `categorizeWithAI()` function
- Bulk moves handled by `bulkMove()` with batch updates
