# ctrl.rodeo Documentation

> All documentation organized by product. Each product follows the same structure: `README.md` → `prd/` → `technical/` → `ux/` → `research/` → `plan/`.

---

## Products

| Product | Status | Description |
|---------|--------|-------------|
| [**Boards**](boards/) | Production | Link curation with AI categorization, widgets, and enrichment |
| [**Design System**](design-system/) | Production | Shared UI tokens, components, and 11 widget templates |
| [**Systemic**](systemic/) | Experimental | Design system reverse-engineering and QA governance |
| [**Soundscape**](soundscape/) | Experimental | Audio-reactive visualization with WebSocket streaming |
| [**Events**](events/) | Experimental | Event aggregator with Discord and ScreenSlate sources |
| [**Tasks**](tasks/) | Experimental | Email triage and task management with AI classification |
| [**Favicon**](favicon/) | Experimental | AI-powered favicon generator |

## Cross-cutting

| Area | Description |
|------|-------------|
| [**Strategy**](strategy/) | Vision, brand positioning, personas, decision log |
| [**Ops**](ops/) | Architecture, deployment, security, Notion sync, AI agents, bugs |
| [**Archive**](archive/) | Superseded and legacy docs (preserved, never deleted) |

---

## Standard product structure

Every product uses the same category layout. Not all products need every category — directories are added as content arrives.

```
docs/<product>/
├── README.md        # Overview, status, capabilities, links
├── prd/             # Product requirements (what & why)
├── technical/       # Technical design (how it's built)
├── ux/              # User experience (wireframes, flows, research)
├── research/        # Competitive analysis, references
└── plan/            # Execution plan (phases, tasks, backlog)
```

## Adding a new product

1. Create `docs/<product>/README.md` using an existing product README as template
2. Add subdirectories as content is written (`prd/`, `technical/`, etc.)
3. Add the product section to `notion-structure.json`
4. Keep the structure consistent with other products
