# Agape move-in onboarding — from accepted to settled in

**One line:** the acceptance flow now runs all the way to the front door: confirm every
move-in fact, generate the housemate agreement, send the welcome email, pair a buddy,
and nudge the day-of email on move-in morning.

Status: **shipped v3.77.0 (2026-08-20)** — migrations 170, recruit-gmail v1.37.0.
Companion to [agape-recruiting-funnel.md](./agape-recruiting-funnel.md) (v3.75–76: the
accept & book step this picks up from).

## The flow

1. **Book the room** (`recruit_accept_applicant`, migration 168) — unchanged.
2. **Confirm move-in details** — a sheet opens right after booking (and stays reachable
   from the stay's occupancy drawer as *Move-in details…*). Every fact the email and
   agreement will state is shown prefilled and editable:
   - *Money*: lease rent (room's latest listing → room fallback), house dues,
     groceries, deposit; live total.
   - *Buddy*: select over current residents, **next up** preselected — whoever has gone
     longest without being named in `recruit_stays.buddy_name`. Editable here and later
     in the drawer. No rotation table; the history is the rotation.
   - *Links & people*: finance cc emails, Discord invite, Notion guide, onboarding
     hosts, address, arrival note — house facts, so edits write back to Settings.
   Confirming snapshots the payload to `recruit_stays.movein` (JSONB) — the email and
   agreement say what was agreed, not what the room costs later.
3. **Agreement** — `recruit-gmail generate-agreement`: copies the template Doc
   (Settings → Move-in: template Doc ID + folder ID) into the agreements folder,
   replaces `{{merge_fields}}` via the Docs API (runs on the already-granted `drive`
   scope — no reconsent), exports a PDF, stores the Doc URL on the stay. Regenerating
   re-exports the same Doc. Failure downgrades to email-without-attachment, never blocks.
   Merge fields: `housemate_name, move_in, move_out, rent, dues, food, total, deposit,
   master_tenant, master_rent, today`.
4. **Welcome email** — a fixed merge-field template (never AI: the numbers must be
   exact), matching the standard admin email: confirmation block (room + floor, kind,
   start, trial plan), then numbered sections — rent setup (apartments.com, finance
   folks cc'd), sign the agreement (PDF attached), Discord + Notion, onboarding chat,
   buddy, move-in day plan. Fully editable in the composer; **Send later** works;
   sending stamps `welcome_email_sent_at`. recruit-gmail `send` gained `cc` and
   `attachments` (multipart/mixed) for this.
5. **Day-of email** — the `movein_day` detector (15-min tick) fires on move-in morning
   for booked stays, posts a 🧳 notification, and prefills a draft (WiFi, door note,
   arrival, address from Settings → Move-in) into `recruit_email_drafts`. A human
   sends it; sending stamps `dayof_email_sent_at` and resolves the nudge. It never
   auto-sends, and it never clobbers a draft a human already saved.
6. **The drawer keeps score** — a Move-in panel on every booked stay: buddy, agreement
   (not generated → generated link → *mark signed*), welcome email sent/unsent, day-of
   email state, and the door back into the confirm sheet.

## Data

- Migration 170: `recruit_stays.buddy_name / movein / agreement_url /
  agreement_signed_at / welcome_email_sent_at / dayof_email_sent_at`.
- Settings (schema v1.3.0, new **Move-in** section): `deposit_amount`,
  `finance_contact_1/2_name`, `finance_contact_1/2_email`, `onboarding_hosts`,
  `discord_invite_url`, `notion_guide_url`, `master_tenant_name`,
  `master_rent_monthly`, `agreement_template_doc_id`, `agreement_folder_id`,
  `wifi_name`, `wifi_password`, `door_note`, `arrival_note`.

## Deliberate choices

- **Template, not AI**, for both emails — the one email where a hallucinated number
  costs real money and trust. The AI `accepted` draft remains only as a manual
  Regenerate.
- **In-app buddy rotation** derived from history — Notion stays the human-readable
  mirror, no second source of truth, no API token.
- **No Gmail drafts and no new scopes** anywhere — `gmail.compose` would force
  re-consenting the shared account.
- The agreement template Doc itself needs a content refresh (it predates
  apartments.com: still says PayPal deposit and rent by the 25th) — a Docs edit, not a
  code change.

## Not built (yet)

Signed-agreement detection from inbound email (the *mark signed* tick is manual);
apartments.com API anything; Notion invite automation; a second reminder if the buddy
never says hi.
