# Link Capture & Enrichment

> **Status:** ✅ Shipped
> **Brand Principle:** Organize as you go
> **Key Personas:** All — critical for every persona
>
> Back to [UX Index](../index.md)

Zero-friction capture is the foundation. Paste a URL, get a fully enriched pin. No forms, no decisions at save time.

---

## User Goals

- **Quickly save a link** with minimal friction
- **Paste a URL and get a complete pin** without manual data entry
- **Add multiple links at once** when batch-saving
- **Paste messy text** and have URLs extracted automatically
- **See a preview** of what the pin will look like before saving
- **Get high-quality images** that represent the content

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Find something interesting | Add it in seconds | Not lose it and continue browsing |
| Copy multiple URLs | Paste them all at once | Save time on batch operations |
| Have a URL in clipboard | Be prompted to add it | Add even faster |
| Try to add a duplicate | Be warned before saving | Avoid redundant pins |
| Paste a URL | See title auto-populate | Know it grabbed the right content |
| Add a product link | See the product image | Have a visual reference |
| Add a paywalled link | Still get basic info | Have something rather than nothing |
| See wrong metadata | Edit the enriched data | Correct mistakes |

---

## Wireframes

### Primary Add Button

```
┌──────────────────────────────────────────────────────┐
│  BOARDS                          [Search] [+ Add]   │
└──────────────────────────────────────────────────────┘
                                          ↑
                                    Primary CTA
```

### Add Links Modal (Single URL)

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Paste URL or text containing links:    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ https://                        │    │
│  │                                 │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Category: [ Select... ▾ ]              │
│            [ ] Create new category      │
│                                         │
│           [ Cancel ]  [ Add ]           │
└─────────────────────────────────────────┘
```

### Add Links Modal (Multiple URLs Detected)

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Found 4 URLs:                          │
│                                         │
│  ☑ https://store.com/jacket             │
│  ☑ https://store.com/pants              │
│  ☑ https://store.com/shoes              │
│  ☐ https://tracking.ad/click?... (ad)   │
│                                         │
│  Category: [ Clothing ▾ ]               │
│                                         │
│  [ Select All ] [ Deselect All ]        │
│                                         │
│           [ Cancel ]  [ Add 3 Links ]   │
└─────────────────────────────────────────┘
```

### Clipboard Prompt

```
┌─────────────────────────────────────────┐
│  📋 Link detected in clipboard          │
│                                         │
│  https://example.com/product            │
│                                         │
│  [ Dismiss ]           [ Add to Board ] │
└─────────────────────────────────────────┘
```

### Duplicate Detection

```
┌─────────────────────────────────────────┐
│  ⚠️  This link already exists           │
│                                         │
│  Found in: "Clothing" category          │
│  Added: 3 days ago                      │
│                                         │
│  [ View Existing ]    [ Add Anyway ]    │
└─────────────────────────────────────────┘
```

### Enrichment in Progress

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ https://example.com/product     │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  ◐ Fetching metadata...         │    │
│  │                                 │    │
│  │  ✓ Title found                  │    │
│  │  ◐ Finding best image...        │    │
│  │  ○ Detecting content type       │    │
│  └─────────────────────────────────┘    │
│                                         │
│           [ Cancel ]  [ Add Anyway ]    │
└─────────────────────────────────────────┘
```

### Enrichment Complete Preview

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Preview:                               │
│  ┌─────────────────────────────────┐    │
│  │  ┌───────────┐                  │    │
│  │  │   [img]   │  Product Title   │    │
│  │  │           │  example.com     │    │
│  │  └───────────┘  🛍 Product       │    │
│  │                                 │    │
│  │  Description text appears here  │    │
│  │  automatically from the page... │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Category: [ Uncategorized ▾ ]          │
│                                         │
│           [ Cancel ]  [ Add Pin ]       │
└─────────────────────────────────────────┘
```

### Enrichment Failed State

```
┌─────────────────────────────────────────┐
│  Add Links                        [X]   │
├─────────────────────────────────────────┤
│                                         │
│  ⚠️  Couldn't fetch metadata            │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  Title: [                     ] │    │
│  │                                 │    │
│  │  Description:                   │    │
│  │  [                             ]│    │
│  │  [                             ]│    │
│  │                                 │    │
│  │  Image URL: [                 ] │    │
│  └─────────────────────────────────┘    │
│                                         │
│  URL: example.com/page                  │
│                                         │
│           [ Cancel ]  [ Add Manually ]  │
└─────────────────────────────────────────┘
```

---

## URL Input Handling

### URL Extraction Rules

```
Input: "Check out https://a.com and also
        visit http://b.com for more.
        Don't forget www.c.com!"

Extracted:
  ✓ https://a.com
  ✓ http://b.com
  ✓ https://www.c.com (auto-upgraded)

Filtered out:
  ✗ Tracking URLs (utm_*, fbclid, etc.)
  ✗ Known ad domains
  ✗ Malformed URLs
```

### Normalization

| Input | Normalized |
|-------|------------|
| `example.com` | `https://example.com` |
| `HTTP://EXAMPLE.COM` | `https://example.com` |
| `example.com/page?utm_source=x` | `https://example.com/page` |
| `example.com/page#section` | `https://example.com/page` |

---

## Enrichment Pipeline

```
URL Input
    │
    ▼
┌─────────────────┐
│ Normalize URL   │  → Clean tracking params, add https
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Check Cache     │  → Return cached if fresh (<24h)
└────────┬────────┘
         │ (cache miss)
         ▼
┌─────────────────┐
│ Fetch Page      │  → GET with browser user-agent
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Extract Meta    │  → OG tags, Twitter cards, schema.org
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Find Best Image │  → OG image > schema > first large img
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Classify Type   │  → Product, Article, Video, etc.
└────────┬────────┘
         │
         ▼
    Enriched Pin
```

### Data Extracted

| Field | Sources (Priority Order) |
|-------|-------------------------|
| Title | og:title → twitter:title → `<title>` → h1 |
| Description | og:description → twitter:description → meta description |
| Image | og:image → twitter:image → schema image → largest `<img>` |
| Favicon | /favicon.ico → apple-touch-icon → manifest icons |
| Site Name | og:site_name → domain |
| Content Type | AI classification + rule-based detection |

---

## Key Files

| File | Purpose |
|------|---------|
| `boards/index.html` | `addLink()`, `processLinks()`, `extractUrls()`, `normalizeUrl()`, enrichment pipeline |
| `supabase/functions/enrich-link/` | Server-side metadata fetching and AI classification |

---

## Persona Fit

| Persona | Why This Matters |
|---------|-----------------|
| Visual Collector | Paste-and-done capture keeps them in creative flow |
| Sound & Scene Curator | Handles diverse URL types (Bandcamp, SoundCloud, event pages) |
| DJ | Quick capture while browsing record sites or watching mixes |
| Researcher | Minimal friction means they actually save instead of losing tabs |
| Deep-Dive Enthusiast | Batch paste when dumping a research session |
| Design Technologist | Captures GitHub repos and design tools equally well |

---

## Mobile-First Capture

Boards now includes multiple mobile-first capture methods — see full details in [Mobile Capture](./mobile-capture.md):

| Method | Status | Description |
|--------|--------|-------------|
| **Quick-Add Bar** | ✅ Shipped | Always-visible URL input at bottom of mobile viewport |
| **PWA Share Target** | ✅ Shipped | Share from any app directly to Boards |
| **Deep Link Handler** | ✅ Shipped | `?add=URL` auto-adds links on page load |
| **Bookmarklet** | ✅ Shipped | One-click save from any page via bookmark bar |
| **Image Scan** | ✅ Shipped | Claude Vision extracts products/URLs from photos |

---

## Planned

### Short-term
- Re-enrich button — refresh metadata for existing pins
- Bulk re-enrichment — update all pins in a category
- Image quality scoring — prefer high-res, landscape images
- Browser extension — add from any page with one click

### Medium-term
- Price extraction — pull product prices for shopping links
- Availability tracking — check if products are in stock
- Archive snapshots — save page content in case it goes offline
- Email-to-add — send links to a unique email address

### Long-term
- Server-side scraping fallback (eliminate CORS proxy dependency)
- Batch enrichment for bulk imports
- Classification batching (10-20 URLs per AI call)
- Domain profile caching (skip AI for known single-type domains)
- AI-enhanced descriptions — summarize long content
- Multi-image support — carousel for product galleries
- Paywall bypass — partner with archive services

---

## Technical Notes

- URL extraction via `extractUrls()` regex parser
- Duplicate check happens client-side against loaded pins
- Clipboard access requires user gesture (click) on mobile
- `addLink()` handles single additions; `processLinks()` handles batch with queue
- Enrichment handled by `enrich-link` Supabase Edge Function
- Server-side fetching avoids CORS issues
- 5-minute client cache, 24-hour server cache
- Falls back to favicon + domain if full enrichment fails
- Rate limited to prevent abuse (100 req/min)

---

*See also: [AI Categorization](./ai-categorization.md) · [Multi-Format Content](./multi-format.md) · [Link Management](./link-management.md)*
