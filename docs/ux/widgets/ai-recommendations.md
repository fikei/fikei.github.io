# AI Recommendations

AI-powered widgets that analyze your pins and suggest complementary products, style summaries, and related content.

---

## User Goals

- **Discover new products** that match my existing taste
- **Complete outfits/looks** based on items I've saved
- **Get personalized suggestions** that improve over time
- **Control recommendation quality** with feedback
- **Understand why** something was recommended

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

### Complete the Look Widget

```
┌─────────────────────────────────────────────────────────┐
│  ✨ Complete the Look                          [⋮]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Based on your saved items:                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                   │
│  │ [your]  │ │ [your]  │ │ [your]  │                   │
│  │ jacket  │ │  pants  │ │  shoes  │                   │
│  └─────────┘ └─────────┘ └─────────┘                   │
│                                                         │
│  You might also like:                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │         │ │         │ │         │ │         │       │
│  │  [rec]  │ │  [rec]  │ │  [rec]  │ │  [rec]  │       │
│  │         │ │         │ │         │ │         │       │
│  │ $89     │ │ $125    │ │ $45     │ │ $199    │       │
│  │ ★ Palace│ │ ★ Stussy│ │ ★ Nike  │ │ ★ BAPE  │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
│   [♡ Save]   [♡ Save]   [♡ Save]   [♡ Save]           │
│                                                         │
│  [ 👎 Not for me ]  [ 💬 Feedback ]  [ ♡ Save All ]    │
└─────────────────────────────────────────────────────────┘
```

### Style Summary Widget

```
┌─────────────────────────────────────────────────────────┐
│  🎨 Your Style Summary                         [⋮]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Based on 47 saved items, your style is:                │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  "Contemporary streetwear with Japanese         │    │
│  │   influence. Clean silhouettes meet bold        │    │
│  │   graphics. Neutral palette with occasional     │    │
│  │   pops of color."                               │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Top Brands:         Color Palette:                     │
│  1. Stüssy          ■ Black (45%)                       │
│  2. Palace          ■ White (25%)                       │
│  3. Nike            ■ Navy (15%)                        │
│  4. Carhartt WIP    ■ Grey (10%)                        │
│  5. BAPE            ■ Other (5%)                        │
│                                                         │
│  [ 🔄 Refresh ]                    [ Share Style ]      │
└─────────────────────────────────────────────────────────┘
```

### Widget Menu (⋮)

```
┌─────────────────────────┐
│  ★ Add to Favorites     │
│  ────────────────────   │
│  ⏸ Pause this widget    │
│  🚫 Hide permanently    │
│  ────────────────────   │
│  📄 View PRD            │
│  💬 Send Feedback       │
└─────────────────────────┘
```

### Widget States

```
Active:
┌──────────────────────┐
│  ✨ Widget Title     │
│  [content loading]   │
└──────────────────────┘

Paused:
┌──────────────────────┐
│  ⏸ Widget Title      │
│  [Resume] to see     │
│  recommendations     │
└──────────────────────┘

Hidden (in Settings):
┌──────────────────────┐
│  🚫 Widget Title     │
│  [Restore]           │
└──────────────────────┘
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

- Widget content generated by `generate-widget` Supabase function
- Claude Haiku (primary) / GPT-4o mini (fallback) for AI
- 5-minute client cache, branded Shopify API integration
- Widget state stored in localStorage: favorites, hidden, dismissed
- Feedback collected and stored for model improvement
