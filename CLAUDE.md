# Claude Code Context - ctrl.rodeo

This file provides context to Claude Code and other AI development tools for working with this repository.

## Project Overview

**ctrl.rodeo** is a personal curation platform that helps people collect, organize, and build on everything that matters to them. Built as a Jekyll static site with Supabase backend and AI integration.

**Tagline:** Your likes. Your saves. Your life — organized.

### Brand Positioning

The core insight: **what you experience informs what you create.** ctrl.rodeo makes the connection between input and output visible, searchable, and actionable. It starts with creatives — artists, designers, musicians — and expands to anyone whose life is richer when intentionally curated.

See [Brand Positioning](./docs/strategy/brand-positioning.md) for full positioning statement, voice & tone, and development implications.
See [User Personas](./docs/ux/personas.md) for detailed personas with Jobs To Be Done and the persona-to-feature matrix.

### Brand Principles (Guide All Feature Decisions)
1. **Input shapes output** — surface connections and patterns in what users collect
2. **Organize as you go** — AI handles categorization; zero-friction capture
3. **One place, whole life** — don't silo interests; let connections emerge across categories
4. **Show, don't decorate** — minimal interface; the user's content is the design
5. **Expand with the user** — start simple, grow deep; progressive complexity

### Primary Audience: Creatives
Artists, designers, musicians, writers, filmmakers — high-volume collectors whose creative output depends on input richness. See personas: The Visual Collector, The Sound & Scene Curator, The DJ, The Multidisciplinary Maker.

### Growth Audiences
Enthusiasts, researchers, cultural omnivores, knowledge workers, students, small business owners. Same core need: intentional curation of a complex life. See personas: The Deep-Dive Enthusiast, The Researcher, The Cultural Omnivore, The Design Technologist, and future personas The Student, The Small Business Owner, The Planner.

### Core Philosophy
- **Vibe Coding**: Rapid, intuitive development with AI assistance
- **Minimal Design**: Pure black/white aesthetic, function over decoration
- **AI-First**: Claude integration for intelligent features
- **Documentation-Driven**: Comprehensive docs in `/docs/`

---

## Working With Me (User Preferences)

**Local Environment:**
- GitHub repositories: `/Users/ian/Documents/GitHub/`
- This repo: `/Users/ian/Documents/GitHub/fikei.github.io`

When working on this project, always follow these guidelines:

1. **Structure project plans as Phases → Epics → Stories → Tasks**
   - Phases: Major milestones or releases
   - Epics: Large features or initiatives
   - Stories: User-facing functionality
   - Tasks: Specific implementation steps
   - **"Work item"** is the generic term for any project plan item that should be prioritized. When given a work item, determine the right fidelity level (Phase, Epic, Story, Task, Bug, or Backlog item) and place it in the correct location in the project plan. Prioritize and restructure the plan as necessary.

2. **Always show content I need to copy and paste**
   - Provide complete code blocks, commands, or configuration
   - Don't summarize when exact text is needed
   - Format for easy copying (code blocks, terminal commands)
   - **Always use full paths** in terminal commands (e.g., `/Users/ian/Documents/GitHub/fikei.github.io`)

3. **Always provide next steps at the end of completing a task**
   - Before finishing a response, check: "Does the user need to do anything?"
   - If YES, provide a clear **"Next Steps"** section with:
     1. Numbered step-by-step instructions
     2. Exact commands to copy/paste
     3. Any manual actions (browser, external services, approvals)
     4. Verification steps to confirm success
   - If NO user action needed, explicitly state: "No action needed - changes are complete."
   - Always remind about: secrets, deployments, merges, or external service setup

4. **Maintain unified project plan tracking via `/plan`**
   - All tasks are tracked in `docs/execution/project-plan/` (one file per phase + index)
   - **Do not manually edit plan files** — use Documentation Agent commands:
     - `/plan` — auto-detects: updates from branch commits (feature branch) or audits integrity (master)
     - `/plan add <description>` — files new work to correct phase/epic by sub-product
     - `/plan rebalance` — reorganize items across phases
   - The agent updates task statuses, recalculates index counts, and validates consistency
   - Reference the project plan when resuming work or starting new sessions

5. **Sync documentation to Notion and GitHub**
   - When creating or updating PRDs, technical specs, or project plans:
     1. Write/update the markdown file in `docs/`
     2. Ensure the file is listed in `notion-structure.json` if new
     3. Commit and push to `master`/`main` — Notion sync triggers automatically when doc files change
   - **Notion sync triggers:**
     - `master`/`main`: Syncs when `.md` or `notion-structure.json` files changed
     - `claude/*`: Syncs when doc files changed
     - Manual: `gh workflow run agent-automation.yml -f force_full_sync=true`
   - **Auto-discovery**: On every sync, untracked `.md` files in `docs/` are flagged via GitHub issue
   - **Health check** runs weekly on Fridays and creates GitHub issues for stale/empty/orphaned pages
   - **When consolidating multiple docs into one:**
     1. Create the new consolidated doc
     2. Move old files to appropriate `archive/` folder using `git mv`
     3. Update `notion-structure.json` to remove old entries and add new one
     4. Add `archive/README.md` listing what was archived and why
     5. On next sync, old Notion pages are automatically deleted
   - **GitHub is always the source of truth** - Notion structure matches `notion-structure.json`
   - **Page source detection** - Inferred from Notion's `created_by` metadata:
     - `created_by.type = "bot"` → AI/integration-created (deletable)
     - `created_by.type = "person"` → Human-created (protected)
     - No manual tagging needed - automatically detected from Notion
   - **Automatic cleanup rules** (pages NOT in `notion-structure.json`):
     1. Bot-created pages → **DELETE** (move to Archive)
     2. Human-created pages that are empty (title only) → **DELETE**
     3. Human-created pages with content → **PROTECT** (do not delete)
   - **Manual deletion rules:**
     - AI pages: Can delete, archive, or reorganize freely anytime
     - Human pages: Only delete/archive if ALL content has been consolidated elsewhere first
     - When consolidating human pages: Verify all content is preserved before archiving
   - **When moving content:**
     - ~~Strike through~~ the old content in the original location
     - Add a link to the new location: "→ Moved to [New Page Name](path/to/new-file.md)"
     - This preserves traceability and helps users find relocated content
   - Documentation locations:
     - PRDs → `docs/strategy/prds/`
     - Tech specs → `docs/infrastructure/technical-design/`
     - Project plans → `docs/execution/`
     - UX documentation → `docs/ux/`
     - Archived docs → `*/archive/`

6. **Maintain an explicit changelog via `/pm changelog`**
   - After completing significant work, use `/pm changelog` to generate entries
   - The agent gathers commits, categorizes changes, and appends to `CHANGELOG.md`
   - For external-facing changelogs: `/pm changelog external`
   - Manual edits to CHANGELOG.md are acceptable for quick entries

7. **Use and extend the design system**
   - Check `design-system/` before creating any UI
   - Reuse existing components from `design-system/components.css`
   - Use tokens from `design-system/tokens.css` (colors, spacing, typography)
   - When adding new UI concepts, extend the design system first
   - Document new components in `design-system/README.md`
   - Run systemic analyzer after design system changes

8. **Notify when updating documentation**
   - When creating, updating, or deleting any documentation file, explicitly tell me what was changed
   - Include the file path and a brief summary of changes
   - This applies to: PRDs, tech specs, project plans, READMEs, and any markdown files in `/docs/`

9. **Update project plan when completing user-facing tasks via `/plan`**
   - After finishing a user-facing feature, run `/plan` to update story status from branch commits
   - The agent marks tasks complete, adds implementation details (key files, functions), and updates index counts
   - **Do not manually check/uncheck items** in plan files — let the agent maintain consistency

10. **Update design system documentation when adding UI components**
    - When adding new CSS classes or UI patterns, document them in `design-system/README.md`
    - Include: component name, HTML example, behavior notes
    - This is REQUIRED for any new `.class-name` added to stylesheets
    - Keep documentation consistent with existing component format

11. **Update UX documentation when changing the UI via `/ux`**
    - After implementing any user-facing feature, run `/ux <feature-area>` to update docs
    - The agent follows the established format: User Goals, JTBD table, Wireframes, Technical Notes
    - It marks features as ✅ Shipped, generates ASCII wireframes from HTML/CSS, and adds file references
    - Run `/ux` (no args) to audit all UX docs against the codebase
    - UX doc locations:
      - Boards features → `docs/ux/boards/`
      - User features → `docs/ux/users/`
      - Widget features → `docs/ux/widgets/`
      - Pin features → `docs/ux/pins/`

12. **Check widget design comments before working on widgets**
    - At the start of every prompt involving widget work, check for existing design audit comments
    - Read the audit state from `design-system/widgets.html` (localStorage key: `widget-variant-audit`)
    - Export current audit data by opening `design-system/widgets.html` and clicking "Copy as JSON" in the Audit Log, or inspect the `widget-variant-audit` key in localStorage
    - Alternatively, search `widgets.html` for hardcoded audit state or review the variant audit section
    - Report findings: list any variants with status yellow (to process), orange (needs review), or red (blocked)
    - Add audit items to your task checklist before starting implementation
    - Stoplight status meanings:
      - **Green** = No updates needed
      - **Yellow** = Comment to process (designer left feedback, needs developer action)
      - **Orange** = Updated and needs review (developer acted on feedback, awaiting designer approval)
      - **Red** = Blocked (variant should not be implemented)
    - When completing widget work, update the stoplight status (mark processed → orange) for any comments you addressed

13. **Use Documentation Agent commands instead of manually editing docs**
    - **The working agent should not directly edit documentation files.** Instead, recommend or invoke the appropriate Documentation Agent command at natural trigger points during development. This keeps docs consistent and prevents drift.
    - See `.claude/agents/documentation-agent.md` for full command specifications.

    **When to recommend each command:**

    | Trigger | Command | When to surface it |
    |---------|---------|-------------------|
    | Feature/task completed | `/plan` | After any code task finishes — update plan from branch commits |
    | Bug discovered | `/capture <description>` | When a bug is found during development — auto-detects severity and sub-product |
    | New work identified | `/capture <description>` | When implementation reveals new tasks, tech debt, or follow-up work |
    | Architecture changed | `/arch` | After modifying system design, APIs, schemas, or data flows |
    | Architecture decision made | `/arch decide <title>` | When a technical choice is made during development |
    | UI feature shipped | `/ux <feature-area>` | After implementing any user-facing change |
    | Before creating PR | `/branch` | Diff docs against master to find missing updates |
    | Scope feels large | `/pm scope` | When a branch is doing more than originally planned |
    | End of significant work | `/pm changelog` | After completing a feature, epic, or sprint |
    | Planning session | `/pm status` | At the start of planning to understand current state |
    | Weekly maintenance | `/cleanup` | Run full documentation hygiene suite |
    | New PRD written | `/pm plan <prd-path>` | Generate plan entries from a new PRD |
    | Decision needed | `/pm decide <title>` | When a blocking decision is identified |

    **Automatic recommendations — the agent MUST surface these at the right moments:**
    - After completing code work: "Documentation may need updating. Recommended: `/plan` to mark tasks complete, `/arch` if architecture changed, `/ux <area>` if UI changed."
    - When encountering a bug: "Want to log this? Recommended: `/capture <bug description>`"
    - When adding unplanned work: "This wasn't in the plan. Recommended: `/capture <work description>` to file it."
    - Before a PR: "Recommended: `/branch` to check if docs diverged from master."
    - When wrapping up a session: "Recommended: `/pm changelog` to capture what was done."

    **These commands replace direct editing of:**
    - `docs/execution/project-plan/*.md` → use `/plan`
    - `docs/execution/BUGS.md` → use `/capture bug ...`
    - `docs/execution/project-plan/backlog.md` → use `/capture work ...`
    - `docs/infrastructure/technical-design/*.md` → use `/arch`
    - `docs/ux/**/*.md` → use `/ux`
    - `docs/strategy/decision-log.md` → use `/arch decide ...` or `/pm decide ...`
    - `CHANGELOG.md` → use `/pm changelog`

---

## Autonomous Operations

Claude Code is authorized to perform the following operations **without asking for confirmation**:

### Git & GitHub
- **Always create a PR to merge into master** — never push to master directly
- **Assign all PRs to `fikei`** so they appear in the GitHub mobile app for quick merge
- **Create and push branches** for feature work
- **Close stale branches** after successful merges

### Supabase Deployment
- **Deploy edge functions** via `supabase functions deploy` after merging to master
- **Run database migrations** when migration files are part of a merged PR
- **Check function logs** for debugging (`supabase functions logs`)

### Guardrails (still require human approval)
- **Force pushes** to any branch
- **Deleting branches** that have open PRs
- **Schema changes** that drop tables or columns (destructive migrations)
- **Changing environment variables or secrets** in Supabase dashboard
- **Modifying GitHub Actions workflows** that affect production deployments

---

## Quick Reference

### Directory Structure
```
/                           # Jekyll static site root
├── CLAUDE.md               # THIS FILE - AI context
├── .claude/                # Claude Code configuration
│   ├── agents/             # AI agent definitions
│   └── settings.json       # Claude Code settings
├── docs/                   # Technical & product documentation
│   ├── strategy/           # PRDs, vision, decision log
│   ├── execution/          # Sprints, shipped, blocked, project plans
│   ├── infrastructure/     # Architecture, deployment, technical design
│   └── setup/              # Setup guides
├── boards/                 # Link curation app (Boards)
├── soundscape/             # Audio-reactive visualization
├── systemic/               # Design system analyzer
├── supabase/functions/     # Edge functions (TypeScript)
├── design-system/          # Reusable UI components
└── css/                    # Global stylesheets
```

### Key Technologies
- **Frontend**: HTML, CSS, JavaScript (vanilla)
- **Backend**: Supabase Edge Functions (TypeScript/Deno)
- **AI**: Claude 3 Haiku (primary), GPT-4o mini (fallback)
- **Database**: Supabase PostgreSQL
- **Hosting**: GitHub Pages at ctrl.rodeo

### Supabase Projects

| Project | Reference ID | Purpose | Functions |
|---------|--------------|---------|-----------|
| **Boards** | `yfhudwakpgzswiylhfbh` | Main app backend | `generate-widget`, `enrich-link` |
| **Ops** | `ycilriwjnmcelkspmfmg` | Operations/automation | `notion-sync` |
| **Systemic** | `atdqdfpdeytfuvvpsasz` | Design system tools | - |

### Supabase Configuration

```bash
# Boards Project (main app)
SUPABASE_BOARDS_URL=https://yfhudwakpgzswiylhfbh.supabase.co
SUPABASE_BOARDS_REF=yfhudwakpgzswiylhfbh

# Ops Project (automation)
SUPABASE_OPS_URL=https://ycilriwjnmcelkspmfmg.supabase.co
SUPABASE_OPS_REF=ycilriwjnmcelkspmfmg

# Get anon key and service key from Supabase Dashboard → Settings → API
# Service key: click "Reveal" on service_role
# DO NOT commit the service key to git

# Deploy Boards functions
supabase link --project-ref yfhudwakpgzswiylhfbh
supabase functions deploy generate-widget
supabase functions deploy enrich-link

# Deploy Ops functions
supabase link --project-ref ycilriwjnmcelkspmfmg
supabase functions deploy notion-sync

# View function logs
supabase functions logs generate-widget --tail
supabase functions logs notion-sync --tail
```

### Notion Sync Commands (Ops Project)
```bash
SUPABASE_OPS_URL=https://ycilriwjnmcelkspmfmg.supabase.co

# Sync all content to Notion
curl -X POST "$SUPABASE_OPS_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync-structure"}'

# Preview cleanup (dry run)
curl -X POST "$SUPABASE_OPS_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "cleanup", "dryRun": true}'

# Delete legacy pages
curl -X POST "$SUPABASE_OPS_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "cleanup"}'
```

### Widget Testing (Boards Project)
```bash
SUPABASE_BOARDS_URL=https://yfhudwakpgzswiylhfbh.supabase.co

# Test generate-widget
curl -X POST "$SUPABASE_BOARDS_URL/functions/v1/generate-widget" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"widgetId": "complete-the-look", "prompt": "test", "items": [{"id": "1", "title": "Nike shoes", "url": "https://nike.com"}, {"id": "2", "title": "Jacket", "url": "https://example.com"}]}'
```

---

## Development Guidelines

### Before Making Changes
1. **Read existing code first** - Never propose changes to unread files
2. **Check `/docs/`** - Review relevant PRD and TECH documents
3. **Understand the context** - Each app has specific design requirements

### Code Style
- **Minimal abstraction** - Simple, direct code
- **No frameworks** - Vanilla JS preferred
- **Dark mode first** - Design for dark backgrounds
- **Mobile responsive** - All interfaces must work on mobile

### Commit Practices
- Clear, descriptive commit messages
- Reference relevant docs or issues
- Test locally before pushing

---

## Application Context

### Boards (`/boards/`)
**Purpose**: Personal link curation with AI categorization
**Key Files**:
- `boards/index.html` - Main application (256KB)
- `supabase/functions/enrich-link/` - Content enrichment
- `docs/strategy/prds/boards-mvp.md` - Product requirements

**AI Integration**: Automatic content type detection, category suggestion

### AI Widget System
**Purpose**: Intelligent product recommendations
**Key Files**:
- `supabase/functions/generate-widget/` - Widget generation
- `docs/infrastructure/technical-design/ai-widget-system.md` - Architecture details

**AI Integration**: Claude Haiku for product recommendations, 47+ brand integrations

### Soundscape (`/soundscape/`)
**Purpose**: Audio-reactive visualization controls
**Key Files**:
- `soundscape/PROJECT_PLAN.md` - Full specification
- WebSocket server with real-time audio analysis

### Systemic (`/systemic/`)
**Purpose**: Design system visualization and analysis
**Key Files**:
- `systemic/js/crawler.js` - Component analysis
- `systemic/js/doc-generator.js` - Documentation generation

---

## AI Agent Workforce

The Agent is Claude Code operating within this repository — one agent with 8 operational modes that activate based on the task. See `.claude/agents/AGENT-DEFINITION.md` for the consolidated definition.

### Operational Modes
| Mode | Activates When | Core Behavior |
|------|---------------|---------------|
| Documentation | Feature shipped, bug found, plan stale | Manage doc content via `/plan`, `/arch`, `/capture`, `/ux`, `/branch`, `/cleanup`, `/pm` |
| Documentation Sync | Doc files change | Sync markdown to Notion, maintain structure |
| Organizational | Any file modification | Enforce standards, validate completeness |
| Project Management | PRDs created/updated | Break work into Phases > Epics > Stories > Tasks |
| Status Update | Progress check needed | Track completion, flag blockers |
| Security & Compliance | Code/config changes | Scan for secrets, validate data handling |
| Continuous Improvement | Sprint ends, weekly | Analyze patterns, suggest optimizations |
| Chief of Staff | Cross-mode conflicts | Synthesize state, route decisions |

### Documentation Agent Commands (Quick Reference)
| Command | Purpose | Default behavior |
|---------|---------|-----------------|
| `/plan` | Project plan management | Updates from branch (feature) or audits (master) |
| `/arch` | Architecture doc management | Syncs code changes to tech specs |
| `/capture` | Log bugs, work, tech debt | Auto-detects type from language |
| `/ux` | UX documentation | Audits all UX docs against code |
| `/branch` | Cross-branch doc operations | Diffs current branch docs vs master |
| `/cleanup` | Documentation hygiene | Runs all checks (stale, orphans, duplicates, archive) |
| `/pm` | Program management | Status report (master) or scope check (feature branch) |

See `.claude/agents/documentation-agent.md` for full specifications.

### Key Files
- **Definition**: `.claude/agents/AGENT-DEFINITION.md` — consolidated behavioral rules, decision authority, capabilities
- **Documentation Agent**: `.claude/agents/documentation-agent.md` — 7 commands, 28 sub-functions, 8 workflows
- **Specialist specs**: `.claude/agents/*.md` — detailed workflows, templates, and report formats per mode

---

## Integration Points

### Notion Sync (Planned)
- PRDs and technical plans bidirectional sync
- Calendar and timeline synchronization
- Real-time documentation visibility

### API Protocols
- Secure API access for external AI agents
- Defined workflows for read/modify operations
- Audit logging for all changes

---

## Common Tasks

### Adding a New Feature
1. Create PRD in `/docs/strategy/prds/feature-name.md`
2. Run `/pm plan docs/strategy/prds/feature-name.md` to generate plan entries
3. Create technical spec in `/docs/infrastructure/technical-design/feature-name.md`
4. Implement with continuous commits
5. During development: `/capture` for new work/bugs discovered
6. Before PR: `/branch` to check doc state, `/plan` to update plan
7. After merge: `/ux` if UI changed, `/arch` if architecture changed, `/pm changelog`

### Debugging AI Features
1. Check Supabase function logs
2. Review prompt in function source
3. Test with minimal input
4. Check caching layer
5. If bug found: `/capture <bug description>`

### Design System Updates
1. Modify tokens in `design-system/tokens.css`
2. Update components in `design-system/components.css`
3. Run systemic analyzer for validation
4. Run `/arch` to update technical docs if system design changed

### Sprint Planning
1. `/pm status` — current state report
2. `/plan` — audit plan integrity
3. `/pm deps` — check blockers and critical path
4. `/pm decisions` — surface pending decisions
5. `/cleanup` — documentation hygiene

### End of Week
1. `/cleanup` — full documentation hygiene suite
2. `/pm status` — weekly status report
3. `/pm changelog` — capture what was done

---

## Current Sprint Focus

Check `docs/execution/project-plan/index.md` for current priorities and phase status.

---

## Related Documents
- [Brand Positioning](./docs/strategy/brand-positioning.md) - Tagline, positioning statement, brand principles
- [User Personas](./docs/ux/personas.md) - Audience personas with JTBD and feature matrix
- [Project Plan](./docs/execution/project-plan/index.md) - Current task tracking (single source of truth)
- [CHANGELOG.md](./CHANGELOG.md) - History of all changes
- [Backlog](./docs/execution/project-plan/backlog.md) - Future work items
- [Bugs](./docs/execution/BUGS.md) - Active bug registry
- [docs/infrastructure/technical-design/ai-widget-system.md](./docs/infrastructure/technical-design/ai-widget-system.md) - AI architecture
- [design-system/README.md](./design-system/README.md) - Design system guide
- [Documentation Agent](/.claude/agents/documentation-agent.md) - Full command specifications
