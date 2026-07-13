// _shared/apply-ease.ts — classify an application-form schema into an
// "apply ease" tier. Pure function over the apply-extract Schema; no I/O.
//
// Tiers (see docs/strategy/prds/ladder-easy-apply.md):
//   easy         zero required free-response; fully auto-answerable
//   short_answer 1+ required *short* free-text answers (one-liners)
//   essay        ≥1 required long-form free-response question
//   special      video / portfolio-with-password / apply-by-email
//   portal       account-gated ATS (Google Careers, Workday logins)
//   unknown      extraction failed or produced nothing usable

import type { Schema, CustomQ } from './apply-extract.ts';

export type ApplyEaseTier = 'easy' | 'short_answer' | 'essay' | 'special' | 'portal' | 'unknown';

export type ApplyEaseMeta = {
  ats: string;
  source_url: string;
  questions: number;          // custom questions total
  required_essays: number;
  short_answers: number;      // required non-whitelisted short frees
  requires_resume: boolean;
  requires_cover_letter: boolean;
  video: boolean;
  email_apply: boolean;
  reason?: string;            // why unknown/special, for the tooltip
};

// Short free-text prompts a saved answer bank can fill without any prose:
// comp, names, addresses, links, referral names, logistics, factual history.
// Conditional follow-ups ("If yes, …", "If you selected other …") are also
// auto-skippable — they only apply when the parent answer triggers them.
const SHORT_TEXT_WHITELIST: RegExp[] = [
  /salary|compensation|\bcomp\b|pay expectation/i,
  /preferred (first )?name|legal name|full name/i,
  /mailing address|home address|current address/i,
  /linkedin|github|portfolio|website|twitter|url/i,
  /how did you hear|hear about (this|the)|referr(al|ed)|please name the employee/i,
  /notice period|start (date|a new role)|when can you start|availability/i,
  /years? of|how many years/i,
  /current (company|employer|location|role|title)|where are you (currently )?(based|located)/i,
  /^\s*if (yes|no|you selected|applicable)/i,
  /currently employed by|worked (at|for)/i,
  /country|state|city|time ?zone/i,
  /visa|sponsorship/i,
];

const VIDEO_RE = /\bvideo\b|\bloom\b|record (a|your)|video recording/i;
const PORTFOLIO_GATED_RE = /portfolio.*password|password.*portfolio/i;

// A single long_text that explicitly asks for a brief factual blurb reads as
// a short answer, not an essay session (e.g. Mindbody's "Briefly describe the
// product you currently own"). Two or more long frees is always essay tier.
const BRIEF_RE = /\bbriefly\b|in a few (sentences|words)|no more than|1-2 sentences|one or two sentences/i;

function isWhitelistedShortText(q: CustomQ): boolean {
  return SHORT_TEXT_WHITELIST.some(re => re.test(q.prompt || ''));
}

// Hosts that require an applicant account before the form is even visible.
// Workday tenants technically allow guest apply on some configs, but the
// dominant case is account-gated multi-step — classify portal until 16.2d.
const PORTAL_HOST_RE = /(^|\.)google\.com$|(^|\.)myworkdayjobs\.com$|(^|\.)workday\.com$/i;

export function classifyApplyEase(schema: Schema): { tier: ApplyEaseTier; meta: ApplyEaseMeta } {
  const custom = Array.isArray(schema.custom_questions) ? schema.custom_questions : [];
  const general = Array.isArray(schema.general) ? schema.general : [];
  const notes = String(schema.notes || '');

  const requiredEssays = custom.filter(q => q.required && q.type === 'long_text').length;
  const videoQ = custom.some(q => q.required && (VIDEO_RE.test(q.prompt || '') || PORTFOLIO_GATED_RE.test(q.prompt || '')));
  const shortFrees = custom.filter(q =>
    q.required && q.type === 'short_text' && !isWhitelistedShortText(q));
  const emailApply = /email_apply/i.test(notes);
  const accountGated = /account_gated/i.test(notes);

  const meta: ApplyEaseMeta = {
    ats: schema.ats || 'unknown',
    source_url: schema.source_url || '',
    questions: custom.length,
    required_essays: requiredEssays,
    short_answers: shortFrees.length,
    requires_resume: !!schema.requires?.resume,
    requires_cover_letter: !!schema.requires?.cover_letter,
    video: videoQ,
    email_apply: emailApply,
  };

  let host = '';
  try { host = new URL(schema.source_url || '').hostname; } catch { /* ignore */ }

  if (emailApply)                { meta.reason = 'apply by email';   return { tier: 'special', meta }; }
  if (videoQ)                    { meta.reason = 'video required';   return { tier: 'special', meta }; }
  if (accountGated || PORTAL_HOST_RE.test(host)) {
    meta.reason = 'account-gated portal';
    return { tier: 'portal', meta };
  }

  // Extraction produced nothing at all → we know nothing, don't badge it.
  if (!custom.length && !general.length && !schema.requires?.resume) {
    meta.reason = notes ? `no fields extracted (${notes.slice(0, 60)})` : 'no fields extracted';
    return { tier: 'unknown', meta };
  }

  if (requiredEssays === 1) {
    const only = custom.find(q => q.required && q.type === 'long_text');
    if (only && BRIEF_RE.test(only.prompt || '')) return { tier: 'short_answer', meta };
  }
  if (requiredEssays > 0)  return { tier: 'essay', meta };
  if (shortFrees.length)   return { tier: 'short_answer', meta };
  return { tier: 'easy', meta };
}
