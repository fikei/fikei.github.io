# Grid Layout & Display

The visual presentation of pins in a responsive, masonry-style grid inspired by Swiss design principles.

---

## User Goals

- **See my pins beautifully** in a clean, organized layout
- **Scan quickly** to find what I'm looking for
- **View details** by expanding a card
- **Works on any device** - desktop, tablet, mobile
- **Maintain visual hierarchy** with consistent styling

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Open my board | See a clean grid of pins | Quickly browse my collection |
| Find a specific pin | Scan the grid visually | Locate it by image/title |
| Learn more about a pin | Expand the card | See full details |
| Use my phone | Have a usable mobile view | Browse on the go |
| Have many pins | Scroll smoothly | Browse large collections |

---

## Wireframes

### Desktop Grid (4-5 columns)

```
┌─────────────────────────────────────────────────────────────────┐
│  BOARDS                                      [Search] [+ Add]   │
├─────────────────────────────────────────────────────────────────┤
│  [ All ] [ Clothing ] [ Tech ] [ Home ] [ Wishlist ]            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐│
│  │         │  │         │  │         │  │         │  │        ││
│  │  [img]  │  │  [img]  │  │  [img]  │  │  [img]  │  │ [img]  ││
│  │         │  │         │  │         │  │         │  │        ││
│  │ Title   │  │ Title   │  │ Title   │  │ Title   │  │ Title  ││
│  │ domain  │  │ domain  │  │ domain  │  │ domain  │  │ domain ││
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └────────┘│
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐│
│  │         │  │         │  │         │  │         │  │        ││
│  │  [img]  │  │  [img]  │  │  [img]  │  │  [img]  │  │ [img]  ││
│  │         │  │         │  │         │  │         │  │        ││
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Tablet Grid (3 columns)

```
┌─────────────────────────────────────────┐
│  BOARDS                    [+]          │
├─────────────────────────────────────────┤
│  [ All ] [ Clothing ] [ Tech ] →        │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  [img]  │ │  [img]  │ │  [img]  │   │
│  │ Title   │ │ Title   │ │ Title   │   │
│  └─────────┘ └─────────┘ └─────────┘   │
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  [img]  │ │  [img]  │ │  [img]  │   │
│  │ Title   │ │ Title   │ │ Title   │   │
│  └─────────┘ └─────────┘ └─────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### Mobile Grid (2 columns)

```
┌─────────────────────────┐
│  BOARDS            [+]  │
├─────────────────────────┤
│  ◀ [All] [Clothing] ▶   │
├─────────────────────────┤
│                         │
│  ┌──────┐  ┌──────┐    │
│  │[img] │  │[img] │    │
│  │Title │  │Title │    │
│  └──────┘  └──────┘    │
│                         │
│  ┌──────┐  ┌──────┐    │
│  │[img] │  │[img] │    │
│  │Title │  │Title │    │
│  └──────┘  └──────┘    │
│                         │
└─────────────────────────┘
```

### Pin Card States

```
Default:                    Hover:                     Expanded:
┌─────────────┐            ┌─────────────┐            ┌─────────────────────┐
│             │            │             │            │                     │
│   [image    │            │   [image    │            │      [image         │
│    grayscale]│            │    COLOR]   │            │       full color]   │
│             │            │             │            │                     │
│ Title       │            │ Title       │            │ Full Title Here     │
│ domain.com  │            │ domain.com  │            │ ─────────────────── │
└─────────────┘            │ 🛍 Product   │            │ domain.com • Dec 15 │
                           └─────────────┘            │                     │
                                                      │ Full description... │
                                                      │                     │
                                                      │ [Open] [Copy] [Edit]│
                                                      └─────────────────────┘
```

### Image Placeholder States

```
Loading:                   No Image:                  Error:
┌─────────────┐            ┌─────────────┐            ┌─────────────┐
│             │            │             │            │             │
│  ░░░░░░░░░  │            │     A       │            │     ⚠️      │
│  ░░░░░░░░░  │            │  (initial)  │            │   (retry)   │
│  ░░░░░░░░░  │            │             │            │             │
│             │            │             │            │             │
│ Loading...  │            │ Article     │            │ Failed      │
└─────────────┘            └─────────────┘            └─────────────┘
```

---

## Responsive Breakpoints

| Breakpoint | Width | Columns | Gap |
|------------|-------|---------|-----|
| Mobile | < 640px | 2 | 12px |
| Tablet | 640-1024px | 3 | 16px |
| Desktop | 1024-1440px | 4 | 20px |
| Large | > 1440px | 5 | 24px |

---

## Design Principles

### Swiss Grid Influence
- **Clean lines** - No decorative elements
- **Strong typography** - Clear hierarchy
- **White space** - Generous padding
- **Consistency** - Uniform card sizes

### Visual Treatment
- **Grayscale by default** - Images desaturated
- **Color on hover/expand** - Brings focus
- **Subtle shadows** - Depth without distraction
- **Dark mode first** - Black background, white text

---

## Known Extensions / Future States

### Short-term
- **List view** - Alternative to grid for dense scanning
- **Card size options** - Small, medium, large cards
- **Sort options** - By date, name, domain

### Medium-term
- **Masonry layout** - Variable height cards based on image ratio
- **Infinite scroll** - Load more as user scrolls
- **Grid density toggle** - Compact vs comfortable spacing

### Long-term
- **Custom layouts** - User-defined grid arrangements
- **Collection covers** - Featured image for categories
- **Visual search** - Find pins by image similarity

---

## Technical Notes

- Grid uses CSS Grid with `auto-fill` and `minmax()`
- Images lazy-loaded with `loading="lazy"`
- Expanded state toggles via `openDetail()` / `closeAll()`
- Grayscale via CSS filter, removed on hover/expand
- Card expansion preserved in localStorage via `saveExpandedCards()`
