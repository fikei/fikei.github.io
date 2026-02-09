# Systemic

> Design system reverse-engineering, visualization, and QA governance tool

**Status**: Active
**Last Updated**: 2026-02-09

---

## What Is This?

Systemic extracts design systems from existing websites and provides QA governance for your own design system. Point it at any URL and it crawls CSS/HTML to identify design tokens, component patterns, and generates Material Design-compliant documentation. It also serves as the QA frontend for the CTRL Design System itself.

---

## Key Features

- **Website crawling** — Fetches and parses CSS/HTML from any URL
- **Design token extraction** — Colors, typography, spacing, elevation
- **Component pattern detection** — Identifies repeated patterns and variants
- **Material Design token mapping** — Maps findings to Material Design 3 tokens
- **Local design system self-scan** — Loads `manifest.json` + `template-registry.json` without crawling
- **Variant audit QA** — Stoplight-based governance for design system variants
- **Preferred variant marking** — Designate recommended variants per template/size
- **Runtime constraint validation** — Validates components against design system rules
- **Debug logging** — Comprehensive categorized logs with JSON export

---

## Try It

1. Open [ctrl.rodeo/systemic](https://ctrl.rodeo/systemic)
2. Enter any URL — or click "Scan Local" to load the CTRL Design System
3. View extracted tokens, components, and documentation
4. Use the QA view to audit widget template variants

---

## Architecture

```
URL → Crawler → Token Extractor → Pattern Matcher → MD Generator → Docs
                                                         ↓
Local DS → manifest.json + template-registry.json → Viewer + QA Audit
```

### Core Modules

| File | Purpose |
|------|---------|
| `js/app.js` | Main application controller — routing, crawling, system management, dev menu |
| `js/viewer.js` | Split-context documentation viewer (Design/Code tabs) |
| `js/variant-audit.js` | Stoplight QA governance for widget template variants |
| `js/crawler.js` | Fetches and parses website CSS/HTML |
| `js/token-mapper.js` | Maps findings to Material Design tokens |
| `js/component-consolidator.js` | Identifies repeated patterns |
| `js/doc-generator.js` | AI-powered documentation generation |

### Utility Modules

| File | Purpose |
|------|---------|
| `js/utils/dom-utils.js` | DOM parsing and manipulation |
| `js/utils/color-utils.js` | Color analysis and conversion |
| `js/utils/material-tokens.js` | Material Design 3 token definitions |

### Stylesheets

| File | Purpose |
|------|---------|
| `css/systemic.css` | Main application styles, navigation, system cards |
| `css/viewer.css` | Documentation viewer, component stage, context sidebar |
| `css/variant-audit.css` | QA view: variant items, grid test, audit log table |

---

## Views

### Systems View (`#systems`)
Grid of saved design systems with token/component/page counts.

### Audit View (`#audit`)
Website crawl form with options for max pages, crawl depth, auth headers, and URL exclusion patterns. Real-time progress display with stats and crawl log.

### Docs View (`#docs/*`)
Split-context documentation viewer:
- **Design context** (sidebar): Specs, description, usage notes, accessibility, states
- **Code context** (sidebar): Tokens, CSS, HTML, React code with copy-to-clipboard
- **Component stage** (main): Variant gallery with inline QA controls and audit log

### QA View (`#qa`)
Widget template variant audit with:
- **Stoplight governance**: Green (OK), Yellow (comment to process), Orange (needs review), Red (blocked)
- **Preferred variants**: Mark recommended variants with a badge
- **Grid test**: Column permutation testing (1-4 columns) with grid lines overlay
- **Audit log**: Sortable table with JSON export and bulk clear

---

## QA Stoplight System

| Color | Meaning | Action |
|-------|---------|--------|
| Green | No updates needed | None |
| Yellow | Comment left, needs developer action | Process the comment |
| Orange | Developer acted, awaiting designer approval | Approve or reject |
| Red | Blocked — variant should not be implemented | Remove or redesign |

---

## Dev Menu

Press `/` or click the dev menu button in the header:

- **Reload local system** — Re-scan `manifest.json` + `template-registry.json`
- **Clean up duplicates** — Remove duplicate design system entries
- **Copy debug log** — Copy categorized debug logs to clipboard as JSON
- **Download debug log** — Save debug logs to file
- **Clear all data** — Reset all localStorage data

---

## Supabase Integration

Systemic uses the `atdqdfpdeytfuvvpsasz` Supabase project for AI-powered documentation generation via the doc-generator module.

---

## Related Files

- [`/design-system/manifest.json`](/design-system/manifest.json) — Auto-generated design system index
- [`/design-system/template-registry.json`](/design-system/template-registry.json) — Widget template definitions
- [`/design-system/widgets.html`](/design-system/widgets.html) — Interactive widget showcase
- [`/boards/design-constraints.js`](/boards/design-constraints.js) — Runtime constraint engine (consumer)
- [`/scripts/parse-design-system.js`](/scripts/parse-design-system.js) — Manifest generator script
