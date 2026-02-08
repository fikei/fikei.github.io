# AI Categorization

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go
> **Key Personas:** Visual Collector, Sound & Scene Curator, Multidisciplinary Maker, Researcher

AI handles categorization so users stay in flow. The system learns from behavior and gets smarter over time.

---

## What's Shipped

### Two-Layer Classification
1. **Rules-based (client)** — `classifyByRules()` uses domain patterns, URL keywords, and known site mappings for instant classification. Fast, no network call.
2. **AI classification (server)** — `categorizeWithAI()` via `enrich-link` Edge Function uses Claude Haiku when rules are insufficient. Returns content type + category with confidence score.

### Content Types (9 types)
Product, Article, Video, Music, Repository, Social, Document, Tool, Unknown

### Category System
- AI-suggested categories assigned automatically on save
- Category filter bar with counts
- Sub-tags detected via keyword matching within categories
- Sub-tag bar for secondary filtering
- Users can create custom categories
- Move pins between categories

### Dev Tools
- "Run AI Enrichment Pipeline" button in admin panel
- Full recategorization available
- Content type distribution stats

---

## Key Files

| File | Purpose |
|------|---------|
| `boards/index.html` | `classifyByRules()`, `categorizeWithAI()`, `smartCategorize()`, category filter UI |
| `supabase/functions/enrich-link/` | Server-side AI classification |

---

## Persona Fit

| Persona | Why This Matters |
|---------|-----------------|
| Visual Collector | Categories emerge from content — no manual filing |
| Multidisciplinary Maker | Cross-domain saves get categorized without forcing artificial boundaries |
| Researcher | Content types help distinguish articles from tools from repos |
| DJ | Music links auto-detected; but needs richer metadata (see [Tagging](./tagging.md)) |

---

## Planned

- Domain profile caching (server) — skip AI for known domains
- Classification batching — batch queue for bulk operations
- Multi-type domain learning — handle sites that serve multiple content types
- Path pattern learning — understand URL structure patterns per domain

---

*See also: [Link Capture & Enrichment](./link-capture.md) · [Flexible Tagging](./tagging.md)*
