# AI Recommendations

> **Status:** ✅ Shipped
> **Brand Principle:** Input shapes output
> **Key Personas:** All — widget system serves every persona
>
> Back to [UX Index](../index.md)

AI-powered widgets that analyze your pins and suggest complementary products, style summaries, and related content.

| Feature | Status | Notes |
|---------|--------|-------|
| Standardized Widget Card | ✅ Shipped | Header outside bordered content box |
| Complete the Look | ✅ Shipped | Inline zone, user items + suggestions |
| Style Summary | ✅ Shipped | Hero zone, style label + traits |
| Refresh Widget | ✅ Shipped | ⟳ icon in header, per-widget refresh |
| Loading State | ✅ Shipped | Shows inside widget content box |
| Widget Zones | ✅ Shipped | Hero, inline, footer positioning |
| AI Insights Banner | ❌ Removed | Each widget has its own header |
| Widget Feedback | ❌ Removed | Simplified UI |
| Widget Favorites | ❌ Removed | Simplified UI |

---

## User Goals

- **Discover new products** that match my existing taste
- **Complete outfits/looks** based on items I've saved
- **Get personalized suggestions** that improve over time
- **Refresh suggestions** when I want new recommendations

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Save a jacket | See matching pants/shoes | Complete the outfit |
| Browse my fashion board | Get style insights | Understand my aesthetic |
| See a bad recommendation | Dismiss it | Improve future suggestions |
| Like a recommendation | Favorite it | Remember to buy later |
| Wonder why something appeared | See the reasoning | Trust the AI more |

---

## Wireframes

### Standardized Widget Card Structure ✅ IMPLEMENTED

All AI widgets use the same structure: header OUTSIDE the bordered content box.

```
WIDGET TITLE   [AI]                                   ⟳   ← Header (no border)
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Widget-specific content here                           │  ← Body (bordered box)
│  (no section headlines)                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘

Header Elements:
- Title: Uppercase xs monospace, muted color
- AI badge: Outline style (muted border), inline with title
- Refresh: ⟳ icon (16px), no border, floating right
```

### Loading State ✅ IMPLEMENTED

```
STYLE SUMMARY   [AI]
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                 Generating insights...                  │  ← Loader inside body
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Complete the Look Widget ✅ IMPLEMENTED

```
COMPLETE THE LOOK   [AI]                              ⟳
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ [your]  │ │ [your]  │ │ [your]  │  ← Your items     │
│  │ jacket  │ │  pants  │ │  shoes  │                   │
│  └─────────┘ └─────────┘ └─────────┘                   │
│  ─────────────────────────────────────────────────────  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │  [rec]  │ │  [rec]  │ │  [rec]  │ │  [rec]  │       │
│  │ $89     │ │ $125    │ │ $45     │ │ $199    │       │
│  │ Palace  │ │ Stussy  │ │ Nike    │ │ BAPE    │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│                                           ↑ AI picks   │
└─────────────────────────────────────────────────────────┘
```

### Style Summary Widget ✅ IMPLEMENTED

```
STYLE SUMMARY   [AI]                                  ⟳
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Minimal Modern                   ← Style label         │
│  Based on 12 items                ← Sublabel            │
│                                                         │
│  ┌──────────┐ ┌───────────┐ ┌──────────────┐           │
│  │ Clean    │ │ Neutral   │ │ Versatile    │  ← Traits │
│  │ lines    │ │ palette   │ │ pieces       │           │
│  └──────────┘ └───────────┘ └──────────────┘           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Widget Zones

```
┌─────────────────────────────────────────────────────────┐
│  [Hero Zone]    Style Summary widget appears here       │
│  (No separate banner - widget has its own header)       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │ │     │              │
│  │     │ │     │ │     │ │     │ │     │              │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                         │
│  ┌─────┐ ┌──────────────────────────────┐ ┌─────┐      │
│  │     │ │  [Inline Zone]               │ │     │      │
│  │     │ │   Complete the Look widget   │ │     │      │
│  └─────┘ └──────────────────────────────┘ └─────┘      │
│                                                         │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │ │     │              │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Footer Zone]  Reserved for future widgets             │
└─────────────────────────────────────────────────────────┘
```

---

## Supported Brands (47+)

**Streetwear:**
Stüssy, Palace, Supreme, BAPE, KITH, Off-White, Fear of God

**Athletic:**
Nike, Adidas, New Balance, Asics, Puma, Jordan

**Outdoor/Workwear:**
Carhartt WIP, The North Face, Patagonia, Arc'teryx

**Designer:**
Acne Studios, Our Legacy, Comme des Garçons, A.P.C.

**Emerging:**
Aimé Leon Dore, Noah, Awake NY, Brain Dead

---

## Recommendation Logic

```
User's Saved Pins
       │
       ▼
┌─────────────────┐
│ Extract Signals │
│ - Brands        │
│ - Colors        │
│ - Categories    │
│ - Price range   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Match to        │
│ Brand Catalogs  │
│ (Shopify API)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AI Ranking      │
│ (Claude Haiku)  │
│ - Relevance     │
│ - Complementary │
│ - Diversity     │
└────────┬────────┘
         │
         ▼
   Recommendations
```

---

## Known Extensions / Future States

### Short-term
- **More widget types** - "Similar items", "Price drops", "Back in stock"
- **Widget scheduling** - Show different widgets at different times
- **Recommendation explanations** - "Because you saved X..."

### Medium-term
- **Outfit builder** - Drag recommendations into outfit compositions
- **Budget mode** - Filter by price range
- **Size preferences** - Only show available sizes
- **Sale alerts** - Notify when recommended items go on sale

### Long-term
- **Personal shopper chat** - AI assistant for shopping decisions
- **Try-on visualization** - AR preview of outfits
- **Purchase tracking** - Mark items as bought, track spending
- **Seasonal suggestions** - Weather-appropriate recommendations

---

## Technical Notes

### Implementation Details
- Widget content generated by `generate-widget` Supabase function
- Claude Haiku (primary) / GPT-4o mini (fallback) for AI
- 5-minute client cache, branded Shopify API integration
- SERP API for product image fallback when Shopify unavailable

### Config-Driven Architecture (Phase 2)
- Widgets defined in TypeScript config files (`config/widgets/*.ts`)
- Eligibility rules as declarative config, not code
- Registry pattern with runtime evaluators (`config/registry.ts`)
- Schema types in `config/schema.ts`
- Key files:
  - `supabase/functions/generate-widget/config/schema.ts` - Type definitions
  - `supabase/functions/generate-widget/config/registry.ts` - Widget loader
  - `supabase/functions/generate-widget/config/widgets/complete-the-look.ts`
  - `supabase/functions/generate-widget/config/widgets/style-summary.ts`

### Phase 2: Config-Driven Architecture

#### Template Selection Engine
Widgets are rendered via a template registry, not hard-coded per widget ID.
Template names describe the UX layout pattern, not the content.

```
WIDGET_TEMPLATES = {
  'grid-split'  → Two groups of cards with a divider     (v1.0)
  'hero-card'   → Centered headline + subtitle + tags    (v1.0)
  'list'        → Stacked rows with separators           (v1.0)
  'text-block'  → Single prose block in a card           (v1.0)
}
```

**Template selection flow:**
```
widget.template.name → WIDGET_TEMPLATES[name] → render()
                    ↓ (if fails)
widget.template.fallback → WIDGET_TEMPLATES[fallback] → render()
                    ↓ (if fails)
'list' → WIDGET_TEMPLATES['list'] → render()
```

- File: `boards/index.html` - `renderWidgetWithTemplate()`, `WIDGET_TEMPLATES`

#### Category-Agnostic Matching
Widgets are discovered via server-side config, not hard-coded categories.

- Discovery endpoint: `POST { action: 'discover', category, items }`
- Registry endpoint: `POST { action: 'registry' }`
- File: `supabase/functions/generate-widget/config/registry.ts` - `discoverWidgets()`

#### Hot-Reload Registry
- `registerWidget(widget)` / `unregisterWidget(id)` / `reloadWidget(widget)`
- File: `supabase/functions/generate-widget/config/registry.ts`

### Widget Card Structure
- Outer wrapper: `.widget-complete` (no border) with `data-widget-id`
- Header: `.widget-complete__header` - sits OUTSIDE the content box
- Body: `.widget-complete__body` - bordered box (--subtle border, --surface bg)
- Loading: `.widget-complete__body--loading` centers loader inside body
- File: `boards/index.html` - `renderCompleteTheLookWidget()`, `renderStyleSummaryWidget()`

### CSS Classes
```css
.widget-complete              /* Outer wrapper (no border) */
.widget-complete__header      /* Header row (outside box) */
.widget-complete__header-left /* Title and badge group */
.widget-complete__title       /* Widget name, xs muted mono */
.widget-complete__badge       /* "AI" tag, outline style */
.widget-complete__refresh-btn /* ⟳ icon (16px), no border */
.widget-complete__body        /* Bordered content box */
.widget-complete__body--loading /* Centered loader modifier */
.widget-complete__section     /* Content section */
.widget-complete__divider     /* Horizontal separator */
.widget-complete__items       /* Item grid container */
```

### Removed Features
- ~~AI Insights banner (widget-section__header)~~
- ~~Widget feedback (rateWidget, submitWidgetFeedback)~~
- ~~Widget favorites (toggleWidgetFavorite)~~
- ~~Widget dismiss/hide (dismissWidget, hideWidget)~~
