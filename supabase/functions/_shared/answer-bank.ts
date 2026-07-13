// _shared/answer-bank.ts — canonical application-answer registry (Phase 16.2a).
//
// One key per question employers actually ask (derived from the 2026-07-13
// form audit: ~15 canonical questions cover ~90% of forms). The matcher maps
// a form's extracted fields onto these keys with regex heuristics; the
// coverage calculator says how much of a form the saved bank can fill.

import type { Schema, CustomQ, GenField } from './apply-extract.ts';

export type CanonicalKey = string;

export type CanonicalQuestion = {
  key: CanonicalKey;
  tier: 1 | 2 | 3 | 4;
  label: string;                 // human label for Settings / onboarding
  hint?: string;                 // onboarding helper copy
  kind: 'text' | 'boolean' | 'number' | 'select' | 'json';
  match: RegExp[];               // prompt heuristics
  mapsTo?: string[];             // apply-extract general.maps_to values this key fills
};

export const CANONICAL_QUESTIONS: CanonicalQuestion[] = [
  // ---- Tier 1 — on nearly every form ----
  { key: 'legal_name',     tier: 1, label: 'Legal name',      kind: 'text',
    match: [/legal name|full name|^name$/i], mapsTo: ['full_name', 'first_name', 'last_name'] },
  { key: 'preferred_name', tier: 1, label: 'Preferred name',  kind: 'text',
    match: [/preferred (first )?name/i] },
  { key: 'email',          tier: 1, label: 'Email',           kind: 'text',
    match: [/^e-?mail/i], mapsTo: ['email'] },
  { key: 'phone',          tier: 1, label: 'Phone',           kind: 'text',
    match: [/phone|mobile|cell/i], mapsTo: ['phone'] },
  { key: 'location',       tier: 1, label: 'Current location', kind: 'text',
    match: [/where are you (currently )?(based|located)|current location|country of residence|current city|time ?zone|mailing address|full address/i],
    mapsTo: ['location'] },
  { key: 'work_auth',      tier: 1, label: 'Authorized to work in the US', kind: 'boolean',
    match: [/authoriz(ed)?.*work|legally.*work|eligible to work|work authorization/i], mapsTo: ['work_auth'] },
  { key: 'sponsorship',    tier: 1, label: 'Will require visa sponsorship', kind: 'boolean',
    match: [/sponsor|visa|work permit/i], mapsTo: ['sponsorship'] },
  { key: 'linkedin_url',   tier: 1, label: 'LinkedIn URL',    kind: 'text',
    match: [/linkedin/i], mapsTo: ['linkedin'] },
  { key: 'github_url',     tier: 1, label: 'GitHub URL',      kind: 'text',
    match: [/github/i], mapsTo: ['github'] },
  { key: 'portfolio_url',  tier: 1, label: 'Portfolio / website', kind: 'text',
    match: [/portfolio|personal (web)?site|^website|other website/i], mapsTo: ['portfolio'] },
  { key: 'pronouns',       tier: 1, label: 'Pronouns',        kind: 'text',
    match: [/pronoun/i], mapsTo: ['pronouns'] },

  // ---- Tier 2 — on 20–50% of forms ----
  { key: 'onsite_willingness', tier: 2, label: 'Onsite / hybrid willingness',
    hint: 'Metros you can work from and max days per week in office — answers every "can you work from X?" gate.',
    kind: 'json',
    match: [/office|onsite|on-?site|hybrid|days per week|in person|willing to (work|relocate|commute|go)|work from (our|the)/i] },
  { key: 'comp_expectation', tier: 2, label: 'Compensation expectation',
    hint: 'Number plus phrasing policy (range / floor / "flexible").',
    kind: 'json',
    match: [/salary|compensation|\bcomp\b|pay (expectation|range)|targeting/i] },
  { key: 'years_experience_pm', tier: 2, label: 'Years of product experience', kind: 'number',
    match: [/(how many )?years.*(product|as a pm|pm experience)|rate your.*(product|experience)|please rate/i] },
  { key: 'years_experience_mgmt', tier: 2, label: 'Years managing PMs', kind: 'number',
    match: [/years.*(managing|management|direct reports)|managing (at least )?\d* ?(product managers|pms)/i] },
  { key: 'start_date',     tier: 2, label: 'Start date / notice period', kind: 'text',
    match: [/start (date|a new role)|when can you start|notice period|availability/i] },
  { key: 'hear_about',     tier: 2, label: '"How did you hear about us" default', kind: 'text',
    match: [/how did you hear|hear about (this|the|us)/i] },

  // ---- Tier 3 — EEOC / demographics (explicit consent; default decline) ----
  { key: 'eeoc_gender',     tier: 3, label: 'Gender (EEOC)',     kind: 'text', match: [/^gender/i] },
  { key: 'eeoc_race',       tier: 3, label: 'Race / ethnicity (EEOC)', kind: 'text', match: [/^race|ethnicit/i] },
  { key: 'eeoc_veteran',    tier: 3, label: 'Veteran status (EEOC)',   kind: 'text', match: [/veteran/i] },
  { key: 'eeoc_disability', tier: 3, label: 'Disability status (EEOC)', kind: 'text', match: [/disability/i] },
  { key: 'eeoc_orientation',tier: 3, label: 'Sexual orientation (EEOC)', kind: 'text', match: [/sexual orientation|transgender/i] },

  // ---- Tier 4 — rare/conditional; defaults, never asked up front ----
  { key: 'prior_employee',  tier: 4, label: 'Previously employed by target company', kind: 'boolean',
    match: [/currently employed by|(ever|previously) worked (at|for)|current or former.*(employee|worked)/i] },
  { key: 'referral',        tier: 4, label: 'Referral name', kind: 'text',
    match: [/referr(al|ed)|name the employee|who referred/i] },
  { key: 'non_compete',     tier: 4, label: 'Non-compete / conflicting obligations', kind: 'boolean',
    match: [/non-?compete|non-?solicit|obligations that would interfere|conflict of interest/i] },
  { key: 'family_relationship', tier: 4, label: 'Family financial relationship with employer', kind: 'boolean',
    match: [/immediate family|family members? (have|with).*(relationship|employ)/i] },
  { key: 'gov_procurement', tier: 4, label: 'State procurement involvement', kind: 'boolean',
    match: [/state agency.*procurement|procurement of goods/i] },
  { key: 'sms_consent',     tier: 4, label: 'SMS consent', kind: 'boolean',
    match: [/text messages|sms|message and data rates/i] },

  // ---- Automation policies (Tier 5) — settings, never matched to form
  // questions (empty match lists), stored in the same bank for one mirror.
  { key: 'policy_cover_letter', tier: 4, label: 'Cover letter policy', kind: 'select',
    hint: 'never | when_required | auto_generate', match: [] },
  { key: 'policy_daily_cap',    tier: 4, label: 'Max submissions per day', kind: 'number', match: [] },
  { key: 'policy_review_mode',  tier: 4, label: 'Review mode', kind: 'select',
    hint: 'always (v1 — every submission gets a review screen)', match: [] },
];

const BY_KEY = new Map(CANONICAL_QUESTIONS.map(c => [c.key, c]));
export function canonicalQuestion(key: CanonicalKey) { return BY_KEY.get(key); }

// Legal/consent acknowledgements are never auto-answered from the bank —
// they always get an explicit user tap on the review screen (decision #3).
export const CONSENT_RE = /arbitration|privacy policy|acknowledge|i confirm|i certify|consent to the|terms/i;

// prompt → canonical key (heuristics only; the Haiku tail runs server-side
// for whatever this misses).
export function matchPrompt(prompt: string): CanonicalKey | null {
  const p = (prompt || '').trim();
  if (!p) return null;
  for (const c of CANONICAL_QUESTIONS) {
    if (c.match.some(re => re.test(p))) return c.key;
  }
  return null;
}

export type QuestionMapping = {
  id: string;
  prompt: string;
  required: boolean;
  type: CustomQ['type'] | GenField['type'];
  canonical_key: CanonicalKey | null;
  consent: boolean;        // needs an explicit tap regardless of the bank
  answered: boolean;       // bank has a value for the matched key
};

export type Coverage = {
  total_required: number;
  covered_required: number;
  pct: number;             // 0–100 over required fields
  ready: boolean;          // every required non-consent field covered
  mappings: QuestionMapping[];
  missing_keys: CanonicalKey[];      // matched but no saved answer
  unmatched_required: string[];      // prompts we couldn't map at all
};

// How much of a form the saved bank can fill. `answers` is the set of
// canonical keys that have a stored value.
export function computeCoverage(schema: Schema, answeredKeys: Set<string>): Coverage {
  const mappings: QuestionMapping[] = [];

  for (const g of (schema.general || [])) {
    const viaMapsTo = CANONICAL_QUESTIONS.find(c => g.maps_to && (c.mapsTo || []).includes(g.maps_to));
    const key = viaMapsTo?.key ?? matchPrompt(g.label);
    mappings.push({
      id: g.id, prompt: g.label, required: !!g.required, type: g.type,
      canonical_key: key, consent: false,
      answered: !!(key && answeredKeys.has(key)),
    });
  }
  for (const q of (schema.custom_questions || [])) {
    const consent = CONSENT_RE.test(q.prompt || '') && (q.type === 'yes_no' || q.type === 'select' || q.type === 'multiselect');
    const key = consent ? null : matchPrompt(q.prompt);
    mappings.push({
      id: q.id, prompt: q.prompt, required: !!q.required, type: q.type,
      canonical_key: key, consent,
      answered: !!(key && answeredKeys.has(key)),
    });
  }

  const req = mappings.filter(m => m.required && !m.consent);
  const covered = req.filter(m => m.answered);
  const missingKeys = [...new Set(req.filter(m => m.canonical_key && !m.answered).map(m => m.canonical_key!))]
  const unmatched = req.filter(m => !m.canonical_key).map(m => m.prompt);

  return {
    total_required: req.length,
    covered_required: covered.length,
    pct: req.length ? Math.round((covered.length / req.length) * 100) : 100,
    ready: req.length > 0 ? covered.length === req.length : false,
    mappings,
    missing_keys: missingKeys,
    unmatched_required: unmatched,
  };
}
