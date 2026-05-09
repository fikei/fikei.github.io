// pipeline.js — thin client for the jobs-pipe Edge Function.
const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/jobs-pipe';
const LIVENESS_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/check-liveness';
const ADD_ROLE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/add-role';
const REC_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recommendations';

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

export async function setStatus(role, status) {
  const slug = typeof role === 'string' ? role : role.slug;
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, status }),
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

export async function deleteRole(slug) {
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, action: 'delete' }),
  });
  if (!res.ok) throw new Error(`delete-role ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function addRole({ url, title, company, sector, source, fromRecommendationId } = {}) {
  const headers = await authHeader();
  const res = await fetch(ADD_ROLE_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title, company, sector, source, fromRecommendationId }),
  });
  if (!res.ok) throw new Error(`add-role ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchRecommendations() {
  const headers = await authHeader();
  const res = await fetch(REC_URL, { headers });
  if (!res.ok) throw new Error(`recommendations ${res.status}: ${await res.text()}`);
  return res.json();
}
export async function dismissRecommendation(id) {
  const headers = await authHeader();
  const res = await fetch(REC_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, dismiss: true }),
  });
  if (!res.ok) throw new Error(`dismiss-rec ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function checkLiveness({ slug } = {}) {
  const headers = await authHeader();
  const res = await fetch(LIVENESS_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(slug ? { slug } : {}),
  });
  if (!res.ok) throw new Error(`check-liveness ${res.status}: ${await res.text()}`);
  return res.json();
}

// Stash a role row in sessionStorage so the detail page can paint title/
// company/tags instantly on next load. Read with readRolePrefill(slug).
export function stashRolePrefill(role) {
  if (!role?.slug) return;
  try {
    sessionStorage.setItem(`job:rolePrefill:${role.slug}`, JSON.stringify({
      slug: role.slug,
      company: role.company,
      title: role.title,
      sector: role.sector,
      sectorTags: role.sectorTags || [],
      score: role.score,
      status: role.status,
      url: role.url,
      salary: role.salary,
      source: role.source,
      first_seen: role.first_seen,
      last_seen: role.last_seen,
      archivedAt: role.archivedAt,
      hasResume: role.hasResume,
      hasCoverLetter: role.hasCoverLetter,
    }));
  } catch { /* sessionStorage unavailable — silently skip */ }
}
export function readRolePrefill(slug) {
  try {
    const raw = sessionStorage.getItem(`job:rolePrefill:${slug}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
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
