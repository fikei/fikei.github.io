# AI Categorization

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go
> **Key Personas:** Visual Collector, Sound & Scene Curator, Multidisciplinary Maker, Researcher
>
> Back to [UX Index](../index.md)

AI handles categorization so users stay in flow. The system learns from behavior and gets smarter over time. No folders to pick. No forms to fill out.

---

## User Goals

- **Have pins auto-classified** without manual data entry
- **Understand at a glance** what type of content a pin represents
- **Filter by type** to find specific content (e.g., "show me only products")
- **Get better recommendations** based on content type patterns
- **Override AI classification** when it gets it wrong

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Add a new link | Have it auto-classified | Save time categorizing manually |
| Browse my board | See visual type indicators | Quickly identify content types |
| Search for products | Filter by "product" type | Find shoppable items fast |
| See a wrong classification | Manually change the type | Keep my data accurate |
| Analyze my collection | See type distribution stats | Understand my saving patterns |
| Add a new pin | Have it assigned a category | Keep organized from the start |
| Wonder about my collection | See category stats | Understand my patterns |

---

## What's Shipped

### Two-Layer Classification

Every pin runs through a hybrid system:

1. **Rules-based (client, instant)** — `classifyByRules()` matches URL patterns, domains, and keywords against built-in type definitions. No network call needed.
2. **AI classification (server, async)** — `categorizeWithAI()` sends title + URL + description to Claude Haiku via the `enrich-link` edge function. Returns category + content type + confidence score.

`smartCategorize()` tries AI first, falls back to rules if the server call fails or returns low confidence.

### Content Type System (9 Types)

| Type | Icon | Detection Signals |
|------|------|-------------------|
| Product | 🛍 | Price, "Add to cart", Shopify/commerce platforms |
| Article | 📰 | Blog structure, publication date, author |
| Video | 🎬 | YouTube, Vimeo, video player embeds |
| Music | 🎵 | Spotify, SoundCloud, Apple Music |
| Repository | 💻 | GitHub, GitLab, code patterns |
| Social | 📱 | Twitter, Instagram, TikTok |
| Document | 📄 | PDF, Google Docs, Notion |
| Tool | 🔧 | SaaS apps, utilities, web tools |
| Unknown | ❓ | No clear signals detected |

### Category Assignment
- AI suggests a category from user's existing categories or proposes new ones
- Confidence threshold (0.7) gates AI assignments
- Users can manually override any category
- Category filter bar with counts
- Sub-tags detected via keyword matching within categories (see [Flexible Tagging](./tagging.md))
- Full recategorization available via admin panel

### AI Category Suggestions

When adding a pin, AI analyzes:
- Pin content type
- Similar pins already categorized
- Domain patterns
- Title/description keywords

### Dev Tools
- "Run AI Enrichment Pipeline" button in admin panel
- Full recategorization available
- Content type distribution stats

---

## Wireframes

### Pin Card with Content Type Badge

```
┌─────────────────────────────────┐
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │      [Hero Image]       │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  Product Name Here              │
│  domain.com                     │
│                                 │
│  ┌──────────┐                   │
│  │ 🛍 Product │  ← Type Badge    │
│  └──────────┘                   │
└─────────────────────────────────┘
```

### Content Type Selection Modal

```
┌─────────────────────────────────────────┐
│  Change Content Type              [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Current: 🛍 Product (87% confidence)   │
│                                         │
│  Select new type:                       │
│                                         │
│  ○ 🛍  Product      ○ 📰 Article        │
│  ○ 🎬 Video        ○ 🎵 Music          │
│  ○ 💻 Repository   ○ 📱 Social         │
│  ○ 📄 Document     ○ 🔧 Tool           │
│  ○ ❓ Unknown                           │
│                                         │
│           [ Cancel ]  [ Save ]          │
└─────────────────────────────────────────┘
```

### Type Distribution (Admin View)

```
┌─────────────────────────────────────────┐
│  Content Type Distribution              │
├─────────────────────────────────────────┤
│                                         │
│  🛍 Product    ████████████████░░ 68%   │
│  📰 Article   ████████░░░░░░░░░░ 18%   │
│  🎬 Video     ███░░░░░░░░░░░░░░░  7%   │
│  🔧 Tool      ██░░░░░░░░░░░░░░░░  4%   │
│  ❓ Unknown   █░░░░░░░░░░░░░░░░░  3%   │
│                                         │
│  Total: 247 pins                        │
└─────────────────────────────────────────┘
```

### Category Assignment (During Add)

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  URL: https://example.com/jacket        │
│                                         │
│  Category:                              │
│  ┌─────────────────────────────────┐    │
│  │ [ Select category...        ▾ ] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ ○ Clothing                      │    │
│  │ ○ Tech                          │    │
│  │ ○ Home                          │    │
│  │ ● Wishlist  ← AI suggested      │    │
│  │ ─────────────────────────────   │    │
│  │ [ + Create new category ]       │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [ Cancel ]  [ Add ]           │
└─────────────────────────────────────────┘
```

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
| DJ | Music links auto-detected; but needs richer metadata (see [Flexible Tagging](./tagging.md)) |

---

## Planned

### Short-term
- Custom content types — let users define their own types
- Type-specific views — different card layouts per type (video thumbnails with duration)
- Bulk reclassification — change type for multiple pins at once

### Medium-term
- Domain profile caching (server) — skip AI for known domains
- Classification batching — batch queue for bulk operations
- Type-based smart folders — auto-organize by content type
- Enhanced metadata per type — products show price, videos show duration
- ML model improvement — learn from user corrections

### Long-term
- Multi-type domain learning — handle sites that serve multiple content types
- Path pattern learning — understand URL structure patterns per domain
- Domain-based type profiles — remember that "store.nike.com" = Product
- Type-specific actions — "Add to cart" for products, "Watch later" for videos

---

## Technical Notes

- Classification happens via `classifyContentType()` / `classifyByRules()` / `smartCategorize()`
- Uses rule-based detection first, falls back to AI classification
- Domain cache stores learned type associations
- Confidence scores range from 0-100%
- Categories stored in Supabase `categories` table
- Category cache in localStorage for offline access
- AI suggestions via `categorizeWithAI()` function
- Bulk moves handled by `bulkMove()` with batch updates

---

*See also: [Link Capture & Enrichment](./link-capture.md) · [Flexible Tagging](./tagging.md)*
