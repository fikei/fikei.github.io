# Application sheet → Inbox (automated ingest)

**One line:** the application spreadsheet pushes each new row to the `recruit-ingest` edge function on submit, so applicants appear in `/applications` Inbox without a manual import.

Status: **live, API pull on an hourly cron** (`recruit-ingest` v1.1.0, migration 131) · one blocker: the shared Google account needs a reconnect to grant the Sheets scope.

---

## Why the API pull is primary

Google Sheets has no native webhook, so the two options are an Apps Script trigger inside the sheet (push) or a scheduled read through the Sheets API (pull). **Pull is the primary path** because it's more stable in the ways that matter here:

| | API pull ✅ primary | Apps Script push |
|---|---|---|
| Where the code lives | our repo, deployed + versioned | inside the spreadsheet, editable by anyone with edit access |
| Secret exposure | none — the shared account's OAuth token | the ingest secret sits in plaintext in the script |
| Failure visibility | edge-function logs + the audit channel | Apps Script disables triggers after repeated errors, silently |
| Works for hand-added rows | yes (it reads the whole tab) | no (only fires on form submit) |
| Latency | up to an hour | seconds |

An hour of latency costs nothing: the applicant has just filled in a form and isn't waiting on us. The push endpoint stays available for a Fillout-style webhook if real-time ever matters.

Because the pull is **idempotent**, re-reading the entire sheet every hour is free: ids derive from name + submission timestamp and inserts ignore duplicates.

## The endpoint

```
POST https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-ingest
headers: x-ingest-secret: <RECRUIT_INGEST_SECRET>   (Supabase secret, already set)
body:    { "rows": [ { "<sheet header>": "<value>", ... } ] }
         { "rows": [ ... ], "dryRun": true }   → returns the mapping, writes nothing
```

- **Header mapping is by intent, not exact text** — "Full Name", "Email Address", "Why Agape?", "When are you hoping to move in?" etc. all resolve. Reword a column and it keeps working; an unrecognized long answer lands in About.
- **Idempotent.** The row id is `name-slug + YYYYMMDDHHMMSS` from the submission timestamp — the same shape the original manual import produced — and inserts ignore duplicates. **Resending the whole sheet is a safe backfill**, not a pile of copies.
- Rows with no email or no name are skipped and reported in the response.
- New rows land at `stage='review'`, so the funnel picks them up: the `recruit-gmail` scan pings #recruiting-society (14-day floor, digest at 4+) and the house votes.
- Each ingest posts one audit line to #recruiting-automation.

## What runs

- **Cron** (migration 131): `recruit_application_ingest_tick`, hourly at :07, one-time-nonce auth (same handshake as the reminder cron).
- **Endpoint**: `POST /functions/v1/recruit-ingest/pull` — reads `RECRUIT_SHEET_ID` / `RECRUIT_SHEET_RANGE` (defaults to the Jan 2026+ responses sheet, tab `Form Responses 1`) with the shared account's token.
- **Prereqs**: the sheet is shared with `live.at.agapesf@gmail.com` (already true), and that account has granted `spreadsheets.readonly` — added to recruit-gmail's consent screen, so **reconnecting the shared Gmail from the /applications rail footer grants it**. Until then the pull returns a plain-English 502 saying exactly that.

## Optional: real-time push via Apps Script

1. Open the application spreadsheet → **Extensions → Apps Script**.
2. Paste this, replacing `PASTE_SECRET_HERE` with the `RECRUIT_INGEST_SECRET` value (ask Ian / read it from Supabase → Edge Functions → Secrets):

```javascript
const INGEST_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-ingest';
const INGEST_SECRET = 'PASTE_SECRET_HERE';

// Reads the header row + one data row into { header: value } and posts it.
function sendRow_(sheet, rowIndex) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  const row = {};
  headers.forEach((h, i) => { if (h) row[String(h)] = values[i]; });
  const resp = UrlFetchApp.fetch(INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-secret': INGEST_SECRET },
    payload: JSON.stringify({ rows: [row] }),
    muteHttpExceptions: true,
  });
  console.log(rowIndex + ': ' + resp.getResponseCode() + ' ' + resp.getContentText());
}

// Fires on every form submission into this sheet.
function onFormSubmit(e) {
  const sheet = e.range.getSheet();
  sendRow_(sheet, e.range.getRow());
}

// Run manually to backfill everything (safe — duplicates are ignored).
function backfillAll() {
  const sheet = SpreadsheetApp.getActiveSheet();
  for (let r = 2; r <= sheet.getLastRow(); r++) sendRow_(sheet, r);
}
```

3. **Triggers** (clock icon) → *Add trigger* → function `onFormSubmit`, event source **From spreadsheet**, event type **On form submit** → Save. Approve the one-time authorization prompt.
4. Optional: run `backfillAll` once to push history. Safe to repeat.

If the form is a Fillout/Typeform rather than a Google Form, point its native webhook at the same URL with the same header — the body just needs to be `{ "rows": [ { header: value } ] }`.

## Verifying

```bash
curl -s -X POST https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recruit-ingest \
  -H "Content-Type: application/json" -H "x-ingest-secret: $RECRUIT_INGEST_SECRET" \
  -d '{"dryRun":true,"rows":[{"Timestamp":"7/29/2026 14:22:05","Full Name":"Test Person","Email Address":"t@example.com"}]}'
```

`dryRun` shows exactly what would be written, including the derived id, and touches nothing.
