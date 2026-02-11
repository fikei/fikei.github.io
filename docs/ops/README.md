# Ops & Infrastructure

> CI/CD, Notion sync, AI agents, deployment, and platform operations

---

## What it covers

Cross-cutting infrastructure that serves all products: deployment pipelines, Notion documentation sync, AI agent workforce, security, monitoring, and operational tooling.

## Supabase functions (Ops project)

| Function | Project | Purpose |
|----------|---------|---------|
| `notion-sync` | Ops | GitHub-to-Notion documentation sync |
| `agent-handler` | Ops | AI agent workforce orchestration |
| `documentation-agent` | Ops | Documentation management automation |

## Documentation

| File | Contents |
|------|----------|
| [`architecture.md`](architecture.md) | System-wide architecture overview |
| [`deployment.md`](deployment.md) | Deployment procedures |
| [`security.md`](security.md) | Security practices |
| [`monitoring.md`](monitoring.md) | Monitoring and observability |
| [`dependencies.md`](dependencies.md) | Third-party dependencies |
| [`risks.md`](risks.md) | Technical risks |
| [`costs.md`](costs.md) | Service cost tracking |
| [`bugs.md`](bugs.md) | Active bug registry (all products) |
| [`ops-changelog.md`](ops-changelog.md) | Operations changelog |

### Notion Sync

| File | Contents |
|------|----------|
| [`notion-sync/guide.md`](notion-sync/guide.md) | Sync setup and usage guide |
| [`notion-sync/bidirectional-sync.md`](notion-sync/bidirectional-sync.md) | Bidirectional sync spec |
| [`notion-sync/platform-prd.md`](notion-sync/platform-prd.md) | Notion sync platform PRD |

### AI Agents

Agent definitions live in [`/.claude/agents/`](../../.claude/agents/). See [`setup/ai-agent-system.md`](setup/ai-agent-system.md) for configuration.

### Setup & Onboarding

| File | Contents |
|------|----------|
| [`setup/ai-agent-system.md`](setup/ai-agent-system.md) | AI agent system setup |
