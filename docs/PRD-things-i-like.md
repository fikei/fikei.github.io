# PRD: Boards

**Version:** 1.0
**Date:** 2026-01-30
**Status:** Draft

---

## Overview

Boards is a personal link curation tool that automatically categorizes URLs into emergent, evolving categories. Users submit links via unstructured text input, and the system fetches metadata, selects hero images, and organizes content into a visually minimal grid following Swiss design principles blended with Web 1.0 aesthetics. Categories are not predefined—they emerge organically from the content you save and evolve as your collection grows.

---

## Goals

1. Effortless link capture from mobile or desktop via simple text input
2. Intelligent categorization that evolves with your collection
3. Clean, fast, distraction-free browsing of saved links
4. User control over categorization and organization

---

## Design Principles

### Visual Language: Swiss + Web 1.0

| Principle | Implementation |
|-----------|----------------|
| Typography | Helvetica Neue / system sans-serif, clear hierarchy |
| Color | Black and white only, no accent colors |
| Grid | Strict mathematical grid, never fewer than 2 columns |
| Whitespace | Generous, functional spacing |
| Decoration | None. No gradients, shadows, or ornament |
| Imagery | High-contrast, editorial hero images |
| Interaction | Light, functional. No animation for decoration |

### Aesthetic Guidelines for Hero Images

Images must meet these criteria to be displayed:

- High contrast
- Minimal visual clutter
- No text overlays or watermarks
- Editorial or documentary quality
- Works in black and white

If no image from the URL meets these criteria, generate one using **nanobanana** (Google AI image tool) with a prompt derived from the link's content.

---

## Core Features

### 1. Link Input

**Method:** Web form accepting unstructured text

**Behavior:**
- Parse single or multiple URLs from freeform text
- Accept messy input (URLs mixed with notes, line breaks, etc.)
- Mobile-optimized input field
- Submit triggers processing pipeline

**Example Input:**
```
check this out https://example.com/article
and also example.org/cool-thing
maybe later: another-site.com/resource
```

**Output:** 3 links extracted and queued for processing

---

### 2. Automatic Categorization

**Categories:** Emergent and evolving—no predefined set

Categories are generated dynamically based on the content you save. The system learns your interests and organizes accordingly.

**Category Lifecycle:**

| Phase | Behavior |
|-------|----------|
| **Genesis** | First link creates an "Uncategorized" holding area |
| **Emergence** | After 3-5 similar links, AI proposes a new category |
| **Growth** | Categories expand as more related content is added |
| **Splitting** | Large categories (15+ items) may split into subcategories |
| **Merging** | AI suggests merging similar low-population categories |
| **Retirement** | Empty categories auto-archive after 30 days |

**AI Behavior:**

```
New link submitted
    │
    ▼
Analyze content (title, description, domain, content type)
    │
    ▼
Compare against existing categories
    │
    ├─ Strong match (>80% confidence) ──► Assign to category
    │
    ├─ Partial match (50-80%) ──► Assign + flag for review
    │
    ├─ Weak match (<50%) ──► Check for cluster potential
    │       │
    │       ├─ 3+ similar uncategorized ──► Propose new category
    │       │
    │       └─ <3 similar ──► Place in Uncategorized
    │
    └─ No match ──► Place in Uncategorized
```

**Category Naming:**
- AI generates short, primitive names (1-2 words max)
- Bias toward concrete nouns over abstract concepts
- Examples: "Music", "Recipes", "Code", "Essays", "Gear", "Places"
- Avoid: "Interesting Things", "Stuff I Like", "Miscellaneous"

**User Controls:**
- Rename any category
- Merge two categories into one
- Split a category manually
- Move links between categories
- Delete a category (links move to Uncategorized)
- Pin categories to prevent auto-merge/split

**Evolution Triggers:**

| Trigger | Action |
|---------|--------|
| 3+ uncategorized links cluster | Propose new category |
| Category reaches 15+ items | Suggest split options |
| Two categories <5 items each, similar | Suggest merge |
| User moves 3+ links to same category | Increase AI confidence for that pattern |
| User rejects AI assignment 3x | Lower confidence, learn from corrections |

---

### 3. Metadata Fetching

For each URL, fetch:

| Field | Source | Required |
|-------|--------|----------|
| Title | `<title>` or `og:title` | Yes |
| Description | `meta description` or `og:description` | No |
| Hero Image | `og:image`, largest content image, or generated | Yes |
| Favicon | `/favicon.ico` or `<link rel="icon">` | No |
| Domain | Parsed from URL | Yes |

**Image Selection Priority:**
1. `og:image` if meets aesthetic guidelines
2. Largest content image if meets aesthetic guidelines
3. Generate via nanobanana if no suitable image

---

### 4. Grid Display

**Layout:**
- Strict grid, minimum 2 columns at all breakpoints
- Items display hero image with title overlay on hover

**Responsive Behavior:**

| Breakpoint | Columns | Interaction |
|------------|---------|-------------|
| Mobile (<600px) | 2 | Tap opens full-page overlay |
| Tablet (600-1024px) | 3-4 | Tap opens full-page overlay |
| Desktop (>1024px) | 4-6 | Hover reveals details, click expands in-place (animated) |

**Grid Item States:**
- Default: Hero image only
- Hover (desktop): Title, domain, category badge
- Expanded (desktop): Animated scale-up with full metadata, actions
- Overlay (mobile/tablet): Full-page takeover with all details

---

### 5. Category Navigation

**Implementation:** Persistent token-style filters at top

**Behavior:**
- All active categories visible as horizontal token/pill buttons
- Categories ordered by: pinned first, then by item count (descending)
- Sticky positioning (always visible while scrolling)
- Active filter highlighted (inverted: white text on black)
- "All" token always first, selected by default
- "Uncategorized" token appears when items exist (shows count badge)
- Single-select (one category at a time)
- URL updates to reflect filter state (`?category=music`)
- Horizontal scroll on overflow (mobile)

**Visual Style:**
```
[All] [Music] [Code] [Essays] [Recipes] [Uncategorized (3)]
  ^active (inverted)
```

**Dynamic Updates:**
- New categories animate in when created
- Categories fade out when emptied
- Count badges update in real-time

---

### 6. Editing & Management

**Available Actions:**

| Action | Access Point |
|--------|--------------|
| Delete link | Expanded view / overlay |
| Edit title | Expanded view / overlay |
| Change category | Expanded view / overlay |
| Move to different position | Drag (desktop only) |

**Duplicate Handling:**
- System checks URL against existing entries (normalized)
- If duplicate detected: **throw error**, do not save
- Error message: "This link already exists in [Category]"

---

## Technical Architecture

### Storage: Markdown (v1)

**File Structure:**
```
/content/links/
  _uncategorized.md      # Holding area for new/unmatched links
  _categories.md         # Category metadata and settings
  music.md               # Dynamically created
  code.md                # Dynamically created
  essays.md              # etc.
  ...
```

**Category Metadata (`_categories.md`):**
```markdown
# Categories

## music
- **created:** 2026-01-15
- **pinned:** false
- **auto_generated:** true
- **item_count:** 12

## code
- **created:** 2026-01-20
- **pinned:** true
- **auto_generated:** true
- **item_count:** 8

---
```

**Entry Format:**
```markdown
## [Title](url)

- **added:** 2026-01-30
- **domain:** example.com
- **description:** Optional description text
- **image:** /images/links/[hash].jpg
- **image_source:** fetched | generated
- **ai_confidence:** 0.85
- **user_verified:** false

---
```

**Future: Database Extension (v2)**

| Consideration | Approach |
|---------------|----------|
| Schema | Preserve markdown field structure |
| Migration | Script to parse markdown into DB rows |
| API | RESTful endpoints mirroring file operations |
| Multi-user | Add `user_id` foreign key |

---

### Image Pipeline

```
URL submitted
    │
    ▼
Fetch og:image
    │
    ├─ Image exists? ──► Evaluate against aesthetic guidelines
    │                         │
    │                         ├─ Pass ──► Download, optimize, store
    │                         │
    │                         └─ Fail ──► Generate via nanobanana
    │
    └─ No image ──► Generate via nanobanana
```

**nanobanana Prompt Template:**
```
Minimal, high-contrast editorial photograph representing [extracted topic].
Black and white aesthetic. No text. No people unless relevant.
Swiss design sensibility.
```

---

## User Flows

### Flow 1: Add Links (Mobile)

```
1. Open app on phone
2. Paste/type unstructured text with URLs
3. Tap "Add"
4. System extracts URLs, shows processing state
5. Links appear in grid under assigned categories
6. If category uncertain, prompt appears for user input
```

### Flow 2: Browse & Filter

```
1. Land on grid view (All selected)
2. Tap category token (e.g., "Tools")
3. Grid filters to show only Tools
4. Tap item → full-page overlay with details
5. Tap outside overlay or X to close
```

### Flow 3: Edit Link

```
1. Expand/open link item
2. Tap edit icon
3. Modify title or category
4. Save
5. Changes reflected immediately
```

### Flow 4: Duplicate Error

```
1. Submit URL that already exists
2. Error displayed: "This link already exists in [Category]"
3. Option to "View existing" or dismiss
```

### Flow 5: Category Emergence

```
1. User adds 5th link about cooking/recipes
2. System detects cluster in Uncategorized
3. Toast notification: "Create 'Recipes' category?"
4. User taps "Create" or "Not now"
5. If created: links animate from Uncategorized to new category
6. New token appears in filter bar
```

### Flow 6: Category Split Suggestion

```
1. "Music" category reaches 18 items
2. AI detects two clusters: electronic + classical
3. Notification: "Split Music into Electronic and Classical?"
4. User can: Accept, Customize names, or Dismiss
5. If accepted: items redistribute, two new tokens appear
```

### Flow 7: Category Merge Suggestion

```
1. "Synths" has 3 items, "Gear" has 4 items
2. AI detects overlap
3. Notification: "Merge Synths into Gear?"
4. User can: Accept, Reverse (Gear into Synths), or Dismiss
5. If accepted: items merge, one token removed
```

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Page load | < 1s on 3G |
| Accessibility | WCAG 2.1 AA |
| Browser support | Last 2 versions of major browsers |
| Offline | Service worker for cached browsing |
| Image optimization | WebP with JPEG fallback, lazy loading |

---

## Future Considerations (Out of Scope for v1)

- Multi-user support with authentication
- Database backend (PostgreSQL)
- Browser extension for one-click saving
- API for third-party integrations
- Search within saved links
- Tags in addition to categories
- RSS feed of additions
- Public sharing / portfolio mode

---

## Open Questions

1. Should there be a "recently added" section on the main view?
2. Archive vs. delete - should deleted items be recoverable?
3. Rate limiting on nanobanana image generation?
4. What's the minimum cluster size to trigger category creation (3? 5?)?
5. Should users be able to manually create empty categories, or only AI-proposed?
6. How long should Uncategorized items wait before prompting user action?

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Links added per week | Baseline + growth |
| AI categorization accepted | >85% without user override |
| Time to add link (mobile) | <10 seconds |
| Uncategorized items | <15% of total at any time |
| Category churn | <2 merges/splits per month after stabilization |
| User-initiated recategorization | <10% of items |

---

## Appendix

### A. Swiss Design References

- Josef Müller-Brockmann grid systems
- Neue Grafik magazine layouts
- International Typographic Style principles

### B. Web 1.0 References

- Early directory sites (Yahoo! circa 1996)
- Text-heavy, fast-loading pages
- Form-based interaction patterns
- Minimal client-side scripting

---

## Related Documents

- [PRD: Collaborative Boards](./PRD-collaborative-boards.md) - Multi-user board sharing
- [PRD: Content Type System](./PRD-content-type-and-image-systems.md) - Automatic content classification
- [TECH: AI Widget System](./TECH-ai-widget-system.md) - Product recommendations
- [Design System](../design-system/README.md) - UI components and tokens
- [Vision & Roadmap](./VISION-AND-ROADMAP.md) - Product strategy
