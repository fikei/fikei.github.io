# API Reference

> Request/response contracts for all Supabase Edge Functions

---

## Edge Functions (Boards Project)

Base URL: `https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1`

All functions accept `OPTIONS` for CORS preflight and return:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type
```

---

### POST /enrich-link

Enriches a pin with AI content type classification and image resolution.

**Auth**: Bearer token (authenticated user) or service role key

**Request**:
```json
{
  "url": "https://nike.com/shoes/air-max",
  "title": "Nike Air Max 90",
  "description": "Classic sneaker...",
  "linkId": "abc123",
  "skipClassification": false,
  "skipImage": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | string | Yes | URL to enrich |
| `title` | string | No | Pre-fetched title (avoids re-scrape) |
| `description` | string | No | Pre-fetched description |
| `linkId` | string | No | Link ID to update in database |
| `skipClassification` | boolean | No | Skip AI if client already knows the type |
| `skipImage` | boolean | No | Skip image resolution |

**Response (200)**:
```json
{
  "content_type": "product",
  "type_confidence": 0.95,
  "type_source": "cache",
  "image_url": "https://cdn.shopify.com/...",
  "image_source": "scraped",
  "cached": true
}
```

| Field | Type | Notes |
|-------|------|-------|
| `content_type` | string | product, article, video, music, repository, social, document, tool, unknown |
| `type_confidence` | number | 0-1 |
| `type_source` | string | cache, rules, ai |
| `image_url` | string/null | Resolved image URL |
| `image_source` | string | scraped, platform, searched, generated, template |
| `cached` | boolean | Whether result came from domain profile cache |

**Side effects**: Updates `links` table (if `linkId` provided), updates `domain_profiles` table.

**Source**: `supabase/functions/enrich-link/index.ts`

---

### POST /generate-widget

Generates an AI-powered widget (recommendations, summaries) based on user's pins.

**Auth**: Bearer token or API key

**Request — Generate**:
```json
{
  "widgetId": "complete-the-look",
  "prompt": "casual summer outfit",
  "items": [
    {
      "id": "1",
      "title": "Nike Air Force 1",
      "url": "https://nike.com/af1",
      "image": "https://...",
      "domain": "nike.com",
      "category": "wear",
      "content_type": "product"
    }
  ],
  "refreshCount": 0
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `widgetId` | string | Yes | Widget type from registry |
| `prompt` | string | No | User context / override prompt |
| `items` | array | Yes | Pins to analyze |
| `refreshCount` | number | No | Variation counter for cache busting |

**Response — Generate (200)**:
```json
{
  "widget": "complete-the-look",
  "suggestions": [
    {
      "brand": "Stussy",
      "product": "Basic Tee",
      "category": "tops",
      "reason": "Complements the sneakers with...",
      "image": "https://cdn.shopify.com/...",
      "url": "https://stussy.com/products/basic-tee",
      "image_source": "shopify"
    }
  ],
  "confidence": 0.85,
  "meta": {
    "model": "claude-3-haiku-20240307",
    "timing": {
      "ai_ms": 800,
      "enrichment_ms": 1200,
      "total_ms": 2100
    },
    "images": {
      "resolved": 3,
      "failed": 1,
      "methods": { "shopify": 2, "serp": 1 }
    },
    "brands": {
      "requested": 4,
      "valid": 3,
      "replaced": 1
    },
    "cached": false
  }
}
```

**Request — Discover** (find eligible widgets):
```json
{
  "action": "discover",
  "category": "wear",
  "items": [...]
}
```

**Response — Discover (200)**:
```json
{
  "eligible": [
    {
      "id": "complete-the-look",
      "name": "Complete the Look",
      "score": 0.82,
      "zone": "inline",
      "template": "product-grid"
    }
  ]
}
```

**Request — Registry** (get widget catalog):
```json
{
  "action": "registry"
}
```

**Response — Registry (200)**:
```json
{
  "widgets": [
    {
      "id": "complete-the-look",
      "name": "Complete the Look",
      "version": "2.0.0",
      "categories": ["wear"],
      "zone": "inline",
      "template": "product-grid"
    }
  ]
}
```

**Source**: `supabase/functions/generate-widget/index.ts`

---

### POST /categorize

Categorizes a pin using Claude AI.

**Auth**: Bearer token

**Request**:
```json
{
  "url": "https://nike.com/shoes",
  "title": "Nike Air Max",
  "description": "Classic running shoe"
}
```

**Response (200)**:
```json
{
  "category": "wear",
  "confidence": 0.92
}
```

**Source**: `supabase/functions/categorize/index.ts`

---

### POST /scan-image

Analyzes uploaded images using Claude Vision to extract products, URLs, and content.

**Auth**: API key or Bearer token

**Request**:
```json
{
  "image": "base64EncodedImageData",
  "mimeType": "image/jpeg"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `image` | string | Yes | Base64-encoded image data (no data URI prefix) |
| `mimeType` | string | No | `image/jpeg`, `image/png`, `image/webp`, or `image/gif` (default: `image/jpeg`) |

**Response (200)**:
```json
{
  "items": [
    {
      "title": "Nike Air Max 90",
      "description": "Classic white and red sneakers",
      "url": "https://nike.com/air-max-90",
      "category": "wear",
      "confidence": 0.85
    },
    {
      "title": "iPhone screenshot of Notion page",
      "description": "A Notion workspace showing project tasks",
      "url": null,
      "category": "use",
      "confidence": 0.70
    }
  ]
}
```

| Field | Type | Notes |
|-------|------|-------|
| `items` | array | Identified products, content, or items in the image |
| `items[].title` | string | Short descriptive name (max 200 chars) |
| `items[].description` | string | Brief description (max 500 chars) |
| `items[].url` | string/null | Suggested URL if identifiable (brand site, product page), null otherwise |
| `items[].category` | string | `home`, `wear`, `watch`, `listen`, `use`, `eat`, `go`, `follow`, `read`, or `uncategorized` |
| `items[].confidence` | number | 0-1 confidence score |

**Use cases**:
- **Screenshot scanning**: Extract URLs from browser screenshots or app shares
- **Product recognition**: Identify brands/products from photos
- **Receipt/invoice scanning**: Extract merchant info and categorize purchases (planned)

**Model**: Claude Sonnet 4 (`claude-sonnet-4-20250514`)

**Source**: `supabase/functions/scan-image/index.ts`

---

## Edge Functions (Ops Project)

Base URL: `https://ycilriwjnmcelkspmfmg.supabase.co/functions/v1`

### POST /notion-sync

Syncs documentation from GitHub to Notion. Used by GitHub Actions.

**Auth**: Service role key only

**Request — Sync Structure**:
```json
{
  "action": "sync-structure",
  "structure": { ... },
  "rootPageId": "notion-page-id"
}
```

**Request — Update Page**:
```json
{
  "action": "update-page",
  "pagePath": "docs/execution/BUGS.md",
  "content": "# Bugs\n...",
  "contentHash": "abc123..."
}
```

**Request — Check Changes**:
```json
{
  "action": "check-changes",
  "pages": [
    { "path": "docs/execution/BUGS.md", "hash": "abc123..." }
  ]
}
```

**Request — Cleanup**:
```json
{
  "action": "cleanup",
  "dryRun": true
}
```

**Source**: `supabase/functions/notion-sync/index.ts`

---

## REST API (Direct Supabase)

The client also calls Supabase's REST API directly (not edge functions) for CRUD operations.

Base URL: `https://yfhudwakpgzswiylhfbh.supabase.co/rest/v1`

### Standard Headers

```
apikey: {SUPABASE_ANON_KEY}
Authorization: Bearer {access_token}
Content-Type: application/json
```

### POST /links (Upsert)

```
Prefer: resolution=merge-duplicates
```

Body matches the `links` table schema. See [Database Schema](./database-schema.md).

### GET /links

```
?user_id=eq.{uid}&select=*
```

### DELETE /links

```
?id=eq.{id}&user_id=eq.{uid}
```

### POST /link_order (Upsert)

```json
{ "user_id": "uuid", "order_ids": ["uuid1", "uuid2"] }
```

### POST /expanded_cards (Upsert)

```json
{ "user_id": "uuid", "cards": { "cardId": true } }
```

---

*Last updated: 2026-02-13*
