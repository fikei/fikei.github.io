# Tech Stack

> Every technology, library, and service used by ctrl.rodeo

---

## Philosophy

No frameworks, no build step, no bundler. The frontend is vanilla JS served as static files by Jekyll/GitHub Pages. TypeScript is used only in Supabase Edge Functions (Deno runtime). The entire app runs from a single HTML file.

---

## Frontend

### Core

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Vanilla JavaScript** | ES2020+ | All app logic in `boards/index.html` IIFE |
| **CSS Custom Properties** | CSS3 | Theming, design tokens, dark/light mode |
| **Jekyll** | minimal theme | Static site generator (GitHub Pages) |
| **HTML5** | - | Semantic markup, no templates |

### CDN Dependencies

| Library | Version | CDN | Purpose |
|---------|---------|-----|---------|
| **Supabase JS SDK** | @2 | `cdn.jsdelivr.net/npm/@supabase/supabase-js@2` | Auth, database, REST API |
| **Google Fonts** | - | `fonts.googleapis.com` | Space Grotesk (400, 500, 700) |

### Vendor Libraries (Legacy)

Bundled in `/vendor/`. Used by the landing page and older templates, **not** by the Boards app.

| Library | Version | Files |
|---------|---------|-------|
| jQuery | 3.2.1 | `/vendor/jquery/jquery-3.2.1.min.js` |
| Bootstrap | 4.0.0-beta | `/vendor/bootstrap/` (CSS + JS) |
| Select2 | 4.0.3 | `/vendor/select2/` |
| Animsition | 4.0.2 | `/vendor/animsition/` |
| daterangepicker | 2.1.25 | `/vendor/daterangepicker/` |
| Perfect Scrollbar | - | `/vendor/perfect-scrollbar/` |
| Animate.css | - | `/vendor/animate/` |
| CSS Hamburgers | - | `/vendor/css-hamburgers/` |

### Icons & Fonts

| Resource | Version | Source |
|----------|---------|--------|
| Font Awesome | 4.7.0 | `/fonts/font-awesome-4.7.0/` |
| Space Grotesk | - | Google Fonts CDN |
| System sans-serif | - | Fallback stack |
| Favicons | - | `/images/icons/favicons/` (180, 32, 16, .ico) |

### CSS Architecture

| File | Purpose |
|------|---------|
| `design-system/tokens.css` | Color palette (grays 100-900), spacing scale (1-8), typography |
| `design-system/components.css` | Reusable UI components |
| `css/main.css` | Global styles |
| `css/util.css` | Utility classes |
| `css/cambio.css` | Landing page styles |
| `boards/index.html` (inline) | ~3,400 lines of embedded `<style>` |

No preprocessor (Sass, Less). No PostCSS. No Tailwind. Pure CSS with custom properties for theming.

---

## Backend

### Supabase Platform

| Service | Project | Ref ID | Plan |
|---------|---------|--------|------|
| **Database + Auth + Functions** | Boards | `yfhudwakpgzswiylhfbh` | Free |
| **Functions** | Ops | `ycilriwjnmcelkspmfmg` | Free |
| **Functions + Database** | Systemic | `atdqdfpdeytfuvvpsasz` | Free |

### Edge Functions (Deno Runtime)

| Technology | Version | Notes |
|-----------|---------|-------|
| **Deno** | (Supabase-managed) | Runtime for all edge functions |
| **Deno Standard Library** | 0.168.0 | `https://deno.land/std@0.168.0/http/server.ts` |
| **TypeScript** | (Deno built-in) | No separate tsconfig, Deno handles types |

### Function Inventory

| Function | Project | Language | Key Dependencies |
|----------|---------|----------|-----------------|
| `generate-widget` | Boards | TypeScript | Anthropic SDK |
| `enrich-link` | Boards | TypeScript | Anthropic API (raw fetch) |
| `enrich-wear` | Boards | TypeScript | Shopify JSON API |
| `categorize` | Boards | TypeScript | Anthropic API (raw fetch) |
| `agent-handler` | Boards | TypeScript | Anthropic API |
| `notion-sync` | Ops | TypeScript | Notion API (raw fetch) |
| `systemic-analyze` | Systemic | TypeScript | Anthropic SDK 0.39.0 |
| `systemic-fetch` | Systemic | TypeScript | - |

### Database

| Technology | Version | Notes |
|-----------|---------|-------|
| **PostgreSQL** | (Supabase-managed) | 25+ tables across 6 migrations |
| **Row-Level Security** | - | All tables have RLS enabled |
| **PostgREST** | (Supabase-managed) | REST API auto-generated from schema |

---

## AI Services

| Provider | Model | SDK Version | Used For |
|----------|-------|-------------|----------|
| **Anthropic** | Claude 3 Haiku (`claude-3-haiku-20240307`) | `@anthropic-ai/sdk@0.39.0` (Deno) | Categorization, classification, widgets, agents |
| **Anthropic** | Claude 3 Haiku | Raw fetch (`2023-06-01` API version) | Edge functions without SDK |
| **OpenAI** | GPT-4o mini | Raw fetch | Fallback for widget generation |

### AI Integration Patterns

| Pattern | Where |
|---------|-------|
| **Browser-side AI** | `boards/index.html` — optional categorization via `window.ANTHROPIC_API_KEY` |
| **Server-side AI (SDK)** | `systemic-analyze` — uses `npm:@anthropic-ai/sdk@0.39.0` |
| **Server-side AI (raw)** | `enrich-link`, `generate-widget`, `categorize` — raw HTTP to `api.anthropic.com` |

---

## Third-Party APIs

| Service | Endpoint | Auth | Used For |
|---------|----------|------|----------|
| **Notion** | `api.notion.com/v1` | Integration token | Documentation sync |
| **SerpAPI** | `serpapi.com/search` | API key | Product image search (widgets) |
| **Unsplash** | `api.unsplash.com/search/photos` | Access key | Image search fallback |
| **Shopify** | `{domain}/search/suggest.json` | None (public) | Product data for 31 brands |
| **YouTube** | `img.youtube.com/vi/{id}/hqdefault.jpg` | None | Video thumbnails |
| **Vimeo** | `vimeo.com/api/v2/video/{id}.json` | None | Video metadata |
| **Google Favicons** | `google.com/s2/favicons` | None | Favicon resolution |
| **allorigins.win** | `api.allorigins.win/raw` | None | CORS proxy for scraping |
| **corsproxy.io** | `corsproxy.io` | None | CORS proxy fallback |

---

## CI/CD & Automation

### GitHub Actions

| Technology | Version | Purpose |
|-----------|---------|---------|
| `actions/checkout` | v4 | Repository checkout |
| `actions/github-script` | v7 | Programmatic GitHub API |
| `tj-actions/changed-files` | v44 | Detect changed files in push |

**Runner**: `ubuntu-latest`

### Workflow: `agent-automation.yml`

| Trigger | Job |
|---------|-----|
| Push to main/master/claude/* | Notion sync, security scan |
| Pull request | Documentation standards check |
| Daily 9 AM UTC | Chief of Staff synthesis |
| Weekly Friday 4 PM UTC | Continuous improvement |

---

## Soundscape (Standalone)

Separate Node.js app, not part of the main Boards stack.

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | >=16.0.0 | Runtime |
| **Express** | ^4.18.2 | HTTP server |
| **Socket.IO** | ^4.6.1 | WebSocket real-time audio |
| **nodemon** | ^3.0.1 | Dev reload |

**Source**: `soundscape/package.json`

---

## Development Tooling

| Tool | Status | Notes |
|------|--------|-------|
| Testing framework | **None** | No jest, vitest, or test files |
| Linting | **None** | No eslint, prettier, stylelint |
| Type checking | **Edge functions only** | Deno built-in TypeScript, no tsconfig |
| Bundling | **None** | No webpack, vite, parcel |
| Package manager | **None** (root) | Soundscape only has package.json |
| Pre-commit hooks | **None** | No husky, lint-staged |

---

## Configuration Files

| File | Purpose |
|------|---------|
| `_config.yml` | Jekyll: `theme: jekyll-theme-minimal` |
| `CNAME` | Custom domain: `ctrl.rodeo` |
| `.env.template` | Environment variable reference |
| `.gitignore` | Ignore patterns for env, build, OS files |
| `notion-structure.json` | Notion page hierarchy for sync |
| `.claude/settings.json` | Claude Code agent configuration |
| `site.webmanifest` | PWA manifest (favicons) |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (Client)                          │
│                                                              │
│  boards/index.html (9.1K lines)                             │
│  ├── Vanilla JS (IIFE)                                      │
│  ├── CSS Custom Properties                                  │
│  ├── Supabase JS SDK @2 (CDN)                              │
│  ├── localStorage (primary data store)                      │
│  └── Space Grotesk (Google Fonts)                           │
│                                                              │
│  Landing pages                                               │
│  ├── jQuery 3.2.1 + Bootstrap 4.0.0-beta                   │
│  └── Font Awesome 4.7.0                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                SUPABASE PLATFORM                              │
│                                                               │
│  Edge Functions (Deno + TypeScript)                           │
│  ├── generate-widget  (Anthropic SDK 0.39.0)                │
│  ├── enrich-link      (Anthropic API raw)                   │
│  ├── categorize       (Anthropic API raw)                   │
│  └── notion-sync      (Notion API raw)                      │
│                                                               │
│  PostgreSQL (25+ tables, RLS enabled)                        │
│  PostgREST (auto-generated REST API)                         │
│  Auth (magic link, JWT sessions)                             │
└──────────────────────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌────────────┐ ┌─────────┐ ┌──────────┐
   │ Anthropic  │ │ Notion  │ │ SerpAPI  │
   │ Claude 3   │ │ API     │ │ + others │
   │ Haiku      │ │         │ │          │
   └────────────┘ └─────────┘ └──────────┘
```

---

## Related Documents

- [Dependencies](../dependencies.md) — Fallback behavior and risk assessment per service
- [Deployment Guide](../deployment.md) — How to deploy and manage each layer
- [Cost Model](../../../COSTS.md) — Per-operation cost estimates

---

*Last updated: 2026-02-06*
