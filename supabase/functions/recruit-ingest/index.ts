// Supabase Edge Function: recruit-ingest
// Application intake. The application sheet pushes rows here on submit (an
// Apps Script trigger — Sheets has no native webhook), so new applicants
// land in the Inbox without a manual import.
//
// Deployed with --no-verify-jwt: the caller is a Google Apps Script, not a
// signed-in user, so it authenticates with a shared secret header instead.
//
// Two ways in:
//   PULL (primary, hourly cron) — POST /functions/v1/recruit-ingest/pull
//     auth: X-Cron-Nonce (cron) or x-ingest-secret (manual). Reads the sheet
//     with the shared Google account's token, so no secret lives in the sheet.
//   PUSH (optional, real-time) — POST /functions/v1/recruit-ingest
//     auth: x-ingest-secret. body { rows: [ { "<header>": "<value>" } ] }
//     For a Fillout/Apps Script webhook when seconds matter.
//   dryRun: true on either reports the mapping and writes nothing.
//
// Idempotent: the row's id is derived from the applicant's name + submission
// timestamp, and inserts ignore duplicates — so resending the whole sheet is
// a safe backfill, not a mess of copies.

const VERSION = '1.2.0'
console.log(`[recruit-ingest] v${VERSION} — application sheet → recruit_applicants`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { postChannelEmbed, AUTOMATION_CHANNEL_ID } from '../_shared/discord.ts'
import { sharedAccessToken } from '../_shared/recruit-schedule.ts'

// The application spreadsheet + tab, overridable so a new form or season
// doesn't need a deploy.
const SHEET_ID = Deno.env.get('RECRUIT_SHEET_ID') || '1dyDpPv7LhFSjL2Nz2E_2GMBIR-qGZg4qW4TjEkt7Epg'
const SHEET_RANGE = Deno.env.get('RECRUIT_SHEET_RANGE') || 'Form Responses 1'

/* Read the sheet as rows of { header: value } with the shared account's OAuth
   token. Needs the spreadsheets.readonly scope; until the account is
   reconnected Google answers 403, and we say exactly that rather than
   failing quietly. */
// deno-lint-ignore no-explicit-any
async function readSheet(client: any): Promise<Array<Record<string, unknown>>> {
  const at = await sharedAccessToken(client)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${at}` } })
  const text = await resp.text()
  if (!resp.ok) {
    if (resp.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(text)) {
      throw new Error('the shared Google account has not granted the Sheets scope yet — reconnect it from the /applications rail footer')
    }
    if (resp.status === 403 || resp.status === 404) {
      // Include Google's own words — "cannot read the sheet" and "wrong
      // account" look identical from the outside otherwise.
      throw new Error(`sheet unreadable by the shared account (HTTP ${resp.status}): ${text.slice(0, 220)}`)
    }
    throw new Error(`Sheets API ${resp.status}: ${text.slice(0, 200)}`)
  }
  const values: string[][] = JSON.parse(text).values || []
  if (values.length < 2) return []
  const headers = values[0]
  return values.slice(1).map((row) => {
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => { if (h) obj[String(h)] = row[i] ?? '' })
    return obj
  })
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Sheet headers drift (they get reworded, columns get added), so map by
// intent rather than exact string. First matching pattern wins.
const FIELD_PATTERNS: Array<[string, RegExp]> = [
  ['submitted_at', /^(timestamp|submitted|date submitted|submission)/i],
  ['first_name', /^(first name|first)/i],
  ['last_name', /^(last name|last|surname)/i],
  ['full_name', /^(full name|your name|name)$/i],
  ['email', /e-?mail/i],
  ['pronouns', /pronoun/i],
  ['social', /(social|instagram|links?|handle)/i],
  ['residency', /(residency|full.?time|short.?term|length of stay|type of stay)/i],
  ['move_in', /(move.?in|when.*(move|start)|availability)/i],
  ['budget', /budget|rent range|afford/i],
  ['why_agape', /(why agape|why.*interested|why do you want)/i],
  ['gifts', /(gift|offer|contribute|share with the house)/i],
  ['about', /(about you|tell us about|introduce)/i],
  ['heard_from', /(how did you hear|hear about|referred|find us)/i],
]

function mapRow(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [rawKey, rawVal] of Object.entries(row)) {
    const key = String(rawKey || '').trim()
    const val = rawVal == null ? '' : String(rawVal).trim()
    if (!key || !val) continue
    let matched = false
    for (const [field, rx] of FIELD_PATTERNS) {
      if (rx.test(key)) { matched = true; if (!out[field]) out[field] = val; break }
    }
    // Long free-text under a header we don't recognize still deserves a home:
    // the first orphan paragraph becomes "about", the next one "gifts".
    if (!matched && val.length > 120) {
      if (!out.about) out.about = val
      else if (!out.gifts) out.gifts = val
    }
  }
  if (!out.first_name && out.full_name) {
    const parts = out.full_name.split(/\s+/)
    out.first_name = parts[0]
    out.last_name = parts.slice(1).join(' ')
  }
  return out
}

const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 48)

// Same id shape the original import produced: name-slug + YYYYMMDDHHMMSS,
// so a row ingested here can never duplicate one already in the table.
function deriveId(first: string, last: string, submittedAt: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  const stamp = `${submittedAt.getFullYear()}${p(submittedAt.getMonth() + 1)}${p(submittedAt.getDate())}` +
    `${p(submittedAt.getHours())}${p(submittedAt.getMinutes())}${p(submittedAt.getSeconds())}`
  return `${slug([first, last].filter(Boolean).join(' ')) || 'applicant'}-${stamp}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const isPull = new URL(req.url).pathname.endsWith('/pull')
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = await req.json().catch(() => ({}))
    const dryRun = body.dryRun === true

    // The hourly cron presents a one-time nonce (same handshake the reminder
    // cron uses); humans and webhooks present the shared secret.
    const secret = Deno.env.get('RECRUIT_INGEST_SECRET')
    const nonce = req.headers.get('x-cron-nonce')
    let authed = Boolean(secret) && req.headers.get('x-ingest-secret') === secret
    if (!authed && nonce) {
      const { data: burned } = await client.from('recruit_cron_nonce')
        .delete().eq('nonce', nonce).gte('created_at', new Date(Date.now() - 10 * 60000).toISOString())
        .select('nonce').maybeSingle()
      authed = Boolean(burned)
    }
    if (!authed) return json({ error: 'bad or missing x-ingest-secret / x-cron-nonce' }, 401)

    let rows: Array<Record<string, unknown>>
    if (isPull) {
      try {
        rows = await readSheet(client)
      } catch (err) {
        console.error(`[recruit-ingest] pull failed: ${(err as Error).message}`)
        return json({ error: (err as Error).message }, 502)
      }
    } else {
      rows = Array.isArray(body.rows) ? body.rows
        : body.row && typeof body.row === 'object' ? [body.row] : []
      if (!rows.length) return json({ error: 'send { rows: [ {header: value} ] }' }, 400)
    }
    const prepared: Array<Record<string, string>> = []
    const skipped: string[] = []

    for (const raw of rows.slice(0, 500)) {
      const m = mapRow(raw)
      if (!m.email?.includes('@')) { skipped.push(`no email: ${JSON.stringify(raw).slice(0, 80)}`); continue }
      if (!m.first_name) { skipped.push(`no name: ${m.email}`); continue }
      const when = m.submitted_at ? new Date(m.submitted_at) : new Date()
      const submittedAt = isNaN(when.getTime()) ? new Date() : when
      prepared.push({
        id: deriveId(m.first_name, m.last_name || '', submittedAt),
        submitted_at: submittedAt.toISOString(),
        first_name: m.first_name, last_name: m.last_name || '',
        pronouns: m.pronouns || '', email: m.email, social: m.social || '',
        about: m.about || '', why_agape: m.why_agape || '', gifts: m.gifts || '',
        heard_from: m.heard_from || '', residency: m.residency || '',
        move_in: m.move_in || '', budget: m.budget || '',
      })
    }

    /* Dedupe by EMAIL, not just by id. Two things make id-only dedupe unsafe:
       the original manual import slugged accents and apostrophes differently
       (Lagelée, D'Avignon, Prud'homme), and people re-apply — the same person
       appears twice in the sheet. One row per email address is the model the
       funnel actually wants; a genuine re-applicant is better handled by a
       recruiter reopening the existing row than by a second row competing with
       it. Within a batch, the most recent application wins. */
    const byEmail = new Map<string, Record<string, string>>()
    for (const r of prepared.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))) {
      const key = r.email.toLowerCase()
      if (!byEmail.has(key)) byEmail.set(key, r)
      else skipped.push(`re-application in the same batch: ${r.email}`)
    }
    const { data: existing } = await client.from('recruit_applicants').select('id, email')
    const knownEmails = new Set((existing || []).map((e) => String(e.email || '').toLowerCase()))
    const knownIds = new Set((existing || []).map((e) => e.id))
    const fresh: Array<Record<string, string>> = []
    for (const r of byEmail.values()) {
      if (knownEmails.has(r.email.toLowerCase())) { skipped.push(`already an applicant: ${r.email}`); continue }
      if (knownIds.has(r.id)) { skipped.push(`already an applicant (id): ${r.id}`); continue }
      fresh.push(r)
    }

    if (dryRun) {
      return json({
        dryRun: true, source: isPull ? 'sheet' : 'push', rowsRead: rows.length,
        wouldInsert: fresh, alreadyPresent: byEmail.size - fresh.length, skipped,
      })
    }
    if (!fresh.length) return json({ inserted: 0, rowsRead: rows.length, alreadyPresent: byEmail.size, skipped })

    // ignoreDuplicates: resending the sheet is a backfill, not a mess.
    const { data, error } = await client.from('recruit_applicants')
      .upsert(fresh, { onConflict: 'id', ignoreDuplicates: true })
      .select('id, first_name, last_name')
    if (error) return json({ error: `insert failed: ${error.message}` }, 500)

    const created = data || []
    if (created.length) {
      // Ingest is an automation too — it belongs in the audit channel. The
      // #recruiting-society ping about these applicants follows from the
      // recruit-gmail scan, which owns ping dedup.
      try {
        const names = created.map((c) => `${c.first_name} ${c.last_name || ''}`.trim()).join(', ')
        await postChannelEmbed(AUTOMATION_CHANNEL_ID,
          `📥 **${created.length} application${created.length === 1 ? '' : 's'} ingested** from the sheet\n${names.slice(0, 800)}`,
          0x6a6c6a, `${created.length} applications ingested`)
      } catch (err) {
        console.warn(`[recruit-ingest] audit post failed: ${(err as Error).message}`)
      }
    }
    console.log(`[recruit-ingest] ${created.length} created, ${byEmail.size - fresh.length} already present, ${skipped.length} skipped`)
    return json({ inserted: created.length, source: isPull ? 'sheet' : 'push', rowsRead: rows.length, ids: created.map((c) => c.id), alreadyPresent: byEmail.size - fresh.length, skipped })
  } catch (err) {
    console.error(`[recruit-ingest] ${(err as Error).message}`)
    return json({ error: (err as Error).message }, 500)
  }
})
