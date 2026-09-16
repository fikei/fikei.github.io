// Supabase Edge Function: mail-watch
// Package delivery notices → Discord #mail.
//
// Why this exists: packages pile up at the house and nobody knows whose they
// are. The Shop app has the nicest version of this notification and no way to
// get it out — shop.app has no consumer API, and its delivery alerts are push
// only (the mail it sends is marketing). But Shop is just an aggregator, and
// we can read the same upstream it does: the merchant "delivered" mail that
// is already sitting in the inbox.
//
// POST /functions/v1/mail-watch/scan   (X-Cron-Nonce, or X-Cron-Secret)
//   → { scanned, new: n, posted: n, skipped: n }
// POST /functions/v1/mail-watch/scan?dry=1
//   → same, but classifies and reports without writing or posting.
//
// PRIVACY: this posts the MERCHANT and nothing else. A delivery notice names
// what somebody bought and #mail is a room, not a DM. Item names are never
// stored (migration 180 has no column for them) and never posted. Bodies are
// read by the classifier in flight and discarded.
//
// Design: docs/infrastructure/technical-design/package-mail-notifications.md

const VERSION = '0.1.0'
console.log(`[mail-watch] v${VERSION} — merchant-only delivery notices from Gmail to Discord #mail`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getAccessToken, getServiceClient, userIdForEmail, GMAIL_READONLY_SCOPE } from '../_shared/google-tokens.ts'
import { postPlainEmbed } from '../_shared/discord.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-nonce, x-cron-secret',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const TZ = 'America/Los_Angeles'

/* Which inboxes to sweep, as "email:Label,email:Label".
   Two entries for one person is not a mistake — the delivery mail splits by
   merchant: Amazon goes to the .edu address, the Shopify stores to gmail.
   Phase 2 replaces this env with a table of housemates who have connected. */
function inboxes(): Array<{ email: string; label: string }> {
  const raw = Deno.env.get('MAIL_WATCH_INBOXES') || ''
  return raw.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
    const i = pair.lastIndexOf(':')
    return i === -1
      ? { email: pair, label: pair.split('@')[0] }
      : { email: pair.slice(0, i).trim(), label: pair.slice(i + 1).trim() }
  })
}

/* Gmail-side prefilter. Deliberately broad on the subject and narrow on time:
   the LLM pass below is what costs money, so we only want it seeing mail that
   at least claims to be about a delivery. Every observed shape tokenizes to
   `subject:delivered` — "Delivered: 1 Electronics item", "Your order was
   delivered.", "A shipment from order #2684 has been delivered", "Your
   Arc'teryx Order … Has Been Delivered".

   The window is a day against a 15-minute cron. That overlap is intentional:
   gmail_msg_id is unique, so re-scanning is free, and a few hours of function
   downtime costs nothing. */
const GMAIL_QUERY = Deno.env.get('MAIL_WATCH_QUERY')
  || 'newer_than:1d (subject:delivered OR subject:arrived OR subject:"out for delivery")'

interface GmailMsgRef { id: string }

async function listMessageIds(accessToken: string): Promise<string[]> {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  url.searchParams.set('q', GMAIL_QUERY)
  url.searchParams.set('maxResults', '50')
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!resp.ok) throw new Error(`gmail list ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const data = await resp.json() as { messages?: GmailMsgRef[] }
  return (data.messages || []).map((m) => m.id)
}

interface Fetched { id: string; from: string; subject: string; snippet: string; date: string | null }

async function fetchMessage(accessToken: string, id: string): Promise<Fetched | null> {
  // metadata format: headers + snippet, no body. Enough for the classifier
  // and it means the full body never crosses this function at all.
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`)
  url.searchParams.set('format', 'metadata')
  for (const h of ['From', 'Subject', 'Date']) url.searchParams.append('metadataHeaders', h)
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!resp.ok) {
    console.warn(`[mail-watch] gmail get ${id} → ${resp.status}`)
    return null
  }
  const data = await resp.json() as {
    snippet?: string
    internalDate?: string
    payload?: { headers?: Array<{ name: string; value: string }> }
  }
  const header = (name: string) =>
    data.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
  return {
    id,
    from: header('From'),
    subject: header('Subject'),
    snippet: data.snippet || '',
    date: data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null,
  }
}

interface Verdict { is_delivery: boolean; merchant: string | null; carrier: string | null; confidence: number }
const NOT_A_DELIVERY: Verdict = { is_delivery: false, merchant: null, carrier: null, confidence: 0 }

/* Below this a message is dropped rather than posted. Same discipline as
   recruit-gmail's INTENT_FLOOR: a missed package is a minor annoyance, a
   channel that cries wolf gets muted and then the whole thing is worthless. */
const CONFIDENCE_FLOOR = Number(Deno.env.get('MAIL_WATCH_FLOOR') || '0.7')

/* A regex cannot do this job. The same inbox that holds "A shipment from
   order #420590 has been delivered" also holds "Award-winning health care
   journalism, delivered free" and "Taco Bell, delivered by Claude" — both of
   which match any keyword rule you would write, and both of which would post
   a fake package to the channel. */
async function classify(msg: Fetched): Promise<Verdict> {
  const key = Deno.env.get('RECRUIT_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) throw new Error('no Anthropic API key set')

  const prompt = `You are deciding whether an email is a notification that a physical package HAS ALREADY BEEN DELIVERED to someone's home.

Return true for is_delivery ONLY when the email is telling the recipient that a shipment they ordered has arrived. 

Return false for everything else, including:
- marketing that merely uses the word "delivered" ("journalism, delivered free", "have your medication delivered")
- shipping confirmations, "on its way", "out for delivery", delays — the package is not there yet
- order confirmations, receipts, review requests, abandoned-cart mail
- anything about food delivery, newsletters, or software

Also extract:
- "merchant": the store or sender the package is from, as a person would say it — "Amazon", "Garage Grown Gear", "Arc'teryx", "CVS". Use the brand, not the email domain or a shipping middleman. If a fulfilment service (ShipStation, ShipBob) sent it and the real store is not identifiable, return null.
- "carrier": USPS, UPS, FedEx, DHL, Amazon — only if explicitly named. Else null.
- "confidence": 0-1, how sure you are of is_delivery. Be harsh. Below ${CONFIDENCE_FLOOR} we drop the message rather than post it.

Do NOT return the item names, order numbers, or anything about what was purchased. They are deliberately not wanted.

FROM: ${msg.from}
SUBJECT: ${msg.subject}
PREVIEW: ${msg.snippet.slice(0, 500)}

Return one JSON object: {"is_delivery":..., "merchant":..., "carrier":..., "confidence":...}. No prose.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const data = await resp.json() as { content?: Array<{ text?: string }> }
  const text = data.content?.[0]?.text || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return NOT_A_DELIVERY
  try {
    const p = JSON.parse(match[0]) as Partial<Verdict>
    return {
      is_delivery: Boolean(p.is_delivery),
      merchant: p.merchant || null,
      carrier: p.carrier || null,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0,
    }
  } catch {
    return NOT_A_DELIVERY
  }
}

function embedText(ownerLabel: string, merchant: string | null, carrier: string | null, deliveredAt: string | null): string {
  const who = `📦 **${ownerLabel}**`
  const what = merchant ? ` — a package from ${merchant}` : ' — a package arrived'
  const bits: string[] = []
  if (carrier) bits.push(carrier)
  if (deliveredAt) {
    bits.push(new Date(deliveredAt).toLocaleString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ,
    }).toLowerCase().replace(' am', 'a').replace(' pm', 'p'))
  }
  return bits.length ? `${who}${what}\n${bits.join(' · ')}` : `${who}${what}`
}

async function scanInbox(
  db: SupabaseClient, channelId: string, inbox: { email: string; label: string }, dry: boolean,
): Promise<{ scanned: number; created: number; posted: number; skipped: number }> {
  const out = { scanned: 0, created: 0, posted: 0, skipped: 0 }

  const userId = await userIdForEmail(db, inbox.email)
  if (!userId) {
    console.warn(`[mail-watch] no auth user for ${inbox.email} — skipping`)
    return out
  }
  const token = await getAccessToken(db, userId, [GMAIL_READONLY_SCOPE])
  if (!token) {
    console.warn(`[mail-watch] ${inbox.email} has not connected Gmail — skipping`)
    return out
  }

  const ids = await listMessageIds(token.accessToken)
  out.scanned = ids.length
  if (!ids.length) return out

  // One round trip for the dedupe, not one per message.
  const { data: seen } = await db.from('mail_deliveries').select('gmail_msg_id').in('gmail_msg_id', ids)
  const known = new Set((seen || []).map((r: { gmail_msg_id: string }) => r.gmail_msg_id))
  const fresh = ids.filter((id) => !known.has(id))
  out.skipped = ids.length - fresh.length

  for (const id of fresh) {
    try {
      const msg = await fetchMessage(token.accessToken, id)
      if (!msg) continue
      const verdict = await classify(msg)
      if (!verdict.is_delivery || verdict.confidence < CONFIDENCE_FLOOR) {
        console.log(`[mail-watch] drop ${id} (${verdict.confidence.toFixed(2)}): ${msg.subject.slice(0, 60)}`)
        continue
      }
      if (dry) {
        console.log(`[mail-watch] DRY would post: ${embedText(inbox.label, verdict.merchant, verdict.carrier, msg.date).replace(/\n/g, ' | ')}`)
        out.created++
        continue
      }

      /* Insert BEFORE posting. If the post throws, the row stays with
         posted_at null and the channel simply never hears about this one —
         the failure mode is a missed notice, not the same package announced
         on every tick for the rest of the day. */
      const { error: insErr } = await db.from('mail_deliveries').insert({
        gmail_msg_id: id,
        inbox_email: inbox.email,
        owner_label: inbox.label,
        merchant: verdict.merchant,
        carrier: verdict.carrier,
        delivered_at: msg.date,
        confidence: verdict.confidence,
      })
      if (insErr) {
        // 23505 = another tick beat us to it. Not an error worth logging loudly.
        if (!insErr.message.includes('duplicate')) console.warn(`[mail-watch] insert ${id}: ${insErr.message}`)
        continue
      }
      out.created++

      const posted = await postPlainEmbed(
        channelId, embedText(inbox.label, verdict.merchant, verdict.carrier, msg.date), 0xb5834a,
      )
      await db.from('mail_deliveries')
        .update({ posted_at: new Date().toISOString(), discord_msg_id: posted?.id ?? null })
        .eq('gmail_msg_id', id)
      out.posted++
    } catch (err) {
      console.error(`[mail-watch] ${inbox.email} msg ${id}: ${(err as Error).message}`)
    }
  }
  return out
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const reqUrl = new URL(req.url)
  if (!reqUrl.pathname.endsWith('/scan')) return json({ error: 'not found' }, 404)

  const db = getServiceClient()

  // Auth: the one-time cron nonce (migration 180), or a shared secret for
  // manual runs. Same handshake as recruit-gmail's /scan.
  const secret = Deno.env.get('CRON_SECRET')
  let authorized = Boolean(secret) && req.headers.get('x-cron-secret') === secret
  const nonce = req.headers.get('x-cron-nonce')
  if (!authorized && nonce && /^[0-9a-f-]{36}$/i.test(nonce)) {
    const { data: burned } = await db.from('recruit_cron_nonce')
      .delete().eq('nonce', nonce)
      .gte('created_at', new Date(Date.now() - 10 * 60000).toISOString())
      .select().maybeSingle()
    authorized = Boolean(burned)
  }
  if (!authorized) return json({ error: 'unauthorized' }, 401)

  try {
    const dry = reqUrl.searchParams.get('dry') === '1'

    /* No default channel on purpose. Falling back to a recruiting channel
       would publish who is getting packages to an audience scoped for
       something else — better to do nothing and say so. */
    const channelId = Deno.env.get('MAIL_CHANNEL_ID')
    if (!channelId && !dry) {
      console.warn('[mail-watch] MAIL_CHANNEL_ID not set — nothing to post to')
      return json({ error: 'MAIL_CHANNEL_ID not set', scanned: 0, new: 0, posted: 0 }, 200)
    }

    const list = inboxes()
    if (!list.length) {
      console.warn('[mail-watch] MAIL_WATCH_INBOXES not set — nothing to scan')
      return json({ error: 'MAIL_WATCH_INBOXES not set', scanned: 0, new: 0, posted: 0 }, 200)
    }

    const totals = { scanned: 0, created: 0, posted: 0, skipped: 0 }
    for (const inbox of list) {
      try {
        const r = await scanInbox(db, channelId || '', inbox, dry)
        totals.scanned += r.scanned
        totals.created += r.created
        totals.posted += r.posted
        totals.skipped += r.skipped
      } catch (err) {
        // One dead inbox must not stop the others.
        console.error(`[mail-watch] inbox ${inbox.email}: ${(err as Error).message}`)
      }
    }
    console.log(`[mail-watch] scanned ${totals.scanned}, new ${totals.created}, posted ${totals.posted}, already seen ${totals.skipped}`)
    return json({ scanned: totals.scanned, new: totals.created, posted: totals.posted, skipped: totals.skipped, dry })
  } catch (err) {
    console.error(`[mail-watch] ${(err as Error).message}`)
    return json({ error: (err as Error).message }, 500)
  }
})
