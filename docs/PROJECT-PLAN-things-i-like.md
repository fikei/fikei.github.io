# Project Plan: Things I Like

## Epic

**Build a personal link curation tool with emergent AI categorization**

A mobile-friendly web app where users paste URLs as unstructured text, and the system automatically fetches metadata, selects hero images, and organizes links into evolving categories displayed in a Swiss/Web 1.0 grid interface.

---

## Stories

### Story 1: Core Infrastructure
*As a developer, I need the foundational project structure so I can build features on a solid base.*

| Task | Description | Priority |
|------|-------------|----------|
| 1.1 | Initialize project with HTML/CSS/JS structure | P0 |
| 1.2 | Set up markdown storage structure (`/content/links/`) | P0 |
| 1.3 | Create CSS reset and Swiss design tokens (typography, spacing, colors) | P0 |
| 1.4 | Implement responsive grid system (min 2 columns) | P0 |
| 1.5 | Set up build/dev tooling (if needed) | P1 |

---

### Story 2: Link Input & Parsing
*As a user, I can paste unstructured text containing URLs so the system extracts and processes them.*

| Task | Description | Priority |
|------|-------------|----------|
| 2.1 | Create mobile-optimized input form (textarea + submit) | P0 |
| 2.2 | Build URL extraction parser (handles mixed text, multiple URLs) | P0 |
| 2.3 | Implement duplicate detection with error messaging | P0 |
| 2.4 | Add loading/processing state UI | P1 |

---

### Story 3: Metadata Fetching
*As a user, I want the system to automatically fetch titles, descriptions, and images from my links.*

| Task | Description | Priority |
|------|-------------|----------|
| 3.1 | Build metadata fetcher (title, description, og:image) | P0 |
| 3.2 | Implement image selection logic (aesthetic guidelines check) | P1 |
| 3.3 | Add fallback image generation placeholder (nanobanana integration) | P2 |
| 3.4 | Store fetched images locally with hash-based naming | P1 |

---

### Story 4: Category System
*As a user, I want my links automatically categorized, with categories that evolve over time.*

| Task | Description | Priority |
|------|-------------|----------|
| 4.1 | Create Uncategorized holding area | P0 |
| 4.2 | Build AI categorization service (analyze content, assign/propose categories) | P0 |
| 4.3 | Implement category creation from clusters | P1 |
| 4.4 | Add category metadata storage (`_categories.md`) | P0 |
| 4.5 | Build category merge/split suggestion system | P2 |

---

### Story 5: Grid Display
*As a user, I can browse my links in a visual grid with hover/tap interactions.*

| Task | Description | Priority |
|------|-------------|----------|
| 5.1 | Build grid item component (hero image + title on hover) | P0 |
| 5.2 | Implement hover state (desktop): show title, domain, category | P0 |
| 5.3 | Implement full-page overlay (mobile/tablet) | P0 |
| 5.4 | Implement animated expansion (desktop) | P1 |
| 5.5 | Add lazy loading for images | P1 |

---

### Story 6: Category Navigation
*As a user, I can filter my links by category using token-style buttons.*

| Task | Description | Priority |
|------|-------------|----------|
| 6.1 | Build token/pill filter component | P0 |
| 6.2 | Implement sticky positioning | P0 |
| 6.3 | Add "All" and "Uncategorized" tokens | P0 |
| 6.4 | Implement URL state sync (`?category=x`) | P1 |
| 6.5 | Add horizontal scroll on overflow (mobile) | P1 |

---

### Story 7: Editing & Management
*As a user, I can edit, delete, and recategorize my saved links.*

| Task | Description | Priority |
|------|-------------|----------|
| 7.1 | Add delete functionality | P0 |
| 7.2 | Add edit title functionality | P1 |
| 7.3 | Add change category functionality | P0 |
| 7.4 | Implement category rename | P1 |
| 7.5 | Add category pin/unpin | P2 |

---

### Story 8: Persistence Layer
*As a developer, I need reliable read/write to markdown storage.*

| Task | Description | Priority |
|------|-------------|----------|
| 8.1 | Build markdown parser for link entries | P0 |
| 8.2 | Build markdown writer for link entries | P0 |
| 8.3 | Implement category file management (create/rename/delete .md files) | P0 |
| 8.4 | Add data migration utilities | P2 |

---

## V1 Scope (MVP)

**Included in V1:**
- [x] Story 1: Core Infrastructure (all tasks)
- [x] Story 2: Link Input & Parsing (2.1, 2.2, 2.3)
- [x] Story 3: Metadata Fetching (3.1 only - basic fetch)
- [x] Story 4: Category System (4.1, 4.2, 4.4 - basic categorization)
- [x] Story 5: Grid Display (5.1, 5.2, 5.3 - core interactions)
- [x] Story 6: Category Navigation (6.1, 6.2, 6.3)
- [x] Story 7: Editing & Management (7.1, 7.3 - delete and recategorize)
- [x] Story 8: Persistence Layer (8.1, 8.2, 8.3)

**Deferred to V2:**
- Animated grid expansion (5.4)
- nanobanana image generation (3.3)
- Category merge/split suggestions (4.5)
- URL state sync (6.4)
- Edit title (7.2)
- Category pin (7.5)

---

## Technical Decisions (V1)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Vanilla JS | Web 1.0 aesthetic, fast loading, no build step |
| Storage | JSON file (localStorage for demo) | Simpler than markdown parsing for MVP |
| AI Categorization | Claude API | Consistent with project tooling |
| Styling | CSS custom properties | Swiss design tokens, no framework |
| Images | Direct og:image URLs | Skip local storage for MVP |

---

## File Structure (V1)

```
/things-i-like/
  index.html              # Main app
  styles.css              # Swiss design system
  app.js                  # Core application logic
  /lib/
    parser.js             # URL extraction
    fetcher.js            # Metadata fetching
    categorizer.js        # AI categorization
    storage.js            # Data persistence
  /data/
    links.json            # All links with categories
```

---

## Build Order

1. **Phase 1: Foundation**
   - Project structure + HTML skeleton
   - Swiss CSS design system
   - Responsive grid

2. **Phase 2: Data Layer**
   - Storage module (localStorage JSON)
   - URL parser
   - Basic metadata fetcher

3. **Phase 3: Categorization**
   - AI categorization logic
   - Category management

4. **Phase 4: UI Components**
   - Input form
   - Grid items
   - Category tokens
   - Mobile overlay

5. **Phase 5: Interactions**
   - Add link flow
   - Filter by category
   - Delete/recategorize
