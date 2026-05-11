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
  if (!ctx) return { v: Math.round(cap * 0.4), reason: 'No mission profile loaded; scored at neutral.' };
  const text = postingText(r);
  if (ctx.antiMissionTerms.length) {
    const anti = listMatches(text, ctx.antiMissionTerms, 3);
    if (anti.length) return { v: 0, fail: 'mission-conflict (anti-theme)', reason: `Anti-theme detected (${anti.join(', ')}); bucket zeroed.` };
  }
  if (!ctx.missionKeywords.length) return { v: Math.round(cap * 0.4), reason: 'No mission keywords on your vision; scored at neutral.' };
  const hits = listMatches(text, ctx.missionKeywords, 5);
  if (hits.length === 0) {
    if (ctx.missionRequired) return { v: 0, fail: 'no mission alignment', reason: 'No impact keywords in title, company, or JD. Mission required = hard fail.' };
    return { v: Math.round(cap * 0.15), reason: 'No impact keywords found in title, company, or JD text.' };
  }
  const v = clampToCap(Math.round(hits.length * (cap / 6)), cap);
  return { v, reason: `Matched ${hits.length} impact term${hits.length === 1 ? '' : 's'}: ${hits.slice(0, 4).join(', ')}.` };
}

// ---------- Culture (cap from weights.culture, default 15) ----------
function scoreCulture(r: RoleRow, cap: number, ctx?: UserContext): { v: number; reason: string } {
  if (!ctx || !ctx.cultureKeywords.length) return { v: Math.round(cap * 0.4), reason: 'No culture keywords on your vision; scored at neutral.' };
  const text = postingText(r);
  const hits = listMatches(text, ctx.cultureKeywords, 5);
  if (hits.length === 0) return { v: Math.round(cap * 0.15), reason: 'No culture cues (autonomy, eng bar, AI-native, mission-led) in JD or About text.' };
  const v = clampToCap(Math.round(hits.length * (cap / 4)), cap);
  return { v, reason: `Matched ${hits.length} culture cue${hits.length === 1 ? '' : 's'}: ${hits.slice(0, 4).join(', ')}.` };
}

// ---------- Role match (cap from weights.role, default 25) ----------
// When a Haiku-computed score is available (preComputedRole), use it. Otherwise
// fall back to a regex bag-of-words match: title seniority floor + skill hits +
// interest-tag hits + sane defaults.
function scoreRole(r: RoleRow, cap: number, ctx?: UserContext, preComputedRole?: number | null, haikuRationale?: string | null): { v: number; reason: string; fail?: string; fallback: boolean } {
  if (preComputedRole != null && Number.isFinite(preComputedRole)) {
    return {
      v: clampToCap(Math.round(preComputedRole * (cap / 25)), cap),
      reason: haikuRationale && haikuRationale.trim().length ? haikuRationale : `Claude Haiku graded role fit at ${preComputedRole}/25.`,
      fallback: false,
    };
  }
  const t = (r.title || '').toLowerCase();
  if (!t) return { v: 0, reason: 'No title on this posting; cannot score role.', fallback: true };
  if (/intern|coordinator|associate|assistant\b/.test(t)) {
    return { v: 0, fail: 'below seniority floor', reason: `Title "${r.title}" is below your seniority floor; capped at 0.`, fallback: true };
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

  if (!ctx) return { v: Math.round(titleBase), reason: `Regex fallback (no JD description). Title "${r.title}" scored ${Math.round(titleBase)}/${cap}.`, fallback: true };

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
  if (skillHits.length) parts.push(`skills: ${skillHits.slice(0, 3).join(', ')}`);
  if (interestHits.length) parts.push(`interests: ${interestHits.slice(0, 2).join(', ')}`);
  const reason = parts.length
    ? `Regex fallback (no Haiku grade yet). Title + ${parts.join('; ')}.`
    : `Regex fallback (no Haiku grade yet). Title "${r.title}" only; no skill or interest hits in JD.`;
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
  const tier = hits.length >= 4 ? cap : hits.length === 3 ? Math.round(cap * 0.80) : hits.length === 2 ? Math.round(cap * 0.60) : hits.length === 1 ? Math.round(cap * 0.40) : Math.round(cap * 0.20);
  const reason = hits.length
    ? `Overlap with your past sectors: ${hits.slice(0, 4).join(', ')}.`
    : 'No overlap with your past sectors (Remind, Livongo/Teladoc, consulting) in posting text.';
  return { v: tier, reason };
}

function legacySector(s: string, cap: number): { v: number; reason: string } {
  const x = (s || '').toLowerCase();
  if (!x) return { v: Math.round(cap * 0.40), reason: 'No sector tag on posting; scored at neutral.' };
  if (/health|medical|clinical|telehealth|civic|public|nonprofit/.test(x)) return { v: cap, reason: `Sector "${s}" maps to healthcare / civic — your strongest past domain.` };
  if (/edtech|education/.test(x)) return { v: cap, reason: `Sector "${s}" — your Remind edtech experience.` };
  if (/ai-native|legal ai|productivity|saas|fintech/.test(x)) return { v: Math.round(cap * 0.67), reason: `Sector "${s}" — adjacent to your platform/SaaS work but not core.` };
  if (/consumer|hardware|retail|marketplace/.test(x)) return { v: Math.round(cap * 0.47), reason: `Sector "${s}" — partial overlap with your consumer-SaaS consulting.` };
  if (/ad-?tech|crypto|gambling/.test(x)) return { v: 0, reason: `Sector "${s}" is on your deal-breaker list.` };
  return { v: Math.round(cap * 0.40), reason: `Sector "${s}" doesn't map cleanly to your past domains.` };
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
  const cohereParts: string[] = [];
  if (isFounding && earlyStage) { coherence += cap * 0.4; cohereParts.push('founding × early-stage'); }
  if (isSeniorScale && !earlyStage && !lateStage) { coherence += cap * 0.2; cohereParts.push(`${seniorityLabel} seniority × scale-up coherence`); }
  if (isSeniorScale && lateStage) { coherence -= cap * 0.1; cohereParts.push('senior × late-stage penalty'); }
  const fromHits = Math.min(cap * 0.6, arcHits.length * (cap * 0.2));
  const v = clampToCap(Math.round(fromHits + coherence), cap);
  const reasonParts: string[] = [];
  if (arcHits.length) reasonParts.push(`arc signals: ${arcHits.slice(0, 3).join(', ')}`);
  if (cohereParts.length) reasonParts.push(cohereParts.join(' + '));
  const reason = reasonParts.length
    ? reasonParts.join('; ') + '.'
    : `No arc signals (founding/scale/IPO/0→1) in posting; seniority "${seniorityLabel}" with no stage info.`;
  return { v, reason };
}

// ---------- Stage (cap from weights.stage, default 4) ----------
function scoreStage(r: RoleRow, cap: number): { v: number; reason: string; fail?: string } {
  const i = (r.investors + ' ' + r.crunchbase).toLowerCase();
  if (/(?:^|\W)(google|meta|amazon|microsoft|apple|salesforce)(?:\W|$)/.test((r.company + ' ' + i).toLowerCase())) {
    return { v: Math.round(cap * 0.25), fail: 'public / mega-cap', reason: 'Public / mega-cap company; hard-fail cap applied.' };
  }
  if (/series d|series e|late stage/.test(i)) return { v: Math.round(cap * 0.5), reason: 'Late-stage (Series D+); past your sweet spot but acceptable.' };
  if (/series a|series b|series c|seed|pre-seed/.test(i)) {
    const m = i.match(/series [a-c]|seed|pre-seed/);
    return { v: cap, reason: `${(m?.[0] || 'early stage')} startup — your target stage.` };
  }
  return { v: Math.round(cap * 0.6), reason: 'No investor data on this posting; scored at neutral.' };
}

// ---------- Comp (cap from weights.comp, default 4) ----------
function scoreComp(s: string, cap: number): { v: number; reason: string } {
  if (!s) return { v: Math.round(cap * 0.5), reason: 'No compensation disclosed in posting.' };
  const txt = s.toLowerCase().replace(/[,$\s]/g, '');
  const nums = Array.from(txt.matchAll(/(\d+(?:\.\d+)?)(k)?/g)).map(m => {
    const n = parseFloat(m[1]);
    return m[2] === 'k' ? n * 1000 : n;
  });
  if (!nums.length) return { v: Math.round(cap * 0.5), reason: `Salary text "${s}" couldn't be parsed.` };
  const top = Math.max(...nums);
  const fmt = (n: number) => `$${Math.round(n / 1000)}k`;
  if (top < 10000) return { v: Math.round(cap * 0.5), reason: `Parsed value (${fmt(top)}) looks too low; likely a percentage. Scored neutral.` };
  if (top >= 200000) return { v: cap, reason: `Top of range ${fmt(top)} clears your $200k floor.` };
  if (top >= 170000) return { v: Math.round(cap * 0.6), reason: `Top of range ${fmt(top)} is under your $200k floor.` };
  return { v: Math.round(cap * 0.2), reason: `Top of range ${fmt(top)} is well under your $200k floor.` };
}

// ---------- Geo (cap from weights.geo, default 2) ----------
function scoreGeo(_r: RoleRow, cap: number): { v: number; reason: string; fail?: string } {
  return { v: Math.round(cap * 0.8), reason: 'Geo filtering happens upstream; this is a small fixed bonus.' };
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
