# Search & Filter

Find pins quickly with inline search and category filtering.

**Implementation Status**: ✅ Shipped

| Feature | Status | Notes |
|---------|--------|-------|
| Search Input | ✅ Shipped | In filter bar |
| Client-side Search | ✅ Shipped | Filters title, domain, description, category, URL |
| Clear with Escape | ✅ Shipped | Keyboard shortcut |
| Highlight Matches | ⏳ Planned | Visual highlight in results |
| Keyboard Navigation | ⏳ Planned | j/k, /, ? shortcuts |

---

## User Goals

- **Find a specific pin** quickly without scrolling
- **Search by any attribute** - title, domain, description
- **Clear search easily** to return to full view
- **See feedback** when no results match

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Have many pins | Search by keyword | Find what I'm looking for |
| Remember the domain | Type the domain name | Locate pins from that site |
| Search returns nothing | Clear and try again | Refine my search |
| Want to browse again | Clear search instantly | See all my pins |

---

## Wireframes

### Search Input in Filter Bar ✅ IMPLEMENTED

```
┌─────────────────────────────────────────────────────────────┐
│  BOARDS                                          [+ Add]    │
├─────────────────────────────────────────────────────────────┤
│  [Search...] [ All ] [ Clothing ] [ Tech ] [ Home ]   →     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  [img]  │  │  [img]  │  │  [img]  │  │  [img]  │        │
│  │ Title   │  │ Title   │  │ Title   │  │ Title   │        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Active Search with Results

```
┌─────────────────────────────────────────────────────────────┐
│  BOARDS                                          [+ Add]    │
├─────────────────────────────────────────────────────────────┤
│  [nike     ] [ All ] [ Clothing ] [ Tech ] [ Home ]   →     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐  ┌─────────┐                                   │
│  │  [img]  │  │  [img]  │   ← Only matching pins shown      │
│  │ Nike... │  │ Nike... │                                   │
│  └─────────┘  └─────────┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### No Results State

```
┌─────────────────────────────────────────────────────────────┐
│  BOARDS                                          [+ Add]    │
├─────────────────────────────────────────────────────────────┤
│  [xyz123  ] [ All ] [ Clothing ] [ Tech ] [ Home ]   →      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│              ┌─────────────────────┐                        │
│              │                     │                        │
│              │  No links match     │                        │
│              │  "xyz123"           │                        │
│              │                     │                        │
│              │  [Clear Search]     │                        │
│              │                     │                        │
│              └─────────────────────┘                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Search Behavior

| Input | Matches Against |
|-------|-----------------|
| `nike` | Title, domain, description, category, URL |
| `amazon.com` | Domain and URL |
| `jacket` | Title and description |
| `clothing` | Category name |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Escape` | Clear search, return to full view |
| `/` | Focus search input (planned) |

---

## Component Structure

```
.filters
├── .search-input          # Text input
└── .filter-token          # Category buttons
    └── .filter-token--active
```

---

## Known Extensions / Future States

### Short-term
- **Highlight matches** - Bold/highlight matching text in results
- **Search history** - Recent searches dropdown
- **Keyboard focus** - `/` to focus search

### Medium-term
- **Fuzzy matching** - Typo-tolerant search
- **Search suggestions** - Auto-complete from existing pins
- **Advanced filters** - Date range, content type

### Long-term
- **Full-text search** - Search page content (not just metadata)
- **Saved searches** - Quick access to frequent searches
- **Search analytics** - Track what users search for

---

## Technical Notes

- Search is client-side only (no API calls)
- Case-insensitive matching via `toLowerCase()`
- Search state stored in `searchQuery` variable
- Filter bar re-renders preserve search input value
- Empty results show contextual empty state
- File: `boards/index.html:6166-6185` (search functions)
- CSS: `.search-input` component in same file
