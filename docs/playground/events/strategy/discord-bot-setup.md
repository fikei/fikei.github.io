# Discord Events Bot — Setup Guide

## Overview

This connects the ctrl.rodeo Events app to Discord `#events` channels. A bot reads messages, AI extracts event details, and they show up in the calendar/list view.

**Architecture:** A GitHub Actions cron job refreshes the cache every 4 hours. Clients read from the server-side cache for instant responses — no Discord API latency for end users.

**Key files:**
- `supabase/functions/scrape-discord-events/index.ts` — Edge Function
- `supabase/migrations/010_discord_event_cache.sql` — Cache table
- `.github/workflows/refresh-discord-events.yml` — Cron workflow
- `events/index.html` — Client `fetchDiscord()` function

---

## Step 1: Create the Discord Bot Application

**Done.** Application ID: `1470922378652553371`

## Step 2: Enable MESSAGE CONTENT INTENT

**Done.** Enabled in Discord Developer Portal.

1. Go to [discord.com/developers/applications/1470922378652553371](https://discord.com/developers/applications/1470922378652553371)
2. **Bot** tab → Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT** (toggle ON)
3. Save changes

## Step 3: Set the Client ID in the App

**Done.** Client ID `1470922378652553371` is set in `events/index.html`.

The invite URL is:
```
https://discord.com/oauth2/authorize?client_id=1470922378652553371&scope=bot&permissions=68608
```

## Step 4: Store the Bot Token as a Supabase Secret

```bash
supabase link --project-ref yfhudwakpgzswiylhfbh
supabase secrets set DISCORD_BOT_TOKEN="your-bot-token-here"
```

## Step 5: Configure GitHub Repository Secrets

The scheduled cache refresh requires two GitHub repository secrets for the Actions workflow.

Go to: **https://github.com/fikei/fikei.github.io/settings/secrets/actions**

**Add these two secrets:**

1. **`SUPABASE_BOARDS_URL`**
   - Click **"New repository secret"**
   - Name: `SUPABASE_BOARDS_URL`
   - Value: `https://yfhudwakpgzswiylhfbh.supabase.co`
   - Click **"Add secret"**

2. **`SUPABASE_SERVICE_ROLE_KEY`**
   - Click **"New repository secret"**
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: Go to [Supabase Dashboard → Settings → API](https://supabase.com/dashboard/project/yfhudwakpgzswiylhfbh/settings/api) → under **Project API keys**, click **"Reveal"** next to `service_role` → copy that value
   - Click **"Add secret"**

**Verify:** Go to **Actions** tab → **"Refresh Discord Events Cache"** → click **"Run workflow"** → check output.

## Step 6: Deploy the Edge Function

```bash
supabase link --project-ref yfhudwakpgzswiylhfbh
supabase functions deploy scrape-discord-events
```

Verify it's running:
```bash
supabase functions list
```

## Step 7: Run the Database Migration

The cache table migration should already be applied. If not:

```bash
supabase link --project-ref yfhudwakpgzswiylhfbh
supabase db push --linked
```

This creates the `discord_event_cache` table with RLS policies.

## Step 8: Ask Admins to Invite the Bot

Send this to Gavin (gavaiken) or Charles (charles_irl):

---

> Hey! I built a calendar app that pulls events from different sources into one view. I'd love to add the `#events` channel as a source — a bot would read messages every few hours, auto-extract event details (dates, times, venues) using AI, and show them in a calendar view I can share a link to each week.
>
> **What I need from you:**
>
> 1. **Click this invite link** to add the bot:
>    `https://discord.com/oauth2/authorize?client_id=1470922378652553371&scope=bot&permissions=68608`
>
> 2. **Make sure the bot can see `#events`** — it just needs:
>    - View Channel
>    - Read Message History
>
> The bot is completely read-only — it just fetches messages periodically to extract event info. It never posts, reacts, or stores message content. Only the extracted event data (date, time, venue, etc.) is cached.
>
> Once the bot's in, I just need the **Server ID** and **Channel ID** (right-click → Copy ID with Developer Mode on).

---

## Step 9: Get Server & Channel IDs

Once the bot is invited, you need two IDs:

1. **Enable Developer Mode** in Discord: User Settings → Advanced → Developer Mode (toggle ON)
2. **Server ID**: Right-click the server name in the sidebar → "Copy Server ID"
3. **Channel ID**: Right-click `#events` → "Copy Channel ID"

## Step 10: Add the Source

Either:

**A) In the app UI:**
1. Open Events app → Add Source → Discord Channel tab
2. Paste the Server ID and Channel ID
3. Name it "Agape #events"
4. Pick category and region

**B) As a stock source** (hardcoded in `events/index.html`):

Add this to the `STOCK_SOURCES` array:

```javascript
{ id: 'discord-agape-events', name: 'Agape #events', category: 'other', type: 'discord', url: null, region: 'bay-area', description: 'House events from Discord', discord: { guildId: 'PASTE_SERVER_ID', channelId: 'PASTE_CHANNEL_ID', guildName: 'Agape', channelName: '#events' } },
```

## Step 11: Test

1. Open the Events app
2. Enable the Agape #events source
3. Check the debug log (bottom of page) for:
   - `Discord "Agape #events": X events (cached)` — if cache hit
   - `Discord "Agape #events": X events (live: scanned Y msgs, Z candidates)` — if cache miss
4. Events should appear in the calendar/list view

---

## Architecture: Scheduled Cache

```
GitHub Actions (every 4h)
  └─ POST { action: "refresh-all" }
       └─ Edge Function scrapes ALL cached channels
            └─ Writes to discord_event_cache table

Client opens app
  └─ POST { guildId, channelId }
       └─ Edge Function reads cache
            ├─ Fresh? → Return cached events instantly
            └─ Stale? → Scrape live → cache → return
```

**Cache TTL:** 4 hours (aligned with cron schedule)
**Cache table:** `discord_event_cache` (migration 010)
**Cron workflow:** `.github/workflows/refresh-discord-events.yml`

---

## Permissions Summary

| Permission | Bit | Why |
|---|---|---|
| View Channel | 1024 | See the #events channel |
| Send Messages | 2048 | Post weekly digest link (future) |
| Read Message History | 65536 | Fetch past messages |
| **Total** | **68608** | Used in OAuth2 invite URL |

**Additionally required (in Developer Portal, not the invite URL):**
- MESSAGE CONTENT INTENT — without this, message `content` field is empty

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| "Bot cannot access this channel" | Bot not invited or missing View Channel permission | Have admin re-check channel permissions |
| "DISCORD_BOT_TOKEN not configured" | Secret not set | Run `supabase secrets set DISCORD_BOT_TOKEN=...` |
| 0 events extracted from many messages | Messages are image-only flyers, or very short | Check debug log — candidates < threshold means messages didn't match heuristic |
| "MESSAGE_CONTENT intent required" | Intent not enabled in Developer Portal | Go to Bot tab → enable MESSAGE CONTENT INTENT |
| GitHub Actions cron fails | Missing repo secrets | Add `SUPABASE_BOARDS_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Settings → Secrets |
| "Unexpected end of JSON input" | Edge Function called with empty body | Fixed — function now returns 400 with clear error message |
| Cache returns stale events | Cron not running or secrets missing | Check Actions tab → Refresh Discord Events Cache → recent runs |
