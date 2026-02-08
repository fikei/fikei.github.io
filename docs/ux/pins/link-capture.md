# Link Capture & Enrichment

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go
> **Key Personas:** All — critical for every persona

Zero-friction capture is the foundation. Paste a URL, get a fully enriched pin. No forms, no decisions at save time.

---

## What's Shipped

### URL Input & Paste Detection
- Textarea input accepts single or batch URLs
- Extracts URLs from messy text (mixed with notes, whitespace, non-URL content)
- Clipboard detection prompts when a URL is detected on page load/focus
- Duplicate detection prevents saving the same URL twice

### Metadata Enrichment Pipeline
Six-step process runs automatically on every save:

```
Normalize URL → Cache check → Fetch metadata → Extract fields → Find image → Classify
```

- **Title, description, domain** extracted from OG tags, Twitter cards, Schema.org
- **Hero image** resolved through platform APIs (YouTube, Vimeo, GitHub) → OG image → Unsplash fallback
- **Content type** assigned via rules-based + AI hybrid (see [AI Categorization](./ai-categorization.md))
- Client cache (5 min) and server cache (24 hr) prevent redundant enrichment

### Server-Side Enrichment
- `enrich-link` Supabase Edge Function handles CORS-free metadata fetching
- Anthropic Claude Haiku for AI classification
- Image source tracking (knows where each image came from)

---

## Key Files

| File | Purpose |
|------|---------|
| `boards/index.html` | `addLink()`, URL extraction, paste handling, enrichment pipeline |
| `supabase/functions/enrich-link/` | Server-side metadata fetching and AI classification |

---

## Persona Fit

| Persona | Why This Matters |
|---------|-----------------|
| Visual Collector | Paste-and-done capture keeps them in creative flow |
| Sound & Scene Curator | Handles diverse URL types (Bandcamp, SoundCloud, event pages) |
| DJ | Quick capture while browsing record sites or watching mixes |
| Researcher | Minimal friction means they actually save instead of losing tabs |

---

## Planned

- Server-side scraping fallback (eliminate CORS proxy dependency)
- Batch enrichment for bulk imports
- Classification batching (10-20 URLs per AI call)
- Domain profile caching (skip AI for known single-type domains)

---

*See also: [AI Categorization](./ai-categorization.md) · [Multi-Format Content](./multi-format.md)*
