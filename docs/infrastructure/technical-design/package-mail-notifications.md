# Package delivery → #mail — technical design

Status: **phase 1 built, not yet deployed** (2026-09-16). No PRD yet.
Code: `supabase/functions/mail-watch/`, migration `180_mail_deliveries.sql`.

Goal: when a package lands at the house, say so in the Agape Discord `#mail`
channel, so the housemate it belongs to knows to grab it off the stoop.

## The Shop app is a dead end — say so up front

The prompt for this was "my shop.com account has great notifications." It does,
and they are unreachable:

- **Shop (shop.app, Shopify's consumer app) has no public or consumer API.** No
  webhooks, no export, no OAuth surface. Shopify's APIs are merchant-side — they
  let *a store* read *its* orders. There is no endpoint that answers "what is
  arriving for this shopper."
- **The good notifications are push, not email.** Verified against the actual
  inbox: `from:shop.app` over the last 12 months is marketing ("Your cart? Saved
  ✅"), sign-in alerts, and daily-offer blasts. Zero delivery notices. Scraping
  the Shop mail stream would yield nothing.

So there is nothing to pipe out of Shop. The good news is that Shop is itself an
aggregator, and **we have the same upstream it reads from.**

## The real source: the merchant mail already in Gmail

Every delivery Shop knows about also generates a merchant email. A sample of
`subject:delivered` over 120 days on one address:

| Sender | Shape |
|---|---|
| `order-update@amazon.com` | `Delivered: "KODAK CHARMERA Keychain..."` |
| `tracking@shipstation.com` | `Your order has been delivered!` + carrier + address |
| Shopify stores (`help@garagegrowngear.com`, `orders@fieldmag.com`, …) | `A shipment from order #420590 has been delivered` |
| `CVSPharmacy@alerts.cvs.com` | `Your order was delivered.` + full delivery address |
| `email@news.arcteryx.com` | `Your Arc'teryx Order … Has Been Delivered` |

~32 threads in 120 days on `subject:delivered` alone, before counting "arrived",
"out for delivery", and carrier-direct mail (USPS/UPS/FedEx). The corpus is rich
and it is already sitting in a mailbox we can read.

## Do not build a separate app

Every primitive this needs already exists in this repo:

| Need | Existing piece |
|---|---|
| Google OAuth + refresh tokens | `supabase/functions/gmail-auth/` + `_shared/google-tokens.ts` (`getAccessToken`, `findTokenForScopes`, multi-user `user_google_tokens` table) |
| Poll Gmail on a schedule | `recruit-gmail` `scan` action + migration `136_recruit_gmail_scan_cron.sql` (pg_cron + one-time nonce handshake) |
| Post to a Discord channel | `_shared/discord.ts` → `postChannelEmbed(channelId, description, color, label, links)`; bot is already in the Agape guild (`952961396121931838`) |
| Classify a message body with Haiku | `extractAvailability()` in `recruit-gmail/index.ts` — same shape, different prompt |

That reduces the build to **one edge function, one table, one cron migration.**

## Design

New function `mail-watch` (Boards project `yfhudwakpgzswiylhfbh`, alongside the
other Agape automations).

### Table

```sql
create table mail_deliveries (
  id             uuid primary key default gen_random_uuid(),
  gmail_msg_id   text not null unique,   -- dedupe key
  inbox_email    text not null,
  owner_label    text not null,
  merchant       text,
  carrier        text,
  delivered_at   timestamptz,
  confidence     real,
  posted_at      timestamptz,            -- null until it reaches Discord
  discord_msg_id text,
  created_at     timestamptz not null default now()
);
```

There is deliberately **no column for item names.** Merchant-only is the
decided default (see Privacy below), and a schema that cannot hold purchase
detail cannot leak it later by a copy-paste into a new embed string.

`gmail_msg_id unique` is the whole dedupe story — the cron can re-scan an
overlapping window forever and never double-post. (Amazon in particular sends
the same "Delivered" notice up to three times; see thread `19f091aa02459a90`.)

### Flow

1. **pg_cron every 15 min** → `POST /functions/v1/mail-watch/scan` with the
   nonce handshake from migration 136. (Offset from the `*/20` recruiting tick
   so the two do not contend for the Google quota.)
2. For each connected inbox, Gmail `users.messages.list` with
   `newer_than:1d (subject:delivered OR subject:arrived OR "has been delivered" OR "was delivered")`.
   Cheap prefilter — no LLM cost on the 95% that never match.
3. Drop anything whose `gmail_msg_id` is already in `mail_deliveries`.
4. **Haiku pass** on survivors to separate a real delivery notice from marketing
   that merely says "delivered" (the corpus contains
   `"Award-winning health care journalism, delivered free"` and
   `"😸 Taco Bell, delivered by Claude"` — a regex will post both). Extract
   `{is_delivery, merchant, summary, carrier, confidence}` and floor at ~0.7,
   mirroring `INTENT_FLOOR` in `recruit-gmail`.
5. Insert, then `postChannelEmbed(MAIL_CHANNEL_ID, …)` with a mention of the
   owning housemate and a "Track" link button when a tracking URL is present.
6. Stamp `posted_at` / `discord_msg_id`. Insert-before-post means a crash
   mid-flight loses a notification rather than spamming the channel.

### Discord output

```
📦 **Ian** — Garage Grown Gear
Titanium Shepherd's Hook Tent Stakes · USPS · delivered 2:14p
[ Track ]
```

## The crux: whose inbox

This is the open question, and it decides whether the feature works at all.

> "a lot of them are not mine"

If that means *most packages arriving at the house belong to housemates*, then
**Ian's inbox is structurally the wrong source.** His Gmail — and his Shop
account — only ever see his own orders. Wiring it to `#mail` produces a channel
that announces Ian's packages and nothing else, which is the opposite of the ask.

Covering the house requires per-housemate opt-in. Two phases:

- **Phase 1 — one inbox (½ day).** Ian connects; `#mail` gets his deliveries.
  Proves the pipeline, the parsing quality, and the channel's signal-to-noise
  before anyone else is asked to grant Gmail access. Genuinely useful on its own
  only if the point is "tell the house a package is on the stoop", regardless of
  owner.
- **Phase 2 — the house (2–3 days).** Each housemate hits a connect button in
  the existing `applications/` app, consents to `gmail.readonly`, and lands a row
  in `user_google_tokens`. `mail-watch` loops over connected inboxes and
  attributes each delivery to its owner. This is the version that answers the
  actual request.

### Privacy — decide before Phase 2

`gmail.readonly` is all-or-nothing: consenting hands this function the whole
mailbox, not just delivery mail. And a delivery notice names what someone
bought. `Delivered: "GREEN ALLUVIUM Premium..."` in a public channel is a
purchase history nobody opted into publishing.

Mitigations, cheapest first:

1. **Post the merchant, not the contents** — "📦 Ian — a package from Amazon".
   Kills most of the exposure and loses nothing operationally; the point is
   "go get it", not "here is what it is".
2. **Per-housemate detail toggle** — default to merchant-only, let people opt
   into item names for themselves.
3. **Store only what is posted.** Do not retain bodies; extract, post, discard.
4. **Suppress by category** — pharmacy senders (`alerts.cvs.com`,
   `pharmacy.amazon.com`) never post item detail regardless of setting.

Recommendation: ship #1 and #3 as the default in Phase 1, so the privacy
posture is right before the house is invited in.

## Alternatives considered

- **Carrier APIs direct (USPS Informed Delivery, UPS, FedEx).** Per-carrier
  accounts, per-person enrollment, and USPS has no real API for this — strictly
  worse than reading the mail the carriers already send.
- **A Discord bot that watches a forwarding address.** Housemates forward
  delivery mail to a house address the bot reads. Avoids `gmail.readonly`
  entirely and is the best privacy story, but relies on everyone setting up a
  Gmail filter and keeping it working. Worth revisiting if Phase 2's OAuth ask
  meets resistance.
- **Shopify merchant API.** Wrong side of the transaction; see above.

## Decisions taken (2026-09-16)

1. **Phase 1 only** — Ian's inboxes, to prove parsing quality and channel
   signal-to-noise before anyone else is asked for Gmail access.
2. **Merchant only** — "📦 **Ian** — a package from Garage Grown Gear". No item
   names stored, no item names posted.

Both are wired. Two addresses are swept, not one: the delivery mail splits by
merchant, with Amazon going to the `.edu` address and the Shopify stores to
gmail.

## What Phase 1 does NOT do

Worth stating plainly, because it is the gap between this and the original ask:
**a single inbox only ever sees its own owner's orders.** Phase 1 announces
Ian's packages. It does not tell a housemate that *their* package arrived,
because nothing in Ian's mailbox knows about it. Phase 2 (per-housemate OAuth,
the loop in `scanInbox` is already the seam) is what closes that.

## Notes for whoever picks up Phase 2

- `scanInbox()` already takes one `{email, label}` and is called in a loop with
  per-inbox error isolation. Phase 2 swaps the `MAIL_WATCH_INBOXES` env for a
  table of connected housemates; nothing else in the scan changes.
- `postChannelEmbed()` in `_shared/discord.ts` mirrors every post into
  `#recruiting-automation`. Package mail must not use it — hence the new
  `postPlainEmbed()`. Do not "simplify" mail-watch back onto the mirroring one.
- The tracking-link button is unbuilt on purpose. A tracking URL can expose
  order detail to anyone in the channel who follows it, which undercuts the
  merchant-only decision.

## Open questions

1. Does `#mail` exist in the Agape guild yet, and what is its channel id?
   `MAIL_CHANNEL_ID` has no default — the function no-ops and logs rather than
   falling back to a recruiting channel.
