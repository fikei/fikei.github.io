# Sassy — the ctrl.rodeo design system

> Sassy is the name of the whole thing: the global CTRL layer and every product system under it. Home: **https://ctrl.rodeo/design-system/**

| System | Scope | Where |
|---|---|---|
| Hub | Sassy's landing page, indexes every layer | `index.html` |
| CTRL | Global — Boards, Events, Soundscape, Systemic, Favicon | `ctrl.html` |
| Agape recruiting | Product — /applications (Storybook-style stories) | `recruiting/index.html` · behavior source of truth: `docs/ux/recruiting-row-states.md` |
| Widget audit | Tooling stoplight | `widgets.html` |

Product systems override the global system for their product. New products add a folder here and a card on the hub.

---

# Sassy: CTRL (global layer)

> Minimal, high-contrast design system powering ctrl.rodeo products.

**Status**: 🟢 Active
**Last Updated**: 2026-02-09

---

## Product Overview

Sassy's CTRL layer provides a unified visual language across all ctrl.rodeo applications. It emphasizes clarity, speed, and a distinctive code-like aesthetic.

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
- **Transparency, never strike-through** — Removed, deferred, archived, and disabled things are expressed by reducing opacity. `text-decoration: line-through` is not used anywhere in this system. See [Removed & deferred states](#removed--deferred-states).

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
| `--color-spotify` | `#1DB954` | Spotify platform accent |
| `--color-soundcloud` | `#FF5500` | SoundCloud platform accent |
| `--color-apple-music` | `#FC3C44` | Apple Music platform accent |
| `--color-bandcamp` | `#1DA0C3` | Bandcamp platform accent |
| `--color-tidal` | `#00FFFF` | Tidal platform accent |
| `--color-youtube-music` | `#FF0000` | YouTube Music platform accent |

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

### Music Card (Listen Category)

Grid item variant for music/audio links. Album art shows in full color (no grayscale), with two-line artist/track text, a format+duration badge, and a platform icon dot.

```html
<!-- Collapsed (1x1) music card -->
<article class="grid-item grid-item--listen" data-id="...">
  <img class="grid-item__image" src="album-art.jpg" alt="" loading="lazy">
  <div class="grid-item__overlay">
    <span class="grid-item__artist">Artist Name</span>
    <span class="grid-item__track">Track Title</span>
  </div>
  <span class="grid-item__category">Listen</span>
  <div class="grid-item__format-badge">
    <span class="grid-item__platform-icon grid-item__platform-icon--spotify"></span>
    Track · 3:24
  </div>
</article>
```

**Music card behavior:**
- `.grid-item--listen` removes grayscale filter from album art (always full color)
- `.grid-item__artist` — bold uppercase artist name, single line with ellipsis
- `.grid-item__track` — muted track title, single line with ellipsis
- `.grid-item__format-badge` — bottom-left badge showing format (Track, Album, etc.) and duration
- `.grid-item__platform-icon` — 8px colored dot indicating music platform
- Platform icon modifiers: `--spotify`, `--soundcloud`, `--apple-music`, `--bandcamp`, `--tidal`, `--youtube-music`

### Listen Grid Override

Tighter grid layout used when the listen category is active.

```html
<main class="grid grid--listen" id="grid">
  <!-- Music cards render here -->
</main>
```

**Listen grid behavior:**
- 8px gap (vs default 16px) for a denser album-art wall
- Applied dynamically when `currentFilter === 'listen'`

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

### Removed & deferred states

**Rule: transparency, never strike-through.** Nothing in this system uses `text-decoration: line-through`. A thing on its way out is dimmed, not defaced — strike-through reads as "wrong/invalid", while these states mean "no longer here", which is a different fact.

Two opacity values, both already load-bearing:

| Value | Meaning | Existing users |
|---|---|---|
| `0.45` | **In motion, not settled** — mid-drag, mid-exit, pending a write | `.inbox-row.is-dragging`, `.inbox-row.is-exiting` |
| `0.5` | **Settled but inactive** — closed, filled, archived, disabled | `.listing-row.is-done`, disabled buttons (`0.35`) |

Do not introduce a third value for "faded" without a reason the table can't cover.

**Dim the subject, not the controls.** When a row is mid-exit it still carries an outcome chip and an Undo. Those must stay at full opacity — dimming the way back hides the one control that still matters.

```html
<li class="inbox-row is-exiting">
  <span class="inbox-row__grip">⠿</span>              <!-- dimmed -->
  <button class="inbox-row__main">…name, avatar…</button>  <!-- dimmed -->
  <span class="inbox-row__actions">                    <!-- full opacity -->
    <span class="exit-chip">not a fit</span>
    <button class="cta-link exit-undo">Undo</button>
  </span>
</li>
```

```css
.inbox-row.is-exiting .inbox-row__main,
.inbox-row.is-exiting .inbox-row__grip { opacity: 0.45; }
.inbox-row.is-exiting .inbox-row__main { pointer-events: none; }
```

**Hold before committing.** A destructive action fades the row and waits (~6s) before writing. The row does **not** move during the hold — nothing reflows under the cursor. Undo is therefore a no-op rather than a compensating write, and any re-render must flush held rows so a pending write can't be silently dropped.

*Reference implementation: `applications/js/app.js` — `beginRowExit()` / `undoRowExit()` / `flushPendingExits()`.*

### Reason Sheet

A destructive or branching action with **more than two outcomes** opens a sheet, not a submenu. Each option carries a one-line consequence; menus can't show that, and hover submenus fail on touch.

```html
<div class="email-modal__card remove-sheet">
  <div class="email-modal__head">
    <h3 class="hold-sheet__title">Remove Marisa Chen</h3>
    <button class="review__close email-modal__close">✕</button>
  </div>
  <div class="remove-sheet__options">
    <button class="remove-sheet__option">
      <span class="remove-sheet__option-label">From this listing</span>
      <span class="remove-sheet__option-hint">still a candidate for other rooms</span>
    </button>
    <button class="remove-sheet__option is-selected">…</button>
    <button class="remove-sheet__option remove-sheet__option--danger">
      <span class="remove-sheet__option-label">Not a fit</span>
      <span class="remove-sheet__option-hint">our no — queues an update email</span>
    </button>
  </div>
  <!-- optional: a field an option reveals inline, never a second layer -->
  <label class="listing-form__field remove-sheet__until" hidden>…</label>
  <textarea class="notes__input remove-sheet__note" rows="2"></textarea>
  <div class="decision-sheet__actions">
    <button class="hold-sheet__cancel">Cancel</button>
    <button class="btn btn--accent btn--sm btn--danger">Not a fit</button>
  </div>
</div>
```

**Reason sheet rules:**
- Options ordered **least → most final**; at most one `--danger`
- Every option gets a hint line stating its consequence (what's written, what's sent)
- An option needing extra input expands **inline** — never a second sheet
- The submit button's label mirrors the chosen option, not a generic "Confirm"
- `btn--danger` **replaces** `btn--accent` rather than stacking on it — danger is an outline style that fills on hover, so the two together produce an accent fill with a red border
- The parent menu keeps a single entry (`Remove…`), with a `.listing-menu__rule` separating navigation from destructive items

### Sidebar CTAs (`drawer-cta`)

A sidebar or drawer footer is **three tiers deep, ordered by consequence** — not one right-aligned flex row. A ~380px drawer cannot keep four targets honest side by side; the stay editor proved it, with two red underlined links each wrapping onto two lines.

**No hairlines.** Exits are inset tiles with radius and a gap; the commit row has no `border-top`. A rule between two things that belong together is separating what should be grouped — surface, radius, and space do that job instead.

**No Save on an existing record.** Fields commit on `change`, and a quiet status line (`drawer-cta__flag`) says "Changes save as you go", flashing "Saved" when a write lands. An explicit commit survives in exactly three cases: **creating** a record (`Add stay`, `Create listing`), **confirming** a state change (`Welcome them in`), and anything **destructive**.

```html
<div class="drawer-cta">
  <!-- tier 1 + 2: only on a NEW record. An existing one autosaves. -->
  <div class="drawer-cta__row">
    <button type="button" class="drawer-cta__quiet" data-drawer-close>Cancel</button>
    <button type="submit" class="btn btn--accent drawer-cta__commit">Add stay</button>
  </div>
  <!-- …or, editing an existing record: -->
  <p class="drawer-cta__flag" data-save-flag>Changes save as you go</p>

  <!-- tier 3: the ways out — inset tiles, one per line, no rules -->
  <div class="drawer-cta__exits">
    <button type="button" class="drawer-cta__exit">
      <span class="drawer-cta__exit-label">Mark leaving</span>
      <span class="drawer-cta__exit-icon" aria-hidden="true">&rarr;</span>
      <span class="drawer-cta__exit-hint">sets a move-out date and lists the room</span>
    </button>
    <button type="button" class="drawer-cta__exit drawer-cta__exit--danger">
      <span class="drawer-cta__exit-label">Remove stay</span>
      <span class="drawer-cta__exit-icon" aria-hidden="true">&times;</span>
      <span class="drawer-cta__exit-hint">deletes it from the timeline</span>
    </button>
  </div>

  <!-- optional: a second, non-destructive forward path -->
  <button type="button" class="drawer-cta__alt">
    <span>Welcome them in</span>
    <span class="drawer-cta__exit-hint">Ends the trial and starts an open-ended residency.</span>
  </button>
</div>
```

| Class | Tier | Rule |
|---|---|---|
| `drawer-cta__commit` | 1 | The one filled primary, bottom-right. **Only on a new record, a confirmation, or a destructive act** — never a plain Save. |
| `drawer-cta__quiet` | 2 | Dismiss. No fill, no border, beside the primary. Cancel is not a decision, so it doesn't look like one. |
| `drawer-cta__flag` | 2 | Replaces the commit row when editing an existing record: "Changes save as you go", flashing "Saved". |
| `drawer-cta__exit` | 3 | The ways out. Full-width **inset tile** — filled surface, radius, 6px gap, no rules. Label + hint stacked left, glyph right. `--danger` for destructive. |
| `drawer-cta__alt` | — | Optional second forward path. **Outlined, never filled** — that's what distinguishes a forward path from a way out now that exits are filled. |

**Sidebar CTA rules:**
- Anything that **removes, ends, or re-routes** a record leaves the commit row entirely
- Exits never underline — weight and color carry them (see [Removed & deferred states](#removed--deferred-states))
- Every exit and alt carries a hint; a red label is never the only explanation of what a button does
- Tiles mean labels never truncate, so copy stays plain (`Mark leaving`, not `Mark leaving — list room`). The label and hint stack; the tile grows
- Place the icon explicitly (`grid-column: 2; grid-row: 1 / 3`) — an element spanning both rows is auto-placed *before* the label and would otherwise take column 1
- Autosave writes on `change`, never on `input`: text commits when it loses focus, dates and selects the instant they settle. Repaint only what changed (one lane, the drawer subtitle) — a whole-view render rebuilds the form and throws away the caret

*Reference implementation: `applications/css/app.css` — `.drawer-cta`. Story: [Sidebar CTAs](https://ctrl.rodeo/design-system/recruiting/#sidebar-ctas).*

### Settings (`set-*`) and the stepped drawer (`step-*`)

**Settings renders from a schema, not from markup.** `applications/js/settings-schema.js` holds `SETTING_DEFS` — one object per knob — and the view renders it. Adding a setting is appending an object; no template, no handler, no CSS. The stylesheet describes field *types*, never individual settings.

```js
followup_stale_days: {
  scope: 'house', type: 'number', section: 'funnel', default: 3,
  label: 'Follow-up goes amber after', unit: 'days', min: 1, max: 30, step: 1,
  hint: 'A thread this quiet is worth another email.',
},
```

| Property | Meaning |
|---|---|
| `scope` | Picks the store: `house` → `recruit_settings`, `profile` → `recruit_profiles`, `local` → localStorage. Callers use `setting(key)` and never learn where a value lives. |
| `type` | `bool` · `number` · `text` · `enum` — four types cover every knob in the app. |
| `default` | **Is the code default.** `setting('followup_stale_days')` returns 3 until someone changes it, so exposing a knob needs no migration and no seed row. |
| `section` | Which section it appears in, or `null` to route it through `setting()` without exposing it — a named constant instead of a magic number. |

Sections borrow the product's own nav vocabulary (`You · House · Funnel · Automations · Connections · Data`). `rows:` marks a section that renders **status objects** rather than fields — automations and connections have a last-run time and a state, not a value, and don't belong in the field renderer.

```html
<div class="set-field">                       <!-- tile: label, control, hint, no rules -->
  <span class="set-field__label">Food</span>
  <span class="set-field__control">…</span>
  <span class="set-field__hint">Groceries, split evenly.
    <span class="set-field__by">Ian changed this 3 days ago</span></span>
</div>
<div class="set-auto">…</div>   <!-- label · when it last ran · switch · hint · cadence -->
<div class="set-conn">…</div>   <!-- label · state (is-ok / is-warn / is-off) · detail -->
```

**Settings rules:**
- Same as drawer footers: **no hairlines, no Save.** Fields write on `change`; the receipt is a green ring on the field (`.set-field.is-saved`), not a word
- The only button in a section is destructive
- A locked field is **disabled, never hidden** — RLS is the wall; the disabled control is courtesy, and hiding a value implies it's secret when it isn't
- Every field's audit line (`set-field__by`) names who last changed it

**Stepped drawer.** When a surface has two honest next moves, ask before showing a form — two `step-choice` tiles, then the drawer *becomes* the chosen flow with a single `step-back`. Nothing writes until that flow's own commit.

```html
<div class="step-choices">
  <button class="step-choice">
    <span class="step-choice__label">Create a listing</span>
    <span class="step-choice__go" aria-hidden="true">&rarr;</span>
    <span class="step-choice__hint">Opens the room to candidates.</span>
  </button>
  …
</div>
<!-- after choosing -->
<button class="step-back">&larr; Create a listing</button>
```

*Reference implementation: `applications/js/app.js` — `renderSettings()`, `gapDrawerBody()`. Story: [Settings](https://ctrl.rodeo/design-system/recruiting/#settings).*

### Drop Target

Whole-container drop zone for drag-and-drop between groups. Highlighting the **container** rather than an insertion line is what makes an empty group reachable.

```html
<section class="inbox-group is-drop-target" data-group-key="listing-42">…</section>
```

```css
.inbox-group.is-drop-target { outline: 2px dashed var(--accent); outline-offset: 4px; }
```

**Drop target behavior:**
- `outline`, not `border` — no layout shift when it appears
- Applied on `dragover`, cleared on `dragleave` and `dragend` (guard `dragleave` with `!el.contains(e.relatedTarget)` so child elements don't flicker it off)
- Row-level `drop` handlers must `stopPropagation()` so the container handler doesn't also fire
- Set `dataTransfer.setData('text/plain', …)` on `dragstart` — Firefox won't start a drag without a payload

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
- Systemic can load the local design system via "Scan Local" (reads manifest + registry) or crawl external sites
- `manifest.json` is read-only; never hand-edit it

### Runtime Constraint Engine

Boards loads the design system at runtime via `boards/design-constraints.js`:

```
Page load → fetch manifest.json + template-registry.json → build indexes
         → validate widget sizes, component modifiers, template structure
         → annotate DOM with data-ds-* attributes
         → emit violation events for debugging
```

Key APIs: `DS_CONSTRAINTS.validate(el)`, `DS_CONSTRAINTS.auditDOM(root)`, `DS_CONSTRAINTS.annotate(root)`

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
