// kbwrite.js — kb-write Edge Function client.
const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/kb-write';

async function authHeader() {
  const supabase = window.CtrlAuth?.getSupabaseClient?.();
  if (!supabase) throw new Error('CtrlAuth not ready');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  return { Authorization: `Bearer ${token}` };
}

export async function writeFile(path, content, baseSha) {
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, baseSha }),
  });
  if (!res.ok) throw new Error(`kb-write ${res.status}: ${await res.text()}`);
  return res.json();
}
