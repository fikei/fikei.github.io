# Lookback

> **Status:** ✅ Shipped (Phase 1 MVP)
> **Brand Principle:** Input shapes output
> **Key Personas:** Visual Collector (high), Deep-Dive Enthusiast (critical), Cultural Omnivore (high)
>
> Back to [UX Index](../index.md)

Rediscover valuable past pins you've forgotten about.

| Feature | Status | Notes |
|---------|--------|-------|
| Lookback Card | ✅ Shipped | Top of "All" grid, shows up to 3 pins |
| Multi-Signal Scoring | ✅ Shipped | 6 signals: anniversary, seasonal, never-clicked, consumption gap, staleness, recency decay |
| Daily Cache | ✅ Shipped | New picks every 24 hours |
| Dismiss Action | ✅ Shipped | Hide for 24 hours |
| Activation Rules | ✅ Shipped | 5+ pins, 7+ day old collection |

---

## User Goals

- **Rediscover old pins** that I've forgotten about
- **Break out of recency bias** and see my whole collection
- **Find inspiration** when I'm not actively saving new content
- **See connections** between old and new interests
- **Keep my collection alive** as a living resource

---

## Jobs to be Done (JTBD)

| When I... | I want to... | So I can... |
|-----------|-------------|-------------|
| Open my board with nothing new | Be reminded of interesting past finds | Get value from my collection |
| Haven't clicked certain pins | See them resurface | Decide if they're still relevant |
| It's an anniversary of a save | See what I was into last year | Notice seasonal patterns |
| Have seasonal interests | See winter pins in winter | Match my current context |
| Feel like browsing | Get curated suggestions | Explore without searching |
| Don't want to see this now | Dismiss the card | Come back to it later |

---

## Wireframes

### Lookback Card in Grid View ✅ IMPLEMENTED

```
┌─────────────────────────────────────────────────────────────┐
│  BOARDS                                          [+ Add]    │
├─────────────────────────────────────────────────────────────┤
│  [Search] [ All ] [ Clothing ] [ Tech ] [ Home ]       →    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ ↻ Lookback                               [× Dismiss]  │  │
│  │                                                       │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐               │  │
│  │  │ [image] │  │ [image] │  │ [image] │               │  │
│  │  │         │  │         │  │         │               │  │
│  │  │ Title 1 │  │ Title 2 │  │ Title 3 │               │  │
│  │  │ 1yr ago │  │ Winter  │  │ Unseen  │               │  │
│  │  └─────────┘  └─────────┘  └─────────┘               │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │  [img]  │  │  [img]  │  │  [img]  │  │  [img]  │        │
│  │ Recent  │  │ Recent  │  │ Recent  │  │ Recent  │        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Mini-Card Detail

```
┌─────────────┐
│             │
│   [image]   │
│             │
├─────────────┤
│ Pin Title   │
│ 1yr ago     │  ← Context label (anniversary/seasonal/never-clicked/etc)
└─────────────┘
```

---

## Lookback Behavior

### Activation Rules

- **Minimum pins**: 5+ pins in collection
- **Minimum age**: At least one pin 7+ days old
- **Frequency**: New picks every 24 hours
- **Dismissal**: Hide for 24 hours after dismiss action
- **View filter**: Only shows in "All" category view

### Scoring Signals (6 total)

| Signal | Weight | Description |
|--------|--------|-------------|
| **Anniversary** | 40 pts | Exactly 1yr, 2yr, 3yr, etc. since save date |
| **Seasonal Match** | 30 pts | Same month as current (e.g., winter pins in winter) |
| **Never Clicked** | 25 pts | Pin has 0 recorded clicks |
| **Consumption Gap** | 20 pts | Long time since last click |
| **Staleness** | 15 pts | Old pins (90+ days) get boosted |
| **Recency Decay** | -5 pts/day | Recent pins penalized (favor older content) |

### Selection Logic

1. Compute score for each pin using `computeLookbackScore(pin)`
2. Sort pins by score (highest first)
3. Take top 3 pins
4. Cache results for 24 hours
5. Show in Lookback Card at top of grid

### Context Labels

| Label | Trigger |
|-------|---------|
| "1yr ago" / "2yr ago" | Anniversary signal (primary) |
| "Winter" / "Summer" | Seasonal match (primary) |
| "Unseen" | Never-clicked signal (primary) |
| "Rediscover" | Generic fallback |

---

## Component Structure

```
.lookback-card
├── .lookback-header
│   ├── .lookback-title       # "↻ Lookback"
│   └── .dismiss-button        # "× Dismiss"
└── .lookback-grid
    └── .lookback-mini-card    # Up to 3 mini-cards
        ├── .mini-image        # Thumbnail
        ├── .mini-title        # Pin title
        └── .mini-context      # Context label
```

---

## Known Extensions / Future States

### Short-term (Phase 2)
- **Smart grouping** - Cluster related pins (e.g., "Your Summer Travel Pins")
- **Explicit themes** - "Pins from this month last year"
- **User preferences** - Opt-in to specific signal types

### Medium-term (Phase 3)
- **Lookback collections** - Auto-generate temporary boards from lookback picks
- **Share lookback** - Export lookback as shareable snapshot
- **Lookback history** - Archive of past lookback sets

### Long-term
- **Collaborative lookback** - "What we saved together last year"
- **Lookback insights** - "Your tastes have shifted from X to Y"
- **Lookback challenges** - "Revisit 5 old pins this week"

---

## Technical Notes

- Scoring function: `computeLookbackScore(pin)` - returns 0-100+ score
- Daily lookback: `getDailyLookback()` - caches top 3 picks for 24h
- Rendering: `renderLookbackCard()` - injects card at grid top
- Cache key: `lookback_daily_[date]` in localStorage
- Dismiss state: `lookback_dismissed_[date]` in localStorage
- Anniversary detection: `new Date(pin.created_at)` vs `new Date()` year comparison
- Seasonal match: month-to-month comparison (Dec-Feb = Winter, etc.)
- Click tracking: increments `pin.click_count` on card click
- File: `boards/index.html` (lines ~7900-8250)
- CSS: `.lookback-card` and `.lookback-mini-card` styles in same file
- Phase 1 complete - multi-signal scoring, daily cache, dismiss
- Phase 2+ planned - grouping, themes, preferences (see Known Extensions)
