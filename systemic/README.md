# Systemic

> 🧪 **Playground Project** - AI design system reverse-engineering

**Status**: 🟡 Experimental

---

## What Is This?

An experiment in extracting design systems from existing websites. Point it at any URL and it crawls the CSS/HTML to identify design tokens, component patterns, and generates Material Design-compliant documentation.

**Key Features:**
- Website crawling and CSS extraction
- Design token identification (colors, typography, spacing)
- Component pattern detection
- Material Design token mapping
- Documentation export

---

## Try It

1. Open [ctrl.rodeo/systemic](https://ctrl.rodeo/systemic)
2. Enter any URL
3. Click "Run a scan"
4. View extracted design system

---

## How It Works

```
URL → Crawler → Token Extractor → Pattern Matcher → MD Generator → Docs
```

| File | Purpose |
|------|---------|
| `js/crawler.js` | Fetches and parses website CSS/HTML |
| `js/token-mapper.js` | Maps findings to Material Design tokens |
| `js/component-consolidator.js` | Identifies repeated patterns |
| `js/doc-generator.js` | Generates documentation |

---

## Ideas / TODO

- [ ] Better SPA/JS-heavy site handling
- [ ] Multi-site comparison view
- [ ] Export to Figma format
- [ ] AI-powered design suggestions
