# Portfolio Site Architecture
> ctrl.rodeo/portfolio/ — static site with presentation controls

## Tech Stack
- Vanilla HTML/CSS/JS (consistent with ctrl.rodeo codebase)
- ctrl.rodeo design system (tokens.css, components.css)
- Portfolio-specific styles (portfolio.css)
- No build step — direct GitHub Pages deploy

## File Structure
```
portfolio/
  index.html              # Home — hero, thesis, case study cards
  field.html              # Case study: Field
  invoy.html              # Case study: Invoy (lifecycle + DS)
  livongo.html            # Case study: Livongo Config
  how-i-work.html         # Process: stack, design system, AI workflow
  portfolio.css           # Portfolio-specific styles (extends ctrl DS)
  portfolio.js            # Nav, scroll behavior, keyboard controls
  case-study-copy.md      # Content source
  ARCHITECTURE.md         # This file
  assets/
    field/
    invoy/
    workflow/
    livongo/
```

## Case Study Section Structure

Four sections per case study. Consistent skeleton, flexible internals.

```
[Problem]  [Deliverable]  [Process]  [Impact]
```

### Problem
What was broken + who was affected. Users/personas live here.
- Business context (2-3 sentences)
- User personas or actor descriptions (cards, not research docs)
- The tension or constraint that made this hard

### Deliverable
What shipped. Sub-sections flex per project:
- **User Flows** — the end-to-end experience, screens + interactions
- **Design System** — components, tokens, governance rules
- **Technical System** — architecture diagrams, data flows, integrations

### Process
Light narrative. How decisions were made, not a methodology diagram.
- 3-5 key decisions with rationale
- Tradeoffs: what was chosen, what was rejected, why
- No double diamonds, no sticky-note photos

### Impact
Results, metrics, what changed.
- Quantitative where available
- What shipped, to whom, at what scale
- What's next / what I'd do differently

## Per-Project Mapping

```
FIELD
  [Problem] — Paper forms in wilderness. Provider + Patient + ER personas.
  [Deliverable]
    → User Flows: voice transcript → AI extraction → SOAP note → SBAR handoff
    → Design System: dark palette, constrained components, SF Pro, 4 tabs / 3 inputs / 2 sheets
    → Technical System: on-device AI pipeline (Whisper + Llama), offline-first, GPS/altitude
  [Process] — Why on-device? Why SOAP over free-text? Why stoplight confidence?
  [Impact] — 27 screens designed. Business case. Design review doc (8 improvements).

INVOY
  [Problem] — Behavior change needs a loop, not isolated check-ins. Member + Coach personas.
  [Deliverable]
    → User Flows: Plan (weekly) → Execute (daily) → Reflect (weekly) → Adapt. 5 flow variants.
    → Design System: 30 components, color system, type scale, spacing, governance rules.
  [Process] — Why 5 variants from one entry? Why normalize rebound? Why data density on review?
  [Impact] — Shipped at Livongo/Teladoc scale. 15+ sub-flows. 30-component library.

LIVONGO CONFIG
  [Problem] — 3,700 config decisions in a spreadsheet. Sales + Ops + Member personas.
  [Deliverable]
    → User Flows: 9-step original → 6-step optimized (before/after)
    → Technical System: Salesforce → API resolution → registration pipeline
  [Process] — Why confirm-not-enter? Why defer coaching? Why skip coverage?
  [Impact] — 57% fields sourced, 33% fewer steps, ~5 min saved. CPQ parallel.

HOW I WORK
  [Problem] — Solo designer, 5 products, need consistent quality at speed.
  [Deliverable]
    → Design System: ctrl.rodeo tokens + components + AI widget templates
    → Technical System: Systemic audit pipeline (crawl → extract → map → audit)
  [Process] — How Intent → DS → Claude Code → Systemic → Ship works day-to-day
  [Impact] — 5 products, 1 person. This portfolio was built with this stack.
```

## Home Page

### Structure
```
HERO
  Thesis headline
  Supporting paragraph (names all projects, connects them)
  Credentials line

CASE STUDY CARDS (3)
  Field — thumbnail + tags + one-liner → field.html
  Invoy — thumbnail + tags + one-liner → invoy.html
  Livongo — thumbnail + tags + one-liner → livongo.html

HOW I WORK TEASER
  Pipeline strip + one paragraph → how-i-work.html

CONTACT
```

### Navigation
- Sticky nav: `Ian Fike | Field | Invoy | Livongo | How I Work`
- Each case study page: sticky sub-nav `[Problem] [Deliverable] [Process] [Impact]`
- Keyboard: left/right for prev/next case study
- Deep-linkable: `/portfolio/field.html#deliverable`
- "Next →" link at bottom of each page

## Visual Design
- ctrl DS dark mode for shell (nav, hero, page chrome)
- Light mode for case study content sections (reading comfort)
- Monospace (JetBrains Mono) for nav, labels, metadata
- Space Grotesk for headlines
- Project-native palettes within Deliverable sections:
  - Field: dark + orange/green clinical accents
  - Invoy: sage green + warm neutrals
  - Livongo: blue/purple/green data source colors

## Responsive
- Desktop: full layout
- Tablet: stacked
- Mobile: single column, hamburger nav

## Performance
- Lazy-load images
- No build step
- Inline critical CSS
- Target: < 2s first paint
