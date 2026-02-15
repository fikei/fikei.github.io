# Grid Layout & Display

> **Status:** ✅ Shipped
> **Brand Principle:** Show, don't decorate
> **Key Personas:** Visual Collector (critical), Cultural Omnivore (critical), Design Technologist (high)
>
> Back to [UX Index](../index.md)

The visual presentation of pins in a responsive, masonry-style grid inspired by Swiss design principles. The user's content is the design — minimal chrome, maximum content density.

| Feature | Status | Notes |
|---------|--------|-------|
| Responsive Grid | ✅ Shipped | 2-5 columns based on viewport |
| Card Expansion | ✅ Shipped | Medium (2x2) and Large (3x2) |
| Grid Reflow | ✅ Shipped | Auto gap-filling via `grid-auto-flow: dense` |
| Grid Flow Priority | ✅ Shipped | Setting to prioritize flow over order |
| Keyboard Navigation | ✅ Shipped | Enter/Space (open), Arrow keys (navigate), Home/End |
| Mobile Card Overlay | ✅ Shipped | Always-visible gradient with title on touch devices |
| Focus Indicators | ✅ Shipped | Visible focus outlines for keyboard users |
| List View | ⏳ Planned | Alternative dense view |
| Sort Options | ⏳ Planned | Date, name, domain |

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
| Navigate with keyboard | Use arrow keys to move between cards | Browse without a mouse |
| Open a card with keyboard | Press Enter or Space | Access details hands-free |
| See info on mobile | View card titles without tapping | Preview content while scrolling |

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

## Grid Reflow ✅ IMPLEMENTED

When cards expand to 2x2 or 3x2 sizes, smaller cards automatically fill gaps.

### Before Reflow (gaps visible)
```
┌──────┐  ┌───────────────┐  ┌──────┐
│  1   │  │               │  │  3   │
└──────┘  │    2 (2x2)    │  └──────┘
          │               │  [ GAP ]
          └───────────────┘
┌──────┐  ┌──────┐  ┌──────┐
│  4   │  │  5   │  │  6   │
└──────┘  └──────┘  └──────┘
```

### After Reflow (gaps filled)
```
┌──────┐  ┌───────────────┐  ┌──────┐
│  1   │  │               │  │  3   │
└──────┘  │    2 (2x2)    │  ├──────┤
┌──────┐  │               │  │  4   │ ← fills gap
└──────┘  └───────────────┘  └──────┘
┌──────┐  ┌──────┐  ┌──────┐
│  5   │  │  6   │  │  7   │
└──────┘  └──────┘  └──────┘
```

**Implementation details:**
- CSS property: `grid-auto-flow: dense`
- File: `boards/index.html:814-820`
- Behavior: Grid auto-placement fills available gaps with smaller items

### Grid Flow Priority Setting ✅ IMPLEMENTED

When `grid-auto-flow: dense` isn't enough (order conflicts with placement), users can enable "Prioritize Grid Flow" in Settings.

**How it works:**
- Expanded cards are moved to the front of the render order
- 1x1 cards fill the remaining grid positions
- Results in a fully packed grid with no gaps

```
Order Priority (default):          Flow Priority (enabled):
┌──────┐  ┌───────────────┐        ┌───────────────┐  ┌──────┐
│  1   │  │               │        │               │  │  1   │
└──────┘  │    2 (2x2)    │        │    2 (2x2)    │  ├──────┤
[ GAP ]   │               │        │               │  │  3   │
          └───────────────┘        └───────────────┘  └──────┘
┌──────┐  ┌──────┐  ┌──────┐      ┌──────┐  ┌──────┐  ┌──────┐
│  3   │  │  4   │  │  5   │      │  4   │  │  5   │  │  6   │
└──────┘  └──────┘  └──────┘      └──────┘  └──────┘  └──────┘
```

**Implementation details:**
- Setting: `boards-grid-flow` in localStorage
- File: `boards/index.html:6340-6346`
- Toggle: Settings → "Prioritize Grid Flow"

---

## Keyboard Navigation ✅ IMPLEMENTED

Navigate the grid entirely with keyboard for accessibility and power users.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| **Arrow Keys** | Navigate between cards (Up/Down/Left/Right) |
| **Enter** or **Space** | Open/close expanded card details |
| **Home** | Jump to first card |
| **End** | Jump to last card |
| **Tab** | Cycle through interactive elements |
| **Shift+Tab** | Reverse cycle through interactive elements |

### Focus Management

**Grid Focus:**
- Cards have `tabindex="0"` to make them keyboard-accessible
- Visible focus outline: `2px solid var(--fg)` with `2px` offset
- Selected/expanded cards have thicker outline: `3px solid var(--fg)`

**Modal Focus Trapping:**
- When a modal opens, focus moves to first interactive element
- Tab/Shift+Tab cycles only through modal elements
- Escape closes modal and restores focus to trigger element
- Clicking backdrop closes modal

**Implementation details:**
- Grid navigation handler: `boards/index.html` (keyboard event listener on grid)
- Focus indicators: `.grid-item:focus` and `.grid-item--selected` CSS classes
- Modal focus trap: Implemented in modal open/close handlers

---

## Mobile Card Overlay ✅ IMPLEMENTED

On touch devices, card overlays are always visible with a gradient background, eliminating the need to tap-and-hold to see titles.

### Before (hover-only)
```
┌─────────────┐
│             │
│   [image]   │
│             │
│ (no overlay)│
└─────────────┘
```

### After (always-visible on touch)
```
┌─────────────┐
│             │
│   [image]   │
│  ┌────────┐ │
│  │gradient│ │
│  │ Title  │ │
│  │ domain │ │
│  └────────┘ │
└─────────────┘
```

**Design details:**
- Gradient: `transparent 30%` → `rgba(0,0,0,0.85)` bottom
- Text size: Title 10px, domain 8px
- Always visible on `@media (hover: none)` devices
- No border-top to blend seamlessly

**Implementation details:**
- CSS: `@media (hover: none)` block in `boards/index.html`
- Overlay background: `linear-gradient(transparent 30%, rgba(0,0,0,0.85))`
- Text sizing: Smaller fonts for compact overlay

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
- **Grid reflow via `grid-auto-flow: dense`** - fills gaps automatically
- Images lazy-loaded with `loading="lazy"`
- Expanded state toggles via `openDetail()` / `closeAll()`
- Grayscale via CSS filter, removed on hover/expand
- Card expansion preserved in localStorage via `saveExpandedCards()`
- Responsive breakpoints: 2 cols (mobile) → 3 → 4 → 5 (1200px+)
- **Keyboard navigation:** Arrow keys use grid-based position calculation
- **Focus indicators:** CSS `:focus` and `.grid-item--selected` classes
- **Mobile overlay:** Always visible via `@media (hover: none)` media query
- **Focus trapping:** Modal keydown handler cycles Tab through modal elements only
