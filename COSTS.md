# Operational Costs - ctrl.rodeo

Tracking all products, services, and their associated costs.

---

## Monthly Summary

| Category | Monthly Cost | Annual Cost |
|----------|--------------|-------------|
| Hosting & Infrastructure | $0 | $0 |
| AI Services | ~$5-20 | ~$60-240 |
| Domain | $1.25 | $15 |
| **Total** | **~$6-21** | **~$75-255** |

---

## Services Breakdown

### Hosting & Infrastructure

| Service | Plan | Cost | Notes |
|---------|------|------|-------|
| GitHub Pages | Free | $0/mo | Static site hosting |
| Supabase (Boards) | Free tier | $0/mo | Database + Edge Functions + Auth |
| Supabase (Ops) | Free tier | $0/mo | Notion sync functions |
| Supabase (Systemic) | Free tier | $0/mo | Design system analysis |
| Cloudflare | Free | $0/mo | DNS |

**Free tier limits to monitor**:
- Supabase: 500K function invocations/month (current: ~15-30K/month)
- Supabase: 1GB database (current: ~10MB)
- GitHub Actions: 2,000 minutes/month (current: ~200 min/month)

### AI Services

| Service | Plan | Cost | Usage |
|---------|------|------|-------|
| Anthropic (Claude) | Pay-as-you-go | ~$5-15/mo | Haiku for widgets, categorization, enrichment |
| OpenAI | Pay-as-you-go | ~$0-5/mo | GPT-4o mini fallback (minimal) |

#### Per-Operation AI Cost Estimates

| Operation | Model | Tokens (in/out) | Cost/Call | Monthly Calls | Monthly Cost |
|-----------|-------|-----------------|-----------|--------------|-------------|
| Pin categorization | Haiku | ~200/50 | ~$0.0001 | ~200 | ~$0.02 |
| Content type classification | Haiku | ~300/100 | ~$0.0002 | ~200 | ~$0.04 |
| Widget generation | Haiku | ~800/500 | ~$0.0008 | ~100 | ~$0.08 |
| Agent operations | Haiku | ~1000/500 | ~$0.001 | ~50 | ~$0.05 |

**Note**: Domain profile caching significantly reduces classification calls. After ~5 pins from a domain, future pins skip the AI call entirely.

### Domains

| Domain | Registrar | Cost | Renewal |
|--------|-----------|------|---------|
| ctrl.rodeo | (TBD) | ~$15/yr | (TBD) |

### Free Integrations

| Service | Plan | Notes |
|---------|------|-------|
| Notion | Free | Personal workspace, synced via edge function |
| GitHub | Free | Source control + Actions |
| Google Fonts | Free | Space Grotesk CDN |
| Google Favicons | Free | 128px favicon generation |
| Vimeo API | Free | Video metadata (no key required) |
| Unsplash API | Free tier | Image search fallback (50 req/hour) |
| allorigins.win | Free | CORS proxy for metadata scraping |
| corsproxy.io | Free | CORS proxy fallback |

---

## Cost Optimization

- **Claude Haiku**: Cheapest Anthropic model (~$0.25/M input, ~$1.25/M output)
- **Domain profile caching**: Amortizes AI cost over repeated domains
- **Client-side enrichment first**: CORS proxies handle basic scraping before expensive server calls
- **skipClassification flag**: Client tells server not to re-classify when it already has high confidence
- **Widget caching**: 1-hour client + server cache prevents redundant AI calls

---

## Billing Schedule

| Service | Billing Cycle | Next Bill |
|---------|---------------|-----------|
| Anthropic | Monthly | (auto) |
| OpenAI | Monthly | (auto) |
| Domain | Annual | (TBD) |

---

## Historical Costs

### 2026

| Month | Total | Notes |
|-------|-------|-------|
| February | TBD | Initial tracking |

---

*Last updated: 2026-02-05*
