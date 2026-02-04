# ctrl.rodeo

> A unified personal platform combining multiple micro-applications with AI integration.

**Live**: [ctrl.rodeo](https://ctrl.rodeo)
**Status**: 🟢 Active Development

---

## Products

Production-quality applications with full documentation, testing, and support.

| Product | Description | Status | Docs |
|---------|-------------|--------|------|
| [**Boards**](./boards/) | Link curation with AI categorization | 🟢 Active | [README](./boards/README.md) |
| [**Design System**](./design-system/) | CTRL component library | 🟢 Active | [README](./design-system/README.md) |

---

## Playground

Experimental projects for learning, prototyping, and fun. Lighter documentation, may be incomplete.

| Project | Description | Status | Docs |
|---------|-------------|--------|------|
| [**Soundscape**](./soundscape/) | Audio-reactive visualization | 🟡 Experimental | [README](./soundscape/README.md) |
| [**Systemic**](./systemic/) | Design system reverse-engineering | 🟡 Experimental | [README](./systemic/README.md) |
| [**Favicon**](./favicon/) | Favicon generator tool | 🟡 Experimental | [README](./favicon/README.md) |

---

## Philosophy

- **Vibe Coding** - Rapid, intuitive development with AI assistance
- **Minimal Design** - Pure black/white aesthetic, function over decoration
- **AI-First** - Claude integration for intelligent features
- **Documentation-Driven** - Comprehensive docs in `/docs/`

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/fikei/fikei.github.io.git
cd fikei.github.io

# View locally (Jekyll)
bundle install
bundle exec jekyll serve

# Or just open index.html in a browser
```

---

## Project Status

See [PROJECT-STATUS.md](./PROJECT-STATUS.md) for current work tracking.

### Active Work
- Collaborative boards feature
- Soundscape audio source integrations
- AI agent system automation

### Recently Completed
- AI Widget System v3.0
- Content type classification
- Claude Code context system
- Notion integration

---

## Architecture

```
ctrl.rodeo/
│
├── 📦 PRODUCTS
│   ├── boards/           # Link curation app
│   └── design-system/    # Shared components
│
├── 🧪 PLAYGROUND
│   ├── soundscape/       # Audio visualization experiment
│   ├── systemic/         # Design system reverse-engineering
│   └── favicon/          # Favicon generator
│
├── 🏗 INFRASTRUCTURE
│   ├── supabase/functions/
│   │   ├── agent-handler/    # AI agent orchestration
│   │   ├── notion-sync/      # Notion integration
│   │   ├── enrich-link/      # Content enrichment
│   │   └── generate-widget/  # AI recommendations
│   └── .github/workflows/    # CI/CD automation
│
├── 📚 DOCUMENTATION
│   ├── docs/             # PRDs, TECH specs, setup guides
│   └── .claude/          # AI agent definitions
│
└── 🎨 ASSETS
    ├── css/              # Global styles
    ├── js/               # Global scripts
    └── images/           # Icons, favicons
```

---

## Documentation

### Product & Strategy
| Document | Description |
|----------|-------------|
| [BACKLOG.md](./BACKLOG.md) | Product roadmap and epics |
| [PROJECT-STATUS.md](./PROJECT-STATUS.md) | Current sprint tracking |
| [CHANGELOG.md](./CHANGELOG.md) | Release history |

### Technical
| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | AI context for Claude Code |
| [TECH-ai-widget-system.md](./docs/TECH-ai-widget-system.md) | AI recommendation architecture |
| [TECH-content-type-and-image-systems.md](./docs/TECH-content-type-and-image-systems.md) | Classification system |

### Setup Guides
| Document | Description |
|----------|-------------|
| [SETUP-ai-agent-system.md](./docs/SETUP-ai-agent-system.md) | Agent system setup |
| [SETUP-content-type-and-image-systems.md](./docs/SETUP-content-type-and-image-systems.md) | Content system setup |

### Operations
| Document | Description |
|----------|-------------|
| [COSTS.md](./COSTS.md) | Service costs and billing tracking |

---

## AI Agent Workforce

This project implements an AI agent system for automated management:

| Agent | Role |
|-------|------|
| Organizational | Documentation standards |
| Project Management | Task structuring |
| Status Update | Progress tracking |
| Chief of Staff | Decision routing |
| Security & Compliance | Privacy audits |
| Continuous Improvement | Process optimization |

See [.claude/agents/](./.claude/agents/) for agent definitions.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML, CSS, vanilla JavaScript |
| Backend | Supabase Edge Functions (TypeScript/Deno) |
| Database | Supabase PostgreSQL |
| AI | Claude 3 Haiku, GPT-4o mini |
| Hosting | GitHub Pages |
| Integrations | Notion, GitHub Actions |

---

## Contributing

1. Check [PROJECT-STATUS.md](./PROJECT-STATUS.md) for current priorities
2. Read [CLAUDE.md](./CLAUDE.md) for development guidelines
3. Follow the design system in [design-system/](./design-system/)
4. Update documentation as you go

---

## License

Private repository - all rights reserved.
