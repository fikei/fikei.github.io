# Claude Code Context - ctrl.rodeo

This file provides context to Claude Code and other AI development tools for working with this repository.

## Project Overview

**ctrl.rodeo** is a unified personal platform combining multiple micro-applications with AI integration, built as a Jekyll static site with Supabase backend services.

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

4. **Maintain unified project plan tracking**
   - All tasks should be tracked in `docs/execution/UNIFIED-PROJECT-PLAN.md`
   - Update task status (pending/in-progress/complete) as work progresses
   - Keep the unified plan as single source of truth for all stories and tasks
   - Reference the project plan when resuming work or starting new sessions

5. **Sync documentation to Notion and GitHub**
   - When creating or updating PRDs, technical specs, or project plans:
     1. Write/update the markdown file in `docs/`
     2. Ensure the file is listed in `notion-structure.json` if new
     3. Commit and push - **Notion syncs automatically** (triggers on master and claude/* branches)
   - The GitHub Actions workflow (`agent-automation.yml`) auto-syncs on any push
   - To manually trigger sync: `gh workflow run agent-automation.yml`
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

6. **Maintain an explicit changelog**
   - Update `CHANGELOG.md` after completing significant work
   - Log what was changed, added, or fixed
   - Include date and brief description
   - Group changes by session or feature

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

9. **Update project plan when completing user-facing tasks**
   - After finishing a user-facing feature, update the story status in `docs/execution/UNIFIED-PROJECT-PLAN.md`
   - Add implementation details if relevant (e.g., key files, functions, components)

10. **Update design system documentation when adding UI components**
    - When adding new CSS classes or UI patterns, document them in `design-system/README.md`
    - Include: component name, HTML example, behavior notes
    - This is REQUIRED for any new `.class-name` added to stylesheets
    - Keep documentation consistent with existing component format

11. **Update UX documentation when changing the UI**
    - After implementing any user-facing feature, update/create docs in `docs/ux/`
    - Follow existing format: User Goals, JTBD table, Wireframes, Technical Notes
    - Mark features as ✅ Shipped with implementation details
    - Add ASCII wireframes showing current implementation
    - Include file paths and function references
    - UX doc locations:
      - Boards features → `docs/ux/boards/`
      - User features → `docs/ux/users/`
      - Widget features → `docs/ux/widgets/`
      - Pin features → `docs/ux/pins/`

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

### Supabase Configuration
```bash
# Project URLs
SUPABASE_URL=https://ycilriwjnmcelkspmfmg.supabase.co
SUPABASE_PROJECT_REF=ycilriwjnmcelkspmfmg

# Get anon key and service key from Supabase Dashboard → Settings → API
# Service key: click "Reveal" on service_role
# DO NOT commit the service key to git

# Deploy functions
supabase functions deploy notion-sync
supabase functions deploy enrich-link
supabase functions deploy generate-widget

# View function logs
supabase functions logs notion-sync --tail
```

### Notion Sync Commands
```bash
# Sync all content to Notion
curl -X POST "$SUPABASE_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync-structure"}'

# Preview cleanup (dry run)
curl -X POST "$SUPABASE_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "cleanup", "dryRun": true}'

# Delete legacy pages
curl -X POST "$SUPABASE_URL/functions/v1/notion-sync" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "cleanup"}'
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

This project implements a multi-agent system for automated management. See `.claude/agents/` for detailed specifications.

### Agent Overview
| Agent | Role | Trigger |
|-------|------|---------|
| Organizational | Documentation standards, data integrity | On file changes |
| Project Management | Format content into phases/epics/tasks | On PRD updates |
| Status Update | Track progress, flag blockers | Continuous |
| Chief of Staff | Global view, decision routing | Cross-agent coordination |
| Security & Compliance | Privacy and data safety audits | On sensitive changes |
| Continuous Improvement | Process optimization suggestions | Weekly analysis |

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
2. Review with AI agent (Project Management)
3. Create technical spec in `/docs/infrastructure/technical-design/feature-name.md`
4. Implement with continuous commits
5. Update relevant documentation

### Debugging AI Features
1. Check Supabase function logs
2. Review prompt in function source
3. Test with minimal input
4. Check caching layer

### Design System Updates
1. Modify tokens in `design-system/tokens.css`
2. Update components in `design-system/components.css`
3. Run systemic analyzer for validation
4. Update documentation

---

## Current Sprint Focus

Check `BACKLOG.md` for current priorities and sprint planning.

---

## Related Documents
- [PROJECT-STATUS.md](./PROJECT-STATUS.md) - Current task tracking (single source of truth)
- [CHANGELOG.md](./CHANGELOG.md) - History of all changes
- [BACKLOG.md](./BACKLOG.md) - Product roadmap
- [docs/infrastructure/technical-design/ai-widget-system.md](./docs/infrastructure/technical-design/ai-widget-system.md) - AI architecture
- [design-system/README.md](./design-system/README.md) - Design system guide
