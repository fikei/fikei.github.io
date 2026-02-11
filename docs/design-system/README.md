# Design System

> Shared UI tokens, components, and widget templates for ctrl.rodeo

**Status**: Production
**Code**: [`/design-system/`](../../design-system/)
**Showcase**: [ctrl.rodeo/design-system](https://ctrl.rodeo/design-system/)

---

## What it does

A minimal, high-contrast design system (black/white) powering all ctrl.rodeo products. Provides design tokens, 30+ reusable components, and 11 widget templates with a config-driven rendering pipeline.

## Key files

| File | Purpose |
|------|---------|
| `tokens.css` | Design tokens (colors, typography, spacing, animation) |
| `components.css` | 30+ reusable UI components |
| `widgets.css` | Widget atoms, molecules, and body templates |
| `widgets.html` | Interactive showcase with 44 widget instances + QA audit |
| `template-registry.json` | Widget template definitions with fixtures |
| `widget-registry.json` | Widget-to-template-to-category mapping |
| `manifest.json` | Auto-generated component index (derived, do not edit) |

## Widget templates (11)

verdict, list, spectrum, split, narrative, suggestion, stats, comparison, choices, checklist, grouped

## Documentation

| Category | Path | Contents |
|----------|------|----------|
| **Full guide** | [`/design-system/README.md`](../../design-system/README.md) | Tokens, components, usage examples |
| **PRDs** | [`prd/`](prd/) | Design system validation pipeline |
| **Technical** | [`technical/`](technical/) | Tech stack reference |
