# Claude Code Context System

Configuration and context files for Claude Code and AI development tools.

## Directory Structure

```
.claude/
├── README.md           # This file
├── settings.json       # Claude Code configuration
└── agents/             # AI agent definitions
    ├── AGENT-DEFINITION.md          # Consolidated agent identity + behavioral rules
    ├── documentation-agent.md       # /plan /arch /capture /ux /branch /cleanup /pm
    ├── documentation-sync-agent.md  # Notion sync rules
    ├── organizational-agent.md      # Standards and audit
    ├── project-management-agent.md  # Work breakdown
    ├── status-update-agent.md       # Progress tracking
    ├── chief-of-staff-agent.md      # Orchestration + decisions
    ├── security-compliance-agent.md # Security scans
    └── continuous-improvement-agent.md # Process optimization
```

## How It Works

- `CLAUDE.md` (repo root) is loaded automatically every session — behavioral rules + essential context
- Agent `.md` files are loaded on demand when their slash commands are invoked
- `settings.json` configures agent enables, triggers, and preferences

## Agent Commands

| Command | Agent | Description |
|---------|-------|-------------|
| `/plan` | Documentation | Project plan management |
| `/arch` | Documentation | Architecture doc sync |
| `/capture` | Documentation | Log bugs, work, tech debt |
| `/ux` | Documentation | UX documentation |
| `/branch` | Documentation | Cross-branch doc diff |
| `/cleanup` | Documentation | Documentation hygiene |
| `/pm` | Documentation | Program management |

## Related
- [CLAUDE.md](../CLAUDE.md) — Main context file (behavioral rules)
- [Agent Definition](./.claude/agents/AGENT-DEFINITION.md) — Consolidated agent identity
- [Documentation Agent](./agents/documentation-agent.md) — Full command specs
