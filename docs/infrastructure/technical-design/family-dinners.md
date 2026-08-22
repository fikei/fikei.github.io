# Family dinners — technical design

Status: **spec** (2026-08-21). PRD: [agape-family-dinners.md](../../strategy/prds/agape-family-dinners.md).
Plan: [phase 18](../../execution/project-plan/phase-18-family-dinners.md).

Lives inside the triage app (`applications/`, Supabase project `yfhudwakpgzswiylhfbh`
— same project as Boards/recruiting). Everything below reuses existing recruiting
infrastructure; the only new service surface is three tables, two settings keys, and
two cron behaviors.

## Schema (new migration)

```sql
-- One row per scheduled dinner
create table recruit_dinners (
  id          uuid primary key default gen_random_uuid(),
  dinner_on   date not null unique,
  starts_at   time not null default '19:00',
  is_checkin  boolean not null default false,   -- housemates-only meeting dinner
  note        text,                              -- "Ian Bday (13th)" etc.
  status      text not null default 'scheduled'  -- scheduled | cancelled
              check (status in ('scheduled','cancelled')),
  created_by  uuid,
  created_at  timestamptz not null default now()
);

-- One row per filled role slot
create table recruit_dinner_signups (
  id           uuid primary key default gen_random_uuid(),
  dinner_id    uuid not null references recruit_dinners(id) on delete cascade,
  role         text not null check (role in
               ('head_chef','sous_chef','trash_fluff','cleanup_1','cleanup_2')),
  user_id      uuid not null,
  display_name text not null,
  created_at   timestamptz not null default now(),
  unique (dinner_id, role)          -- race-safe claims: first insert wins
);

-- One row per (dinner, housemate): carries absence AND guests
create table recruit_dinner_rsvps (
  id           uuid primary key default gen_random_uuid(),
  dinner_id    uuid not null references recruit_dinners(id) on delete cascade,
  user_id      uuid not null,
  display_name text not null,
  is_out       boolean not null default false,   -- "can't make it"
  guest_count  int not null default 0,
  guest_names  text,
  updated_at   timestamptz not null default now(),
  unique (dinner_id, user_id)
);
```

Settings (rows in existing `recruit_settings`):

| key | value | default |
|-----|-------|---------|
| `dinner_guest_limit` | max guests per housemate per dinner | `2` |
| `dinner_quota_resident` | shifts per resident per quarter | `5` |
| `dinner_rules` | markdown for the rules panel (dietary, budget, duty checklists) | seeded from the sheet's notes columns |
| `dinner_channel_id` | Discord channel for reminder posts | — |

No roster table: the quarter roster derives at read time from `recruit_stays` rows
(kind `resident`/`sublet`) overlapping the quarter, joined to `recruit_profiles` for
display names. Subletter quota = `dinner_quota_resident` prorated by weeks of the
stay that fall inside the quarter (rounded, min 1).

## Auth & RLS

- **New gate flag:** `discord-membership` (currently verifies Agape guild +
  Recruiting Society channel and caches into `user_discord_membership`) additionally
  reads the member's **guild roles** from the same `GET /guilds/{id}/members/{uid}`
  call it already makes with the bot token, and caches `is_house_member boolean` +
  `house_role text` (`resident` | `subletter`) on `user_discord_membership` (new
  columns). Role-name → flag mapping lives in the function (env or constant), same
  7-day cache TTL.
- **RLS:** the three `recruit_dinner*` tables are readable/writable when the caller's
  `user_discord_membership` row has `is_house_member = true` (mirror the existing
  membership-check policy pattern used by tour votes). Row-level ownership: non-admin
  updates/deletes on `recruit_dinner_signups` and `recruit_dinner_rsvps` require
  `user_id = auth.uid()`; admin writes go through the existing admin path.
- Recruiting tables keep their channel-based policies untouched.

## Client (applications/)

New rail item **Dinners** in the House group of `applications/index.html` /
`applications/js/app.js`. Visibility branches on the membership fetch: house members
see Dinners; users who are house-members-only land on Dinners and see no recruiting
views (extend the existing `data-auth-state` gate result rather than adding a second
sign-in path).

Views (all vanilla JS, Sassy classes, patterns copied from occupancy):

- **Quarter grid** — the sheet's mental model: one row per Monday, one column per
  role, month separator rows, check-in rows badged (guests disabled), per-dinner note
  inline. Own cells highlighted; empty cells render as claim buttons. Reuse the
  `.cal` grid / `.decision-chip` styles and the drawer pattern from
  `renderOccupancy` (`applications/js/app.js:3715`). Mobile (<720px): per-week cards
  instead of the grid.
- **Dinner drawer** — date, note, crew list, guest list (+ add guests, capped by
  `dinner_guest_limit`), can't-make-it list (+ toggle self), computed headcount.
  Admin extras: assign/clear any slot, edit note/time, check-in toggle, cancel.
- **Tally sidebar** — per-person `taken/target` chips (roster from `recruit_stays`),
  quarter totals taken / remaining / total; rules panel below (markdown from
  `dinner_rules`).
- **Settings additions** — Dinners section: generate quarter (pick start month →
  inserts Mondays; skips dates that already exist), guest limit, resident quota,
  rules editor, Discord channel id.

Writes are direct Supabase from the client (same as tour votes / occupancy edits):
claim = `insert` into `recruit_dinner_signups` (unique constraint surfaces "already
taken" as a friendly toast + refresh), release = `delete` own row, RSVP/guests =
`upsert` on `(dinner_id, user_id)`.

## Discord automation (`recruit-discord`)

Two additions to the existing 15-minute cron tick (same sweep that runs screening
reminders, `supabase/functions/recruit-discord/index.ts`):

1. **Sunday summary** (fires once Sunday evening, dedup-stamped): posts to
   `dinner_channel_id` — Monday's crew by role, expected guests, can't-make-it list,
   unfilled slots with a deep link (`/applications/#dinners`).
2. **Head-chef nag** (fires once when a scheduled dinner is <48h out and `head_chef`
   is unfilled): @-mention post asking for a volunteer, same deep link.

Dedup via a `posted` marker on the dinner row or the existing notification-ledger
pattern (`recruit_notifications`), whichever is cheaper at implementation time — no
new infrastructure either way.

## Versioning

- `applications` → **3.85.0** on the first implementation PR (new feature).
- `discord-membership` minor bump when the role check lands.
- `recruit-discord` minor bump when the cron behaviors land.
- One migration for the tables + settings seeds; a second data-only script for the
  one-time sheet import at cutover (current quarter's signups only).

## Cutover

1. Ship gate + schema + grid (Epics A–B), generate the *next* quarter in-app.
2. Import the in-flight quarter's remaining weeks from the sheet (one-time script).
3. Announce on Discord; sheet stays read-only for one quarter, then retire.
