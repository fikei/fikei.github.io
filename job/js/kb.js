// kb.js — thin client for the kb-read Edge Function.
// Auth: forwards the current Supabase access token from CtrlAuth.

const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/kb-read';

async function authHeader() {
  const supabase = window.CtrlAuth?.getSupabaseClient?.();
  if (!supabase) throw new Error('CtrlAuth not ready');
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('not signed in');
  return { Authorization: `Bearer ${token}` };
}

export async function readFile(path) {
  const headers = await authHeader();
  const res = await fetch(`${FN_URL}?path=${encodeURIComponent(path)}`, { headers });
  if (!res.ok) throw new Error(`kb-read ${res.status}: ${await res.text()}`);
  return res.json(); // { path, sha, content }
}

export async function listDir(path) {
  const dirPath = path.endsWith('/') ? path : path + '/';
  const headers = await authHeader();
  const res = await fetch(`${FN_URL}?path=${encodeURIComponent(dirPath)}`, { headers });
  if (!res.ok) throw new Error(`kb-read ${res.status}: ${await res.text()}`);
  return res.json(); // { path, entries: [{name,path,type,size}] }
}

window.JobKB = { readFile, listDir };
