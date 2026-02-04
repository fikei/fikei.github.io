# Systemic

> AI-powered design system generator that reverse-engineers websites into Material Design-compliant documentation.

**URL**: [ctrl.rodeo/systemic](https://ctrl.rodeo/systemic)
**Status**: 🟢 Active
**Last Updated**: 2026-02-04

---

## Description

Systemic (SystemicAI) analyzes any website and extracts its design system, generating comprehensive documentation including:

- **Design Tokens** - Colors, typography, spacing, shadows
- **Component Patterns** - Buttons, inputs, cards, modals
- **Material Design Mapping** - Converts findings to MD tokens
- **Documentation Generation** - Exportable design system docs

Perfect for understanding existing design systems, auditing consistency, or bootstrapping new projects from inspiration sites.

---

## Product Status

| Feature | Status | Notes |
|---------|--------|-------|
| Website crawler | ✅ Complete | Extracts CSS/HTML patterns |
| Token extraction | ✅ Complete | Colors, typography, spacing |
| Component detection | ✅ Complete | Identifies UI patterns |
| Material Design mapping | ✅ Complete | Converts to MD tokens |
| Documentation generation | ✅ Complete | Exports as markdown |
| Multi-site comparison | 🔄 Planned | Compare multiple systems |
| AI-powered suggestions | 🔄 Planned | Improvement recommendations |

---

## Active Work

### Current Sprint
- [ ] Improve component detection accuracy
- [ ] Add export formats (JSON, CSS variables)
- [ ] Performance optimization for large sites

### Recently Completed
- [x] Core website crawler
- [x] Token mapper utility
- [x] Component consolidator
- [x] Documentation viewer
- [x] Dark/light mode support

---

## Recent Features

### Website Analysis
- Enter any URL to analyze
- Crawls CSS and HTML structure
- Identifies repeated patterns
- Extracts design decisions

### Token Mapping
- Automatic color palette extraction
- Typography scale detection
- Spacing system inference
- Shadow and border analysis

### Documentation Export
- Material Design-compliant format
- Markdown output
- Token variable generation
- Component examples

---

## Human TODO

> Tasks that require manual attention or decisions

- [ ] Test with more complex websites (SPAs, heavy JS)
- [ ] Define accuracy metrics for component detection
- [ ] Design comparison view for multiple systems
- [ ] Create example outputs for portfolio
- [ ] Evaluate AI integration for design suggestions

---

## Strategy

### Vision
Make design system creation effortless - analyze any site, get a complete design system instantly.

### Target Users
- Designers reverse-engineering inspiration
- Developers bootstrapping new projects
- Design system teams auditing consistency
- Agencies analyzing client sites

### Differentiation
- AI-powered pattern recognition
- Material Design compliance out of the box
- One-click analysis (no setup required)

### Success Metrics
- Sites analyzed per day
- Token extraction accuracy
- Component detection precision
- User exports generated

---

## Technical Documentation

| File | Purpose |
|------|---------|
| `js/crawler.js` | Website crawling and HTML/CSS extraction |
| `js/app.js` | Main application logic |
| `js/doc-generator.js` | Documentation generation |
| `js/viewer.js` | Results visualization |
| `js/component-consolidator.js` | Pattern consolidation |
| `js/token-mapper.js` | Material Design token mapping |

### Supabase Functions
- `systemic-analyze/` - Server-side analysis
- `systemic-fetch/` - Data retrieval

---

## Quick Links

| Resource | Link |
|----------|------|
| Live App | [ctrl.rodeo/systemic](https://ctrl.rodeo/systemic) |
| Design System | [../design-system/](../design-system/) |
