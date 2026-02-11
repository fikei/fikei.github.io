# Boards

> Personal link curation with AI categorization and content enrichment

**Status**: Production
**Code**: [`/boards/`](../../boards/)
**Live**: [ctrl.rodeo/boards](https://ctrl.rodeo/boards/)

---

## What it does

Boards lets you save, organize, and discover links across 9 categories (home, wear, watch, listen, use, eat, go, follow, read). AI handles categorization, content enrichment, and generates intelligent widgets that surface patterns in your collection.

## Key capabilities

- **Link capture & enrichment** — Save any URL, AI extracts metadata, images, and content type
- **AI categorization** — Automatic sorting into categories with sub-tags
- **Swiss grid layout** — Responsive card grid with multiple sizes (1x1, 2x1, 2x2, 3x1)
- **AI widget system** — 44 widgets across 11 templates generate recommendations and insights
- **Image validation** — 3-tier pipeline (heuristic, API, AI vision) ensures quality
- **Content type system** — 9 types (product, article, video, music, repository, social, document, tool, unknown)
- **Collaborative boards** — Multi-user sharing (in progress)

## Supabase functions

| Function | Project | Purpose |
|----------|---------|---------|
| `enrich-link` | Boards | Content classification and image resolution |
| `generate-widget` | Boards | AI content generation (Shopify + SERP + scraping) |
| `validate-image` | Boards | Tier 3 AI vision validation |
| `categorize` | Boards | AI category suggestions |
| `enrich-wear` | Boards | Style attribute extraction for fashion |

## Documentation

| Category | Path | Contents |
|----------|------|----------|
| **PRDs** | [`prd/`](prd/) | Product requirements (MVP, widgets, collaboration, content types) |
| **Technical** | [`technical/`](technical/) | Architecture, database schema, API reference, auth system |
| **UX** | [`ux/`](ux/) | User flows for boards, pins, widgets, users, admin |
| **Research** | [`research/`](research/) | Widget catalog, design components, template patterns |
| **Plan** | [`plan/`](plan/) | 10-phase execution plan with backlog |
