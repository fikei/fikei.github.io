# Application sheet → Inbox (automated ingest)

**One line:** the application spreadsheet pushes each new row to the `recruit-ingest` edge function on submit, so applicants appear in `/applications` Inbox without a manual import.

Status: **endpoint live** (`recruit-ingest` v1.0.1) · **one setup step left in the sheet** (below).

---

## Why push, not pull

Google Sheets has no native webhook. The two real options:

| Approach | Latency | Cost to set up | Notes |
|---|---|---|---|
| **Apps Script trigger → our endpoint** ✅ chosen | seconds | paste one script into the sheet, once | No new OAuth scopes. The sheet already has permission to read itself. |
| Scheduled pull via pg_cron + Sheets API | up to an hour | reconnect the shared Google account with an added `spreadsheets.readonly` scope, or share the sheet with a service account | More moving parts, and a scope change re-triggers the OAuth consent dance. |

Push wins because it needs no new Google permissions and lands applicants while the applicant is still warm — the Discord ping and the vote can happen the same hour.

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

## Setup: the Apps Script (one time, in the sheet)

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
