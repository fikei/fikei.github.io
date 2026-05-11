// Fit score v3 — values/culture/role-match centered. Pure function. No I/O.
//
// Bucket caps (default weights — tunable per user via vision.score_weights):
//   values  25  | culture 15  | role 25  | domain 15  | arc 10
//   stage    4  | comp     4  | geo  2
// Source removed entirely; "network" surfaces as a row-level badge, not
// a bucket. Values is allowed to dominate so a high-impact role with a
// weak stage / comp still tops the list.
//
// Inputs:
//   - RoleRow: one posting (sheet row OR pulled rec, normalized).
//   - UserContext (optional): values keywords + culture keywords + interest
//     tags + skills + companies + tunable weights. Without it the scorer
//     falls back to neutral defaults so legacy callers (add-role) keep
//     working.
//   - Optional pre-computed role-match score from Haiku that overrides
//     the regex fallback for the role bucket.

export interface RoleRow {
  status: string;
  rank: string;
  company: string;
  title: string;
  url: string;
  source: string;
  contact: string;
  salary: string;
  sector: string;
  investors: string;
  website: string;
  crunchbase: string;
  description?: string;
}

export interface UserContext {
  missionKeywords:   string[];
  antiMissionTerms:  string[];
  impactThemes:      string[];
  missionRequired:   boolean;
  cultureKeywords:   string[];
  interestTags:      string[];
  skills:            Array<{ name: string; years?: number | null }>;
  pastSectors:       string[];
  arcTags:           string[];
  weights?:          Partial<FitWeights>;
}

export interface FitWeights {
  values: number; culture: number; role: number; domain: number;
  arc: number; stage: number; comp: number; geo: number;
}

const DEFAULT_WEIGHTS: FitWeights = {
  values: 25, culture: 15, role: 25, domain: 15,
  arc: 10, stage: 4, comp: 4, geo: 2,
};

export interface FitBreakdown {
  values:  number;
  culture: number;
  role:    number;
  domain:  number;
  arc:     number;
  stage:   number;
  comp:    number;
  geo:     number;
}

// Per-bucket short rationales — what specifically about THIS posting drove
// the score in THIS bucket. Each kept ≤35 words; the UI renders them as
// subcopy under each progress bar.
export interface FitRationales {
  values:  string;
  culture: string;
  role:    string;
  domain:  string;
  arc:     string;
  stage:   string;
  comp:    string;
  geo:     string;
}

export interface FitResult {
  score:        number;
  breakdown:    FitBreakdown;
  rationales:   FitRationales;
  hardFails:    string[];
  roleFallback: boolean; // true → role score came from regex, not Haiku
}

const HARD_FAIL_CAP = 30;

// ---------- Helpers ----------

function postingText(r: RoleRow): string {
  return [r.title, r.company, r.sector, r.description || '']
    .filter(Boolean).join(' ').toLowerCase();
}

function countMatches(haystack: string, needles: string[]): number {
  let n = 0;
  for (const t of needles) {
    const k = t.trim().toLowerCase();
    if (!k) continue;
    if (haystack.includes(k)) n++;
  }
  return n;
}

// Returns the actual keyword strings that matched (lowercased, deduped),
// capped at maxReturn so rationales stay short.
function listMatches(haystack: string, needles: string[], maxReturn = 4): string[] {
  const hits = new Set<string>();
  for (const t of needles) {
    const k = t.trim().toLowerCase();
    if (k && haystack.includes(k)) hits.add(k);
    if (hits.size >= maxReturn) break;
  }
  return [...hits];
}

function clampToCap(v: number, cap: number): number {
  return Math.max(0, Math.min(cap, v));
}

// ---------- Values & impact (cap from weights.values, default 25) ----------
// Mission keywords + impact themes are the dominant signal. Anti-mission
// terms zero the bucket. When mission_required and zero matches → hard fail.
function scoreValues(r: RoleRow, cap: number, ctx?: UserContext): { v: number; reason: string; fail?: string } {
  if (!ctx) return { v: Math.round(cap * 0.4), reason: 'No read on the mission angle of this role.' };
  const text = postingText(r);
  if (ctx.antiMissionTerms.length) {
    const anti = listMatches(text, ctx.antiMissionTerms, 3);
    if (anti.length) return { v: 0, fail: 'mission-conflict (anti-theme)', reason: `This role sits in a space you've ruled out — ${anti.join(', ')}.` };
  }
  if (!ctx.missionKeywords.length) return { v: Math.round(cap * 0.4), reason: 'No read on the mission angle of this role.' };
  const hits = listMatches(text, ctx.missionKeywords, 5);
  if (hits.length === 0) return { v: ctx.missionRequired ? 0 : Math.round(cap * 0.15), fail: ctx.missionRequired ? 'no mission alignment' : undefined,
    reason: 'Nothing in the posting signals the kind of impact work you care about.' };
  const v = clampToCap(Math.round(hits.length * (cap / 6)), cap);
  const head = hits.length >= 4 ? 'Squarely on the impact work you care about'
             : hits.length >= 2 ? 'Touches the impact work you care about'
             : 'Some signal toward the impact work you care about';
  return { v, reason: `${head} — ${hits.slice(0, 4).join(', ')}.` };
}

// ---------- Culture (cap from weights.culture, default 15) ----------
function scoreCulture(r: RoleRow, cap: number, ctx?: UserContext): { v: number; reason: string } {
  if (!ctx || !ctx.cultureKeywords.length) return { v: Math.round(cap * 0.4), reason: 'No read on the culture from this posting.' };
  const text = postingText(r);
  const hits = listMatches(text, ctx.cultureKeywords, 5);
  if (hits.length === 0) return { v: Math.round(cap * 0.15), reason: 'The description doesn\'t surface the culture traits you look for — autonomy, engineering depth, AI-native posture, mission orientation.' };
  const v = clampToCap(Math.round(hits.length * (cap / 4)), cap);
  const head = hits.length >= 4 ? 'The team signals'
             : hits.length >= 2 ? 'The team hints at'
             : 'There\'s some sign of';
  return { v, reason: `${head} the culture traits you look for — ${hits.slice(0, 4).join(', ')}.` };
}

// ---------- Role match (cap from weights.role, default 25) ----------
// When a Haiku-computed score is available (preComputedRole), use it. Otherwise
// fall back to a regex bag-of-words match: title seniority floor + skill hits +
// interest-tag hits + sane defaults.
function scoreRole(r: RoleRow, cap: number, ctx?: UserContext, preComputedRole?: number | null, haikuRationale?: string | null): { v: number; reason: string; fail?: string; fallback: boolean } {
  if (preComputedRole != null && Number.isFinite(preComputedRole)) {
    return {
      v: clampToCap(Math.round(preComputedRole * (cap / 25)), cap),
      reason: haikuRationale && haikuRationale.trim().length ? haikuRationale : 'Role shape and your background line up.',
      fallback: false,
    };
  }
  const t = (r.title || '').toLowerCase();
  if (!t) return { v: 0, reason: 'No title on this posting.', fallback: true };
  if (/intern|coordinator|associate|assistant\b/.test(t)) {
    return { v: 0, fail: 'below seniority floor', reason: `"${r.title}" sits below the seniority you're targeting.`, fallback: true };
  }
  // Title base (max 40% of cap).
  let titleBase: number;
  if (/founding (pm|product)/.test(t)) titleBase = cap * 0.40;
  else if (/(?:^|\s)(product lead|head of product)\b/.test(t)) titleBase = cap * 0.36;
  // Lead PM / Lead Product Manager — same scope/seniority as Staff/Principal
  // IC. Civic and nonprofit orgs use "Lead" where scale-ups use "Staff".
  else if (/principal pm|principal product manager|staff pm|staff product manager|lead pm|lead product manager/.test(t)) titleBase = cap * 0.32;
  else if (/group product manager|group pm|senior pm|senior product manager|sr\.? pm/.test(t)) titleBase = cap * 0.30;
  else if (/director, product|director of product/.test(t)) titleBase = cap * 0.24;
  else if (/(^|\W)(pm|product manager)(\W|$)/.test(t)) titleBase = cap * 0.20;
  else titleBase = cap * 0.10;

  if (!ctx) return { v: Math.round(titleBase), reason: `Title sits in your seniority range, but the description isn't available to read deeper.`, fallback: true };

  const text = postingText(r);
  const skillHits: string[] = [];
  let skillPts = 0;
  for (const s of ctx.skills) {
    const name = s.name.toLowerCase();
    if (!name) continue;
    const variants = [name, name.replace(/\s+(foundation|thinking|product)$/, '').trim()];
    if (variants.some(v => v && text.includes(v))) {
      skillHits.push(s.name);
      const years = s.years || 3;
      skillPts += years >= 8 ? 2.0 : years >= 4 ? 1.5 : 1.0;
    }
  }
  skillPts = Math.min(cap * 0.30, skillPts);
  const interestHits = listMatches(text, ctx.interestTags || [], 4);
  const interestPts = Math.min(cap * 0.30, interestHits.length * (cap * 0.06));
  const v = clampToCap(Math.round(titleBase + skillPts + interestPts), cap);
  const parts: string[] = [];
  if (skillHits.length) parts.push(`your work in ${skillHits.slice(0, 3).join(', ')}`);
  if (interestHits.length) parts.push(`interest in ${interestHits.slice(0, 2).join(', ')}`);
  const reason = parts.length
    ? `Title sits in your seniority range and the posting touches ${parts.join(' and ')}. Full job description wasn't reachable, so this is a partial read.`
    : `Title sits in your seniority range, but nothing in the posting connects to your specific skills or interests.`;
  return { v, reason, fallback: true };
}

// ---------- Domain (cap from weights.domain, default 15) ----------
function scoreDomain(r: RoleRow, cap: number, ctx?: UserContext): { v: number; reason: string } {
  if (!ctx || !ctx.pastSectors.length) return legacySector(r.sector, cap);
  const text = postingText(r);
  const stop = new Set(['the','a','and','of','for','in','to','with','on','at','via','then','from','an','or']);
  const tokens = new Set<string>();
  for (const blob of ctx.pastSectors) {
    for (const raw of blob.toLowerCase().split(/[^a-z0-9+]+/)) {
      if (raw.length >= 4 && !stop.has(raw)) tokens.add(raw);
    }
  }
  const compounds = ['health tech','healthtech','health care','healthcare','edtech','education','chronic','consumer','platform','marketplace','telehealth','civic'];
  for (const c of compounds) if (ctx.pastSectors.some(s => s.toLowerCase().includes(c))) tokens.add(c);
  const hits = listMatches(text, [...tokens], 5);
  // Filter out the noisy generic tokens that come from splitting sector blobs
  // ("multi", "sector", "based") — they leak into rationales and read poorly.
  const meaningful = hits.filter(h => h.length >= 5 && !['multi','sector','based','focus'].includes(h));
  const tier = hits.length >= 4 ? cap : hits.length === 3 ? Math.round(cap * 0.80) : hits.length === 2 ? Math.round(cap * 0.60) : hits.length === 1 ? Math.round(cap * 0.40) : Math.round(cap * 0.20);
  const reason = meaningful.length
    ? `Adjacent to where you've worked — ${meaningful.slice(0, 4).join(', ')}.`
    : hits.length
      ? 'Loosely adjacent to your past sectors.'
      : 'Outside the healthcare, edtech, and consumer-SaaS surface where you\'ve spent your career.';
  return { v: tier, reason };
}

function legacySector(s: string, cap: number): { v: number; reason: string } {
  const x = (s || '').toLowerCase();
  if (!x) return { v: Math.round(cap * 0.40), reason: 'The posting doesn\'t flag a sector.' };
  if (/health|medical|clinical|telehealth|civic|public|nonprofit/.test(x)) return { v: cap, reason: `Healthcare or civic — your strongest past domain.` };
  if (/edtech|education/.test(x)) return { v: cap, reason: `Education — the world you came up in at Remind.` };
  if (/ai-native|legal ai|productivity|saas|fintech/.test(x)) return { v: Math.round(cap * 0.67), reason: `Adjacent to your platform and SaaS work, but not your core domain.` };
  if (/consumer|hardware|retail|marketplace/.test(x)) return { v: Math.round(cap * 0.47), reason: `Some overlap with your consumer SaaS consulting.` };
  if (/ad-?tech|crypto|gambling/.test(x)) return { v: 0, reason: `Sits on your deal-breaker list.` };
  return { v: Math.round(cap * 0.40), reason: `Doesn't map cleanly to where you've worked.` };
}

// ---------- Career arc (cap from weights.arc, default 10) ----------
// Seniority recognition is Haiku-driven when a role-match call has run
// (seniorityHint passed from the cached row). Title-string regex is the
// fallback only — and only for postings we haven't graded yet.
function scoreArc(r: RoleRow, cap: number, ctx?: UserContext, seniorityHint?: string | null): { v: number; reason: string } {
  const text = postingText(r);
  const arcSignals = (ctx?.arcTags?.length ? ctx.arcTags : [
    'zero to one','zero-to-one','founding','platform','scale','scaled','ipo','acquisition','growth','pmf','product-market fit','greenfield','0 to 1'
  ]).map(s => s.toLowerCase());
  const arcHits = listMatches(text, arcSignals, 4);
  const investors = (r.investors + ' ' + r.crunchbase).toLowerCase();
  const earlyStage = /seed|series a|series b|pre-seed/.test(investors);
  const lateStage = /series d|series e|late stage|public/.test(investors);

  let isSeniorScale: boolean, isFounding: boolean, seniorityLabel: string;
  if (seniorityHint) {
    const h = seniorityHint.toLowerCase();
    isFounding    = h === 'above' || h === 'founding';
    isSeniorScale = h === 'equivalent' || h === 'above' || h === 'founding';
    seniorityLabel = h;
  } else {
    const t = r.title.toLowerCase();
    isFounding    = /founding (pm|product)/.test(t);
    isSeniorScale = /senior|staff|principal|head of|director|vp|\blead\b/.test(t);
    seniorityLabel = isFounding ? 'founding' : isSeniorScale ? 'senior' : 'unrecognized';
  }

  let coherence = 0;
  const isStrongCoherence = isFounding && earlyStage;
  const isScaleUpCoherence = isSeniorScale && !earlyStage && !lateStage;
  const isLateStageMismatch = isSeniorScale && lateStage;
  if (isStrongCoherence)    coherence += cap * 0.4;
  if (isScaleUpCoherence)   coherence += cap * 0.2;
  if (isLateStageMismatch)  coherence -= cap * 0.1;
  const fromHits = Math.min(cap * 0.6, arcHits.length * (cap * 0.2));
  const v = clampToCap(Math.round(fromHits + coherence), cap);

  let reason: string;
  if (isStrongCoherence) {
    reason = `A founding seat at an early-stage company — the shape of role you've been pointing toward.`;
  } else if (isScaleUpCoherence) {
    reason = arcHits.length
      ? `A senior IC seat with scale-up language — ${arcHits.slice(0, 2).join(', ')} — on your trajectory from Livongo.`
      : `A senior IC seat at scale-up stage — on your trajectory from Livongo.`;
  } else if (isLateStageMismatch) {
    reason = `Senior IC shape, but the company is past the stage where you've done your best work.`;
  } else if (arcHits.length) {
    reason = `Some arc signal — ${arcHits.slice(0, 3).join(', ')} — but the seniority or stage isn't a clean match.`;
  } else {
    reason = `Hard to read the trajectory fit from this posting — neither the stage nor the scope is spelled out.`;
  }
  return { v, reason };
}

// ---------- Stage (cap from weights.stage, default 4) ----------
function scoreStage(r: RoleRow, cap: number): { v: number; reason: string; fail?: string } {
  const i = (r.investors + ' ' + r.crunchbase).toLowerCase();
  if (/(?:^|\W)(google|meta|amazon|microsoft|apple|salesforce)(?:\W|$)/.test((r.company + ' ' + i).toLowerCase())) {
    return { v: Math.round(cap * 0.25), fail: 'public / mega-cap', reason: 'Public, mega-cap company — outside the company shape you\'re targeting.' };
  }
  if (/series d|series e|late stage/.test(i)) return { v: Math.round(cap * 0.5), reason: 'Later-stage company — past your sweet spot but workable.' };
  if (/series a|series b|series c|seed|pre-seed/.test(i)) {
    const m = i.match(/series [a-c]|seed|pre-seed/);
    return { v: cap, reason: `${(m?.[0] || 'Early-stage')} — right in your target band.` };
  }
  return { v: Math.round(cap * 0.6), reason: 'Hard to place the stage from this posting — worth checking before a conversation.' };
}

// ---------- Comp (cap from weights.comp, default 4) ----------
function scoreComp(s: string, cap: number): { v: number; reason: string } {
  if (!s) return { v: Math.round(cap * 0.5), reason: 'Compensation isn\'t disclosed — worth pinning down early.' };
  const txt = s.toLowerCase().replace(/[,$\s]/g, '');
  const nums = Array.from(txt.matchAll(/(\d+(?:\.\d+)?)(k)?/g)).map(m => {
    const n = parseFloat(m[1]);
    return m[2] === 'k' ? n * 1000 : n;
  });
  if (!nums.length) return { v: Math.round(cap * 0.5), reason: 'Salary text didn\'t parse cleanly — worth confirming in writing.' };
  const top = Math.max(...nums);
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
  if (top < 10000) return { v: Math.round(cap * 0.5), reason: 'Posted figure looks like a percentage rather than a base — confirm before reading further into it.' };
  if (top >= 200000) return { v: cap, reason: `Top of range at ${fmt(top)} clears the floor you\'ve set.` };
  if (top >= 170000) return { v: Math.round(cap * 0.6), reason: `Top of range at ${fmt(top)} comes in under your floor.` };
  return { v: Math.round(cap * 0.2), reason: `Top of range at ${fmt(top)} is well under your floor.` };
}

// ---------- Geo (cap from weights.geo, default 2) ----------
function scoreGeo(_r: RoleRow, cap: number): { v: number; reason: string; fail?: string } {
  return { v: Math.round(cap * 0.8), reason: 'Already inside the locations you\'re open to.' };
}

// ---------- Compose ----------
export function computeFit(r: RoleRow, ctx?: UserContext, preComputedRole?: number | null, seniorityHint?: string | null, haikuRationale?: string | null): FitResult {
  const w: FitWeights = { ...DEFAULT_WEIGHTS, ...(ctx?.weights || {}) };
  const values  = scoreValues(r, w.values, ctx);
  const culture = scoreCulture(r, w.culture, ctx);
  const role    = scoreRole(r, w.role, ctx, preComputedRole, haikuRationale);
  const domain  = scoreDomain(r, w.domain, ctx);
  const arc     = scoreArc(r, w.arc, ctx, seniorityHint);
  const stage   = scoreStage(r, w.stage);
  const geo     = scoreGeo(r, w.geo);
  const comp    = scoreComp(r.salary, w.comp);

  const breakdown: FitBreakdown = {
    values:  values.v,
    culture: culture.v,
    role:    role.v,
    domain:  domain.v,
    arc:     arc.v,
    stage:   stage.v,
    comp:    comp.v,
    geo:     geo.v,
  };

  const rationales: FitRationales = {
    values:  values.reason,
    culture: culture.reason,
    role:    role.reason,
    domain:  domain.reason,
    arc:     arc.reason,
    stage:   stage.reason,
    comp:    comp.reason,
    geo:     geo.reason,
  };

  const hardFails: string[] = [];
  if (values.fail) hardFails.push(values.fail);
  if (role.fail)   hardFails.push(role.fail);
  if (stage.fail)  hardFails.push(stage.fail);
  if (geo.fail)    hardFails.push(geo.fail);

  let raw = breakdown.values + breakdown.culture + breakdown.role + breakdown.domain +
            breakdown.arc + breakdown.stage + breakdown.comp + breakdown.geo;
  if (hardFails.length) raw = Math.min(raw, HARD_FAIL_CAP);

  return { score: Math.round(raw), breakdown, rationales, hardFails, roleFallback: role.fallback };
}
