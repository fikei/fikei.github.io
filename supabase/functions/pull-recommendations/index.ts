// pull-recommendations — single tick of the recommendations worker.
//
// On every invocation:
//   1. Find user_sources rows that are enabled and due per schedule_cron.
//   2. For each one, look up the plugin in SOURCES[type] and call pull().
//   3. Score every returned posting with the same fit logic as the pipeline.
//   4. Drop hard-failed roles AND roles below user_sources.min_score.
//   5. Insert survivors into job.recommended_roles using ON CONFLICT
//      DO NOTHING RETURNING * to learn which rows are actually new.
//   6. For new rows only, ask Claude Haiku for 3 personalized match
//      bullets grounded in the user's resume / skills / wins / vision.
//   7. Stamp last_run_at, last_run_count, last_dropped, last_error.
//
// Auth: header X-Cron-Secret must match env CRON_SECRET. The pg_cron
// schedule sets this header.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { db } from '../_shared/job-db.ts';
import { computeFit, type RoleRow } from '../jobs-pipe/fit.ts';
import { SOURCES } from '../_shared/sources/registry.ts';
import type { RecommendedRoleInput } from '../_shared/sources/types.ts';

const VERSION = '0.3.2';
console.log(`[pull-recommendations] v${VERSION} - Tolerant array parse: salvage objects from truncated Haiku digest output`);

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';

interface UserSourceRow {
  id:            string;
  user_email:    string;
  type:          string;
  config:        Record<string, unknown>;
  schedule_cron: string;
  min_score:     number;
  last_run_at:   string | null;
}

interface UserContext {
  resume:   string;
  skills:   string;
  wins:     string;
  vision:   string;
}

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('POST only', { status: 405 });
  }
  const secret = Deno.env.get('CRON_SECRET');
  if (secret && req.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  // Optional force-run: POST { id: '<user_source_id>' } from user-sources
  // bypasses both the enabled flag and the schedule, so the user can
  // trigger a single source from the UI without waiting for cron.
  let forceId: string | null = null;
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      if (body && typeof body.id === 'string') forceId = body.id;
    } catch { /* no body, that's fine */ }
  }

  const sql = db();
  const sources = forceId
    ? await sql<UserSourceRow[]>`
        select id, user_email, type, config, schedule_cron, min_score, last_run_at
        from job.user_sources
        where id = ${forceId}`
    : await sql<UserSourceRow[]>`
        select id, user_email, type, config, schedule_cron, min_score, last_run_at
        from job.user_sources
        where enabled = true`;

  const summary: Array<Record<string, unknown>> = [];
  for (const src of sources) {
    if (!forceId && !isDue(src)) { summary.push({ id: src.id, skipped: 'not-due' }); continue; }
    const plugin = SOURCES[src.type];
    if (!plugin) {
      await markRun(sql, src.id, { count: 0, dropped: 0, error: `unknown source type: ${src.type}` });
      summary.push({ id: src.id, skipped: 'unknown-type' });
      continue;
    }
    try {
      const since = src.last_run_at ? new Date(src.last_run_at) : null;
      const pulled = await plugin.pull(src.config, { userEmail: src.user_email, since });
      // Drop anything whose title doesn't match the user's target titles.
      const targetTitles = await loadTargetTitles(sql);
      const onTarget = targetTitles.length
        ? pulled.filter(r => titleMatches(r.title || '', targetTitles))
        : pulled;
      const droppedOffTarget = pulled.length - onTarget.length;
      // Drop anything whose location isn't one the user wants. Postings
      // with no location (rare on ATS; common on RSS) get the benefit of
      // the doubt — kept and flagged for the user via the bullet.
      const targetGeos = await loadTargetGeographies(sql);
      const inGeo = targetGeos.length
        ? onTarget.filter(r => geoMatches(r.location || '', targetGeos))
        : onTarget;
      const droppedOffGeo = onTarget.length - inGeo.length;
      const { kept, dropped } = scoreAndFilter(inGeo, src.min_score);
      // Drop anything the user already has in their pipeline (any state —
      // active, archived, deleted). Match on (lower(company), lower(title))
      // so a different ATS URL for the same posting still dedupes.
      const pipelineKeys = await sql<{ key: string }[]>`
        select distinct lower(company_name) || '|' || lower(title) as key
          from job.pipeline_roles
         where company_name is not null and title is not null
      `;
      const pipelineSet = new Set(pipelineKeys.map(r => r.key));
      const filtered = kept.filter(r => {
        const k = `${(r.input.company || '').toLowerCase()}|${(r.input.title || '').toLowerCase()}`;
        return !pipelineSet.has(k);
      });
      const droppedToPipeline = kept.length - filtered.length;
      const inserted = await insertNew(sql, src, filtered);
      // Bullets for newly-inserted rows AND any older active row that
      // never got bullets (e.g. from a prior failed run). Capped per
      // tick so one Anthropic outage doesn't burn the whole budget.
      const stale = await sql`
        select id, company, title, url, fit_score as "fitScore", fit_breakdown as "breakdown", payload
          from job.recommended_roles
         where (match_bullets is null or jsonb_array_length(match_bullets) = 0)
           and dismissed_at is null
           and added_to_pipeline_slug is null
           and (fit_score is null or fit_score >= 50)
         order by fit_score desc nulls last
         limit 10
      `;
      const toBullet = [...inserted, ...(stale as unknown as typeof inserted).filter(s => !inserted.some(i => i.id === s.id))];
      if (toBullet.length) {
        const ctx = await loadUserContext(sql);
        await Promise.all(toBullet.map(row => generateBullets(sql, row, ctx)));
      }
      await markRun(sql, src.id, { count: inserted.length, dropped: dropped + droppedToPipeline + droppedOffTarget + droppedOffGeo, error: null });
      summary.push({ id: src.id, type: src.type, pulled: pulled.length, droppedOffTarget, droppedOffGeo, kept: kept.length, dropped, droppedToPipeline, inserted: inserted.length });
    } catch (e) {
      await markRun(sql, src.id, { count: 0, dropped: 0, error: (e as Error).message });
      summary.push({ id: src.id, type: src.type, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ ok: true, version: VERSION, ranAt: new Date().toISOString(), sources: summary }, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

// ---------- Target-title filter ----------
// Reads the user's vision.target_titles array (e.g. ['Founding PM',
// 'Senior PM', 'Product Lead', 'Head of Product']) and keeps only
// postings whose title contains one of those phrases (or a close
// synonym). When vision is empty, this is a no-op — computeFit's
// title hard-fails are the only floor.

let _titleCache: { rows: string[]; at: number } | null = null;
const TITLE_CACHE_MS = 60_000;

// Sensible default for product-track searches when vision.target_titles
// hasn't been filled in yet. Mirrors the seniority floor in computeFit.
const DEFAULT_TARGET_TITLES = [
  'founding pm', 'founding product',
  'product lead', 'head of product', 'vp product', 'chief product',
  'group product manager', 'principal product manager', 'principal pm',
  'staff product manager', 'staff pm',
  'senior product manager', 'senior pm', 'sr product manager',
  'director, product', 'director of product',
];

// Geography filter — read vision.target_geographies; fall back to the
// usual PM hubs + remote so empty vision still gives sane defaults.
const DEFAULT_TARGET_GEOGRAPHIES = [
  'remote', 'san francisco', 'sf bay', 'bay area', 'oakland', 'berkeley',
  'new york', 'nyc', 'brooklyn', 'manhattan',
  'us', 'united states',
];

let _geoCache: { rows: string[]; at: number } | null = null;

async function loadTargetGeographies(sql: ReturnType<typeof db>): Promise<string[]> {
  if (_geoCache && Date.now() - _geoCache.at < TITLE_CACHE_MS) return _geoCache.rows;
  const rows = await sql<{ geos: string[] | null }[]>`
    select target_geographies as geos from job.vision order by updated_at desc limit 1
  `;
  const fromVision = ((rows[0]?.geos as string[]) || []).map(s => s.toLowerCase()).filter(Boolean);
  const geos = fromVision.length ? fromVision : DEFAULT_TARGET_GEOGRAPHIES;
  _geoCache = { rows: geos, at: Date.now() };
  return geos;
}

// Posting "location" strings are wildly varied: "San Francisco, CA",
// "Remote · United States", "New York, NY (Hybrid)", "EMEA - Remote",
// just "" for some Ashby postings. We match by substring, lowercased,
// against any target keyword. Empty location = keep (give benefit of
// doubt; let the user resolve via the bullet's "verify location" line).
function geoMatches(loc: string, targets: string[]): boolean {
  const l = loc.toLowerCase();
  if (!l.trim()) return true;
  return targets.some(t => l.includes(t));
}

async function loadTargetTitles(sql: ReturnType<typeof db>): Promise<string[]> {
  if (_titleCache && Date.now() - _titleCache.at < TITLE_CACHE_MS) return _titleCache.rows;
  const rows = await sql<{ titles: string[] | null }[]>`
    select target_titles as titles from job.vision order by updated_at desc limit 1
  `;
  const fromVision = ((rows[0]?.titles as string[]) || []).map(s => s.toLowerCase()).filter(Boolean);
  const titles = fromVision.length ? fromVision : DEFAULT_TARGET_TITLES;
  _titleCache = { rows: titles, at: Date.now() };
  return titles;
}

// Tokenize each target title into the meaningful keywords that need to
// appear in the posting title. e.g. 'Founding PM' → ['founding', 'pm'].
// A posting matches when one full target's keywords are all present.
function titleMatches(postingTitle: string, targets: string[]): boolean {
  const t = postingTitle.toLowerCase();
  // Synonym expansion: pm ⇄ product manager, head of product ⇄ head, product
  const synonymized = (target: string): string[] => {
    const norm = target
      .replace(/\bproduct manager\b/g, 'pm')
      .replace(/\bsenior\b/g, 'sr')
      .trim();
    return norm.split(/[\s,]+/).filter(Boolean);
  };
  for (const target of targets) {
    const keywords = synonymized(target);
    if (!keywords.length) continue;
    // The posting title (also synonymized) must contain every keyword.
    const haystack = t
      .replace(/\bproduct manager\b/g, 'pm')
      .replace(/\bsenior\b/g, 'sr');
    if (keywords.every(k => haystack.includes(k))) return true;
  }
  return false;
}

// ---------- Scoring + filtering ----------

interface ScoredRow {
  input:     RecommendedRoleInput;
  fitScore:  number;
  breakdown: Record<string, number>;
  hardFails: string[];
}

function scoreAndFilter(rows: RecommendedRoleInput[], minScore: number): { kept: ScoredRow[]; dropped: number } {
  const kept: ScoredRow[] = [];
  let dropped = 0;
  for (const r of rows) {
    const fit = computeFit(toRoleRow(r));
    if (fit.hardFails.length || fit.score < minScore) { dropped++; continue; }
    kept.push({ input: r, fitScore: fit.score, breakdown: fit.breakdown as unknown as Record<string, number>, hardFails: fit.hardFails });
  }
  return { kept, dropped };
}

// Map a RecommendedRoleInput → the RoleRow shape computeFit expects.
// computeFit was written against the spreadsheet row, so this is mostly
// a field-renaming pass with a few "we don't have it yet" defaults.
function toRoleRow(r: RecommendedRoleInput): RoleRow {
  return {
    status:     '',
    rank:      '',
    company:    r.company || '',
    title:      r.title || '',
    url:        r.url,
    source:     r.sourceLabel || r.source,
    contact:    '',
    salary:     r.salary || '',
    sector:     r.sector || '',
    investors:  (r.investors || []).join(', '),
    website:    '',
    crunchbase: '',
  };
}

// ---------- Insert ----------

async function insertNew(
  sql: ReturnType<typeof db>,
  src: UserSourceRow,
  rows: ScoredRow[],
): Promise<Array<{ id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null }>> {
  if (!rows.length) return [];
  const values = rows.map(r => ({
    user_email:     src.user_email,
    user_source_id: src.id,
    source:         r.input.source,
    source_id:      r.input.sourceId,
    source_label:   r.input.sourceLabel ?? null,
    url:            r.input.url,
    company:        r.input.company ?? null,
    title:          r.input.title ?? null,
    location:       r.input.location ?? null,
    salary:         r.input.salary ?? null,
    logo_url:       r.input.logoUrl ?? null,
    posted_at:      r.input.postedAt ?? null,
    description:    r.input.description ?? null,
    fit_score:      r.fitScore,
    fit_breakdown:  r.breakdown,
    hard_fails:     r.hardFails,
    sector:         r.input.sector ?? null,
    investors:      r.input.investors ?? [],
    payload:        r.input.payload ?? null,
  }));
  const inserted = await sql`
    insert into job.recommended_roles ${sql(values)}
    on conflict (source, source_id) do nothing
    returning id, company, title, url, fit_score as "fitScore", fit_breakdown as "breakdown", payload
  `;
  return inserted as unknown as Array<{ id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null }>;
}

// ---------- Bullet generation ----------
//
// Bullets answer two halves at once:
//   - Why does the user fit this role? (cite their skills/wins/vision)
//   - Why does the role fit the user? (cite the breakdown — e.g. "+22 title")

async function loadUserContext(sql: ReturnType<typeof db>): Promise<UserContext> {
  const [skills, wins, vision] = await Promise.all([
    sql`select name, type, level, body_md from job.skills order by name`,
    sql`select headline, metric_value, body_md from job.wins order by updated_at desc limit 30`,
    sql`select coalesce(raw_md, narrative_arc) as body_md from job.vision order by updated_at desc limit 1`,
  ]);
  return {
    resume: '', // hook for a future "primary resume" lookup
    skills: (skills as Array<Record<string, unknown>>).map(s => `- ${s.name} (${s.type}/${s.level}): ${(s.body_md || '').toString().slice(0, 200)}`).join('\n'),
    wins:   (wins as Array<Record<string, unknown>>).map(w => `- ${w.headline} (${w.metric_value || 'n/a'}): ${(w.body_md || '').toString().slice(0, 200)}`).join('\n'),
    vision: (vision as Array<Record<string, unknown>>)[0]?.body_md as string || '',
  };
}

async function generateBullets(
  sql: ReturnType<typeof db>,
  row: { id: string; company: string | null; title: string | null; url: string; fitScore: number; breakdown: Record<string, number>; payload: Record<string, unknown> | null },
  user: UserContext,
): Promise<void> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return;       // no key → leave bullets null, widget falls back to description
  const system = `Write exactly 3 markdown bullets. HARD LIMIT: 12 words per bullet.
Use **bold** for the single most important phrase in each bullet. No headers, no lead-ins.

Every bullet MUST reference something specific from the candidate's vision (their sector / stage / comp / location / scope preferences) — never generic statements about the company.

Bullet 1 — one-line snapshot of company + role.
Bullet 2 — why this matches the candidate's stated needs (cite the exact preference from vision).
Bullet 3 — the single thing to verify before applying.

Each bullet ≤12 words. Reject any bullet over the limit.
Return only the 3 bullets, nothing else.`;
  const userPrompt = [
    `# Role`,
    `Title: ${row.title}`,
    `Company: ${row.company}`,
    `Fit score: ${row.fitScore} (${Object.entries(row.breakdown).map(([k, v]) => `${k}=${v}`).join(', ')})`,
    `URL: ${row.url}`,
    `\n# Candidate's job-search needs (vision — this is what they care about)\n${user.vision || '(none)'}`,
  ].join('\n');
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const bullets = text.split('\n').map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean).slice(0, 3);
    if (bullets.length) {
      await sql`update job.recommended_roles set match_bullets = ${sql.json(bullets)} where id = ${row.id}`;
    }
  } catch (e) {
    console.warn(`[pull-recommendations] bullet gen failed for ${row.id}: ${(e as Error).message}`);
  }
}

// ---------- Schedule ----------
// Tiny cron predicate. Supports the cases we actually use: '0 */6 * * *',
// '*/30 * * * *', '0 9 * * *'. Falls back to "due if last_run_at older
// than 6h" for anything fancier.
function isDue(src: UserSourceRow): boolean {
  if (!src.last_run_at) return true;
  const lastMs = Date.parse(src.last_run_at);
  if (!isFinite(lastMs)) return true;
  const ageMin = (Date.now() - lastMs) / 60_000;
  const cron = src.schedule_cron.trim();
  // hourly modulus
  const m = cron.match(/^(\S+)\s+\*\/(\d+)\s+\*\s+\*\s+\*$/);
  if (m) return ageMin >= Number(m[2]) * 60 - 5;
  // every-N-minutes
  const m2 = cron.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (m2) return ageMin >= Number(m2[1]) - 1;
  // daily at HH
  const m3 = cron.match(/^0\s+(\d+)\s+\*\s+\*\s+\*$/);
  if (m3) return ageMin >= 24 * 60 - 30;
  return ageMin >= 6 * 60;
}

async function markRun(
  sql: ReturnType<typeof db>,
  id: string,
  { count, dropped, error }: { count: number; dropped: number; error: string | null },
) {
  await sql`
    update job.user_sources
       set last_run_at    = now(),
           last_run_count = ${count},
           last_dropped   = ${dropped},
           last_error     = ${error},
           updated_at     = now()
     where id = ${id}
  `;
}
