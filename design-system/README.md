# CTRL Design System

A minimal, high-contrast design system for ctrl.rodeo projects.

## Philosophy

- **High contrast** — Pure black and white as primary colors
- **Monospace-first** — Technical, code-like aesthetic
- **Minimal** — Borders over fills, function over decoration
- **Dark-first** — Dark mode default with optional light mode
- **Accessible** — Clear visual hierarchy, readable text

## Quick Start

```html
<link rel="stylesheet" href="/design-system/tokens.css">
<link rel="stylesheet" href="/design-system/components.css">
```

## Design Tokens

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#111` | Page background |
| `--fg` | `#fff` | Primary text |
| `--fg-muted` | `#888` | Secondary text |
| `--border` | `#fff` | Borders, dividers |
| `--border-subtle` | `#333` | Subtle dividers |

### Typography

| Token | Value | Usage |
|-------|-------|-------|
| `--font-mono` | Courier New | Primary (UI, body) |
| `--font-serif` | Georgia | Headings, display |
| `--font-sans` | Space Grotesk | Alternative UI |
| `--text-xs` | 10px | Buttons, labels |
| `--text-sm` | 12px | Body text |
| `--text-lg` | 18px | Headings |

### Spacing

4px base unit: `--space-1` (4px) through `--space-16` (64px)

### Animation

| Token | Value | Usage |
|-------|-------|-------|
| `--duration-fast` | 0.1s | Micro-interactions |
| `--duration-normal` | 0.15s | Buttons, hovers |
| `--duration-slow` | 0.2s | Transitions |

## Components

### Buttons

```html
<!-- Default button -->
<button class="btn">Button</button>

<!-- Filled button -->
<button class="btn btn--filled">Submit</button>

<!-- Danger button -->
<button class="btn btn--danger">Delete</button>

<!-- Small button -->
<button class="btn btn--sm">Small</button>

<!-- Full width -->
<button class="btn btn--block">Full Width</button>
```

**Button behavior:**
- 10px uppercase text
- Transparent background by default
- Inverts on hover (bg ↔ fg swap)
- 0.15s smooth transition

### Inputs

```html
<input type="text" class="input" placeholder="Enter text">
<textarea class="input textarea"></textarea>
<select class="input select">...</select>
```

### Cards

```html
<div class="card">
  Content here
</div>

<div class="card card--interactive">
  Clickable card
</div>
```

### Tokens / Tags

```html
<button class="token">Category</button>
<button class="token token--active">Active</button>
```

### Modal

```html
<div class="modal modal--visible">
  <div class="modal__content">
    <h2 class="modal__title">Title</h2>
    <p>Content</p>
    <div class="modal__actions">
      <button class="btn">Cancel</button>
      <button class="btn btn--filled">Confirm</button>
    </div>
  </div>
</div>
```

### Toast

```html
<div class="toast-container">
  <div class="toast">Message saved</div>
  <div class="toast toast--error">Error occurred</div>
</div>
```

### Toggle Switch

```html
<button class="toggle">
  <div class="toggle__knob"></div>
</button>

<button class="toggle toggle--active">
  <div class="toggle__knob"></div>
</button>
```

### Tabs

```html
<div class="tabs">
  <button class="tab tab--active">Tab 1</button>
  <button class="tab">Tab 2</button>
  <button class="tab">Tab 3</button>
</div>
```

### Status Indicator

```html
<div class="status status--success">
  <span class="status__dot"></span>
  Connected
</div>
```

### Progress Bar

```html
<div class="progress">
  <div class="progress__fill" style="width: 50%"></div>
</div>
<div class="progress__status">Loading 5/10...</div>
```

### Spinner

```html
<div class="spinner"></div>
```

### Grid

```html
<div class="grid grid--3">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>
```

## Light Mode

Add `.light` class to `<html>` to enable light mode:

```html
<html class="light">
```

Or toggle via JavaScript:
```javascript
document.documentElement.classList.toggle('light');
```

## Projects Using This System

- **Board** — Link curation with Swiss grid aesthetic
- **Soundscape** — Audio-reactive visualization controls

## File Structure

```
/design-system/
  tokens.css      # Design tokens (colors, typography, spacing)
  components.css  # Reusable UI components
  README.md       # Documentation
```
