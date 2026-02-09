# Link Management

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go
> **Key Personas:** All
>
> Back to [UX Index](../index.md)

Actions users take on existing pins: editing, deleting, moving between categories, and reordering.

---

## User Goals

- **Edit pin details** when auto-enrichment got it wrong
- **Delete pins** I no longer need
- **Move pins** between categories as my organization evolves
- **Reorder pins** to prioritize what's important
- **Bulk manage** multiple pins at once

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| See wrong metadata | Edit the title/description | Have accurate information |
| No longer need a pin | Delete it easily | Keep my board clean |
| Reconsider organization | Move to different category | Evolve my system |
| Have important pins | Drag them to the top | Find them faster |
| Clean up old pins | Bulk select and delete | Save time |

---

## Wireframes

### Expanded Pin Card (Detail View)

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │                                             │    │
│  │              [Hero Image]                   │    │
│  │                                             │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Product Title Here                                 │
│  ─────────────────                                  │
│  domain.com  •  Added Dec 15, 2024                  │
│                                                     │
│  Description text goes here. This is the full      │
│  description that was extracted from the page.     │
│                                                     │
│  Category: [ Clothing ▾ ]    Type: [ 🛍 Product ▾ ] │
│                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  Open   │ │  Copy   │ │  Edit   │ │ Delete  │   │
│  │   ↗️    │ │   📋    │ │   ✏️    │ │   🗑️    │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Edit Pin Modal

```
┌─────────────────────────────────────────┐
│  Edit Pin                         [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Title:                                 │
│  ┌─────────────────────────────────┐    │
│  │ Product Title Here              │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Description:                           │
│  ┌─────────────────────────────────┐    │
│  │ Description text goes here...   │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Image URL:                             │
│  ┌─────────────────────────────────┐    │
│  │ https://cdn.example.com/img.jpg │    │
│  └─────────────────────────────────┘    │
│  [ Re-fetch Image ]                     │
│                                         │
│           [ Cancel ]  [ Save ]          │
└─────────────────────────────────────────┘
```

### Move to Category Modal

```
┌─────────────────────────────────────────┐
│  Move to Category                 [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Moving: "Product Title Here"           │
│  Current: Uncategorized                 │
│                                         │
│  Select category:                       │
│                                         │
│  ○ Clothing (12)                        │
│  ○ Tech (8)                             │
│  ○ Home (5)                             │
│  ● Wishlist (3)  ← selected             │
│  ○ Inspiration (15)                     │
│                                         │
│  ─────────────────────────              │
│  [ + Create new category ]              │
│                                         │
│           [ Cancel ]  [ Move ]          │
└─────────────────────────────────────────┘
```

### Delete Confirmation

```
┌─────────────────────────────────────────┐
│  Delete Pin?                            │
├─────────────────────────────────────────┤
│                                         │
│  ⚠️  Are you sure you want to delete:   │
│                                         │
│  "Product Title Here"                   │
│  from "Clothing"                        │
│                                         │
│  This action cannot be undone.          │
│                                         │
│           [ Cancel ]  [ Delete ]        │
└─────────────────────────────────────────┘
```

### Bulk Selection Mode

```
┌──────────────────────────────────────────────────────┐
│  ☑ 3 selected            [ Move ] [ Delete ] [ × ]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │ ☑       │  │ ☑       │  │ ☑       │  │ ☐       │ │
│  │ [img]   │  │ [img]   │  │ [img]   │  │ [img]   │ │
│  │ Title   │  │ Title   │  │ Title   │  │ Title   │ │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Drag to Reorder

```
┌─────────┐  ┌─────────┐  ┌ ─ ─ ─ ─ ┐  ┌─────────┐
│         │  │         │            │  │         │
│ Pin 1   │  │ Pin 2   │  │ Pin 3   │  │ Pin 4   │
│         │  │         │    drag    │  │         │
└─────────┘  └─────────┘  └ ─ ─ ─ ─ ┘  └─────────┘
                              ↓
                         ════════════
                          drop zone
```

---

## Actions Summary

| Action | Trigger | Confirmation Required |
|--------|---------|----------------------|
| Open Link | Click "Open" or card | No |
| Copy URL | Click "Copy" | No (toast shown) |
| Edit | Click "Edit" | No |
| Move | Click category or "Move" | No |
| Delete | Click "Delete" | Yes |
| Bulk Move | Select + "Move" | No |
| Bulk Delete | Select + "Delete" | Yes |
| Reorder | Drag and drop | No |

---

## Known Extensions / Future States

### Short-term
- **Undo delete** - 5-second undo toast after deletion
- **Pin archiving** - Hide instead of delete, restore later
- **Favorite pins** - Star important pins for quick access

### Medium-term
- **Pin history** - See all changes made to a pin
- **Merge duplicates** - Combine two pins into one
- **Pin templates** - Create pins with preset categories/types

### Long-term
- **Collaborative editing** - Multiple users edit shared pins
- **Pin comments** - Add notes to pins
- **Pin versioning** - Track changes over time

---

## Technical Notes

- Edits sync to Supabase via `updateLink()`
- Deletes are soft-delete (marked deleted, cleaned up later)
- Reorder updates `order` field and syncs via `syncOrderToSupabase()`
- Bulk operations use `bulkMove()` with batch API calls
- Drag-and-drop uses native HTML5 drag events
