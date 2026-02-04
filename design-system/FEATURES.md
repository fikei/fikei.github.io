# Design System - Features

> Complete component and token inventory for ctrl.rodeo

---

## Status Legend

| Icon | Meaning |
|------|---------|
| ✅ | Complete |
| 🔄 | In Progress |
| ⏳ | Planned |

---

## Design Tokens

### Colors

| Token | Value | Purpose |
|-------|-------|---------|
| `--bg` | #111 | Page background |
| `--fg` | #fff | Primary text |
| `--fg-muted` | #888 | Secondary text |
| `--border` | #fff | Borders |
| `--border-subtle` | #333 | Subtle borders |
| `--color-success` | #0f0 | Success states |
| `--color-error` | #c00 | Error states |
| `--color-warning` | #f90 | Warning states |

### Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-primary` | Space Grotesk | Default UI |
| `--font-serif` | Georgia | Headings |
| `--font-mono` | Space Grotesk | Code |
| `--text-xs` | 10px | Labels |
| `--text-sm` | 10px | Body |
| `--text-lg` | 12px | Subheadings |
| `--text-2xl` | 18px | Headings |
| `--text-3xl` | 24px | Display |

### Spacing (4px base)

| Token | Value |
|-------|-------|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-4` | 16px |
| `--space-8` | 32px |
| `--space-16` | 64px |

### Animation

| Token | Value |
|-------|-------|
| `--duration-fast` | 0.1s |
| `--duration-normal` | 0.15s |
| `--duration-slow` | 0.2s |

---

## Components

### Buttons

| Variant | Class | Status |
|---------|-------|--------|
| Default | `.btn` | ✅ |
| Filled | `.btn--filled` | ✅ |
| Danger | `.btn--danger` | ✅ |
| Ghost | `.btn--ghost` | ✅ |
| Small | `.btn--sm` | ✅ |
| Large | `.btn--lg` | ✅ |
| Block | `.btn--block` | ✅ |

### Form Elements

| Component | Class | Status |
|-----------|-------|--------|
| Text Input | `.input` | ✅ |
| Textarea | `.input` | ✅ |
| Select | `.input` | ✅ |
| Checkbox | `.checkbox` | ✅ |
| Toggle Switch | `.toggle` | ✅ |
| Range Slider | `input[type="range"]` | ✅ |

### Layout

| Component | Class | Status |
|-----------|-------|--------|
| Card | `.card` | ✅ |
| Interactive Card | `.card--interactive` | ✅ |
| Modal | `.modal` | ✅ |
| Overlay | `.overlay` | ✅ |
| Grid (2-5 cols) | `.grid-{n}` | ✅ |

### Navigation

| Component | Class | Status |
|-----------|-------|--------|
| Tabs | `.tabs`, `.tab` | ✅ |
| Filter Bar | `.filter-bar` | ✅ |
| User Menu | `.user-menu` | ✅ |
| Dropdown | `.dropdown` | ✅ |

### Feedback

| Component | Class | Status |
|-----------|-------|--------|
| Toast | `.toast` | ✅ |
| Toast Error | `.toast--error` | ✅ |
| Spinner | `.spinner` | ✅ |
| Progress Bar | `.progress` | ✅ |
| Status Indicator | `.status-indicator` | ✅ |

### Data Display

| Component | Class | Status |
|-----------|-------|--------|
| Token/Tag | `.token` | ✅ |
| Active Token | `.token--active` | ✅ |
| Account Section | `.account-section` | ✅ |

---

## Theme Support

| Theme | Activation | Status |
|-------|------------|--------|
| Dark (default) | Default | ✅ |
| Light | Add `.light` to `<html>` | ✅ |

---

## Utilities

### Text

| Class | Effect |
|-------|--------|
| `.text-muted` | Muted color |
| `.text-mono` | Monospace font |
| `.text-center` | Center align |
| `.text-right` | Right align |

### Display

| Class | Effect |
|-------|--------|
| `.hidden` | display: none |
| `.flex` | display: flex |
| `.inline-flex` | display: inline-flex |

### Spacing

| Class | Effect |
|-------|--------|
| `.mt-{1-8}` | Margin top |
| `.mb-{1-8}` | Margin bottom |
| `.p-{1-8}` | Padding |

---

## Usage

```html
<!-- Include in your HTML -->
<link rel="stylesheet" href="/design-system/tokens.css">
<link rel="stylesheet" href="/design-system/components.css">

<!-- Example button -->
<button class="btn btn--filled">Save</button>

<!-- Example card -->
<div class="card card--interactive">
  <h3>Title</h3>
  <p class="text-muted">Description</p>
</div>
```

---

## Future Components

| Component | Priority | Status |
|-----------|----------|--------|
| Accordion | Medium | ⏳ |
| Breadcrumbs | Low | ⏳ |
| Pagination | Medium | ⏳ |
| Date Picker | Low | ⏳ |
| Popover | Medium | ⏳ |

---

*Last updated: 2026-02-04*
