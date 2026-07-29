# AI Agent System Setup Guide

This guide walks you through setting up the unified corporate management system with AI agent workforce.

## Overview

The system consists of:
1. **Claude Code Context** - Automatic context for AI development tools
2. **AI Agent Workforce** - 6 specialized agents for automated management
3. **Notion Integration** - Bidirectional sync for documentation
4. **GitHub Automation** - Workflows triggered by repository events

---

## Phase 1: Prerequisites (You Do This)

### Step 1.1: Gather API Keys

You'll need the following API keys/tokens:

| Service | Purpose | Where to Get |
|---------|---------|--------------|
| Notion | Documentation sync | [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| Anthropic | Claude AI access | [console.anthropic.com](https://console.anthropic.com/) |
| OpenAI | Fallback AI | [platform.openai.com](https://platform.openai.com/) |
| Supabase | Backend services | Already configured in your project |

### Step 1.2: Create Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"+ New integration"**
3. Configure:
   - Name: `ctrl-rodeo-agent`
   - Logo: Optional
   - Associated workspace: Your workspace
   - Capabilities:
     - [x] Read content
     - [x] Update content
     - [x] Insert content
4. Click **"Submit"**
5. Copy the **Internal Integration Token** (starts with `secret_`)

### Step 1.3: Set Up Notion Workspace Structure

Create this page structure in Notion:

```
📁 ctrl.rodeo (root page)
├── 📋 Strategic Planning
│   ├── PRDs
│   ├── Vision Docs
│   └── Roadmaps
├── 🛠 Product & Development
│   ├── Technical Plans
│   ├── Sprint Backlog
│   └── Vibe Coding Notes
├── 📅 Operations
│   ├── Calendar
│   └── Admin Docs
└── 🤝 Cross-Functional
    ├── Status Updates
    └── Meeting Notes
```

**Important**: Share each page with your integration:
1. Open each root page (Strategic Planning, Product & Development, etc.)
2. Click **"..."** menu → **"Add connections"**
3. Select **"ctrl-rodeo-agent"**

### Step 1.4: Get Notion Page IDs

For each main page, get the page ID:
1. Open the page in Notion
2. Click **"Share"** → **"Copy link"**
3. The URL looks like: `notion.so/Your-Page-Title-abc123def456`
4. The page ID is the last part: `abc123def456`

Record these IDs:
- Strategic Planning: `________________`
- Product & Development: `________________`
- Operations: `________________`
- Cross-Functional: `________________`

---

## Phase 2: Configure Environment (You Do This)

### Step 2.1: Create Environment File

Copy the template and fill in your values:

```bash
cp .env.template .env.local
```

Edit `.env.local` with your values (see template for required fields).

### Step 2.2: Add GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `NOTION_API_KEY` | Your Notion integration token |
| `NOTION_ROOT_PAGE_ID` | Main ctrl.rodeo page ID |
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `OPENAI_API_KEY` | Your OpenAI API key (optional) |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Your Supabase service role key |

### Step 2.3: Update Claude Settings

Edit `.claude/settings.json` and update the Notion configuration:

```json
{
  "integrations": {
    "notion": {
      "enabled": true,
      "workspaceId": "YOUR_WORKSPACE_ID",
      "syncEnabled": true,
      "pages": {
        "strategic": "PAGE_ID_HERE",
        "development": "PAGE_ID_HERE",
        "operations": "PAGE_ID_HERE",
        "crossFunctional": "PAGE_ID_HERE"
      }
    }
  }
}
```

---

## Phase 3: Deploy Edge Functions (Automated + You Verify)

### Step 3.1: Deploy Agent Handler

The agent handler edge function processes webhook events:

```bash
supabase functions deploy agent-handler
```

### Step 3.2: Verify Deployment

```bash
supabase functions list
```

You should see `agent-handler` in the list.

### Step 3.3: Set Function Secrets

```bash
supabase secrets set NOTION_API_KEY=your_notion_key
supabase secrets set ANTHROPIC_API_KEY=your_anthropic_key
```

---

## Phase 4: Enable GitHub Actions (Automated)

The GitHub Actions workflow is already created at `.github/workflows/agent-automation.yml`.

### What It Does:
- **On Push**: Triggers Status Update and Security agents
- **On PR**: Triggers Organizational and Project Management agents
- **Daily**: Runs Chief of Staff synthesis
- **Weekly**: Runs Continuous Improvement analysis

### Step 4.1: Verify Actions Are Enabled

1. Go to your GitHub repo → Actions tab
2. If prompted, click **"I understand my workflows, go ahead and enable them"**
3. You should see "AI Agent Automation" workflow

---

## Phase 5: Test the System (You Do This)

### Test 1: Claude Code Context

1. Open the repository in your terminal
2. Run Claude Code: `claude`
3. Ask: "What is this project about?"
4. Claude should reference the CLAUDE.md context

### Test 2: Agent Commands

In Claude Code, try these commands:
- `/status` - Should describe current project status
- `/audit` - Should check documentation standards
- `/security` - Should scan for security issues

### Test 3: Notion Sync

1. Create a test PRD in Notion under "Strategic Planning → PRDs"
2. Wait 5 minutes (or trigger manual sync)
3. Check if `docs/PRD-*.md` has new file

### Test 4: GitHub Actions

1. Make a small commit and push
2. Go to Actions tab
3. Verify "AI Agent Automation" workflow runs

---

## Phase 6: Ongoing Usage

### Daily Workflow

1. **Morning**: Check Chief of Staff daily synthesis in Notion
2. **During Work**: Use `/status` to track progress
3. **On Changes**: Agents auto-audit documentation and security

### Weekly Workflow

1. **Friday**: Review Continuous Improvement report
2. **Sprint Planning**: Use `/plan` to break down PRDs
3. **Retrospective**: Check agent-generated insights

### Agent Commands Reference

| Command | When to Use |
|---------|-------------|
| `/audit` | After major documentation changes |
| `/plan` | When starting new feature from PRD |
| `/status` | Anytime you need project overview |
| `/cos` | For complex decisions needing synthesis |
| `/security` | Before deployments, after dependency updates |
| `/improve` | During retrospectives, process reviews |

---

## Troubleshooting

### Notion Sync Not Working

1. Check integration has access to pages
2. Verify API key is correct
3. Check Supabase function logs: `supabase functions logs agent-handler`

### GitHub Actions Failing

1. Check all secrets are set correctly
2. Review action logs for specific errors
3. Ensure branch protections allow actions

### Claude Code Not Reading Context

1. Verify CLAUDE.md exists in repo root
2. Check you're in the correct directory
3. Try: `cat CLAUDE.md` to verify file contents

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────┐
│                        User/Developer                        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code CLI                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  CLAUDE.md  │  │   /agents   │  │  settings   │          │
│  │   Context   │  │ Definitions │  │    .json    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Actions                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              agent-automation.yml                    │    │
│  │  • On push → Status + Security agents               │    │
│  │  • On PR → Organizational + PM agents               │    │
│  │  • Daily → Chief of Staff synthesis                 │    │
│  │  • Weekly → Continuous Improvement                  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Supabase Edge Functions                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   agent-    │  │   notion-   │  │  generate-  │          │
│  │   handler   │  │    sync     │  │   widget    │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Services                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │   Notion    │  │   Claude    │  │   OpenAI    │          │
│  │     API     │  │     API     │  │     API     │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## Next Steps After Setup

1. **Customize Agent Prompts**: Edit files in `.claude/agents/` to match your workflow
2. **Add More Integrations**: Slack notifications, calendar sync, etc.
3. **Create Custom Commands**: Add new commands in `.claude/settings.json`
4. **Train on Your Data**: Feed historical project data to improve agent responses
