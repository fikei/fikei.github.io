// pipeline.js — thin client for the jobs-pipe Edge Function.
const FN_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/jobs-pipe';
const LIVENESS_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/check-liveness';
const ADD_ROLE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/add-role';
const REC_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/recommendations';
const PULL_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/pull-recommendations';

// ----- Pipeline bucket taxonomy (single source of truth) -------------------
// The DB stores status (Saved/Active/Archive) + stage (drafting/applied/
// interviewing/offer). The UI derives SIX first-class buckets from those:
// Saved, the four in-progress stages, and Archive. bucketFor() is the one
// mapping — imported by the rail, the jobs list, and the mobile home so the
// three never drift (they each used to carry their own copy).
export const STAGES = [
  { id: 'drafting',     label: 'Drafting' },
  { id: 'applied',      label: 'Applied' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer',        label: 'Offer' },
];
export const STAGE_IDS = STAGES.map(s => s.id);
export const BUCKETS = ['saved', ...STAGE_IDS, 'archive'];
export const BUCKET_LABELS = {
  saved: 'Saved',
  drafting: 'Drafting', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer',
  archive: 'Archive',
};

// status + stage → bucket. An Active row always resolves to a stage bucket;
// a missing/unknown stage falls back to 'drafting' (the pipeline entry point),
// matching the backend default so no Active row is ever bucket-less.
export function bucketFor(r) {
  if (r?.status === 'Archive') return 'archive';
  if (r?.status === 'Active')  return STAGE_IDS.includes(r.stage) ? r.stage : 'drafting';
  return 'saved';
}

// Normalize a raw ?bucket= value, translating legacy names (leads→saved,
// active→drafting) so old links/bookmarks keep working. Returns null when
// the value isn't recognizable so callers can apply their own default.
export function normalizeBucket(raw) {
  if (!raw) return null;
  if (BUCKETS.includes(raw)) return raw;
  if (raw === 'leads')  return 'saved';
  if (raw === 'active') return 'drafting';
  return null;
}

// ----- Apply-ease taxonomy (Easy Apply badge) ------------------------------
// Tiers written by classify-apply-ease / extract-application-fields. One
// presentation map shared by the table chip, the detail header, and the
// Updates digest so labels never drift. `special` refines its label from
// apply_ease_meta (video vs email).
export const APPLY_EASE_META = {
  easy:         { label: 'Easy apply',    title: 'No written questions — resume, contact info and quick selects only' },
  short_answer: { label: 'Short answers', title: 'One or two short written answers required' },
  essay:        { label: 'Essays',        title: 'Long-form written answers required' },
  special:      { label: 'Extra steps',   title: 'Video, portfolio, or email application' },
  portal:       { label: 'Portal',        title: 'Account-gated application portal' },
};

// r → { tier, label, title } or null when unclassified/unknown (no badge).
export function applyEaseInfo(r) {
  const tier = r?.applyEase;
  const base = APPLY_EASE_META[tier];
  if (!base) return null;
  const m = r?.applyEaseMeta || {};
  let label = base.label;
  let title = base.title;
  if (tier === 'special') {
    if (m.video)       { label = 'Video required'; title = 'The application asks for a recorded video'; }
    else if (m.email_apply) { label = 'Email to apply'; title = 'Applications go by email, not a form'; }
  }
  if (tier === 'short_answer' && m.short_answers > 0) {
    label = `${m.short_answers + (m.required_essays || 0)} short answer${(m.short_answers + (m.required_essays || 0)) === 1 ? '' : 's'}`;
  }
  if (tier === 'essay' && m.required_essays > 0) {
    label = `${m.required_essays} essay${m.required_essays === 1 ? '' : 's'}`;
  }
  // Coverage stamp (16.2b): every required field covered by the answer bank.
  if (tier === 'easy' && m.ready === true) {
    label = 'Ready to submit';
    title = 'Every required field is covered by your saved Easy Apply answers';
    return { tier, ready: true, label, title, meta: m, prompts: [] };
  }
  const bits = [];
  if (m.ats && m.ats !== 'unknown') bits.push(m.ats);
  if (typeof m.questions === 'number') bits.push(`${m.questions} question${m.questions === 1 ? '' : 's'}`);
  if (m.requires_cover_letter) bits.push('cover letter required');
  if (bits.length) title += ` · ${bits.join(' · ')}`;
  return { tier, label, title, meta: m, prompts: Array.isArray(m.prompts) ? m.prompts : [] };
}

// Shared visibility filter — drops rows without a URL and Strava postings.
// (Was duplicated in the rail and the jobs list.)
export function isVisibleRole(r) {
  if (!r?.url) return false;
  const company = (r.company || '').toLowerCase();
  if (company === 'strava') return false;
  if (/(^|\.)strava\.com\b/i.test(r.url)) return false;
  return true;
}

// Soft client-side rate limit so first-load auto-fire doesn't hammer the
// endpoint when the user tab-hops. Server-side gating is the source of
// truth (user_sources.schedule_cron vs last_run_at).
const PULL_MIN_INTERVAL_MS = 5 * 60 * 1000;     // 5 min — half the server's 15-min cadence

// force:    bypass the client throttle (used for high-signal triggers like a
//           fresh Gmail reconnect where the user expects an immediate scan).
// sourceId: force-run ONE user_source by id, bypassing the server's is-due
//           gate (POST {id}). Without it we POST {} → all enabled+due sources,
//           same as cron. Reconnect passes the gmail-jobs id so the scan runs
//           even if the source ran (and failed) minutes ago and isn't "due".
export async function refreshSources({ silent = false, force = false, sourceId = null } = {}) {
  // Throttle: if we kicked a pull within PULL_MIN_INTERVAL_MS, skip — unless
  // force is set. The kick timestamp doubles as the "draining since" marker
  // the recs table polls against, so we always stamp it when we actually fire.
  try {
    const lastTs = Number(localStorage.getItem('job:lastPullKickAt') || 0);
    if (!force && Date.now() - lastTs < PULL_MIN_INTERVAL_MS) {
      return { kicked: false, throttled: true, lastKickAt: new Date(lastTs).toISOString() };
    }
    localStorage.setItem('job:lastPullKickAt', String(Date.now()));
  } catch { /* ignore */ }

  const headers = await authHeader();
  // Fire-and-forget. The function can take 30–90s on a backlog drain;
  // keepalive lets the browser deliver even if the user navigates. The
  // page never blocks on this — fresh recs / events show up after the
  // next fetchPipeline() / Activity refresh.
  let kickedOk = true;
  try {
    fetch(PULL_URL, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // {id} → force that one source (bypasses is-due); {} → all due sources.
      body: JSON.stringify(sourceId ? { id: sourceId } : {}),
      keepalive: true,
    }).catch(() => { /* fire-and-forget; server completes its own work */ });
  } catch (e) {
    kickedOk = false;
    if (!silent) console.warn('[refreshSources] kick failed:', e.message);
  }
  return { kicked: kickedOk, throttled: false, kickAt: Date.now() };
}

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

// Trigger a fit-score rescore scoped to one slug. Fires after analysis
// regen so fit_score + fit_breakdown pick up any changes in company /
// title / url / sector without rescoring the whole pipeline.
const PULL_REC_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/pull-recommendations';
export async function rescoreRole(slug, { haiku = true } = {}) {
  if (!slug) return null;
  try {
    const headers = await authHeader();
    const qs = new URLSearchParams({ rescore: '1', slug });
    if (!haiku) qs.set('haiku', '0');
    const res = await fetch(`${PULL_REC_URL}?${qs}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`rescore ${res.status}: ${await res.text()}`);
    return await res.json();
  } catch (e) {
    console.warn(`[pipeline] rescoreRole(${slug}) failed:`, (e && e.message) || e);
    return null;
  }
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

export async function addRole({ url, title, company, location, sector, source, fromRecommendationId } = {}) {
  const headers = await authHeader();
  const res = await fetch(ADD_ROLE_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, title, company, location, sector, source, fromRecommendationId }),
  });
  if (!res.ok) throw new Error(`add-role ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function fetchRecommendations(opts = {}) {
  const headers = await authHeader();
  // opts.view === 'all'      → full list (no score floors) for the
  //                            "Recommended for you" page, paginated via
  //                            limit/offset + server-side sort.
  // opts.view === 'wildcard' → short "standout candidate, low fit" strip.
  // Default is the carousel/widget view (single 60-row pull).
  let url = REC_URL;
  if (opts.view === 'all') {
    const qs = new URLSearchParams({ view: 'all' });
    if (opts.limit  != null) qs.set('limit',  String(opts.limit));
    if (opts.offset != null) qs.set('offset', String(opts.offset));
    if (opts.sort)           qs.set('sort',   opts.sort);
    if (opts.dir)            qs.set('dir',    opts.dir);
    if (opts.floor)          qs.set('floor', opts.floor === 'below' ? 'below' : '1'); // '1' = floors on; 'below' = complement
    url = `${REC_URL}?${qs}`;
  } else if (opts.view === 'wildcard') {
    url = `${REC_URL}?view=wildcard`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`recommendations ${res.status}: ${await res.text()}`);
  return res.json();
}
// Single recommendation by id — powers the pre-save detail page
// (/ladder/jobs/<slug>/?rec=<id>). Returns the row regardless of score /
// dismissed / closed state; the page renders those states itself.
export async function fetchRecommendation(id) {
  const headers = await authHeader();
  const res = await fetch(`${REC_URL}?id=${encodeURIComponent(id)}`, { headers });
  if (!res.ok) throw new Error(`recommendation ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.recommendation || null;
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

// "Don't recommend this company" — blocks the company for this user and
// dismisses its current recs server-side. Returns { dismissed: N }.
export async function blockCompany(company) {
  const headers = await authHeader();
  const res = await fetch(REC_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ blockCompany: company }),
  });
  if (!res.ok) throw new Error(`block-company ${res.status}: ${await res.text()}`);
  return res.json();
}

// The caller's "don't recommend" list — [{ company, blockedAt }].
export async function fetchBlockedCompanies() {
  const headers = await authHeader();
  const res = await fetch(`${REC_URL}?view=blocked`, { headers });
  if (!res.ok) throw new Error(`blocked-companies ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return Array.isArray(j.blocked) ? j.blocked : [];
}

export async function unblockCompany(company) {
  const headers = await authHeader();
  const res = await fetch(REC_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ unblockCompany: company }),
  });
  if (!res.ok) throw new Error(`unblock-company ${res.status}: ${await res.text()}`);
  return res.json();
}

// ----- Watched companies (job.watched_companies) ---------------------------
// Green-lit companies pulled straight from their careers backends. Each has
// a filter_mode gating how its roles surface in For You.
const WATCHED_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/watched-companies';

export async function fetchWatchedCompanies() {
  const headers = await authHeader();
  const res = await fetch(WATCHED_URL, { headers });
  if (!res.ok) throw new Error(`watched-companies ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return Array.isArray(j.watches) ? j.watches : [];
}

// Add a watch. Server resolves the adapter (Google/Amazon/Workday/… or an
// ATS board probe) when not provided. Throws with the server's message on
// a 422 so the UI can tell the user the company isn't supported yet.
export async function watchCompany({ company, url, adapter, config, filterMode, titleKeywords, locations } = {}) {
  const headers = await authHeader();
  const res = await fetch(WATCHED_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ company, url, adapter, config, filterMode, titleKeywords, locations }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `watch-company ${res.status}`);
  return j.watch;
}

export async function updateWatchedCompany(id, patch) {
  const headers = await authHeader();
  const res = await fetch(WATCHED_URL, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...patch }),
  });
  if (!res.ok) throw new Error(`update-watch ${res.status}: ${await res.text()}`);
  return (await res.json()).watch;
}

export async function unwatchCompany(id) {
  const headers = await authHeader();
  const res = await fetch(WATCHED_URL, {
    method: 'DELETE',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error(`unwatch ${res.status}: ${await res.text()}`);
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

// Fire-and-forget apply-ease classification for a just-saved role, so the
// badge appears without waiting for the 2h sweep. Errors are swallowed —
// the cron re-covers anything this misses.
const CLASSIFY_EASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/classify-apply-ease';
export function classifyApplyEaseForSlug(slug) {
  if (!slug) return;
  (async () => {
    try {
      const headers = await authHeader();
      await fetch(CLASSIFY_EASE_URL, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      document.dispatchEvent(new CustomEvent('job:pipeline:refresh'));
    } catch { /* sweep will pick it up */ }
  })();
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

// Persisted career opportunities — backed by job.career_opportunities.
// GET returns cached open rows + a `stale` flag the UI uses to decide
// whether to trigger a background re-audit.
const OPPORTUNITIES_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/opportunities';

export async function fetchCareerOpportunities() {
  const headers = await authHeader();
  const res = await fetch(OPPORTUNITIES_URL, { headers });
  if (!res.ok) throw new Error(`opportunities ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return {
    items:          Array.isArray(j.opportunities) ? j.opportunities : [],
    last_audit_ts:  j.last_audit_ts || null,
    stale:          !!j.stale,
  };
}

// Force a fresh AI audit; replaces the open set on the server.
export async function auditCareerOpportunities() {
  const headers = await authHeader();
  const res = await fetch(OPPORTUNITIES_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ audit: true }),
  });
  if (!res.ok) throw new Error(`opportunities ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return {
    items:          Array.isArray(j.opportunities) ? j.opportunities : [],
    last_audit_ts:  j.last_audit_ts || null,
    stale:          !!j.stale,
  };
}

export async function dismissOpportunity(id) {
  const headers = await authHeader();
  const res = await fetch(OPPORTUNITIES_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dismiss: id }),
  });
  if (!res.ok) throw new Error(`opportunities ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function resolveOpportunity(id, narrativeId) {
  const headers = await authHeader();
  const res = await fetch(OPPORTUNITIES_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolve: id, narrative_id: narrativeId || undefined }),
  });
  if (!res.ok) throw new Error(`opportunities ${res.status}: ${await res.text()}`);
  return res.json();
}

// ----- Narratives (job.narratives) ----------------------------------------
const NARRATIVES_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/narratives';

export async function fetchNarratives() {
  const headers = await authHeader();
  const res = await fetch(NARRATIVES_URL, { headers });
  if (!res.ok) throw new Error(`narratives ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return Array.isArray(j.narratives) ? j.narratives : [];
}

// Upsert a narrative. Server runs an AI tag/link pass on write.
export async function saveNarrative({ id, title, content_md, source_role }) {
  const headers = await authHeader();
  const res = await fetch(NARRATIVES_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title, content_md, source_role }),
  });
  if (!res.ok) throw new Error(`narratives ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.narrative;
}

// Set/clear the company link on a narrative without re-running tagging.
export async function linkNarrative(id, linkedCompanySlug) {
  const headers = await authHeader();
  const res = await fetch(NARRATIVES_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, linked_company_slug: linkedCompanySlug }),
  });
  if (!res.ok) throw new Error(`narratives ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.narrative;
}

// One-shot backfill: read the KB (companies/projects/wins/skills/vision)
// and extract discrete stories into job.narratives. Idempotent — stories
// whose normalized titles already exist are skipped.
export async function extractNarrativesFromKb() {
  const headers = await authHeader();
  const res = await fetch(NARRATIVES_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ extract: true }),
  });
  if (!res.ok) throw new Error(`narratives ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function deleteNarrative(id) {
  const headers = await authHeader();
  const res = await fetch(NARRATIVES_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, delete: true }),
  });
  if (!res.ok) throw new Error(`narratives ${res.status}: ${await res.text()}`);
  return res.json();
}

// ----- Work history projects + clients (job.role_projects / project_clients)
const WORK_HISTORY_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co/functions/v1/work-history';

export async function fetchRoleProjects({ company, role } = {}) {
  const headers = await authHeader();
  const params = new URLSearchParams();
  if (company) params.set('company', company);
  if (role)    params.set('role', role);
  const url = params.toString() ? `${WORK_HISTORY_URL}?${params}` : WORK_HISTORY_URL;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`work-history ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return Array.isArray(j.projects) ? j.projects : [];
}

export async function saveRoleProject(payload) {
  const headers = await authHeader();
  const res = await fetch(WORK_HISTORY_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'project', ...payload }),
  });
  if (!res.ok) throw new Error(`work-history ${res.status}: ${await res.text()}`);
  return (await res.json()).project;
}

export async function deleteRoleProject(id) {
  const headers = await authHeader();
  const res = await fetch(WORK_HISTORY_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'project', id, delete: true }),
  });
  if (!res.ok) throw new Error(`work-history ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function saveProjectClient(payload) {
  const headers = await authHeader();
  const res = await fetch(WORK_HISTORY_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client', ...payload }),
  });
  if (!res.ok) throw new Error(`work-history ${res.status}: ${await res.text()}`);
  return (await res.json()).client;
}

export async function deleteProjectClient(id) {
  const headers = await authHeader();
  const res = await fetch(WORK_HISTORY_URL, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client', id, delete: true }),
  });
  if (!res.ok) throw new Error(`work-history ${res.status}: ${await res.text()}`);
  return res.json();
}

window.JobPipeline = {
  fetchPipeline, setStatus, generateAsset, formatResumeText, fetchCoverRationale, applyCoverEdit, addNarrative,
  fetchNarratives, saveNarrative, linkNarrative, deleteNarrative, extractNarrativesFromKb,
  fetchRoleProjects, saveRoleProject, deleteRoleProject, saveProjectClient, deleteProjectClient,
  fetchCareerOpportunities, auditCareerOpportunities, dismissOpportunity, resolveOpportunity,
};
