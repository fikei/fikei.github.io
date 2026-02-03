# Claude Code Context System

This directory contains configuration and context files for Claude Code and other AI development tools working with this repository.

## Overview

The context system provides:
- **Project context** via `CLAUDE.md` (root directory)
- **Agent definitions** for automated workflows
- **Settings** for Claude Code configuration

## Directory Structure

```
.claude/
├── README.md           # This file
├── settings.json       # Claude Code configuration
└── agents/             # AI agent definitions
    ├── organizational-agent.md
    ├── project-management-agent.md
    ├── status-update-agent.md
    ├── chief-of-staff-agent.md
    ├── security-compliance-agent.md
    └── continuous-improvement-agent.md
```

## Quick Reference

### Context File
The main context file is `CLAUDE.md` in the repository root. This file provides:
- Project overview and philosophy
- Directory structure reference
- Development guidelines
- Application-specific context

### Agent Commands
| Command | Agent | Description |
|---------|-------|-------------|
| `/audit` | Organizational | Documentation and standards audit |
| `/plan` | Project Management | Task breakdown from PRD |
| `/status` | Status Update | Current project status |
| `/cos` | Chief of Staff | Synthesis and decision routing |
| `/security` | Security & Compliance | Security scan |
| `/improve` | Continuous Improvement | Process optimization analysis |

## Agent Workforce

### Core Agents (Always Active)
1. **Organizational Agent** - Documentation standards, data integrity
2. **Project Management Agent** - Task structuring, sprint planning
3. **Status Update Agent** - Progress tracking, risk flagging
4. **Chief of Staff Agent** - Global oversight, decision routing

### Strategic Agents
5. **Security & Compliance Agent** - Privacy, security audits
6. **Continuous Improvement Agent** - Process optimization

## Integration Points

### Current Integrations
- **GitHub**: Repository management (enabled)
- **Supabase**: Backend services (enabled)

### Planned Integrations
- **Notion**: Documentation sync (not yet configured)

## Usage

### For Claude Code
Claude Code automatically reads `CLAUDE.md` when working in this repository. The context file provides:
- Project structure and conventions
- Application-specific guidance
- Links to detailed documentation

### For Other AI Tools
Other AI tools (ChatGPT, Gemini, etc.) can be provided with:
1. The contents of `CLAUDE.md` for project context
2. Relevant agent definitions for specific workflows
3. PRD documents from `/docs/` for feature context

## Configuration

Edit `settings.json` to:
- Enable/disable agents
- Configure integration settings
- Set workflow triggers
- Customize preferences

## Related Documents
- [CLAUDE.md](../CLAUDE.md) - Main context file
- [PRD-unified-corporate-management.md](../docs/PRD-unified-corporate-management.md) - System PRD
- [BACKLOG.md](../BACKLOG.md) - Product roadmap
