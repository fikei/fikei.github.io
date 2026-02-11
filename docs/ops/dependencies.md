# Infrastructure Dependencies

> All external services, what happens when they fail, and what they cost

---

## Dependency Map

```
┌─────────────────────────────────────────────────────┐
│                   ctrl.rodeo (Client)                │
│                                                      │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Supabase│  │  CORS    │  │  Google Fonts    │   │
│  │ JS SDK  │  │  Proxies │  │  (Space Grotesk) │   │
│  └────┬────┘  └────┬─────┘  └──────────────────┘   │
└───────┼─────────────┼───────────────────────────────┘
        │             │
        ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Supabase   │  │ allorigins   │  │  corsproxy   │
│   Platform   │  │   .win       │  │    .io       │
│              │  └──────────────┘  └──────────────┘
│ ┌──────────┐ │
│ │ Database │ │  ┌──────────────┐  ┌──────────────┐
│ │ Auth     │ │  │  Anthropic   │  │  Google      │
│ │ Functions│ │  │  Claude API  │  │  Favicons    │
│ └──────────┘ │  └──────────────┘  └──────────────┘
└──────────────┘
                  ┌──────────────┐  ┌──────────────┐
                  │  Vimeo API   │  │  Unsplash    │
                  │  (metadata)  │  │  (images)    │
                  └──────────────┘  └──────────────┘
```

---

## Critical Dependencies

These must be available for core functionality.

### Supabase Platform

| Aspect | Details |
|--------|---------|
| **URL** | `https://yfhudwakpgzswiylhfbh.supabase.co` (Boards), `https://ycilriwjnmcelkspmfmg.supabase.co` (Ops) |
| **Services used** | PostgreSQL, Auth, Edge Functions, REST API |
| **Cost** | $0 (free tier: 500K function invocations/month, 1GB database) |
| **If unavailable** | App continues offline via localStorage. Auth, sync, sharing, widgets, and server enrichment fail. |
| **Loaded from** | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2` (JS SDK) |

### GitHub Pages

| Aspect | Details |
|--------|---------|
| **URL** | `ctrl.rodeo` (CNAME → GitHub Pages) |
| **Services used** | Static hosting, Jekyll build, SSL |
| **Cost** | $0 |
| **If unavailable** | Entire site is down. No static fallback. |

### Anthropic Claude API

| Aspect | Details |
|--------|---------|
| **URL** | `https://api.anthropic.com/v1/messages` |
| **Model** | `claude-3-haiku-20240307` |
| **Used by** | Edge functions (categorize, enrich-link, generate-widget), optionally browser-side classification |
| **Cost** | ~$3-15/month (see [Cost Model](#cost-breakdown)) |
| **If unavailable** | Categorization falls back to rule-based system. Widget generation fails with error message. Content type classification falls back to rules. |

---

## Non-Critical Dependencies

The app degrades gracefully without these.

### CORS Proxy Services

| Aspect | Details |
|--------|---------|
| **URLs** | `https://api.allorigins.win/raw?url=`, `https://corsproxy.io/?` |
| **Used by** | `fetchMetadata()` in `boards/index.html` ~L5614 |
| **Cost** | $0 (free public services) |
| **If unavailable** | Client-side metadata scraping fails. Pins get placeholder title (generated from URL) and no image. Server enrichment can still resolve these later. |
| **Risk** | Third-party services could log request URLs, go down without notice, or introduce latency. No SLA. |

### Google Fonts

| Aspect | Details |
|--------|---------|
| **URL** | `https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700` |
| **Used by** | All pages (loaded in HTML `<head>`) |
| **Cost** | $0 |
| **If unavailable** | Falls back to system `sans-serif`. Layout may shift slightly. |

### Google Favicon Service

| Aspect | Details |
|--------|---------|
| **URL** | `https://www.google.com/s2/favicons?domain={domain}&sz=128` |
| **Used by** | Image resolution fallback for tool/app content types |
| **Cost** | $0 |
| **If unavailable** | Template placeholder image used instead. |

### Vimeo API

| Aspect | Details |
|--------|---------|
| **URL** | `https://vimeo.com/api/v2/video/{id}.json` |
| **Used by** | Image resolution for Vimeo links in `boards/index.html` ~L5246 |
| **Cost** | $0 (free, no key required) |
| **If unavailable** | Vimeo thumbnails unavailable. Falls back to template placeholder. |

### Unsplash API

| Aspect | Details |
|--------|---------|
| **URL** | `https://api.unsplash.com/search/photos` |
| **Used by** | Image search fallback in `boards/index.html` ~L5279 |
| **Auth** | Requires `UNSPLASH_ACCESS_KEY` (optional, stored in `window`) |
| **Cost** | $0 (free tier: 50 requests/hour) |
| **If unavailable** | Template placeholder image used. Most images resolve through other strategies first. |

### Notion API

| Aspect | Details |
|--------|---------|
| **URL** | `https://api.notion.com/v1` |
| **Used by** | `notion-sync` edge function (Ops project) |
| **Auth** | `NOTION_API_KEY` (integration token) |
| **Cost** | $0 (free personal workspace) |
| **If unavailable** | Documentation sync fails. No impact on app functionality. GitHub Actions retry 3x with exponential backoff. |

---

## CDN Dependencies (Loaded at Page Load)

| Resource | URL | Fallback |
|----------|-----|----------|
| Supabase JS SDK | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2` | **None** — auth, sync, sharing break |
| Google Fonts | `fonts.googleapis.com` | System sans-serif |

---

## Cost Breakdown

| Service | Monthly | Pricing Model | Monitor |
|---------|---------|--------------|---------|
| Supabase | $0 | Free tier (500K fn calls, 1GB DB) | Dashboard |
| Anthropic | ~$3-15 | $0.25/M input, $1.25/M output (Haiku) | API usage page |
| GitHub Pages | $0 | Free | GitHub status |
| GitHub Actions | $0 | 2,000 min/month free | Workflow runs |
| Domain (ctrl.rodeo) | ~$1.25 | ~$15/year | Registrar |
| CORS Proxies | $0 | Free public services | None |
| Google Fonts | $0 | Free | None |
| Notion | $0 | Free personal | None |
| **Total** | **~$4-16** | | |

### Per-Operation AI Costs

| Operation | Model | Approx Tokens | Cost/Call | Frequency |
|-----------|-------|--------------|-----------|-----------|
| Link categorization | Haiku | ~200 in, ~50 out | ~$0.0001 | Per pin (if rules confidence < 0.6) |
| Content type classification | Haiku | ~300 in, ~100 out | ~$0.0002 | Per pin (if not cached) |
| Widget generation | Haiku | ~800 in, ~500 out | ~$0.0008 | Per widget view |

---

## Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|-----------|
| CORS proxy shutdown | Medium | Medium | Two proxies with fallback. Could add server-side scraping as Supabase function. |
| Supabase free tier exceeded | High | Low | Monitor usage. Current: ~15-30K invocations/month vs 500K limit. |
| Anthropic API cost spike | Medium | Low | Haiku is cheap. Domain profile caching amortizes costs. |
| jsDelivr CDN outage | High | Very Low | Supabase SDK could be self-hosted. |
| Google Fonts blocked | Low | Low | Add `sans-serif` fallback in CSS (already implicit). |

---

*Last updated: 2026-02-05*
