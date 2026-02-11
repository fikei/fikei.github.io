# Product Requirements Document

## Widget Instrumentation & Analytics System

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-02-03
**Depends On:** Widget Design System, Generative Widget Ecosystem

---

## 1. Executive Summary

The Instrumentation System captures user behavior data from widgets to enable:
1. **Model Training** - Data for self-optimizing system (Phase 4)
2. **A/B Testing** - Compare widget configurations
3. **Health Monitoring** - Track errors, performance, reliability
4. **Product Analytics** - Understand user engagement

This system is embedded in the Design System components and feeds into the optimization loop.

---

## 2. Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERACTION                         │
│   (view, click, save, dismiss, feedback)                        │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLIENT-SIDE COLLECTOR                         │
│   • Capture events with context                                  │
│   • Batch events (queue up to 50 or 5 seconds)                  │
│   • Attach session, experiment, widget metadata                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ POST /track-engagement
┌─────────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTION (Ingestion)                     │
│   • Validate event schema                                        │
│   • Enrich with server-side data                                │
│   • Write to engagement_events table                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    POSTGRES (Raw Storage)                        │
│   • engagement_events (append-only)                              │
│   • experiment_assignments (sticky)                              │
│   • generation_log (AI responses)                                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ Nightly Job
┌─────────────────────────────────────────────────────────────────┐
│                    MODEL TRAINING DATA                           │
│   • Aggregate events per widget render                          │
│   • Calculate engagement scores                                  │
│   • Join with generation context                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ Weekly Job (Phase 4)
┌─────────────────────────────────────────────────────────────────┐
│                    OPTIMIZATION FEEDBACK                         │
│   • Update confidence thresholds                                 │
│   • Adjust ranking weights                                       │
│   • Deprecate underperforming widgets                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Event Taxonomy

### 3.1 Event Schema

All events share a common schema:

```typescript
interface WidgetEvent {
  // Identity
  eventId: string           // UUID, generated client-side
  eventType: WidgetEventType
  timestamp: number         // Unix ms, client time

  // User context
  userId?: string           // Auth user ID (null if anonymous)
  anonymousId: string       // Device-stable ID
  sessionId: string         // Browser session ID

  // Page context
  pageUrl: string
  pageCategory?: string     // Board category being viewed

  // Widget context
  widgetId: string          // e.g., 'complete-the-look'
  widgetType: string        // Same as widgetId for now
  widgetVersion: string     // e.g., '3.0'
  zone: 'hero' | 'inline' | 'footer'
  generationId: string      // Links to generation_log

  // AI context
  confidence: number        // AI confidence (0-1)
  suggestionCount: number   // Number of suggestions shown

  // Experiment context
  experimentId?: string     // A/B test ID
  variantId?: string        // Variant assignment

  // Event-specific payload
  payload: Record<string, any>
}
```

### 3.2 Event Types

#### Lifecycle Events

| Event | When Fired | Payload |
|-------|------------|---------|
| `widget.requested` | Generation API called | `{ inputItemCount }` |
| `widget.generated` | AI returned response | `{ generationTimeMs, cached }` |
| `widget.rendered` | Widget displayed in DOM | `{ renderTimeMs }` |
| `widget.error` | Generation or render failed | `{ errorType, errorMessage }` |

#### Visibility Events

| Event | When Fired | Payload |
|-------|------------|---------|
| `widget.visible` | 50%+ in viewport | `{ visiblePercent }` |
| `widget.hidden` | Left viewport | `{ visibleDurationMs }` |
| `widget.dwelled` | Visible 3+ seconds | `{ dwellMs: 3000 }` |

#### Interaction Events

| Event | When Fired | Payload |
|-------|------------|---------|
| `widget.clicked` | Any click inside widget | `{ targetElement }` |
| `widget.suggestion.clicked` | Clicked a suggestion | `{ suggestionIndex, brand, category }` |
| `widget.suggestion.saved` | Saved to board | `{ suggestionIndex, brand, category }` |
| `widget.refreshed` | User clicked refresh | `{}` |
| `widget.dismissed` | User closed widget | `{ dismissReason? }` |

#### Feedback Events

| Event | When Fired | Payload |
|-------|------------|---------|
| `widget.feedback.positive` | Thumbs up | `{}` |
| `widget.feedback.negative` | Thumbs down | `{}` |
| `widget.feedback.comment` | Comment submitted | `{ comment }` |

#### System Events (Phase 1+)

| Event | When Fired | Payload |
|-------|------------|---------|
| `widget.suppressed` | Didn't render (low confidence) | `{ confidence, threshold }` |
| `widget.skipped` | Didn't render (eligibility) | `{ reason }` |

---

## 4. Client-Side Implementation

### 4.1 Analytics Collector

```typescript
class WidgetAnalytics {
  private queue: WidgetEvent[] = []
  private flushInterval = 5000    // 5 seconds
  private maxQueueSize = 50
  private sessionId: string
  private anonymousId: string

  constructor() {
    this.sessionId = this.getOrCreateSessionId()
    this.anonymousId = this.getOrCreateAnonymousId()

    // Auto-flush on interval
    setInterval(() => this.flush(), this.flushInterval)

    // Flush on page unload
    window.addEventListener('beforeunload', () => this.flush())
  }

  track(
    eventType: WidgetEventType,
    widgetContext: WidgetContext,
    payload: Record<string, any> = {}
  ) {
    const event: WidgetEvent = {
      eventId: crypto.randomUUID(),
      eventType,
      timestamp: Date.now(),

      userId: this.getUserId(),
      anonymousId: this.anonymousId,
      sessionId: this.sessionId,

      pageUrl: window.location.href,
      pageCategory: this.getPageCategory(),

      ...widgetContext,

      payload,
    }

    this.queue.push(event)

    if (this.queue.length >= this.maxQueueSize) {
      this.flush()
    }
  }

  async flush() {
    if (this.queue.length === 0) return

    const events = [...this.queue]
    this.queue = []

    try {
      await fetch('/api/track-engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
        keepalive: true,  // Survives page unload
      })
    } catch (error) {
      // Re-queue on failure (with limit)
      if (this.queue.length < 200) {
        this.queue.unshift(...events)
      }
    }
  }
}

// Singleton instance
export const analytics = new WidgetAnalytics()
```

### 4.2 Visibility Tracking

```typescript
class VisibilityTracker {
  private observer: IntersectionObserver
  private dwellTimers: Map<string, NodeJS.Timeout> = new Map()

  constructor(private analytics: WidgetAnalytics) {
    this.observer = new IntersectionObserver(
      this.handleIntersection.bind(this),
      { threshold: [0.5, 1.0] }
    )
  }

  observe(element: HTMLElement, widgetContext: WidgetContext) {
    element.dataset.widgetContext = JSON.stringify(widgetContext)
    this.observer.observe(element)
  }

  unobserve(element: HTMLElement) {
    this.observer.unobserve(element)
    const timerId = this.dwellTimers.get(element.dataset.widgetId!)
    if (timerId) clearTimeout(timerId)
  }

  private handleIntersection(entries: IntersectionObserverEntry[]) {
    entries.forEach(entry => {
      const context = JSON.parse(
        entry.target.dataset.widgetContext || '{}'
      ) as WidgetContext

      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        // Track visible
        this.analytics.track('widget.visible', context, {
          visiblePercent: entry.intersectionRatio,
        })

        // Start dwell timer
        const timerId = setTimeout(() => {
          this.analytics.track('widget.dwelled', context, {
            dwellMs: 3000,
          })
        }, 3000)

        this.dwellTimers.set(context.widgetId, timerId)
      } else {
        // Track hidden
        const timerId = this.dwellTimers.get(context.widgetId)
        if (timerId) {
          clearTimeout(timerId)
          this.dwellTimers.delete(context.widgetId)
        }
      }
    })
  }
}
```

---

## 5. Server-Side Processing

### 5.1 Ingestion Endpoint

```typescript
// supabase/functions/track-engagement/index.ts

import { createClient } from '@supabase/supabase-js'

Deno.serve(async (req) => {
  const { events } = await req.json()

  // Validate events
  const validEvents = events.filter(validateEventSchema)

  // Enrich with server-side data
  const enrichedEvents = validEvents.map(event => ({
    ...event,
    serverTimestamp: Date.now(),
    userAgent: req.headers.get('user-agent'),
    ip: req.headers.get('x-forwarded-for'),  // For geo (don't store raw)
  }))

  // Batch insert
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_KEY')!
  )

  await supabase
    .from('engagement_events')
    .insert(enrichedEvents)

  return new Response(JSON.stringify({ received: enrichedEvents.length }))
})
```

### 5.2 Training Data Aggregation

Nightly job aggregates raw events into training data:

```sql
-- Aggregate events per widget render into training rows
INSERT INTO model_training_data (
  generation_id,
  widget_id,
  confidence,
  user_id,
  board_category,
  item_count,
  was_rendered,
  was_visible,
  was_dwelled,
  was_clicked,
  was_saved,
  was_dismissed,
  feedback_score,
  engagement_score
)
SELECT
  e.generation_id,
  e.widget_id,
  g.confidence,
  e.user_id,
  g.board_category,
  g.input_item_count,

  -- Outcomes
  bool_or(e.event_type = 'widget.rendered') as was_rendered,
  bool_or(e.event_type = 'widget.visible') as was_visible,
  bool_or(e.event_type = 'widget.dwelled') as was_dwelled,
  bool_or(e.event_type = 'widget.clicked') as was_clicked,
  bool_or(e.event_type = 'widget.suggestion.saved') as was_saved,
  bool_or(e.event_type = 'widget.dismissed') as was_dismissed,

  -- Feedback score
  CASE
    WHEN bool_or(e.event_type = 'widget.feedback.positive') THEN 1
    WHEN bool_or(e.event_type = 'widget.feedback.negative') THEN -1
    ELSE 0
  END as feedback_score,

  -- Engagement score (weighted)
  (
    0.1 * bool_or(e.event_type = 'widget.visible')::int +
    0.2 * bool_or(e.event_type = 'widget.dwelled')::int +
    0.3 * bool_or(e.event_type = 'widget.clicked')::int +
    1.0 * bool_or(e.event_type = 'widget.suggestion.saved')::int +
    0.5 * (bool_or(e.event_type = 'widget.feedback.positive')::int) -
    0.3 * bool_or(e.event_type = 'widget.dismissed')::int -
    0.5 * (bool_or(e.event_type = 'widget.feedback.negative')::int)
  ) as engagement_score

FROM engagement_events e
JOIN generation_log g ON e.generation_id = g.id
WHERE e.timestamp >= NOW() - INTERVAL '1 day'
  AND e.timestamp < NOW()
GROUP BY e.generation_id, e.widget_id, g.confidence,
         e.user_id, g.board_category, g.input_item_count
ON CONFLICT (generation_id) DO UPDATE SET
  engagement_score = EXCLUDED.engagement_score;
```

---

## 6. A/B Testing Framework

### 6.1 Experiment Definition

```typescript
interface Experiment {
  id: string
  name: string
  description: string
  status: 'draft' | 'running' | 'paused' | 'complete'

  // Targeting
  targetPercent: number        // % of users to include
  targetCriteria?: {
    categories?: string[]      // Only these board categories
    minItems?: number          // Minimum items on board
    userCohorts?: string[]     // Specific user segments
  }

  // Variants
  variants: Array<{
    id: string
    name: string
    weight: number             // Relative weight (sum to 100)
    config: Record<string, any>
  }>

  // Metrics
  primaryMetric: 'engagement_score' | 'click_rate' | 'save_rate'
  secondaryMetrics: string[]

  // Timing
  startDate: string
  endDate?: string
  minSampleSize: number
}
```

### 6.2 Assignment Logic

```typescript
async function getExperimentVariant(
  userId: string,
  experimentId: string
): Promise<string | null> {
  const supabase = getSupabaseClient()

  // Check for existing assignment (sticky)
  const { data: existing } = await supabase
    .from('experiment_assignments')
    .select('variant_id')
    .eq('user_id', userId)
    .eq('experiment_id', experimentId)
    .single()

  if (existing) return existing.variant_id

  // Get experiment config
  const { data: experiment } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', experimentId)
    .eq('status', 'running')
    .single()

  if (!experiment) return null

  // Check if user is in target population
  const hash = hashUserId(userId, experimentId)
  if (hash > experiment.targetPercent) return null

  // Assign variant based on weights
  const variantHash = hashUserId(userId, experimentId + '_variant')
  let cumulative = 0
  let assignedVariant = experiment.variants[0].id

  for (const variant of experiment.variants) {
    cumulative += variant.weight
    if (variantHash <= cumulative) {
      assignedVariant = variant.id
      break
    }
  }

  // Persist assignment
  await supabase
    .from('experiment_assignments')
    .insert({
      user_id: userId,
      experiment_id: experimentId,
      variant_id: assignedVariant,
    })

  return assignedVariant
}
```

### 6.3 Results Analysis

```sql
-- Experiment results view
CREATE VIEW experiment_results AS
SELECT
  ea.experiment_id,
  ea.variant_id,
  e.variants->(
    SELECT ordinality - 1
    FROM jsonb_array_elements(e.variants) WITH ORDINALITY
    WHERE value->>'id' = ea.variant_id
  )->>'name' as variant_name,

  COUNT(DISTINCT ea.user_id) as users,
  COUNT(DISTINCT mtd.generation_id) as widget_renders,

  AVG(mtd.engagement_score) as avg_engagement,
  STDDEV(mtd.engagement_score) as stddev_engagement,

  AVG(mtd.was_clicked::int) as click_rate,
  AVG(mtd.was_saved::int) as save_rate,
  AVG(mtd.was_dismissed::int) as dismiss_rate,

  -- Statistical significance (simplified)
  AVG(mtd.engagement_score) /
    NULLIF(STDDEV(mtd.engagement_score) / SQRT(COUNT(*)), 0) as z_score

FROM experiment_assignments ea
JOIN experiments e ON ea.experiment_id = e.id
LEFT JOIN model_training_data mtd ON ea.user_id = mtd.user_id
WHERE e.status IN ('running', 'complete')
GROUP BY ea.experiment_id, ea.variant_id, e.variants;
```

---

## 7. Metrics Dashboard

### 7.1 Key Metrics

| Metric | Calculation | Target |
|--------|-------------|--------|
| **Widget Render Rate** | renders / page_views | >50% |
| **Engagement Rate** | engaged_renders / renders | >30% |
| **Click Rate** | clicks / renders | >10% |
| **Save Rate** | saves / renders | >2% |
| **Dismiss Rate** | dismissals / renders | <10% |
| **Error Rate** | errors / requests | <1% |
| **Cache Hit Rate** | cache_hits / requests | >80% |

### 7.2 Dashboard Views

```typescript
interface WidgetDashboard {
  // Overview
  summary: {
    totalRenders: number
    engagementRate: number
    errorRate: number
    cacheHitRate: number
  }

  // By widget type
  byWidget: Record<string, {
    renders: number
    avgConfidence: number
    engagementRate: number
    clickRate: number
    saveRate: number
  }>

  // By zone
  byZone: Record<string, {
    renders: number
    engagementRate: number
  }>

  // Trends
  dailyTrends: Array<{
    date: string
    renders: number
    engagement: number
    errors: number
  }>

  // Active experiments
  experiments: Array<{
    id: string
    name: string
    status: string
    variants: Array<{
      id: string
      users: number
      engagement: number
      significant: boolean
    }>
  }>
}
```

---

## 8. Privacy & Compliance

### Data Retention

| Data Type | Retention | Reason |
|-----------|-----------|--------|
| Raw events | 90 days | Debugging, analysis |
| Training data | 1 year | Model training |
| Experiment results | Forever | Historical analysis |
| PII (userId) | Per user request | GDPR/CCPA |

### Anonymization

- IP addresses hashed before storage
- User IDs can be deleted on request
- Anonymous IDs not linked to accounts
- No sensitive content in payloads

### User Controls

- Opt-out of analytics (localStorage flag)
- Request data deletion
- Download personal data

---

## 9. Implementation Phases

### Phase 0: Basic Tracking
- [ ] Event schema definition
- [ ] Client collector (no batching)
- [ ] Ingestion endpoint
- [ ] engagement_events table
- [ ] Basic dashboard (admin only)

### Phase 1: Full Instrumentation
- [ ] Batched event collection
- [ ] Visibility tracking (IntersectionObserver)
- [ ] Suppression event tracking
- [ ] generation_log linkage

### Phase 2: A/B Testing
- [ ] Experiment definition UI
- [ ] Assignment logic
- [ ] Results aggregation
- [ ] Statistical significance

### Phase 3: Model Training Pipeline
- [ ] Training data aggregation job
- [ ] Feature engineering
- [ ] Export to ML pipeline

### Phase 4: Closed-Loop Optimization
- [ ] Automated threshold tuning
- [ ] Widget lifecycle management
- [ ] Anomaly detection

---

## 10. Success Criteria

| Phase | Metric | Target |
|-------|--------|--------|
| 0 | Event capture rate | >95% |
| 1 | Visibility tracking accuracy | >99% |
| 2 | Experiment assignment consistency | 100% |
| 3 | Training data freshness | <24 hours |
| 4 | Self-correction time | <48 hours |

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial PRD |
