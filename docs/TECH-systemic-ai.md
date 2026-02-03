# SystemicAI Technical Project Plan

## Overview

SystemicAI is an AI-driven design system auditing and generation engine that crawls websites to reverse-engineer comprehensive Design Systems with Material Design-compliant documentation.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SystemicAI Architecture                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐  │
│  │  Agentic        │     │  Analysis        │     │  Documentation      │  │
│  │  Crawler        │────▶│  Engine          │────▶│  Generator          │  │
│  │                 │     │                  │     │                     │  │
│  │  - URL Queue    │     │  - Token Extract │     │  - Material.io      │  │
│  │  - Auth Handler │     │  - Pattern Match │     │  - Usage Guidelines │  │
│  │  - DOM Capture  │     │  - Semantic Map  │     │  - Code Snippets    │  │
│  └─────────────────┘     └──────────────────┘     └─────────────────────┘  │
│           │                       │                         │               │
│           ▼                       ▼                         ▼               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Supabase Backend                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ Audit Jobs  │  │ Design      │  │ Components  │  │ Tokens     │  │   │
│  │  │             │  │ Systems     │  │             │  │            │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│           │                       │                         │               │
│           ▼                       ▼                         ▼               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Split-Context UI                                │   │
│  │  ┌─────────────────────────┐  ┌──────────────────────────────────┐  │   │
│  │  │   Component Stage       │  │   Contextual Sidebar             │  │   │
│  │  │   (Visual Preview)      │  │   [Design] | [Code] Toggle       │  │   │
│  │  │                         │  │                                  │  │   │
│  │  │   Live component        │  │   Designer: Usage rules,         │  │   │
│  │  │   rendering with        │  │   variants, accessibility        │  │   │
│  │  │   state toggles         │  │                                  │  │   │
│  │  │                         │  │   Developer: Token names,        │  │   │
│  │  │                         │  │   CSS vars, React snippets       │  │   │
│  │  └─────────────────────────┘  └──────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Phase 1: The Crawl & Audit (MVP)

### 1.1 Agentic Crawler System

**File**: `/systemic/crawler.js`

**Core Components**:

```javascript
class AgenticCrawler {
  // URL Queue Management
  urlQueue: PriorityQueue<CrawlTarget>
  visitedUrls: Set<string>

  // Authentication
  authStrategies: Map<AuthType, AuthHandler>
  sessionManager: SessionManager

  // DOM Analysis
  domCapture: DOMCaptureEngine
  styleExtractor: StyleExtractor
}
```

**Crawl Strategy**:
1. **Breadth-First with Priority**: Prioritize unique layouts over repeated patterns
2. **Smart Depth Limiting**: Stop at 3 levels deep unless new components detected
3. **Duplicate Detection**: Hash-based comparison of captured component structures

**Authentication Handling**:
```javascript
const authStrategies = {
  'form-login': FormLoginStrategy,      // Standard username/password
  'oauth': OAuthStrategy,               // Google, GitHub, etc.
  'cookie-inject': CookieInjectStrategy, // Manual cookie provision
  'api-key': APIKeyStrategy             // Bearer token auth
}
```

**DOM Capture Flow**:
```
URL → Load Page → Wait for Hydration → Extract Computed Styles
  → Capture Component Boundaries → Screenshot → Hash Structure
```

### 1.2 Visual-to-Token Mapping Engine

**File**: `/systemic/token-mapper.js`

**Token Categories**:

| Category | Extracted From | Output Format |
|----------|---------------|---------------|
| Colors | `color`, `background-color`, `border-color` | `sys.color.{semantic}` |
| Typography | `font-family`, `font-size`, `font-weight`, `line-height` | `sys.typescale.{role}` |
| Spacing | `margin`, `padding`, `gap` | `sys.spacing.{size}` |
| Elevation | `box-shadow` | `sys.elevation.{level}` |
| Shape | `border-radius` | `sys.shape.{corner}` |

**Color Semantic Mapping Algorithm**:

```javascript
function mapColorToSemantic(hex, context) {
  // 1. Frequency Analysis - most used colors become primary/secondary
  // 2. Context Analysis - button backgrounds = action colors
  // 3. Contrast Calculation - determine surface vs on-surface
  // 4. Material Tonal Palette Matching - find closest Material tone
}
```

**Token Generation Format**:
```css
/* Generated tokens.css */
:root {
  /* Color Tokens */
  --sys-color-primary: #1a73e8;
  --sys-color-on-primary: #ffffff;
  --sys-color-primary-container: #d3e3fd;
  --sys-color-surface: #ffffff;
  --sys-color-on-surface: #1f1f1f;

  /* Typography Tokens */
  --sys-typescale-display-large: 400 57px/64px 'Roboto';
  --sys-typescale-headline-medium: 400 28px/36px 'Roboto';
  --sys-typescale-body-large: 400 16px/24px 'Roboto';

  /* Spacing Tokens */
  --sys-spacing-xs: 4px;
  --sys-spacing-sm: 8px;
  --sys-spacing-md: 16px;
  --sys-spacing-lg: 24px;
  --sys-spacing-xl: 32px;
}
```

### 1.3 Material.io Integration

**Documentation Structure** (following Material 3 guidelines):

```
/design-system-output/
├── overview.html           # System introduction
├── foundations/
│   ├── color.html         # Color system & tokens
│   ├── typography.html    # Type scale & usage
│   ├── spacing.html       # Spacing system
│   ├── elevation.html     # Shadow & depth
│   └── motion.html        # Animation tokens
├── components/
│   ├── buttons.html       # Button variants
│   ├── inputs.html        # Form controls
│   ├── cards.html         # Card patterns
│   └── [component].html   # Generated per component
└── tokens/
    ├── tokens.css         # CSS Custom Properties
    ├── tokens.json        # Design tool export
    └── tokens.scss        # Sass variables
```

## Phase 2: The Documentation Engine

### 2.1 Usage Guidelines Generator

**AI Prompt Template** (using Anthropic API):

```javascript
const usagePrompt = `
Analyze this UI component and generate Material Design-compliant documentation:

Component: ${componentName}
Visual Variants: ${variants.length} detected
Context Found: ${contextExamples}

Generate:
1. Component description (1-2 sentences)
2. "When to use" guidelines (3-5 bullet points)
3. "When not to use" guidelines (2-3 bullet points)
4. Accessibility requirements
5. Related components
`;
```

**Output Format**:
```markdown
## Button

Buttons communicate actions that users can take. They are typically placed
throughout your UI, in places like dialogs, forms, cards, and toolbars.

### When to Use
- For primary actions that advance the user's workflow
- To submit forms or confirm dialogs
- For calls-to-action that require visual prominence

### When Not to Use
- For navigation (use links instead)
- When the action is destructive (use danger variant)

### Accessibility
- Minimum touch target: 48x48dp
- Color contrast ratio: 4.5:1 minimum
- Include visible focus states
```

### 2.2 Design-to-Code Bridge (Split-Context View)

**UI Structure**:

```html
<div class="systemic-viewer">
  <!-- Left: Component Tree Navigation -->
  <aside class="component-nav">
    <ul class="component-tree">
      <li data-component="button">Button</li>
      <li data-component="input">Input</li>
      <!-- ... -->
    </ul>
  </aside>

  <!-- Center: Component Stage -->
  <main class="component-stage">
    <div class="variant-controls">
      <select class="variant-select"><!-- variants --></select>
      <div class="state-toggles">
        <button data-state="hover">Hover</button>
        <button data-state="focus">Focus</button>
        <button data-state="disabled">Disabled</button>
      </div>
    </div>
    <div class="component-preview">
      <!-- Live component render -->
    </div>
  </main>

  <!-- Right: Contextual Sidebar -->
  <aside class="context-sidebar">
    <div class="view-toggle">
      <button class="active" data-view="design">Design</button>
      <button data-view="code">Code</button>
    </div>

    <div class="design-view">
      <!-- Designer-focused content -->
    </div>

    <div class="code-view" hidden>
      <!-- Developer-focused content -->
    </div>
  </aside>
</div>
```

**Designer View Content**:
- Component description
- Usage guidelines
- Visual variants gallery
- Accessibility checklist
- Related patterns

**Developer View Content**:
- Token names with copy button
- CSS variables
- React/Vue/HTML snippets
- Props table
- Import statements

## Phase 3: Premium Intelligence (Future)

### 3.1 Incremental Smart Reruns

**Webhook Integration**:
```javascript
// GitHub/Vercel webhook handler
app.post('/webhook/deploy', async (req) => {
  const { commits } = req.body;
  const affectedPaths = extractAffectedPaths(commits);

  // Only re-audit if component directories changed
  if (affectedPaths.some(p => p.startsWith('/components'))) {
    const componentDiff = calculateComponentDiff(affectedPaths);
    await queueIncrementalAudit(componentDiff);
  }
});
```

**Diff-Checking Algorithm**:
1. Capture current component hash signatures
2. Compare with stored signatures post-deploy
3. Queue only changed components for re-analysis
4. Merge updated tokens with existing system

### 3.2 Inconsistency Detector

**Ghost Component Detection**:
```javascript
function detectGhostComponents(components) {
  const clusters = clusterBySimilarity(components, threshold: 0.9);

  return clusters
    .filter(c => c.length > 1)
    .map(cluster => ({
      canonical: cluster[0],
      ghosts: cluster.slice(1),
      deviations: calculateDeviations(cluster)
    }));
}
```

**Deviation Types**:
- Color off by small amount (likely mistake)
- Spacing inconsistent (8px vs 10px)
- Typography mismatch (missing font-weight)
- Missing states (no hover/focus)

### 3.3 Auto-Rectification

**Fix Strategies**:
```javascript
const fixStrategies = {
  'color-deviation': (ghost, canonical) => {
    return `${ghost.selector} { color: var(${canonical.token}); }`;
  },
  'spacing-deviation': (ghost, canonical) => {
    return `${ghost.selector} { padding: var(${canonical.spacingToken}); }`;
  }
};
```

## Database Schema

### Supabase Tables

```sql
-- Audit Jobs
CREATE TABLE audit_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, crawling, analyzing, complete, failed
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Design Systems (output)
CREATE TABLE design_systems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_job_id UUID REFERENCES audit_jobs(id),
  name TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extracted Tokens
CREATE TABLE design_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id UUID REFERENCES design_systems(id),
  category TEXT NOT NULL, -- color, typography, spacing, elevation, shape
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  semantic_name TEXT, -- sys.color.primary
  material_mapping TEXT, -- Material Design equivalent
  usage_count INTEGER DEFAULT 0,
  sources JSONB DEFAULT '[]', -- URLs where found
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extracted Components
CREATE TABLE design_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id UUID REFERENCES design_systems(id),
  name TEXT NOT NULL,
  category TEXT, -- button, input, card, etc.
  variants JSONB DEFAULT '[]',
  tokens_used JSONB DEFAULT '[]',
  html_template TEXT,
  css_styles TEXT,
  usage_guidelines TEXT,
  accessibility_notes TEXT,
  screenshot_url TEXT,
  source_urls JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Crawl Pages (for incremental reruns)
CREATE TABLE crawl_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_job_id UUID REFERENCES audit_jobs(id),
  url TEXT NOT NULL,
  dom_hash TEXT, -- For change detection
  components_found JSONB DEFAULT '[]',
  crawled_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ghost Components (inconsistencies)
CREATE TABLE ghost_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  design_system_id UUID REFERENCES design_systems(id),
  canonical_component_id UUID REFERENCES design_components(id),
  selector TEXT NOT NULL,
  source_url TEXT,
  deviations JSONB DEFAULT '[]', -- [{type, expected, actual}]
  fix_css TEXT,
  status TEXT DEFAULT 'detected', -- detected, reviewed, fixed, ignored
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## API Endpoints (Supabase Edge Functions)

### 1. Start Audit
```
POST /functions/v1/systemic-audit
{
  "url": "https://example.com",
  "config": {
    "maxPages": 50,
    "authType": "cookie-inject",
    "authData": { "session": "..." },
    "excludePatterns": ["/api/*", "/admin/*"]
  }
}
→ { "jobId": "uuid", "status": "pending" }
```

### 2. Get Audit Status
```
GET /functions/v1/systemic-audit/{jobId}
→ {
  "status": "analyzing",
  "progress": {
    "pagesCrawled": 23,
    "pagesTotal": 50,
    "tokensExtracted": 47,
    "componentsFound": 12
  }
}
```

### 3. Get Design System
```
GET /functions/v1/systemic-system/{systemId}
→ {
  "name": "Example.com Design System",
  "tokens": [...],
  "components": [...],
  "documentation": {...}
}
```

### 4. Analyze Component (AI)
```
POST /functions/v1/systemic-analyze
{
  "componentHtml": "<button class='btn'>...",
  "componentStyles": { ... },
  "contextUrls": ["url1", "url2"]
}
→ {
  "name": "Primary Button",
  "intent": "primary-action",
  "suggestedToken": "btn-primary",
  "usageGuidelines": "...",
  "materialMapping": "FilledButton"
}
```

## File Structure

```
/systemic/
├── index.html              # Main UI entry point
├── css/
│   ├── systemic.css       # Core styles
│   └── viewer.css         # Split-context viewer styles
├── js/
│   ├── app.js             # Main application
│   ├── crawler.js         # Agentic crawler (client-side orchestration)
│   ├── token-mapper.js    # Visual-to-token mapping
│   ├── doc-generator.js   # Documentation generator
│   ├── viewer.js          # Split-context viewer
│   └── utils/
│       ├── dom-utils.js   # DOM manipulation helpers
│       ├── color-utils.js # Color analysis utilities
│       └── material-tokens.js # Material Design token mappings
├── templates/
│   ├── component.html     # Component documentation template
│   ├── token.html         # Token documentation template
│   └── overview.html      # System overview template
└── workers/
    └── crawler-worker.js  # Web Worker for background crawling

/supabase/functions/
├── systemic-audit/        # Start/manage audit jobs
│   └── index.ts
├── systemic-analyze/      # AI component analysis
│   └── index.ts
└── systemic-export/       # Export design system
    └── index.ts
```

## Implementation Timeline

### Week 1: Foundation
- [ ] Project structure setup
- [ ] Database schema migration
- [ ] Basic UI shell (Split-Context layout)
- [ ] Supabase Edge Function stubs

### Week 2: Crawler MVP
- [ ] URL queue management
- [ ] Basic page crawling (no auth)
- [ ] DOM style extraction
- [ ] Component boundary detection

### Week 3: Token Engine
- [ ] Color extraction and clustering
- [ ] Typography mapping
- [ ] Spacing analysis
- [ ] Material Design token mapping

### Week 4: Documentation
- [ ] AI usage guidelines generation
- [ ] Split-Context viewer completion
- [ ] Export functionality (CSS, JSON, SCSS)
- [ ] Component code snippets

### Week 5: Polish & Testing
- [ ] Authentication strategies
- [ ] Error handling
- [ ] Performance optimization
- [ ] User testing and fixes

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Crawling | Client-side + Workers | Avoids CORS via user's browser context |
| AI Analysis | Anthropic API | Already integrated in codebase |
| Storage | Supabase PostgreSQL | Existing infrastructure |
| UI | Vanilla JS | Matches existing codebase patterns |
| Styling | CSS Custom Properties | Leverages existing design system |

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| CORS blocking crawls | Use browser extension or proxy option |
| Large sites timeout | Implement pagination and incremental saves |
| AI rate limits | Queue system with backoff |
| Inconsistent styling (CSS-in-JS) | Extract computed styles, not source |

## Success Metrics

1. **Audit Completion Rate**: >90% of crawls complete successfully
2. **Token Accuracy**: >85% of extracted tokens match designer intent
3. **Documentation Quality**: Generated docs require <20% manual editing
4. **User Time Saved**: Reduce manual audit time by 80%

---

## Quick Start Commands

**Production URL:** https://ctrl.rodeo/systemic/

```bash
# Start local development
cd /home/user/fikei.github.io
python3 -m http.server 8000
# Open http://localhost:8000/systemic/

# Deploy Supabase functions
cd supabase
supabase functions deploy systemic-analyze

# Run database migrations
supabase db push
```

## References

- [Material Design 3 Guidelines](https://m3.material.io/)
- [Design Tokens W3C Draft](https://design-tokens.github.io/community-group/format/)
- [Anthropic API Documentation](https://docs.anthropic.com/)
