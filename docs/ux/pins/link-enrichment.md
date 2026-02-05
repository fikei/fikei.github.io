# Link Enrichment

Link Enrichment automatically fetches and populates metadata (title, description, images) when users add a URL, transforming bare links into rich, visual pins.

---

## User Goals

- **Paste a URL and get a complete pin** without manual data entry
- **See a preview** of what the pin will look like before saving
- **Get high-quality images** that represent the content
- **Trust that metadata is accurate** and up-to-date

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Paste a URL | See title auto-populate | Know it grabbed the right content |
| Add a product link | See the product image | Have a visual reference |
| Add multiple URLs | Have them all enriched | Save time on batch additions |
| See wrong metadata | Edit the enriched data | Correct mistakes |
| Add a paywalled link | Still get basic info | Have something rather than nothing |

---

## Wireframes

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

---

## Data Extracted

| Field | Sources (Priority Order) |
|-------|-------------------------|
| Title | og:title → twitter:title → `<title>` → h1 |
| Description | og:description → twitter:description → meta description |
| Image | og:image → twitter:image → schema image → largest `<img>` |
| Favicon | /favicon.ico → apple-touch-icon → manifest icons |
| Site Name | og:site_name → domain |
| Content Type | AI classification + rule-based detection |

---

## Known Extensions / Future States

### Short-term
- **Re-enrich button** - Refresh metadata for existing pins
- **Bulk re-enrichment** - Update all pins in a category
- **Image quality scoring** - Prefer high-res, landscape images

### Medium-term
- **Price extraction** - Pull product prices for shopping links
- **Availability tracking** - Check if products are in stock
- **Archive snapshots** - Save page content in case it goes offline

### Long-term
- **AI-enhanced descriptions** - Summarize long content
- **Multi-image support** - Carousel for product galleries
- **Video preview thumbnails** - Animated GIF previews
- **Paywall bypass** - Partner with archive services

---

## Technical Notes

- Enrichment handled by `enrich-link` Supabase Edge Function
- Server-side fetching avoids CORS issues
- 5-minute client cache, 24-hour server cache
- Falls back to favicon + domain if full enrichment fails
- Rate limited to prevent abuse (100 req/min)
