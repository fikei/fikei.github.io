# Content Types

Content Types classify pins into categories based on what they represent (product, article, video, etc.), enabling smarter display, filtering, and AI recommendations.

---

## User Goals

- **Understand at a glance** what type of content a pin represents
- **Filter by type** to find specific content (e.g., "show me only products")
- **Get better recommendations** based on content type patterns
- **Override AI classification** when it gets it wrong

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Add a new link | Have it auto-classified | Save time categorizing manually |
| Browse my board | See visual type indicators | Quickly identify content types |
| Search for products | Filter by "product" type | Find shoppable items fast |
| See a wrong classification | Manually change the type | Keep my data accurate |
| Analyze my collection | See type distribution stats | Understand my saving patterns |

---

## Wireframes

### Pin Card with Content Type Badge

```
┌─────────────────────────────────┐
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │      [Hero Image]       │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  Product Name Here              │
│  domain.com                     │
│                                 │
│  ┌──────────┐                   │
│  │ 🛍 Product │  ← Type Badge    │
│  └──────────┘                   │
└─────────────────────────────────┘
```

### Content Type Selection Modal

```
┌─────────────────────────────────────────┐
│  Change Content Type              [X]   │
├─────────────────────────────────────────┤
│                                         │
│  Current: 🛍 Product (87% confidence)   │
│                                         │
│  Select new type:                       │
│                                         │
│  ○ 🛍  Product      ○ 📰 Article        │
│  ○ 🎬 Video        ○ 🎵 Music          │
│  ○ 💻 Repository   ○ 📱 Social         │
│  ○ 📄 Document     ○ 🔧 Tool           │
│  ○ ❓ Unknown                           │
│                                         │
│           [ Cancel ]  [ Save ]          │
└─────────────────────────────────────────┘
```

### Type Distribution (Admin View)

```
┌─────────────────────────────────────────┐
│  Content Type Distribution              │
├─────────────────────────────────────────┤
│                                         │
│  🛍 Product    ████████████████░░ 68%   │
│  📰 Article   ████████░░░░░░░░░░ 18%   │
│  🎬 Video     ███░░░░░░░░░░░░░░░  7%   │
│  🔧 Tool      ██░░░░░░░░░░░░░░░░  4%   │
│  ❓ Unknown   █░░░░░░░░░░░░░░░░░  3%   │
│                                         │
│  Total: 247 pins                        │
└─────────────────────────────────────────┘
```

---

## Supported Content Types

| Type | Icon | Detection Signals |
|------|------|-------------------|
| Product | 🛍 | Price, "Add to cart", Shopify/commerce platforms |
| Article | 📰 | Blog structure, publication date, author |
| Video | 🎬 | YouTube, Vimeo, video player embeds |
| Music | 🎵 | Spotify, SoundCloud, Apple Music |
| Repository | 💻 | GitHub, GitLab, code patterns |
| Social | 📱 | Twitter, Instagram, TikTok |
| Document | 📄 | PDF, Google Docs, Notion |
| Tool | 🔧 | SaaS apps, utilities, web tools |
| Unknown | ❓ | No clear signals detected |

---

## Known Extensions / Future States

### Short-term
- **Custom content types** - Let users define their own types
- **Type-specific views** - Different card layouts per type (e.g., video thumbnails with duration)
- **Bulk reclassification** - Change type for multiple pins at once

### Medium-term
- **Type-based smart folders** - Auto-organize by content type
- **Enhanced metadata per type** - Products show price, videos show duration
- **Type confidence threshold** - Flag low-confidence classifications for review

### Long-term
- **ML model improvement** - Learn from user corrections
- **Domain-based type profiles** - Remember that "store.nike.com" = Product
- **Type-specific actions** - "Add to cart" for products, "Watch later" for videos

---

## Technical Notes

- Classification happens via `classifyContentType()` function
- Uses rule-based detection first, falls back to AI classification
- Domain cache stores learned type associations
- Confidence scores range from 0-100%
