// Fit score — deterministic, fixed weights for v1 per PRD.
// Pure function. No I/O. Inputs come from a single sheet row.

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
}

export interface FitBreakdown {
  title: number;
  stage: number;
  sector: number;
  geo: number;
  comp: number;
  source: number;
  network: number;
}

export interface FitResult {
  score: number;
  breakdown: FitBreakdown;
  hardFails: string[];
}

const HARD_FAIL_CAP = 30;

// --- Title scoring (max 25) ---
function scoreTitle(t: string): { v: number; fail?: string } {
  const s = t.toLowerCase();
  if (!s) return { v: 0 };
  if (/intern|coordinator|associate|assistant\b/.test(s)) return { v: 0, fail: 'below seniority floor' };
  if (/founding (pm|product)/.test(s)) return { v: 25 };
  if (/(?:^|\s)(product lead|head of product)\b/.test(s)) return { v: 22 };
  if (/principal pm|principal product manager|staff pm|staff product manager/.test(s)) return { v: 20 };
  if (/group product manager|group pm/.test(s)) return { v: 18 };
  if (/senior pm|senior product manager|sr\.? pm/.test(s)) return { v: 18 };
  if (/director, product|director of product/.test(s)) return { v: 15 };
  if (/(^|\W)(pm|product manager)(\W|$)/.test(s)) return { v: 10 };
  return { v: 5 };
}

// --- Stage signal (max 20). We have no stage column; infer from investor names. ---
function scoreStage(r: RoleRow): { v: number; fail?: string } {
  const i = (r.investors + ' ' + r.crunchbase).toLowerCase();
  // Public / mega-cap names — drop hard.
  if (/(?:^|\W)(google|meta|amazon|microsoft|apple|salesforce)(?:\W|$)/.test((r.company + ' ' + i).toLowerCase())) {
    return { v: 5, fail: 'public / mega-cap' };
  }
  if (/series d|series e|late stage/.test(i)) return { v: 10 };
  if (/series a|series b|series c|seed|pre-seed/.test(i)) return { v: 20 };
  // No signal — neutral 12.
  return { v: 12 };
}

// --- Sector scoring (max 20) ---
function scoreSector(s: string): number {
  const x = s.toLowerCase();
  if (!x) return 8;
  if (/health|medical|clinical|telehealth/.test(x)) return 20;
  if (/edtech|education/.test(x)) return 20;
  if (/ai-native|legal ai|productivity|saas|fintech/.test(x)) return 15;
  if (/consumer|hardware|retail|marketplace/.test(x)) return 10;
  if (/ad-?tech|crypto|gambling/.test(x)) return 0;
  return 10;
}

// --- Geo scoring (max 15). Sheet has no geo column; default to neutral. ---
function scoreGeo(_r: RoleRow): { v: number; fail?: string } {
  return { v: 10 };
}

// --- Comp scoring (max 10). Parse $XXXk-$YYYk or $XXX,XXX-$YYY,YYY. ---
function scoreComp(s: string): number {
  if (!s) return 5;
  const txt = s.toLowerCase().replace(/[,$\s]/g, '');
  const nums = Array.from(txt.matchAll(/(\d+(?:\.\d+)?)(k)?/g)).map(m => {
    const n = parseFloat(m[1]);
    return m[2] === 'k' ? n * 1000 : n;
  });
  if (!nums.length) return 5;
  // Use top of range if present, else single number.
  const top = Math.max(...nums);
  if (top < 10000) return 5; // probably a percentage or bad parse
  if (top >= 200000) return 10;
  if (top >= 170000) return 6;
  return 2;
}

// --- Source scoring (max 5) ---
function scoreSource(s: string): number {
  const x = s.toLowerCase();
  if (x.includes('network')) return 5;
  if (x.includes('linkedin saved')) return 4;
  if (x.includes('linkedin recommended')) return 3;
  if (x.includes('from company pages')) return 2;
  return 1;
}

// --- Network signal (max 5). Bumped if a contact name is filled in. ---
function scoreNetwork(r: RoleRow): number {
  let v = 0;
  if (r.contact && r.contact.trim().length > 1) v += 5;
  return v;
}

export function computeFit(r: RoleRow): FitResult {
  const title = scoreTitle(r.title);
  const stage = scoreStage(r);
  const geo = scoreGeo(r);
  const breakdown: FitBreakdown = {
    title: title.v,
    stage: stage.v,
    sector: scoreSector(r.sector),
    geo: geo.v,
    comp: scoreComp(r.salary),
    source: scoreSource(r.source),
    network: scoreNetwork(r),
  };
  const hardFails: string[] = [];
  if (title.fail) hardFails.push(title.fail);
  if (stage.fail) hardFails.push(stage.fail);
  if (geo.fail) hardFails.push(geo.fail);

  let raw = breakdown.title + breakdown.stage + breakdown.sector +
            breakdown.geo + breakdown.comp + breakdown.source + breakdown.network;
  if (hardFails.length) raw = Math.min(raw, HARD_FAIL_CAP);

  return { score: Math.round(raw), breakdown, hardFails };
}
