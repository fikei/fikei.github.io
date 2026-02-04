# Project Plan: Board (formerly Things I Like)

## Epic

**Build a personal link curation tool with emergent AI categorization**

A mobile-friendly web app where users paste URLs as unstructured text, and the system automatically fetches metadata, selects hero images, and organizes links into evolving categories displayed in a Swiss/Web 1.0 grid interface.

---

## Current Status

### Completed (V1)
- [x] Core infrastructure (single-file HTML app)
- [x] URL parsing and paste-anywhere input
- [x] Metadata fetching via CORS proxies
- [x] Action-oriented auto-categorization (wear, watch, use, eat, go, follow, read)
- [x] Grid display with grayscale → color hover
- [x] Category filter tokens
- [x] Delete and recategorize functionality
- [x] Drag-and-drop reordering with position indicators
- [x] Light/dark mode with animated toggle
- [x] Resizable card expansion (medium 2×2, large 3×2)
- [x] Expansion state persistence
- [x] Dev menu (Ctrl+Shift+D)
- [x] Progressive link loading (cards appear as fetched)

---

## V2 Roadmap

### Story 9: Grid System Improvements
*As a user, I want cards to align and reflow properly in the grid.*

| Task | Description | Priority |
|------|-------------|----------|
| 9.1 | Fix expanded cards to align to grid tracks properly | P1 |
| 9.2 | Improve reflow behavior when multiple cards expanded | P1 |
| 9.3 | Add CSS Grid subgrid or masonry fallback | P2 |
| 9.4 | Ensure consistent spacing at all breakpoints | P1 |

---

### Story 10: Supabase Backend Migration
*As a user, I want my links synced to the cloud so I can access them from any device.*

| Task | Description | Priority |
|------|-------------|----------|
| 10.1 | Create Supabase project and configure | P0 - User |
| 10.2 | Set up database schema (links table) | P0 |
| 10.3 | Configure Row Level Security policies | P0 |
| 10.4 | Add Supabase JS client to app | P0 |
| 10.5 | Implement auth UI (magic link / OAuth) | P0 |
| 10.6 | Replace localStorage with Supabase queries | P0 |
| 10.7 | Add localStorage → Supabase migration for existing users | P1 |
| 10.8 | Add offline support with sync on reconnect | P2 |

---

## What I Need From You (Supabase Setup)

1. **Create a Supabase project** at https://supabase.com
2. **Share with me:**
   - Project URL (e.g., `https://xxxxx.supabase.co`)
   - Anon/public key (safe to embed in frontend)
3. **Auth provider preferences:**
   - Magic link (email only, simplest)
   - Google OAuth
   - GitHub OAuth
   - Other?

Once you provide the project URL and anon key, I can:
- Set up the database schema via SQL
- Implement auth flows
- Migrate the storage layer

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Vanilla JS | Web 1.0 aesthetic, fast loading, no build step |
| Storage | localStorage → Supabase | Cloud sync across devices |
| Backend | Supabase | Auth + DB + realtime in one, generous free tier |
| Auth | Magic link or OAuth | No password management |
| Styling | CSS custom properties | Swiss design tokens, no framework |
| Images | Direct og:image URLs | Fetched via CORS proxy |

---

## File Structure

```
/board/
  index.html              # Single-file app (HTML + CSS + JS)
```
