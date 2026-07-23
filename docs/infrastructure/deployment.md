# Deployment Guide

> How code gets from repository to production

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Developer  │────▶│   GitHub     │────▶│  GitHub      │
│   git push   │     │   Repository │     │  Pages       │
└──────────────┘     └──────┬───────┘     │  (ctrl.rodeo)│
                            │             └──────────────┘
                            │
                            ▼
                     ┌──────────────┐     ┌──────────────┐
                     │   GitHub     │────▶│  Supabase    │
                     │   Actions    │     │  (Notion     │
                     │              │     │   sync)      │
                     └──────────────┘     └──────────────┘

┌──────────────┐     ┌──────────────┐
│   Developer  │────▶│  Supabase    │
│   supabase   │     │  Edge        │
│   functions  │     │  Functions   │
│   deploy     │     │              │
└──────────────┘     └──────────────┘
```

There are two independent deployment paths:
1. **Frontend** (automatic): Push to `main` → GitHub Pages builds and serves
2. **Edge Functions** (manual): `supabase functions deploy` from local machine

---

## Frontend: GitHub Pages

### How It Works

GitHub Pages runs Jekyll on every push to `main`, converting the repo into a static site served at `ctrl.rodeo`.

| Setting | Value |
|---------|-------|
| Source branch | `main` |
| Custom domain | ctrl.rodeo (via CNAME file) |
| HTTPS | Enforced (GitHub automatic) |
| Build | Jekyll (minimal theme) |
| Config | `_config.yml`: `theme: jekyll-theme-minimal` |

### Deploy

```bash
git push origin main
```

That's it. GitHub Pages builds automatically. No manual steps.

### Local Preview

```bash
bundle install
bundle exec jekyll serve
# → http://localhost:4000
```

### Rollback

```bash
git revert HEAD
git push origin main
```

---

## Edge Functions: Supabase

### How It Works

Edge functions are TypeScript files in `supabase/functions/`. They run on Deno and are deployed manually via the Supabase CLI. There's no CI/CD for function deployment.

### Prerequisites

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Link to project (one-time per project)
supabase link --project-ref yfhudwakpgzswiylhfbh  # Boards
supabase link --project-ref ycilriwjnmcelkspmfmg  # Ops
```

### Deploy Functions

```bash
# Boards project functions
supabase link --project-ref yfhudwakpgzswiylhfbh
supabase functions deploy enrich-link
supabase functions deploy generate-widget
supabase functions deploy categorize

# Recruiting (Agape) functions — Boards project
supabase functions deploy recruit-gmail
supabase functions deploy recruit-availability --no-verify-jwt   # public schedule-token picker
supabase functions deploy recruit-discord --no-verify-jwt        # Discord interactions (Ed25519-signed)

# Ops project functions
supabase link --project-ref ycilriwjnmcelkspmfmg
supabase functions deploy notion-sync

# Systemic project functions
supabase link --project-ref atdqdfpdeytfuvvpsasz
supabase functions deploy systemic-analyze
supabase functions deploy systemic-fetch
```

### Set Secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set NOTION_API_KEY=ntn_...
```

### View Logs

```bash
supabase functions logs enrich-link --tail
supabase functions logs generate-widget --tail
supabase functions logs notion-sync --tail
```

### Function Rollback

```bash
git checkout HEAD~1 -- supabase/functions/{function-name}
supabase functions deploy {function-name}
```

### Current Functions

| Function | Project | Purpose | Last Deploy |
|----------|---------|---------|-------------|
| `enrich-link` | Boards | AI classification + image resolution | Previous |
| `generate-widget` | Boards | AI widget generation | 2026-02-05 |
| `categorize` | Boards | AI pin categorization | Previous |
| `agent-handler` | Boards | AI agent orchestration | 2026-02-04 |
| `notion-sync` | Ops | GitHub ↔ Notion documentation sync | 2026-02-04 |
| `systemic-analyze` | Systemic | Design system analysis | Previous |
| `systemic-fetch` | Systemic | Design system data fetching | Previous |
| `recruit-gmail` | Boards | Shared-inbox applicant email pipe + availability extraction + Discord claim posts | — |
| `recruit-availability` | Boards | Public applicant schedule picker backend (schedule_token auth) | — |
| `recruit-discord` | Boards | Discord interactions endpoint for screening-claim buttons | — |

**recruit-discord setup:** point the Discord application's *Interactions Endpoint URL* at `https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-discord`. It verifies Ed25519 request signatures using the app's `verify_key`, fetched at runtime via `DISCORD_BOT_TOKEN` (`DISCORD_PUBLIC_KEY` env overrides). Claim posts go to `#recruiting-interviews` (`1529576830514762029`; `SCREENING_CLAIMS_CHANNEL_ID` env overrides). No extra secrets required.

---

## GitHub Actions: Automation

### Workflow: `agent-automation.yml`

A single workflow file (881 lines) handles all automation.

| Trigger | What Runs |
|---------|-----------|
| Push to `main`, `master`, `claude/*` | Notion sync (structure + content), security scan |
| Pull request opened/synced | Documentation standards check |
| Daily (9 AM UTC) | Chief of Staff synthesis issue |
| Weekly (Friday 4 PM UTC) | Continuous improvement analysis issue |
| Manual dispatch | Run specific agent |

### Key Jobs

**notion-sync** — The most complex job. On every push:
1. Checks out repo with `depth=2` (for `git diff`)
2. Detects changed `.md` files
3. Syncs page structure to Notion (creates/deletes pages)
4. Cleans up orphaned Notion pages (AI-created only)
5. Syncs changed file contents (SHA-256 hash comparison, retry with backoff)

**on-push** — Security scan: greps for hardcoded secrets in `supabase/` and `.env` files.

**on-pull-request** — Checks PR description length, looks for PRD links.

### Required Secrets

| Secret | Purpose | Set In |
|--------|---------|--------|
| `SUPABASE_URL` | Ops project URL | GitHub Secrets |
| `SUPABASE_SERVICE_KEY` | Full-access key for sync | GitHub Secrets |
| `NOTION_API_KEY` | Notion integration token | GitHub Secrets |
| `ANTHROPIC_API_KEY` | Claude API (for agents) | GitHub Secrets |

---

## Database Migrations

Migrations are SQL files in `supabase/migrations/`. They're applied manually via the Supabase dashboard or CLI.

```bash
# Apply migrations (if using local dev)
supabase db push

# Or apply via dashboard: SQL Editor → paste migration content
```

| Migration | File | Tables |
|-----------|------|--------|
| 001 | `001_shared_boards.sql` | shared_boards, board_views, board_invites |
| 002 | `002_*.sql` | shared_boards alterations |
| 003 | `003_content_type_system.sql` | content_types, domain_profiles, classification_log |
| 004 | `004_image_resolution_system.sql` | image_strategies, strategy_performance |
| 005 | `005_systemic_ai.sql` | audit_jobs, design_systems, design_tokens, etc. |
| 006 | `006_notion_sync_state.sql` | sync_state, block_state, sync_log, structure_state |

See [Database Schema](./technical-design/database-schema.md) for full table definitions.

---

## Environment Variables

### Edge Functions (Deno)

Accessed via `Deno.env.get('KEY')`:

| Variable | Required By |
|----------|-------------|
| `ANTHROPIC_API_KEY` | enrich-link, generate-widget, categorize, agent-handler |
| `OPENAI_API_KEY` | generate-widget (fallback) |
| `SUPABASE_URL` | All functions (auto-set by Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | enrich-link, notion-sync (bypasses RLS) |
| `NOTION_API_KEY` | notion-sync |

### GitHub Actions

Set in repository Settings → Secrets:

| Variable | Required By |
|----------|-------------|
| `SUPABASE_URL` | notion-sync job |
| `SUPABASE_SERVICE_KEY` | notion-sync job |
| `NOTION_API_KEY` | notion-sync job |
| `ANTHROPIC_API_KEY` | agent jobs |

### Client-Side

Hardcoded in `boards/index.html` (public, by design):

| Variable | Value | Purpose |
|----------|-------|---------|
| `SUPABASE_URL` | `https://yfhudwakpgzswiylhfbh.supabase.co` | API endpoint |
| `SUPABASE_ANON_KEY` | JWT (anon role) | Public API access (RLS enforced) |

---

## Monitoring

| Service | How to Monitor |
|---------|---------------|
| GitHub Pages | `ctrl.rodeo` responds with 200 |
| Supabase Functions | `supabase functions logs {name} --tail` |
| Supabase Database | Supabase Dashboard → Database |
| GitHub Actions | Repository → Actions tab |
| Notion Sync | `sync_log` table in Ops database |

---

*Last updated: 2026-02-05*
