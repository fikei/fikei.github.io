# Boards - Changelog

> Release history for the Boards link curation app

---

## [Unreleased]

### In Progress
- Collaborative boards with role-based access
- Public board sharing via links
- Real-time sync for shared boards

---

## [1.0.0] - 2026-02-04

### Added
- **AI Widget System**: "Complete the Look" product recommendations
  - 47+ brand integrations (Stüssy, Palace, BAPE, Kith, etc.)
  - Shopify JSON API integration
  - HTML scraping fallback
  - Client + server caching

- **Content Type System**: Automatic classification
  - 9 content types supported
  - AI-powered detection (Claude Haiku)
  - Confidence scoring (0-100%)
  - Domain profile caching
  - Manual override capability

- **Image Resolution Pipeline**: Multi-source image extraction
  - Open Graph, Twitter Cards, favicon fallback
  - Content-type specific strategies
  - Performance tracking

- **Admin Panel**: Developer tools
  - Keyboard shortcut (Ctrl+Shift+A)
  - Classification analytics
  - Strategy performance stats
  - Cache management

---

## [0.9.0] - 2026-01-XX

### Added
- **Sharing Infrastructure**: Database schema for collaboration
  - shared_boards table
  - board_views analytics
  - board_invites system
  - Unique slug generation

### Changed
- Updated card layout for expansion states
- Added owner_email to snapshots

---

## [0.8.0] - 2026-01-XX

### Added
- **Category System**: 8 categories with AI suggestions
  - home, wear, watch, use, eat, go, follow, read
  - Filter bar with category counts
  - AI-powered category suggestions

### Changed
- Swiss grid layout refinements
- Mobile responsive improvements

---

## [0.7.0] - 2025-12-XX

### Added
- Core link management (add, edit, delete)
- Auto-enrichment (title, description, image)
- Basic duplicate detection
- Dark mode as default

### Changed
- Initial design system integration

---

## Database Migrations

| Version | Migration | Description |
|---------|-----------|-------------|
| 001 | shared_boards.sql | Sharing & collaboration tables |
| 002 | expanded_cards.sql | Card expansion state storage |
| 003 | content_type_system.sql | Content classification |
| 004 | image_resolution_system.sql | Image strategy tracking |

---

## API Changes

### v1.0.0
- `POST /v1/enrich-link` - Content type + image resolution
- `POST /v1/generate-widget` - AI recommendations
- `POST /v1/categorize` - AI category suggestions

---

*Last updated: 2026-02-04*
