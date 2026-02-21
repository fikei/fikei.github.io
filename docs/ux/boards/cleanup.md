# Categorization Cleanup

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go
> **Key Personas:** Visual Collector (critical), Deep-Dive Enthusiast (high), Cultural Omnivore (high)
>
> Back to [UX Index](../index.md)

Review and correct AI categorization mistakes in your collection.

| Feature | Status | Notes |
|---------|--------|-------|
| Adaptive Threshold | ✅ Shipped | Dynamic confidence threshold based on collection patterns |
| Review Card UI | ✅ Shipped | Hero image, inline editing, confidence display |
| Category Chips | ✅ Shipped | 9 available categories with visual selection |
| Batch Actions | ✅ Shipped | Confirm, Skip, Delete |
| Filter Bar Indicator | ✅ Shipped | "⚑ Review (N)" pill shows pending count |

---

## User Goals

- **Review flagged pins** that the AI is uncertain about
- **Correct miscategorized pins** quickly without leaving the main view
- **See AI confidence** to understand why items are flagged
- **Make bulk corrections** to keep my collection organized
- **Clear review queue** to maintain collection quality

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Notice a pin is miscategorized | Quickly fix it | Keep my collection organized |
| See a Review badge | Check what needs attention | Clear my review queue |
| Review a flagged pin | See why it was flagged | Understand AI confidence |
| Categorize correctly | Confirm and move on | Train the system better |
| Find a bad pin | Delete it immediately | Keep my collection clean |
| Don't know the right category | Skip for later | Come back when I have more context |

---

## Wireframes

### Filter Bar with Review Indicator ✅ IMPLEMENTED

```
┌─────────────────────────────────────────────────────────────┐
│  BOARDS                                          [+ Add]    │
├─────────────────────────────────────────────────────────────┤
│  [Search] [ All ] [ ⚑ Review (3) ] [ Clothing ] [ Tech ] →  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  [img]  │  │  [img]  │  │  [img]  │  │  [img]  │        │
│  │ Title   │  │ Title   │  │ Title   │  │ Title   │        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Cleanup View with Review Card ✅ IMPLEMENTED

```
┌─────────────────────────────────────────────────────────────┐
│  BOARDS                                          [+ Add]    │
├─────────────────────────────────────────────────────────────┤
│  [Search] [ All ] [ ⚑ Review (3) ] [ Clothing ] [ Tech ] →  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │                    REVIEW QUEUE                       │  │
│  │                                                       │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │                                                 │  │  │
│  │  │            [Hero Image Preview]                │  │  │
│  │  │                                                 │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │                                                       │  │
│  │  Title: Nike Air Max 90                              │  │
│  │  Description: Classic sneaker design...              │  │
│  │                                                       │  │
│  │  AI Confidence: 42% ⚠️                                │  │
│  │                                                       │  │
│  │  Select Category:                                    │  │
│  │  [ Clothing ] [ Tech ] [ Home ] [ Food ]             │  │
│  │  [ Events ] [ Reading ] [ Creative ] [ Travel ] [+]  │  │
│  │                                                       │  │
│  │  [ ✓ Confirm ]  [ → Skip ]  [ 🗑 Delete ]             │  │
│  │                                                       │  │
│  │  Item 1 of 3                                         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Cleanup Behavior

### Activation Rules

- **Minimum pins**: 3+ pins in collection
- **Minimum flagged**: 1+ items below confidence threshold
- **Threshold calculation**: Adaptive based on collection patterns
  - Mean confidence: `avg(all pin confidence scores)`
  - Std deviation: `stddev(all pin confidence scores)`
  - Threshold: `mean - (0.5 * stddev)`

### Queue Logic

Items are flagged for review when:
1. AI confidence score < adaptive threshold, OR
2. Pin was manually marked for review

Items are sorted by:
1. Lowest confidence first
2. Newest first (for ties)

### Actions

| Action | Result |
|--------|--------|
| **Confirm** | Save category selection, remove from queue, show next |
| **Skip** | Leave unchanged, show next item |
| **Delete** | Remove pin permanently, show next item |

---

## Component Structure

```
.cleanup-view
├── .cleanup-card
│   ├── .cleanup-hero          # Hero image
│   ├── .cleanup-title         # Editable title
│   ├── .cleanup-description   # Editable description
│   ├── .cleanup-confidence    # AI confidence percentage
│   ├── .category-chips        # 9 category buttons
│   └── .cleanup-actions       # Confirm/Skip/Delete buttons
└── .cleanup-progress          # "Item N of M"
```

---

## Known Extensions / Future States

### Short-term
- **Batch confirm** - Apply same category to multiple items
- **Keyboard shortcuts** - Number keys for category selection
- **Undo action** - Reverse last confirm/delete

### Medium-term
- **Confidence explanation** - Show why AI chose this category
- **Similar items** - Group flagged items with similar characteristics
- **Auto-train** - User corrections improve future categorization

### Long-term
- **Smart suggestions** - AI learns from user corrections
- **Confidence trends** - Track improvement over time
- **Bulk operations** - Select multiple items to categorize at once

---

## Technical Notes

- Adaptive threshold uses statistical analysis: `computeAdaptiveThreshold()`
- Review queue built by `getCleanupQueue()` - filters pins below threshold
- Cleanup view rendered by `renderCleanupView()` - shows one item at a time
- Actions handled by `handleCleanupAction(action, pinId, newCategory)`
- Confidence stored as decimal (0.0 - 1.0), displayed as percentage
- Category chips are 9 standard categories from the main filter
- Title/description editable inline with auto-save on confirm
- File: `boards/index.html` (lines ~7500-7850)
- CSS: `.cleanup-card` and related styles in same file
- Queue state persists in memory during session, recomputed on refresh
