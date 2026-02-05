# AI Recommendations

AI-powered widgets that analyze your pins and suggest complementary products, style summaries, and related content.

**Implementation Status**: ✅ Shipped

| Feature | Status | Notes |
|---------|--------|-------|
| Standardized Widget Card | ✅ Shipped | Title + AI badge + refresh icon |
| Complete the Look | ✅ Shipped | Hero zone, user items + suggestions |
| Style Summary | ✅ Shipped | Footer zone, style label + traits |
| Refresh Widget | ✅ Shipped | Regenerate AI content on demand |
| Widget Zones | ✅ Shipped | Hero, inline, footer positioning |
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

All AI widgets use the same outer card structure for consistency:

```
┌─────────────────────────────────────────────────────────┐
│  WIDGET TITLE   [AI]                              [↻]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Widget-specific content here                           │
│  (no section headlines)                                 │
│                                                         │
└─────────────────────────────────────────────────────────┘

Header Elements:
- Title: Uppercase, monospace, left-aligned
- AI badge: Inverted tag inline with title
- Refresh: Icon button, no border, floating right
```

### Complete the Look Widget ✅ IMPLEMENTED

```
┌─────────────────────────────────────────────────────────┐
│  COMPLETE THE LOOK   [AI]                         [↻]   │
├─────────────────────────────────────────────────────────┤
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
┌─────────────────────────────────────────────────────────┐
│  STYLE SUMMARY   [AI]                             [↻]   │
├─────────────────────────────────────────────────────────┤
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
│  [Hero Zone]    Complete the Look widget appears here   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │ │     │              │
│  │     │ │     │ │     │ │     │ │     │              │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                         │
│  ┌─────┐ ┌──────────────────────────────┐ ┌─────┐      │
│  │     │ │  [Inline Zone]               │ │     │      │
│  │     │ │   Future widget position     │ │     │      │
│  └─────┘ └──────────────────────────────┘ └─────┘      │
│                                                         │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐              │
│  │     │ │     │ │     │ │     │ │     │              │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘              │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Footer Zone]  Style Summary widget appears here       │
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

### Widget Card Structure
- Outer wrapper: `.widget-complete` with `data-widget-id`
- Header: `.widget-complete__header` with title, AI badge, refresh button
- Body: `.widget-complete__body` holds widget-specific content
- File: `boards/index.html` - `renderCompleteTheLookWidget()`, `renderStyleSummaryWidget()`

### CSS Classes
```css
.widget-complete         /* Outer card container */
.widget-complete__header /* Header with title + badge + refresh */
.widget-complete__header-left  /* Title and badge group */
.widget-complete__title  /* Widget name, uppercase mono */
.widget-complete__badge  /* "AI" tag, inverted colors */
.widget-complete__refresh-btn  /* Refresh icon, no border */
.widget-complete__body   /* Content area */
.widget-complete__section /* Content section */
.widget-complete__divider /* Horizontal separator */
.widget-complete__items  /* Item grid container */
```

### Removed Features
- ~~Widget feedback (rateWidget, submitWidgetFeedback)~~
- ~~Widget favorites (toggleWidgetFavorite)~~
- ~~Widget dismiss/hide (dismissWidget, hideWidget)~~
