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

// Wrap AI-supplied highlights AND opportunities into the markdown source.
// Both are returned by the cover-rationale edge function:
//   highlights:    [{ phrase, label, rationale }]
//   opportunities: [{ phrase, gap, ask }]
// Each phrase is matched as a verbatim case-insensitive substring;
// non-matches are silently skipped. Returns `{ html, comments }` where
// each comment carries `kind: 'rationale' | 'opportunity'` so the rail
// can style them differently.
export function applyAIHighlights(text, highlights, opportunities) {
  const body = String(text || '');
  const hl = Array.isArray(highlights) ? highlights : [];
  const ops = Array.isArray(opportunities) ? opportunities : [];
  if (!body || (!hl.length && !ops.length)) return { html: body, comments: [] };
  const lower = body.toLowerCase();
  const wrapped = [];
  const hits = [];

  for (const h of hl) {
    const phrase = String(h?.phrase || '').trim();
    if (!phrase) continue;
    const start = lower.indexOf(phrase.toLowerCase());
    if (start < 0) continue;
    const end = start + phrase.length;
    if (wrapped.some(([s, e]) => start < e && end > s)) continue;
    wrapped.push([start, end]);
    hits.push({ start, end, kind: 'rationale', label: String(h.label || ''), body: String(h.rationale || '') });
  }
  for (const o of ops) {
    const phrase = String(o?.phrase || '').trim();
    if (!phrase) continue;
    const start = lower.indexOf(phrase.toLowerCase());
    if (start < 0) continue;
    const end = start + phrase.length;
    if (wrapped.some(([s, e]) => start < e && end > s)) continue;
    wrapped.push([start, end]);
    hits.push({ start, end, kind: 'opportunity', label: 'Opportunity', gap: String(o.gap || ''), ask: String(o.ask || ''), body: String(o.gap || '') });
  }

  if (!hits.length) return { html: body, comments: [] };
  hits.sort((a, b) => a.start - b.start);
  const comments = [];
  let out = '';
  let cursor = 0;
  hits.forEach((h, i) => {
    const id = i + 1;
    comments.push({
      id,
      kind: h.kind,
      label: h.label,
      text: h.body,
      ask: h.ask || '',
      phrase: body.slice(h.start, h.end),
    });
    out += body.slice(cursor, h.start);
    const cls = h.kind === 'opportunity' ? 'd-op' : 'd-jd';
    out += `<mark class="${cls}" data-rationale="${id}">${body.slice(h.start, h.end)}<sup class="d-fn">${id}</sup></mark>`;
    cursor = h.end;
  });
  out += body.slice(cursor);
  return { html: out, comments };
}

// Highlight phrases AND collect rationale comments for each match.
// `sources` is an array of `{ label, text }` — label shows in the comment
// header (e.g. "Suggested angle"), text is the source bullet/sentence.
//
// Returns `{ html, comments }` where:
//   html      — markdown with <mark class="d-jd" data-rationale="N">…</mark>
//   comments  — [{ id, label, text }] in order of first appearance.
//
// The renderer can drop the body into the page and render the comments
// list in a side rail, anchoring each card to its mark via the data-id.
export function highlightPhrases(text, sources) {
  const body = String(text || '');
  if (!body) return { html: body, comments: [] };

  // Build phrase → source map (longest-first; first source wins for ties).
  const phraseToSource = new Map();
  for (const src of (sources || [])) {
    if (!src) continue;
    const label = (typeof src === 'string') ? '' : (src.label || '');
    const stext = (typeof src === 'string') ? src : (src.text || '');
    for (const c of chunkPhrase(stext)) {
      const k = c.toLowerCase();
      if (phraseToSource.has(k)) continue;
      phraseToSource.set(k, { phrase: c, label, text: stext });
    }
  }
  const phrases = Array.from(phraseToSource.values()).sort((a, b) => b.phrase.length - a.phrase.length);

  // Find non-overlapping matches in document order.
  const wrapped = [];
  const hits = [];
  const lower = body.toLowerCase();
  for (const p of phrases) {
    const re = new RegExp(escapeRegex(p.phrase), 'gi');
    let m;
    while ((m = re.exec(lower)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (wrapped.some(([s, e]) => start < e && end > s)) continue;
      wrapped.push([start, end]);
      hits.push({ start, end, label: p.label, text: p.text });
    }
  }
  if (!hits.length) return { html: body, comments: [] };
  hits.sort((a, b) => a.start - b.start);

  // De-duplicate comments by (label + text) so two highlights of the same
  // bullet share one comment card.
  const commentMap = new Map();
  const comments = [];
  let nextId = 1;
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    const key = `${h.label}\n${h.text}`;
    let id = commentMap.get(key);
    if (!id) {
      id = nextId++;
      commentMap.set(key, id);
      comments.push({ id, label: h.label, text: h.text });
    }
    out += body.slice(cursor, h.start);
    out += `<mark class="d-jd" data-rationale="${id}">${body.slice(h.start, h.end)}<sup class="d-fn">${id}</sup></mark>`;
    cursor = h.end;
  }
  out += body.slice(cursor);
  return { html: out, comments };
}
