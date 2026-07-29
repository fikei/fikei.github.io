# Monitoring

> System health and observability for ctrl.rodeo

---

## Status Legend

| Icon | Meaning |
|------|---------|
| ✅ | Active |
| 🔄 | Setting Up |
| ⏳ | Planned |

---

## Current Monitoring

### Supabase Dashboard

| Metric | Location | Status |
|--------|----------|--------|
| Database size | Dashboard > Database | ✅ |
| API requests | Dashboard > API | ✅ |
| Function invocations | Dashboard > Functions | ✅ |
| Auth users | Dashboard > Auth | ✅ |
| Storage usage | Dashboard > Storage | ✅ |

### GitHub Actions

| Metric | Location | Status |
|--------|----------|--------|
| Workflow runs | Actions tab | ✅ |
| Build status | Actions > Workflows | ✅ |
| Deployment logs | Actions > Run details | ✅ |

---

## Key Metrics to Track

### Performance

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Page load time | <2s | ~1.5s | ✅ |
| Link enrichment | <3s | ~2s | ✅ |
| Widget generation | <5s | ~3s | ✅ |

### Usage

| Metric | Free Tier Limit | Current |
|--------|-----------------|---------|
| Database rows | 50,000 | Low |
| Function invocations | 500,000/mo | Low |
| Storage | 1GB | <100MB |
| Bandwidth | 2GB/mo | Low |

### Error Rates

| Service | Target | Current |
|---------|--------|---------|
| Edge functions | <1% errors | ✅ |
| Database queries | <0.1% errors | ✅ |
| API calls | <1% errors | ✅ |

---

## Alerts (Planned)

### ⏳ To Be Configured

| Alert | Trigger | Action |
|-------|---------|--------|
| Function errors | >5 errors/min | Email |
| High latency | >5s response | Slack |
| Database near limit | >80% usage | Email |
| API rate limit | >80% quota | Email |

---

## Logging

### Current

| Log | Location | Retention |
|-----|----------|-----------|
| Function logs | Supabase Dashboard | 7 days |
| GitHub Actions | Actions tab | 90 days |
| Database logs | Supabase Dashboard | 7 days |

### Access

```bash
# View Supabase function logs
supabase functions logs agent-handler
supabase functions logs enrich-link

# View recent GitHub Actions
gh run list --limit 10
gh run view <run-id> --log
```

---

## Health Checks

### Manual Checks

```bash
# Test link enrichment
curl -X POST "$SUPABASE_URL/functions/v1/enrich-link" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

---

## Uptime

| Service | Target | Current |
|---------|--------|---------|
| GitHub Pages | 99.9% | ✅ |
| Supabase | 99.9% | ✅ |

---

## Future Improvements

| Improvement | Priority | Status |
|-------------|----------|--------|
| Error alerting via email | High | ⏳ |
| Performance dashboards | Medium | ⏳ |
| Custom metrics | Low | ⏳ |
| Uptime monitoring | Medium | ⏳ |

---

*Last updated: 2026-02-04*
