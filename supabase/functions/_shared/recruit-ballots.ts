// Shared: provisioning the ballot behind each trial milestone.
//
// A trial candidate's month-1 check-in and final decision are each answered by
// a copy of the housemate feedback form. Making those copies by hand is the one
// step of the vote that needed a person with a browser, so it is the one step
// that got skipped — a milestone would arrive with the house told to fill in a
// form nobody had made. This makes them on the cron instead.
//
// Runs once a day off the existing 15-minute recruit-discord tick (PT 8am),
// ahead of the nudge ladder in recruit-notify.ts, so a ballot created this
// morning is already linked when the day's notifications go out.
//
// SCOPE. Copying needs Drive *write* on the shared account. The account is
// currently consented to drive.readonly, so every call here 403s and is caught
// — the house still gets the "no ballot attached yet" line, which is exactly
// what is true. Re-consenting with the drive scope turns this on with no code
// change. Nothing here throws into the tick.

// deno-lint-ignore-file no-explicit-any

import { sharedAccessToken } from './recruit-schedule.ts'

type Db = any

const DRIVE = 'https://www.googleapis.com/drive/v3'

/* The template and where copies go. Both live in recruit_settings so a new
   year's form, or a reorganised Drive, is a settings edit rather than a
   deploy. Defaults are the form and folder the house uses today. */
const DEFAULT_TEMPLATE = '1UpVuMOeSItoSvXpDn2LukBOl6_y0VWfSrrqXs3RWNrk'
const DEFAULT_FOLDER = '14VM4VP1_YpcIenjg-rWn5E_i_laY9_rw'   // "Housemate Feedback"
const DEFAULT_LEAD_DAYS = 14   // make the ballot this far ahead of the meeting

const MILESTONES = [
  ['checkin', 'Month 1'],
  ['decision', 'Final decision'],
] as const

/* The Monday meeting a ballot closes at. Same rule as ballotCloses() in
   recruit-notify.ts — the name has to carry the date the nudges say. */
function closesOn(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (((d.getUTCDay() + 6) % 7) || 7))
  return d.toISOString().slice(0, 10)
}

/* The one naming convention, in code, so the folder can't drift into four of
   them: Agape vote · {member} · {Month 1 | Final decision} · {meeting date}. */
export function ballotName(occupant: string, milestone: string, close: string): string {
  return `Agape vote · ${occupant} · ${milestone} · ${close}`
}

/* What housemates get sent to. Drive hands back an /edit URL on copy; the
   nudges want the responder form, not the editor. */
const responderUrl = (fileId: string) => `https://docs.google.com/forms/d/${fileId}/viewform`

async function driveJson(token: string, url: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const reason = body?.error?.message || `HTTP ${resp.status}`
    const err = new Error(reason) as Error & { status?: number }
    err.status = resp.status
    throw err
  }
  return body
}

/* Find the copy before making one. The stay's URL column is the record, but a
   copy that landed and then failed to save would otherwise be remade every
   morning — one ballot per person per milestone is the whole point, and a
   folder with three "Final decision" forms in it is worse than none.

   supportsAllDrives / includeItemsFromAllDrives are not optional: the folder
   lives in the Agape Shared Drive, and without them Drive answers as though it
   doesn't exist. */
async function findExisting(token: string, folderId: string, name: string): Promise<string | null> {
  const q = `'${folderId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
  const out = await driveJson(token,
    `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`)
  return out.files?.[0]?.id || null
}

async function copyTemplate(token: string, templateId: string, folderId: string, name: string): Promise<string> {
  const out = await driveJson(token, `${DRIVE}/files/${templateId}/copy?supportsAllDrives=true`, {
    method: 'POST',
    body: JSON.stringify({ name, parents: [folderId] }),
  })
  if (!out.id) throw new Error('Drive returned no file id')
  return out.id
}

async function setting(db: Db, key: string, fallback: string): Promise<string> {
  const { data } = await db.from('recruit_settings').select('value').eq('key', key).maybeSingle()
  const v = data?.value
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

/* Make every ballot a live trial is about to need, and link it to the stay.
   Returns how many were created. Never throws: a Drive outage, or the missing
   write scope, must not cost the tick its screening reminders. */
export async function ensureBallots(db: Db): Promise<number> {
  const [templateId, folderId, leadRaw] = await Promise.all([
    setting(db, 'ballot_template_file_id', DEFAULT_TEMPLATE),
    setting(db, 'ballot_folder_id', DEFAULT_FOLDER),
    setting(db, 'ballot_lead_days', String(DEFAULT_LEAD_DAYS)),
  ])
  const lead = Number(leadRaw) || DEFAULT_LEAD_DAYS

  const { data: stays } = await db.from('recruit_stays')
    .select('id, kind, occupant, checkin_on, decision_on, checkin_form_url, decision_form_url')
    .eq('kind', 'candidate')
  if (!stays?.length) return 0

  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + lead * 86400000).toISOString().slice(0, 10)

  let token: string
  try {
    token = await sharedAccessToken(db)
  } catch (err) {
    console.warn(`[ballots] no shared-account token: ${(err as Error).message}`)
    return 0
  }

  let made = 0
  for (const s of stays) {
    const who = String(s.occupant || '').trim()
    if (!who) continue
    for (const [which, milestone] of MILESTONES) {
      const on: string | null = which === 'checkin' ? s.checkin_on : s.decision_on
      if (!on || (which === 'checkin' ? s.checkin_form_url : s.decision_form_url)) continue

      const close = closesOn(on)
      // Not yet worth making, or long past being useful. A milestone whose
      // meeting has already happened still gets one while the milestone itself
      // is ahead — that ballot is late, but a late ballot beats none.
      if (close > horizon || on < today) continue

      const name = ballotName(who, milestone, close)
      try {
        const fileId = await findExisting(token, folderId, name) ||
          await copyTemplate(token, templateId, folderId, name)
        const { error } = await db.from('recruit_stays')
          .update({ [`${which}_form_url`]: responderUrl(fileId) }).eq('id', s.id)
        if (error) throw new Error(error.message)
        console.log(`[ballots] ${name} → ${fileId}`)
        made++
      } catch (err) {
        const e = err as Error & { status?: number }
        // 403 here is the drive.readonly consent, not a transient fault. Say so
        // once, plainly, rather than burying it in a generic failure.
        if (e.status === 403) {
          console.warn(`[ballots] Drive refused the copy — the shared account is consented to drive.readonly. ` +
            `Reconnect it with the drive scope to let ballots make themselves. (${e.message})`)
          return made
        }
        console.warn(`[ballots] ${name} failed: ${e.message}`)
      }
    }
  }
  return made
}
