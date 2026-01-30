# PRD: Things I Like

**Version:** 1.0
**Date:** 2026-01-30
**Status:** Draft

---

## Overview

"Things I Like" is a personal link curation tool that automatically categorizes URLs into broad primitive categories. Users submit links via unstructured text input, and the system fetches metadata, selects hero images, and organizes content into a visually minimal grid following Swiss design principles blended with Web 1.0 aesthetics.

---

## Goals

1. Effortless link capture from mobile or desktop via simple text input
2. Automatic intelligent categorization biased toward primitive categories
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

**Categories:** Bias toward very broad primitives

| Category | Examples |
|----------|----------|
| Media | Articles, videos, music, podcasts, books |
| Tools | Software, apps, utilities, services |
| Places | Restaurants, locations, travel, maps |
| People | Profiles, portfolios, interviews, creators |
| Ideas | Essays, concepts, research, philosophy |

**AI Behavior:**
- Analyze URL metadata (title, description, content type)
- Assign to single most appropriate primitive category
- Confidence threshold: if uncertain, prompt user

**User Override:**
- User can reassign category at any time
- User can request new primitive categories (system learns)

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
- All categories visible as horizontal token/pill buttons
- Sticky positioning (always visible while scrolling)
- Active filter highlighted (inverted: white text on black)
- "All" token selected by default
- Single-select (one category at a time)
- URL updates to reflect filter state (`?category=media`)

**Visual Style:**
```
[All] [Media] [Tools] [Places] [People] [Ideas]
  ^active (inverted)
```

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
  media.md
  tools.md
  places.md
  people.md
  ideas.md
```

**Entry Format:**
```markdown
## [Title](url)

- **added:** 2026-01-30
- **domain:** example.com
- **description:** Optional description text
- **image:** /images/links/[hash].jpg
- **image_source:** fetched | generated

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
4. Custom category creation - user-initiated or AI-suggested only?

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Links added per week | Baseline + growth |
| Categorization accuracy | >90% correct on first assignment |
| Time to add link (mobile) | <10 seconds |
| User overrides of category | <10% of additions |

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
