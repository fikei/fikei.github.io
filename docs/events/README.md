# Events

> Event aggregator with source integration and location filtering

**Status**: Experimental
**Code**: [`/events/`](../../events/)
**Live**: [ctrl.rodeo/events](https://ctrl.rodeo/events/)

---

## What it does

Aggregates events from multiple sources (ScreenSlate, Discord channels) with location-based filtering and data table display.

## Supabase functions

| Function | Project | Purpose |
|----------|---------|---------|
| `fetch-source` | — | Server-side proxy for event sources |
| `scrape-discord-events` | — | Discord channel event extraction with Claude Haiku |

## Documentation

| Category | Path | Contents |
|----------|------|----------|
| **PRD** | [`prd/`](prd/) | Discord channel source PRD, bot setup guide |
