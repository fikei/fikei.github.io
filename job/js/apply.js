// apply.js — client for the application-draft edge function, which
// owns the Apply takeover state in job.application_draft.

const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/application-draft';

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
