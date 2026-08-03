// _shared/recruit-tours.ts
// The house-tour vote + confirm core, shared by recruit-discord (button
// taps confirm instantly) and recruit-gmail (the scan sweep is the safety
// net — e.g. votes that landed while house_address was still unset).

// deno-lint-ignore-file no-explicit-any

import { editTourConfirmed, slotWhen } from './discord.ts'
import { sharedAccessToken, b64url, SHARED_EMAIL } from './recruit-schedule.ts'

// "More than N housemates" — a slot confirms strictly above this number.
export async function tourThreshold(db: any): Promise<number> {
  try {
    const { data } = await db.from('recruit_settings')
      .select('value').eq('key', 'tour_confirm_votes').maybeSingle()
    const n = Number(data?.value)
    return Number.isFinite(n) && n >= 1 ? n : 4
  } catch { return 4 }
}

// Live per-slot headcounts from the vote table, keyed by slot-start ISO.
export async function tourVoteCounts(db: any, applicantId: string): Promise<Map<string, number>> {
  const { data } = await db.from('recruit_tour_votes')
    .select('slot_start').eq('applicant_id', applicantId)
  const counts = new Map<string, number>()
  for (const r of (data || [])) {
    const key = new Date(r.slot_start).toISOString()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

/* Confirm the tour if any future slot has cleared the threshold: email the
   applicant the address + the shape of the visit, stamp the row, close the
   poll. Idempotent — only a 'polled' row can transition, and the guard is a
   conditional UPDATE so a button tap and the scan sweep can race safely.
   The address comes from Settings; without it we hold rather than send an
   email that can't say where to go. */
export async function maybeConfirmTour(db: any, applicantId: string): Promise<boolean> {
  const { data: tour } = await db.from('recruit_tours')
    .select('*').eq('applicant_id', applicantId).eq('status', 'polled').maybeSingle()
  if (!tour?.discord_message_id) return false

  const threshold = await tourThreshold(db)
  const counts = await tourVoteCounts(db, applicantId)
  let best: { slot: any; n: number } | null = null
  for (const s of (tour.slots || [])) {
    if (new Date(s.start).getTime() < Date.now()) continue
    const n = counts.get(new Date(s.start).toISOString()) || 0
    if (!best || n > best.n) best = { slot: s, n }
  }
  if (!best || best.n <= threshold) return false

  const { data: addrRow } = await db.from('recruit_settings')
    .select('value').eq('key', 'house_address').maybeSingle()
  const address = typeof addrRow?.value === 'string' ? addrRow.value.trim() : ''
  if (!address) {
    console.warn(`tour for ${applicantId} cleared ${best.n} votes but house_address is unset — set it in Settings to enable auto-confirm`)
    return false
  }
  const { data: applicant } = await db.from('recruit_applicants')
    .select('first_name, email').eq('id', applicantId).maybeSingle()
  if (!applicant?.email?.includes('@')) return false

  // Claim the transition before sending, so two racing callers can't both
  // email. Losing the race is the good outcome.
  const { data: claimed } = await db.from('recruit_tours')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('applicant_id', applicantId).eq('status', 'polled')
    .select().maybeSingle()
  if (!claimed) return false

  const when = slotWhen(new Date(best.slot.start))
  const subject = `You're on — house visit at Agape (${String(best.slot.label).split(' · ')[0]})`
  const text = [
    `Hi ${applicant.first_name},`,
    '',
    `${when} works on our end — you're confirmed for a house visit!`,
    '',
    `We're at ${address}. Plan on a casual conversation in the kitchen and a tour of the house — a bunch of housemates will be around to say hi.`,
    '',
    'See you then!',
    '— the Agape house',
  ].join('\n')
  try {
    const at = await sharedAccessToken(db)
    const encSubject = `=?UTF-8?B?${b64url(subject).replace(/-/g, '+').replace(/_/g, '/')}?=`
    const raw = [
      `From: Agape <${SHARED_EMAIL}>`, `To: ${applicant.email}`, `Subject: ${encSubject}`,
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', text,
    ].join('\r\n')
    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64url(raw) }),
    })
    const sent = await resp.json()
    if (!resp.ok) throw new Error(`confirm send failed: ${JSON.stringify(sent).slice(0, 160)}`)
    await db.from('recruit_emails').upsert({
      applicant_id: applicantId, gmail_id: sent.id, thread_id: sent.threadId,
      direction: 'out', subject, snippet: text.slice(0, 180), body_text: text,
      from_email: SHARED_EMAIL, to_email: applicant.email,
      sent_by_name: 'tour poll', sent_at: new Date().toISOString(),
    }, { onConflict: 'gmail_id' })
    await db.from('recruit_tours').update({
      confirmed_slot: best.slot.start, confirmed_count: best.n,
      confirmed_at: new Date().toISOString(), confirm_gmail_id: sent.id,
      updated_at: new Date().toISOString(),
    }).eq('applicant_id', applicantId)
  } catch (err) {
    // Email failed after we claimed the row — put the poll back so the next
    // sweep retries instead of stranding a silent 'confirmed'.
    console.error(`tour confirm email failed for ${applicantId}: ${(err as Error).message}`)
    await db.from('recruit_tours').update({ status: 'polled', updated_at: new Date().toISOString() })
      .eq('applicant_id', applicantId).eq('status', 'confirmed')
    return false
  }
  await editTourConfirmed(tour.discord_channel_id, tour.discord_message_id,
    applicant.first_name, applicantId, when, best.n)
  console.log(`tour confirmed for ${applicantId}: ${best.slot.label} (${best.n} in)`)
  return true
}
