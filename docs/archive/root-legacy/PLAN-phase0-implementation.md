# Phase 0 Implementation Plan

## Generative Widget Ecosystem - Deterministic MVP

**Status:** Planning
**Target:** Complete Phase 0 with 2 working widgets, reliable images, basic instrumentation
**Estimated Effort:** 15-25 hours

---

## 1. Current State Assessment

### What's Built ✅

| Component | Status | Location |
|-----------|--------|----------|
| Edge Function | Working | `supabase/functions/generate-widget/index.ts` |
| Widget Registry | Working | `boards/index.html` (line 3425) |
| Complete the Look widget | Working (no images) | `boards/index.html` (line 4160) |
| Client caching | Working | localStorage with 1hr TTL |
| Server caching | Working | In-memory |
| Brand validation | Working | 47 brands with categories |
| Per-widget refresh | Working | Separate refresh counters |
| Widget feedback | Basic | localStorage |

### What's Broken 🔴

| Issue | Root Cause | Impact |
|-------|------------|--------|
| **Product images not loading** | Bot protection blocking Shopify API & scraping | Widgets show text-only, poor UX |
| **No Style Definition widget** | Not implemented | Missing 50% of Phase 0 scope |
| **No instrumentation** | Not built | Can't measure, can't improve |

### What's Missing 🟡

| Component | Priority | Dependency |
|-----------|----------|------------|
| Supabase CLI setup | HIGH | Blocks debugging |
| SERP API integration | HIGH | Solves image problem |
| Style Definition widget | MEDIUM | Completes Phase 0 |
| Basic event tracking | MEDIUM | Enables Phase 1+ |
| Design system components | LOW | Can refactor later |

---

## 2. Implementation Order

### Phase 0.1: Unblock Development (Day 1)

**Goal:** Get local debugging working

```
┌─────────────────────────────────────────┐
│  0.1.1 Supabase CLI Setup               │
│  ├─ Install supabase CLI                │
│  ├─ Login & link project                │
│  ├─ Set up local env vars               │
│  └─ Test `supabase functions serve`     │
│                  ↓                       │
│  0.1.2 Diagnose Image Pipeline          │
│  ├─ Check Edge Function logs            │
│  ├─ Test Shopify endpoints directly     │
│  ├─ Identify which brands work/fail     │
│  └─ Document findings                   │
└─────────────────────────────────────────┘
```

**Deliverables:**
- [ ] Can run Edge Functions locally
- [ ] Have diagnostic data on image scraping failures
- [ ] Decision on image solution (SERP API vs other)

---

### Phase 0.2: Fix Image Pipeline (Days 2-3)

**Goal:** Images load >90% of the time

```
┌─────────────────────────────────────────┐
│  Option A: SERP API (Recommended)       │
│  ├─ Sign up for SerpApi ($50/month)     │
│  ├─ Add SERP_API_KEY to Supabase        │
│  ├─ Implement SerpApiStrategy           │
│  ├─ Add as fallback in pipeline         │
│  └─ Test across all brands              │
├─────────────────────────────────────────┤
│  Option B: Proxy Service                │
│  ├─ Set up proxy (ScrapingBee, etc.)    │
│  ├─ Route scraping through proxy        │
│  └─ Higher cost, more complexity        │
├─────────────────────────────────────────┤
│  Option C: Image Cache Pre-population   │
│  ├─ Build catalog of common products    │
│  ├─ Store in Supabase Storage           │
│  └─ Limited coverage, maintenance burden│
└─────────────────────────────────────────┘
```

**Recommended: Option A (SERP API)**
- Most reliable (95%+ success rate)
- Reasonable cost ($50/month for 5K searches)
- Easy to implement
- Falls back gracefully

**Implementation Steps:**

```typescript
// 1. Add to Edge Function
async function trySerApi(query: string): Promise<ImageResult> {
  const apiKey = Deno.env.get('SERP_API_KEY')
  if (!apiKey) return { success: false }

  const searchQuery = `${brand} ${productName} product`
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(searchQuery)}&tbm=isch&api_key=${apiKey}`

  const res = await fetch(url)
  const data = await res.json()

  const image = data.images_results?.[0]?.original
  return image
    ? { success: true, imageUrl: image, source: 'serp' }
    : { success: false }
}

// 2. Update image pipeline order
async function resolveProductImage(brand: string, product: string): Promise<string | null> {
  // Try strategies in order
  const strategies = [
    () => tryShopifyApi(brand, product),      // Free, 60% success
    () => trySerpApi(`${brand} ${product}`),  // $0.01/search, 95% success
    () => tryHtmlScrape(brand, product),      // Free, 30% success
  ]

  for (const strategy of strategies) {
    const result = await strategy()
    if (result.success) {
      logImageSuccess(brand, result.source)
      return result.imageUrl
    }
  }

  return null  // Fallback to Google Shopping link
}
```

**Deliverables:**
- [ ] SERP API integrated as fallback
- [ ] Image success rate >90%
- [ ] Logging shows which strategy succeeded

---

### Phase 0.3: Style Definition Widget (Days 4-5)

**Goal:** Second widget working end-to-end

```
┌─────────────────────────────────────────┐
│  0.3.1 Design Widget                    │
│  ├─ Define output schema                │
│  ├─ Write AI prompt                     │
│  └─ Design UI layout                    │
│                  ↓                       │
│  0.3.2 Implement Backend                │
│  ├─ Add to WIDGET_REGISTRY              │
│  ├─ Create prompt template              │
│  └─ Handle in Edge Function             │
│                  ↓                       │
│  0.3.3 Implement Frontend               │
│  ├─ Build renderStyleDefinition()       │
│  ├─ Style CSS                           │
│  └─ Add refresh/feedback actions        │
│                  ↓                       │
│  0.3.4 Test & Iterate                   │
│  ├─ Test with various board types       │
│  ├─ Tune prompt for quality             │
│  └─ Fix edge cases                      │
└─────────────────────────────────────────┘
```

**Widget Definition:**

```javascript
'style-definition': {
  id: 'style-definition',
  version: '1.0',
  name: 'Your Style Profile',
  description: 'AI analyzes your saved items to define your personal style.',
  status: 'active',
  zone: 'hero',
  criteria: {
    category: 'wear',
    minItems: 5,  // Need enough items to analyze
    maxItems: null,
    itemTypes: ['product']
  },
  prompt: `Analyze these clothing and accessory items to define the user's personal style.

ITEMS TO ANALYZE:
{items}

RESPOND WITH JSON:
{
  "styleProfile": {
    "primaryStyle": "minimalist|streetwear|classic|bohemian|athletic|avant-garde",
    "secondaryStyle": "...",
    "pricePoint": "luxury|premium|mid-range|budget",
    "colorPalette": ["color1", "color2", "color3"],
    "keyBrands": ["brand1", "brand2"],
    "styleNotes": "2-3 sentences describing their style",
    "missingElements": "What would complete their wardrobe"
  },
  "confidence": 0.0-1.0
}`
}
```

**Deliverables:**
- [ ] Style Definition renders on wear category boards
- [ ] Shows style profile, color palette, key brands
- [ ] Confidence score tracked (prep for Phase 1)

---

### Phase 0.4: Basic Instrumentation (Days 6-7)

**Goal:** Track enough to measure success

```
┌─────────────────────────────────────────┐
│  0.4.1 Event Schema                     │
│  ├─ Define core events                  │
│  │   • widget.rendered                  │
│  │   • widget.clicked                   │
│  │   • widget.suggestion.clicked        │
│  │   • widget.dismissed                 │
│  │   • widget.feedback.positive/neg     │
│  └─ Add to data attributes              │
│                  ↓                       │
│  0.4.2 Client Collector                 │
│  ├─ Basic track() function              │
│  ├─ Batch to localStorage               │
│  ├─ Flush on page unload                │
│  └─ No server yet (Phase 1)             │
│                  ↓                       │
│  0.4.3 Widget Instrumentation           │
│  ├─ Add data-* attributes               │
│  ├─ Track render events                 │
│  ├─ Track click events                  │
│  └─ Track feedback events               │
└─────────────────────────────────────────┘
```

**Implementation:**

```javascript
// Simple client-side collector (Phase 0)
const widgetAnalytics = {
  events: [],

  track(eventType, widgetContext, payload = {}) {
    this.events.push({
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: Date.now(),
      sessionId: this.getSessionId(),
      ...widgetContext,
      payload
    })

    // Save to localStorage (analyze later)
    localStorage.setItem('widget_events', JSON.stringify(this.events.slice(-500)))
  },

  getSessionId() {
    let id = sessionStorage.getItem('session_id')
    if (!id) {
      id = crypto.randomUUID()
      sessionStorage.setItem('session_id', id)
    }
    return id
  }
}

// Usage in widget render
widgetAnalytics.track('widget.rendered', {
  widgetId: widget.id,
  widgetVersion: widget.version,
  zone: widget.zone,
  confidence: aiResult.confidence || null,
  suggestionCount: aiResult.suggestions?.length || 0
})
```

**Deliverables:**
- [ ] Events stored in localStorage
- [ ] Can export events for analysis
- [ ] Ready to add server ingestion (Phase 1)

---

### Phase 0.5: Polish & Exit Criteria (Day 8)

**Goal:** Phase 0 complete and stable

```
┌─────────────────────────────────────────┐
│  0.5.1 Testing                          │
│  ├─ Test both widgets on various boards │
│  ├─ Test with 2, 5, 10, 20 items        │
│  ├─ Test edge cases (empty, 1 item)     │
│  └─ Test on mobile                      │
│                  ↓                       │
│  0.5.2 Error Handling                   │
│  ├─ Graceful degradation on AI failure  │
│  ├─ Graceful degradation on no images   │
│  ├─ Clear error states in UI            │
│  └─ Console errors cleaned up           │
│                  ↓                       │
│  0.5.3 Documentation                    │
│  ├─ Update TECH spec with changes       │
│  ├─ Document SERP API setup             │
│  └─ Mark Phase 0 complete in backlog    │
└─────────────────────────────────────────┘
```

---

## 3. Dependency Graph

```
                    ┌───────────────────┐
                    │ 0.1 Supabase CLI  │
                    │     Setup         │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
    ┌─────────────────┐ ┌───────────┐ ┌─────────────────┐
    │ 0.2 Fix Image   │ │ 0.3 Style │ │ 0.4 Basic       │
    │     Pipeline    │ │ Definition│ │ Instrumentation │
    │                 │ │   Widget  │ │                 │
    └────────┬────────┘ └─────┬─────┘ └────────┬────────┘
             │                │                │
             └────────────────┼────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │ 0.5 Polish &      │
                    │     Exit Criteria │
                    └───────────────────┘
```

**Can parallelize:** 0.2, 0.3, 0.4 (after 0.1 complete)

---

## 4. Testing Strategy

### Unit Testing (Manual for Phase 0)

| Test | Command | Expected |
|------|---------|----------|
| Shopify API | `curl https://kith.com/products.json?limit=1` | JSON with products |
| SERP API | `curl "https://serpapi.com/search.json?q=nike+air+max&tbm=isch&api_key=XXX"` | JSON with images |
| Edge Function | `supabase functions serve` + POST | AI response |

### Integration Testing

| Scenario | Steps | Expected |
|----------|-------|----------|
| Complete the Look | Add 3 wear items → View board | Widget renders with images |
| Style Definition | Add 5+ wear items → View board | Style profile renders |
| No eligible items | Add 1 item → View board | No widget (criteria not met) |
| Refresh widget | Click refresh button | New suggestions appear |
| Dismiss widget | Click X | Widget hidden, can restore |

### Performance Testing

| Metric | Target | Measurement |
|--------|--------|-------------|
| Widget generation (cold) | <5s | Console timing |
| Widget generation (cached) | <100ms | Console timing |
| Image load time | <2s per image | Network tab |
| Total widget render | <3s | User perception |

---

## 5. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| SERP API costs exceed budget | Low | Medium | Monitor usage, add caching |
| Shopify changes API | Medium | High | SERP fallback covers |
| AI quality inconsistent | Medium | Medium | Server-side validation exists |
| Brand protection blocks SERP | Low | High | Multiple image sources |

---

## 6. Success Criteria

### Must Have (Phase 0 Complete)
- [ ] Complete the Look widget renders with images (>90% success)
- [ ] Style Definition widget renders with meaningful content
- [ ] Both widgets work on eligible wear category boards
- [ ] No console errors in production
- [ ] Basic event tracking in localStorage

### Nice to Have (Stretch)
- [ ] Image success rate >95%
- [ ] Widget generation <3s (cold)
- [ ] Mobile-optimized layouts
- [ ] Events exported to CSV for analysis

---

## 7. Rollout Plan

### Day 1-2: Foundation
- Set up Supabase CLI
- Diagnose image pipeline
- Decide on image solution

### Day 3-4: Image Fix
- Implement SERP API
- Test across brands
- Deploy to production

### Day 5-6: Style Definition
- Implement widget
- Test and tune prompt
- Deploy to production

### Day 7-8: Instrumentation & Polish
- Add basic tracking
- Test all scenarios
- Document and close Phase 0

---

## 8. Next Steps (After Phase 0)

Once Phase 0 is complete, we're ready for:

**Phase 1: Rule-Driven Automation**
- Add confidence thresholds
- Widgets can fail eligibility
- Server-side event ingestion

The basic instrumentation from Phase 0 will provide the data needed to set initial thresholds for Phase 1.

---

## Appendix: Environment Setup

### Supabase CLI Setup

```bash
# Install
npm install -g supabase

# Login
supabase login

# Link to project (get ref from Supabase dashboard)
supabase link --project-ref <your-project-ref>

# Set local env vars
echo "ANTHROPIC_API_KEY=sk-..." >> supabase/.env.local
echo "SERP_API_KEY=..." >> supabase/.env.local

# Serve locally
supabase functions serve --env-file supabase/.env.local

# Test
curl -X POST http://localhost:54321/functions/v1/generate-widget \
  -H "Content-Type: application/json" \
  -d '{"widgetId":"complete-the-look","prompt":"test","items":[]}'
```

### SERP API Setup

1. Sign up at https://serpapi.com/
2. Get API key from dashboard
3. Add to Supabase secrets:
   ```bash
   supabase secrets set SERP_API_KEY=your_key_here
   ```
4. Redeploy Edge Function:
   ```bash
   supabase functions deploy generate-widget
   ```
