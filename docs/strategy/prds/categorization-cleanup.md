# PRD: Categorization Cleanup

**Version:** 1.0
**Date:** 2026-02-19
**Status:** Draft

---

## Overview

Every AI categorization system makes mistakes. ctrl.rodeo currently assigns categories and content types with confidence scores, but pins with low or medium confidence silently live in the wrong place — or pile up in `uncategorized`. There's no mechanism for a user to review, correct, or confirm what the AI decided.

Categorization Cleanup is a dedicated review surface that identifies pins with weak, suspect, or missing metadata and presents them for fast human correction. It turns the AI's uncertainty into an invitation: "I'm not sure about these — take a look?" The result is a cleaner, more trustworthy collection that improves over time as user corrections feed back into the system's domain knowledge.

This is not a widget. Widgets are ephemeral AI-generated recommendations — they appear and disappear. Cleanup is a persistent utility: a queue of work that drains as you act on it. It deserves its own surface, accessible from the main board navigation, with a badge count that communicates "N items need attention" without being noisy.

---

## Goals

1. Surface pins the AI is uncertain about, so users can correct mistakes before they compound
2. Improve collection quality without requiring users to manually audit every pin
3. Feed user corrections back into the categorization system to improve future accuracy
4. Keep the experience fast and low-friction — reviewing a pin should take 2-3 seconds
5. Reduce the `uncategorized` backlog by giving users an easy path to resolve it

---

## Who This Serves

### Primary Personas

| Persona | Why This Matters |
|---------|-----------------|
| **The Visual Collector** | Saves 40+ links across design, fashion, architecture. Miscategorized pins break the visual browsing flow — a furniture link in `wear` is jarring. Needs fast bulk correction. |
| **The Multidisciplinary Maker** | Content spans materials, code, design tools, suppliers. AI struggles with cross-domain links. Needs to correct "is this `use` or `read`?" decisions. |
| **The DJ** | Music links from obscure platforms (Bandcamp subdomains, SoundCloud sets) often get miscategorized. Quick re-sort keeps the dig organized. |

### Secondary Personas

| Persona | Why This Matters |
|---------|-----------------|
| **The Researcher** | Article quality depends on correct categorization for later retrieval. A misplaced article is a lost connection. |
| **The Deep-Dive Enthusiast** | Curates recommendations for friends — accuracy matters because they share from categories. |

### Jobs To Be Done

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Open my board and see the cleanup badge | Quickly review flagged pins | Trust that my collection is accurate |
| See a pin the AI put in the wrong category | Re-categorize it with one tap | Keep my board organized without hunting for mistakes |
| Notice pins stuck in uncategorized | Assign them to the right place | Eliminate the junk drawer feeling |
| See a pin with a bad title or missing image | Fix the metadata inline | Maintain a clean, browsable collection |
| Finish reviewing all flagged pins | See the badge disappear | Feel a sense of completion and trust in the system |

---

## Design Principles

| Brand Principle | Application |
|-----------------|-------------|
| **Organize as you go** | Cleanup is not a chore — it's a 30-second check-in that keeps the system honest |
| **Show, don't decorate** | The pin's own content (image, title, domain) is the UI. Minimal chrome around it. |
| **Expand with the user** | Badge only appears when there's work. New users won't see it until they have enough pins for the AI to be uncertain about something. |
| **Input shapes output** | User corrections make the AI smarter — every cleanup action improves future categorization |

---

## Core Features

### 1. Cleanup Queue

**What it is:** A filtered view of pins that need human attention, ranked by urgency.

**Qualification criteria** — a pin enters the queue if ANY of these are true:

| Signal | Threshold | Priority |
|--------|-----------|----------|
| Category confidence | < 0.65 | High |
| Content in `uncategorized` | Any | High |
| Content type confidence | < 0.50 | Medium |
| Missing image (no image or composite score < 0.15) | Any | Medium |
| Missing title (title is URL slug or empty) | Any | Medium |
| Enrichment failure | `enrichment_failed = true` | Low |
| Missing structured metadata | e.g., `category = 'watch'` but `video` is null | Low |

**Sorting:** High priority first, then by `created_at` descending (newest uncertain pins first — they're freshest in memory).

**Badge count:** Total pins in the queue. Displayed on the cleanup nav item. Refreshed on page load and after each action.

---

### 2. Review Card

**What it is:** An expanded pin card optimized for fast decision-making.

```
┌─────────────────────────────────────────────┐
│  [image]                                    │
│                                             │
│  Title (editable)                           │
│  domain.com                                 │
│  "Description text..." (editable)           │
│                                             │
│  AI says: watch (62% confident)             │
│  ┌─────┬───────┬────────┬───────┬─────────┐ │
│  │ wear│ watch │ listen │ read  │ follow  │ │ ← category chips
│  └─────┴───────┴────────┴───────┴─────────┘ │
│  AI suggested category is pre-selected      │
│                                             │
│  [Confirm]              [Skip]    [Delete]  │
└─────────────────────────────────────────────┘
```

**Behavior:**

- **Image**: Full-width hero. If missing/poor, show a placeholder with "No image" and an optional "Re-fetch image" action.
- **Title**: Inline editable. Tap to edit, tap away to save. Pre-filled with current title.
- **Description**: Inline editable. Collapsed to 2 lines, expandable.
- **Category chips**: All 9 categories displayed as tappable chips. AI's suggestion pre-selected. Tap another to re-categorize. The AI confidence is shown as context ("AI says: watch (62%)") but doesn't constrain the choice.
- **Confirm**: Accept current state (category, title, description). Marks pin as reviewed. Advances to next.
- **Skip**: Move to end of queue. Pin remains flagged.
- **Delete**: Remove pin entirely (with undo toast).

---

### 3. Batch Actions

**What it is:** Multi-select mode for power users who want to process many pins at once.

**Behavior:**

- Long-press or checkbox toggle enters multi-select mode
- Select multiple pins from the queue list view
- Available batch actions:
  - **Move to category** — assign all selected to one category
  - **Delete** — remove all selected (with count confirmation)
  - **Re-enrich** — re-trigger server-side enrichment for all selected (useful for enrichment failures)
- Exit multi-select with "Done" or by tapping outside

---

### 4. Inline Queue (Alternative Entry Point)

**What it is:** A compact banner within the main board view that surfaces when cleanup items exist.

```
┌─────────────────────────────────────────────┐
│  ⚑ 7 pins need review                      │
│  [Review now →]                             │
└─────────────────────────────────────────────┘
```

**Behavior:**

- Appears at the top of the grid when there are 3+ items in the cleanup queue
- Tapping opens the full cleanup view
- Dismissible per session (reappears next visit if items remain)
- Does not appear if the user has dismissed it within the last 24 hours and no new items have been added

This is NOT a widget — it's a system notification banner. It doesn't use the widget infrastructure, doesn't call `generate-widget`, and doesn't have AI-generated content. It's a static prompt.

---

### 5. Feedback Loop

**What it is:** User corrections feed back into the categorization system to improve future accuracy.

**On confirm or re-categorize:**

1. Update the pin's `category`, `confidence` (set to 1.0 for user-confirmed), and `updated_at`
2. Write to `classification_log` with `user_override = true`, recording both the AI's original prediction and the user's correction
3. Update `domain_profiles` if the user's choice differs from the cached domain classification — increment the user-chosen type's count
4. When a domain accumulates 3+ user overrides to the same category, boost that domain's cached confidence for future pins

**On title/description edit:**

1. Update the pin's `title` and/or `description` in both localStorage and Supabase
2. If content type was derived from title keywords, re-evaluate content type classification

---

## Data Model

### No New Tables Required

The cleanup queue is **computed, not stored**. Qualification is derived from existing fields:

```sql
-- Cleanup queue query
SELECT * FROM links
WHERE user_id = :user_id
  AND user_reviewed_at IS NULL
  AND (
    confidence < 0.65
    OR category = 'uncategorized'
    OR type_confidence < 0.50
    OR image IS NULL
    OR (image_scores->>'composite')::float < 0.15
    OR enrichment_failed = true
    OR (category = 'watch' AND video IS NULL)
    OR (category = 'listen' AND music IS NULL)
    OR (category = 'read' AND book IS NULL)
  )
ORDER BY
  CASE
    WHEN category = 'uncategorized' THEN 0
    WHEN confidence < 0.65 THEN 1
    WHEN type_confidence < 0.50 THEN 2
    ELSE 3
  END,
  created_at DESC;
```

### Schema Changes

One new column on the `links` table:

```sql
ALTER TABLE links ADD COLUMN user_reviewed_at TIMESTAMPTZ DEFAULT NULL;
```

**Purpose:** Tracks when a user explicitly confirmed or corrected a pin. Pins with `user_reviewed_at IS NOT NULL` are excluded from the cleanup queue regardless of confidence. This prevents the system from re-flagging pins the user has already approved.

**Why not a boolean?** A timestamp is more useful — it enables future queries like "pins reviewed in the last 30 days" and doesn't lose information.

### Existing Fields Used

| Field | Role in Cleanup |
|-------|----------------|
| `confidence` | Category confidence score — primary cleanup signal |
| `type_confidence` | Content type confidence — secondary signal |
| `category` | Current category assignment — `uncategorized` is a trigger |
| `image` | Null = missing image trigger |
| `image_scores->>'composite'` | Low composite = poor image trigger |
| `enrichment_failed` | Enrichment failure trigger |
| `video`, `music`, `book` | Missing structured metadata trigger |
| `classification_log.user_override` | Existing field — used to record corrections |

### Client-Side Queue

For the local-first architecture, the cleanup queue is also computed client-side from localStorage:

```javascript
function getCleanupQueue(links) {
  return links.filter(link =>
    !link.user_reviewed_at && (
      (link.confidence || 0) < 0.65 ||
      link.category === 'uncategorized' ||
      (link.type_confidence || 0) < 0.50 ||
      !link.image ||
      link.enrichment_failed
    )
  ).sort((a, b) => {
    // Priority sort, then recency
    const priorityA = getPriority(a);
    const priorityB = getPriority(b);
    if (priorityA !== priorityB) return priorityA - priorityB;
    return new Date(b.addedAt) - new Date(a.addedAt);
  });
}
```

---

## User Flows

### Flow 1: Badge-Driven Review

```
1. User opens Boards
2. Category nav shows: [All] [wear] [watch] ... [⚑ 7]
3. User taps cleanup badge
4. Cleanup view opens — first review card displayed
5. User sees pin: "Brutalist Building Tour" — AI says: go (58%)
6. User taps "watch" chip instead (it's a video tour)
7. Taps [Confirm]
8. Pin saved as watch (confidence: 1.0), user_reviewed_at set
9. classification_log entry written with user_override
10. Next card appears — badge count decrements to 6
11. After 3 reviews, user taps back — returns to board
```

### Flow 2: Uncategorized Triage

```
1. User pastes 10 links from various sources
2. AI categorizes 7 with high confidence, 3 land in uncategorized
3. After loading, inline banner appears: "3 pins need review"
4. User taps "Review now"
5. First uncategorized pin shown with all 9 category chips
6. User assigns categories to all 3 pins
7. Banner disappears — uncategorized count drops to 0
```

### Flow 3: Batch Cleanup

```
1. User enters cleanup view — sees 15 items
2. Long-presses to enter multi-select mode
3. Selects 5 pins that are all fashion items miscategorized as "follow"
4. Taps "Move to category" → selects "wear"
5. All 5 updated, removed from queue — count drops to 10
```

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Review card load time | < 200ms (all data is local) |
| Queue computation | < 50ms for 1,000 pins |
| Confirm action feedback | Immediate — card slides out, next slides in |
| Offline support | Full — queue computed from localStorage, synced when online |
| Badge accuracy | Exact count, not approximate |

---

## Why Not a Widget?

Widgets are the wrong abstraction for cleanup because:

1. **Persistence** — Widgets are ephemeral suggestions with 1-hour cache TTLs. Cleanup items persist until resolved. A widget that says "7 pins need review" would regenerate every hour, burning AI tokens to say the same thing.

2. **No AI generation needed** — The cleanup queue is a deterministic computation (confidence < threshold). There's no creative or analytical work for the AI to do. Widget generation calls Claude Haiku to produce recommendations — cleanup just needs a database query.

3. **Editing UX** — Widgets display content; they don't support inline editing of pin metadata. The review card needs editable title, description, and category — that's a form, not a widget.

4. **Counting** — The badge count needs to be exact and update on every action. Widget eligibility scores are approximate and cached.

5. **Completion semantics** — Cleanup has a "done" state (queue empty). Widgets are infinite — there's always another recommendation. The psychological reward of emptying the cleanup queue is part of the feature's value.

**The inline banner** (Feature 4) is the bridge — it's a lightweight prompt within the board view that points to the full cleanup surface. It occupies the same visual space a widget might, but it's static HTML with a count, not an AI-generated card.

---

## Future Considerations

1. **Smart re-enrichment** — When a user changes a pin's category (e.g., `follow` → `watch`), automatically trigger watch-specific enrichment (TMDB lookup, video metadata)
2. **Confidence calibration** — Track the rate at which users override AI decisions per category. If `go` has a 40% override rate, lower its confidence threshold for cleanup flagging.
3. **Suggested corrections** — Instead of just showing all 9 categories, show "Did you mean: watch?" when the AI's #2 prediction was close. Uses the classification model's runner-up.
4. **Collaborative cleanup** — On shared boards, allow collaborators to review and correct pins they didn't add.
5. **Bulk import triage** — When Instagram import (or similar) adds 50+ pins at once, trigger a dedicated triage flow optimized for high-volume review.

---

## Open Questions

1. **Threshold tuning** — Is 0.65 the right category confidence cutoff for flagging? Should it be configurable per user or learn from their correction rate?
2. **Re-flagging** — If the enrichment system re-processes a pin and lowers its confidence after the user reviewed it, should it re-enter the queue? Currently `user_reviewed_at` prevents this permanently.
3. **Gamification** — Should there be any reward for emptying the queue (streak counter, "all clear" animation)? Risk of making it feel like a chore vs. a satisfying micro-task.
4. **Image review** — Should "bad image" pins get a different review card with image selection options (choose from alternatives, upload, or accept template)?
5. **Notification cadence** — Should the inline banner be more aggressive for new users (who benefit most from a clean collection early) and quieter for power users?

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Cleanup queue engagement | 60% of users with flagged pins interact with cleanup | `user_reviewed_at` set / users with queue > 0 |
| Override rate | < 25% of reviewed pins get re-categorized (meaning AI was mostly right) | `classification_log` where `user_override = true` / total reviews |
| Uncategorized reduction | 80% reduction in uncategorized pins per user within 30 days of feature launch | Count of `category = 'uncategorized'` over time |
| Review speed | Median < 3 seconds per pin | Time between card display and confirm action |
| Return rate | Users return to cleanup within 7 days if new items appear | Session tracking |

---

## Related Documents

- [PRD: Boards MVP](./boards-mvp.md) — Core categorization system and confidence model
- [AI Widget System](../../infrastructure/technical-design/ai-widget-system.md) — Widget architecture (for contrast with why cleanup is not a widget)
- [User Personas](../../ux/personas.md) — Persona definitions and JTBD
- [Brand Positioning](../brand-positioning.md) — Brand principles guiding UX decisions
- [Database Schema](../../infrastructure/technical-design/database-schema.md) — Current `links` table schema
