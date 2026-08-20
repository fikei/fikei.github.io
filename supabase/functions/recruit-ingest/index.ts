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
// Idempotent: rows dedupe by EMAIL before insert, so resending the whole
// sheet is a safe backfill, not a mess of copies. Ids are normalized name
// slugs ("jane-doe", "jane-doe-2" on duplicate names); each row also gets a
// stable uuid from the DB default (migration 159).

const VERSION = '1.7.1'
console.log(`[recruit-ingest] v${VERSION} — application sheet → recruit_applicants`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { postChannelEmbed, AUTOMATION_CHANNEL_ID } from '../_shared/discord.ts'
import { notifyTick } from '../_shared/recruit-notify.ts'
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
  ['phone', /\b(phone|mobile|cell|contact number)\b/i],
  ['pronouns', /pronoun/i],
  ['social', /(social|instagram|links?|handle)/i],
  ['residency', /(residency|full.?time|short.?term|length of stay|type of stay)/i],
  ['move_in', /(move.?in|when.*(move|start)|availability)/i],
  ['budget', /budget|rent range|afford/i],
  ['why_agape', /(why agape|why.*interested|why do you want)/i],
  ['gifts', /(gift|offer|contribute|share with the house)/i],
  ['about', /(about you|tell us about|introduce)/i],
  ['heard_from', /(how did you hear|hear about|referred|find us)/i],
  ['anything_else', /(anything else|should know|other notes)/i],
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

// Human-readable id: "jane-doe", numbered "jane-doe-2", "-3"… only when a
// name genuinely repeats. Checked against the table plus ids minted earlier
// in this batch; legacy "<slug>-YYYYMMDDHHMMSS" ids can't collide with the
// numbered form. Deduping is by email (below), so ids don't need to be
// deterministic across re-ingests. Every row also carries a stable `uuid`
// (migration 159, DB default) that survives any future id cleanup.
// deno-lint-ignore no-explicit-any
async function deriveId(client: any, first: string, last: string, used: Set<string>): Promise<string> {
  const base = slug([first, last].filter(Boolean).join(' ')) || 'applicant'
  const { data } = await client.from('recruit_applicants')
    .select('id').or(`id.eq.${base},id.like.${base}-%`)
  const taken = new Set<string>([...((data || []) as Array<{ id: string }>).map((r) => r.id), ...used])
  if (!taken.has(base)) { used.add(base); return base }
  for (let n = 2; ; n++) {
    const cand = `${base}-${n}`
    if (!taken.has(cand)) { used.add(cand); return cand }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const path = new URL(req.url).pathname
    const isPull = path.endsWith('/pull')
    const isPeek = path.endsWith('/peek')
    const isReviewImport = path.endsWith('/review-comments')
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

    // Column map for the review columns, so the importer can be written
    // against what the sheet actually holds. Header names and per-column
    // fill counts only — no applicant content leaves here.
    if (isPeek) {
      const at = await sharedAccessToken(client)
      const meta = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties.title`,
        { headers: { Authorization: `Bearer ${at}` } },
      ).then((r) => r.json())
      const tabs: string[] = (meta.sheets || []).map((sh: any) => sh.properties?.title).filter(Boolean)
      const out: Record<string, unknown> = { tabs }
      for (const tab of tabs) {
        const resp = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(tab)}`,
          { headers: { Authorization: `Bearer ${at}` } },
        )
        if (!resp.ok) { out[tab] = { error: resp.status }; continue }
        const values: string[][] = (await resp.json()).values || []
        const headers = values[0] || []
        out[tab] = {
          rows: Math.max(0, values.length - 1),
          columns: headers.map((h, i) => ({
            header: h,
            filled: values.slice(1).filter((r) => String(r[i] ?? '').trim()).length,
          })).filter((c) => c.header),
        }
      }
        return json(out)
    }

    /* Import the house's review comments off the application sheet.
       These are Google comment threads, so each one carries its author — which
       is how a review written by someone who has never opened /applications
       still lands under their name. Needs the drive.readonly scope. */
    if (isReviewImport) {
      const at = await sharedAccessToken(client)
      const cResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${SHEET_ID}/comments` +
        '?fields=comments(id,author/displayName,content,anchor,quotedFileContent/value,resolved,createdTime,replies(author/displayName,content,createdTime))&pageSize=100',
        { headers: { Authorization: `Bearer ${at}` } },
      )
      const cText = await cResp.text()
      if (!cResp.ok) {
        if (cResp.status === 403 && /scope|insufficient/i.test(cText)) {
          return json({ error: 'the shared Google account has not granted access to comments yet — reconnect it from the /applications rail footer' }, 502)
        }
        return json({ error: `comments unreadable (HTTP ${cResp.status}): ${cText.slice(0, 220)}` }, 502)
      }
      // deno-lint-ignore no-explicit-any
      const threads: any[] = JSON.parse(cText).comments || []

      // Sheet rows in order, so a comment anchored to row N resolves to the
      // applicant that row produced.
      const sheetRows = await readSheet(client)
      const emailOf = (r: Record<string, unknown>) => {
        const k = Object.keys(r).find((h) => /e-?mail/i.test(h))
        return k ? String(r[k] || '').trim().toLowerCase() : ''
      }
      // A comment's anchor is an opaque range id, but Drive hands back the
      // quoted cell — which for these threads is the row's Timestamp. That
      // string identifies the submission exactly, so it's the match key.
      const stampOf = (r: Record<string, unknown>) => {
        const k = Object.keys(r).find((h) => /timestamp|submitted/i.test(h))
        return k ? String(r[k] || '').trim() : ''
      }
      const normStamp = (v: string) => v.replace(/\s+/g, ' ').trim()
      const byStamp = new Map<string, Record<string, unknown>>()
      for (const r of sheetRows) { const st = normStamp(stampOf(r)); if (st) byStamp.set(st, r) }
      const { data: appRows } = await client.from('recruit_applicants').select('id, email, first_name, last_name')
      const byEmail = new Map((appRows || []).map((a: any) => [String(a.email || '').toLowerCase(), a]))

      // Author display name -> roster email. "K Storey-Fisher" and "Kate
      // Storey-Fisher" are the same person, so match on surname plus first
      // initial rather than the exact string.
      const { data: roster } = await client.from('recruit_group_roster').select('email, full_name')
      const key = (n: string) => {
        const parts = String(n || '').toLowerCase().replace(/[^a-z\s-]/g, '').trim().split(/\s+/)
        if (!parts.length) return ''
        return `${parts[0][0]}|${parts[parts.length - 1]}`
      }
      const rosterByKey = new Map((roster || []).map((r: any) => [key(r.full_name), r]))

      const applied: unknown[] = []
      const unmatched: unknown[] = []

      for (const t of threads) {
        const authorName = t.author?.displayName || ''
        const rosterHit = rosterByKey.get(key(authorName))
        // Every reply is part of the same person's read, but the thread's own
        // author owns the verdict; replies are appended to the body.
        const bodyParts = [String(t.content || '').trim(),
          ...(t.replies || []).map((r: any) => `${r.author?.displayName || 'reply'}: ${String(r.content || '').trim()}`)]
        const body = bodyParts.filter(Boolean).join('\n').slice(0, 4000)
        if (!body) continue

        // Resolve the applicant: the anchor's row number first, then the
        // quoted cell text (an email, or a name).
        let applicant: any = null
        const quoted = normStamp(String(t.quotedFileContent?.value || ''))
        const stampRow = quoted ? byStamp.get(quoted) : null
        if (stampRow) applicant = byEmail.get(emailOf(stampRow)) || null
        if (!applicant && quoted) {
          const em = quoted.match(/[\w.+-]+@[\w-]+\.[\w.]+/)
          if (em) applicant = byEmail.get(em[0].toLowerCase()) || null
          if (!applicant) {
            const q = quoted.toLowerCase()
            applicant = (appRows || []).find((a: any) =>
              q === `${a.first_name} ${a.last_name}`.toLowerCase().trim() ||
              q === String(a.email || '').toLowerCase()) || null
          }
        }
        if (!applicant) { unmatched.push({ author: authorName, body: body.slice(0, 120), anchor: t.anchor || null, quoted: t.quotedFileContent?.value || null }); continue }

        // Does the comment point at a decision? Only unmistakable language
        // counts; anything softer stays a comment for a human to read.
        const low = body.toLowerCase()
        const verdict =
          /\b(not a fit|no thanks|hard (no|pass)|pass on|reject|decline|don'?t think .{0,20}fit|not for us)\b/.test(low) ? 'not_fit'
          : /\b(move forward|move ahead|let'?s (meet|talk|screen|interview)|schedule|yes[!.]?$|would love|great fit|strong (yes|fit))\b/.test(low) ? 'forward'
          : null

        const row: Record<string, unknown> = {
          applicant_id: applicant.id,
          author_name: rosterHit?.full_name || authorName || 'A housemate',
          author_email: rosterHit?.email || null,
          body,
          source: 'sheet',
          created_at: t.createdTime || new Date().toISOString(),
        }
        // Same author, same applicant, same words = already imported. Checked
        // rather than upserted: the key includes the body, which is too long
        // to carry a unique index worth maintaining.
        const { data: dupe } = await client.from('recruit_comments')
          .select('id').eq('applicant_id', applicant.id).eq('source', 'sheet')
          .eq('author_name', row.author_name).eq('body', body).maybeSingle()
        if (!dryRun && !dupe) await client.from('recruit_comments').insert(row)
        if (verdict && !dryRun) {
          await client.from('recruit_votes').upsert({
            applicant_id: applicant.id, voter_id: null,
            voter_email: rosterHit?.email || null,
            voter_name: rosterHit?.full_name || authorName || 'A housemate',
            verdict, note: body.slice(0, 500), score: null, veto: false,
            updated_at: t.createdTime || new Date().toISOString(),
          }, { onConflict: 'applicant_id,voter_email' })
        }
        applied.push({
          alreadyImported: Boolean(dupe),
          applicant: `${applicant.first_name} ${applicant.last_name}`.trim(),
          author: row.author_name, authorEmail: row.author_email, verdict, body: body.slice(0, 160),
        })
      }

      const summary = `${applied.length} review comment${applied.length === 1 ? '' : 's'} from the application sheet`
      if (!dryRun && applied.length) {
        await postChannelEmbed(AUTOMATION_CHANNEL_ID,
          `📝 **${summary}**\n${applied.filter((x: any) => x.verdict).length} pointed to a decision.`,
          0x378add, summary)
      }
      return json({ dryRun, imported: applied.length, withVerdict: applied.filter((x: any) => x.verdict).length, applied, unmatched })
    }

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
        // id assigned after the email dedupe below, so numbering is only
        // consumed by rows that actually insert.
        submitted_at: submittedAt.toISOString(),
        first_name: m.first_name, last_name: m.last_name || '',
        pronouns: m.pronouns || '', email: m.email, phone: m.phone || '', social: m.social || '',
        about: m.about || '', why_agape: m.why_agape || '', gifts: m.gifts || '',
        heard_from: m.heard_from || '', residency: m.residency || '',
        anything_else: m.anything_else || '',
        move_in: m.move_in || '', budget: m.budget || '',
        // Explicit rather than the column default: rows minted by /apply carry
        // 'native', and the two paths must stay tellable-apart forever.
        source: 'sheet',
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
    // Email dedupe also shields /apply: a native applicant who ALSO fills the
    // old Google Form must never have their edited row shadowed or twinned.
    const { data: existing } = await client.from('recruit_applicants').select('id, email, source')
    const sourceByEmail = new Map((existing || []).map((e) => [String(e.email || '').toLowerCase(), String(e.source || 'sheet')]))
    const fresh: Array<Record<string, string>> = []
    for (const r of byEmail.values()) {
      const known = sourceByEmail.get(r.email.toLowerCase())
      if (known) { skipped.push(`already an applicant (${known}): ${r.email}`); continue }
      fresh.push(r)
    }
    // Ids only for rows that will actually insert — normalized name slugs,
    // numbered on duplicate names.
    const usedIds = new Set<string>()
    for (const r of fresh) {
      r.id = await deriveId(client, r.first_name, r.last_name || '', usedIds)
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
      // One Discord message per application, not two. The bare "N new
      // applications" digest is gone; instead we stamp discord_ping_at here
      // (the gmail scan used to own this, ~20 min later) and run the notify
      // tick synchronously, so the ledger's rich card — the one people reply
      // to — posts at ingest time. The 15-min cron stays as the backstop if
      // anything here fails.
      try {
        await client.from('recruit_applicants')
          .update({ discord_ping_at: new Date().toISOString() })
          .in('id', created.map((c) => c.id))
        const tick = await notifyTick(client)
        console.log(`[recruit-ingest] notify tick: ${JSON.stringify(tick).slice(0, 200)}`)
      } catch (err) {
        console.warn(`[recruit-ingest] notify tick failed (cron will catch up): ${(err as Error).message}`)
      }
    }
    console.log(`[recruit-ingest] ${created.length} created, ${byEmail.size - fresh.length} already present, ${skipped.length} skipped`)
    return json({ inserted: created.length, source: isPull ? 'sheet' : 'push', rowsRead: rows.length, ids: created.map((c) => c.id), alreadyPresent: byEmail.size - fresh.length, skipped })
  } catch (err) {
    console.error(`[recruit-ingest] ${(err as Error).message}`)
    return json({ error: (err as Error).message }, 500)
  }
})
