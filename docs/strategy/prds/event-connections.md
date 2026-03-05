# PRD: Taste-Graph Enhanced Event Recommendations

**Version:** 1.0
**Date:** 2026-03-05
**Status:** Active

---

## Overview

Event recommendations in ctrl.rodeo match on literal strings — artist names, genre keywords, title words. This works for direct hits ("you saved DJ Shadow → here's a DJ Shadow show") but misses the deeper signal: *taste identity*.

The `taste-graph` edge function already computes rich taste labels (e.g. "Grimy New Wave", "Utilitarian Uniform") and cross-domain bridges (e.g. "your brutalism interest connects to your techno saves"). But this output **never reaches the event recommendation pipeline**. The two systems are completely disconnected.

This PRD defines how to feed taste-graph context into the `recommend-events` AI prompt, so Claude can reason about aesthetic and cultural fit — not just keyword overlap.

---

## Goals

1. **Enrich the AI ranking prompt** with taste identities, cross-domain bridges, and recurring motifs
2. **Improve recommendation quality** — surface events that match a user's aesthetic posture, not just their literal search terms
3. **Zero additional AI cost** — reuse the existing `taste-graph` call (cached client-side), inject output into the existing `recommend-events` Haiku call

---

## Non-Goals (Backlog)

- New database tables or connection storage
- New edge functions
- User-created event↔pin links (blocked on Pin Type Abstraction)
- Visual graph exploration of taste connections
- Changes to the `taste-graph` edge function itself

---

## Who This Serves

| Persona | Job To Be Done | How This Helps |
|---------|----------------|----------------|
| Sound & Scene Curator | "Find events that match my vibe, not just my playlist" | Taste labels like "Grimy New Wave" match events by cultural fit, not just genre tags |
| DJ | "Discover shows aligned with the aesthetic I'm building" | Cross-domain bridges reveal event connections a keyword search would miss |
| Cultural Omnivore | "Get recommendations that understand my taste across categories" | Motifs and bridges surface events matching cross-category patterns |

---

## Design Principles

| Brand Principle | Application |
|----------------|-------------|
| Input shapes output | Taste-graph transforms raw saves into taste identity → that identity shapes event discovery |
| Organize as you go | No user action required — taste context computed and cached automatically |
| One place, whole life | Cross-domain bridges mean your fashion saves can inform your event recommendations |
| Show, don't decorate | Recommendation reasons reference taste labels directly ("matches your Grimy New Wave identity") |
| Expand with the user | More saves → richer clusters → better event matching — quality improves with use |

---

## Technical Approach

### Data Flow

```
User's pins (localStorage)
  → buildClustersFromLinks()     [client, sync]
    → POST /taste-graph           [1 Haiku call, cached 6h]
      → { clusters, bridges, motifs }
        → attached to EventProfile.tasteContext
          → POST /recommend-events  [existing Haiku call, enriched prompt]
            → events ranked by taste fit + keyword match
```

### Server Change: `recommend-events`

Add optional `tasteContext` field to `EventProfile`. When present, inject 2-3 lines into the AI prompt:

- **Taste identities**: top 6 cluster labels with domains (e.g. "Grimy New Wave (music), Scandinavian Silence (design)")
- **Cross-domain connections**: top 2 bridges with reasons
- **Recurring themes**: top 3 motifs

Add one rule: "Use taste identity labels to reason about aesthetic and cultural fit, not just literal keyword overlap."

Backward-compatible — when `tasteContext` is absent, behavior is identical to today.

### Client Change: Both Apps

Add `buildClustersFromLinks(links)` — groups pins by category, extracts `topTokens` from title word frequencies, returns cluster input array.

Add `loadTasteContext(links)` — checks localStorage cache (6h TTL, 5-pin drift tolerance), calls `taste-graph` on cache miss, returns `{ clusters, bridges, motifs }` or `null` on failure.

Wire into `loadEventsForYouWidget()` (boards) and `loadRecommendedEvents()` (events) — inject `tasteContext` onto `profile` before the `recommend-events` call.

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Additional AI calls | 0 (taste-graph already called, cached client-side) |
| Token budget increase | ~80 tokens added to ranking prompt |
| Cache TTL | 6 hours |
| Minimum pins for taste context | 2+ clusters with 3+ pins each |
| Graceful degradation | If taste-graph fails, recommend-events works identically to today |

---

## Cost Model

| Component | Per User/Month | At 1,000 Users |
|-----------|---------------|----------------|
| Additional Haiku calls | $0 | $0 |
| Additional prompt tokens (~80/call) | ~$0.001 | ~$1/month |
| **Total incremental cost** | **~$0.001** | **~$1/month** |

The `taste-graph` call cost is already budgeted separately. This feature only adds ~80 tokens to the existing `recommend-events` prompt.

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Recommendation click-through | +20% over keyword-only baseline | Client event tracking on event card clicks |
| Taste-label references in reasons | 30%+ of AI reasons mention a taste label | Parse `relevance.reasons` for cluster label strings |
| Algorithm distribution | 80%+ of calls use `hybrid` (vs `keyword-only`) | `meta.algorithm` field in responses |
| Cache hit rate | 70%+ of `loadTasteContext` calls served from cache | Console log analysis |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Token budget increase degrades ranking | AI has less room for event evaluation | Trim `topCategories` from 5 to 3; keep taste lines concise |
| Taste labels add noise for small collections | Bad cluster labels mislead AI | Require 2+ clusters with 3+ pins each; skip gracefully |
| Both apps race to populate cache | Duplicate `taste-graph` calls | Same cache key in both apps; second write is harmless |
| `taste-graph` latency on cold path (~800ms) | Delays event widget appearance | Both callers are already async/non-blocking; no UX regression |

---

## Open Questions

1. ~~Should the client call taste-graph first and pass results, or should recommend-events call taste-graph internally?~~ **Resolved:** Client-side with cache. Avoids server fan-out and stays within cost budget.

---

## Related Documents

- [Cross-Category Connections UX](../../ux/boards/cross-category.md)
- [Phase 12: Lookback](../../execution/project-plan/phase-12-lookback.md) — Epic 12.3
- [Database Schema](../../infrastructure/technical-design/database-schema.md)
- [Brand Positioning](../brand-positioning.md)
- [User Personas](../../ux/personas.md)
