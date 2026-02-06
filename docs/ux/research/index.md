# UX Research

Design research findings that inform product decisions. Each study documents the problem space, methodology, findings, and how results map to implementation.

---

## Studies

| Study | Date | Status | Outcome |
|-------|------|--------|---------|
| [Widget Template Patterns](./widget-template-patterns.md) | 2026-02-06 | Complete | 30 templates (19 consumption, 1 hybrid, 10 action) across 12 categories, 48 widget concepts |

---

## Research Process

```
Observe          →  Frame           →  Generate        →  Validate
User needs &        Pattern            Concepts &         Map to
content types       language           wireframes         implementation
```

## How Research Feeds the Product

- **Template patterns** → `WIDGET_TEMPLATES` in `boards/index.html`
- **Widget concepts** → Widget configs in `config/widgets/*.ts`
- **Category mappings** → Eligibility rules in widget schema
