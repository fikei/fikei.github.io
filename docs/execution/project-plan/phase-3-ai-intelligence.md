# Phase 3: AI Intelligence (MOSTLY COMPLETE)

> Back to [Project Plan](./index.md)

---

## Epic 3.1: Content Type System

**Released: 2026-01-15**

| Story | Tasks | Status |
|-------|-------|--------|
| **Rules-Based Classification (Client)** | | Complete |
| | Define BUILTIN_TYPES with domains, patterns, keywords | Complete |
| | Implement classifyByRules() | Complete |
| | Domain profile cache (client-side) | Complete |
| | Integrate into link add flow | Complete |
| **AI Classification (Server)** | | Complete |
| | Create enrich-link Edge Function | Complete |
| | Anthropic classifier (claude-3-haiku) | Complete |
| | Confidence threshold (0.7) | Complete |
| | Parse JSON response | Complete |
| **Dev Tools Integration** | | Complete |
| | "Run AI Enrichment Pipeline" button | Complete |
| | Progress toast during enrichment | Complete |
| | Display content type in admin panel | Complete |

| Story | Tasks | Status |
|-------|-------|--------|
| **Domain Profile Caching (Server)** | | Pending |
| | Create `domain_profiles` table | Pending |
| | Implement DomainProfileManager | Pending |
| | Cache single-type domains (30-day TTL) | Pending |
| | Skip API call for cached domains | Pending |
| **Classification Batching** | | Pending |
| | Implement classification queue | Pending |
| | Batch queue items (10-20 per call) | Pending |
| | Flush queue on timeout/size | Pending |

---

## Epic 3.2: Image Resolution Pipeline

**Released: 2026-01-10**

| Story | Tasks | Status |
|-------|-------|--------|
| **Client-Side Resolution** | | Complete |
| | imageQueue for background processing | Complete |
| | Platform APIs (YouTube, Vimeo, GitHub) | Complete |
| | Integrate into link add flow | Complete |
| **Server-Side Resolution** | | Complete |
| | OG image extraction (no CORS) | Complete |
| | Unsplash API search | Complete |
| | Image source tracking | Complete |
| **Manual Override** | | Pending |
| | "Edit image" button on cards | Pending |
| | Re-fetch, search, upload options | Pending |

---

## Epic 3.3: AI Widget System

**Released: 2026-02-03**

| Story | Tasks | Status |
|-------|-------|--------|
| **Complete the Look Widget** | | Complete |
| | Widget registry architecture | Complete |
| | 47+ brand integrations | Complete |
| | Shopify JSON API integration | Complete |
| | HTML scraping fallback | Complete |
| | Client caching (5 min) | Complete |
| | Server caching (Supabase) | Complete |
| | Per-widget refresh | Complete |
| | Widget feedback (basic) | Complete |

| Story | Tasks | Status |
|-------|-------|--------|
| **Fix Product Images** | | Pending (HIGH PRIORITY) |
| | SERP API integration | Pending |
| | Bot protection bypass | Pending |
| | Image validation | Pending |
| **Style Definition Widget** | | Pending |
| | Extract style attributes from board | Pending |
| | Generate style summary | Pending |
| **Widget Instrumentation** | | Pending |
| | Track widget views | Pending |
| | Track product clicks | Pending |
| | Track saves to board | Pending |
