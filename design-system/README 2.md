# Sassy: CTRL (global layer)

> Minimal, high-contrast design system powering all ctrl.rodeo products.

**Status**: 🟢 Active
**Last Updated**: 2026-02-05

---

## Product Overview

Sassy's CTRL layer provides a unified visual language across all ctrl.rodeo applications. It emphasizes clarity, speed, and a distinctive code-like aesthetic.

### Used By
- **Boards** - Link curation app
- **Soundscape** - Audio visualization
- **Systemic** - Design system generator

### Human TODO

> Tasks that require manual attention or decisions

- [ ] Add responsive breakpoint documentation
- [ ] Create accessibility audit checklist
- [ ] Design additional icon set
- [ ] Document animation principles
- [ ] Create Figma component library

---

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

### Filter Bar

Horizontally scrollable navigation for category/filter selection.

```html
<nav class="filters">
  <input type="text" class="search-input" placeholder="Search...">
  <button class="filter-token filter-token--active" data-category="all">All</button>
  <button class="filter-token" data-category="home">Home</button>
  <button class="filter-token" data-category="wear">Wear</button>
  <!-- More filters... -->
</nav>
```

**Filter bar behavior:**
- Sticky positioned at top of viewport
- Horizontal scroll when content overflows (no wrap)
- Hidden scrollbar for clean appearance
- Tokens don't shrink (flex-shrink: 0)
- Active state inverts colors (filled)
- Touch-friendly with momentum scrolling on mobile

### Search Input

Inline search input styled to match filter tokens.

```html
<input type="text" class="search-input" placeholder="Search..." autocomplete="off">
```

**Search input behavior:**
- 10px uppercase monospace text
- Matches filter token height and border style
- Muted placeholder color
- Focus: subtle background change, no outline
- Min-width: 120px, max-width: 200px

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

### User Menu Dropdown

A dropdown menu for user account actions, typically positioned in the top-right corner.

```html
<div class="user-menu">
  <button class="user-menu__trigger">
    <span class="user-menu__email">username</span>
  </button>
  <div class="user-menu__dropdown user-menu__dropdown--visible">
    <div class="user-menu__header">
      <div class="user-menu__header-email">user@example.com</div>
      <span class="user-menu__header-badge">Admin</span>
    </div>
    <button class="user-menu__item">Account</button>
    <button class="user-menu__item user-menu__item--danger">Logout</button>
  </div>
</div>
```

**User menu behavior:**
- Trigger shows truncated email with dropdown arrow
- Dropdown positioned below trigger, aligned right
- Header shows full email and optional badge
- Items are full-width buttons with hover invert
- Danger variant for destructive actions (red)
- Close on click outside

### Account Section

Form-like display sections for account information.

```html
<div class="account-section">
  <label class="account-label">Email</label>
  <div class="account-value">user@example.com</div>
</div>

<div class="account-section">
  <label class="account-label">User ID</label>
  <div class="account-value account-value--mono">abc-123-def</div>
</div>
```

**Account section behavior:**
- Label: 9px uppercase monospace, muted color
- Value: Serif font by default
- `--mono` modifier for technical values (IDs, codes)

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

**Grid behavior:**
- Uses CSS Grid with `grid-auto-flow: dense` for automatic gap filling
- Responsive columns: 2 (mobile) → 3 → 4 → 5 (large screens)
- Expanded items (2x2 or 3x2) trigger reflow of smaller items

### Sub-Tags

Secondary filter bar that appears when a category is selected.

```html
<nav class="sub-tags sub-tags--visible">
  <button class="sub-tag sub-tag--active" data-subtag="">All<span class="sub-tag__count">47</span></button>
  <button class="sub-tag" data-subtag="tops">Tops<span class="sub-tag__count">12</span></button>
  <button class="sub-tag" data-subtag="bottoms">Bottoms<span class="sub-tag__count">8</span></button>
  <button class="sub-tag" data-subtag="footwear">Footwear<span class="sub-tag__count">15</span></button>
  <button class="sub-tag" data-subtag="other">Other<span class="sub-tag__count">4</span></button>
</nav>
```

**Sub-tags behavior:**
- Hidden by default, shown when category selected
- Smaller than filter tokens (9px vs 10px)
- Muted color with subtle border (--muted, --subtle)
- Active state inverts like filter tokens
- Count shown inline with reduced opacity
- Horizontally scrollable on overflow

### Empty State

Full-page centered state for empty views with optional CTA.

```html
<!-- New user welcome -->
<div class="empty-state">
  <div class="empty-state__box">
    <h2 class="empty-state__title">Welcome to Boards</h2>
    <p class="empty-state__text">Collect and organize links you love.</p>
    <div class="empty-state__actions">
      <button class="empty-state__cta">Add Your First Link</button>
    </div>
    <p class="empty-state__hint">Tip: Paste any URL directly on this page</p>
  </div>
</div>

<!-- No search results -->
<div class="empty-state">
  <div class="empty-state__box">
    <p class="empty-state__text">No links match "query"</p>
    <button class="empty-state__clear">Clear Search</button>
  </div>
</div>
```

**Empty state behavior:**
- Centered vertically and horizontally in grid
- Box: bordered, max-width 320px, centered text
- Title: 18px uppercase with letter-spacing
- CTA button: filled style, inverts on hover
- Hint text: muted, smaller font
- Clear button: outline style, inverts on hover

### Admin Panel Actions

Button group for admin panel sections.

```html
<div class="admin-panel__section">
  <div class="admin-panel__section-title">Data Export</div>
  <div class="admin-panel__actions">
    <button class="admin-panel__btn">Export JSON</button>
    <button class="admin-panel__btn">Export CSV</button>
  </div>
</div>
```

**Admin actions behavior:**
- Flexbox with gap spacing
- Wraps on narrow screens
- Buttons match admin panel style

### AI Widget Card

Standardized container for AI-powered recommendation widgets. Header sits outside the content box.

```html
<div class="widget-complete" data-widget-id="widget-123">
  <div class="widget-complete__header">
    <div class="widget-complete__header-left">
      <span class="widget-complete__title">Style Summary</span>
      <span class="widget-complete__badge">AI</span>
    </div>
    <button class="widget-complete__refresh-btn" onclick="refreshWidget('widget-123')" title="Refresh suggestions">⟳</button>
  </div>
  <div class="widget-complete__body">
    <!-- Widget-specific content goes here -->
  </div>
</div>
```

**Structure:**
```
WIDGET TITLE   [AI]                         ⟳   ← Header (outside box)
┌─────────────────────────────────────────────┐
│  Widget content                             │  ← Body (bordered box)
└─────────────────────────────────────────────┘
```

**AI Widget Card behavior:**
- Outer wrapper: no border, contains header + body
- Header: Title (muted, xs) + AI badge (outline) + Refresh icon (16px, floating right)
- AI badge: outline style (transparent bg, muted border), 9px uppercase
- Refresh icon: ⟳ character, 16px, muted color, hover effect
- Body: bordered box (--subtle border, --surface bg) holds widget content
- Loading state: use `.widget-complete__body--loading` for centered loader

**Loading state:**
```html
<div class="widget-complete__body widget-complete__body--loading">
  <div class="widget__loader">Generating insights...</div>
</div>
```

**Variants:**

```html
<!-- Complete the Look Widget -->
<div class="widget-complete" data-widget-id="complete-look">
  <div class="widget-complete__header">...</div>
  <div class="widget-complete__body">
    <div class="widget-complete__section">
      <div class="widget-complete__items"><!-- User's items --></div>
    </div>
    <div class="widget-complete__divider"></div>
    <div class="widget-complete__section">
      <div class="widget-complete__items"><!-- AI suggestions --></div>
    </div>
  </div>
</div>

<!-- Style Summary Widget -->
<div class="widget-complete" data-widget-id="style-summary">
  <div class="widget-complete__header">...</div>
  <div class="widget-complete__body">
    <div class="widget-style__content">
      <div class="widget-style__label">Minimal Modern</div>
      <div class="widget-style__sublabel">Based on 12 items</div>
      <div class="widget-style__traits">
        <span class="widget-style__trait">Clean lines</span>
        <span class="widget-style__trait">Neutral palette</span>
      </div>
    </div>
  </div>
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
