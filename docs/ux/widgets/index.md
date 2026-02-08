# Widget System

> **Status:** ✅ Shipped
> **Brand Principle:** Input shapes output
> **Key Personas:** All
>
> Back to [UX Index](../index.md)

Widgets are AI-generated recommendation cards that suggest products based on user preferences and context. They appear alongside pins to help users discover relevant content from trusted brands.

---

## User Goals

- **Discover relevant products** without actively searching
- **Get personalized recommendations** based on my interests
- **Control what I see** through preference settings
- **Trust the suggestions** from vetted brand partners
- **Take action easily** via direct links to products

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Browse my boards | See relevant suggestions | Discover products I might want |
| Like certain brands | Get more from those brands | Build my collection with favorites |
| Dislike a recommendation | Hide it or similar ones | Keep my feed relevant |
| Find a product I want | Click through easily | Purchase or save it |
| Wonder why I'm seeing something | Understand the reasoning | Trust the AI is working for me |

---

## Key Concepts

### What is a Widget?

A widget is an AI-generated recommendation featuring:
- **Product info**: Name, price, image from brand catalog
- **Context**: Why this was recommended
- **Brand**: Verified partner with quality products
- **Actions**: Visit, save, dismiss

### Widget Generation Flow

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    User     │ → │     AI      │ → │    Match    │ → │   Display   │
│  Context    │    │   Analyze   │    │   Brands    │    │   Widget    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
    Prefs,           Generate           Find best          Show card
    Pins,            criteria           products           with context
    History
```

---

## Wireframes

### Widget Card

```
┌─────────────────────────────────┐
│  🤖 AI Recommendation           │
├─────────────────────────────────┤
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │    [Product Image]      │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  Product Name                   │
│  Brand Name                     │
│  $99.00                         │
│                                 │
│  "Because you saved similar     │
│   running gear..."              │
│                                 │
│  [View] [Save] [Hide]           │
└─────────────────────────────────┘
```

### Widget in Board Context

```
┌───────────────────────────────────────────────────────┐
│  My Board                                     [+ Add] │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │
│  │  Pin 1  │  │  Pin 2  │  │  Pin 3  │  │  Pin 4  │  │
│  │   📌    │  │   📌    │  │   📌    │  │   📌    │  │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │ 🤖 Recommended for you                          │  │
│  │                                                 │  │
│  │  [Widget 1]  [Widget 2]  [Widget 3]  →         │  │
│  │                                                 │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│  │  Pin 5  │  │  Pin 6  │  │  Pin 7  │               │
│  │   📌    │  │   📌    │  │   📌    │               │
│  └─────────┘  └─────────┘  └─────────┘               │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### Widget Preferences Panel

```
┌─────────────────────────────────────────────┐
│  Widget Settings                      [X]   │
├─────────────────────────────────────────────┤
│                                             │
│  Show AI Recommendations:  [ON] / OFF       │
│                                             │
│  ─────────────────────────────────────      │
│                                             │
│  Preferred Brands:                          │
│  ☑ Nike         ☑ Apple                    │
│  ☑ Patagonia    ☐ Amazon                   │
│  ☑ Allbirds     ☑ Everlane                 │
│                                             │
│  ─────────────────────────────────────      │
│                                             │
│  Recommendation Frequency:                  │
│  ○ Minimal  ● Balanced  ○ More              │
│                                             │
│           [ Save Preferences ]              │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Widget Components

| Component | Description | See Details |
|-----------|-------------|-------------|
| **AI Recommendations** | How recommendations are generated and displayed | [AI Recommendations](./ai-recommendations.md) |
| **Taste & Pattern Surfacing** | Surfacing collection patterns, trends, and connections | [Taste & Patterns](./taste-patterns.md) |
| **Widget Preferences** | User controls for customizing widget behavior | [Widget Preferences](./widget-preferences.md) |

---

## Brand Integration

### Supported Brands (47+)

Widgets pull from a curated catalog of brand partners:

| Category | Example Brands |
|----------|----------------|
| **Fashion** | Nike, Patagonia, Everlane, Allbirds |
| **Tech** | Apple, Sony, Bose, Anker |
| **Home** | West Elm, CB2, Muji |
| **Outdoor** | REI, Arc'teryx, The North Face |
| **Beauty** | Glossier, Aesop, Kiehl's |

---

## Known Extensions / Future States

### Short-term
- **Feedback learning** - Improve recommendations from dismissals
- **Save to board** - Add widget products directly as pins
- **Price alerts** - Notify when saved widgets go on sale

### Medium-term
- **Similar products** - "More like this" from any widget
- **Brand filtering** - Show/hide specific brands inline
- **Seasonal context** - Adjust recommendations by season/trends

### Long-term
- **Personalized models** - Per-user recommendation models
- **Cross-user patterns** - "People who saved this also liked..."
- **Purchase integration** - Track conversions for better recommendations

---

## Technical Notes

- Widgets generated via `generate-widget` edge function
- Uses Claude Haiku for fast, contextual recommendations
- Brand catalog stored in Supabase with affiliate links
- Recommendations cached with 1-hour TTL (client), persistent (server)
- User preferences stored in user profile

### Architecture

Widgets use a **config-driven** architecture:
- Widget definitions in TypeScript config files
- Eligibility rules evaluated at runtime
- Adding new widgets = adding config file (no code changes)
- See [AI Recommendations](./ai-recommendations.md#config-driven-architecture-phase-2) for details
