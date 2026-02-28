// ============================================
// TF-IDF — Tokenizer, IDF, Vector, Cosine Similarity
// Ported from PinRanker in boards/index.html
// ============================================

import type { Pin } from './types';

// --- Stopwords (merged from EVENTS_STOPWORDS + BOARD_STOPWORDS) ---
const STOPWORDS = new Set([
  // Core English stopwords
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'have', 'has',
  'are', 'was', 'were', 'been', 'being', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'not', 'but', 'its',
  'our', 'your', 'his', 'her', 'their', 'which', 'what', 'when',
  'where', 'how', 'who', 'whom', 'each', 'every', 'all', 'any',
  'few', 'more', 'most', 'some', 'such', 'than', 'too', 'very',
  'just', 'about', 'also', 'into', 'over', 'after', 'before',
  'between', 'through', 'during', 'only', 'then', 'them', 'these',
  'those', 'other', 'new', 'one', 'two', 'first', 'last', 'long',
  'great', 'little', 'own', 'old', 'right', 'big', 'high', 'small',
  'large', 'next', 'early', 'young', 'important', 'public', 'free',
  // Board-specific noise
  'out', 'down', 'off', 'let', 'say', 'see', 'use', 'way', 'day',
  'set', 'put', 'run', 'come', 'make', 'take', 'know', 'think',
  'look', 'want', 'give', 'well', 'back', 'much', 'even', 'here',
  'there', 'now', 'still', 'like', 'made', 'need', 'find', 'keep',
  'work', 'part', 'must', 'does',
  // Web noise
  'http', 'https', 'www', 'com', 'org', 'net', 'html', 'php',
  'page', 'site', 'click', 'link', 'share', 'view', 'login',
  'sign', 'newsletter', 'subscribe', 'cookie', 'privacy', 'terms',
  'official', 'best', 'top', 'buy', 'shop', 'sale',
  'order', 'cart', 'add', 'home', 'product', 'item', 'price',
  'store',
]);

// --- Genre Normalization ---
const GENRE_NORMALIZE: Record<string, string> = {
  // Video genres
  'action': 'action', 'adventure': 'action',
  'comedy': 'comedy', 'drama': 'drama', 'horror': 'horror',
  'science fiction': 'sci-fi', 'sci-fi': 'sci-fi',
  'thriller': 'thriller', 'romance': 'romance',
  'animation': 'animation', 'fantasy': 'fantasy',
  'mystery': 'mystery', 'crime': 'crime',
  'war': 'war', 'western': 'western',
  'family': 'family', 'history': 'history',
  'music': 'music', 'tv movie': 'drama',
  'action & adventure': 'action', 'sci-fi & fantasy': 'sci-fi',
  'war & politics': 'political', 'kids': 'animation',
  'reality': 'reality', 'soap': 'soap', 'talk': 'talk', 'news': 'news',
  'romantic': 'romance', 'animated': 'animation',
  'suspense': 'thriller', 'detective': 'mystery',
  'documentary': 'documentary', 'biographical': 'documentary',
  'noir': 'noir', 'neo-noir': 'noir', 'film-noir': 'noir',
  'musical': 'musical',
  'superhero': 'superhero', 'comic-book': 'superhero',
  'historical': 'period-drama', 'period': 'period-drama', 'costume': 'period-drama',
  'sports': 'sports', 'boxing': 'sports', 'racing': 'sports',
  'psychological': 'psychological',
  'disaster': 'apocalyptic', 'apocalyptic': 'apocalyptic', 'post-apocalyptic': 'apocalyptic',
  'anthology': 'anthology', 'episodic': 'anthology',
  'mockumentary': 'mockumentary', 'found-footage': 'mockumentary',
  'arthouse': 'arthouse', 'art-house': 'arthouse', 'experimental': 'arthouse', 'avant-garde': 'arthouse', 'indie': 'arthouse',
  'martial-arts': 'martial-arts', 'kung-fu': 'martial-arts', 'wuxia': 'martial-arts',
  'satire': 'dark-comedy', 'dark-comedy': 'dark-comedy', 'black-comedy': 'dark-comedy',
  'coming-of-age': 'coming-of-age', 'teen': 'coming-of-age',
  'espionage': 'spy', 'spy': 'spy',
  'survival': 'survival', 'wilderness': 'survival',
  'legal': 'legal', 'courtroom': 'legal',
  'political': 'political',
  'slice-of-life': 'slice-of-life',
  // Music genres
  'hip hop': 'hip-hop', 'hip-hop': 'hip-hop',
  'r&b': 'r-and-b', 'rnb': 'r-and-b', 'rhythm and blues': 'r-and-b',
  'drum and bass': 'dnb', 'drum-and-bass': 'dnb', 'd&b': 'dnb', "d'n'b": 'dnb',
  'lo-fi': 'lofi', 'lofi': 'lofi', 'lo fi': 'lofi',
  'synth-pop': 'synthpop', 'synthpop': 'synthpop',
  'deep house': 'deep-house', 'deep-house': 'deep-house',
  'tech house': 'tech-house', 'tech-house': 'tech-house',
  'indie rock': 'indie-rock', 'indie-rock': 'indie-rock',
  'alt rock': 'alt-rock', 'alt-rock': 'alt-rock', 'alternative rock': 'alt-rock',
  'post punk': 'post-punk', 'post-punk': 'post-punk',
  'neo soul': 'neo-soul', 'neo-soul': 'neo-soul',
  'psych rock': 'psych-rock', 'psych-rock': 'psych-rock', 'psychedelic rock': 'psych-rock',
  'prog rock': 'prog-rock', 'prog-rock': 'prog-rock', 'progressive rock': 'prog-rock',
  'death metal': 'death-metal', 'death-metal': 'death-metal',
  'black metal': 'black-metal', 'black-metal': 'black-metal',
  'math rock': 'math-rock', 'math-rock': 'math-rock',
  'afro beat': 'afrobeat', 'afrobeat': 'afrobeat',
  'bossa nova': 'bossa-nova', 'bossa-nova': 'bossa-nova',
  'k-pop': 'k-pop', 'kpop': 'k-pop',
  'j-pop': 'j-pop', 'jpop': 'j-pop',
  'singer songwriter': 'singer-songwriter', 'singer-songwriter': 'singer-songwriter',
  'garage rock': 'garage-rock', 'garage-rock': 'garage-rock',
};

function normalizeGenre(raw: string): string {
  if (!raw) return '';
  const key = raw.toLowerCase().trim();
  return GENRE_NORMALIZE[key] || key;
}

/** Tokenizer: lowercase, strip URLs/punctuation, filter stopwords, min 3 chars */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/g, '')     // Strip URLs
    .replace(/[^a-z0-9\-]/g, ' ')          // Keep hyphens for genre tokens
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/** Domain cleaner: "www.example.com" -> "example" */
export function cleanDomain(domain: string): string {
  if (!domain) return '';
  return domain.replace(/^www\./, '').replace(/\.(com|org|net|io|co|me|tv|fm|uk|de|fr|ca|au|us)(\.\w+)?$/, '');
}

/** Build weighted text doc from all pin fields — ported from buildPinDocument() */
export function buildPinDocument(pin: Pin): string {
  const parts: string[] = [];
  const repeat = (text: string, n: number) => { for (let i = 0; i < n; i++) parts.push(text); };

  // Title 3x (highest signal)
  if (pin.title) repeat(pin.title, 3);

  // Domain 2x (brand signal)
  const dom = cleanDomain(pin.domain);
  if (dom) repeat(dom, 2);

  // Category 2x
  if (pin.category && pin.category !== 'uncategorized') repeat(pin.category.replace(/-/g, ' '), 2);

  // Content type 1x
  if (pin.content_type) parts.push(pin.content_type);

  // Description 1x
  if (pin.description) parts.push(pin.description);

  // Tags 2x
  if (pin.tags && Array.isArray(pin.tags)) {
    repeat(pin.tags.join(' '), 2);
  }

  // Video metadata
  if (pin.video) {
    if (pin.video.genres) repeat(pin.video.genres.map(g => normalizeGenre(g)).filter(Boolean).join(' '), 2);
    if (pin.video.creator) repeat(pin.video.creator, 2);
    if (pin.video.keywords) repeat(pin.video.keywords.join(' '), 2);
    if (pin.video.tags) repeat(pin.video.tags.slice(0, 10).join(' '), 1);
    if (pin.video.summary) parts.push(pin.video.summary);
    if (pin.video.type) parts.push(pin.video.type);
  }

  // Book metadata
  if (pin.book) {
    if (pin.book.author) repeat(pin.book.author, 2);
    if (pin.book.genre) repeat(normalizeGenre(pin.book.genre) || pin.book.genre, 2);
    if (pin.book.summary) parts.push(pin.book.summary);
  }

  // Music metadata
  if (pin.music) {
    if (pin.music.artist) repeat(pin.music.artist, 3);
    if (pin.music.genre) repeat(normalizeGenre(pin.music.genre) || pin.music.genre, 2);
    if (pin.music.genreTags) repeat(pin.music.genreTags.map(g => normalizeGenre(g)).filter(Boolean).join(' '), 2);
    if (pin.music.albumTitle) parts.push(pin.music.albumTitle);
    if (pin.music.trackTitle) parts.push(pin.music.trackTitle);
  }

  return parts.join(' ');
}

/** IDF with smoothing, prune tokens in >60% of docs or appearing in <2 docs */
export function computeIDF(pins: Pin[]): Map<string, number> {
  const N = pins.length;
  const df = new Map<string, number>();

  for (const pin of pins) {
    const doc = buildPinDocument(pin);
    const tokens = tokenize(doc);
    const uniqueTokens = new Set(tokens);
    for (const t of uniqueTokens) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  const maxDf = N * 0.6;
  for (const [token, count] of df) {
    if (count > maxDf || count < 2) continue;
    idf.set(token, Math.log((N + 1) / (count + 1)) + 1);
  }

  return idf;
}

/** TF-IDF sparse vector */
export function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }

  const vec = new Map<string, number>();
  for (const [term, count] of tf) {
    const idfScore = idf.get(term);
    if (idfScore) {
      vec.set(term, count * idfScore);
    }
  }
  return vec;
}

/** Cosine similarity between two TF-IDF vectors */
export function cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
  let dot = 0, magA = 0, magB = 0;

  for (const [term, weightA] of vecA) {
    magA += weightA * weightA;
    const weightB = vecB.get(term);
    if (weightB) dot += weightA * weightB;
  }

  for (const [, weightB] of vecB) {
    magB += weightB * weightB;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
