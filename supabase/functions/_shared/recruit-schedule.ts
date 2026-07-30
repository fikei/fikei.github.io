// _shared/recruit-schedule.ts
// Screening-call scheduling on the shared Agape Google account, used by both
// recruit-gmail (app-side "schedule" action) and recruit-discord (claim
// button). Also owns the shared-account token refresh and the short applicant
// confirmation email, so there is exactly one implementation of each.

// deno-lint-ignore-file no-explicit-any

export const SHARED_EMAIL = Deno.env.get('AGAPE_GMAIL_ADDRESS') || 'live.at.agapesf@gmail.com'
export const TZ = 'America/Los_Angeles'

const CLIENT_ID = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!
const CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!

// The shared Agape house calendar. Screenings land here so residents see
// them on the calendar they actually read, instead of only on the shared
// account's private primary. Overridable per-environment; 'primary' turns
// the whole behaviour off and restores the old placement.
export const HOUSE_CALENDAR_ID = Deno.env.get('AGAPE_HOUSE_CALENDAR_ID') ||
  'knl4pjtdvea5kk80jf1lfuvcpk@group.calendar.google.com'

// Calendars the sweep reads when matching events to applicants. 'primary'
// stays in the list: invites a housemate sent from the shared account still
// live there, and so does everything booked before this change.
export function sweepCalendars(): string[] {
  const extra = (Deno.env.get('AGAPE_EXTRA_CALENDAR_IDS') || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  return [...new Set(['primary', HOUSE_CALENDAR_ID, ...extra])]
}

// Minimal structural type so we don't pin a supabase-js version here.
type Db = any

// Refresh an access token for the shared account (recruit_gmail_account row 1).
export async function sharedAccessToken(db: Db): Promise<string> {
  const { data: acct } = await db.from('recruit_gmail_account').select('*').eq('id', 1).maybeSingle()
  if (!acct) throw new Error('Shared Gmail not connected yet')
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: acct.refresh_token, grant_type: 'refresh_token',
    }),
  })
  const tok = await resp.json()
  if (!resp.ok || !tok.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(tok).slice(0, 180)}`)
  return tok.access_token
}

export function b64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface ScheduleOpts {
  applicantId: string
  startsAt: Date
  minutes?: number
  housemateUserId: string
  housemateName: string
  housemateEmail: string
}

// Create the GCal event (both attendees + Meet) and the recruit_screenings row.
// Throws on any failure; callers map to their own error shapes.
export async function scheduleScreening(db: Db, opts: ScheduleOpts): Promise<{
  screening: any; meetLink: string | null; applicant: any
}> {
  const { data: applicant } = await db.from('recruit_applicants').select('*').eq('id', opts.applicantId).maybeSingle()
  if (!applicant?.email?.includes('@')) throw new Error('Applicant has no email')
  const endsAt = new Date(opts.startsAt.getTime() + (opts.minutes || 30) * 60000)

  const at = await sharedAccessToken(db)
  const event = {
    summary: `Agape Intro Call — ${applicant.first_name} ${applicant.last_name} × ${opts.housemateName}`,
    description: `A get-to-know-you Agape Intro Call with ${applicant.first_name}, scheduled from their offered availability.`,
    start: { dateTime: opts.startsAt.toISOString(), timeZone: TZ },
    end: { dateTime: endsAt.toISOString(), timeZone: TZ },
    /* People only. The recording bot is added afterwards, on purpose — see
       below. */
    attendees: [
      { email: applicant.email },
      ...(opts.housemateEmail.includes('@') ? [{ email: opts.housemateEmail }] : []),
    ],
    conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: true },
  }
  // Post to the house calendar so residents see the call on the calendar
  // they actually read. If the shared account only has read access there,
  // fall back to its own primary rather than failing the booking outright —
  // a screening that exists on the wrong calendar beats one that never got
  // scheduled. The fallback is logged loudly so the permission gap surfaces.
  const post = (calendarId: string) =>
    fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all&conferenceDataVersion=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })

  let calendarUsed = HOUSE_CALENDAR_ID
  let resp = await post(calendarUsed)
  if (!resp.ok && calendarUsed !== 'primary' && (resp.status === 403 || resp.status === 404)) {
    const why = await resp.text()
    console.warn(`[calendar] house calendar ${calendarUsed} rejected the event (${resp.status}) — falling back to primary. Grant "Make changes to events" to ${SHARED_EMAIL}. ${why.slice(0, 200)}`)
    calendarUsed = 'primary'
    resp = await post(calendarUsed)
  }
  const created = await resp.json()
  if (!resp.ok) throw new Error(`Calendar failed: ${JSON.stringify(created).slice(0, 200)} — if this mentions scopes, reconnect the shared Gmail to grant calendar access`)

  /* Now add the recording bot, quietly.

     The bot needs to be an ATTENDEE so Meet admits it without knocking, but it
     does not need email and cannot receive it: meet@notes.ctrl.rodeo is a
     Workspace identity on a domain with no MX record. Including it in the
     original POST meant sendUpdates=all mailed it too, and every single intro
     call bounced a delivery-failure notice back into the shared inbox.

     So the humans are invited first with sendUpdates=all, and the bot is patched
     in with sendUpdates=none: on the guest list, never mailed. The patch
     replaces the attendee array wholesale, so the existing guests are carried
     over rather than rewritten.

     A failure here is logged and swallowed — a bot that has to knock is a small
     problem, and a screening that didn't get booked is a large one. */
  const botEmail = Deno.env.get('RECALL_BOT_EMAIL')
  if (botEmail?.includes('@') && created.id) {
    try {
      const withBot = [...(created.attendees || []), { email: botEmail }]
      const patch = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarUsed)}/events/${created.id}?sendUpdates=none`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ attendees: withBot }),
        },
      )
      if (!patch.ok) {
        console.warn(`[calendar] could not add the notetaker to ${created.id}: ${(await patch.text()).slice(0, 200)}`)
      }
    } catch (err) {
      console.warn(`[calendar] could not add the notetaker: ${(err as Error).message}`)
    }
  }
  const meet = created.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === 'video')?.uri || created.hangoutLink || null

  const { data: row, error } = await db.from('recruit_screenings').insert({
    applicant_id: applicant.id, housemate_user_id: opts.housemateUserId,
    housemate_name: opts.housemateName, housemate_email: opts.housemateEmail,
    starts_at: opts.startsAt.toISOString(), ends_at: endsAt.toISOString(),
    gcal_event_id: created.id, meet_link: meet, status: 'scheduled',
    kind: 'intro_call', calendar_id: calendarUsed, title: event.summary,
  }).select().single()
  if (error) throw new Error(error.message)

  // Recording bot: "Agape Notes" joins the Meet at start time. Warn-only
  // and inert until RECALL_API_KEY is set — never blocks scheduling.
  if (meet) {
    try {
      const { recallEnabled, createRecordingBot } = await import('./recall.ts')
      if (recallEnabled()) {
        const botId = await createRecordingBot(meet, opts.startsAt.toISOString())
        await db.from('recruit_screenings').update({ recall_bot_id: botId, recall_status: 'scheduled' }).eq('id', row.id)
        row.recall_bot_id = botId
        console.log(`[recall] bot ${botId} scheduled for screening ${row.id}`)
      }
    } catch (err) {
      console.warn(`[recall] bot scheduling failed for screening ${row.id}: ${(err as Error).message}`)
    }
  }

  return { screening: row, meetLink: meet, applicant }
}

// Introduction email: replies in the applicant's existing thread from the
// shared inbox, introducing the resident (CC'd on their real email) so the
// two are directly connected. Falls back to a fresh email when the applicant
// has no thread yet (picker-only applicants). Logged to recruit_emails.
export async function sendIntroEmail(
  db: Db, applicant: any, residentName: string, residentEmail: string, startsAt: Date, meetLink: string | null,
): Promise<void> {
  const when = startsAt.toLocaleString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ,
  })
  // Latest thread with this applicant, if any — reply there so the intro
  // lands in the conversation they already have open.
  const { data: lastMail } = await db.from('recruit_emails')
    .select('thread_id, subject').eq('applicant_id', applicant.id)
    .not('thread_id', 'is', null)
    .order('sent_at', { ascending: false }).limit(1).maybeSingle()
  const subject = lastMail?.subject
    ? (/^re:/i.test(lastMail.subject) ? lastMail.subject : `Re: ${lastMail.subject}`)
    : `You're confirmed — Agape Intro Call with ${residentName}`

  const cc = residentEmail.includes('@') ? residentEmail : null
  const text = [
    `Hi ${applicant.first_name},`,
    '',
    cc
      ? `Meet ${residentName} (cc'd here) — you two are set for your Agape Intro Call on ${when} (Pacific time).`
      : `You're set for your Agape Intro Call with ${residentName} on ${when} (Pacific time).`,
    meetLink ? `Google Meet link: ${meetLink}` : `The Google Meet link is in your calendar invite.`,
    `A calendar invite from ${SHARED_EMAIL} is on its way too.`,
    '',
    `Looking forward to it!`,
    `— Agape`,
  ].join('\n')

  const at = await sharedAccessToken(db)
  const encSubject = `=?UTF-8?B?${b64url(subject).replace(/-/g, '+').replace(/_/g, '/')}?=`
  const raw = [
    `From: Agape <${SHARED_EMAIL}>`,
    `To: ${applicant.email}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    text,
  ].join('\r\n')
  const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: b64url(raw), ...(lastMail?.thread_id ? { threadId: lastMail.thread_id } : {}) }),
  })
  const sent = await resp.json()
  if (!resp.ok) throw new Error(`Intro send failed: ${JSON.stringify(sent).slice(0, 180)}`)
  await db.from('recruit_emails').upsert({
    applicant_id: applicant.id, gmail_id: sent.id, thread_id: sent.threadId,
    direction: 'out', subject, snippet: text.slice(0, 180), body_text: text,
    from_email: SHARED_EMAIL, to_email: applicant.email,
    sent_by_name: 'auto', sent_at: new Date().toISOString(),
  }, { onConflict: 'gmail_id' })
}

// Resolve the email a resident should be CC'd/invited on: the Google Group
// email from their profile when set, else their ctrl.rodeo login email.
export async function residentEmailFor(db: Db, userId: string, fallback: string): Promise<string> {
  const { data: rp } = await db.from('recruit_profiles').select('group_email').eq('user_id', userId).maybeSingle()
  const email = (rp?.group_email || fallback || '').toLowerCase().trim()
  return email
}
