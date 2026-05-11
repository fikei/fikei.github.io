// Shared fit-scoring helpers: JD fetcher + UserContext loader + Haiku
// role-match call. Used by both pull-recommendations (cron pulls) and
// add-role (user-saved rows) so all entry points walk the same v3 path.
import { computeFit, type RoleRow, type UserContext as FitUserContext } from '../jobs-pipe/fit.ts';

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';

export interface HaikuRoleMatch {
  score:     number;
  rationale: string;
  seniority: string;
  scope:     string;
}

let _fitCtxCache: { ctx: FitUserContext; at: number } | null = null;
const FIT_CTX_CACHE_MS = 60_000;

// deno-lint-ignore no-explicit-any
export async function loadFitContext(sql: any): Promise<FitUserContext> {
  if (_fitCtxCache && Date.now() - _fitCtxCache.at < FIT_CTX_CACHE_MS) return _fitCtxCache.ctx;
  const [visionRows, skillRows, companyRows] = await Promise.all([
    sql`select impact_themes, mission_keywords, mission_required, anti_mission_terms,
               culture_keywords, interest_tags, score_weights,
               coalesce(narrative_arc,'') as narrative_arc
          from job.vision order by updated_at desc limit 1`,
    sql`select name, years_practiced from job.skills`,
    sql`select coalesce(sector,'') as sector from job.companies`,
  ]);
  const v = (visionRows as Array<Record<string, unknown>>)[0] || {};
  const arcSrc = (v.narrative_arc as string || '').toLowerCase();
  const arcTags: string[] = [];
  for (const tag of ['founding','zero-to-one','zero to one','platform','scale','scaled','ipo','acquisition','fractional','pmf','product-market fit','growth','greenfield']) {
    if (arcSrc.includes(tag)) arcTags.push(tag);
  }
  const ctx: FitUserContext = {
    missionKeywords:   (v.mission_keywords as string[] | null) || [],
    antiMissionTerms:  (v.anti_mission_terms as string[] | null) || [],
    impactThemes:      (v.impact_themes as string[] | null) || [],
    missionRequired:   Boolean(v.mission_required),
    cultureKeywords:   (v.culture_keywords as string[] | null) || [],
    interestTags:      (v.interest_tags as string[] | null) || [],
    skills:            (skillRows as Array<Record<string, unknown>>).map(s => ({
      name: String(s.name || ''),
      years: (s.years_practiced as number | null) ?? null,
    })),
    pastSectors: (companyRows as Array<Record<string, unknown>>).map(c => String(c.sector || '')).filter(Boolean),
    arcTags,
    weights: (v.score_weights as Partial<FitUserContext['weights']>) || undefined,
  };
  _fitCtxCache = { ctx, at: Date.now() };
  return ctx;
}

export async function fetchJdText(url: string): Promise<string> {
  const resp = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1',
    },
  });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('html') && !ct.includes('text')) throw new Error(`unsupported content-type ${ct}`);
  const html = await resp.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
}

export async function haikuRoleMatch(r: RoleRow, ctx: FitUserContext): Promise<HaikuRoleMatch | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const system = `You grade a job posting against a candidate's profile and return four structured fields.

Inputs you will see:
  - Job posting (title, company, description)
  - The candidate's skills (with years of practice)
  - The candidate's interest tags (problem types they want to work on)
  - The candidate's target seniority: Senior PM, Staff PM, Principal PM, Lead PM, Product Lead, Head of Product, Founding PM. Manager-of-managers (Director, VP) is "above"; Senior PM IC is "equivalent"; below Senior is "below".

Output JSON only:
{
  "score":      <int 0-25>,
  "rationale":  "<one sentence, max 22 words>",
  "seniority":  "below" | "equivalent" | "above" | "founding",
  "scope":      "ic" | "ic_player_coach" | "manager"
}

Scoring rubric for "score":
  0-5   Wrong shape entirely
  6-12  Adjacent — title fits but JD barely overlaps with skills/interests
  13-18 Genuine match — multiple skills and interest tags map cleanly
  19-22 Strong — JD reads like it was written for this profile
  23-25 Rare alignment across seniority, scope, skills, explicit interest

Seniority — title shape NOT just string-match:
  - "Lead PM" / "Lead Product Manager" at civic/nonprofit/PBC → equivalent
  - "Group PM" / "GPM" → equivalent
  - "Director, Product" with 0-1 reports → equivalent; multi-team org → above
  - "Founding PM" → founding
  - "PM I/II/III" / "Associate" / "APM" → below

Scope:
  - ic              Pure IC, no reports
  - ic_player_coach IC with 1-2 reports max, hands-on
  - manager         3+ reports, primarily managing

No prose outside the JSON.`;
  const userPrompt = [
    `# Posting`,
    `Title: ${r.title}`,
    `Company: ${r.company}`,
    `Description (truncated):\n${(r.description || '').slice(0, 2500)}`,
    `\n# Candidate skills`,
    ...ctx.skills.map(s => `- ${s.name} (${s.years ?? '?'} yrs)`),
    `\n# Candidate interest tags`,
    `- ${(ctx.interestTags || []).join('\n- ')}`,
  ].join('\n');
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 200, system, messages: [{ role: 'user', content: userPrompt }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { score?: number; rationale?: string; seniority?: string; scope?: string };
    if (typeof parsed.score !== 'number') return null;
    const seniority = ['below','equivalent','above','founding'].includes((parsed.seniority || '').toLowerCase())
      ? parsed.seniority!.toLowerCase() : 'equivalent';
    const scope = ['ic','ic_player_coach','manager'].includes((parsed.scope || '').toLowerCase())
      ? parsed.scope!.toLowerCase() : 'ic';
    return {
      score: Math.max(0, Math.min(25, Math.round(parsed.score))),
      rationale: String(parsed.rationale || '').slice(0, 400),
      seniority, scope,
    };
  } catch (e) {
    console.warn(`[job-fit-haiku] role-match failed: ${(e as Error).message}`);
    return null;
  }
}

// Convenience: full enrichment pass on a row that already has at least
// title/company/url. Returns the score + breakdown + the Haiku fields,
// caller decides what to persist where.
// deno-lint-ignore no-explicit-any
export async function scoreOne(r: RoleRow, sql: any): Promise<{
  fit: ReturnType<typeof computeFit>;
  roleScore: number | null;
  rationale: string | null;
  seniority: string | null;
  scope: string | null;
  description: string;
}> {
  const ctx = await loadFitContext(sql);
  let description = r.description || '';
  if (description.length < 200 && r.url) {
    try {
      const text = await fetchJdText(r.url);
      if (text && text.length >= 200) description = text;
    } catch { /* best effort */ }
  }
  const enriched: RoleRow = { ...r, description };
  let roleScore: number | null = null;
  let rationale: string | null = null;
  let seniority: string | null = null;
  let scope: string | null = null;
  if (description.length > 200) {
    const haiku = await haikuRoleMatch(enriched, ctx);
    if (haiku) {
      roleScore = haiku.score; rationale = haiku.rationale;
      seniority = haiku.seniority; scope = haiku.scope;
    }
  }
  const fit = computeFit(enriched, ctx, roleScore, seniority, rationale);
  return { fit, roleScore, rationale, seniority, scope, description };
}
