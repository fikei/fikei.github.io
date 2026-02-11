# UX Documentation

> Feature-area documentation for ctrl.rodeo, organized by the [persona-to-feature matrix](./personas.md#feature-priority-by-persona).
>
> Each feature area maps to one or more brand principles and user personas.
> See [Brand Positioning](../strategy/brand-positioning.md) and [User Personas](./personas.md).

---

## Feature Area Status

| Feature Area | Status | Key Personas | Brand Principle | Details |
|-------------|--------|-------------|-----------------|---------|
| [Link Capture & Enrichment](./pins/link-capture.md) | ✅ Shipped | All | Organize as you go | URL input, paste detection, metadata extraction, AI enrichment |
| [AI Categorization](./pins/ai-categorization.md) | ✅ Shipped | All except DJ | Organize as you go | Rules-based + AI hybrid classification, content types |
| [Visual Grid Browsing](./boards/grid-layout.md) | ✅ Shipped | Visual Collector, Cultural Omnivore | Show, don't decorate | Responsive grid, card expansion, dense flow |
| [Search & Retrieval](./boards/search.md) | ✅ Shipped | Researcher, Design Technologist | One place, whole life | Live search, category filter, sub-tag filter |
| [Widget System](./widgets/index.md) | ✅ Shipped | All | Input shapes output | Config-driven, template engine, AI generation |
| [Collection Sharing](./boards/sharing.md) | ⚠️ Partial | Maker, Enthusiast, Researcher | Expand with the user | JSON/CSV export shipped; public boards planned |
| [Multi-Format Content](./pins/multi-format.md) | ⚠️ Partial | Curator, DJ, Maker, Technologist | One place, whole life | Links + photos + videos shipped; notes and files planned |
| [Taste & Pattern Surfacing](./widgets/taste-patterns.md) | ⚠️ Partial | DJ, Curator, Researcher, Omnivore | Input shapes output | Widget suggestions shipped; taste profiles planned |
| [Cross-Category Connections](./boards/cross-category.md) | ⚠️ Partial | Curator, Maker, Researcher, Omnivore | One place, whole life | Sub-tags + widget suggestions; explicit connections planned |
| [Flexible Tagging & Metadata](./pins/tagging.md) | ⚠️ Partial | DJ, Technologist, Maker | Organize as you go | Categories + sub-tags + content types; freeform tags planned |
| [Mobile Capture](./pins/mobile-capture.md) | ⚠️ Partial | Visual Collector, DJ, Maker | Organize as you go | Responsive UI + clipboard; Share Target API planned |
| [Events Integration](./boards/events.md) | ❌ Planned | Curator, DJ, Omnivore | One place, whole life | Not yet started |

---

## Supporting Documentation

| Area | Status | Details |
|------|--------|---------|
| [Authentication](./users/authentication.md) | ✅ Shipped | Magic link passwordless auth, session management |
| [Onboarding](./users/onboarding.md) | ⚠️ Partial | Empty state shipped; first-pin celebration, progressive disclosure planned |
| [Settings & Preferences](./users/settings.md) | ⚠️ Partial | Theme toggle, export shipped; widget preferences planned |
| [Admin Panel](./admin-panel.md) | ✅ Shipped | Dev tools, content type stats, cache management |
| [User Personas](./personas.md) | ✅ Complete | 8 active personas, 3 future, JTBD tables, feature matrix |

---

## Research

| Study | Status | Details |
|-------|--------|---------|
| [Widget Template Patterns](./research/widget-template-patterns.md) | Complete | 30 templates analyzed, 7 built |
| [Widget Design Components](./research/widget-design-components.md) | Complete | Component library for widget rendering |
| [Widget Catalog](./research/widget-catalog.md) | Complete | Full catalog of widget types |

---

## How This Maps to Brand Principles

| Principle | Feature Areas |
|-----------|--------------|
| **Input shapes output** | Taste & Pattern Surfacing, Widget System, Cross-Category Connections |
| **Organize as you go** | Link Capture & Enrichment, AI Categorization, Flexible Tagging, Mobile Capture |
| **One place, whole life** | Multi-Format Content, Events Integration, Cross-Category Connections, Search & Retrieval |
| **Show, don't decorate** | Visual Grid Browsing |
| **Expand with the user** | Collection Sharing, Onboarding |

---

*Last updated: 2026-02-08*
