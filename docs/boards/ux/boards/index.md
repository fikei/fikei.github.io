# Boards

Boards are the primary workspace for organizing and viewing saved pins. Each board acts as a curated collection with flexible layout options, smart filtering, and optional collaboration features.

---

## User Goals

- **Organize content visually** in a way that makes sense to me
- **Find what I need quickly** through filters and search
- **Customize my view** to match how I think about my content
- **Share collections** with others when I want to collaborate
- **See everything at a glance** without endless scrolling

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Start a new project | Create a themed board | Keep related content together |
| Browse my collection | See an organized grid | Find pins visually |
| Look for something specific | Filter by category/type | Narrow down results |
| Collaborate on ideas | Share a board | Work with others |
| Have too many pins | Switch to list view | Scan titles quickly |
| Curate my aesthetic | Customize the layout | Make it my own |

---

## Key Concepts

### What is a Board?

A board is a container for pins with:
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

### Board Selector

```
┌───────────────────────────────────────┐
│  Your Boards                    [+]   │
├───────────────────────────────────────┤
│                                       │
│  🛍️ Shopping          12 pins         │
│  📚 Reading List       8 pins         │
│  🎨 Design Inspo      45 pins    ●    │  ← Active
│  🏠 Home Ideas        23 pins         │
│  🎁 Gift Ideas         6 pins         │
│                                       │
│  ─────────────────────────────────    │
│  👥 Shared with me                    │
│                                       │
│  🤝 Team Mood Board    34 pins        │
│                                       │
└───────────────────────────────────────┘
```

---

## Board Components

| Component | Status | Description | See Details |
|-----------|--------|-------------|-------------|
| **Flexible Tagging** | ⚠️ Partial | Categories, sub-tags, content types; freeform tags planned | [Flexible Tagging](../pins/tagging.md) |
| **Visual Grid Browsing** | ✅ Shipped | Responsive grid, card expansion, dense flow | [Grid Layout & Display](./grid-layout.md) |
| **Search & Retrieval** | ✅ Shipped | Live search, category filter, sub-tag filter | [Search & Retrieval](./search.md) |
| **Collection Sharing** | ⚠️ Partial | Export shipped; public boards planned | [Sharing & Collaboration](./sharing.md) |
| **Cross-Category Connections** | ⚠️ Partial | Sub-tags + widget suggestions; explicit connections planned | [Cross-Category](./cross-category.md) |
| **Events Integration** | ❌ Planned | Event/venue pins, calendar view | [Events](./events.md) |

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
