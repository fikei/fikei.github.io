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
| `systemic-analyze` | Systemic | Design system analysis | Previous |
| `systemic-fetch` | Systemic | Design system data fetching | Previous |
| `recruit-gmail` | Boards | Shared-inbox applicant email pipe + availability extraction + Discord claim posts | — |
| `recruit-availability` | Boards | Public applicant schedule picker backend (schedule_token auth) | — |
| `recruit-discord` | Boards | Discord interactions endpoint for screening-claim buttons | — |

**Intro Call recording (Recall.ai):** optional; enabled by setting `RECALL_API_KEY` (Boards project). When set, `scheduleScreening` sends an "Agape Notes" bot to each Meet at start time; the 15-min recruit-discord cron tick harvests finished recordings, summarizes the transcript with Haiku, posts notes + recording link to #recruiting-society (`1503490895469609211`; `SCREENING_NOTES_CHANNEL_ID` overrides), and stores the summary on `recruit_screenings.recording_summary`. `RECALL_API_BASE` overrides the region (default us-west-2).

**recruit-discord setup:** point the Discord application's *Interactions Endpoint URL* at `https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-discord`. It verifies Ed25519 request signatures using the app's `verify_key`, fetched at runtime via `DISCORD_BOT_TOKEN` (`DISCORD_PUBLIC_KEY` env overrides). Claim posts go to `#recruiting-interviews` (`1529576830514762029`; `SCREENING_CLAIMS_CHANNEL_ID` env overrides). No extra secrets required.

---

## GitHub Actions: Automation

### Workflow: `scrape-events.yml`

The only active workflow — scheduled event scraping for the Events pipeline. Trigger manually with `gh workflow run scrape-events.yml`.

> **Deprecated (2026-07-29):** `agent-automation.yml` (AI Agent Workforce + Notion sync) was removed. The notion-sync job had been failing (dead Ops Supabase host), and the remaining jobs only emitted logs or auto-filed noise issues. The `notion-sync` edge function and `notion-structure.json` were removed with it; the sync guide is archived at `archive/NOTION-SYNC-GUIDE.md`. Doc workflows now run in Claude Code sessions directly.

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
| `ANTHROPIC_API_KEY` | enrich-link, generate-widget, categorize, agent-handler (shared fallback; console key `taste-graph`) |
| `EVENTS_ANTHROPIC_API_KEY` | enrich-event, scrape-discord-events, recommend-events, add-event (console key `events-pipeline`; falls back to `ANTHROPIC_API_KEY` if unset) |
| `LADDER_ANTHROPIC_API_KEY` | Ladder functions (console key `ladder-jobs`; falls back to `ANTHROPIC_API_KEY` if unset) |
| `OPENAI_API_KEY` | generate-widget (fallback) |
| `SUPABASE_URL` | All functions (auto-set by Supabase) |
| `SUPABASE_SERVICE_ROLE_KEY` | enrich-link (bypasses RLS) |

### GitHub Actions

Set in repository Settings → Secrets. The `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `NOTION_API_KEY` / `ANTHROPIC_API_KEY` secrets were used by the removed `agent-automation.yml` workflow and can be deleted from repo settings.

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
