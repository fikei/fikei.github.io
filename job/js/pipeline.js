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
  return updateRole(role, { status });
}

// Write status / stage / exit_reason in one request. The server applies
// the auto-promote rule (any stage set → status='Active') and validates
// exit_reason on transitions to Archive.
export async function updateRole(role, patch) {
  const slug = typeof role === 'string' ? role : role.slug;
  const headers = await authHeader();
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, ...patch }),
  });
  if (!res.ok) throw new Error(`update-role ${res.status}: ${await res.text()}`);
  return res.json();
}

// Stamp engaged_at on a pipeline row. Called from the drill page on
// open and from Apply-button clicks — a passive signal that drives
// the "In progress" pill on Saved rows. Idempotent (server only
// writes on first call) and keepalive:true so it survives the
// navigation that follows an Apply tap.
export async function engageRole(slug) {
  if (!slug) return;
  try {
    const headers = await authHeader();
    await fetch(FN_URL, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, action: 'engage' }),
      keepalive: true,
    });
  } catch { /* engagement is fire-and-forget */ }
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

export async function fetchRecommendations(opts = {}) {
  const headers = await authHeader();
  // opts.view === 'all' → full list (no fit-score floor) for the
  // "Recommended for you" page. Default is the carousel/widget view.
  const url = opts.view === 'all' ? `${REC_URL}?view=all` : REC_URL;
  const res = await fetch(url, { headers });
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
  const body = kind === 'base-resume' ? { kind } : { slug, kind };
  const res = await fetch(GEN_ASSET_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gen-asset ${res.status}: ${await res.text()}`);
  return res.json(); // { slug, kind, content }
}

// Send raw resume text through Claude to get well-formatted markdown back.
// Stateless on the server — caller is responsible for persisting the result.
export async function formatResumeText(rawText) {
  const headers = await authHeader();
  const res = await fetch(GEN_ASSET_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'format-resume', raw_text: rawText }),
  });
  if (!res.ok) throw new Error(`gen-asset ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.content;
}

// Get AI rationale + opportunities for a cover letter given the role-analysis
// source bullets. Returns { highlights, opportunities }; empty arrays on
// failure. Stateless on the server.
export async function fetchCoverRationale(coverText, sources) {
  const headers = await authHeader();
  const res = await fetch(GEN_ASSET_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'cover-rationale', cover_text: coverText, sources }),
  });
  if (!res.ok) throw new Error(`gen-asset ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return {
    highlights:    Array.isArray(j.highlights)    ? j.highlights    : [],
    opportunities: Array.isArray(j.opportunities) ? j.opportunities : [],
  };
}

// Append a markdown snippet to job.global_assets kind='narrative-additions'.
// Used to capture missing info volunteered through opportunity threads.
export async function addNarrative({ snippet, sourceRole, ask }) {
  const headers = await authHeader();
  const res = await fetch(GEN_ASSET_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'narrative-add', snippet, source_role: sourceRole, ask }),
  });
  if (!res.ok) throw new Error(`gen-asset ${res.status}: ${await res.text()}`);
  return res.json();
}

// Apply a chat-driven edit to the cover letter. `comment` is optional
// {label, anchor_phrase, rationale} for surgical, comment-anchored edits;
// without it the AI treats `instruction` as a doc-wide directive.
export async function applyCoverEdit({ coverText, instruction, comment }) {
  const headers = await authHeader();
  const body = { kind: 'cover-edit', cover_text: coverText, instruction };
  if (comment) body.comment = comment;
  const res = await fetch(GEN_ASSET_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`gen-asset ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.content;
}

window.JobPipeline = { fetchPipeline, setStatus, generateAsset, formatResumeText, fetchCoverRationale, applyCoverEdit, addNarrative };
