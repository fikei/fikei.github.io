# Boards Layout Redesign — Cosmos-Inspired Grid + Full-Page Detail

**Status:** Approved
**Date:** 2026-03-11
**Scope:** Boards grid layout, card interaction model, detail view

---

## 1. Problem

The current Boards layout uses a uniform-square CSS grid with inline card expansion. This creates three issues:

1. **Wasted space** — Square aspect ratios crop or letterbox images that aren't 1:1, losing visual information.
2. **Grid disruption on expand** — Inline expansion (span 2×2 or 3×2) pushes surrounding cards, breaking visual context and scroll position.
3. **Limited detail real estate** — The inline expanded card compresses metadata into a narrow right-hand column alongside the image, making notes, descriptions, and rich content types feel cramped.

---

## 2. Reference: Cosmos Layout Model

Cosmos uses a masonry grid with full-page overlay on click. Measured from `cosmos.so/ema/design`:

| Property | Cosmos Value |
|----------|-------------|
| Layout type | CSS masonry (columns, not CSS Grid rows) |
| Column count | 5 columns at ~1320px viewport |
| Column width | 208px (fluid, equal-width) |
| Gutter (h + v) | 40px uniform |
| Edge padding | 60px left/right |
| Card aspect ratio | Natural (preserves image ratio) |
| Card chrome | None — image fills card edge-to-edge, rounded corners |
| Hover | Subtle overlay: source attribution, save button |
| Click | Full-page overlay (`/e/{id}` route): image left (~60%), metadata panel right (~40%) |
| Overlay nav | Back chevron (top-left), close returns to grid |

---

## 3. Decisions

All decisions accepted 2026-03-11.

| # | Decision | Choice | Notes |
|---|----------|--------|-------|
| D1 | Layout engine | JS-managed masonry | Shortest-column-first algorithm. ~50 lines, no dependency. Only approach that handles natural aspect ratios + 2-col spanning. |
| D2 | Overlay transition | Fade (200ms) | Zoom-from-card deferred to fast-follow. |
| D3 | Overlay routing | Hash (`#pin/{id}`) | Zero infrastructure on GitHub Pages. **Upgrade to path-based routing flagged for React/server transition brief** — when we have a server, migrate to `/boards/pin/{id}`. |
| D4 | 2-col card resize | Keep, but defer to v1.1 | Ship masonry + overlay with 1-col only first. Add 2-col resize as fast-follow once layout engine is proven. |
| D5 | Gutter size | 12px | Masonry staggering provides visual rhythm; tight gutters feel intentional. One CSS variable to tweak. |
| D6 | Inline expansion code | Full removal | Delete `expandedCards` state, `grid-item--expanded-*` CSS, inline detail panel. No two-model coexistence. |

---

## 4. Design Spec

### 4.1 Grid Layout

**Adopt masonry layout. Reduce gutter from Cosmos's 40px.**

| Property | New Value | Current Value |
|----------|-----------|---------------|
| Layout type | JS-managed masonry (shortest-column-first) | CSS Grid (`display: grid`) |
| Gutter | 12px uniform | 16px (`--grid-gap`) |
| Edge padding | 16px (mobile), 24px (tablet), 40px (desktop) | 16px uniform |
| Card aspect ratio | Natural (image dictates height) | `1:1` forced square |
| Card border-radius | 6px | Current value |
| Card background | `var(--bg-surface)` | `var(--bg-surface)` |

**Responsive columns:**

| Breakpoint | Columns | Current |
|------------|---------|---------|
| < 600px | 2 | 2 |
| 600–899px | 3 | 3 |
| 900–1199px | 4 | 4 |
| ≥ 1200px | 5 | 5 |

Column counts stay the same. The change is masonry flow (cards stack vertically without fixed row heights) and tighter gutters.

**Placeholder cards** (no image): Retain the centered initial-letter treatment. These render at a default `aspect-ratio: 1` since there's no image to dictate height.

### 4.2 Card Hover States

Hover reveals three elements on pointer devices. Touch devices show overlay persistently (current behavior).

| Element | Position | Behavior |
|---------|----------|----------|
| **Card title** | Bottom, over gradient | Fade in. Title text, 1 line, ellipsis overflow. Current `.grid-item__overlay` treatment. |
| **Triple-dot menu** (•••) | Top-right | Fade in. Opens existing kebab menu (Share, Refresh, Organize, Merge, Delete). |
| **Resize handle** | Bottom-right | Fade in. Allows cycling card width: 1col → 2col → 1col. See §3.4. |
| **Category badge** | Top-left | Fade in. Current amber badge. |
| **Format badge** | Bottom-left | Fade in for listen/watch/read/recipe types. Current treatment. |

Border highlight on hover: `var(--border-subtle)` → `var(--fg-muted)`. Same as current.

### 4.3 Card Click → Full-Page Detail Overlay

**Replace inline expansion with a full-page overlay.** This is the primary UX change.

**Overlay shell:**
- Fixed overlay covers viewport: `position: fixed; inset: 0; z-index: 1000`
- Background: `var(--bg)` (opaque, not a dimmed backdrop — this is a page, not a modal)
- Transition: Fade in 200ms (D2). Zoom-from-card deferred to FF-2.
- URL updates to `#pin/{id}` (D3 — hash-based, no server route needed). Back button closes overlay. Path-based routing deferred to FF-3.
- Keyboard: `Escape` closes. `←` / `→` navigates to prev/next card in grid order.
- Close button: top-right `×` or back chevron top-left (match Cosmos's `<` chevron)

**Overlay layout — two-column (desktop):**

```
┌─────────────────────────────────────────────────────────┐
│ ‹ Back                                          × Close │
├───────────────────────────┬─────────────────────────────┤
│                           │  Title                      │
│                           │  domain.com ›               │
│      Image / Media        │                             │
│      (max-height: 85vh,   │  Description                │
│       object-fit: contain)│  (full text, no clamp)      │
│                           │                             │
│                           │  ┌─────────────────────┐    │
│                           │  │ Notes               │    │
│                           │  │ (textarea)           │    │
│                           │  └─────────────────────┘    │
│                           │                             │
│                           │  Meta: Category · Type ·    │
│                           │        Date                 │
│                           │                             │
│                           │  Actions:                   │
│                           │  [Visit] [Platform Link]    │
│                           │  [Watched/Read toggle]      │
│                           │                             │
│                           │  •••  (menu)                │
├───────────────────────────┴─────────────────────────────┤
│  (optional) Merge sources / related pins                │
└─────────────────────────────────────────────────────────┘
```

- Left column: ~55% width. Image centered, `object-fit: contain`, respects natural aspect ratio.
- Right column: ~45% width. Scrollable if content overflows.
- Gap between columns: 32px.
- Padding: 40px (desktop), 24px (tablet), 16px (mobile).

**Overlay layout — single-column (mobile, < 600px):**

```
┌───────────────────────┐
│ ‹ Back          × Close│
├───────────────────────┤
│                       │
│   Image / Media       │
│   (full-width,        │
│    max-height: 50vh)  │
│                       │
├───────────────────────┤
│ Title                 │
│ domain.com ›          │
│ Description           │
│ Notes                 │
│ Meta · Actions        │
└───────────────────────┘
```

Image stacks above metadata. Content scrolls naturally.

### 4.4 Card Resize (Multi-Column Width) — DEFERRED TO v1.1

**Decision (D4):** Ship v1 with 1-col cards only. 2-col resize is a fast-follow (see §9).

v1 hides the resize handle. The hover menu (•••) remains. When 2-col resize ships in v1.1:
- JS layout engine assigns wide cards to span two adjacent columns via absolute positioning.
- Resize handle reappears on hover, toggling `1col → 2col → 1col`.
- `wideCards` state persisted to localStorage (replaces `expandedCards`).
- 3-col state is permanently removed. Two states only.

### 4.5 Content-Type Detail Pages

Each content type renders its overlay detail view with type-specific elements. All types share the common overlay shell (§3.3). The differences are in what fills the left media area and what metadata appears in the right panel.

#### Generic Link / Product / Article
- **Media area:** OG image, full natural aspect ratio
- **Right panel:** Title, domain, description (full text), notes, category + content_type + date, [Visit] button
- This is the default for most pins.

#### Watch (Video)
- **Media area:** Video thumbnail. If embeddable (YouTube, Vimeo), show an inline `<iframe>` player triggered by a play button overlay on the thumbnail.
- **Right panel:** Video title, channel/creator, platform icon + type (Film / Series / Short) + runtime, description, notes, [Visit] button, [Platform link] (IMDb, Letterboxd), watched/unwatched toggle.
- Watched state shown via existing `grid-item--watched` dimming.

#### Listen (Music)
- **Media area:** Album/track artwork, full resolution. If Spotify/SoundCloud embed is available, show an embedded player below the artwork.
- **Right panel:** Track/album name, artist, platform icon + format (Album / Single / Playlist) + BPM/key/duration (if available), notes, [Visit] button, listened toggle.

#### Read (Book)
- **Media area:** Book cover image.
- **Right panel:** Book title, author, platform icon + type (Novel / Non-fiction / Textbook) + page count (if available), description/summary, notes, [Visit] button, [Platform link] (Goodreads), read/unread toggle.

#### Eat (Recipe)
- **Media area:** Recipe hero image.
- **Right panel:** Recipe name, source domain, description, notes, category chips if present, [Visit] button.

#### Placeholder (No Image)
- **Media area:** Large centered initial letter on `var(--bg-surface)` background, matching the card's visual.
- **Right panel:** Standard metadata layout.

#### Merged Pins
- **Media area:** Primary pin's image.
- **Right panel:** Standard metadata, plus a "Merged Sources" section listing each source with its own domain + visit link. Badge shows `N links` count.

### 4.6 Visual Style (Preserved)

No changes to the design system. The overlay adopts existing tokens:

| Element | Token |
|---------|-------|
| Overlay background | `var(--bg)` |
| Card surface | `var(--bg-surface)` |
| Panel divider | `var(--border-subtle)` |
| Title text | `var(--fg)` — JetBrains Mono |
| Domain/meta text | `var(--fg-muted)` — JetBrains Mono |
| Category badge | `var(--accent-amber)` on dark bg |
| Action buttons | Current `.grid-item__action` styling |
| Notes textarea | Current `.pin-notes` styling |

Dark mode first. Light mode inherits via existing token swap.

---

## 5. What's Removed

| Feature | Reason |
|---------|--------|
| Inline card expansion (medium/large) | Replaced by full-page overlay |
| `grid-item--expanded-medium` / `grid-item--expanded-large` CSS | No longer needed |
| `expandedCards` localStorage state | Replaced by `wideCards` (for 2-col spans) |
| 3-column span (`large` resize state) | Simplified to 1-col / 2-col only |
| Forced 1:1 aspect ratio | Replaced by natural image ratios |
| `grid-auto-flow: dense` CSS Grid approach | Replaced by masonry column layout |

---

## 6. What's Preserved

- All hover elements: title overlay, category badge, format badge, triple-dot menu, resize handle
- Kebab menu actions (Share, Refresh, Organize, Merge, Delete)
- Card drag-and-drop (reordering)
- Touch device persistent overlay
- Rich content type metadata (watch/listen/read/eat)
- Notes textarea
- Platform icons and accent colors
- All CSS design tokens and typography
- Responsive breakpoints (column count)
- Category filter bar + sub-filters
- Lookback cards (remain full-width rows)

---

## 7. Technical Considerations

1. **Masonry implementation (D1):** JS-managed layout — shortest-column-first assignment, absolute positioning within a relative container. ~50 lines. `ResizeObserver` triggers re-layout on viewport change.

2. **Overlay routing (D3):** `history.pushState` with `#pin/{id}` hash. `popstate` listener closes overlay on browser back. Zero infrastructure on GitHub Pages. **Flag:** Migrate to path-based routing (`/boards/pin/{id}`) in the React/server transition — add to that brief as a dependency.

3. **Overlay transition (D2):** Simple fade, 200ms. No card-position capture needed for v1.

4. **Keyboard/gesture nav:** `Escape` = close, `←`/`→` = prev/next pin (ordered by grid position), swipe left/right on mobile.

5. **Scroll position preservation:** When overlay opens, save `window.scrollY`. When it closes, restore. Prevent body scroll while overlay is open (`overflow: hidden` on body).

6. **Image loading:** In the overlay, load the full-resolution image (currently cards use `loading="lazy"` thumbnails). Show the card's thumbnail as a placeholder while the full image loads.

7. **Inline expansion removal (D6):** Delete `expandedCards` state, `grid-item--expanded-medium/large` CSS classes, inline detail panel markup and JS handlers. Single PR, clean cut.

8. **Version bump:** This is a major UX change → bump Boards minor version (X.Y+1.0).

---

## 9. Fast-Follows

Items explicitly deferred from v1. Track as backlog stories after v1 ships.

| # | Item | Decision Ref | Trigger | Effort |
|---|------|-------------|---------|--------|
| FF-1 | **2-col card resize** | D4 | After v1 masonry layout is stable | Medium — JS layout engine changes, `wideCards` state, resize handle re-enable |
| FF-2 | **Zoom-from-card overlay transition** | D2 | After v1 overlay is stable | Small — capture bounding rect, animate with `FLIP` technique |
| FF-3 | **Path-based overlay routing** | D3 | React/server transition | Small — replace `#pin/{id}` with `/boards/pin/{id}`, add server-side redirect |
| FF-4 | **Embedded media players** | §4.5 | After v1 overlay ships | Medium — YouTube/Vimeo iframe, Spotify/SoundCloud embed in overlay media area |

**Cross-reference:** FF-3 is a dependency for the React/server transition brief. When that brief is created, include overlay routing migration as a line item.

---

## 10. Out of Scope

- New content types or metadata fields
- Changes to the AI categorization or capture flow
- Backend/Supabase changes
- Watch/Listen list views (horizontal row layouts remain unchanged)
- Mobile app / PWA changes
- Board creation/management UI

---

## Next Steps

1. Break into implementation stories (grid migration, overlay build, content type detail pages)
2. Begin with grid layout migration (highest visual impact, unblocks overlay work)
3. After v1 ships, queue fast-follows FF-1 through FF-4 into backlog
