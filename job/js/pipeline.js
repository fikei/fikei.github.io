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

export async function fetchPipeline({ sync = false } = {}) {
  const headers = await authHeader();
  const url = sync ? `${FN_URL}?sync=1` : FN_URL;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`jobs-pipe ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function setStatus(role, status) {
  // role can be { slug, rowNumber } or just a slug string for backward compat.
  const body = typeof role === 'string' ? { slug: role, status } : { slug: role.slug, rowNumber: role.rowNumber, status };
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`set-status ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function setArchived(slug, archived) {
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, archived }),
  });
  if (!res.ok) throw new Error(`set-archived ${res.status}: ${await res.text()}`);
  return res.json();
}

const GEN_ASSET_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/gen-asset';

export async function generateAsset(slug, kind) {
  const headers = await authHeader();
  const res = await fetch(GEN_ASSET_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, kind }),
  });
  if (!res.ok) throw new Error(`gen-asset ${res.status}: ${await res.text()}`);
  return res.json(); // { slug, kind, content }
}

window.JobPipeline = { fetchPipeline, setStatus, generateAsset };
