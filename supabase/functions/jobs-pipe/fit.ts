// Fit score v2 — deterministic, weighted across role-fit, mission alignment,
// domain experience, skills, and career-arc signals. Pure function. No I/O.
//
// Inputs:
//   - RoleRow: one posting (sheet row OR pulled rec, normalized).
//   - UserContext (optional): vision mission keywords + skills + companies
//     pulled from job.* tables. When absent, those buckets score neutral
//     so legacy callers (add-role) still work without crashes.
//
// Weights (total 100, ordered by importance):
//   mission 20 | domain 15 | skills 15 | title 15 | arc 10
//   stage 10 | geo 5 | comp 5 | source 3 | network 2

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
  // v2: full posting description, used by mission/skills/arc/domain.
  description?: string;
}

export interface UserContext {
  // From job.vision — keyword pools the scorer matches posting text against.
  missionKeywords:   string[];   // health, education, cost-reduction terms
  antiMissionTerms:  string[];   // gambling, crypto, payday → mission = 0
  impactThemes:      string[];   // (kept for telemetry; not directly scored)
  missionRequired:   boolean;    // when true, zero-mission roles hard-fail
  // From job.skills — skill names + level/years.
  skills:            Array<{ name: string; years?: number | null }>;
  // From job.companies — sectors the user has actually worked in.
  pastSectors:       string[];   // free-text sector descriptions, lowercased
  // From job.vision.narrative_arc — career arc tags (ipo, acquisition,
  // zero-to-one, scale-up, platform, fractional, founding).
  arcTags:           string[];
}

export interface FitBreakdown {
  mission: number;
  domain:  number;
  skills:  number;
  title:   number;
  arc:     number;
  stage:   number;
  geo:     number;
  comp:    number;
  source:  number;
  network: number;
}

export interface FitResult {
  score:     number;
  breakdown: FitBreakdown;
  hardFails: string[];
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

// ---------- Title (max 15) ----------
function scoreTitle(t: string): { v: number; fail?: string } {
  const s = t.toLowerCase();
  if (!s) return { v: 0 };
  if (/intern|coordinator|associate|assistant\b/.test(s)) return { v: 0, fail: 'below seniority floor' };
  if (/founding (pm|product)/.test(s)) return { v: 15 };
  if (/(?:^|\s)(product lead|head of product)\b/.test(s)) return { v: 13 };
  if (/principal pm|principal product manager|staff pm|staff product manager/.test(s)) return { v: 12 };
  if (/group product manager|group pm/.test(s)) return { v: 11 };
  if (/senior pm|senior product manager|sr\.? pm/.test(s)) return { v: 11 };
  if (/director, product|director of product/.test(s)) return { v: 9 };
  if (/(^|\W)(pm|product manager)(\W|$)/.test(s)) return { v: 6 };
  return { v: 3 };
}

// ---------- Mission (max 20) ----------
// Match posting text against the user's mission_keywords pool. Anti-mission
// hits zero out the bucket. When mission_required and zero matches → hard fail.
function scoreMission(r: RoleRow, ctx?: UserContext): { v: number; fail?: string } {
  if (!ctx) return { v: 10 }; // neutral when no context loaded
  const text = postingText(r);
  if (ctx.antiMissionTerms.length && countMatches(text, ctx.antiMissionTerms) > 0) {
    return { v: 0, fail: 'mission-conflict (anti-theme)' };
  }
  if (!ctx.missionKeywords.length) return { v: 10 };
  const hits = countMatches(text, ctx.missionKeywords);
  if (hits === 0) {
    if (ctx.missionRequired) return { v: 0, fail: 'no mission alignment' };
    return { v: 4 };
  }
  if (hits === 1) return { v: 10 };
  if (hits === 2) return { v: 14 };
  if (hits === 3) return { v: 17 };
  return { v: 20 };
}

// ---------- Domain (max 15) ----------
// Has the user worked in a sector adjacent to this posting? Compare
// posting text vs the words inside each pastSectors entry. Catches the
// healthtech/edtech/consumer-saas overlap automatically without a hard
// list.
function scoreDomain(r: RoleRow, ctx?: UserContext): number {
  if (!ctx || !ctx.pastSectors.length) {
    // Fall back to the legacy sector keyword bucket so we don't regress
    // pre-context callers (add-role) too hard.
    return legacySector(r.sector);
  }
  const text = postingText(r);
  // Tokenize each past-sector blob into useful keywords.
  const stop = new Set(['the','a','and','of','for','in','to','with','on','at','via','then','from','an','or']);
  const tokens = new Set<string>();
  for (const blob of ctx.pastSectors) {
    for (const raw of blob.toLowerCase().split(/[^a-z0-9+]+/)) {
      if (raw.length >= 4 && !stop.has(raw)) tokens.add(raw);
    }
  }
  // Add compound keywords that matter beyond single tokens.
  const compounds = ['health tech','healthtech','health care','healthcare','edtech','education','chronic','consumer','platform','marketplace','telehealth'];
  for (const c of compounds) if (ctx.pastSectors.some(s => s.toLowerCase().includes(c))) tokens.add(c);

  const hits = countMatches(text, [...tokens]);
  if (hits >= 4) return 15;
  if (hits === 3) return 12;
  if (hits === 2) return 9;
  if (hits === 1) return 6;
  return 3;
}

function legacySector(s: string): number {
  const x = s.toLowerCase();
  if (!x) return 6;
  if (/health|medical|clinical|telehealth/.test(x)) return 15;
  if (/edtech|education/.test(x)) return 15;
  if (/ai-native|legal ai|productivity|saas|fintech/.test(x)) return 10;
  if (/consumer|hardware|retail|marketplace/.test(x)) return 7;
  if (/ad-?tech|crypto|gambling/.test(x)) return 0;
  return 6;
}

// ---------- Skills (max 15) ----------
// Count user-skill names that appear in posting text. Years-weighted: a
// 9-year skill hit is worth more than a 3-year skill hit, capped at 15.
function scoreSkills(r: RoleRow, ctx?: UserContext): number {
  if (!ctx || !ctx.skills.length) return 7; // neutral
  const text = postingText(r);
  let pts = 0;
  for (const s of ctx.skills) {
    const name = s.name.toLowerCase();
    if (!name) continue;
    // Also match common variants by stripping "foundation"/"thinking".
    const variants = [name, name.replace(/\s+(foundation|thinking|product)$/,'').trim()];
    if (variants.some(v => v && text.includes(v))) {
      const years = s.years || 3;
      pts += years >= 8 ? 4 : years >= 4 ? 3 : 2;
    }
  }
  return Math.min(15, pts || 4);
}

// ---------- Career arc (max 10) ----------
// Reward postings whose stage/scope/scale signals match a journey the
// user has actually walked. Founding PM at seed/A, scale-up at B+, IPO
// or acquisition language in the posting.
function scoreArc(r: RoleRow, ctx?: UserContext): number {
  const text = postingText(r);
  const arcSignals = (ctx?.arcTags?.length ? ctx.arcTags : [
    'zero to one','zero-to-one','founding','platform','scale','scaled','ipo','acquisition','growth','pmf','product-market fit','greenfield','0 to 1'
  ]).map(s => s.toLowerCase());
  const hits = countMatches(text, arcSignals);

  // Stage coherence: founding title vs early-stage investor signal.
  const investors = (r.investors + ' ' + r.crunchbase).toLowerCase();
  const earlyStage = /seed|series a|series b|pre-seed/.test(investors);
  const lateStage = /series d|series e|late stage|public/.test(investors);
  const isFounding = /founding (pm|product)/.test(r.title.toLowerCase());
  const isSeniorScale = /senior|staff|principal|head of|director|vp/.test(r.title.toLowerCase());

  let coherence = 0;
  if (isFounding && earlyStage) coherence += 4;
  if (isSeniorScale && !earlyStage && !lateStage) coherence += 2;
  if (isSeniorScale && lateStage) coherence -= 1;

  const fromHits = Math.min(6, hits * 2);
  return Math.max(0, Math.min(10, fromHits + coherence));
}

// ---------- Stage (max 10) ----------
function scoreStage(r: RoleRow): { v: number; fail?: string } {
  const i = (r.investors + ' ' + r.crunchbase).toLowerCase();
  if (/(?:^|\W)(google|meta|amazon|microsoft|apple|salesforce)(?:\W|$)/.test((r.company + ' ' + i).toLowerCase())) {
    return { v: 2, fail: 'public / mega-cap' };
  }
  if (/series d|series e|late stage/.test(i)) return { v: 5 };
  if (/series a|series b|series c|seed|pre-seed/.test(i)) return { v: 10 };
  return { v: 6 };
}

// ---------- Geo (max 5) — most filtering happens upstream now ----------
function scoreGeo(_r: RoleRow): { v: number; fail?: string } { return { v: 4 }; }

// ---------- Comp (max 5) ----------
function scoreComp(s: string): number {
  if (!s) return 3;
  const txt = s.toLowerCase().replace(/[,$\s]/g, '');
  const nums = Array.from(txt.matchAll(/(\d+(?:\.\d+)?)(k)?/g)).map(m => {
    const n = parseFloat(m[1]);
    return m[2] === 'k' ? n * 1000 : n;
  });
  if (!nums.length) return 3;
  const top = Math.max(...nums);
  if (top < 10000) return 3;
  if (top >= 200000) return 5;
  if (top >= 170000) return 3;
  return 1;
}

// ---------- Source (max 3) ----------
function scoreSource(s: string): number {
  const x = s.toLowerCase();
  if (x.includes('network')) return 3;
  if (x.includes('linkedin saved')) return 2;
  if (x.includes('linkedin recommended')) return 2;
  if (x.includes('from company pages')) return 1;
  return 1;
}

// ---------- Network (max 2) ----------
function scoreNetwork(r: RoleRow): number {
  return r.contact && r.contact.trim().length > 1 ? 2 : 0;
}

// ---------- Compose ----------
export function computeFit(r: RoleRow, ctx?: UserContext): FitResult {
  const title   = scoreTitle(r.title);
  const stage   = scoreStage(r);
  const geo     = scoreGeo(r);
  const mission = scoreMission(r, ctx);

  const breakdown: FitBreakdown = {
    mission: mission.v,
    domain:  scoreDomain(r, ctx),
    skills:  scoreSkills(r, ctx),
    title:   title.v,
    arc:     scoreArc(r, ctx),
    stage:   stage.v,
    geo:     geo.v,
    comp:    scoreComp(r.salary),
    source:  scoreSource(r.source),
    network: scoreNetwork(r),
  };

  const hardFails: string[] = [];
  if (title.fail)   hardFails.push(title.fail);
  if (stage.fail)   hardFails.push(stage.fail);
  if (geo.fail)     hardFails.push(geo.fail);
  if (mission.fail) hardFails.push(mission.fail);

  let raw = breakdown.mission + breakdown.domain + breakdown.skills + breakdown.title +
            breakdown.arc + breakdown.stage + breakdown.geo + breakdown.comp +
            breakdown.source + breakdown.network;
  if (hardFails.length) raw = Math.min(raw, HARD_FAIL_CAP);

  return { score: Math.round(raw), breakdown, hardFails };
}
