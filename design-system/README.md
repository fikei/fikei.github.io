# CTRL Design System

> Minimal, high-contrast design system powering all ctrl.rodeo products.

**Status**: 🟢 Active
**Last Updated**: 2026-02-05

---

## Product Overview

The CTRL Design System provides a unified visual language across all ctrl.rodeo applications. It emphasizes clarity, speed, and a distinctive code-like aesthetic.

### Used By
- **Boards** - Link curation app
- **Events** - Event aggregator with location filtering
- **Soundscape** - Audio visualization
- **Systemic** - Design system generator
- **Favicon** - AI favicon generator

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

<!-- Ghost (borderless until hover) -->
<button class="btn btn--ghost">Ghost</button>

<!-- Dashed (add-new affordance) -->
<button class="btn btn--sm btn--dashed">+ Add Source</button>

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

<!-- Non-interactive (read-only badge in tables, etc.) -->
<span class="token token--static">Source Name</span>
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

### Spinner / Loading

```html
<!-- Spinner only -->
<div class="spinner"></div>

<!-- Spinner with text label -->
<div class="loading">
  <div class="spinner"></div>
  <span>Fetching events</span>
</div>
```

### Page Header / Breadcrumb

Sticky header with breadcrumb navigation and action slot. Extracted from Systemic.

```html
<header class="page-header">
  <div class="page-header__inner">
    <nav class="breadcrumb">
      <a href="/" class="breadcrumb__link">ctrl.rodeo</a>
      <span class="breadcrumb__sep">/</span>
      <span class="breadcrumb__current">Events</span>
    </nav>
    <div class="page-header__actions">
      <button class="toggle"><div class="toggle__knob"></div></button>
    </div>
  </div>
</header>
```

### Form Group

Label + input + hint pattern for forms and modals. Extracted from Favicon and Systemic.

```html
<div class="form-group">
  <label class="form-label">Field Name</label>
  <input type="text" class="input" placeholder="Enter value">
  <span class="form-hint">Optional helper text</span>
</div>

<!-- Side-by-side fields -->
<div class="form-row">
  <div class="form-group">
    <label class="form-label">Width</label>
    <input type="number" class="input">
  </div>
  <div class="form-group">
    <label class="form-label">Height</label>
    <input type="number" class="input">
  </div>
</div>
```

### Data Table

Sortable table with sticky headers and row hover. Extracted from Events and Systemic.

```html
<div class="data-table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th data-sort="date">Date <span class="data-table__sort">&#9650;</span></th>
        <th data-sort="name">Name <span class="data-table__sort">&#9650;</span></th>
        <th data-sort="city">City <span class="data-table__sort">&#9650;</span></th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Feb 8</td><td>Event Name</td><td>San Francisco</td></tr>
    </tbody>
  </table>
</div>
```

**Data table behavior:**
- Sticky `thead` on scroll
- `th[data-sort]` gets pointer cursor and hover highlight
- `.sorted .data-table__sort` shows full opacity arrow
- Row hover highlights with `--bg-surface`
- Wrap in `.data-table-wrap` for horizontal scroll overflow

### Filter Bar (Form-based)

Wrapping flex bar for form inputs, selects, and buttons. Distinct from `.filters` (token-based, horizontal-scroll).

```html
<div class="filter-bar">
  <input type="text" class="input" placeholder="Search...">
  <select class="input select">
    <option value="">All Cities</option>
  </select>
  <button class="btn btn--ghost btn--sm">Clear</button>
</div>
```

### Section Header

Title + description block for page sections. Extracted from Systemic and Favicon.

```html
<div class="section-header">
  <h2 class="section-header__title">Section Title</h2>
  <p class="section-header__desc">Brief description of this section.</p>
</div>
```

### Stat

Vertical label + value for statistics. Extracted from Systemic.

```html
<div class="stat">
  <span class="stat__value">42</span>
  <span class="stat__label">Events</span>
</div>
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

### AI Widget System (`widgets.css`)

Grid-based widget framework for AI-powered recommendations. Uses `w-*` prefix classes.

```html
<div class="w-shell w-shell--med" data-widget-id="widget-123">
  <div class="w-header">
    <div class="w-header__left">
      <span class="w-text w-text--label">Style Summary</span>
      <span class="w-badge">AI</span>
    </div>
    <div class="w-header__controls">
      <button class="w-icon-btn" onclick="refreshWidget('widget-123')">&#x27F3;</button>
    </div>
  </div>
  <div class="w-body w-body--verdict">
    <div class="w-headline">
      <span class="w-text w-text--display">Minimal Modern</span>
      <span class="w-text w-text--meta">Based on 12 items</span>
    </div>
    <div class="w-tag-group">
      <span class="w-badge">Clean lines</span>
      <span class="w-badge">Neutral palette</span>
    </div>
  </div>
</div>
```

**Structure:** `w-shell > w-header + w-body + w-footer`

**Body templates (11):**

| Template | Body Modifier | Boards Name | Description |
|----------|--------------|-------------|-------------|
| verdict | `w-body--verdict` | hero-card | Hero headline with verdict tags |
| list | `w-body--list` | list | Vertical stack of rows |
| spectrum | `w-body--spectrum` | spectrum | Dimensional positioning on axes |
| split | `w-body--split` | grid-split | Two-column layout with divider |
| narrative | `w-body--narrative` | text-block | Long-form prose text |
| suggestion | `w-body--suggestion` | quick-add | Single item recommendation with CTA |
| stats | `w-body--stats` | stat-row | Row of key metrics |
| comparison | `w-body--comparison` | comparison | Two options side by side (A vs B) |
| choices | `w-body--choices` | choices | Selectable option cards |
| checklist | `w-body--checklist` | checklist | Interactive checklist with running total |
| grouped | `w-body--grouped` | grouped | Labeled sections with grouped content |

**Atoms:** `w-text`, `w-badge`, `w-btn`, `w-img`, `w-icon`, `w-icon-btn`, `w-bar`, `w-checkbox`

**Molecules:** `w-headline`, `w-tag-group`, `w-row`, `w-stat`, `w-axis`, `w-items`, `w-item`, `w-divider`, `w-option`, `w-section`, `w-action-bar`

**Grid sizes:** `w-shell--sm` (1x1), `w-shell--med` (2x1), `w-shell--lg` (2x2), `w-shell--wide` (3x1), `w-shell--full` (4x4), and more

**Feature flag:** Widgets hidden by default. Enable via `window.enableWidgetDS()` in console. Toggle in dev menu (Ctrl+Shift+D).

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

## Source of Truth

The CSS files are the single source of truth. Everything else is derived or supplementary.

```
┌─ SOURCE OF TRUTH (hand-edited) ────────────────────────┐
│  tokens.css        Design tokens                       │
│  components.css    UI components                       │
│  widgets.css       Widget grid system + atoms/molecules│
└────────────────────────────────────────────────────────┘
        │
        ▼  node scripts/parse-design-system.js
┌─ DERIVED ──────────────────────────────────────────────┐
│  manifest.json     Auto-generated index of all tokens, │
│                    components, and widget classes       │
└────────────────────────────────────────────────────────┘

┌─ REFERENCE (hand-edited) ─────────────────────────────┐
│  template-registry.json   Widget template definitions, │
│                           Boards mappings, fixtures     │
│  widgets.html             Interactive showcase / QA     │
└────────────────────────────────────────────────────────┘
```

**Rules:**
- Change styles → edit the CSS files
- Regenerate manifest → `node scripts/parse-design-system.js`
- Systemic does **not** read the local design system (it crawls external sites)
- `manifest.json` is read-only; never hand-edit it

## File Structure

```
/design-system/
  tokens.css              # Design tokens (colors, typography, spacing)
  components.css          # Reusable UI components
  widgets.css             # Widget system: grid, atoms, molecules, body templates
  manifest.json           # Generated — token + component index for tooling
  template-registry.json  # Widget template definitions + Boards mappings
  widgets.html            # Interactive showcase with 44 widget instances
  index.html              # Component browser
  README.md               # This file
```
