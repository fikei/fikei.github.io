# Settings — concept & structure

> **Status:** concept, not built. Design system story: [Settings](https://ctrl.rodeo/design-system/recruiting/#settings).
> **Product:** Agape recruiting (`/applications`) · **Written:** 2026-07-30

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

### 1. Autosave per control, or an explicit Save per section?

- **Autosave** matches the current footer checkboxes (they upsert on change) and suits toggles, but a number field autosaving mid-typing is hostile, and "did that save?" has no answer.
- **Save per section** gives every change a moment of intent, which is right for things like the staleness window that silently change what everyone else sees — but it's ceremony for flipping a checkbox.
- **Nuance:** the two behave differently because the *settings* are different. A toggle is a decision; a number is a draft until you stop typing.

**Recommendation:** autosave `bool` and `enum` on change with an inline "saved" tick; require an explicit commit for `number` and `text`. The schema already knows the type, so the renderer can enforce this — no per-field configuration.

### 2. Who can change house-wide settings?

- Today every signed-in Recruiting Society member can flip any of the three footer toggles, and nothing records who did.
- House-wide settings change what everyone sees. Locking them to an admin list is safer but adds a role concept the app doesn't have yet.
- **Nuance:** the honest middle is an audit trail — `recruit_settings` gains `updated_by` / `updated_at`, and the section shows "Ian changed this 3 days ago". Accountability without a permissions model, the same bet the single-decider review model already made.

**Recommendation:** no roles. Add `updated_by`/`updated_at` and surface it per setting. Revisit if it's ever abused.

### 3. How far to go on the hardcoded literals in v1?

- **All of them** (8 knobs) is the most complete, but some — the 30-minute screener slot interval, the timezone — nobody will touch this year, and each one exposed is a setting to maintain and document.
- **None of them**, and Settings is just the footer reorganized, which doesn't earn a new view.
- **Nuance:** the ones worth exposing are the ones the house has actually argued about.

**Recommendation:** expose four in v1 — follow-up staleness, move-in flexibility, the two trial milestone offsets. Route the rest through `setting()` with schema defaults but leave them out of the UI; they become one-line exposures the day someone asks. Delete `vote_min_count` and `vote_pass_avg`.

---

## Suggested build order

1. `settings-schema.js` + `setting()` / `setSetting()`, and route the four v1 knobs and all existing settings through them. No UI yet — behavior identical, literals gone.
2. `?view=settings` with the six sections rendering from the schema; rail entry added, footer stripped to identity + Settings + Sign out. Move food/dues out of the room drawer into **House**.
3. Automations + Connections row types, reading `cron.job_run_details` and the Gmail token state for status.
4. `updated_by` / `updated_at` on `recruit_settings`, surfaced per setting.

Step 1 is worth doing even if the view never ships.
