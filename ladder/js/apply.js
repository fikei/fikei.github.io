// apply.js — client for the application-draft edge function, which
// owns the Apply takeover state in job.application_draft.

const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/application-draft';
const EXTRACT_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/extract-application-fields';
const ANSWER_URL  = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/generate-question-answer';

async function authHeader() {
  const supabase = window.CtrlAuth?.getSupabaseClient?.();
  if (!supabase) throw new Error('CtrlAuth not ready');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  return { Authorization: `Bearer ${token}` };
}

export async function readApplicationDraft(slug) {
  const headers = await authHeader();
  const res = await fetch(`${FN_URL}?slug=${encodeURIComponent(slug)}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`application-draft GET ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function upsertApplicationDraft(slug, patch) {
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, ...patch }),
  });
  if (!res.ok) throw new Error(`application-draft POST ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function extractApplicationFields(slug, url) {
  const headers = await authHeader();
  const res = await fetch(EXTRACT_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, url }),
  });
  if (!res.ok) throw new Error(`extract-application-fields ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function generateQuestionAnswer(slug, q) {
  const headers = await authHeader();
  const res = await fetch(ANSWER_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      question_id: q.id,
      prompt: q.prompt,
      type: q.type,
      max_length: q.max_length || null,
      options: q.options || null,
    }),
  });
  if (!res.ok) throw new Error(`generate-question-answer ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function deleteApplicationDraft(slug) {
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  if (!res.ok) throw new Error(`application-draft DELETE ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Easy Apply answer bank (application-answers edge fn) -----------------
const ANSWERS_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/application-answers';

async function answersCall(body) {
  const headers = await authHeader();
  const res = await fetch(ANSWERS_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`application-answers ${res.status}: ${await res.text()}`);
  return res.json();
}
export const answersList       = ()        => answersCall({ action: 'list' });
export const answersUpsert     = (answers) => answersCall({ action: 'upsert', answers });
export const answersDelete     = (keys)    => answersCall({ action: 'delete', keys });
export const answersSeed       = ()        => answersCall({ action: 'seed' });
export const answersCoverage   = (slug)    => answersCall({ action: 'coverage', slug });
export const answersFromResume = (text)    => answersCall({ action: 'resume_extract', text });

// ---- Easy Apply submission (submit-application edge fn, Phase 16.2c) -------
const SUBMIT_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/submit-application';

async function submitCall(body) {
  const headers = await authHeader();
  const res = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`submit-application ${res.status}: ${await res.text()}`);
  return res.json();
}
// prepare → assembled review payload (no ATS traffic).
export const prepareApplication = (slug) => submitCall({ action: 'prepare', slug });
// submit → { status: 'submitted' | 'assisted_required' | 'consent_required'
//            | 'incomplete' | 'capped', ... }. confirm is the explicit tap.
export const submitApplication = (slug, { consents = [], overrides = {} } = {}) =>
  submitCall({ action: 'submit', slug, confirm: true, consents, overrides });

// Step ids — the takeover flow advances through these in order. Steps
// can be hidden when the extracted application schema doesn't require
// them (e.g. no cover letter requested, or no custom questions).
export const STEPS = [
  { id: 'general',   label: 'General info',  num: 1 },
  { id: 'resume',    label: 'Resume',        num: 2 },
  { id: 'cover',     label: 'Cover letter',  num: 3 },
  { id: 'questions', label: 'Questions',     num: 4 },
  { id: 'review',    label: 'Review',        num: 5 },
];

export function visibleSteps(fields) {
  const reqCover = !!fields?.requires?.cover_letter;
  const qs       = Array.isArray(fields?.custom_questions) ? fields.custom_questions : [];
  return STEPS.filter(s => {
    if (s.id === 'cover'     && !reqCover) return false;
    if (s.id === 'questions' && qs.length === 0) return false;
    return true;
  });
}
