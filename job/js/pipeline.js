// pipeline.js — thin client for the jobs-pipe Edge Function.
const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/jobs-pipe';

async function authHeader() {
  const supabase = window.CtrlAuth?.getSupabaseClient?.();
  if (!supabase) throw new Error('CtrlAuth not ready');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  return { Authorization: `Bearer ${token}` };
}

export async function fetchPipeline() {
  const headers = await authHeader();
  const res = await fetch(FN_URL, { headers });
  if (!res.ok) throw new Error(`jobs-pipe ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function setStatus(rowNumber, status) {
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowNumber, status }),
  });
  if (!res.ok) throw new Error(`set-status ${res.status}: ${await res.text()}`);
  return res.json();
}

window.JobPipeline = { fetchPipeline, setStatus };
