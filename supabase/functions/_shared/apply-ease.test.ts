// deno test supabase/functions/_shared/apply-ease.test.ts
//
// Fixtures are condensed from the 2026-07-13 live audit of Ian's Saved +
// Drafting roles (see docs/strategy/prds/ladder-easy-apply.md) — each case is
// a real form shape observed on the named ATS.

import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { classifyApplyEase } from './apply-ease.ts';
import type { Schema, CustomQ } from './apply-extract.ts';

function schema(partial: Partial<Schema>): Schema {
  return {
    ats: 'greenhouse',
    source_url: 'https://job-boards.greenhouse.io/x/jobs/1',
    general: [{ id: 'email', label: 'Email', type: 'email', required: true }],
    requires: { resume: true, cover_letter: false },
    custom_questions: [],
    ...partial,
  };
}
const q = (prompt: string, type: CustomQ['type'], required = true): CustomQ =>
  ({ id: prompt.slice(0, 20).replace(/\W+/g, '_'), prompt, type, required });

Deno.test('OpenAI (Ashby) — selects + optional free text → easy', () => {
  const s = schema({
    ats: 'ashby',
    custom_questions: [
      q('Are you authorized to work in the country where the job is located?', 'yes_no'),
      q('Will you now or in the future require sponsorship for employment visa status?', 'yes_no'),
      q('Are you able to work from our US office three days per week?', 'yes_no'),
      q('When can you start a new role?', 'short_text'),
      q('Additional Information', 'long_text', false),
    ],
  });
  assertEquals(classifyApplyEase(s).tier, 'easy');
});

Deno.test('Airbnb (Greenhouse) — all selects → easy', () => {
  const s = schema({
    custom_questions: [
      q('How did you hear about this job?', 'select'),
      q('How many years experience do you have as a Product Manager?', 'select'),
      q('Which of the following best describes your 0-to-1 product management experience?', 'select'),
      q('Airbnb Candidate Privacy Policy', 'select'),
    ],
  });
  assertEquals(classifyApplyEase(s).tier, 'easy');
});

Deno.test('Maven (Greenhouse) — whitelisted short text → easy', () => {
  const s = schema({
    custom_questions: [
      q('Are you currently employed by Maven Clinic in any capacity? If so, please list current role.', 'short_text'),
      q('In which state do you hold permanent residency?', 'select'),
    ],
  });
  assertEquals(classifyApplyEase(s).tier, 'easy');
});

Deno.test('Twin Health (Greenhouse) — one non-whitelisted one-liner → short_answer', () => {
  const s = schema({
    custom_questions: [
      q('Describe your experience managing a member acquisition for a product.', 'short_text'),
      q('What is your full mailing address?', 'short_text'),
    ],
  });
  assertEquals(classifyApplyEase(s).tier, 'short_answer');
});

Deno.test('Mindbody (Greenhouse) — single "briefly describe" textarea → short_answer', () => {
  const s = schema({
    custom_questions: [
      q('Briefly describe the product you currently own. What does it do, who is your target user?', 'long_text'),
      q('What are your base salary expectations in local currency?', 'short_text'),
    ],
  });
  assertEquals(classifyApplyEase(s).tier, 'short_answer');
});

Deno.test('Midi (Greenhouse) — three required essays → essay', () => {
  const s = schema({
    custom_questions: [
      q('Why Midi?', 'long_text'),
      q('Describe one product or workflow improvement you personally worked on.', 'long_text'),
      q('Tell us about a time someone asked you for a solution but you had to decide.', 'long_text'),
    ],
  });
  assertEquals(classifyApplyEase(s).tier, 'essay');
});

Deno.test('Solace (Ashby) — video requirement → special', () => {
  const s = schema({
    ats: 'ashby',
    custom_questions: [
      q("Why does Solace's mission resonate with you?", 'long_text'),
      q("Record a video describing why you're the best person for this position.", 'long_text'),
    ],
  });
  const r = classifyApplyEase(s);
  assertEquals(r.tier, 'special');
  assertEquals(r.meta.video, true);
});

Deno.test('Splitwise — email-apply page → special', () => {
  const s = schema({
    ats: 'unknown',
    general: [],
    requires: { resume: false, cover_letter: false },
    notes: 'email_apply',
  });
  assertEquals(classifyApplyEase(s).tier, 'special');
});

Deno.test('Google Careers — account-gated host → portal', () => {
  const s = schema({
    ats: 'unknown',
    source_url: 'https://www.google.com/about/careers/applications/jobs/results/1',
  });
  assertEquals(classifyApplyEase(s).tier, 'portal');
});

Deno.test('empty extraction → unknown', () => {
  const s = schema({ general: [], requires: { resume: false, cover_letter: false }, notes: 'fallback via Haiku (unknown)' });
  assertEquals(classifyApplyEase(s).tier, 'unknown');
});

Deno.test('regression: client-rendered ashby misread as account_gated → unknown, not portal', () => {
  const s = schema({
    ats: 'ashby', source_url: 'https://jobs.ashbyhq.com/x/y',
    general: [], requires: { resume: false, cover_letter: false }, notes: 'account_gated',
  });
  assertEquals(classifyApplyEase(s).tier, 'unknown');
});

Deno.test('regression: Everlywell conditional "If yes…" long_text is not an essay', () => {
  const s = schema({
    ats: 'lever',
    custom_questions: [
      q('If yes, please describe those obligations', 'long_text'),
      q('How many years of product experience do you have?', 'short_text'),
    ],
  });
  assertEquals(classifyApplyEase(s).tier, 'easy');
});
