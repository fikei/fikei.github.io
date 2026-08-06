// gmail-application-classifier — Haiku-backed classifier for inbox
// messages that *might* be progress on an open pipeline application.
//
// Returns a typed event when confidence is meaningful; null when the
// message is unrelated. Confidence floors are enforced by the caller
// (gmail-jobs.ts second emitter) per the taxonomy in the PRD.

export const APPLICATION_EVENT_TYPES = [
  'applied_confirmation',
  'screen_scheduled',
  'next_round_invited',
  'take_home_assigned',
  'offer_received',
  'rejection_any_stage',
  'follow_up_needed',
  'interview_rescheduled',
  'informational',
] as const;

export type ApplicationEventType = typeof APPLICATION_EVENT_TYPES[number];

// Forward-stage auto-advance: event_type → stage to write on pipeline_roles.
export const FORWARD_AUTO_ADVANCE: Record<ApplicationEventType, { stage: 'applied' | 'interviewing'; floor: number } | null> = {
  applied_confirmation:  { stage: 'applied',       floor: 0.8  },
  screen_scheduled:      { stage: 'interviewing',  floor: 0.8  },
  next_round_invited:    { stage: 'interviewing',  floor: 0.7  },
  take_home_assigned:    { stage: 'interviewing',  floor: 0.8  },
  offer_received:        null,   // handled by AUTO_RESOLVE below
  rejection_any_stage:   null,   // handled by AUTO_RESOLVE below
  follow_up_needed:      null,
  interview_rescheduled: null,
  informational:         null,
};

// Proactive resolution (Updates-queue rev): high-confidence outcomes are
// ACTED on at scan time and surfaced as undo-able records in the Updates
// feed. Below these floors the event becomes a one-click prompt instead
// (needs_review=true) — the system never acts on a shaky classification.
export const AUTO_RESOLVE: Partial<Record<ApplicationEventType, { action: 'stage_offer' | 'archived'; floor: number }>> = {
  offer_received:      { action: 'stage_offer', floor: 0.85 },
  rejection_any_stage: { action: 'archived',    floor: 0.75 },
};

// Confidence floor to even *persist* the event row. Below this we drop
// the classification entirely (treat the message as informational noise
// rather than poisoning the timeline).
export const PERSIST_CONFIDENCE_FLOOR = 0.6;

// Confidence floor to associate gmail_thread_id with the role. Below
// this we still write the event but don't pin the thread → role mapping
// (poison-resistance per the brief).
export const THREAD_ASSOCIATION_FLOOR = 0.8;

// Offers + rejections only need review when the classification is below
// the AUTO_RESOLVE floor — at or above it the scan acts and the event
// surfaces as an undo-able record instead of a prompt.
export function shouldNeedReview(eventType: ApplicationEventType, confidence: number): boolean {
  const auto = AUTO_RESOLVE[eventType];
  if (!auto) return false;
  return confidence < auto.floor;
}

// Stages classifier may emit (used to populate application_events.detected_stage).
// Maps cleanly to the existing top-level stage enum.
export function stageForEventType(eventType: ApplicationEventType): 'applied' | 'interviewing' | 'offer' | 'rejected' | null {
  switch (eventType) {
    case 'applied_confirmation':  return 'applied';
    case 'screen_scheduled':
    case 'next_round_invited':
    case 'take_home_assigned':
    case 'interview_rescheduled': return 'interviewing';
    case 'offer_received':        return 'offer';
    case 'rejection_any_stage':   return 'rejected';
    default:                      return null;
  }
}

export interface ClassifiedApplicationEvent {
  event_type: ApplicationEventType;
  summary: string;
  confidence: number;
  round_label?: string;
  round_n?: number;
  expected_total_rounds?: number;
}

const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';

const CLASSIFY_SYSTEM = `You classify a single Gmail message that is suspected to be progress on a job application the candidate has applied to.

Return STRICT JSON, no prose:
{
  "event_type": "applied_confirmation" | "screen_scheduled" | "next_round_invited" | "take_home_assigned" | "offer_received" | "rejection_any_stage" | "follow_up_needed" | "interview_rescheduled" | "informational",
  "summary": "one short sentence (≤140 chars) — what this email says, no PII beyond what's already in the subject",
  "confidence": 0.0–1.0,
  "round_label": "phone screen" | "recruiter screen" | "hiring manager" | "take-home" | "onsite — coding" | "onsite — system design" | "debrief" | "...",
  "round_n": <int or null>,
  "expected_total_rounds": <int or null>
}

Rules:
- "applied_confirmation": automated "thanks for applying / we got your application" receipts.
- "screen_scheduled": recruiter is scheduling an INITIAL call.
- "next_round_invited": invited to a subsequent round.
- "take_home_assigned": assignment / coding exercise sent.
- "offer_received": offer letter or explicit offer language. Confidence ≥ 0.85 to count.
- "rejection_any_stage": ANY rejection or "moving forward with other candidates". Confidence ≥ 0.75.
- "follow_up_needed": "are you still interested? haven't heard from you" prompts.
- "interview_rescheduled": existing interview moved.
- "informational": no state change (newsletter, general note, FYI).
- round_label / round_n / expected_total_rounds ONLY when the email explicitly says so. Never invent them.
- If the email is ambiguous (could be applied OR could be screen), pick the lower-bound classification and lower confidence.
- NEVER fabricate. Empty / null > guess.
- The body may be truncated. Trust what you see; do not extrapolate.`;

export async function classifyApplicationMessage(args: {
  subject: string;
  sender: string;
  body: string;
  companyName: string;
  roleTitle: string;
  // Optional context to nudge the classifier when association is known
  appliedAt?: string;
  currentStage?: string | null;
}): Promise<ClassifiedApplicationEvent | null> {
  const apiKey = (Deno.env.get('LADDER_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'));
  if (!apiKey) {
    console.warn('[gmail-app-classifier] ANTHROPIC_API_KEY missing');
    return null;
  }

  const trimmed = args.body.slice(0, 6000);
  const userPrompt = [
    `Candidate applied to: ${args.companyName} — ${args.roleTitle}`,
    args.appliedAt ? `Applied at: ${args.appliedAt}` : '',
    args.currentStage ? `Current pipeline stage: ${args.currentStage}` : '',
    `Subject: ${args.subject}`,
    `From: ${args.sender}`,
    `---`,
    trimmed,
  ].filter(Boolean).join('\n');

  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { content: Array<{ type: string; text: string }> };
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  const parsed = extractFirstJsonObject(text) as Partial<ClassifiedApplicationEvent> | null;
  if (!parsed) {
    console.warn(`[gmail-app-classifier] bad JSON: ${text.slice(0, 120)}`);
    return null;
  }

  const eventType = parsed.event_type as ApplicationEventType | undefined;
  if (!eventType || !APPLICATION_EVENT_TYPES.includes(eventType)) return null;
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  const summary = (parsed.summary || '').trim().slice(0, 180);

  return {
    event_type:            eventType,
    summary,
    confidence,
    round_label:           parsed.round_label   ? String(parsed.round_label).trim().slice(0, 80) : undefined,
    round_n:               typeof parsed.round_n === 'number' ? parsed.round_n : undefined,
    expected_total_rounds: typeof parsed.expected_total_rounds === 'number' ? parsed.expected_total_rounds : undefined,
  };
}

// ── Unmatched-application extraction ───────────────────────────────────
// Second classifier used ONLY for messages that matched no pipeline role.
// Where classifyApplicationMessage is told the company/role and asked
// "what happened?", this one is asked "is this a receipt for an
// application we don't know about — and for what company/role?". The
// scan uses it to auto-create the pipeline row when the user applied
// outside Ladder (directly on an ATS careers page).

export interface ExtractedUnmatchedApplication {
  is_application_receipt: boolean;
  company: string;
  title: string;
  summary: string;
  confidence: number;
}

// Floor to auto-create a pipeline role from an unmatched receipt. Higher
// than PERSIST_CONFIDENCE_FLOOR because a wrong create pollutes the
// pipeline, not just a timeline.
export const AUTO_CREATE_CONFIDENCE_FLOOR = 0.8;

const EXTRACT_UNMATCHED_SYSTEM = `You look at a single Gmail message and decide whether it is an automated "we received your application" receipt for a job application (from an ATS like Greenhouse / Lever / Ashby / Workday, or directly from a company).

Return STRICT JSON, no prose:
{
  "is_application_receipt": true | false,
  "company": "the hiring company's name, exactly as the email presents it",
  "title": "the job title applied to, exactly as stated",
  "summary": "one short sentence (≤140 chars) — what this email says",
  "confidence": 0.0–1.0
}

Rules:
- TRUE only for receipts confirming the candidate's OWN submitted application ("we received your application for X").
- FALSE for job alerts, recruiter cold outreach, newsletters, interview scheduling, rejections, offers, and anything that is not an application receipt.
- company/title must come from the email text. If either is not stated, use "" and lower confidence.
- NEVER fabricate. Empty / false > guess.
- The body may be truncated. Trust what you see; do not extrapolate.`;

export async function extractUnmatchedApplication(args: {
  subject: string;
  sender: string;
  body: string;
}): Promise<ExtractedUnmatchedApplication | null> {
  const apiKey = (Deno.env.get('LADDER_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'));
  if (!apiKey) {
    console.warn('[gmail-app-classifier] ANTHROPIC_API_KEY missing');
    return null;
  }

  const trimmed = args.body.slice(0, 6000);
  const userPrompt = [
    `Subject: ${args.subject}`,
    `From: ${args.sender}`,
    `---`,
    trimmed,
  ].join('\n');

  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      system: EXTRACT_UNMATCHED_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { content: Array<{ type: string; text: string }> };
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  const parsed = extractFirstJsonObject(text) as Partial<ExtractedUnmatchedApplication> | null;
  if (!parsed) {
    console.warn(`[gmail-app-classifier] bad JSON (unmatched): ${text.slice(0, 120)}`);
    return null;
  }
  return {
    is_application_receipt: parsed.is_application_receipt === true,
    company:    String(parsed.company || '').trim().slice(0, 120),
    title:      String(parsed.title || '').trim().slice(0, 200),
    summary:    String(parsed.summary || '').trim().slice(0, 180),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}

// ── Unmatched-opportunity extraction ───────────────────────────────────
// Third classifier, used ONLY for messages in threads the USER has
// replied to that matched no pipeline role. Where the receipt extractor
// asks "is this an application receipt?", this one asks "is this an
// active job conversation — recruiter outreach the candidate engaged
// with, a hiring-manager back-and-forth, interview scheduling — for a
// role Ladder doesn't know about?". The scan uses it to create the
// pipeline row for opportunities that never had a saved posting.

export interface ExtractedUnmatchedOpportunity {
  is_job_opportunity: boolean;
  company: string;
  title: string;
  stage: 'applied' | 'interviewing' | 'offer';
  url: string | null;
  summary: string;
  confidence: number;
}

const EXTRACT_OPPORTUNITY_SYSTEM = `You look at a single Gmail message from a thread the candidate has personally replied to, and decide whether it is part of an ACTIVE job opportunity conversation for the candidate — e.g. a recruiter or hiring manager discussing a specific role with them, scheduling interviews, sharing next steps, or extending an offer.

Return STRICT JSON, no prose:
{
  "is_job_opportunity": true | false,
  "company": "the hiring company's name, exactly as the email presents it",
  "title": "the role under discussion, exactly as stated ('' if never named)",
  "stage": "applied" | "interviewing" | "offer",
  "url": "direct link to the job posting if one appears in the email (ATS/careers link), else null",
  "summary": "one short sentence (≤140 chars) — where this conversation stands",
  "confidence": 0.0–1.0
}

Rules:
- TRUE only for a live, two-way conversation about a specific opportunity FOR the candidate. The thread context (candidate replied) is already established; judge whether the content is about them being hired.
- FALSE for job alerts, newsletters, cold outreach with no specifics, sales/vendor threads, networking chats with no role, the candidate hiring someone else, and personal email.
- stage: "interviewing" when calls/interviews are being scheduled or have happened; "offer" only on explicit offer language; otherwise "applied".
- company/title must come from the email text (sender domain may inform company). If company is not identifiable, use "" and low confidence.
- url must be copied verbatim from the email (a job-posting/ATS link, not meeting/calendar/tracking links). null when no posting link is present.
- NEVER fabricate. Empty / false > guess.
- The body may be truncated. Trust what you see; do not extrapolate.`;

export async function extractUnmatchedOpportunity(args: {
  subject: string;
  sender: string;
  body: string;
}): Promise<ExtractedUnmatchedOpportunity | null> {
  const apiKey = (Deno.env.get('LADDER_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'));
  if (!apiKey) {
    console.warn('[gmail-app-classifier] ANTHROPIC_API_KEY missing');
    return null;
  }

  const trimmed = args.body.slice(0, 6000);
  const userPrompt = [
    `Subject: ${args.subject}`,
    `From: ${args.sender}`,
    `---`,
    trimmed,
  ].join('\n');

  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      system: EXTRACT_OPPORTUNITY_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { content: Array<{ type: string; text: string }> };
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  const parsed = extractFirstJsonObject(text) as Partial<ExtractedUnmatchedOpportunity> | null;
  if (!parsed) {
    console.warn(`[gmail-app-classifier] bad JSON (opportunity): ${text.slice(0, 120)}`);
    return null;
  }
  const stage = parsed.stage === 'interviewing' || parsed.stage === 'offer' ? parsed.stage : 'applied';
  const rawUrl = String(parsed.url || '').trim();
  return {
    is_job_opportunity: parsed.is_job_opportunity === true,
    company:    String(parsed.company || '').trim().slice(0, 120),
    title:      String(parsed.title || '').trim().slice(0, 200),
    stage,
    url:        /^https?:\/\//i.test(rawUrl) ? rawUrl.slice(0, 500) : null,
    summary:    String(parsed.summary || '').trim().slice(0, 180),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}

// Tolerant JSON extractor — mirrors the pattern in gmail-jobs.ts. Haiku
// occasionally appends commentary or wraps in fences; this absorbs that.
function extractFirstJsonObject(text: string): unknown {
  const stripped = text.replace(/```json\s*/gi, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const candidate = stripped.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { return null; }
      }
    }
  }
  return null;
}

// Known ATS-platform sender domains. Messages from these addresses about
// pipeline companies are first-class candidates for classification even
// when the company domain doesn't match the sender.
export const ATS_PLATFORM_DOMAINS = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'us.greenhouse-mail.io',
  'eu.greenhouse-mail.io',
  'mail.greenhouse.io',
  'lever.co',
  'hire.lever.co',
  'ashbyhq.com',
  'us.ashbyhq.com',
  'smartrecruiters.com',
  'icims.com',
  'workday.com',
  'myworkday.com',
  'myworkdayjobs.com',
  'jobvite.com',
  'bamboohr.com',
  'workable.com',
  'rippling.com',
  'gem.com',
];
