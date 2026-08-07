// Shared fit-scoring helpers: JD fetcher + UserContext loader + Haiku
// role-match call. Used by both pull-recommendations (cron pulls) and
// add-role (user-saved rows) so all entry points walk the same v3 path.
import { computeFit, trackFor, compFloorFor, type FitTrack, type RoleRow, type UserContext as FitUserContext } from '../jobs-pipe/fit.ts';
import { loadVisionFields } from './job-vision.ts';
import { compClears } from './comp.ts';

const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL   = 'https://api.anthropic.com/v1/messages';

export interface CandidateBreakdown {
  skills: number; scope: number; outcome: number; domain: number;
  stretch: number; reach: number;
}
export interface CandidateRationales {
  skills: string; scope: string; outcome: string; domain: string;
  stretch: string; reach: string; comp: string;
}
export interface HaikuRoleMatch {
  score:      number;
  rationale:  string;
  seniority:  string;
  scope:      string;
  track:      FitTrack;   // which bar the posting was graded against
  fitSummary: string;
  companyDescription: string | null;
  location:   string | null;
  // Candidate-side: "are you a good candidate for this role?" Same Haiku
  // call returns both blocks so we don't pay twice.
  candidate?: {
    score:           number;        // 0-100
    breakdown:       CandidateBreakdown;
    rationales:      CandidateRationales;
    compAcceptable:  boolean | null;
    summary:         string;
  };
}

let _fitCtxCache: { ctx: FitUserContext; at: number } | null = null;
const FIT_CTX_CACHE_MS = 60_000;

// deno-lint-ignore no-explicit-any
export async function loadFitContext(sql: any): Promise<FitUserContext> {
  if (_fitCtxCache && Date.now() - _fitCtxCache.at < FIT_CTX_CACHE_MS) return _fitCtxCache.ctx;
  const wanted = [
    'impact_themes', 'mission_keywords', 'mission_required', 'anti_mission_terms',
    'culture_keywords', 'interest_tags', 'target_sectors', 'score_weights', 'narrative_arc',
    'track_a_titles', 'track_a_comp_floor', 'track_a_notes',
  ];
  const [v, skillRows, companyRows, winRows] = await Promise.all([
    loadVisionFields(sql, wanted),
    sql`select name, years_practiced from job.skills`,
    sql`select coalesce(sector,'') as sector from job.companies`,
    sql`select headline, metric_value as metric from job.wins order by updated_at desc limit 20`,
  ]);
  const arcSrc = ((v.narrative_arc as string) || '').toLowerCase();
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
    pastSectors:   (companyRows as Array<Record<string, unknown>>).map(c => String(c.sector || '')).filter(Boolean),
    targetSectors: (v.target_sectors as string[] | null) || [],
    arcTags,
    // Wins are surfaced to Haiku only; the scoring functions don't use
    // them. Cast pattern keeps FitUserContext interface tight while we
    // pipe extra data through.
    wins: (winRows as Array<Record<string, unknown>>).map(w => ({ headline: String(w.headline || ''), metric: (w.metric as string | null) || null })),
    weights: (v.score_weights as Partial<FitUserContext['weights']>) || undefined,
    // Track A (production soft goods) — grade matching titles against
    // their own bar and comp floor instead of averaging with digital PM.
    trackA: (v.track_a_titles as string[] | null)?.length ? {
      titles:    v.track_a_titles as string[],
      compFloor: Number(v.track_a_comp_floor) || 70_000,
      notes:     String(v.track_a_notes || ''),
    } : undefined,
  };
  _fitCtxCache = { ctx, at: Date.now() };
  return ctx;
}

// Workday postings are fully JS-rendered — a plain fetch returns an empty
// shell. Their CXS API serves the JD as JSON: parse
// https://<tenant>.wd<N>.myworkdayjobs.com/[<locale>/]<site>/job/[<loc>/]<Req>
// into /wday/cxs/<tenant>/<site>/job/<Req>.
async function fetchWorkdayJdText(url: URL): Promise<string | null> {
  const tenant = url.hostname.split('.')[0];
  const seg = url.pathname.split('/').filter(Boolean);
  const jobIdx = seg.indexOf('job');
  if (jobIdx < 1 || jobIdx === seg.length - 1) return null;
  // Site = segment before 'job', skipping a leading locale like en-US.
  const site = seg[jobIdx - 1];
  const req  = seg[seg.length - 1];
  const cxs = `https://${url.hostname}/wday/cxs/${tenant}/${site}/job/${encodeURIComponent(req)}`;
  const r = await fetch(cxs, { headers: { accept: 'application/json' } });
  if (!r.ok) return null;
  const data = await r.json() as { jobPostingInfo?: { jobDescription?: string } };
  const html = data.jobPostingInfo?.jobDescription || '';
  if (!html) return null;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000) || null;
}

export async function fetchJdText(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (/\.myworkdayjobs\.com$/i.test(u.hostname)) {
      const wd = await fetchWorkdayJdText(u).catch(() => null);
      if (wd) return wd;
    }
  } catch { /* fall through to the generic path */ }
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
  const apiKey = (Deno.env.get('LADDER_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY'));
  if (!apiKey) return null;
  // Two-track grading: a posting is measured against the bar of ITS track
  // only — a great Product Line Manager role must never grade as a bad PM
  // role. Track A (production soft goods) swaps the seniority frame, the
  // competition calibration, and the comp floor.
  const track = trackFor(r.title, ctx);
  const floor = compFloorFor(r.title, ctx);
  const floorText = `$${Math.round(floor / 1000)}k`;
  const seniorityFrame = track === 'production'
    ? `Senior/II+ Product Line Manager, Senior Product Developer, design/product-development leadership, senior sourcing/materials. Coordinator/associate/assistant is "below"; multi-team development or design org leadership is "above"; senior IC PLM/developer is "equivalent".`
    : `Senior PM, Staff PM, Principal PM, Lead PM, Product Lead, Head of Product, Founding PM. Manager-of-managers (Director, VP) is "above"; Senior PM IC is "equivalent"; below Senior is "below".`;
  const competitionFrame = track === 'production'
    ? `These are production-side soft-goods roles (PLM, product development, equipment/pack design, sourcing) at outdoor and gear brands. Applicant pools are smaller than tech-PM pools but dominated by career soft-goods people with direct factory, tech-pack, and line-planning history. The candidate is a career changer: their edge is PM rigor, design training, and shipped physical-adjacent work (medical devices, design systems) — their gap is direct soft-goods development process. Score the transfer story honestly against those specialists.`
    : `These are popular Senior/Staff/Lead PM roles at well-funded companies. Each posting receives 200–800 qualified applicants. Most are ex-Big-Tech PMs, ex-unicorn PMs, or domain experts with direct shipping history. The hiring manager is comparing this candidate against 3–8 finalists who each look credible on paper.`;
  const system = `You grade a job posting against a candidate's profile and return four structured fields.

Inputs you will see:
  - Job posting (title, company, description)
  - The candidate's skills (with years of practice)
  - The candidate's interest tags (problem types they want to work on)
  - The candidate's target seniority: ${seniorityFrame}

Output JSON only:
{
  "score":      <int 0-25>,
  "rationale":  "<one sentence, max 22 words>",
  "seniority":  "below" | "equivalent" | "above" | "founding",
  "scope":      "ic" | "ic_player_coach" | "manager",
  "fitSummary": "<2-4 sentence prose, max 100 words. ONLY explain why this company / role is desirable for the candidate's needs — mission alignment, scope they want, kind of problem they care about, culture traits they care about. DO NOT describe why the candidate is a good fit for the company or what they bring to the role. Speak about the company in third person.>",
  "companyDescription": "<1-2 sentences, max 40 words, strictly factual: what the company does / builds and for whom, plus stage or funding ONLY if the posting states it. No hype adjectives, no fit commentary. null if the posting gives no company context.>",
  "location":   "<the role's location exactly as the posting states it, normalized to 'City, ST' / 'City, Country' / 'Remote' / 'Remote (US)' / 'Hybrid — City, ST'. Multiple offices: join with '; '. null if the posting never states one — do not guess from the company name>",
  "candidate": {
    "breakdown": {
      "skills":  <int 0-25>,
      "scope":   <int 0-20>,
      "outcome": <int 0-15>,
      "domain":  <int 0-15>,
      "stretch": <int 0-15>,
      "reach":   <int 0-10>
    },
    "rationales": {
      "skills":  "<one short sentence, ≤35 words: what they can do day-1 vs what needs ramp>",
      "scope":   "<one short sentence: how the team/ownership scale compares to their experience>",
      "outcome": "<one short sentence: what wins map to this role's outcomes>",
      "domain":  "<one short sentence: sector overlap with their past work>",
      "stretch": "<one short sentence: is this a stretch up, sideways, or down>",
      "reach":   "<one short sentence: what would a hiring manager push on>",
      "comp":    "<one short sentence, strictly factual: state the posted range and whether its TOP clears the candidate's ${floorText} base floor for this track. Top ≥ ${floorText} = clears, full stop — do NOT speculate about buffers, negotiation room, or what the candidate 'likely expects'. If no comp is disclosed, say exactly that>"
    },
    "compAcceptable": <boolean: true if and only if the top of the disclosed comp range is ≥ the candidate's ${floorText} base floor for this track — a range topping at exactly ${floorText} or above is true, no matter how small the margin. null when no comp is disclosed>,
    "summary": "<2-4 sentence prose, max 100 words. From a hiring manager's lens: can this person do the job? where are they strong? where are they reaching? Be honest about competition. Speak about the candidate in third person.>"
  }
}

CRITICAL — calibrating the candidate-strength score against actual competition:
${competitionFrame}

Be honest. Strong-but-not-special candidates DO NOT score in the 80s.

TOTAL candidate score (sum of buckets) anchors:
   90-100   Exceptional. Recruiter would skip the screen. Beats 95% of applicants.
            Reserved for direct previous-employer overlap or near-identical role experience.
            Example: "ex-PM at sister-company in same sector, same scope, recent."
   75-89    Strong. Top 10–15% of qualified applicants. Likely advances to final rounds.
            Some adjacent ramp; few reach factors named. Most "great fit on paper" lands here.
   60-74    Solid. 25th–50th percentile of qualified applicants. Would interview but likely
            lose to a closer match. Real reach factors named — not deal-breakers.
   45-59    Plausible. Hiring manager has obvious alternatives. Multiple reach factors.
            Worth applying if mission-aligned; expect rejection or extensive screen.
   30-44    Long shot. Significant gaps. Apply only for mission reasons.
   0-29     Wrong shape entirely.

BUCKET-LEVEL CALIBRATION — bucket caps are top scores, not defaults. Apply ruthlessly:

  skills (0-25)   Cap reserved for "could ship the JD's day-1 priorities with zero ramp,
                  in their exact stack/tooling." Most candidates with adjacent skills land
                  12-18. Strong-but-not-stack-matched lands 14-16. Cap = exact tool/methodology overlap.

  scope (0-20)    Cap reserved for "has owned this team size + ownership scope at this stage
                  of company before, recently." Adjacent scope (one stage up or down) → 12-15.
                  Big-tech alum applying to series-A startup → 10-12 even if title matches.

  outcome (0-15)  Cap reserved for "has shipped THE SPECIFIC OUTCOME in their JD in the last
                  3 years." Adjacent outcomes → 8-11. Generic 'shipped product' → 5-8.

  domain (0-15)   IMPORTANT: this bucket counts ACTUAL SHIPPING HISTORY ONLY. Use
                  the "Candidate past sectors" list. DO NOT credit "target sectors"
                  here — a sector the candidate aspires to but has never shipped in
                  earns 3-6 at most, even if the role is in that target domain.
                  Cap = recent shipping in EXACTLY this sector/problem space.
                  Adjacent past sector → 8-12. No prior shipping → 3-6.

  stretch (0-15)  Bidirectional. 12-15 = healthy stretch (mild reach up in scope or domain).
                  8-11 = comfort zone (could be boring or perceived as overqualified).
                  3-7 = significant stretch (real risk of struggling) OR significant step down.
                  0-2 = wrong direction entirely.

  reach (0-10)    HIGH = few HM concerns; LOW = real concerns. Cap-10 is rare; even strong
                  candidates almost always have 1-2 concerns a thoughtful HM would push on:
                  no AI-native PM experience, no big-tech, no recent clinical workflow, gap
                  in current-role recency, overqualification, function mismatch (B2B↔C),
                  no direct payer/clinician/teacher work, comp/title mismatch, etc.
                    10   No meaningful concerns (very rare — like a sister-company referral).
                    8-9  One mild concern.
                    5-7  Two concrete concerns named.
                    3-4  Multiple substantive concerns.
                    0-2  Major doubts about the candidate getting past the screen.

Apply skepticism. A median strong candidate for a Senior PM role at a competitive company
totals 60-75, not 80-90. If your scores land above 80, double-check that the candidate truly
has direct, recent, near-identical experience to JUSTIFY beating most applicants.

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
    `Compensation (parsed): ${r.salary || '(not disclosed)'}`,
    `\n# Candidate skills (years of practice in parens)`,
    ...ctx.skills.map(s => `- ${s.name} (${s.years ?? '?'} yrs)`),
    `\n# Candidate past sectors (where they have actually shipped)`,
    ...ctx.pastSectors.map(s => `- ${s}`),
    `\n# Candidate target sectors (where they want to operate, even without prior shipping)`,
    ...(ctx.targetSectors || []).map(s => `- ${s}`),
    `\n# Candidate interest tags`,
    `- ${(ctx.interestTags || []).join('\n- ')}`,
    `\n# Candidate wins (recent, abbreviated)`,
    ...(ctx.wins || []).map(w => `- ${w.headline}${w.metric ? ` (${w.metric})` : ''}`),
    `\n# Candidate target seniority`,
    `${seniorityFrame} Comp floor for this track: ${floorText} base.`,
    ...(track === 'production' && ctx.trackA?.notes
      ? [`\n# Production-track grading context (grade against THIS bar, not the digital PM bar)`, ctx.trackA.notes]
      : []),
  ].join('\n');
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: userPrompt }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      score?: number; rationale?: string; seniority?: string; scope?: string; fitSummary?: string; companyDescription?: string | null; location?: string | null;
      candidate?: {
        breakdown?: Partial<CandidateBreakdown>;
        rationales?: Partial<CandidateRationales>;
        compAcceptable?: boolean | null;
        summary?: string;
      };
    };
    if (typeof parsed.score !== 'number') return null;
    const seniority = ['below','equivalent','above','founding'].includes((parsed.seniority || '').toLowerCase())
      ? parsed.seniority!.toLowerCase() : 'equivalent';
    const scope = ['ic','ic_player_coach','manager'].includes((parsed.scope || '').toLowerCase())
      ? parsed.scope!.toLowerCase() : 'ic';

    // --- Candidate block (best-effort parse). Caps + total recomputed
    // server-side so a misbehaving model can't blow past the 100 ceiling. ---
    let candidate: HaikuRoleMatch['candidate'] | undefined;
    if (parsed.candidate && parsed.candidate.breakdown) {
      const clamp = (n: unknown, max: number) => {
        const x = Number(n);
        return Number.isFinite(x) ? Math.max(0, Math.min(max, Math.round(x))) : 0;
      };
      const b = parsed.candidate.breakdown;
      const breakdown: CandidateBreakdown = {
        skills:  clamp(b.skills,  25),
        scope:   clamp(b.scope,   20),
        outcome: clamp(b.outcome, 15),
        domain:  clamp(b.domain,  15),
        stretch: clamp(b.stretch, 15),
        reach:   clamp(b.reach,   10),
      };
      const totalScore = breakdown.skills + breakdown.scope + breakdown.outcome + breakdown.domain + breakdown.stretch + breakdown.reach;
      const rat = parsed.candidate.rationales || {};
      const trim = (s: unknown) => String(s || '').slice(0, 600);
      candidate = {
        score: totalScore,
        breakdown,
        rationales: {
          skills:  trim(rat.skills),
          scope:   trim(rat.scope),
          outcome: trim(rat.outcome),
          domain:  trim(rat.domain),
          stretch: trim(rat.stretch),
          reach:   trim(rat.reach),
          comp:    trim(rat.comp),
        },
        // Deterministic first: comp is arithmetic, and the model editorializes
        // ("clears the floor but only by $10k → false"). Checked against the
        // posting's salary and THIS track's floor (a previous version read a
        // shadowed variable here, so the arithmetic path never fired). Fall
        // back to the model's boolean only when no salary string exists.
        compAcceptable: compClears(r.salary, floor) ?? (typeof parsed.candidate.compAcceptable === 'boolean' ? parsed.candidate.compAcceptable : null),
        summary: String(parsed.candidate.summary || '').slice(0, 1200),
      };
    }

    const location = (typeof parsed.location === 'string' && parsed.location.trim() && parsed.location.trim().toLowerCase() !== 'null')
      ? parsed.location.trim().slice(0, 200) : null;

    const companyDescription = (typeof parsed.companyDescription === 'string'
        && parsed.companyDescription.trim()
        && parsed.companyDescription.trim().toLowerCase() !== 'null')
      ? parsed.companyDescription.trim().slice(0, 400) : null;

    return {
      score: Math.max(0, Math.min(25, Math.round(parsed.score))),
      rationale: String(parsed.rationale || '').slice(0, 400),
      seniority, scope, track,
      fitSummary: String(parsed.fitSummary || '').slice(0, 1200),
      companyDescription,
      location,
      candidate,
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
  fitSummary: string | null;
  companyDescription: string | null;
  location: string | null;
  description: string;
  candidate: HaikuRoleMatch['candidate'] | null;
  compFloor: number;
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
  let fitSummary: string | null = null;
  let companyDescription: string | null = null;
  let location: string | null = null;
  let candidate: HaikuRoleMatch['candidate'] | null = null;
  if (description.length > 200) {
    const haiku = await haikuRoleMatch(enriched, ctx);
    if (haiku) {
      roleScore = haiku.score; rationale = haiku.rationale;
      seniority = haiku.seniority; scope = haiku.scope;
      fitSummary = haiku.fitSummary || null;
      companyDescription = haiku.companyDescription;
      location = haiku.location;
      candidate = haiku.candidate || null;
    }
  }
  const fit = computeFit(enriched, ctx, roleScore, seniority, rationale);
  return { fit, roleScore, rationale, seniority, scope, fitSummary, companyDescription, location, description, candidate, compFloor: compFloorFor(r.title, ctx) };
}
