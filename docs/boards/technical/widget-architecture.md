# Technical Architecture: Generative Widget Ecosystem

**Version:** 1.0
**Last Updated:** 2026-02-03
**Status:** Draft

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Infrastructure Architecture](#2-infrastructure-architecture)
3. [Design System Components](#3-design-system-components)
4. [Instrumentation & Analytics](#4-instrumentation--analytics)
5. [Data Models](#5-data-models)
6. [Cost Projections](#6-cost-projections)

---

## 1. System Overview

### Core Principle

The widget ecosystem is built on **progressive automation** - starting with deterministic rendering and evolving toward self-optimization. The architecture must support both extremes:

- **Phase 0:** "Render this exact widget with this exact template"
- **Phase 4:** "Figure out what to show and optimize it over time"

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                            │
│  Design System Components (primitives, templates, layouts)       │
├─────────────────────────────────────────────────────────────────┤
│                    DECISION LAYER                                │
│  Widget Selection, Ranking, Slot Allocation                      │
├─────────────────────────────────────────────────────────────────┤
│                    GENERATION LAYER                              │
│  AI Prompts, Response Parsing, Content Enrichment                │
├─────────────────────────────────────────────────────────────────┤
│                    DATA LAYER                                    │
│  User Content, Taste Profiles, Engagement History                │
├─────────────────────────────────────────────────────────────────┤
│                    INSTRUMENTATION LAYER                         │
│  Event Tracking, Model Training Data, A/B Experiments            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Infrastructure Architecture

### Service Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Widget       │  │ Design       │  │ Analytics    │  │ Local Cache  │    │
│  │ Orchestrator │  │ System       │  │ Collector    │  │ Manager      │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         └──────────────────┴─────────────────┴─────────────────┘            │
│                                     │                                        │
└─────────────────────────────────────┼────────────────────────────────────────┘
                                      │ HTTPS
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE (Backend-as-a-Service)                      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        EDGE FUNCTIONS (Deno)                         │    │
│  │                                                                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │    │
│  │  │ generate-   │  │ select-     │  │ track-      │  │ optimize-  │ │    │
│  │  │ widget      │  │ widgets     │  │ engagement  │  │ thresholds │ │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │                    SHARED MODULES (_shared/)                   │  │    │
│  │  │                                                                │  │    │
│  │  │  validation-engine.ts    brand-service.ts    image-pipeline.ts│  │    │
│  │  │  prompt-builder.ts       response-parser.ts  taste-profiler.ts│  │    │
│  │  │  analytics-client.ts     experiment-sdk.ts   cache-manager.ts │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         POSTGRES DATABASE                            │    │
│  │                                                                      │    │
│  │  CORE DATA           WIDGET STATE          ANALYTICS                │    │
│  │  ─────────           ────────────          ─────────                │    │
│  │  links               widget_cache          engagement_events        │    │
│  │  categories          widget_feedback       experiment_assignments   │    │
│  │  users               generation_log        model_training_data      │    │
│  │                                                                      │    │
│  │  INTELLIGENCE        HEALTH                CONFIG                   │    │
│  │  ────────────        ──────                ──────                   │    │
│  │  user_taste_profile  validation_health     widget_definitions       │    │
│  │  brand_registry      strategy_performance  experiments              │    │
│  │  domain_profiles     error_log             feature_flags            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌──────────────────────────────────────┐  ┌────────────────────────────┐  │
│  │           REALTIME                    │  │         STORAGE            │  │
│  │  • Widget update subscriptions        │  │  • Cached product images   │  │
│  │  • Engagement event streaming         │  │  • Generated thumbnails    │  │
│  └──────────────────────────────────────┘  └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
┌─────────────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│     ANTHROPIC API       │ │    SERP API     │ │    BRAND APIS           │
│  • Claude 3 Haiku       │ │  • Image search │ │  • Shopify JSON         │
│  • Content generation   │ │  • $0.01/search │ │  • Direct scraping      │
│  • Style analysis       │ │                 │ │                         │
└─────────────────────────┘ └─────────────────┘ └─────────────────────────┘
```

### Service Responsibilities

| Service | Responsibility | Scaling Strategy |
|---------|---------------|------------------|
| **generate-widget** | AI content generation | Cache aggressively, batch requests |
| **select-widgets** | Candidate ranking (Phase 3+) | In-memory scoring, async logging |
| **track-engagement** | Event ingestion | Batch writes, async processing |
| **optimize-thresholds** | Parameter tuning (Phase 4) | Scheduled job, not real-time |

---

## 3. Design System Components

### Component Hierarchy

```
DESIGN SYSTEM
│
├── PRIMITIVES (Atomic)
│   ├── WidgetCard
│   ├── ProductTile
│   ├── SuggestionItem
│   ├── ConfidenceBadge
│   ├── ActionButton
│   ├── LoadingSkeleton
│   └── ErrorState
│
├── PATTERNS (Molecular)
│   ├── ProductGrid
│   ├── SuggestionList
│   ├── ComparisonLayout
│   ├── CarouselScroller
│   └── FeedbackCollector
│
├── TEMPLATES (Organisms)
│   ├── TwoColumnSuggestions
│   ├── HeroFeature
│   ├── InlineRecommendation
│   ├── FooterDiscovery
│   └── FullWidthShowcase
│
└── LAYOUTS (Pages)
    ├── WidgetZone (hero/inline/footer)
    ├── MultiWidgetStack
    └── ResponsiveWidgetGrid
```

### Primitive Components

#### WidgetCard
The base container for all widgets.

```typescript
interface WidgetCardProps {
  // Identity
  widgetId: string
  widgetType: string
  version: string

  // Display
  title: string
  subtitle?: string
  zone: 'hero' | 'inline' | 'footer'

  // State
  loading: boolean
  error?: WidgetError
  confidence?: number  // 0-1, shown in debug mode

  // Instrumentation (auto-attached)
  experimentVariant?: string
  renderTimestamp: number

  // Actions
  onRefresh: () => void
  onDismiss: () => void
  onFeedback: (positive: boolean) => void

  // Content
  children: React.ReactNode
}
```

```html
<!-- Rendered Structure -->
<div class="widget-card"
     data-widget-id="complete-the-look"
     data-widget-version="3.0"
     data-experiment="exp_123:variant_b"
     data-render-ts="1706900000000">

  <div class="widget-header">
    <h3 class="widget-title">Complete the Look</h3>
    <div class="widget-actions">
      <button class="widget-refresh" aria-label="Refresh">↻</button>
      <button class="widget-dismiss" aria-label="Dismiss">×</button>
    </div>
  </div>

  <div class="widget-content">
    <!-- Template content here -->
  </div>

  <div class="widget-footer">
    <div class="widget-feedback">
      <button class="feedback-up" aria-label="Helpful">👍</button>
      <button class="feedback-down" aria-label="Not helpful">👎</button>
    </div>
    <span class="widget-confidence" data-debug>0.87</span>
  </div>
</div>
```

#### ProductTile
Displays a single product suggestion.

```typescript
interface ProductTileProps {
  // Product data
  name: string
  brand: string
  price: string
  category: string

  // Image
  imageUrl?: string
  imageFallback: 'placeholder' | 'brand-logo' | 'category-icon'
  imageSource: 'shopify' | 'serp' | 'cache' | 'generated'

  // Links
  productUrl: string
  searchUrl: string  // Fallback if productUrl fails

  // Instrumentation
  suggestionIndex: number
  confidence: number

  // State
  loading: boolean
  imageError: boolean

  // Actions
  onClick: () => void  // Tracked automatically
  onSave: () => void   // Add to user's board
}
```

#### SuggestionItem
Text-based suggestion without image.

```typescript
interface SuggestionItemProps {
  text: string
  reason: string
  confidence: number
  actionLabel: string
  onAction: () => void
}
```

#### ConfidenceBadge
Visual indicator of AI confidence (debug/admin only).

```typescript
interface ConfidenceBadgeProps {
  score: number  // 0-1
  threshold: number  // Minimum to render
  showNumeric: boolean  // Show "0.87" vs just color
}

// Renders as:
// score >= 0.8: Green
// score >= 0.6: Yellow
// score < 0.6:  Red (shouldn't render, but shows in debug)
```

### Template Components

#### TwoColumnSuggestions
The primary template for Complete the Look.

```typescript
interface TwoColumnSuggestionsProps {
  // Left column: User's items
  matchedItems: Array<{
    id: string
    title: string
    image: string
    category: string
  }>

  // Right column: AI suggestions
  suggestions: Array<ProductTileProps>

  // Context
  reasoning: string
  missingPieces: string

  // Layout
  maxSuggestions: number  // Default 4
  showReasoning: boolean  // Default true
}
```

```html
<!-- Rendered Structure -->
<div class="template-two-column">
  <div class="column-left">
    <h4>Your Items</h4>
    <div class="matched-items-grid">
      <!-- User's items -->
    </div>
    <p class="reasoning">{reasoning}</p>
  </div>

  <div class="column-right">
    <h4>Complete Your Look</h4>
    <p class="missing-pieces">{missingPieces}</p>
    <div class="suggestions-grid">
      <!-- ProductTile components -->
    </div>
  </div>
</div>
```

#### HeroFeature
Full-width prominent widget for high-confidence results.

```typescript
interface HeroFeatureProps {
  headline: string
  subheadline: string
  featuredItem: ProductTileProps
  supportingItems: ProductTileProps[]
  ctaLabel: string
  ctaAction: () => void
}
```

### Template Registry

Templates are registered with capabilities for automated selection (Phase 2+).

```typescript
const TEMPLATE_REGISTRY = {
  'two-column-suggestions': {
    id: 'two-column-suggestions',
    component: TwoColumnSuggestions,
    capabilities: {
      minSuggestions: 1,
      maxSuggestions: 6,
      supportsImages: true,
      supportsReasoning: true,
      zones: ['inline', 'footer'],
    },
    requirements: {
      matchedItems: true,  // Needs user items to show
    },
  },

  'hero-feature': {
    id: 'hero-feature',
    component: HeroFeature,
    capabilities: {
      minSuggestions: 1,
      maxSuggestions: 4,
      supportsImages: true,
      supportsReasoning: false,
      zones: ['hero'],
    },
    requirements: {
      confidence: 0.85,  // Only use for high-confidence
      featuredItem: true,
    },
  },

  'suggestion-list': {
    id: 'suggestion-list',
    component: SuggestionList,
    capabilities: {
      minSuggestions: 1,
      maxSuggestions: 10,
      supportsImages: false,  // Text only
      supportsReasoning: true,
      zones: ['inline', 'footer'],
    },
    requirements: {},  // Works with minimal data
  },
}
```

### Responsive Behavior

```css
/* Widget zones */
.widget-zone-hero {
  grid-column: 1 / -1;  /* Full width */
  min-height: 300px;
}

.widget-zone-inline {
  grid-column: span 2;  /* 2 columns on desktop */
}

.widget-zone-footer {
  grid-column: 1 / -1;
  background: var(--surface-secondary);
}

/* Responsive breakpoints */
@media (max-width: 768px) {
  .widget-zone-inline {
    grid-column: 1 / -1;  /* Full width on mobile */
  }

  .template-two-column {
    flex-direction: column;
  }
}
```

---

## 4. Instrumentation & Analytics

### Event Taxonomy

All events follow a consistent schema for model training.

```typescript
interface WidgetEvent {
  // Identity
  eventId: string          // UUID
  eventType: WidgetEventType
  timestamp: number        // Unix ms

  // Context
  userId?: string          // Anonymous ID if not logged in
  sessionId: string
  pageUrl: string

  // Widget context
  widgetId: string
  widgetType: string
  widgetVersion: string
  zone: 'hero' | 'inline' | 'footer'

  // Generation context
  generationId: string     // Links to generation_log
  confidence: number
  inputItemCount: number
  suggestionCount: number

  // Experiment context
  experimentId?: string
  variantId?: string

  // Event-specific payload
  payload: Record<string, any>
}

type WidgetEventType =
  // Lifecycle
  | 'widget.requested'     // Generation started
  | 'widget.generated'     // AI returned content
  | 'widget.rendered'      // Displayed to user
  | 'widget.error'         // Generation or render failed

  // Visibility
  | 'widget.visible'       // Entered viewport (50%+)
  | 'widget.hidden'        // Left viewport
  | 'widget.dwelled'       // Visible for 3+ seconds

  // Interaction
  | 'widget.clicked'       // Any click inside widget
  | 'widget.suggestion.clicked'  // Clicked a suggestion
  | 'widget.suggestion.saved'    // Added suggestion to board
  | 'widget.refreshed'     // User requested refresh
  | 'widget.dismissed'     // User closed widget

  // Feedback
  | 'widget.feedback.positive'
  | 'widget.feedback.negative'
  | 'widget.feedback.comment'

  // Suppression (Phase 1+)
  | 'widget.suppressed'    // Didn't render due to low confidence
  | 'widget.skipped'       // Didn't render due to eligibility
```

### Event Collection

```typescript
// Client-side collector
class WidgetAnalytics {
  private queue: WidgetEvent[] = []
  private flushInterval = 5000  // 5 seconds
  private maxQueueSize = 50

  track(event: Omit<WidgetEvent, 'eventId' | 'timestamp' | 'sessionId'>) {
    const fullEvent: WidgetEvent = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: Date.now(),
      sessionId: this.getSessionId(),
    }

    this.queue.push(fullEvent)

    // Flush if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.flush()
    }
  }

  async flush() {
    if (this.queue.length === 0) return

    const events = [...this.queue]
    this.queue = []

    await fetch('/api/track-engagement', {
      method: 'POST',
      body: JSON.stringify({ events }),
    })
  }

  // Auto-track visibility with IntersectionObserver
  observeWidget(element: HTMLElement, widgetContext: WidgetContext) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            this.track({
              eventType: 'widget.visible',
              ...widgetContext,
              payload: { visiblePercent: entry.intersectionRatio }
            })

            // Track dwell time
            setTimeout(() => {
              if (entry.isIntersecting) {
                this.track({
                  eventType: 'widget.dwelled',
                  ...widgetContext,
                  payload: { dwellMs: 3000 }
                })
              }
            }, 3000)
          }
        })
      },
      { threshold: [0.5, 1.0] }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }
}
```

### Model Training Data

Events are transformed into training data for the self-optimizing system.

```typescript
interface ModelTrainingRow {
  // Input features
  userId: string
  boardCategory: string
  itemCount: number
  itemBrands: string[]       // Encoded
  itemPriceTiers: string[]   // Encoded
  userTasteProfile: number[] // Embedding

  // Widget features
  widgetType: string
  widgetConfidence: number
  suggestionCount: number
  suggestionBrands: string[]

  // Context features
  zone: string
  experimentVariant?: string
  dayOfWeek: number
  hourOfDay: number

  // Labels (outcomes)
  wasRendered: boolean
  wasVisible: boolean
  wasDwelled: boolean
  wasClicked: boolean
  wasSaved: boolean
  wasDismissed: boolean
  feedbackScore: number      // -1, 0, 1

  // Derived metrics
  engagementScore: number    // Weighted combination
  timeToFirstClick?: number
  suggestionsClicked: number
}

// Engagement score calculation
function calculateEngagementScore(events: WidgetEvent[]): number {
  let score = 0

  // Positive signals
  if (hasEvent(events, 'widget.visible')) score += 0.1
  if (hasEvent(events, 'widget.dwelled')) score += 0.2
  if (hasEvent(events, 'widget.clicked')) score += 0.3
  if (hasEvent(events, 'widget.suggestion.clicked')) score += 0.5
  if (hasEvent(events, 'widget.suggestion.saved')) score += 1.0
  if (hasEvent(events, 'widget.feedback.positive')) score += 0.5

  // Negative signals
  if (hasEvent(events, 'widget.dismissed')) score -= 0.3
  if (hasEvent(events, 'widget.feedback.negative')) score -= 0.5

  // Normalize to 0-1
  return Math.max(0, Math.min(1, (score + 0.5) / 2))
}
```

### A/B Experiment Framework

```typescript
interface Experiment {
  id: string
  name: string
  description: string
  status: 'draft' | 'running' | 'paused' | 'complete'

  // Targeting
  targetPercent: number      // % of users in experiment
  targetCriteria?: {
    categories?: string[]
    minItems?: number
    userCohorts?: string[]
  }

  // Variants
  variants: Array<{
    id: string
    name: string
    weight: number           // Relative weight (sums to 100)
    config: Record<string, any>  // Variant-specific config
  }>

  // Metrics
  primaryMetric: 'engagement_score' | 'click_rate' | 'save_rate'
  secondaryMetrics: string[]

  // Timing
  startDate: string
  endDate?: string
  minSampleSize: number
}

// Example experiment
const confidenceThresholdExperiment: Experiment = {
  id: 'exp_confidence_threshold_001',
  name: 'Confidence Threshold Test',
  description: 'Test different confidence thresholds for widget rendering',
  status: 'running',

  targetPercent: 20,

  variants: [
    { id: 'control', name: 'Current (0.7)', weight: 50, config: { threshold: 0.7 } },
    { id: 'lower', name: 'Lower (0.5)', weight: 25, config: { threshold: 0.5 } },
    { id: 'higher', name: 'Higher (0.85)', weight: 25, config: { threshold: 0.85 } },
  ],

  primaryMetric: 'engagement_score',
  secondaryMetrics: ['click_rate', 'dismiss_rate', 'suppression_rate'],

  startDate: '2026-02-01',
  minSampleSize: 1000,
}
```

### Metrics Dashboard Schema

```typescript
interface WidgetMetricsDashboard {
  // Overview
  totalRenders: number
  totalEngagements: number
  engagementRate: number      // engagements / renders

  // By widget type
  byWidgetType: Record<string, {
    renders: number
    avgConfidence: number
    engagementRate: number
    clickRate: number
    saveRate: number
    dismissRate: number
  }>

  // By zone
  byZone: Record<'hero' | 'inline' | 'footer', {
    renders: number
    engagementRate: number
  }>

  // Suppression (Phase 1+)
  suppressionRate: number
  suppressionReasons: Record<string, number>

  // Health
  errorRate: number
  avgGenerationTimeMs: number
  cacheHitRate: number

  // Trends
  dailyEngagement: Array<{ date: string; rate: number }>

  // Experiments
  activeExperiments: Array<{
    id: string
    name: string
    variants: Array<{
      id: string
      sampleSize: number
      primaryMetric: number
      significance: number  // p-value
    }>
  }>
}
```

---

## 5. Data Models

### Core Tables

```sql
-- Widget generation log (every AI call)
CREATE TABLE generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request
  widget_id TEXT NOT NULL,
  widget_version TEXT NOT NULL,
  user_id UUID REFERENCES auth.users,
  input_item_ids UUID[] NOT NULL,
  input_hash TEXT NOT NULL,  -- For cache key

  -- Response
  response JSONB NOT NULL,
  confidence FLOAT,
  suggestion_count INT,

  -- Performance
  generation_time_ms INT,
  cache_hit BOOLEAN DEFAULT FALSE,

  -- Experiment
  experiment_id TEXT,
  variant_id TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_generation_log_hash ON generation_log(input_hash);
CREATE INDEX idx_generation_log_user ON generation_log(user_id);

-- Widget cache (deduplicated responses)
CREATE TABLE widget_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,

  response JSONB NOT NULL,
  confidence FLOAT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  hit_count INT DEFAULT 0,
  last_hit_at TIMESTAMPTZ,

  UNIQUE(widget_id, input_hash)
);

CREATE INDEX idx_widget_cache_lookup ON widget_cache(widget_id, input_hash);
CREATE INDEX idx_widget_cache_expires ON widget_cache(expires_at);

-- Engagement events (append-only)
CREATE TABLE engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Event identity
  event_type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,

  -- Context
  user_id UUID,
  session_id TEXT NOT NULL,

  -- Widget context
  widget_id TEXT NOT NULL,
  widget_version TEXT,
  zone TEXT,
  generation_id UUID REFERENCES generation_log(id),

  -- Experiment
  experiment_id TEXT,
  variant_id TEXT,

  -- Payload
  payload JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Partition by month for performance
CREATE INDEX idx_engagement_events_time ON engagement_events(timestamp);
CREATE INDEX idx_engagement_events_widget ON engagement_events(widget_id, event_type);
CREATE INDEX idx_engagement_events_user ON engagement_events(user_id, timestamp);

-- User taste profiles
CREATE TABLE user_taste_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users,
  category TEXT NOT NULL,

  -- Extracted preferences
  preferred_brands JSONB,     -- {brand: affinity_score}
  price_tier TEXT,            -- luxury | mid | budget
  style_attributes JSONB,     -- {attribute: score}

  -- Confidence
  item_count INT DEFAULT 0,
  confidence FLOAT DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, category)
);

-- Validation health tracking
CREATE TABLE validation_health (
  key TEXT PRIMARY KEY,
  validator_type TEXT NOT NULL,

  -- Counters
  attempts INT DEFAULT 0,
  successes INT DEFAULT 0,
  consecutive_failures INT DEFAULT 0,

  -- Timing
  last_attempt TIMESTAMPTZ,
  last_success TIMESTAMPTZ,
  backoff_until TIMESTAMPTZ,

  -- Metadata
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- A/B experiments
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',

  -- Config
  target_percent FLOAT DEFAULT 10,
  target_criteria JSONB,
  variants JSONB NOT NULL,

  -- Metrics
  primary_metric TEXT NOT NULL,
  secondary_metrics TEXT[],

  -- Timing
  start_date DATE,
  end_date DATE,
  min_sample_size INT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Experiment assignments (sticky)
CREATE TABLE experiment_assignments (
  user_id UUID NOT NULL,
  experiment_id TEXT NOT NULL REFERENCES experiments(id),
  variant_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (user_id, experiment_id)
);

-- Model training data (derived, refreshed periodically)
CREATE TABLE model_training_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- From generation_log
  generation_id UUID REFERENCES generation_log(id),
  widget_id TEXT NOT NULL,
  confidence FLOAT,

  -- From user context
  user_id UUID,
  board_category TEXT,
  item_count INT,

  -- Aggregated outcomes
  was_rendered BOOLEAN,
  was_visible BOOLEAN,
  was_dwelled BOOLEAN,
  was_clicked BOOLEAN,
  was_saved BOOLEAN,
  was_dismissed BOOLEAN,
  feedback_score INT,

  -- Derived
  engagement_score FLOAT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_training_data_widget ON model_training_data(widget_id);
CREATE INDEX idx_training_data_score ON model_training_data(engagement_score);
```

### Views for Analytics

```sql
-- Daily widget metrics
CREATE VIEW widget_metrics_daily AS
SELECT
  date_trunc('day', e.timestamp) as date,
  e.widget_id,

  COUNT(DISTINCT e.generation_id) FILTER (WHERE e.event_type = 'widget.rendered') as renders,
  COUNT(*) FILTER (WHERE e.event_type = 'widget.clicked') as clicks,
  COUNT(*) FILTER (WHERE e.event_type = 'widget.suggestion.saved') as saves,
  COUNT(*) FILTER (WHERE e.event_type = 'widget.dismissed') as dismissals,

  AVG(g.confidence) as avg_confidence,
  AVG(g.generation_time_ms) as avg_generation_time_ms

FROM engagement_events e
LEFT JOIN generation_log g ON e.generation_id = g.id
GROUP BY 1, 2;

-- Experiment results
CREATE VIEW experiment_results AS
SELECT
  ea.experiment_id,
  ea.variant_id,
  COUNT(DISTINCT ea.user_id) as users,

  AVG(mtd.engagement_score) as avg_engagement,
  AVG(mtd.was_clicked::int) as click_rate,
  AVG(mtd.was_saved::int) as save_rate,
  AVG(mtd.was_dismissed::int) as dismiss_rate

FROM experiment_assignments ea
LEFT JOIN model_training_data mtd ON ea.user_id = mtd.user_id
GROUP BY 1, 2;
```

---

## 6. Cost Projections

### By User Scale

| Users | Claude API | SERP API | Supabase | Total/Month |
|-------|-----------|----------|----------|-------------|
| 100 | $50 | $50 | $0 | **$100** |
| 1,000 | $500 | $100 | $25 | **$625** |
| 10,000 | $5,000 | $500 | $75 | **$5,575** |

### Cost Per User

| Scale | Cost/User/Month |
|-------|-----------------|
| 100 users | $1.00 |
| 1,000 users | $0.63 |
| 10,000 users | $0.56 |

### Cost Reduction Levers

1. **Caching** - 80-90% reduction in API calls
2. **Model selection** - Haiku is 10x cheaper than Sonnet
3. **Suppression** - Don't generate widgets that won't be shown
4. **Batching** - Combine multiple image searches

---

## Appendix: File Structure

```
supabase/
├── functions/
│   ├── _shared/
│   │   ├── validation-engine.ts
│   │   ├── brand-service.ts
│   │   ├── image-pipeline.ts
│   │   ├── prompt-builder.ts
│   │   ├── response-parser.ts
│   │   ├── taste-profiler.ts
│   │   ├── analytics-client.ts
│   │   ├── experiment-sdk.ts
│   │   └── cache-manager.ts
│   │
│   ├── generate-widget/
│   │   └── index.ts
│   ├── select-widgets/
│   │   └── index.ts
│   ├── track-engagement/
│   │   └── index.ts
│   └── optimize-thresholds/
│       └── index.ts
│
├── migrations/
│   ├── 001_widget_cache.sql
│   ├── 002_engagement_events.sql
│   ├── 003_experiments.sql
│   └── 004_training_data.sql
│
└── seed/
    └── experiments.sql

src/
├── components/
│   ├── widgets/
│   │   ├── primitives/
│   │   │   ├── WidgetCard.tsx
│   │   │   ├── ProductTile.tsx
│   │   │   ├── SuggestionItem.tsx
│   │   │   └── ConfidenceBadge.tsx
│   │   │
│   │   ├── templates/
│   │   │   ├── TwoColumnSuggestions.tsx
│   │   │   ├── HeroFeature.tsx
│   │   │   └── SuggestionList.tsx
│   │   │
│   │   └── registry.ts
│   │
│   └── analytics/
│       └── WidgetAnalytics.ts
│
├── config/
│   └── widget-definitions/
│       ├── complete-the-look.yaml
│       └── style-definition.yaml
│
└── styles/
    └── widgets.css

docs/
├── PRD-generative-widget-ecosystem.md
├── TECH-widget-architecture.md        # This document
├── TECH-ai-widget-system.md
└── ARCH-ai-widget-pipeline.md
```
