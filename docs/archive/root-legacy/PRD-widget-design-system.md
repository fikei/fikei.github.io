# Product Requirements Document

## Widget Design System & Component Library

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-02-03
**Depends On:** Generative Widget Ecosystem (Phase 0+)

---

## 1. Executive Summary

The Widget Design System provides a standardized component library for rendering AI-generated widgets. It ensures visual consistency, enables template automation, and embeds instrumentation for model training.

### Core Principles

1. **Consistency** - All widgets render from the same primitives
2. **Composability** - Templates built from reusable patterns
3. **Instrumentation** - Every component tracks user behavior
4. **Automation-Ready** - Components declare capabilities for auto-selection

---

## 2. Component Hierarchy

```
DESIGN SYSTEM
│
├── PRIMITIVES (Atomic)
│   ├── WidgetCard          - Base container with instrumentation
│   ├── ProductTile         - Single product/suggestion display
│   ├── SuggestionItem      - Text-based suggestion
│   ├── ConfidenceBadge     - AI confidence indicator (debug)
│   ├── ActionButton        - Tracked click actions
│   ├── LoadingSkeleton     - Loading state placeholder
│   └── ErrorState          - Graceful error display
│
├── PATTERNS (Molecular)
│   ├── ProductGrid         - Grid of ProductTiles
│   ├── SuggestionList      - List of SuggestionItems
│   ├── ComparisonLayout    - Side-by-side comparison
│   ├── CarouselScroller    - Horizontal scroll container
│   └── FeedbackCollector   - Thumbs up/down + comment
│
├── TEMPLATES (Organisms)
│   ├── TwoColumnSuggestions - User items + AI suggestions
│   ├── HeroFeature         - Full-width prominent display
│   ├── InlineRecommendation - Compact inline widget
│   ├── FooterDiscovery     - Bottom-of-page suggestions
│   └── FullWidthShowcase   - Gallery-style display
│
└── LAYOUTS (Pages)
    ├── WidgetZone          - Container for zone (hero/inline/footer)
    ├── MultiWidgetStack    - Multiple widgets in sequence
    └── ResponsiveWidgetGrid - Adaptive grid layout
```

---

## 3. Primitive Components

### 3.1 WidgetCard

The foundational container for all widgets. Provides identity, instrumentation, and standard actions.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| widgetId | string | ✓ | Unique widget identifier |
| widgetType | string | ✓ | Widget type (e.g., 'complete-the-look') |
| version | string | ✓ | Widget version for A/B tracking |
| title | string | ✓ | Display title |
| subtitle | string | | Optional subtitle |
| zone | enum | ✓ | 'hero' \| 'inline' \| 'footer' |
| loading | boolean | ✓ | Loading state |
| error | object | | Error state with message |
| confidence | number | | AI confidence (0-1, debug only) |
| experimentVariant | string | | A/B test variant ID |
| onRefresh | function | | Refresh callback |
| onDismiss | function | | Dismiss callback |
| onFeedback | function | | Feedback callback (positive: boolean) |

**Data Attributes (Auto-attached):**
```html
<div class="widget-card"
     data-widget-id="complete-the-look"
     data-widget-version="3.0"
     data-widget-zone="inline"
     data-experiment="exp_123:variant_b"
     data-generation-id="gen_abc123"
     data-render-ts="1706900000000"
     data-confidence="0.87">
```

**Behavior:**
- Auto-tracks `widget.rendered` on mount
- Auto-tracks `widget.visible` via IntersectionObserver
- Auto-tracks `widget.dwelled` after 3s visibility
- Provides refresh, dismiss, feedback actions (all tracked)

---

### 3.2 ProductTile

Displays a single product suggestion with image, details, and actions.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| name | string | ✓ | Product name |
| brand | string | ✓ | Brand name |
| price | string | ✓ | Formatted price |
| category | string | ✓ | Product category |
| imageUrl | string | | Product image URL |
| imageFallback | enum | ✓ | 'placeholder' \| 'brand-logo' \| 'category-icon' |
| imageSource | enum | | 'shopify' \| 'serp' \| 'cache' \| 'generated' |
| productUrl | string | ✓ | Link to product page |
| searchUrl | string | ✓ | Fallback search URL |
| suggestionIndex | number | ✓ | Position in suggestions (for tracking) |
| confidence | number | | AI confidence for this suggestion |
| onClick | function | | Click handler (auto-tracked) |
| onSave | function | | Save to board handler |

**Tracked Events:**
- `widget.suggestion.clicked` - User clicked tile
- `widget.suggestion.saved` - User saved to board
- `widget.suggestion.image_error` - Image failed to load

---

### 3.3 SuggestionItem

Text-based suggestion without image (for lower-fidelity widgets).

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| text | string | ✓ | Suggestion text |
| reason | string | | Why this was suggested |
| confidence | number | | AI confidence |
| actionLabel | string | ✓ | CTA button text |
| onAction | function | ✓ | Action handler |

---

### 3.4 ConfidenceBadge

Visual indicator of AI confidence (admin/debug mode only).

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| score | number | ✓ | Confidence score (0-1) |
| threshold | number | | Minimum acceptable (for color) |
| showNumeric | boolean | | Show "0.87" vs just color |

**Visual States:**
- score ≥ 0.8: Green (high confidence)
- score ≥ 0.6: Yellow (acceptable)
- score < 0.6: Red (low - shouldn't render)

---

### 3.5 FeedbackCollector

Collects user feedback on widget quality.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| widgetId | string | ✓ | Widget being rated |
| onPositive | function | ✓ | Thumbs up handler |
| onNegative | function | ✓ | Thumbs down handler |
| onComment | function | | Optional comment handler |
| showComment | boolean | | Show comment input |

**Tracked Events:**
- `widget.feedback.positive`
- `widget.feedback.negative`
- `widget.feedback.comment`

---

## 4. Template Components

### 4.1 TwoColumnSuggestions

Primary template for "Complete the Look" style widgets.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| matchedItems | array | ✓ | User's items that triggered widget |
| suggestions | array | ✓ | AI-generated suggestions (ProductTile props) |
| reasoning | string | | AI's reasoning text |
| missingPieces | string | | What's missing from the look |
| maxSuggestions | number | | Limit displayed (default 4) |
| showReasoning | boolean | | Show reasoning section |

**Layout:**
```
┌─────────────────────────────────────────────┐
│ [Widget Title]                    [⟳] [×]   │
├─────────────────────┬───────────────────────┤
│   YOUR ITEMS        │   COMPLETE YOUR LOOK  │
│                     │                       │
│   [img] [img]       │   [ProductTile]       │
│   [img] [img]       │   [ProductTile]       │
│                     │   [ProductTile]       │
│   "reasoning..."    │   [ProductTile]       │
├─────────────────────┴───────────────────────┤
│                           [👍] [👎]          │
└─────────────────────────────────────────────┘
```

---

### 4.2 HeroFeature

Full-width prominent display for high-confidence results.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| headline | string | ✓ | Main headline |
| subheadline | string | | Supporting text |
| featuredItem | object | ✓ | Primary suggestion (ProductTile props) |
| supportingItems | array | | Additional suggestions |
| ctaLabel | string | ✓ | Call-to-action text |
| ctaAction | function | ✓ | CTA handler |

**Requirements:**
- Only renders for confidence ≥ 0.85
- Zone: hero only

---

### 4.3 InlineRecommendation

Compact inline widget for lower-prominence suggestions.

**Props:**
| Prop | Type | Required | Description |
|------|------|----------|-------------|
| title | string | ✓ | Widget title |
| suggestions | array | ✓ | 1-3 suggestions |
| layout | enum | | 'horizontal' \| 'vertical' |

---

## 5. Template Registry

Templates register their capabilities for automated selection (Phase 2+).

```typescript
interface TemplateCapabilities {
  minSuggestions: number
  maxSuggestions: number
  supportsImages: boolean
  supportsReasoning: boolean
  zones: ('hero' | 'inline' | 'footer')[]
  minConfidence?: number
}

interface TemplateRequirements {
  matchedItems?: boolean
  featuredItem?: boolean
  confidence?: number
}

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
      matchedItems: true,
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
      confidence: 0.85,
      featuredItem: true,
    },
  },

  'inline-recommendation': {
    id: 'inline-recommendation',
    component: InlineRecommendation,
    capabilities: {
      minSuggestions: 1,
      maxSuggestions: 3,
      supportsImages: true,
      supportsReasoning: false,
      zones: ['inline'],
    },
    requirements: {},
  },

  'suggestion-list': {
    id: 'suggestion-list',
    component: SuggestionList,
    capabilities: {
      minSuggestions: 1,
      maxSuggestions: 10,
      supportsImages: false,
      supportsReasoning: true,
      zones: ['inline', 'footer'],
    },
    requirements: {},
  },
}
```

---

## 6. Responsive Behavior

### Breakpoints

| Name | Width | Behavior |
|------|-------|----------|
| mobile | < 640px | Single column, stacked layout |
| tablet | 640-1024px | Two columns, compact spacing |
| desktop | > 1024px | Full layout, expanded spacing |

### Zone Behavior

```css
/* Hero zone - always full width */
.widget-zone-hero {
  grid-column: 1 / -1;
  min-height: 300px;
}

/* Inline zone - responsive columns */
.widget-zone-inline {
  grid-column: span 2;  /* Desktop: 2 columns */
}

@media (max-width: 768px) {
  .widget-zone-inline {
    grid-column: 1 / -1;  /* Mobile: full width */
  }
}

/* Footer zone - full width with background */
.widget-zone-footer {
  grid-column: 1 / -1;
  background: var(--surface-secondary);
  padding: var(--space-lg);
}
```

---

## 7. Theming

Components use CSS custom properties for theming.

```css
:root {
  /* Colors */
  --widget-bg: var(--surface-primary);
  --widget-border: var(--border-subtle);
  --widget-text: var(--text-primary);
  --widget-text-secondary: var(--text-secondary);

  /* Confidence colors */
  --confidence-high: var(--green-500);
  --confidence-medium: var(--yellow-500);
  --confidence-low: var(--red-500);

  /* Spacing */
  --widget-padding: var(--space-md);
  --widget-gap: var(--space-sm);

  /* Typography */
  --widget-title-size: var(--text-lg);
  --widget-body-size: var(--text-sm);

  /* Shadows */
  --widget-shadow: var(--shadow-sm);
  --widget-shadow-hover: var(--shadow-md);
}
```

---

## 8. Accessibility

### Requirements

- All interactive elements keyboard accessible
- Focus indicators visible
- ARIA labels for icons and actions
- Color not sole indicator (confidence uses shape + color)
- Reduced motion support

### ARIA Patterns

```html
<!-- Widget card -->
<article class="widget-card"
         role="region"
         aria-labelledby="widget-title-123">
  <h3 id="widget-title-123">Complete the Look</h3>

  <!-- Actions -->
  <button aria-label="Refresh suggestions">↻</button>
  <button aria-label="Dismiss widget">×</button>

  <!-- Feedback -->
  <button aria-label="This was helpful">👍</button>
  <button aria-label="This was not helpful">👎</button>
</article>

<!-- Product tile -->
<a class="product-tile"
   href="..."
   aria-label="Nike Air Max 90 - $150 - View on Nike.com">
```

---

## 9. Implementation Phases

### Phase 0: MVP Components
- [ ] WidgetCard (basic, no instrumentation)
- [ ] ProductTile (basic)
- [ ] TwoColumnSuggestions template
- [ ] LoadingSkeleton
- [ ] ErrorState

### Phase 1: Instrumentation
- [ ] Add data attributes to WidgetCard
- [ ] Implement IntersectionObserver tracking
- [ ] Add click/save tracking to ProductTile
- [ ] FeedbackCollector component

### Phase 2: Template System
- [ ] Template registry
- [ ] Capability declarations
- [ ] Template matcher
- [ ] HeroFeature, InlineRecommendation templates

### Phase 3: Automation Support
- [ ] Auto-template selection
- [ ] Slot allocation components
- [ ] MultiWidgetStack layout

---

## 10. Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Component reuse | >80% | Templates using shared primitives |
| Render consistency | 100% | Visual regression tests pass |
| Instrumentation coverage | 100% | All interactions tracked |
| Accessibility score | >95 | Lighthouse audit |
| Bundle size | <50KB | Gzipped component library |

---

## 11. File Structure

```
src/
├── components/
│   └── widgets/
│       ├── primitives/
│       │   ├── WidgetCard.tsx
│       │   ├── ProductTile.tsx
│       │   ├── SuggestionItem.tsx
│       │   ├── ConfidenceBadge.tsx
│       │   ├── ActionButton.tsx
│       │   ├── LoadingSkeleton.tsx
│       │   └── ErrorState.tsx
│       │
│       ├── patterns/
│       │   ├── ProductGrid.tsx
│       │   ├── SuggestionList.tsx
│       │   ├── ComparisonLayout.tsx
│       │   ├── CarouselScroller.tsx
│       │   └── FeedbackCollector.tsx
│       │
│       ├── templates/
│       │   ├── TwoColumnSuggestions.tsx
│       │   ├── HeroFeature.tsx
│       │   ├── InlineRecommendation.tsx
│       │   ├── FooterDiscovery.tsx
│       │   └── FullWidthShowcase.tsx
│       │
│       ├── layouts/
│       │   ├── WidgetZone.tsx
│       │   ├── MultiWidgetStack.tsx
│       │   └── ResponsiveWidgetGrid.tsx
│       │
│       ├── registry.ts
│       └── index.ts
│
└── styles/
    └── widgets/
        ├── primitives.css
        ├── patterns.css
        ├── templates.css
        ├── layouts.css
        └── themes.css
```

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial PRD |
