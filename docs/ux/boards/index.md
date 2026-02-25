# Boards

Boards are the primary workspace for organizing and viewing saved pins. Each board acts as a curated collection with flexible layout options, smart filtering, and optional collaboration features.

---

## User Goals

- **Organize content visually** in a way that makes sense to me
- **Create my own named collections** around personal themes and projects
- **Find what I need quickly** through filters and search
- **Customize my view** to match how I think about my content
- **Share collections** with others when I want to collaborate
- **See everything at a glance** without endless scrolling

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Start a new project | Create a themed board | Keep related content together |
| Start a new board | See AI-ranked suggestions from my library | Seed it without browsing manually |
| Browse my collection | See an organized grid | Find pins visually |
| Look for something specific | Filter by category/type | Narrow down results |
| Collaborate on ideas | Share a board | Work with others |
| Have too many pins | Switch to list view | Scan titles quickly |
| Curate my aesthetic | Customize the layout | Make it my own |
| Add context to a pin | Write notes/annotations | Remember why I saved it |
| Navigate without a mouse | Use keyboard shortcuts | Browse efficiently |
| Get started as a new user | See helpful hints | Learn the interface |

---

## Key Concepts

### What is a Board?

A board is a container for pins. There are two kinds:

**AI-generated boards** (categories): Auto-created by content type inference (e.g., "Clothing", "Tech"). Hidden when empty.

**User-created boards**: Named by the user with an optional context prompt. Visible even at 0 pins. Marked with a ✦ prefix in the filter bar. Persisted to Supabase so they survive reload and appear on all devices.

All boards have:
- **Name and description**: What this collection is about
- **Layout options**: Grid, list, or masonry view
- **Filter state**: Current category/type selections
- **Privacy**: Private (default) or shared
- **Member access**: Owner, editors, viewers (for shared boards)

### Board Hierarchy

```
┌─────────────────────────────────────────────────┐
│                     Account                      │
├─────────────────────────────────────────────────┤
│                                                  │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐       │
│   │ Board 1 │   │ Board 2 │   │ Board 3 │       │
│   │         │   │         │   │         │       │
│   │ ┌─────┐ │   │ ┌─────┐ │   │ ┌─────┐ │       │
│   │ │Pins │ │   │ │Pins │ │   │ │Pins │ │       │
│   │ └─────┘ │   │ └─────┘ │   │ └─────┘ │       │
│   │ ┌─────┐ │   │ ┌─────┐ │   │         │       │
│   │ │Cats │ │   │ │Cats │ │   │         │       │
│   │ └─────┘ │   │ └─────┘ │   │         │       │
│   └─────────┘   └─────────┘   └─────────┘       │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## Wireframes

### Board View (Grid Layout)

```
┌─────────────────────────────────────────────────────────┐
│  🏠 My Shopping Board                    [⚙️] [Share]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Filter: [All Types ▾]  [All Categories ▾]  🔍 Search   │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │         │  │         │  │         │  │         │    │
│  │  Pin 1  │  │  Pin 2  │  │  Pin 3  │  │  Pin 4  │    │
│  │         │  │         │  │         │  │         │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │         │  │         │  │         │  │         │    │
│  │  Pin 5  │  │  Pin 6  │  │  Pin 7  │  │  Pin 8  │    │
│  │         │  │         │  │         │  │         │    │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │
│                                                         │
│  📊 24 pins • Last updated 2 hours ago      [+ Add]     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Board View (List Layout)

```
┌─────────────────────────────────────────────────────────┐
│  🏠 My Shopping Board                    [⚙️] [Share]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Filter: [All Types ▾]  [All Categories ▾]  🔍 Search   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🖼️ │ Pin Title 1                    │ 🛍 │ Dec 15 │   │
│  ├────┼────────────────────────────────┼────┼────────┤   │
│  │ 🖼️ │ Pin Title 2                    │ 📰 │ Dec 14 │   │
│  ├────┼────────────────────────────────┼────┼────────┤   │
│  │ 🖼️ │ Pin Title 3                    │ 🎬 │ Dec 12 │   │
│  ├────┼────────────────────────────────┼────┼────────┤   │
│  │ 🖼️ │ Pin Title 4                    │ 🛍 │ Dec 10 │   │
│  └────┴────────────────────────────────┴────┴────────┘   │
│                                                         │
│  📊 24 pins • Last updated 2 hours ago      [+ Add]     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Filter Bar with User Boards

```
┌────────────────────────────────────────────────────────────────────┐
│  [Search...]  [All]  [Clothing]  [Tech]  [✦ Running]  [+ Board]    │
└────────────────────────────────────────────────────────────────────┘
                                    ↑
                         User-created board — ✦ prefix,
                         visible even at 0 pins

Sort order:  Pinned AI → User boards (✦) → Unpinned AI → [+ Board]
```

---

## Board Components

| Component | Status | Description | See Details |
|-----------|--------|-------------|-------------|
| **Create a Board** | ✅ Shipped | User-created boards with name + prompt, library seed panel, TF-IDF ranking, Supabase persistence | [Create a Board](./create-board.md) |
| **Flexible Tagging** | ⚠️ Partial | Categories, sub-tags, content types; freeform tags planned | [Flexible Tagging](../pins/tagging.md) |
| **Visual Grid Browsing** | ✅ Shipped | Responsive grid, card expansion, dense flow | [Grid Layout & Display](./grid-layout.md) |
| **Search & Retrieval** | ✅ Shipped | Live search, category filter, sub-tag filter, notes search | [Search & Retrieval](./search.md) |
| **Categorization Cleanup** | ✅ Shipped | Review and correct AI categorization mistakes | [Cleanup](./cleanup.md) |
| **Lookback** | ✅ Shipped | Rediscover valuable past pins (Phase 1 MVP) | [Lookback](./lookback.md) |
| **Collection Sharing** | ⚠️ Partial | Export shipped; public boards planned | [Sharing & Collaboration](./sharing.md) |
| **Cross-Category Connections** | ⚠️ Partial | Sub-tags + widget suggestions; explicit connections planned | [Cross-Category](./cross-category.md) |
| **Events Integration** | ❌ Planned | Event/venue pins, calendar view | [Events](./events.md) |
| **Pin Annotations** | ✅ Shipped | Notes field on expanded cards, auto-save, searchable | — |
| **Keyboard Navigation** | ✅ Shipped | Grid navigation with Enter/Space/Arrows, modal focus trapping | — |
| **Onboarding System** | ✅ Shipped | First-pin celebration, progressive contextual hints | — |
| **Accessibility** | ✅ Shipped | ARIA roles, WCAG AA contrast, focus management | — |

---

## Board Settings

```
┌─────────────────────────────────────────────┐
│  Board Settings                       [X]   │
├─────────────────────────────────────────────┤
│                                             │
│  Name:                                      │
│  ┌─────────────────────────────────────┐    │
│  │ Design Inspiration                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Description:                               │
│  ┌─────────────────────────────────────┐    │
│  │ Mood board for the new project...   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Icon:  🎨 [Change]                         │
│                                             │
│  Default View:  ● Grid  ○ List  ○ Masonry   │
│                                             │
│  Privacy:  ● Private  ○ Shared              │
│                                             │
│  ─────────────────────────────────────      │
│                                             │
│  [Delete Board]          [ Save Changes ]   │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Known Extensions / Future States

### Short-term
- **Board templates** - Start with pre-made structures
- **Pin reordering** - Drag and drop to arrange pins
- **Board cover images** - Visual thumbnails for board selection

### Medium-term
- **Sub-boards** - Nested organization within boards
- **Smart boards** - Auto-populate based on rules
- **Board analytics** - See engagement and usage stats

### Long-term
- **Board export** - Download as PDF or bookmark file
- **Public boards** - Discoverable by other users
- **Board monetization** - Earn from curated collections

---

## Technical Notes

- Boards stored in Supabase with user_id relation
- Default board created on user signup
- Filter state persisted in URL query params
- Shared boards use Supabase RLS for access control
- Board membership stored in separate junction table
- Notes field auto-saves on blur, searchable via client-side search
- Keyboard navigation: Enter/Space (open card), Arrow keys (navigate grid), Home/End (first/last)
- Focus trapping in modals with Tab/Shift+Tab cycling
- Onboarding state stored in localStorage (`boards_onboarding`)
- ARIA roles: `role="dialog"`, `role="tablist"`, `aria-live="polite"` for toasts
- WCAG AA compliant color contrast (--muted: #999)
- User-created board metadata persisted to `board_metadata` Supabase table (JSONB per user, `supabase/migrations/019_board_metadata.sql`)
- `saveBoardMetadata()` upserts on every board create/update; `fetchFromSupabase()` merges metadata at load time (`boards/index.html:11756`, `12020`)
- ✦ prefix applied in filter bar for `isUserBoard === true` categories (`boards/index.html:12930`)
- Filter sort order: pinned AI → user boards → unpinned AI by pin count (`boards/index.html:12911`)
- TF-IDF cosine similarity ranker (`PinRanker` module, `boards/index.html:15636`) used for library seed suggestions
