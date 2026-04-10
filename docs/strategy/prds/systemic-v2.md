# PRD: Systemic v2

**Status:** Draft
**Date:** 2026-04-10
**Version:** 1.0
**Dependencies:** [Design System Validation Pipeline PRD](design-system-validation-pipeline.md)

---

## 1. Problem Statement

Systemic currently has one input mode: crawl a live URL. This works for deployed products but creates three gaps that limit its utility as a design system analysis tool.

**Design sources are disconnected.** Figma files and Paper canvases contain the authoritative component definitions — the live URL is downstream. Systemic reads the output of design, not design itself. When design and production diverge, Systemic can only see the production state.

**Component instances are invisible.** The crawler identifies component types and variants, but cannot tell you where any instance lives in code. "Button — disabled state found, 4 uses" is not actionable. "Button — disabled, line 1420 of boards/index.html" is. Without file + line attribution, developers cannot act on audit findings.

**Multi-state rendering is absent.** Every component shows a single static example. Buttons only appear in their default state. Inputs only appear empty. This means hover states, error states, disabled states, and loading states are invisible until a developer manually exercises them — defeating the purpose of a component audit tool.

---

## 2. Goals

1. **Three equal input sources** — URL crawl, design file (Figma + Paper), and production code (local path or GitHub repo) are first-class entry points
2. **File + line attribution** — every component instance identified from a code source links back to its exact location in source
3. **Multi-state rendering** — every component variant shows all its states simultaneously, with realistic contextually appropriate content
4. **Component Usage Inspector** — a drill-down view showing all instances of a given component type across the full source, with previews and source context
5. **No new external runtime dependencies** — Figma integration uses the public REST API; code source uses static parsing; no headless browser required

---

## 3. Non-Goals

1. Rendering SPAs or JavaScript-heavy apps from the code source (static parsing only; use the URL crawl for SPAs)
2. Two-way sync back to Figma (read-only for this version)
3. Editing or fixing design system issues from within Systemic
4. Visual regression testing (covered by the Design System Validation Pipeline PRD)

---

## 4. Architecture

### Input Source Normalization

All three input sources produce the same normalized data shape before any downstream processing. This means the viewer, audit, and Component Usage Inspector all work identically regardless of input source.

```
Input Source                 Normalized Output
─────────────────────────────────────────────────────────
URL Crawl (existing)     →   ComponentRecord[]
Figma File               →   ComponentRecord[]
Paper Canvas             →   ComponentRecord[]
Local Code Path          →   ComponentRecord[] (+ location)
GitHub Repo URL          →   ComponentRecord[] (+ location)
```

**Extended `ComponentRecord` shape (v2):**

```javascript
{
  type: string,                  // "button", "card", "input", ...
  variants: [
    {
      name: string,
      html: string,
      classes: string[],
      styles: object,
      states: string[],          // ["hover", "focus", "disabled", "error"]
      usageCount: number,
      instances: [               // NEW — only populated for code/design sources
        {
          location: {
            type: "file" | "url" | "figma-frame",
            path: string,        // file path, page URL, or Figma frame name
            line: number | null, // line number for file source; null otherwise
          },
          html: string,          // the actual instance markup
          context: {
            parent: string,      // parent element HTML (outer only)
            siblings: string[],  // adjacent sibling elements
          },
          thumbnailDataUrl: string | null,
        }
      ]
    }
  ],
  totalUsage: number,
  states: string[],
}
```

### Input Source Selection Screen

The audit start screen replaces the current single URL input with three distinct entry points presented as equal-weight cards. Each card has an icon, a title, a one-line description, and its own input controls.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Systemic — Audit a Design System                                   │
├──────────────────┬──────────────────┬───────────────────────────────┤
│  Live Page       │  Design File     │  Production Code              │
│                  │                  │                               │
│  [Globe icon]    │  [Figma icon]    │  [Code icon]                  │
│                  │                  │                               │
│  Crawl a live    │  Read directly   │  Parse a local path           │
│  URL as it       │  from Figma or   │  or GitHub repo without       │
│  renders today   │  Paper canvas    │  rendering                    │
│                  │                  │                               │
│  [ URL input ]   │  [ Figma URL ]   │  [ Path / Repo URL ]         │
│                  │  [ API token ]   │  [ optional: GitHub token ]   │
│  [ Start ]       │  [ Start ]       │  [ Start ]                    │
└──────────────────┴──────────────────┴───────────────────────────────┘
```

---

## 5. Track 1 — Three Input Sources

### 1A. Figma Input

**Authentication:** The user provides a Figma personal access token (PAT) in the input screen. The token is stored in localStorage for the session. No OAuth flow in v1 — PAT is sufficient for personal use.

**API calls:**
- `GET /v1/files/{file_key}` — fetches the full document tree: frames, components, styles
- `GET /v1/files/{file_key}/styles` — all published styles (design tokens: color, text, effect, grid)
- `GET /v1/files/{file_key}/components` — all published components and variants

**What gets extracted:**
| Figma Concept | Maps To |
|---------------|---------|
| Published component | `ComponentRecord.type` |
| Component variant (name property) | `ComponentRecord.variants[].name` |
| Component property values | `ComponentRecord.variants[].styles` |
| Published color/text style | Design token |
| Auto-layout properties | Spacing tokens |
| Frame name (where component lives) | `instance.location.path` |

**Normalization:** The Figma document tree is a nested JSON structure. A new `FigmaParser` module walks the tree depth-first, identifies component instances (nodes with `type === "INSTANCE"`), looks up the master component, and creates `ComponentRecord` entries. Frame names are used as location context.

**Limitations (v1):**
- Read-only
- Published components only (not local components)
- No rendering — tokens and component structure are extracted, not visual screenshots

### 1B. Paper Input

**Integration:** Paper exposes the current canvas via the Paper MCP context. When running in a Paper-connected session, Systemic calls `get_nodes` (or equivalent MCP read tool) to pull the active file structure. No export required.

**What gets extracted:** Same as Figma — component definitions, design tokens, frame names as location context.

**Normalization:** Paper canvas data is processed through the same `FigmaParser` normalization layer. The output is identical `ComponentRecord[]` regardless of whether source was Figma or Paper.

### 1C. Production Code Input

**Two sub-modes:**

**Local path:** The user provides a file system path (e.g., `/Users/ian/projects/myapp`). A new Supabase edge function `systemic-crawl` accepts the path and reads files from the local filesystem via a lightweight local bridge server (a small Deno script the user runs locally, similar to a language server). The bridge listens on `localhost:4242`, accepts file read requests, and returns file contents. The edge function proxies through the bridge.

**GitHub repo:** The user provides a GitHub repo URL (`https://github.com/owner/repo`). Systemic calls the GitHub Contents API (`GET /repos/{owner}/{repo}/contents/{path}`) recursively to enumerate and fetch all HTML, CSS, and JS files. Private repos require a GitHub PAT stored in localStorage.

**Static parsing — what gets extracted:**
- HTML files: all elements with class attributes; inline styles; data attributes
- CSS files: all selectors, properties, custom property declarations, `:hover`/`:focus`/`:disabled` pseudo-class rules
- JS files: string literals that look like class names and template literals that produce HTML

**File + line attribution:** Every component instance extracted from a code source records the file path and line number of the opening tag in source HTML. This is the key advantage of the code source over URL crawl — the crawler sees rendered output, code parsing sees the source.

**Parsing strategy:** Static — no JavaScript execution. DOM-like parsing via `linkedom` (already a known-good library for this stack). Not suitable for SPAs where components are rendered dynamically; the URL crawl covers those cases.

---

## 6. Track 2 — Lifelike Component State Rendering

### Current State

Each component variant shows a single static example pulled from the crawled HTML. The example is whatever state the crawler happened to capture at crawl time.

### Target State

Every component variant shows all its states simultaneously in a side-by-side row, with visually labeled state badges and realistic contextually appropriate placeholder content.

### State Extraction

The crawler already extracts CSS state rules. Track 2 uses those rules to generate one rendered example per discovered state. For each CSS state rule (`button:hover { ... }`), Systemic generates a second example with the state styles applied inline — simulating the state without requiring user interaction.

**State sets per component type:**

| Component Type | States Rendered |
|---------------|-----------------|
| Button | default, hover, active, disabled, loading |
| Input / Textarea | empty, filled, focused, error, disabled |
| Dropdown / Select | closed, open (with 4–5 list items), item-hovered, selected |
| Card | default, hovered, selected |
| Navigation item | default, active, hovered |
| Checkbox / Radio | unchecked, checked, indeterminate, disabled |
| Badge / Chip | default, all color variants |
| Toggle | off, on, disabled |

### Placeholder Content Strategy

Generic lorem ipsum is replaced with contextually appropriate content based on component type. A small lookup table maps component type to content templates:

| Component Type | Placeholder Strategy |
|---------------|---------------------|
| Button | Verb-noun labels: "Save Changes", "Cancel", "Submit", "Loading..." |
| Input | Field-appropriate labels: "Email address", "Full name", "Search", "Password" |
| Navigation | Navigation-appropriate labels: "Dashboard", "Settings", "Profile", "Library" |
| Card | Realistic title + 2-sentence body + "Read more" action |
| Dropdown | 4–5 domain-appropriate options pulled from component name/context |
| Form | Complete form-appropriate field sets |

### Visual State Labels

Each rendered state example has a small badge in the top-right corner showing the state name: "default", "hover", "error", etc. This makes it immediately clear which state each example represents without requiring user interaction.

### Implementation Notes

- State rendering happens client-side — no new edge function required
- The CSS state rules already stored in `variants[].states` are used to build a `<style>` block that applies the state styles to a static copy of the example HTML
- This track replaces and absorbs the current "Examples" section — the component docs view becomes the examples view
- Each multi-state row is contained in a horizontally scrollable strip on mobile

---

## 7. Track 3 — Component Usage Inspector

### Purpose

The Component Usage Inspector answers: "Where exactly is every instance of this component type used in my codebase, and what does each one look like?" It makes audit findings actionable by connecting abstract component analysis to concrete source locations.

### Flow

1. User selects a component type from a dropdown in the audit/QA view header (e.g., "Button", "Card", "Input")
2. The view shows all instances of that component type across the full source in a scrollable grid
3. Each instance card shows:
   - Location context (file path + line for code source; page URL for crawl; Figma frame name for design)
   - Small rendered preview thumbnail (~240×160)
   - Variant classification badge (which variant Systemic identified it as)
   - Confidence indicator
4. Clicking an instance opens a right-side drawer

### Instance Detail Drawer

The drawer slides in from the right, covering ~40% of the viewport width. It contains four sections:

**Rendered preview** — the component instance rendered in a sandboxed `<div>` with design system CSS applied. Shows the live component isolated from its surrounding context.

**Source code block** — syntax-highlighted HTML showing the exact markup of the instance. For file sources, includes the file path and line number as a header above the code block. For URL sources, includes the page URL. For Figma, includes the frame name and component path.

**Surrounding context** — a second code block showing the parent element and adjacent siblings, giving the developer enough context to locate the instance in a file browser or IDE.

**Variant classification** — which variant Systemic identified this instance as (e.g., "Button / Primary / Large"), and the confidence score (0–100) with a brief explanation of what signals drove the classification.

### Drawer States

| State | Behavior |
|-------|----------|
| Default (no instance selected) | Drawer is hidden; full grid is visible |
| Instance selected | Drawer slides in from right; grid shifts left to accommodate |
| Drawer dismissed (X or Escape) | Grid returns to full width |
| Navigating instances | Previous/Next arrows inside drawer cycle through instances without closing |

### Filter Controls

Above the instance grid: a search input (filter by location path) and a variant filter (show only instances of a specific variant). Counts update live as filters change.

### Technical Requirements

- Instance data is populated only when source is code (local path or GitHub) or Figma — URL crawl provides location as page URL, no line number
- Thumbnail generation: rendered client-side by mounting instance HTML in an offscreen `<div>` and calling `html2canvas` or equivalent; lazy-generated on scroll
- Drawer content is rendered in a sandboxed `<div>` with `pointer-events: none` to prevent interaction with the preview
- All instance data is stored in localStorage alongside the component data from the current audit session

---

## 8. Technical Context

| Item | Detail |
|------|--------|
| App directory | `systemic/` |
| Stack | Vanilla JS (no frameworks), HTML, CSS |
| Supabase project | `atdqdfpdeytfuvvpsasz` |
| Existing component shape | `{ type, variants: [{name, html, classes, styles, states, usageCount}], totalUsage, states }` |
| State rules | Already extracted by crawler, stored in `variants[].states` |
| Storage | localStorage |
| New edge function (if needed) | `systemic-crawl` on Supabase Ops project (`ycilriwjnmcelkspmfmg`) |

### New Modules

| Module | Purpose |
|--------|---------|
| `systemic/js/figma-parser.js` | Figma API client + document tree walker + normalization |
| `systemic/js/code-parser.js` | Static HTML/CSS/JS parser + file + line attribution |
| `systemic/js/state-renderer.js` | Multi-state example generation from CSS state rules |
| `systemic/js/usage-inspector.js` | Component Usage Inspector — grid + drawer |
| `supabase/functions/systemic-crawl/index.ts` | Edge function for local path bridge (optional) |

### No New External Runtime Dependencies

| Concern | Approach |
|---------|---------|
| Figma API | Direct fetch from browser (CORS allowed by Figma) |
| GitHub Contents API | Direct fetch from browser (public repos; PAT for private) |
| Static HTML parsing | `linkedom` (already used in design system validation pipeline) |
| Thumbnail rendering | `html2canvas` (new, client-side only) |
| Local file bridge | Small Deno server script (user runs locally, optional) |

---

## 9. Phased Delivery

### Phase 1: Input Source Selection Screen + Code Parser (1–2 sessions)
- Replace current URL-only start screen with three-source entry screen
- Implement code source parser (GitHub repo sub-mode first — no local bridge needed)
- Extend `ComponentRecord` shape with `instances[]`
- File + line attribution in component data

### Phase 2: Figma + Paper Integration (1 session)
- Build `figma-parser.js`
- Figma PAT flow in input screen
- Paper MCP canvas read path
- Same normalized output as code parser

### Phase 3: Multi-State Rendering (1 session)
- Build `state-renderer.js`
- State extraction from CSS state rules
- Contextual placeholder content lookup table
- State badges on example cards
- Replaces current "Examples" section

### Phase 4: Component Usage Inspector (1–2 sessions)
- Build `usage-inspector.js`
- Instance grid view
- Right-side drawer with rendered preview, source code block, surrounding context, variant classification
- Filter controls (location search, variant filter)
- Drawer navigation (prev/next instance)

### Phase 5: Local Path Bridge (optional, 1 session)
- Deno local bridge server script
- `systemic-crawl` edge function
- Local path sub-mode in input screen

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Input sources supported | 3 (URL, Figma/Paper, code) |
| States rendered per component | All CSS-defined states (min 3 per interactive component) |
| File + line attribution accuracy | 100% for static HTML (no dynamic rendering) |
| Instance inspector load time | < 2 seconds for up to 500 instances |
| Placeholder content relevance | Contextually appropriate for all 8 component types |
| Figma API coverage | Components, variants, published styles (tokens) |

---

## 11. Related Documents

- [Design System Validation Pipeline PRD](design-system-validation-pipeline.md)
- [Systemic README](../../systemic/README.md)
- [AI Widget System](../../docs/infrastructure/technical-design/ai-widget-system.md)
