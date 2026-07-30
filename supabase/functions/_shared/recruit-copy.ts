// Shared: every word the recruiting notifications say.
//
// Detectors decide WHAT is true; this file decides HOW it is said. Nothing here
// queries anything and nothing there contains prose, so copy can be read and
// edited as one document instead of hunted through a thousand lines of SQL.
//
// A template is a sentence with {placeholders}. {subject} is always the thing
// the notification is about, and it is the hyperlink into the app — every other
// placeholder is supplied by the detector as plain text.
//
// EDITING WITHOUT A DEPLOY
// Rows in recruit_copy override the defaults below, keyed on the same string:
//
//   select recruit_set_copy('review_stalled',
//     '{subject} has been waiting {days} for someone to read their application.');
//
// An override that uses a placeholder the detector doesn't supply is rejected by
// the RPC, so a typo can't ship a sentence with a hole in it. Reset one with
// recruit_reset_copy('review_stalled'), and see them all in recruit_copy_status.

/* ---- labels -------------------------------------------------------------
   How each kind introduces itself. Single-codepoint emoji only: anything
   needing a U+FE0F variation selector renders as an empty box in Discord.
   Every kind a detector can emit must appear here — an unlisted kind falls
   back to a bullet, which is how the channel once filled with them. */
export const KINDS: Record<string, { icon: string; label: string }> = {
  // The backlog.
  application_new:        { icon: '📥', label: 'New application' },
  review_stalled:         { icon: '⏳', label: 'Waiting on a review' },
  review_backlog:         { icon: '📚', label: 'Inbox backlog' },
  needs_input:            { icon: '🙋', label: 'Second read wanted' },
  opening_at_risk:        { icon: '🏠', label: 'Opening at risk' },
  opening_overdue:        { icon: '🔴', label: 'Opening overdue' },
  room_emptying:          { icon: '📦', label: 'Room emptying' },

  // What arrives in the inbox.
  reply_availability:     { icon: '📅', label: 'Sent times' },
  reply_reschedule:       { icon: '⏰', label: 'Wants to move the call' },
  reply_plans_changed:    { icon: '🔄', label: 'Plans changed' },
  reply_withdrawing:      { icon: '👋', label: 'Withdrew' },
  reply_post_acceptance:  { icon: '🔑', label: 'Asking about moving in' },
  reply_question:         { icon: '❓', label: 'Asked a question' },
  reply_info_provided:    { icon: '📎', label: 'Sent something over' },
  reply_nudge:            { icon: '🔔', label: 'Following up' },
  reply_unclear:          { icon: '🤔', label: 'Reply needs a read' },

  // The call.
  screening_unclaimed:    { icon: '📣', label: 'Call needs a screener' },
  screening_booked:       { icon: '🤝', label: 'Call booked' },
  screening_today:        { icon: '📞', label: 'Call today' },
  screening_notes:        { icon: '📝', label: 'Recording ready' },
  screening_followup:     { icon: '⌛', label: 'Owed an answer' },

  // Where they stand.
  candidate_placed:       { icon: '✅', label: 'Passed review' },
  candidate_parked:       { icon: '🚧', label: 'No room fits yet' },
  decision_open:          { icon: '📊', label: 'Decision open' },
  candidate_promoted:     { icon: '🎉', label: 'Welcomed in' },
  gone_cold:              { icon: '💤', label: 'Gone quiet' },

  // Openings.
  listing_draft:          { icon: '📄', label: 'Draft opening' },
  listing_draft_stale:    { icon: '🐌', label: 'Draft going stale' },
  listing_has_candidates: { icon: '🎯', label: 'Ready to screen' },
  listing_no_qualifiers:  { icon: '🚫', label: 'Nobody qualifies' },
  listing_filled_no_stay: { icon: '📋', label: 'Filled but unbooked' },

  // The house.
  onboarding_owed:        { icon: '🎁', label: 'Onboarding owed' },
  occupancy_conflict:     { icon: '❗', label: 'Calendar clash' },

  // Trial votes — the two moments the whole house weighs in on someone
  // already living here.
  trial_vote_open:        { icon: '📮', label: 'Ballot open' },
  trial_vote_due:         { icon: '📢', label: 'Ballot due' },
  trial_vote_last_call:   { icon: '🚨', label: 'Last call before the meeting' },
  trial_vote_overdue:     { icon: '🟥', label: 'Ballot overdue' },
}

/* ---- sentences ----------------------------------------------------------
   One prose sentence each. A key ending in a dotted suffix is a variant the
   detector chooses between — a sentence that branches on the data reads as two
   editable lines rather than one line with a ternary buried in it. */
export const TEMPLATES: Record<string, string> = {
  // --- applicants
  'application_new':              '{subject} applied for {track}.',
  'application_new.timed':        '{subject} applied for {track}, {timing}.',
  'review_stalled':               '{subject} has been waiting {days} for a review.',
  'review_backlog':               '{subject} have never been reviewed, all of them older than {window} days.',
  'needs_input':                  '{asker} wants another read on {subject}.',
  'candidate_placed':             '{subject} passed review and fits {rooms}.',
  'candidate_parked':             '{subject} passed review but no open room fits them.',
  'gone_cold':                    '{subject} never answered the last email, sent {days} ago.',
  'candidate_promoted':           '{subject} moved into {room} on {date} as a resident.',

  // The house reaches ONE decision; housemates weigh in on it. Never a tally.
  'decision_open':                'The house needs to decide on {subject} before {date}, {days} away.',
  'decision_open.overdue':        'The house still has not decided on {subject}, who wanted to move in {date}.',

  // --- the call
  'screening_followup.undecided': "{subject} was interviewed {days} ago and the house still hasn't decided.",
  // Naming who ran the call turns "somebody should" into "you said you would".
  'screening_followup.undecided_by': "{screener} interviewed {subject} {days} ago and the house still hasn't decided.",
  'screening_followup.silent':    '{subject} was interviewed and has heard nothing for {days}.',
  'screening_followup.waiting':   '{subject} was interviewed {days} ago and is waiting on the house to decide.',
  'screening_unclaimed':          '{subject} offered times {days} ago and nobody has taken the call.',
  'screening_booked':             "{subject}'s intro call is booked for {when}.",
  'screening_booked.named':       "{screener} is taking {subject}'s intro call {when}.",
  'screening_today':              '{subject} has an intro call today at {at}.',
  'screening_today.with':         '{subject} has an intro call today at {at} with {screener}.',
  'screening_notes':              "{subject}'s recording & summary are ready.",
  'screening_notes.by':           "{screener}'s call with {subject} has its recording & summary ready.",

  // --- openings
  'listing_draft':                '{subject} came up as a draft opening from {date}.',
  'listing_draft_stale':          '{subject} has sat as a draft for {days} and is not collecting candidates yet.',
  'listing_has_candidates':       '{subject} has {count} on its shortlist and is ready for screening requests.',
  'listing_no_qualifiers':        'Nobody qualifies for {subject} because {reason}.',
  'listing_filled_no_stay':       '{subject} is marked filled from {date} but nobody is booked into it on the calendar.',
  'opening_at_risk':              '{subject} opens {date}, {days} away, and is still unfilled.',
  'opening_overdue':              '{subject} should have opened {date}, {days} ago, and is still empty.',

  // --- trial votes. The house votes at a Monday meeting, so every sentence
  // names the meeting that closes the ballot ({close}) as well as the
  // milestone it answers ({date}). No "tonight" or "this week" — the ledger
  // keeps these lines forever.
  'trial_vote_open':              '{subject} is up for their {milestone} on {date}, and the house votes at the meeting on {close}.',
  'trial_vote_open.noform':       '{subject} is up for their {milestone} on {date} and has no ballot attached yet.',
  'trial_vote_due':               "{subject}'s {milestone} lands {date}, so the ballot has to be in before the meeting on {close}.",
  'trial_vote_last_call':         "The meeting on {close} is the last one before {subject}'s {milestone} on {date}.",
  'trial_vote_overdue':           "The house still has not settled {subject}'s {milestone}, which was due {date}.",

  // --- the house
  'room_emptying':                '{subject} empties {date} when {occupant} leaves, and has no listing yet.',
  'onboarding_owed':              '{subject} moved in {days} ago and is still owed {count}.',
  'occupancy_conflict':           '{subject} have two people booked over the same dates.',

  // --- replies. Most say everything in the label; the three where the CONTENT
  // is the point splice the applicant's own ask in as a clause.
  'reply_availability':           '{subject} is free {times}.',
  'reply_availability.plain':     '{subject} sent times for a call.',
  'reply_reschedule':             '{subject} wants to move their call.',
  'reply_withdrawing':            '{subject} is no longer looking.',
  'reply_post_acceptance':        '{subject} is asking about moving in.',
  'reply_info_provided':          '{subject} sent something over.',
  'reply_nudge':                  '{subject} is following up.',
  'reply_unclear':                '{subject} replied and it needs a read.',
  'reply_plans_changed':          '{subject} told us {ask}.',
  'reply_plans_changed.plain':    "{subject}'s plans changed.",
  'reply_question':               '{subject} asked {ask}.',
  'reply_question.plain':         '{subject} asked a question.',
}

/* ---- actions ------------------------------------------------------------
   Where a notification points. In Discord the destination is carried by the
   subject itself as hyperlinked text — never a button underneath repeating what
   the sentence already links to — so these labels surface in the app and the
   catalogue rather than in the channel.

   Verb then object, no articles and no names: "Review", not "Review Chloe";
   "View profile", not "Open their profile". Identical wherever the same
   destination appears, so the same place is never called two things. */
export const ACTIONS = {
  review:     'Review',
  inbox:      'Open inbox',
  profile:    'View profile',
  calendar:   'View calendar',
  shortlist:  'View shortlist',
  listing:    'View listing',
  room:       'View room',
  emails:     'View emails',
  notes:      'View notes',
  queue:      'View queue',
  write:      'Write',
  takeCall:   'Take call',
  ballot:     'Open ballot',
} as const

// ---- rendering -------------------------------------------------------------

export type CopyVars = Record<string, string | number>

const PLACEHOLDER = /\{([a-z_]+)\}/gi

export function placeholdersIn(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1])
}

/* Fill a template. Overrides come from recruit_copy and win over the default.

   An override that references a placeholder the detector never supplies would
   render a sentence with a literal "{days}" in it, which is worse than slightly
   stale wording — so it is ignored and the default is used instead. The RPC
   rejects those at write time too; this is the second line of defence, for a row
   that predates a detector changing its variables. */
export function renderCopy(
  key: string,
  vars: CopyVars,
  overrides?: Map<string, string>,
): string {
  const fallback = TEMPLATES[key]
  const override = overrides?.get(key)
  let template = fallback

  if (override) {
    const unknown = placeholdersIn(override).filter((p) => !(p in vars))
    if (unknown.length) {
      console.warn(`[copy] override '${key}' wants {${unknown.join('}, {')}} which this notification doesn't have — using the default`)
    } else {
      template = override
    }
  }
  if (!template) {
    console.warn(`[copy] no template for '${key}'`)
    return String(vars.subject ?? '')
  }
  return template.replace(PLACEHOLDER, (_, name) =>
    name in vars ? String(vars[name]) : `{${name}}`)
}

/* Load every override in one query. Called once per tick and handed to the
   detectors, so editing copy costs one small read rather than one per
   notification. */
// deno-lint-ignore no-explicit-any
export async function loadCopyOverrides(db: any): Promise<Map<string, string>> {
  try {
    const { data } = await db.from('recruit_copy').select('key, template')
    return new Map((data || []).map((r: { key: string; template: string }) => [r.key, r.template]))
  } catch (err) {
    // Copy is a nicety; a notification going out in default wording beats one
    // not going out at all.
    console.warn(`[copy] could not load overrides: ${(err as Error).message}`)
    return new Map()
  }
}

export const icon = (kind: string) => KINDS[kind]?.icon || '•'
export const label = (kind: string) =>
  KINDS[kind]?.label || (kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' '))
