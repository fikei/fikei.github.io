# Widget Design Components

> Reusable, nestable design system components for the AI widget system.
> Every widget is composed from this component library. No custom HTML.
> **Source**: [PRD: AI Widgets](/docs/strategy/prds/ai-widgets.md)
> **Last Updated**: 2026-02-06

---

## Component Hierarchy

```
w-shell ─────────────────────────── Every widget (constant wrapper)
├── w-header ────────────────────── Fixed structure, never varies
│   ├── w-text--label                Widget name
│   ├── w-badge                      "AI" pill
│   └── w-controls
│       ├── w-icon-btn (refresh)     ⟳
│       └── w-icon-btn (dismiss)     ✕
│
├── w-body ──────────────────────── Layout set by modifier class
│   └── (body content — one of 11 layouts)
│
└── w-footer ────────────────────── Always present
    └── w-action-bar
        └── w-btn × N               Primary + secondary actions
```

---

## Atoms (6 components)

Smallest visual units. Cannot be broken down further.

### `w-text`

All text within widgets. Variant modifier determines appearance.

| Variant | Font | Size | Transform | Color | Usage |
|---------|------|------|-----------|-------|-------|
| `--display` | serif | 24px (`--text-3xl`) | none | fg | Large verdict labels |
| `--title` | primary | 12px (`--text-lg`) | uppercase | fg | Item names, headings |
| `--meta` | primary | 10px (`--text-xs`) | none | fg-muted | Supporting info |
| `--value` | primary | 18px (`--text-2xl`) | none | fg | Large numbers |
| `--label` | primary | 10px (`--text-xs`) | uppercase | fg-muted | Axis labels, section headers |
| `--note` | primary | 10px (`--text-xs`) | none, italic | fg-muted | Explanatory footnotes |
| `--prose` | primary | 12px (`--text-lg`) | none | fg | Narrative paragraphs |

```html
<span class="w-text w-text--display">Minimal Modern</span>
<span class="w-text w-text--title">Nike Dunk Low</span>
<span class="w-text w-text--meta">Based on 12 items</span>
<span class="w-text w-text--value">47</span>
<span class="w-text w-text--label">Backlog</span>
<span class="w-text w-text--note">You're 60% toward heavy content</span>
<p class="w-text w-text--prose">Your saved articles cluster around...</p>
```

**Used by**: All 40 widgets

---

### `w-badge`

Small tag/pill. Extends the existing `.token` component from the design system.

| Variant | Background | Border | Usage |
|---------|------------|--------|-------|
| (default) | transparent | border-subtle | Trait tags, genre labels |
| `--filled` | fg | none | Active/selected states |
| `--accent` | highlight | none | Emphasis, warnings |

```html
<span class="w-badge">Clean lines</span>
<span class="w-badge w-badge--filled">67%</span>
<span class="w-badge w-badge--accent">Conflict</span>
```

**Used by**: 10 widgets (verdict + narrative inline)

---

### `w-bar`

Horizontal fill bar. Width controlled by CSS custom property `--fill`.

```html
<div class="w-bar" style="--fill: 67%">
  <div class="w-bar__fill"></div>
</div>
```

**CSS**:
```css
.w-bar {
  height: 4px;
  background: var(--border-subtle);
  overflow: hidden;
}
.w-bar__fill {
  height: 100%;
  background: var(--fg);
  width: var(--fill, 0%);
  transition: width var(--duration-slow) var(--ease-default);
}
```

**Used by**: 12 widgets (spectrum axes, stat bars, proportion fills)

---

### `w-icon-btn`

Icon-only button. Small, square, no text.

| Variant | Icon | Usage |
|---------|------|-------|
| `--refresh` | ⟳ | Regenerate widget |
| `--dismiss` | ✕ | Hide widget |
| `--check` | ✓ | Confirm action |
| `--expand` | → | Open link |

```html
<button class="w-icon-btn w-icon-btn--refresh" title="Refresh">⟳</button>
<button class="w-icon-btn w-icon-btn--dismiss" title="Dismiss">✕</button>
```

**CSS**:
```css
.w-icon-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--fg-muted);
  font-size: 16px;
  cursor: pointer;
  transition: color var(--duration-normal) var(--ease-default);
}
.w-icon-btn:hover { color: var(--fg); }
```

**Used by**: All 40 widgets (header controls)

---

### `w-divider`

Separator line. Horizontal by default, with vertical and labeled variants.

| Variant | Direction | Usage |
|---------|-----------|-------|
| (default) | horizontal | Between sections |
| `--vertical` | vertical | Between columns in split/comparison |
| `--labeled` | horizontal with text | "vs" divider in comparison |

```html
<div class="w-divider"></div>
<div class="w-divider w-divider--vertical"></div>
<div class="w-divider w-divider--labeled">vs</div>
```

**CSS**:
```css
.w-divider {
  border-top: var(--border-thin) solid var(--border-subtle);
  margin: var(--space-2) 0;
}
.w-divider--vertical {
  border-top: none;
  border-left: var(--border-thin) solid var(--border-subtle);
  margin: 0 var(--space-3);
  align-self: stretch;
}
.w-divider--labeled {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--fg-muted);
  font-size: var(--text-xs);
  text-transform: uppercase;
}
.w-divider--labeled::before,
.w-divider--labeled::after {
  content: '';
  flex: 1;
  border-top: var(--border-thin) solid var(--border-subtle);
}
```

**Used by**: 7 widgets (split, comparison, checklist)

---

### `w-checkbox`

Styled checkbox control for checklist layouts.

```html
<label class="w-checkbox">
  <input type="checkbox" checked>
  <span class="w-checkbox__mark"></span>
</label>
```

**CSS**:
```css
.w-checkbox {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}
.w-checkbox input { display: none; }
.w-checkbox__mark {
  width: 16px;
  height: 16px;
  border: var(--border-thin) solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.w-checkbox input:checked + .w-checkbox__mark::after {
  content: '✓';
  color: var(--fg);
  font-size: 12px;
}
```

**Used by**: 2 widgets (#10 Assemble, #21 Negotiate)

---

## Molecules (7 components)

Atoms composed into recognizable patterns.

### `w-headline`

Title + optional subtitle. Used in verdict body layouts.

```html
<div class="w-headline">
  <span class="w-text w-text--display">Split Personality</span>
  <span class="w-text w-text--meta">Home vs. Wardrobe aesthetic</span>
</div>
```

**CSS**:
```css
.w-headline {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) 0;
}
```

**Used by**: 8 verdict widgets

---

### `w-tag-group`

Row of badges. Wraps on overflow.

```html
<div class="w-tag-group">
  <span class="w-badge">Monochrome</span>
  <span class="w-badge">Texture</span>
  <span class="w-badge">Clean lines</span>
</div>
```

**CSS**:
```css
.w-tag-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  justify-content: center;
}
```

**Used by**: 8 verdict widgets + inline in narrative

---

### `w-stat`

Large value + label + optional bar. The numeric building block.

```html
<div class="w-stat">
  <span class="w-text w-text--value">47</span>
  <span class="w-text w-text--label">Backlog</span>
  <div class="w-bar" style="--fill: 80%"><div class="w-bar__fill"></div></div>
</div>
```

**CSS**:
```css
.w-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  min-width: 60px;
}
```

**Used by**: 6 stat widgets + 2 checklist totals (10 total)

---

### `w-row`

A single item in a list. The most reused molecule.

**Structure**: indicator (optional) + content (title + meta) + action (optional)

```html
<div class="w-row">
  <span class="w-row__indicator">🔴</span>
  <div class="w-row__content">
    <span class="w-text w-text--title">White Lotus S3</span>
    <span class="w-text w-text--meta">3 days away</span>
  </div>
  <button class="w-icon-btn w-icon-btn--expand">→</button>
</div>
```

**CSS**:
```css
.w-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}
.w-row__indicator {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-size: var(--text-sm);
}
.w-row__content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
```

**Used by**: 24 widgets (60%) — list, split, checklist, suggestion, grouped

---

### `w-axis`

A labeled horizontal bar for spectrum visualizations.

```html
<div class="w-axis">
  <span class="w-text w-text--label">Light</span>
  <div class="w-bar" style="--fill: 60%"><div class="w-bar__fill"></div></div>
  <span class="w-text w-text--label">Heavy</span>
</div>
<span class="w-text w-text--note">You're 60% toward heavy content</span>
```

**CSS**:
```css
.w-axis {
  display: grid;
  grid-template-columns: 50px 1fr 50px;
  gap: var(--space-2);
  align-items: center;
}
```

**Used by**: 6 spectrum widgets

---

### `w-option`

A selectable card for choice/comparison layouts.

```html
<div class="w-option">
  <span class="w-text w-text--title">Floral skirt + Hiking boots</span>
  <span class="w-text w-text--meta">"Rugged Feminine"</span>
  <button class="w-btn w-btn--sm">I'd wear this</button>
</div>
```

**CSS**:
```css
.w-option {
  border: var(--border-thin) solid var(--border-subtle);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  transition: border-color var(--duration-normal) var(--ease-default);
}
.w-option:hover {
  border-color: var(--border);
}
```

**Used by**: 4 widgets (pick-one + swap)

---

### `w-section`

A labeled group of rows. Section header + child rows.

```html
<div class="w-section">
  <span class="w-text w-text--label">☀️ Morning</span>
  <div class="w-row">...</div>
  <div class="w-row">...</div>
</div>
```

**CSS**:
```css
.w-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
```

**Used by**: 1 bundle widget; reusable for any grouped list

---

## Body Layouts (11 modifiers)

Each is a CSS modifier on `w-body` that determines how molecules are arranged.

### Layout Summary

| Layout | Modifier | Inner Components | Widget Count |
|--------|----------|-----------------|-------------|
| Verdict | `w-body--verdict` | `w-headline` + `w-tag-group` | 8 |
| List | `w-body--list` | `w-row × N` | 8 |
| Stats | `w-body--stats` | `w-stat × N` | 6 |
| Spectrum | `w-body--spectrum` | `w-axis × N` | 6 |
| Split | `w-body--split` | `w-column × 2` with `w-row × N` each | 3 |
| Narrative | `w-body--narrative` | `w-text--prose` | 3 |
| Comparison | `w-body--comparison` | `w-option × 2` + `w-divider--labeled` | 2 |
| Choices | `w-body--choices` | `w-option × N` | 2 |
| Checklist | `w-body--checklist` | `w-row × N` with `w-checkbox` + `w-stat` | 2 |
| Suggestion | `w-body--suggestion` | `w-row` (featured) + `w-btn` | 1 |
| Grouped | `w-body--grouped` | `w-section × N` with `w-row × N` | 1 |

### Layout CSS

```css
/* Shell */
.w-shell { }
.w-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
}
.w-body {
  border: var(--border-thin) solid var(--border-subtle);
  background: var(--bg-surface);
  padding: var(--space-4);
}
.w-footer {
  padding: var(--space-2) 0;
}
.w-action-bar {
  display: flex;
  gap: var(--space-2);
}

/* Body layout modifiers */
.w-body--verdict {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-4);
}

.w-body--list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.w-body--stats {
  display: flex;
  justify-content: space-around;
  text-align: center;
  padding: var(--space-6) var(--space-4);
}

.w-body--spectrum {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.w-body--split {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 0;
  padding: 0;
}
.w-body--split > .w-column {
  padding: var(--space-4);
}

.w-body--narrative {
  padding: var(--space-4);
}

.w-body--comparison {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: start;
  gap: 0;
  padding: 0;
}
.w-body--comparison > .w-option {
  border: none;
  border-radius: 0;
}

.w-body--choices {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.w-body--checklist {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.w-body--suggestion {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.w-body--grouped {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
```

---

## Reuse Frequency

Components ranked by how many of the 40 widgets use them:

| Component | Widgets | % of 40 | Layer |
|-----------|---------|---------|-------|
| `w-shell` | 40 | 100% | Shell |
| `w-header` | 40 | 100% | Structure |
| `w-footer` / `w-action-bar` | 40 | 100% | Structure |
| `w-text` | 40 | 100% | Atom |
| `w-btn` | 40 | 100% | Atom (from design system) |
| `w-icon-btn` | 40 | 100% | Atom |
| `w-row` | 24 | 60% | Molecule |
| `w-bar` | 12 | 30% | Atom |
| `w-badge` | 10 | 25% | Atom |
| `w-stat` | 10 | 25% | Molecule |
| `w-headline` | 8 | 20% | Molecule |
| `w-tag-group` | 8 | 20% | Molecule |
| `w-divider` | 7 | 18% | Atom |
| `w-axis` | 6 | 15% | Molecule |
| `w-option` | 4 | 10% | Molecule |
| `w-checkbox` | 2 | 5% | Atom |
| `w-section` | 1 | 3% | Molecule |

---

## Migration from Existing System

| Old Component | New Component | Notes |
|--------------|---------------|-------|
| `.widget-complete` | `.w-shell` | Same wrapper role |
| `.widget-complete__header` | `.w-header` | Same structure |
| `.widget-complete__header-left` | (removed) | Flex handles alignment |
| `.widget-complete__title` | `w-text--label` | Generic atom |
| `.widget-complete__badge` | `.w-badge` | Generic atom |
| `.widget-complete__refresh-btn` | `.w-icon-btn--refresh` | Generic atom |
| `.widget-complete__body` | `.w-body` + layout modifier | Body always needs a layout |
| `.widget-complete__body--grid-split` | `.w-body--split` | Named for content, not CSS |
| `.widget-style__label` | `.w-text--display` | Generic atom |
| `.widget-style__sublabel` | `.w-text--meta` | Generic atom |
| `.widget-style__trait` | `.w-badge` | Generic atom |
| `.widget-style__traits` | `.w-tag-group` | Generic molecule |
| `.widget-spectrum__*` | `.w-axis` + `.w-bar` | Decomposed into atoms |
| `.widget-statrow__*` | `.w-stat` + `.w-bar` | Decomposed into atoms |
| `.widget-quickadd__*` | `.w-row` + `.w-btn` | Decomposed into molecules |

---

## Full Component Count

| Layer | Count | Components |
|-------|-------|------------|
| Shell | 1 | `w-shell` |
| Structure | 3 | `w-header`, `w-body`, `w-footer` |
| Atoms | 6 | `w-text`, `w-badge`, `w-bar`, `w-icon-btn`, `w-divider`, `w-checkbox` |
| Molecules | 7 | `w-headline`, `w-tag-group`, `w-stat`, `w-row`, `w-axis`, `w-option`, `w-section` |
| Layouts | 11 | verdict, list, stats, spectrum, split, narrative, comparison, choices, checklist, suggestion, grouped |
| **Total** | **28** | 17 unique components + 11 layout modifiers |
