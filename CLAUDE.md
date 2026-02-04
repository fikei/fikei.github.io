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

3. **Always provide next steps at the end of completing a task**
   - Give step-by-step instructions for what I need to do
   - Include any manual steps (browser actions, external services)
   - List commands to run in order
   - Remind me about secrets, deployments, or verification steps

4. **Maintain unified project plan tracking**
   - All tasks requested in chat should be added to `PROJECT-STATUS.md`
   - Update task status (pending/in-progress/complete) as work progresses
   - Keep the project plan as single source of truth for what's been requested and done
   - Reference the project plan when resuming work or starting new sessions

5. **Maintain an explicit changelog**
   - Update `CHANGELOG.md` after completing significant work
   - Log what was changed, added, or fixed
   - Include date and brief description
   - Group changes by session or feature

6. **Use and extend the design system**
   - Check `design-system/` before creating any UI
   - Reuse existing components from `design-system/components.css`
   - Use tokens from `design-system/tokens.css` (colors, spacing, typography)
   - When adding new UI concepts, extend the design system first
   - Document new components in `design-system/README.md`
   - Run systemic analyzer after design system changes

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
│   ├── PRD-*.md            # Product requirement documents
│   ├── TECH-*.md           # Technical architecture docs
│   └── PROJECT-PLAN-*.md   # Implementation roadmaps
├── boards/                 # Link curation app ("Things I Like")
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
- `docs/PRD-things-i-like.md` - Product requirements

**AI Integration**: Automatic content type detection, category suggestion

### AI Widget System
**Purpose**: Intelligent product recommendations
**Key Files**:
- `supabase/functions/generate-widget/` - Widget generation
- `docs/TECH-ai-widget-system.md` - Architecture details

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
1. Create PRD in `/docs/PRD-feature-name.md`
2. Review with AI agent (Project Management)
3. Create technical spec in `/docs/TECH-feature-name.md`
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
- [docs/TECH-ai-widget-system.md](./docs/TECH-ai-widget-system.md) - AI architecture
- [design-system/README.md](./design-system/README.md) - Design system guide
