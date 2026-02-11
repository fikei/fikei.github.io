# Systemic

> Design system reverse-engineering, visualization, and QA governance

**Status**: Experimental
**Code**: [`/systemic/`](../../systemic/)
**Live**: [ctrl.rodeo/systemic](https://ctrl.rodeo/systemic/)

---

## What it does

Systemic crawls any website to extract design tokens (colors, typography, spacing), identifies component patterns, maps to Material Design 3 tokens, and provides a stoplight QA governance system for widget variant auditing.

## Key capabilities

- **Website crawling** — Fetch and parse CSS/HTML from any URL
- **Design token extraction** — Colors, typography, spacing, elevation
- **Component pattern detection** — Identify repeated patterns and variants
- **Material Design mapping** — Maps findings to MD3 token system
- **Local design system scan** — Loads manifest.json + template-registry.json
- **Variant audit QA** — Stoplight governance (green/yellow/orange/red)
- **Preferred variant marking** — Designate recommended variants

## Supabase functions

| Function | Project | Purpose |
|----------|---------|---------|
| `systemic-analyze` | Systemic | AI-powered design system analysis |
| `systemic-fetch` | Systemic | Website fetching for crawling |

## Documentation

| Category | Path | Contents |
|----------|------|----------|
| **PRD** | [`prd/`](prd/) | Variant audit product requirements |
| **Plan** | [`plan/`](plan/) | Variant audit execution plan |
| **In-repo** | [`/systemic/README.md`](../../systemic/README.md) | Architecture, features, views |
