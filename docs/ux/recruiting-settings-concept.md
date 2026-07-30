# Settings — concept & structure

> **Status:** shipped 2026-07-30 (v3.49.0). Design system story: [Settings](https://ctrl.rodeo/design-system/recruiting/#settings).
> **Product:** Agape recruiting (`/applications`) · **Written:** 2026-07-30
>
> All three open questions are decided and the build is done: `?view=settings`, six sections rendering from `applications/js/settings-schema.js`, automations and connections with live status, admin derived from Discord. What follows is the reasoning, kept because it explains why the shape is the shape.

---

## The problem

There is no settings surface. There is a rail footer, and everything that didn't fit anywhere else went into it: three unlabelled-group checkboxes, a Gmail connection status line, a theme toggle, a CSV export, and Sign out. Meanwhile the two house-wide money settings — food and dues — are number inputs buried **inside a room's occupancy drawer**, which is where you'd look for that room's rent, not for a global.

The deeper problem is that the footer is the only place a setting *can* go, so most settings never became settings at all. The house's recruiting behavior is currently governed by literals in `applications/js/app.js`:

| Behavior | Today | Where |
|---|---|---|
| Follow-up goes amber after quiet | 3 days | `app.js` — `3 * 86400000` |
| Flexible move-in window padding | ±1 month | `app.js` — `flexPad` |
| Trial check-in milestone | start + 1 month | migration 139 |
| Trial decision milestone | end − 1 month | migration 139 |
| "Save for future" default return | +3 months | `defaultReturnDate()` |
| Screener slots offered | max 8, 30 min apart | `_shared/discord.ts` |
| Gap must be this long to list | 7 days | `roomGaps()` |
| Timezone | `America/Los_Angeles` | `_shared/recruit-schedule.ts` |

Each is a defensible default. None is a law of nature, and every one of them currently requires a PR and a deploy to change. That's the cost this concept is trying to remove.

There is also dead config: `vote_min_count` (3) and `vote_pass_avg` (3.5) still sit in `recruit_settings` from the collective-vote model that the single-decider change superseded on Jul 29. A settings surface makes orphaned config visible instead of quietly load-bearing-looking.

---

## The idea

**Settings mirrors the rail.** The app already teaches a mental model — **House** and **Funnel** — and people navigate by it. Settings should not invent a second taxonomy ("General / Advanced / Preferences"); it should answer "where would I look?" with the same two words, plus three sections for the things the rail has no room for.

```
Settings
├── You            per-user, affects nobody else
├── House          the building and the money
├── Funnel         how applicants move through it
├── Automations    the things that run without you
├── Connections    Gmail, Calendar, Discord, notes bot
└── Data           export, and the rare destructive stuff
```

Six sections, and the first three are the app's own vocabulary. A new setting almost always has an obvious home; when it doesn't, that's a signal the setting is confused, not that the taxonomy needs a seventh box.

### Where it lives

A **full view at `?view=settings`**, with a `Settings` entry pinned at the bottom of the rail below the Funnel group. Not a modal, not a drawer.

- Deep-linkable per section (`?view=settings#automations`) — error toasts, Discord audit posts, and docs can point at the exact knob instead of describing where to click.
- Reuses the existing page chrome (title, sub, scroll) so a new section costs an anchor, not a layout.
- The rail footer sheds everything except identity and the Settings link. That alone fixes what the footer looks like today.

### What the rail footer becomes

```
Ian Fike · edit
Settings
Sign out
```

Theme moves to **You**, the Gmail line to **Connections**, CSV export to **Data**, and the three checkboxes to **House** and **Funnel** where they belong.

---

## Structure for extensibility

The point of this section: **adding a setting should be one object literal, not a UI change.**

### 1. A declarative schema, rendered generically

```js
// applications/js/settings-schema.js
export const SETTINGS = [
  { id: 'you', title: 'You', hint: 'Only affects your account.', fields: [
    { key: 'display_name', scope: 'profile', type: 'text',   label: 'Display name',
      hint: 'Shown on your reviews and comments.' },
    { key: 'theme',        scope: 'local',   type: 'enum',   label: 'Theme',
      options: ['system', 'light', 'dark'], default: 'system' },
  ]},
  { id: 'funnel', title: 'Funnel', hint: 'How applicants move.', fields: [
    { key: 'followup_stale_days', scope: 'house', type: 'number', unit: 'days',
      label: 'Follow-up goes amber after', default: 3, min: 1, max: 30,
      hint: 'A thread this quiet is worth another email.' },
    { key: 'movein_flex_months',  scope: 'house', type: 'number', unit: 'months',
      label: 'Flexible move-in stretches by', default: 1, min: 0, max: 3,
      hint: 'How far a "flexible" date reaches on each side when matching listings.' },
    { key: 'update_email_default', scope: 'house', type: 'bool',
      label: 'Offer an update email by default',
      hint: 'When someone is marked not a fit — you can still change it per person.' },
  ]},
  // …
];
```

The page renders from this array. Four field types cover everything in the inventory: `bool`, `number`, `text`, `enum`. **Adding a setting is appending an object.** No template, no handler, no new markup.

### 2. `scope` decides the store, so nothing else has to know

Every field declares one of three scopes, and a single accessor resolves it:

| Scope | Store | Example |
|---|---|---|
| `house` | `recruit_settings` (key/value JSONB) | food cost, staleness window |
| `profile` | `recruit_profiles` | display name, group email |
| `local` | `localStorage` | theme, video speed |

```js
setting('followup_stale_days')            // → house value, or the schema default
setSetting('followup_stale_days', 5)      // → routes to the right store by scope
```

The renderer never branches on storage, and callers never learn where a value lives. Moving a setting from `local` to `house` later (theme is a plausible one — a house might want a shared look) is a one-word change in the schema.

### 3. The schema default is the code default

This is the piece that pays for itself. Every literal in the table above becomes:

```js
const staleDays = setting('followup_stale_days');   // 3 until someone changes it
```

`setting()` falls back to the schema's `default` when the DB has no row, so **shipping a knob as configurable requires no migration and no seed** — the schema is the source of truth for both the default and the UI. It also means a setting can exist in code *before* it's exposed: omit it from a section's `fields` and it stays a named, documented constant in one place instead of a magic number in three.

### 4. Automations and Connections are row types, not fields

These don't fit the field renderer and shouldn't be forced into it — they have live status, a last-run time, and an action:

```js
{ id: 'automations', title: 'Automations', rows: [
  { key: 'gmail_scan',   label: 'Scan the shared inbox',
    cadence: 'every 20 min', status: () => lastRun('recruit_gmail_scan_tick'),
    hint: 'Pulls new applications, replies, and availability.' },
  { key: 'screening_reminders', label: 'Remind screeners before a call',
    cadence: 'every 15 min', status: () => lastRun('recruit_screening_reminder_tick') },
]}
```

Each automation row shows **what it does, how often, when it last ran, and whether it's on** — the four things you want when something didn't happen. Same for connections: Gmail, the house calendar, the Discord server + its two channels, and the optional Recall notes bot, each with a reachable/expired state. The Gmail token expiring every ~7 days is currently invisible until someone notices no new applications; a Connections section with a real status makes that a glance instead of an investigation.

### 5. Reuse the sidebar CTA tiers

Section footers use [`drawer-cta`](https://ctrl.rodeo/design-system/recruiting/#sidebar-ctas): one filled commit per section, quiet dismiss, and anything destructive (disconnect Gmail, reset a section to defaults) as a full-width exit row with a hint. Settings is exactly the surface that pattern was built for — the consequences are the whole point.

---

## Open decisions

### ~~1. Autosave per control, or an explicit Save per section?~~ — decided Jul 30

**Autosave, everywhere.** Settled app-wide rather than for Settings alone: nothing in the app gets a Save button unless it **creates**, **confirms**, or **destroys**. Fields write on `change` — text on blur, dates/selects/toggles the instant they settle — and a quiet status line says "Changes save as you go", flashing "Saved" when a write lands. Section footers therefore carry no commit at all; the only button in a Settings section is "Reset this section", which is destructive. See the [Sidebar CTAs](https://ctrl.rodeo/design-system/recruiting/#sidebar-ctas) story.

### ~~2. Who can change house-wide settings?~~ — decided Jul 30

**Admins, derived from Discord: whoever can see #recruiting-automation.** Not a role the app maintains — the same channel that already receives the automation audit trail defines who gets to change the automation. The check needs the bot token, so `discord-membership` computes it (reusing the channel-permission math that already gates the app) and reconciles a `recruit_admins` row on every verify, in both directions: lose channel access, lose admin.

RLS is the wall (migration 144): `recruit_settings` writes require `is_recruiting_admin()`. The flag deliberately does **not** live on `recruit_profiles` — members write their own profile row, so they could grant themselves admin. `recruit_admins` is service-role-write, member-read, so the UI can say "you can't change this" instead of failing a write.

Everyone still reads everything, and every house-wide setting shows `updated_by_name` / `updated_at` — "Ian changed this 3 days ago." Read access was never the thing worth protecting.

### ~~3. How far to go on the hardcoded literals in v1?~~ — decided Jul 30

**Four exposed, four routed.** In the UI: follow-up staleness, move-in flexibility, and the two trial milestone offsets — the ones the house has actually argued about. Routed through `setting()` with schema defaults but left out of the UI (`section: null`): the gap minimum, screener slot length, slots per ask, and the save-for-future window. They are named constants in one place now instead of magic numbers in three, and exposing one is a one-line change.

`vote_min_count` and `vote_pass_avg` are deleted (migration 144) — dead since the single-decider change on Jul 29.

**Not settings, deliberately:** the timezone (`America/Los_Angeles`) and the trial-milestone SQL in migration 139 stay server-side. The frontend suggestion honours `trial_checkin_months` / `trial_decision_months`; the database's own backfill does not, so a house that changes those will see new stays follow the setting while migration 139's one-time pass used ±1 month. Worth a follow-up if the numbers ever diverge in practice.

---

## What shipped (v3.49.0)

1. **`applications/js/settings-schema.js`** — `SETTING_DEFS` (14 knobs), `SETTING_SECTIONS`, `SETTING_AUTOMATIONS`. Loaded before `app.js` as a classic script.
2. **`setting()` / `setSetting()`** in `app.js` — schema default as the fallback, `scope` picking the store. Every literal in the table above now reads through it.
3. **`?view=settings`** — six sections rendered from the schema, `Settings` in the rail under *House keeping*, and the footer stripped to identity · Sign out. Food and dues moved out of the room drawer into **House**.
4. **Automations** — `recruit_cron_status()` (migration 144, `SECURITY DEFINER`, read-only) gives each job its schedule, last run, and last status. `cron.*` isn't reachable over REST, so this RPC is the one door to it. The cron cadences are **not** editable here: a toggle that only half-worked would be worse than saying where they live.
5. **Connections** — Gmail (from `recruit-gmail { action: 'status' }`), the house calendar, and Discord's two channels, each with a real state. The Gmail token dying every ~7 days is now a glance instead of an investigation.
6. **Admin** — `recruit_admins` + `is_recruiting_admin()`, reconciled by `discord-membership` v1.4.0 from #recruiting-automation access.

### Still open

- **Automation on/off** is read-only except `discord_auto_post`. Real toggles mean either mutating `pg_cron` from an RPC or giving each edge function an enabled-check; neither is free.
- **Migration 139's trial milestones** don't read the settings (see decision 3).
- **`recruit-gmail` reconnect** can't be driven from this page — the token is server-side.
