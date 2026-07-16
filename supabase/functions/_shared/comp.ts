// comp.ts — pull a compensation range out of JD body text.
//
// Most direct-source postings disclose pay inside the description rather
// than a structured field ("US: $207000 - $301000 (USD) + bonus", "from
// $136,100/year ... up to $235,200/year", "The base salary range is
// 148,000 USD - 235,750 USD"). scoreComp only reads the salary column, so
// without extraction these all grade as "compensation isn't disclosed".
//
// Approach: sentence-scoped keyword gating. Only dollar amounts in
// sentences that talk about pay are collected — never bare figures like
// "manage a $10M budget" — then min/max over what survives. Amounts must
// land in a plausible annual-salary band (30k–2M).

const COMP_KEYWORDS  = /(salar|compensat|\bpay\b|pay range|base pay|paid|on-target|OTE|remunerat|\bwage\b|bonus|equity|benefits|USD|\/year|per year|annum)/i;
const NOT_COMP_WORDS = /(budget|revenue|\bARR\b|\bGMV\b|funding|raised|savings|valuation|cost savings|gift card|401\s?\(?k\)?)/i;

const MIN_SALARY = 30_000;
const MAX_SALARY = 2_000_000;

// The candidate's stated base-salary floor. Also hardcoded in the Haiku
// grading prompt (job-fit-haiku.ts) and scoreComp's reasons (fit.ts).
export const COMP_FLOOR = 200_000;

// Deterministic comp verdict: does the top of a stored salary string clear
// the floor? Pure arithmetic — comp_acceptable must never come from an LLM
// guess. Returns null when there's no salary or nothing parses as an annual
// figure ("not disclosed"), which the UI renders as unknown, not a mismatch.
export function compClears(salary: string | null | undefined, floor = COMP_FLOOR): boolean | null {
  if (!salary) return null;
  const txt = salary.toLowerCase().replace(/[,$\s]/g, '');
  const nums = Array.from(txt.matchAll(/(\d+(?:\.\d+)?)(k)?/g))
    .map(m => (m[2] === 'k' ? parseFloat(m[1]) * 1000 : parseFloat(m[1])))
    .filter(n => Number.isFinite(n));
  if (!nums.length) return null;
  const top = Math.max(...nums);
  // Sub-10k tops are percentages / hourly rates, not a base — same guard
  // as scoreComp. Unknown, not a fail.
  if (top < 10_000) return null;
  return top >= floor;
}

// "$207,000", "$207000", "$185K", "148,000 USD", "148000 USD"
const AMOUNT_RE = /(?:\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s?[kK]\b|\d{5,7})|(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{5,7})\s?USD\b)/g;

function parseAmount(raw: string): number {
  const t = raw.replace(/,/g, '').trim();
  const k = /[kK]$/.test(t.replace(/\s/g, ''));
  const n = parseFloat(t);
  return k ? n * 1000 : n;
}

export function extractCompensation(text: string | null | undefined): string | null {
  if (!text) return null;
  const plain = text.replace(/ /g, ' ').replace(/\s+/g, ' ');
  // Sentence-ish chunks. JD bodies are loose prose, so split on periods,
  // semicolons, and bullet-ish breaks.
  const chunks = plain.split(/(?<=[.;!?])\s+|\n+/);
  const amounts: number[] = [];
  // An explicit "$X - $Y" range is comp language on its own (Netflix's
  // "the overall market range ... is typically $60,000 - $270,000" has no
  // pay keyword in the sentence).
  const RANGE_RE = /\$\s?[\d,\.]+\s?[kK]?\s*(?:-|–|—|to)\s*\$?\s?[\d,\.]+\s?[kK]?/;
  for (const c of chunks) {
    if (!COMP_KEYWORDS.test(c) && !RANGE_RE.test(c)) continue;
    if (NOT_COMP_WORDS.test(c) && !/salar|compensat|pay range|base pay/i.test(c)) continue;
    for (const m of c.matchAll(AMOUNT_RE)) {
      const n = parseAmount(m[1] ?? m[2] ?? '');
      if (Number.isFinite(n) && n >= MIN_SALARY && n <= MAX_SALARY) amounts.push(n);
    }
  }
  if (!amounts.length) return null;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  // A lone figure or a degenerate spread (>6x) reads as noise, not a range —
  // still surface the single number case, drop the absurd-spread case.
  if (min !== max && max / min > 6) return null;
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}
