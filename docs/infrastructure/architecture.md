# System Architecture

> Technical architecture overview for ctrl.rodeo

---

## Status Legend

| Icon | Meaning |
|------|---------|
| ✅ | Implemented |
| 🔄 | In Development |
| ⏳ | Planned |

---

## Repository Structure

```
ctrl.rodeo/
│
├── 📦 PRODUCTS (Production-quality)
│   ├── boards/              # Link curation app
│   │   └── README.md        # Full product documentation
│   └── design-system/       # Shared components
│       └── README.md        # Component library docs
│
├── 🧪 PLAYGROUND (Experimental)
│   ├── soundscape/          # Audio visualization
│   │   └── README.md        # Lightweight docs
│   ├── systemic/            # Design system reverse-engineering
│   │   └── README.md        # Lightweight docs
│   └── favicon/             # Favicon generator
│       └── README.md        # Lightweight docs
│
├── 🏗 INFRASTRUCTURE
│   ├── supabase/functions/  # Edge functions
│   └── .github/workflows/   # CI/CD
│
├── 📚 DOCUMENTATION
│   ├── docs/                # PRDs, TECH, SETUP, INFRA
│   └── .claude/agents/      # AI agent definitions
│
└── 🎨 ASSETS
    ├── css/                 # Global styles
    ├── js/                  # Global scripts
    └── images/              # Icons, favicons
```

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                               │
│  Browser (ctrl.rodeo) │ Claude Code │ GitHub Actions        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    GITHUB PAGES                              │
│  ✅ Static HTML/CSS/JS │ ✅ Jekyll │ ✅ Custom Domain        │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                 SUPABASE EDGE FUNCTIONS                      │
│  ✅ agent-handler    │ ✅ enrich-link                        │
│  ✅ generate-widget                                          │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
┌─────────────────┐               ┌─────────────┐
│    SUPABASE     │               │   CLAUDE    │
│   PostgreSQL    │               │   API       │
│  ✅ Database    │               │ ✅ Haiku    │
│  ✅ Auth        │               │ ⏳ Opus     │
└─────────────────┘               └─────────────┘
```

---

## Component Details

### Frontend (GitHub Pages)

| Component | Technology | Status |
|-----------|------------|--------|
| Static hosting | GitHub Pages | ✅ |
| Build system | Jekyll | ✅ |
| Domain | ctrl.rodeo | ✅ |
| SSL | GitHub automatic | ✅ |

### Backend (Supabase)

| Function | Purpose | Status |
|----------|---------|--------|
| `agent-handler` | AI agent orchestration | ✅ |
| `notion-sync` | GitHub → Notion doc sync | ❌ Removed 2026-07-29 |
| `enrich-link` | URL metadata extraction | ✅ |
| `generate-widget` | AI recommendations | ✅ |

### Database (Supabase PostgreSQL)

| Table | Purpose | Status |
|-------|---------|--------|
| `links` | Core link storage | ✅ |
| `shared_boards` | Board sharing config | ✅ |
| `board_views` | View analytics | ✅ |
| `board_invites` | Access invitations | ✅ |
| `domain_profiles` | Domain type caching | ✅ |
| `content_types` | 9 content types | ✅ |
| `classification_log` | Type discovery | ✅ |
| `image_strategies` | Resolution pipelines | ✅ |
| `strategy_performance` | Performance metrics | ✅ |
| `audit_jobs` | Systemic crawl tasks | ✅ |
| `design_systems` | Generated output | ✅ |
| `design_tokens` | Token extraction | ✅ |
| `design_components` | Component analysis | ✅ |

### AI Services

| Provider | Model | Use Case | Status |
|----------|-------|----------|--------|
| Anthropic | Claude 3 Haiku | Primary AI | ✅ |
| OpenAI | GPT-4o mini | Fallback | ✅ |

### External Integrations

| Service | Purpose | Status |
|---------|---------|--------|
| Notion | Documentation sync | ❌ Removed 2026-07-29 |
| GitHub Actions | Event scraping (`scrape-events.yml`) | ✅ |

---

## Data Flow

### Link Enrichment Flow
```
User pastes URL
       │
       ▼
┌──────────────┐
│ enrich-link  │ ──► Fetch metadata, images
└──────────────┘
       │
       ▼
┌──────────────┐
│ Claude Haiku │ ──► Categorize, summarize
└──────────────┘
       │
       ▼
┌──────────────┐
│  PostgreSQL  │ ──► Store enriched link
└──────────────┘
```

### Agent Automation Flow
```
GitHub Action trigger
       │
       ▼
┌──────────────┐
│agent-handler │ ──► Route to appropriate agent
└──────────────┘
       │
       ▼
┌──────────────┐
│ Claude Haiku │ ──► Process with agent prompt
└──────────────┘
```

---

## Security Model

| Layer | Protection | Status |
|-------|------------|--------|
| API Keys | Supabase secrets | ✅ |
| Auth | Supabase Auth | ✅ |
| HTTPS | GitHub automatic | ✅ |
| CORS | Function-level | ✅ |

---

*Last updated: 2026-02-04*
