// diff.js — produce a marked-up markdown string showing changes between a
// "base" and a "tailored" version. The output is markdown with inline
// <ins class="d-add"> / <del class="d-del"> tags, which renderMarkdown passes
// through to DOMPurify (both tags are allowed by default).
//
// Word-level granularity. Whitespace and punctuation are treated as token
// boundaries by diffWords, so small edits (a swapped verb, a re-ordered
// keyword) show up as compact add/del pairs rather than whole-line rewrites.

import { diffWords } from 'https://esm.run/diff@5';

export function diffMarkdown(baseMd, tailoredMd) {
  const base = String(baseMd || '');
  const tailored = String(tailoredMd || '');
  if (!base) return tailored;
  const parts = diffWords(base, tailored);
  let out = '';
  for (const p of parts) {
    if (p.added)        out += wrapInline('ins', 'd-add', p.value);
    else if (p.removed) out += wrapInline('del', 'd-del', p.value);
    else                out += p.value;
  }
  return out;
}

// Don't let inline diff tags span newlines — markdown block parsers need
// structural \n's untouched, otherwise bullets and headings stop rendering.
function wrapInline(tag, cls, value) {
  return value.split(/(\n)/).map(seg => {
    if (seg === '\n') return '\n';
    if (!seg) return '';
    return `<${tag} class="${cls}">${seg}</${tag}>`;
  }).join('');
}

// Highlight phrases in `text` (markdown) that appear in any of the
// `sourcePhrases` strings. Used for cover-letter "from JD" highlighting:
// pull bullets from analysis.suggestedAngle / whyFits / strengths / gaps and
// mark substrings of the cover letter that echo them.
//
// Heuristic: tokenise each source into 3-6 word "chunks" (skipping bullets,
// headings, common stopwords-only chunks). For each chunk, do a literal
// case-insensitive match in the cover letter and wrap with <mark>.
//
// We deliberately keep this conservative — false positives are noisy.
const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','at','by','from',
  'is','are','was','were','be','been','being','as','that','this','it','its',
  'his','her','their','they','he','she','we','i','you','your','our','my','me',
  'but','if','then','than','so','not','no','do','does','did','have','has','had',
  'will','would','can','could','should','may','might','one','two','three',
]);

function chunkPhrase(s) {
  const cleaned = String(s || '')
    .replace(/[#*`_>\[\]]/g, ' ')
    .replace(/^\s*[-•·]\s*/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  const chunks = [];
  // Sliding 4-word windows; drop windows that are all stopwords or under
  // 12 chars total.
  for (let i = 0; i + 3 < words.length; i++) {
    const win = words.slice(i, i + 4);
    const meaningful = win.filter(w => !STOPWORDS.has(w.toLowerCase().replace(/[^a-z0-9-]/g, '')));
    if (meaningful.length < 2) continue;
    const phrase = win.join(' ');
    if (phrase.length < 12) continue;
    chunks.push(phrase);
  }
  return chunks;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function highlightPhrases(text, sources) {
  let body = String(text || '');
  if (!body) return body;
  const seen = new Set();
  const phrases = [];
  for (const src of (sources || [])) {
    for (const c of chunkPhrase(src)) {
      const k = c.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      phrases.push(c);
    }
  }
  // Sort longest-first so longer phrases match before their substrings.
  phrases.sort((a, b) => b.length - a.length);

  // Track ranges already wrapped to avoid nested <mark>.
  const wrapped = []; // [startIdx, endIdx)
  const hits = [];   // [{start, end, phrase}]
  const lower = body.toLowerCase();
  for (const p of phrases) {
    const re = new RegExp(escapeRegex(p), 'gi');
    let m;
    while ((m = re.exec(lower)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      const overlaps = wrapped.some(([s, e]) => start < e && end > s);
      if (overlaps) continue;
      wrapped.push([start, end]);
      hits.push({ start, end });
    }
  }
  if (!hits.length) return body;
  hits.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    out += body.slice(cursor, h.start);
    out += `<mark class="d-jd">${body.slice(h.start, h.end)}</mark>`;
    cursor = h.end;
  }
  out += body.slice(cursor);
  return out;
}
