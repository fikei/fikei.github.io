# Phase 8: Automated Pin Creation

> Back to [Project Plan](./index.md)

Pins that arrive on your board without you manually adding them. External sources, scheduled ingestion, AI discovery, and inbound APIs — all feeding through the same pin creation and enrichment pipeline.

**Prerequisite**: Pin Type Abstraction (Backlog Epic 0) should be complete before this phase, so automated sources can produce any pin type.

---

## Epic 8.1: Feed Subscriptions (RSS/Atom)

Subscribe to any RSS or Atom feed. New items become pins automatically, enriched through the standard pipeline.

| Story | Tasks | Status |
|-------|-------|--------|
| **Feed Parser Edge Function** | | Pending |
| | Create `poll-feeds` Supabase Edge Function | Pending |
| | Parse RSS 2.0, Atom 1.0, and JSON Feed formats | Pending |
| | Extract: title, URL, description, published date, image (enclosure/media:content) | Pending |
| | Deduplicate against existing pins (URL match) | Pending |
| | Map feed items to pin skeleton format | Pending |
| **Feed Management Table** | | Pending |
| | Create `feed_subscriptions` table (user_id, feed_url, title, category, poll_interval, last_polled, status) | Pending |
| | RLS: users can only manage their own subscriptions | Pending |
| | Default poll interval: 1 hour | Pending |
| **Feed Discovery & Subscribe UI** | | Pending |
| | "Add Feed" option in Add modal (detect RSS URL vs regular URL) | Pending |
| | Auto-discover feeds from `<link rel="alternate" type="application/rss+xml">` when adding a site URL | Pending |
| | Per-feed default category assignment | Pending |
| | Feed preview — show last 5 items before subscribing | Pending |
| **Scheduled Polling** | | Pending |
| | Cron trigger via Supabase pg_cron or GitHub Actions schedule | Pending |
| | Poll each feed at its configured interval | Pending |
| | Insert new items as pins with `source: 'feed'` and `source_feed_id` | Pending |
| | Run client-tier enrichment on new pins server-side | Pending |
| **Feed Management UI** | | Pending |
| | List subscribed feeds with item count, last polled, status | Pending |
| | Pause/resume individual feeds | Pending |
| | Edit default category per feed | Pending |
| | Unsubscribe with option to keep or remove existing pins | Pending |
| | Feed health indicator (errors, stale, active) | Pending |
| **Feed Notification** | | Pending |
| | Badge count for new feed-sourced pins since last visit | Pending |
| | Optional: daily digest email of new feed pins | Pending |

---

## Epic 8.2: Inbound API & Webhooks

Programmatic pin creation from external tools (Zapier, IFTTT, Make, Shortcuts, scripts).

| Story | Tasks | Status |
|-------|-------|--------|
| **Pin Ingestion API** | | Pending |
| | Create `ingest-pin` edge function accepting `{ url, title?, category?, tags? }` | Pending |
| | Authenticate via API key (not session token) | Pending |
| | Validate URL, deduplicate, create pin skeleton | Pending |
| | Trigger async enrichment (same pipeline as manual adds) | Pending |
| | Return `{ pin_id, status, enrichment_pending }` | Pending |
| **API Key Management** | | Pending |
| | Create `api_keys` table (user_id, key_hash, name, created_at, last_used, scopes) | Pending |
| | Generate API key in Account settings | Pending |
| | Key scoping: `pins:create`, `pins:read`, `feeds:manage` | Pending |
| | Revoke key UI | Pending |
| | Rate limit: 100 pins/hour per key | Pending |
| **Email-to-Board** | | Pending |
| | Generate unique ingest email: `{board_id}@ingest.ctrl.rodeo` | Pending |
| | Email receiving via Supabase Edge Function + email webhook service (Resend/Mailgun) | Pending |
| | Extract URLs from email body | Pending |
| | Use email subject as pin note/context | Pending |
| | Forward-friendly: supports forwarded newsletters, articles | Pending |
| **Webhook Receiver** | | Pending |
| | `POST /ingest-pin` accepts webhook payloads from Zapier/IFTTT/Make | Pending |
| | Payload mapping templates for common integrations | Pending |
| | HMAC signature verification for webhook security | Pending |
| | Document integration recipes (Zapier: "New liked tweet → Create pin") | Pending |
| **iOS/Android Shortcuts** | | Pending |
| | Share Sheet shortcut: share URL → `POST /ingest-pin` with API key | Pending |
| | Provide shortcut template files for iOS Shortcuts and Android Tasker | Pending |

---

## Epic 8.3: Social Media Import

Connect social accounts and pull in saved/liked content as pins.

| Story | Tasks | Status |
|-------|-------|--------|
| **Twitter/X Bookmarks** | | Pending |
| | OAuth flow for Twitter API v2 | Pending |
| | Fetch bookmarks on demand or scheduled | Pending |
| | Map tweet URLs, quoted URLs, and media to pins | Pending |
| | Handle threads (pin the thread URL, not individual tweets) | Pending |
| **Reddit Saved Posts** | | Pending |
| | OAuth flow for Reddit API | Pending |
| | Fetch saved posts and comments | Pending |
| | Extract link posts as URL pins, text posts as note pins | Pending |
| **YouTube Watch Later / Liked** | | Pending |
| | OAuth flow for YouTube Data API v3 | Pending |
| | Import Watch Later or Liked Videos playlists | Pending |
| | Map to pins with video enrichment (thumbnail, duration, channel) | Pending |
| **Spotify Saved Tracks / Playlists** | | Pending |
| | OAuth flow for Spotify Web API | Pending |
| | Import Liked Songs or specific playlists | Pending |
| | Map to pins with music enrichment (album art, artist, preview URL) | Pending |
| **Import UI** | | Pending |
| | Connected accounts page in settings | Pending |
| | Per-account: sync frequency (manual, daily, weekly) | Pending |
| | Per-account: default category mapping | Pending |
| | Import history — what was pulled and when | Pending |
| | Disconnect account with option to keep pins | Pending |

---

## Epic 8.4: AI Discovery

The board suggests new pins based on what you already have. AI analyzes your existing pins and finds related content you might want.

| Story | Tasks | Status |
|-------|-------|--------|
| **Discovery Engine Edge Function** | | Pending |
| | Create `discover-pins` edge function | Pending |
| | Analyze user's pin collection: top domains, categories, brands, topics | Pending |
| | Claude prompt: "Given these pins, suggest 5 URLs the user would want" | Pending |
| | Validate suggestions are real URLs (HEAD request check) | Pending |
| | Deduplicate against existing pins | Pending |
| **"More Like This"** | | Pending |
| | Per-pin action: "Find similar" | Pending |
| | Claude analyzes pin metadata → suggests related URLs | Pending |
| | Results shown in a discovery panel | Pending |
| **Discovery Feed UI** | | Pending |
| | "Discover" tab or section on the board | Pending |
| | Show suggested pins in a review queue | Pending |
| | Accept (add to board) or dismiss (hide, don't suggest again) | Pending |
| | Feedback loop: accepted/dismissed pins improve future suggestions | Pending |
| **Trending in Category** | | Pending |
| | Aggregate popular domains across all users per category | Pending |
| | Surface trending URLs that the user hasn't pinned | Pending |
| | Privacy: only use domain-level aggregation, not individual URLs | Pending |
| **Scheduled Discovery** | | Pending |
| | Optional: run discovery weekly and surface new suggestions | Pending |
| | Notification badge for new suggestions | Pending |
| | Daily/weekly discovery digest email (opt-in) | Pending |

---

## Epic 8.5: Content Monitoring

Watch specific URLs or brands for changes. Get new pins automatically when monitored sources publish new content.

| Story | Tasks | Status |
|-------|-------|--------|
| **Page Monitor Edge Function** | | Pending |
| | Create `monitor-pages` edge function | Pending |
| | Store monitored URLs with CSS selector or content hash | Pending |
| | Detect new items (new links on a page, new products in a collection) | Pending |
| | Extract new items as pins | Pending |
| **Monitor Setup UI** | | Pending |
| | "Watch this page" action on link pins | Pending |
| | Configure: what to watch (new links, price changes, new products) | Pending |
| | Configure: check frequency (hourly, daily, weekly) | Pending |
| | Monitor dashboard — active watches with last check and change count | Pending |
| **Brand New Arrivals** | | Pending |
| | For pinned brands (from widget brand registry), auto-check new arrivals pages | Pending |
| | Surface new products as suggested pins | Pending |
| | Leverage existing Shopify JSON API integration for monitored Shopify stores | Pending |
| **Price Drop Alerts** | | Pending |
| | Track price from structured data (JSON-LD, OG:price) on product pins | Pending |
| | Store price history in `pin_price_history` table | Pending |
| | Notify when price drops below threshold | Pending |
| **Notification System** | | Pending |
| | In-app notification bell with unread count | Pending |
| | Notification types: new feed items, price drops, new arrivals, discovery suggestions | Pending |
| | Notification preferences per source type | Pending |
| | Optional: push notifications (requires service worker from Phase 6) | Pending |

---

## Source Tracking

All automated pins carry provenance metadata so the user knows where each pin came from.

| Field | Type | Values |
|-------|------|--------|
| `source` | enum | `manual`, `feed`, `api`, `email`, `social`, `discovery`, `monitor` |
| `source_id` | text | Feed subscription ID, API key name, social account, monitor ID |
| `source_url` | text | The feed URL, webhook origin, social platform URL |
| `auto_added` | boolean | `true` for all automated pins, `false` for manual |
| `reviewed` | boolean | Whether the user has seen/acknowledged the pin |

This enables filtering ("show only my manual pins", "show unreviewed"), bulk management ("mark all feed pins as reviewed"), and analytics ("which sources produce the most kept pins").

---

## Architecture Notes

### Enrichment Pipeline Reuse

Automated pins flow through the exact same enrichment pipeline as manual pins:

```
External Source → ingest-pin edge function
                      │
                      ├─ Validate & deduplicate
                      ├─ Create pin skeleton with source metadata
                      ├─ Trigger client-tier enrichment (server-side)
                      ├─ Trigger server-tier enrichment (AI classify, images)
                      └─ Sync to user's localStorage on next poll/push
```

### Sync Considerations

Automated pins are created server-side, which reverses the normal flow (client creates → syncs to server). This means:
- Pins appear on the server first, then sync to client on next 30s poll
- A push notification or Supabase Realtime subscription would make new automated pins appear instantly
- The `reviewed: false` flag prevents the board from silently filling up without the user knowing

### Cost Management

Each automated pin triggers enrichment (CORS scrape + potentially AI classification). At scale:
- Domain profile caching keeps AI costs low for repeated domains
- Feed items from the same domain hit the cache after the first few
- Rate limits on the ingestion API prevent abuse
- Users can pause sources without deleting them

---

*Last updated: 2026-02-06*
