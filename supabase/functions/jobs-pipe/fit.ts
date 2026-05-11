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

export interface FitResult {
  score:        number;
  breakdown:    FitBreakdown;
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

function clampToCap(v: number, cap: number): number {
  return Math.max(0, Math.min(cap, v));
}

// ---------- Values & impact (cap from weights.values, default 25) ----------
// Mission keywords + impact themes are the dominant signal. Anti-mission
// terms zero the bucket. When mission_required and zero matches → hard fail.
function scoreValues(r: RoleRow, cap: number, ctx?: UserContext): { v: number; fail?: string } {
  if (!ctx) return { v: Math.round(cap * 0.4) };
  const text = postingText(r);
  if (ctx.antiMissionTerms.length && countMatches(text, ctx.antiMissionTerms) > 0) {
    return { v: 0, fail: 'mission-conflict (anti-theme)' };
  }
  if (!ctx.missionKeywords.length) return { v: Math.round(cap * 0.4) };
  const hits = countMatches(text, ctx.missionKeywords);
  if (hits === 0) {
    if (ctx.missionRequired) return { v: 0, fail: 'no mission alignment' };
    return { v: Math.round(cap * 0.15) };
  }
  // Each hit ≈ 1/6 of the cap, saturating at the cap.
  return { v: clampToCap(Math.round(hits * (cap / 6)), cap) };
}

// ---------- Culture (cap from weights.culture, default 15) ----------
function scoreCulture(r: RoleRow, cap: number, ctx?: UserContext): number {
  if (!ctx || !ctx.cultureKeywords.length) return Math.round(cap * 0.4);
  const text = postingText(r);
  const hits = countMatches(text, ctx.cultureKeywords);
  if (hits === 0) return Math.round(cap * 0.15);
  return clampToCap(Math.round(hits * (cap / 4)), cap);
}

// ---------- Role match (cap from weights.role, default 25) ----------
// When a Haiku-computed score is available (preComputedRole), use it. Otherwise
// fall back to a regex bag-of-words match: title seniority floor + skill hits +
// interest-tag hits + sane defaults.
function scoreRole(r: RoleRow, cap: number, ctx?: UserContext, preComputedRole?: number | null): { v: number; fail?: string; fallback: boolean } {
  if (preComputedRole != null && Number.isFinite(preComputedRole)) {
    return { v: clampToCap(Math.round(preComputedRole * (cap / 25)), cap), fallback: false };
  }
  // Title floor — same hard-fail rule as before.
  const t = (r.title || '').toLowerCase();
  if (!t) return { v: 0, fallback: true };
  if (/intern|coordinator|associate|assistant\b/.test(t)) {
    return { v: 0, fail: 'below seniority floor', fallback: true };
  }
  // Title base (max 40% of cap).
  let titleBase: number;
  if (/founding (pm|product)/.test(t)) titleBase = cap * 0.40;
  else if (/(?:^|\s)(product lead|head of product)\b/.test(t)) titleBase = cap * 0.36;
  else if (/principal pm|principal product manager|staff pm|staff product manager/.test(t)) titleBase = cap * 0.32;
  else if (/group product manager|group pm|senior pm|senior product manager|sr\.? pm/.test(t)) titleBase = cap * 0.30;
  else if (/director, product|director of product/.test(t)) titleBase = cap * 0.24;
  else if (/(^|\W)(pm|product manager)(\W|$)/.test(t)) titleBase = cap * 0.20;
  else titleBase = cap * 0.10;

  if (!ctx) return { v: Math.round(titleBase), fallback: true };

  const text = postingText(r);
  // Skill hits — max 30% of cap.
  let skillPts = 0;
  for (const s of ctx.skills) {
    const name = s.name.toLowerCase();
    if (!name) continue;
    const variants = [name, name.replace(/\s+(foundation|thinking|product)$/, '').trim()];
    if (variants.some(v => v && text.includes(v))) {
      const years = s.years || 3;
      skillPts += years >= 8 ? 2.0 : years >= 4 ? 1.5 : 1.0;
    }
  }
  skillPts = Math.min(cap * 0.30, skillPts);
  // Interest-tag hits — max 30% of cap.
  const interestHits = countMatches(text, ctx.interestTags || []);
  const interestPts = Math.min(cap * 0.30, interestHits * (cap * 0.06));

  return { v: clampToCap(Math.round(titleBase + skillPts + interestPts), cap), fallback: true };
}

// ---------- Domain (cap from weights.domain, default 15) ----------
function scoreDomain(r: RoleRow, cap: number, ctx?: UserContext): number {
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
  const hits = countMatches(text, [...tokens]);
  if (hits >= 4) return cap;
  if (hits === 3) return Math.round(cap * 0.80);
  if (hits === 2) return Math.round(cap * 0.60);
  if (hits === 1) return Math.round(cap * 0.40);
  return Math.round(cap * 0.20);
}

function legacySector(s: string, cap: number): number {
  const x = (s || '').toLowerCase();
  if (!x) return Math.round(cap * 0.40);
  if (/health|medical|clinical|telehealth|civic|public|nonprofit/.test(x)) return cap;
  if (/edtech|education/.test(x)) return cap;
  if (/ai-native|legal ai|productivity|saas|fintech/.test(x)) return Math.round(cap * 0.67);
  if (/consumer|hardware|retail|marketplace/.test(x)) return Math.round(cap * 0.47);
  if (/ad-?tech|crypto|gambling/.test(x)) return 0;
  return Math.round(cap * 0.40);
}

// ---------- Career arc (cap from weights.arc, default 10) ----------
function scoreArc(r: RoleRow, cap: number, ctx?: UserContext): number {
  const text = postingText(r);
  const arcSignals = (ctx?.arcTags?.length ? ctx.arcTags : [
    'zero to one','zero-to-one','founding','platform','scale','scaled','ipo','acquisition','growth','pmf','product-market fit','greenfield','0 to 1'
  ]).map(s => s.toLowerCase());
  const hits = countMatches(text, arcSignals);
  const investors = (r.investors + ' ' + r.crunchbase).toLowerCase();
  const earlyStage = /seed|series a|series b|pre-seed/.test(investors);
  const lateStage = /series d|series e|late stage|public/.test(investors);
  const isFounding = /founding (pm|product)/.test(r.title.toLowerCase());
  const isSeniorScale = /senior|staff|principal|head of|director|vp/.test(r.title.toLowerCase());
  let coherence = 0;
  if (isFounding && earlyStage) coherence += cap * 0.4;
  if (isSeniorScale && !earlyStage && !lateStage) coherence += cap * 0.2;
  if (isSeniorScale && lateStage) coherence -= cap * 0.1;
  const fromHits = Math.min(cap * 0.6, hits * (cap * 0.2));
  return clampToCap(Math.round(fromHits + coherence), cap);
}

// ---------- Stage (cap from weights.stage, default 4) ----------
function scoreStage(r: RoleRow, cap: number): { v: number; fail?: string } {
  const i = (r.investors + ' ' + r.crunchbase).toLowerCase();
  if (/(?:^|\W)(google|meta|amazon|microsoft|apple|salesforce)(?:\W|$)/.test((r.company + ' ' + i).toLowerCase())) {
    return { v: Math.round(cap * 0.25), fail: 'public / mega-cap' };
  }
  if (/series d|series e|late stage/.test(i)) return { v: Math.round(cap * 0.5) };
  if (/series a|series b|series c|seed|pre-seed/.test(i)) return { v: cap };
  return { v: Math.round(cap * 0.6) };
}

// ---------- Comp (cap from weights.comp, default 4) ----------
function scoreComp(s: string, cap: number): number {
  if (!s) return Math.round(cap * 0.5);
  const txt = s.toLowerCase().replace(/[,$\s]/g, '');
  const nums = Array.from(txt.matchAll(/(\d+(?:\.\d+)?)(k)?/g)).map(m => {
    const n = parseFloat(m[1]);
    return m[2] === 'k' ? n * 1000 : n;
  });
  if (!nums.length) return Math.round(cap * 0.5);
  const top = Math.max(...nums);
  if (top < 10000) return Math.round(cap * 0.5);
  if (top >= 200000) return cap;
  if (top >= 170000) return Math.round(cap * 0.6);
  return Math.round(cap * 0.2);
}

// ---------- Geo (cap from weights.geo, default 2) ----------
function scoreGeo(_r: RoleRow, cap: number): { v: number; fail?: string } {
  return { v: Math.round(cap * 0.8) };
}

// ---------- Compose ----------
export function computeFit(r: RoleRow, ctx?: UserContext, preComputedRole?: number | null): FitResult {
  const w: FitWeights = { ...DEFAULT_WEIGHTS, ...(ctx?.weights || {}) };
  const values  = scoreValues(r, w.values, ctx);
  const culture = scoreCulture(r, w.culture, ctx);
  const role    = scoreRole(r, w.role, ctx, preComputedRole);
  const domain  = scoreDomain(r, w.domain, ctx);
  const arc     = scoreArc(r, w.arc, ctx);
  const stage   = scoreStage(r, w.stage);
  const geo     = scoreGeo(r, w.geo);
  const comp    = scoreComp(r.salary, w.comp);

  const breakdown: FitBreakdown = {
    values:  values.v,
    culture,
    role:    role.v,
    domain,
    arc,
    stage:   stage.v,
    comp,
    geo:     geo.v,
  };

  const hardFails: string[] = [];
  if (values.fail) hardFails.push(values.fail);
  if (role.fail)   hardFails.push(role.fail);
  if (stage.fail)  hardFails.push(stage.fail);
  if (geo.fail)    hardFails.push(geo.fail);

  let raw = breakdown.values + breakdown.culture + breakdown.role + breakdown.domain +
            breakdown.arc + breakdown.stage + breakdown.comp + breakdown.geo;
  if (hardFails.length) raw = Math.min(raw, HARD_FAIL_CAP);

  return { score: Math.round(raw), breakdown, hardFails, roleFallback: role.fallback };
}
