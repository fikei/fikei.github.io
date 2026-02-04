# Decision Log (ADRs)

> Architecture Decision Records for ctrl.rodeo

---

## Format

Each decision follows this format:
- **Status**: Proposed | Accepted | Deprecated | Superseded
- **Context**: What is the issue?
- **Decision**: What did we decide?
- **Consequences**: What are the trade-offs?

---

## Decisions

### ADR-001: Use Vanilla JavaScript (No Frameworks)

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Need to decide on frontend technology stack. Options include React, Vue, Svelte, or vanilla JS.

**Decision**: Use vanilla JavaScript with no frontend framework.

**Consequences**:
- (+) Smaller bundle sizes
- (+) No build step required for simple changes
- (+) Full control over DOM
- (-) More manual state management
- (-) No component ecosystem

---

### ADR-002: Supabase as Backend

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Need backend services for authentication, database, and serverless functions.

**Decision**: Use Supabase for all backend services.

**Consequences**:
- (+) Integrated auth, database, functions
- (+) Generous free tier
- (+) Real-time subscriptions
- (-) Vendor lock-in
- (-) Limited function runtime (Deno)

---

### ADR-003: Claude as Primary AI

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Multiple AI providers available (OpenAI, Anthropic, Google). Need to choose primary.

**Decision**: Use Claude 3 Haiku as primary AI with GPT-4o mini as fallback.

**Consequences**:
- (+) Better instruction following
- (+) Cost effective (Haiku)
- (+) Claude Code integration
- (-) Smaller ecosystem than OpenAI
- (-) No image generation

---

### ADR-004: GitHub Pages Hosting

**Date**: 2026-01-XX
**Status**: Accepted

**Context**: Need hosting for static frontend. Options: Vercel, Netlify, GitHub Pages, Cloudflare Pages.

**Decision**: Use GitHub Pages with custom domain.

**Consequences**:
- (+) Free hosting
- (+) Integrated with repo
- (+) Simple deployment
- (-) No server-side rendering
- (-) No edge functions (use Supabase instead)

---

### ADR-005: Products vs Playground Structure

**Date**: 2026-02-04
**Status**: Accepted

**Context**: Need to distinguish between production-ready applications and experimental projects.

**Decision**: Create separate "Products" and "Playground" categories with different documentation standards.

**Consequences**:
- (+) Clear expectations for each project
- (+) Playground projects can move fast without full docs
- (+) Promotes experimentation
- (-) Need to manage promotion from Playground to Products

---

## Template

```markdown
### ADR-XXX: [Title]

**Date**: YYYY-MM-DD
**Status**: Proposed | Accepted | Deprecated | Superseded

**Context**: [What is the issue?]

**Decision**: [What did we decide?]

**Consequences**:
- (+) [Positive consequence]
- (-) [Negative consequence]
```

---

*Last updated: 2026-02-04*
