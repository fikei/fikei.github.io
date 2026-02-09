# Product Requirements Document

## Events — Discord Channel Event Source

**Version:** 1.0
**Status:** Draft
**Last Updated:** 2026-02-08
**Depends On:** Events Aggregator (`/events/`), Supabase Boards project (`yfhudwakpgzswiylhfbh`)

---

## 1. Executive Summary

The Events app currently aggregates events from structured sources — HTML tables (19hz), RSS feeds, iCal files, and JSON APIs. Discord servers are where many communities post events as free-form text messages ("Show this Friday at 8pm at The Chapel, $20, all ages"). These events are invisible to the aggregator today.

Discord Channel Source adds a new source type (`discord`) that lets users select a Discord channel, scrapes its messages, and uses AI to extract structured event data from free-form text. This closes the gap between where events are *announced* (Discord) and where users want to *find* them (the Events app).

### Core Principles

1. **AI-first extraction** — LLM parses free-form messages into structured events; regex/dateparser as validation layer
2. **Bot-based, not self-bot** — Uses a proper Discord bot with `MESSAGE_CONTENT` privileged intent (compliant with Discord TOS)
3. **Same event model** — Discord events output the identical `{ date, time, name, venue, ... }` shape as all other sources
4. **Server-side processing** — Scraping and AI extraction happen in a Supabase Edge Function, not client-side

---

## 2. Problem Statement

Communities that organize events on Discord post announcements in dedicated channels (e.g., `#events`, `#shows`, `#meetups`). These posts are unstructured — a mix of dates, venues, lineups, prices, and links in natural language, sometimes with images or embeds.

Today, users who want to see these events in the aggregator have no option. The app only supports sources that serve structured data over HTTP.

### What Exists Today

| Source Type | Parser | Runs On | Example |
|---|---|---|---|
| `html` | Table scraper + column mapping | Client (browser) | 19hz.info |
| `rss` | Feed XML parser | Client (browser) | Roxie Theater |
| `ical` | iCalendar parser | Client (browser) | Any .ics file |
| `json` | JSON array/object | Client (browser) | APIs |
| **`discord`** | **Does not exist** | — | — |

### Why This Is Different

Discord sources are fundamentally different from the existing types:

1. **Authentication required** — Discord API requires a bot token; can't be fetched through CORS proxies
2. **Unstructured content** — Messages are free-form text, not tables or feeds
3. **AI extraction needed** — No deterministic parser can handle the variety of formats
4. **Server-side only** — Bot token must never reach the client; extraction must happen in a Supabase Edge Function
5. **Rate-limited** — Discord API has rate limits (50 req/s global); needs respectful polling, not real-time

---

## 3. Feature Specification

### 3.1 User Flow

#### Adding a Discord Source

1. User clicks **"Add Source"** in the Events app
2. In the source type selector, user chooses **"Discord Channel"**
3. App presents a form:
   - **Server invite link or ID** — User pastes a Discord server invite URL or server ID
   - **Channel name** — Dropdown or text input to select the channel (e.g., `#events`)
   - **Category** — User picks: Music, Comedy, Film, Theater, Other
   - **Region** — User selects from existing regions
4. App validates the input (server exists, bot has access, channel is readable)
5. Source is saved to the user's source list with `type: 'discord'`

#### Fetching Events

1. When the aggregator refreshes, Discord sources call the Supabase Edge Function instead of using CORS proxies
2. The Edge Function:
   a. Authenticates with the Discord API using the bot token
   b. Fetches recent messages from the specified channel (last 7 days, up to 200 messages)
   c. Filters to messages likely containing events (heuristic pre-filter)
   d. Sends candidate messages to Claude Haiku for structured extraction
   e. Returns an array of events in the standard event model
3. Client receives events and merges them into `state.events[]` like any other source

### 3.2 Source Schema Extension

```javascript
// Existing source shape (unchanged)
{
  id: string,
  name: string,
  category: string,     // 'music', 'comedy', 'film', 'theater', 'other'
  type: string,         // 'html', 'rss', 'ical', 'json', 'auto'
  url: string,
  region: string,
  description: string,
  enabled: boolean,
}

// New Discord source shape
{
  id: string,           // e.g., 'discord-{guildId}-{channelId}'
  name: string,         // e.g., 'SF Music Events (Discord)'
  category: string,     // user-selected
  type: 'discord',      // new type
  url: null,            // not applicable
  region: string,       // user-selected
  description: string,  // auto-generated or user-provided
  enabled: boolean,

  // Discord-specific fields
  discord: {
    guildId: string,      // Discord server ID
    channelId: string,    // Channel ID to scrape
    guildName: string,    // Display name (fetched from API)
    channelName: string,  // Display name (fetched from API)
  }
}
```

### 3.3 Event Data Model

Discord-extracted events use the same model as all other sources. No changes to the event schema.

```javascript
{
  date: string,         // YYYY-MM-DD (extracted by AI)
  time: string,         // HH:MM or range (extracted by AI)
  name: string,         // Event title (extracted by AI)
  venue: string,        // Venue name (extracted by AI)
  address: string,      // Street address if mentioned
  city: string,         // City (extracted or inferred from channel context)
  genre: string,        // Tags (extracted by AI)
  price: string,        // Price info (extracted by AI)
  ages: string,         // Age restriction if mentioned
  promoter: string,     // Organizer if mentioned
  url: string,          // Link from message, or Discord message permalink
  source: string,       // Source ID (discord-{guildId}-{channelId})
  contentType: string,  // From source category
}
```

---

## 4. Technical Architecture

### 4.1 System Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  Client (Events App)                                             │
│                                                                  │
│  state.sources[] ──► fetchAllSourcesNetwork()                    │
│       │                    │                                     │
│       │  type=html/rss/... │  type=discord                       │
│       │         │          │         │                            │
│       │    proxyFetch()    │    fetchDiscord()                    │
│       │         │          │         │                            │
│       │   CORS proxies     │   Supabase Edge Function            │
│       │         │          │         │                            │
│       └─────────┴──────────┴─────────┘                           │
│                     │                                            │
│              state.events[] ──► render()                         │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: scrape-discord-events                   │
│                                                                  │
│  1. Receive { guildId, channelId } from client                   │
│  2. Fetch messages from Discord API (bot token in env)           │
│  3. Pre-filter messages (heuristic: date-like patterns)          │
│  4. Batch to Claude Haiku for structured extraction              │
│  5. Validate + deduplicate extracted events                      │
│  6. Return events[] in standard schema                           │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Supabase Edge Function: `scrape-discord-events`

**Project:** Boards (`yfhudwakpgzswiylhfbh`)
**Runtime:** Deno (TypeScript)
**Secrets:** `DISCORD_BOT_TOKEN`, `ANTHROPIC_API_KEY`

#### Endpoint

```
POST /functions/v1/scrape-discord-events
Authorization: Bearer <supabase-anon-key>
Content-Type: application/json

{
  "guildId": "123456789",
  "channelId": "987654321",
  "lookbackDays": 7        // optional, default 7, max 30
}
```

#### Response

```json
{
  "events": [
    {
      "date": "2026-02-14",
      "time": "20:00",
      "name": "Valentine's Day Show w/ DJ Shadow",
      "venue": "The Chapel",
      "address": "777 Valencia St",
      "city": "San Francisco",
      "genre": "electronic, DJ",
      "price": "$25",
      "ages": "21+",
      "promoter": "",
      "url": "https://discord.com/channels/123/987/111222333"
    }
  ],
  "meta": {
    "messagesScanned": 147,
    "candidateMessages": 23,
    "eventsExtracted": 12,
    "lookbackDays": 7
  }
}
```

### 4.3 Discord Bot Setup

A Discord bot application is required. It does **not** need to be online/running — it only needs a valid token with the right permissions.

#### Required Bot Permissions

| Permission | Why |
|---|---|
| `VIEW_CHANNEL` | See the target channel |
| `READ_MESSAGE_HISTORY` | Fetch past messages |

#### Required Privileged Intent

| Intent | Why | Approval |
|---|---|---|
| `MESSAGE_CONTENT` | Read message text (not just metadata) | Auto-granted for bots in <100 servers; requires Discord review for 100+ |

#### Bot Setup Steps

1. Create application at [discord.com/developers](https://discord.com/developers/applications)
2. Create bot user under the application
3. Enable `MESSAGE_CONTENT` intent in Bot settings
4. Generate bot token → store as Supabase secret
5. Generate OAuth2 invite URL with `bot` scope + `View Channels` + `Read Message History` permissions
6. Users invite the bot to their server using the invite URL

### 4.4 Message Fetching Strategy

#### Discord API: Get Channel Messages

```
GET https://discord.com/api/v10/channels/{channelId}/messages
Authorization: Bot {DISCORD_BOT_TOKEN}
Query: ?limit=100&after={snowflake}
```

- Returns max 100 messages per request
- Paginate with `after` parameter (oldest-first) or `before` (newest-first)
- For 7-day lookback: calculate the snowflake timestamp for 7 days ago, use as `after`

#### Snowflake Timestamp Calculation

Discord IDs encode timestamps. To get the snowflake for a specific time:

```typescript
function dateToSnowflake(date: Date): string {
  const DISCORD_EPOCH = 1420070400000n; // Jan 1, 2015
  const timestamp = BigInt(date.getTime()) - DISCORD_EPOCH;
  return (timestamp << 22n).toString();
}
```

#### Rate Limiting

- Discord allows ~50 requests/second globally
- Channel messages endpoint: 5 requests/5 seconds/channel
- Implement exponential backoff on 429 responses
- For 200 messages (2 pages): well within limits

### 4.5 Pre-Filtering Heuristic

Not every message in a channel is an event announcement. Before sending to AI, apply a lightweight heuristic filter to reduce token usage and cost.

#### Heuristic: Score each message 0–10

| Signal | Score | Pattern |
|---|---|---|
| Contains a date pattern | +3 | `\d{1,2}/\d{1,2}`, `(Jan|Feb|Mar|...)\s+\d{1,2}`, `(Monday|Tuesday|...)` |
| Contains a time pattern | +2 | `\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)`, `doors at`, `starts at` |
| Contains a price pattern | +1 | `\$\d+`, `free`, `no cover`, `tickets` |
| Contains a venue/location keyword | +1 | `at the`, `@`, `venue:`, city names |
| Contains a URL | +1 | `https?://`, `tickets:` |
| Message length > 50 chars | +1 | Long messages more likely to be announcements |
| Message from bot/webhook | +1 | Bot-posted events (e.g., from Eventbrite webhooks) |
| Message is a reply/thread | -2 | Replies are usually discussion, not announcements |
| Message is very short (<20 chars) | -2 | "nice!", "who's going?" |

**Threshold:** Score >= 4 → candidate for AI extraction

### 4.6 AI Extraction Pipeline

#### LLM: Claude 3 Haiku

Consistent with the existing AI integration in the Boards project (`generate-widget` uses Claude Haiku).

#### Prompt Design

```
You are an event extraction system. Given Discord messages from a community channel,
extract any events mentioned. Each event should be a structured object.

Rules:
- Only extract actual events (shows, meetups, parties, screenings, etc.)
- Skip messages that are just discussion, reactions, or questions about events
- If a message contains multiple events, extract each separately
- If a date is relative ("this Friday", "tomorrow"), resolve it relative to today: {today}
- If no year is specified, assume {currentYear}
- If time is ambiguous, prefer evening (7-10pm) for nightlife/music, afternoon for other
- If venue/location is not mentioned, leave empty — do not guess
- Return an empty array if no events are found

Output JSON array:
[{
  "date": "YYYY-MM-DD",
  "time": "HH:MM" or "HH:MM-HH:MM" or "",
  "name": "event title",
  "venue": "venue name" or "",
  "address": "street address" or "",
  "city": "city name" or "",
  "genre": "comma-separated tags" or "",
  "price": "$XX" or "Free" or "TBA" or "",
  "ages": "All Ages" or "21+" or "",
  "promoter": "organizer name" or "",
  "url": "ticket or info URL" or ""
}]
```

#### Batching Strategy

- Group candidate messages into batches of 10–15 messages per LLM call
- Include message timestamp and author context for relative date resolution
- Estimated cost: ~$0.001–0.003 per batch (Haiku pricing)
- For a typical channel scrape (20 candidates): 2 LLM calls, ~$0.005 total

#### Post-Extraction Validation

After AI extraction, validate each event:

1. **Date validation** — Parse with `Date` constructor; reject if invalid or > 1 year in the future
2. **Deduplication** — Match on `(date, name, venue)` tuple; keep the most complete record
3. **URL fallback** — If no URL extracted, use Discord message permalink: `https://discord.com/channels/{guildId}/{channelId}/{messageId}`
4. **City inference** — If city is empty but the source has a region, infer from region

---

## 5. Client-Side Changes

### 5.1 New Fetch Path

Add a `fetchDiscord()` function alongside existing `fetchHtml()`, `fetchRss()`, etc.

```javascript
async function fetchDiscord(source) {
  const token = getAccessToken(); // Supabase auth
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/scrape-discord-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      guildId: source.discord.guildId,
      channelId: source.discord.channelId,
    }),
  });
  if (!resp.ok) throw new Error(`Discord fetch failed: ${resp.status}`);
  const data = await resp.json();
  // Normalize to standard event shape
  return (data.events || []).map(ev => ({
    ...ev,
    source: source.id,
    contentType: source.category,
  }));
}
```

### 5.2 Source Type Routing

Extend the fetch dispatcher in `fetchAllSourcesNetwork()`:

```javascript
// Existing
if (type === 'html') events = await fetchHtml(source);
else if (type === 'ical') events = await fetchIcal(source);
else if (type === 'json') events = await fetchJson(source);
else if (type === 'rss') events = await fetchRss(source);
// New
else if (type === 'discord') events = await fetchDiscord(source);
else events = [];
```

### 5.3 Add Source UI

The "Add Source" modal needs a new option alongside the existing "Add custom source by URL" flow:

1. **Source type tabs**: `URL` | `Discord Channel`
2. **Discord tab fields**:
   - Server: text input (invite link or ID)
   - Channel: text input (channel name or ID)
   - Category: dropdown (Music, Comedy, Film, Theater, Other)
   - Region: dropdown (Bay Area, LA, NY, Seattle)
3. **Validation**: On submit, call a lightweight validation endpoint that confirms the bot has access
4. **Bot invite link**: Show a prominent link/button: "First, invite the ctrl.rodeo bot to your server"

### 5.4 Stock Discord Sources

Optionally, pre-populate common Discord event channels as stock sources:

```javascript
// Example — would be added to STOCK_SOURCES
{
  id: 'discord-sf-edm-events',
  name: 'SF EDM Events (Discord)',
  category: 'music',
  type: 'discord',
  url: null,
  region: 'bay-area',
  description: 'Electronic music events from SF EDM Discord',
  discord: {
    guildId: '...',
    channelId: '...',
    guildName: 'SF EDM',
    channelName: '#events',
  }
}
```

---

## 6. Caching Strategy

### 6.1 Server-Side Cache

The Edge Function should cache results in Supabase storage or a database table to avoid redundant Discord API calls and LLM invocations.

| Field | Value |
|---|---|
| Cache key | `discord-events:{guildId}:{channelId}` |
| TTL | 30 minutes (configurable) |
| Storage | Supabase table `discord_event_cache` |
| Invalidation | On manual refresh, or when TTL expires |

#### Cache Table Schema

```sql
CREATE TABLE discord_event_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  events JSONB NOT NULL,
  meta JSONB,
  last_message_id TEXT,          -- for incremental fetching
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(guild_id, channel_id)
);
```

### 6.2 Incremental Fetching

After the first full scrape, subsequent fetches only need to get *new* messages (those after `last_message_id`). This reduces:
- Discord API calls (fewer pages to fetch)
- LLM token usage (fewer messages to process)
- Latency (less work per refresh)

```
First fetch:  GET /messages?after={7-days-ago-snowflake}&limit=100
Next fetch:   GET /messages?after={last_message_id}&limit=100
              → merge new events with cached events
              → prune events older than lookback window
```

### 6.3 Client-Side Cache

The existing `CACHE_KEY` / `CACHE_MAX_AGE` (15 min) system applies to Discord events the same as all other sources. No changes needed.

---

## 7. Error Handling

| Scenario | Behavior |
|---|---|
| Bot not in server | Return error: "Bot not invited to this server. [Invite link]" |
| Bot lacks channel access | Return error: "Bot cannot read #{channelName}. Check channel permissions." |
| Channel has no messages | Return `{ events: [], meta: { messagesScanned: 0 } }` |
| Discord API rate limited | Retry with exponential backoff (max 3 retries) |
| Discord API down | Return cached results if available; error if not |
| AI extraction fails | Return raw candidates with `extractionFailed: true` flag |
| AI returns invalid JSON | Retry once with stricter prompt; fall back to empty |
| All messages filtered out by heuristic | Return `{ events: [], meta: { messagesScanned: N, candidateMessages: 0 } }` |

---

## 8. Security & Privacy

### 8.1 Bot Token

- Stored as Supabase Edge Function secret (`DISCORD_BOT_TOKEN`)
- Never exposed to client
- Never logged in full (first/last 4 chars only in debug logs)

### 8.2 Message Content

- Messages are processed in-memory only — not stored permanently
- Only extracted event data is cached (not raw message content)
- No user information (Discord usernames, avatars) is stored or returned
- The `meta` object returns aggregate counts only

### 8.3 Channel Access

- Bot can only read channels it has been explicitly granted access to
- Server admins control which channels the bot can see
- No server-wide scraping — only the specific channel ID requested

### 8.4 Client Auth

- Discord source fetches require a valid Supabase auth token (or anon key)
- Future: rate limit per user to prevent abuse

---

## 9. Scope & Phasing

### Phase 1: Core (MVP)

- [ ] Discord bot application setup (permissions, intents)
- [ ] Supabase Edge Function: `scrape-discord-events`
  - [ ] Discord API message fetching with pagination
  - [ ] Snowflake-based lookback window
  - [ ] Heuristic pre-filter
  - [ ] Claude Haiku extraction with structured prompt
  - [ ] Post-extraction validation and deduplication
- [ ] Client: `fetchDiscord()` function
- [ ] Client: source type routing for `type: 'discord'`
- [ ] Client: "Add Discord Channel" UI in source modal
- [ ] Basic error handling and user feedback

### Phase 2: Polish

- [ ] Server-side caching with `discord_event_cache` table
- [ ] Incremental fetching (only new messages)
- [ ] Bot invite flow with success confirmation
- [ ] Channel picker (list channels the bot can see, let user select)
- [ ] Stock Discord sources for known community servers

### Phase 3: Advanced

- [ ] Support for Discord's native Scheduled Events API (`GET /guilds/{guildId}/scheduled-events`) as a secondary extraction path — no AI needed for these
- [ ] Image/embed extraction (event flyers posted as images → OCR → AI extraction)
- [ ] Thread support (event discussions in threads may contain details not in the OP)
- [ ] Multi-channel sources (e.g., `#events` + `#shows` from the same server)
- [ ] User-contributed corrections (flag an incorrectly extracted event, refine prompt)

---

## 10. Cost Estimation

| Component | Unit Cost | Per Scrape (typical) | Monthly (daily refresh) |
|---|---|---|---|
| Discord API | Free | 2-3 requests | ~90 requests |
| Claude Haiku input | $0.25/MTok | ~5K tokens (~$0.001) | ~$0.03 |
| Claude Haiku output | $1.25/MTok | ~2K tokens (~$0.003) | ~$0.09 |
| Supabase Edge Function | Free tier | 1 invocation | ~30 invocations |
| **Total per channel** | | **~$0.004** | **~$0.12** |

With 10 Discord channels active: ~$1.20/month. Well within Supabase free tier and Claude API budget.

---

## 11. Success Metrics

| Metric | Target |
|---|---|
| Event extraction accuracy | >= 85% of real events correctly parsed (date, name, venue) |
| False positive rate | < 10% of extracted items are not actual events |
| Fetch latency (cached) | < 500ms |
| Fetch latency (cold) | < 8s (includes Discord API + AI extraction) |
| User adoption | >= 1 Discord source added per active user within 30 days |

---

## 12. Open Questions

1. **Bot hosting**: The bot only needs a token, not a running process. But should we also run a lightweight listener for real-time event detection (push vs. poll)?
2. **Multi-server bot**: One bot application can be invited to many servers. Should we run a shared bot, or guide users to create their own?
3. **Private channels**: Should the system support DM-based event sources, or only server channels?
4. **Event images**: Many Discord event posts are image-only (flyers). Phase 3 mentions OCR — is this worth the complexity?
5. **Duplicate events across sources**: If the same event appears on 19hz AND a Discord channel, how do we deduplicate cross-source?

---

## 13. References

### Discord API

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Get Channel Messages](https://discord.com/developers/docs/resources/message#get-channel-messages)
- [Guild Scheduled Events](https://discord.com/developers/docs/resources/guild-scheduled-event)
- [MESSAGE_CONTENT Privileged Intent FAQ](https://support-dev.discord.com/hc/en-us/articles/4404772028055)

### Event Extraction Libraries

- [dateparser](https://github.com/scrapinghub/dateparser) — Python date extraction from natural language (200+ locales)
- [timefhuman](https://github.com/alvinwan/timefhuman) — Human-readable datetime extraction
- [Instructor](https://github.com/jxnl/instructor) — Structured LLM output across providers

### Discord Calendar Bots (Inspiration)

- [DisCal](https://github.com/DreamExposure/DisCal-Discord-Bot) — Google Calendar + Discord integration (Java, GPL-3)
- [niles](https://github.com/niles-bot/niles) — Google Calendar interface for Discord (JavaScript)
- [discord-calendar](https://github.com/kaymeer/discord-calendar) — Standalone calendar bot, SQLite storage
- [Sesh](https://sesh.fyi) — Commercial RSVP + calendar bot

### Discord Scraping Tools

- [LAION-AI/Discord-Scrapers](https://github.com/LAION-AI/Discord-Scrapers) — Message scraping + dataset export
- [Tinlia/DiscordServerScraper](https://github.com/Tinlia/DiscordServerScraper) — Channel → CSV export
- [discord-fetch-all](https://www.npmjs.com/package/discord-fetch-all) — npm package for bulk message fetching

### Existing Events App Architecture

- Source types: `html`, `rss`, `ical`, `json` — see `events/index.html` lines 922–934
- CORS proxy pattern: `events/index.html` lines 1011–1015
- Fetch dispatcher: `events/index.html` lines 1179–1234
- Event data model: `{ date, time, name, venue, address, city, genre, price, ages, promoter, url, source, contentType }`
