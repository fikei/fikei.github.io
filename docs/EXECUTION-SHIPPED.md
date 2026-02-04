# Recently Shipped

> Completed features and improvements

---

## February 2026

### AI Widget System v3.0
**Released: 2026-02-03**

"Complete the Look" product recommendations powered by Claude Haiku.

- 47+ brand integrations (Stüssy, Palace, BAPE, Kith, Nike, etc.)
- Shopify JSON API for product data
- HTML scraping fallback for non-Shopify sites
- Client-side caching (5 min)
- Server-side caching via Supabase
- Graceful degradation when brands unavailable

### Content Type System v2.0
**Released: 2026-01-15**

Automatic content classification for saved links.

- 9 content types: product, article, video, music, repository, social, document, tool, unknown
- Hybrid client/server classification
- Domain profile caching (30-day TTL)
- Confidence scoring (0-100%)
- Manual override capability
- Admin panel for type statistics

### Image Resolution Pipeline
**Released: 2026-01-10**

Multi-source fallback system for link thumbnails.

- Open Graph image extraction
- Twitter card support
- Platform-specific APIs (YouTube, GitHub, Vimeo)
- Favicon fallback
- Product image detection for e-commerce
- Strategy performance tracking

---

## January 2026

### Admin Panel
**Released: 2026-01-08**

Hidden developer tools for system management.

- Keyboard shortcut: `Ctrl+Shift+A`
- Content type statistics
- Image strategy analytics
- Cache management
- Debug mode toggle
- Admin-only access (email whitelist)

### Category Filter Bar
**Released: 2026-01-05**

Quick filtering by category in grid view.

- 8 categories: home, wear, watch, use, eat, go, follow, read
- Active state highlighting
- "All" reset button
- Uncategorized view option
- Sticky header behavior

### Swiss Grid Layout
**Released: 2026-01-01**

Clean, minimal visual presentation.

- Responsive grid system
- Card expansion (2x2, 3x2, 3x3)
- Dark mode default
- Light mode option
- Mobile-optimized spacing

---

## December 2025

### Core Link Management
**Released: 2025-12-15**

Foundation of the Boards application.

- Add links via URL paste
- Auto-enrichment (title, description, image)
- Edit link metadata
- Delete with confirmation
- Duplicate URL detection
- Local storage + Supabase sync

### User Authentication
**Released: 2025-12-10**

Supabase Auth integration.

- Email/password signup
- Magic link login
- Google OAuth
- Anonymous browsing
- Session persistence

---

*Last updated: 2026-02-04*
