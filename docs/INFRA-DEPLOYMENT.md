# Deployment Guide

> How to deploy and manage ctrl.rodeo infrastructure

---

## Status Legend

| Icon | Meaning |
|------|---------|
| ✅ | Configured |
| 🔄 | Needs Update |
| ⏳ | Not Set Up |

---

## Environments

| Environment | URL | Purpose | Status |
|-------------|-----|---------|--------|
| Production | ctrl.rodeo | Live site | ✅ |
| Preview | GitHub PR previews | Testing | ✅ |
| Local | localhost:4000 | Development | ✅ |

---

## GitHub Pages (Frontend)

### Automatic Deployment

Pushes to `main` automatically deploy via GitHub Pages.

```bash
# Local preview
bundle install
bundle exec jekyll serve

# Manual deploy (just push to main)
git push origin main
```

### Configuration

| Setting | Value | Status |
|---------|-------|--------|
| Source branch | main | ✅ |
| Custom domain | ctrl.rodeo | ✅ |
| HTTPS | Enforced | ✅ |

---

## Supabase Functions

### Deploy All Functions

```bash
cd /Users/ian/Documents/GitHub/fikei.github.io
supabase functions deploy agent-handler
supabase functions deploy notion-sync
supabase functions deploy enrich-link
supabase functions deploy generate-widget
```

### Set Secrets

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set NOTION_API_KEY=ntn_...
supabase secrets set OPENAI_API_KEY=sk-...
```

### Function Status

| Function | Last Deploy | Status |
|----------|-------------|--------|
| agent-handler | 2026-02-04 | ✅ |
| notion-sync | 2026-02-04 | ✅ |
| enrich-link | Previous | ✅ |
| generate-widget | Previous | ✅ |

---

## GitHub Actions

### Workflows

| Workflow | Trigger | Status |
|----------|---------|--------|
| agent-automation | Push, PR, Schedule | ✅ |

### Secrets Required

| Secret | Purpose | Status |
|--------|---------|--------|
| NOTION_API_KEY | Notion sync | ✅ |
| ANTHROPIC_API_KEY | Claude AI | ✅ |
| SUPABASE_URL | API endpoint | ⏳ |
| SUPABASE_ANON_KEY | API auth | ⏳ |

---

## Notion Sync

### Manual Sync

```bash
cd /Users/ian/Documents/GitHub/fikei.github.io
export NOTION_API_KEY=ntn_...
./scripts/sync-docs-to-notion.sh
```

### Automatic Sync (Planned)

Add to GitHub Actions to sync on every push.

---

## Monitoring

### Current Status

| Service | Monitoring | Status |
|---------|------------|--------|
| GitHub Pages | GitHub Status | ✅ |
| Supabase | Dashboard | ✅ |
| Functions | Supabase Logs | ✅ |

### Health Checks

| Endpoint | Expected | Status |
|----------|----------|--------|
| ctrl.rodeo | 200 | ✅ |
| ctrl.rodeo/boards | 200 | ✅ |
| Supabase functions | 200 | ✅ |

---

## Rollback Procedures

### Frontend Rollback

```bash
# Revert to previous commit
git revert HEAD
git push origin main
```

### Function Rollback

```bash
# Deploy previous version
git checkout HEAD~1 -- supabase/functions/[function-name]
supabase functions deploy [function-name]
```

---

*Last updated: 2026-02-04*
