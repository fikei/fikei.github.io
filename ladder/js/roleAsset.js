// roleAsset.js — read + write per-role assets via the role-asset Edge Function.
const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/role-asset';

async function authHeader() {
  const supabase = window.CtrlAuth?.getSupabaseClient?.();
  if (!supabase) throw new Error('CtrlAuth not ready');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  return { Authorization: `Bearer ${token}` };
}

export async function readRoleAsset(slug, kind) {
  const headers = await authHeader();
  const res = await fetch(`${FN_URL}?slug=${encodeURIComponent(slug)}&kind=${encodeURIComponent(kind)}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`role-asset ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function writeRoleAsset(slug, kind, content_md) {
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, kind, content_md }),
  });
  if (!res.ok) throw new Error(`role-asset ${res.status}: ${await res.text()}`);
  return res.json();
}
