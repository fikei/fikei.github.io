# Discord Events Bot — Setup Guide

## Overview

This connects the ctrl.rodeo Events app to the Agape Discord `#events` channel. A bot reads messages, AI extracts event details, and they show up in the calendar/list view.

---

## Step 1: Create the Discord Bot Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **"New Application"** → name it `ctrl.rodeo events` (or whatever you like)
3. Go to **Bot** tab in the left sidebar
4. Click **"Reset Token"** → copy the token (you'll need it once)
5. Under **Privileged Gateway Intents**, enable **MESSAGE CONTENT INTENT** (toggle ON)
6. Save changes

**Copy these two values:**
- **Application ID** (on the General Information page, also called "Client ID")
- **Bot Token** (from step 4)

## Step 2: Set the Client ID in the App

In `events/index.html`, find this line near the top of the `<script>`:

```javascript
const DISCORD_BOT_CLIENT_ID = ''; // TODO: set after creating bot application
```

Paste your Application ID:

```javascript
const DISCORD_BOT_CLIENT_ID = '1234567890123456789';
```

This generates the invite URL that admins will use to add the bot.

## Step 3: Store the Bot Token as a Supabase Secret

```bash
supabase link --project-ref yfhudwakpgzswiylhfbh
supabase secrets set DISCORD_BOT_TOKEN="your-bot-token-here"
```

## Step 4: Deploy the Edge Function

```bash
supabase functions deploy scrape-discord-events
```

Verify it's running:
```bash
supabase functions list
```

## Step 5: Ask Admins to Invite the Bot

Send this to Gavin (gavaiken) or Charles (charles_irl):

---

> **Message to admins:**
>
> Hey! I built a calendar app that pulls events from different sources into one view. I'd love to add our `#events` channel as a source — it would scrape the messages and auto-extract event details (dates, times, venues) so we have a nice calendar/list view I can share a link to each week.
>
> To make it work I need you to:
>
> 1. **Click this invite link** to add my bot to the server:
>    `https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=68608`
>    (replace YOUR_CLIENT_ID with your actual Application ID)
>
> 2. **Make sure the bot can see `#events`** — it needs:
>    - View Channel
>    - Read Message History
>    - Send Messages (for posting the weekly digest link)
>
> The bot is read-only by default — it just fetches messages when I refresh the app. It doesn't post anything unless I add a weekly digest feature later. It also doesn't store any messages — just extracts event info (date, time, venue, etc.) and discards the rest.
>
> That's it! Once the bot is in, I just need the Server ID and `#events` Channel ID (right-click → Copy ID with Developer Mode on).

---

## Step 6: Get Server & Channel IDs

Once the bot is invited, you need two IDs:

1. **Enable Developer Mode** in Discord: User Settings → Advanced → Developer Mode (toggle ON)
2. **Server ID**: Right-click the server name in the sidebar → "Copy Server ID"
3. **Channel ID**: Right-click `#events` → "Copy Channel ID"

## Step 7: Add the Source

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

## Step 8: Test

1. Open the Events app
2. Enable the Agape #events source
3. Check the debug log (bottom of page) for:
   - `Discord "Agape #events": scanned X msgs, Y candidates, Z events`
4. Events should appear in the calendar/list view

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
