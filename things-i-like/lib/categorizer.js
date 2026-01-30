/**
 * Categorizer Module
 * Analyzes content and assigns/proposes categories
 */

// Category detection patterns
const CATEGORY_PATTERNS = {
  media: {
    keywords: ['video', 'music', 'podcast', 'youtube', 'spotify', 'soundcloud', 'vimeo', 'netflix', 'album', 'song', 'movie', 'film', 'tv', 'show', 'stream', 'listen', 'watch', 'episode', 'playlist', 'bandcamp', 'tiktok'],
    domains: ['youtube.com', 'youtu.be', 'spotify.com', 'soundcloud.com', 'vimeo.com', 'netflix.com', 'twitch.tv', 'bandcamp.com', 'tiktok.com', 'apple.com/music']
  },
  tools: {
    keywords: ['app', 'software', 'tool', 'download', 'install', 'github', 'npm', 'package', 'library', 'framework', 'api', 'developer', 'code', 'programming', 'extension', 'plugin', 'saas', 'service', 'utility'],
    domains: ['github.com', 'gitlab.com', 'npmjs.com', 'pypi.org', 'apps.apple.com', 'play.google.com', 'producthunt.com', 'alternativeto.net']
  },
  places: {
    keywords: ['restaurant', 'cafe', 'bar', 'hotel', 'travel', 'location', 'address', 'directions', 'map', 'city', 'country', 'venue', 'shop', 'store', 'booking', 'reservation', 'menu', 'food', 'eat', 'drink'],
    domains: ['yelp.com', 'tripadvisor.com', 'google.com/maps', 'maps.google.com', 'airbnb.com', 'booking.com', 'opentable.com', 'doordash.com', 'ubereats.com']
  },
  people: {
    keywords: ['profile', 'portfolio', 'about', 'bio', 'founder', 'creator', 'artist', 'designer', 'developer', 'author', 'writer', 'interview', 'person', 'team', 'who', 'meet'],
    domains: ['linkedin.com', 'twitter.com', 'x.com', 'instagram.com', 'behance.net', 'dribbble.com', 'about.me']
  },
  ideas: {
    keywords: ['article', 'essay', 'blog', 'post', 'opinion', 'thought', 'idea', 'concept', 'theory', 'philosophy', 'research', 'paper', 'study', 'analysis', 'insight', 'perspective', 'guide', 'tutorial', 'learn', 'how to', 'why', 'what is'],
    domains: ['medium.com', 'substack.com', 'wikipedia.org', 'arxiv.org', 'news.ycombinator.com', 'reddit.com', 'quora.com']
  }
};

// Minimum confidence to auto-assign
const AUTO_ASSIGN_THRESHOLD = 0.6;

// Minimum items to trigger cluster detection
const CLUSTER_THRESHOLD = 3;

/**
 * Analyze content and suggest a category
 * @param {Object} link - Link object with title, description, domain
 * @param {Object} existingCategories - Map of existing categories
 * @returns {Object} - Category suggestion with confidence
 */
export function analyzeContent(link, existingCategories = {}) {
  const { title = '', description = '', domain = '', url = '' } = link;

  // Combine text for analysis
  const text = `${title} ${description} ${url}`.toLowerCase();

  const scores = {};
  let maxScore = 0;
  let bestCategory = 'uncategorized';

  // Score against known patterns
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    let score = 0;

    // Check domain matches (high weight)
    for (const patternDomain of patterns.domains) {
      if (domain.includes(patternDomain) || url.includes(patternDomain)) {
        score += 0.5;
        break;
      }
    }

    // Check keyword matches
    for (const keyword of patterns.keywords) {
      if (text.includes(keyword)) {
        score += 0.1;
      }
    }

    // Cap score at 1.0
    scores[category] = Math.min(score, 1.0);

    if (scores[category] > maxScore) {
      maxScore = scores[category];
      bestCategory = category;
    }
  }

  // Check against existing custom categories
  for (const [category, data] of Object.entries(existingCategories)) {
    if (category === 'uncategorized') continue;

    // Check if this link is similar to existing items in the category
    const similarity = calculateSimilarity(link, data.items || []);
    if (similarity > scores[category]) {
      scores[category] = similarity;
      if (similarity > maxScore) {
        maxScore = similarity;
        bestCategory = category;
      }
    }
  }

  return {
    category: maxScore >= AUTO_ASSIGN_THRESHOLD ? bestCategory : 'uncategorized',
    confidence: maxScore,
    scores,
    needsReview: maxScore < AUTO_ASSIGN_THRESHOLD && maxScore > 0.3
  };
}

/**
 * Calculate similarity between a link and existing items
 * @param {Object} newLink - New link to compare
 * @param {Array} existingItems - Array of existing items
 * @returns {number} - Similarity score 0-1
 */
function calculateSimilarity(newLink, existingItems) {
  if (!existingItems || existingItems.length === 0) return 0;

  const newWords = extractWords(newLink);
  let totalSimilarity = 0;

  for (const item of existingItems) {
    const itemWords = extractWords(item);
    const intersection = newWords.filter(w => itemWords.includes(w));
    const union = [...new Set([...newWords, ...itemWords])];
    totalSimilarity += intersection.length / union.length;
  }

  return totalSimilarity / existingItems.length;
}

/**
 * Extract significant words from a link
 * @param {Object} link - Link object
 * @returns {string[]} - Array of words
 */
function extractWords(link) {
  const text = `${link.title || ''} ${link.description || ''} ${link.domain || ''}`.toLowerCase();
  return text
    .split(/\W+/)
    .filter(w => w.length > 3)
    .filter(w => !STOP_WORDS.has(w));
}

// Common stop words to ignore
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from', 'they', 'will',
  'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like',
  'time', 'just', 'know', 'take', 'come', 'could', 'than', 'then', 'them',
  'this', 'that', 'with', 'also', 'into', 'your', 'some', 'more', 'very'
]);

/**
 * Detect clusters in uncategorized items
 * @param {Array} uncategorizedItems - Array of uncategorized links
 * @returns {Array} - Array of cluster suggestions
 */
export function detectClusters(uncategorizedItems) {
  if (!uncategorizedItems || uncategorizedItems.length < CLUSTER_THRESHOLD) {
    return [];
  }

  const clusters = [];

  // Group by domain first
  const domainGroups = {};
  for (const item of uncategorizedItems) {
    const domain = item.domain || 'unknown';
    if (!domainGroups[domain]) {
      domainGroups[domain] = [];
    }
    domainGroups[domain].push(item);
  }

  // Check for domain-based clusters
  for (const [domain, items] of Object.entries(domainGroups)) {
    if (items.length >= CLUSTER_THRESHOLD) {
      clusters.push({
        type: 'domain',
        suggestedName: suggestCategoryName(items),
        items,
        confidence: 0.8
      });
    }
  }

  // Check for keyword-based clusters
  const wordFrequency = {};
  for (const item of uncategorizedItems) {
    const words = extractWords(item);
    for (const word of words) {
      if (!wordFrequency[word]) {
        wordFrequency[word] = { count: 0, items: [] };
      }
      wordFrequency[word].count++;
      wordFrequency[word].items.push(item);
    }
  }

  // Find common themes
  const significantWords = Object.entries(wordFrequency)
    .filter(([word, data]) => data.count >= CLUSTER_THRESHOLD)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [word, data] of significantWords) {
    // Avoid duplicate clusters
    const alreadyClustered = clusters.some(c =>
      c.items.some(i => data.items.includes(i))
    );

    if (!alreadyClustered && data.items.length >= CLUSTER_THRESHOLD) {
      clusters.push({
        type: 'keyword',
        suggestedName: capitalizeFirst(word),
        items: data.items,
        confidence: 0.6
      });
    }
  }

  return clusters;
}

/**
 * Suggest a category name based on items
 * @param {Array} items - Items to analyze
 * @returns {string} - Suggested category name
 */
function suggestCategoryName(items) {
  // Try to find common domain pattern
  const domains = items.map(i => i.domain).filter(Boolean);
  if (domains.length > 0) {
    const commonDomain = domains[0].split('.')[0];
    if (commonDomain && commonDomain.length > 2) {
      return capitalizeFirst(commonDomain);
    }
  }

  // Fall back to most common significant word
  const wordCounts = {};
  for (const item of items) {
    for (const word of extractWords(item)) {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    }
  }

  const topWord = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])[0];

  return topWord ? capitalizeFirst(topWord[0]) : 'New Category';
}

/**
 * Capitalize first letter
 * @param {string} str - String to capitalize
 * @returns {string} - Capitalized string
 */
function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Check if a category should be split
 * @param {string} category - Category name
 * @param {Array} items - Items in the category
 * @returns {Object|null} - Split suggestion or null
 */
export function checkForSplit(category, items) {
  if (items.length < 15) return null;

  const clusters = detectClusters(items);
  const significantClusters = clusters.filter(c => c.items.length >= 5);

  if (significantClusters.length >= 2) {
    return {
      category,
      suggestions: significantClusters.slice(0, 3).map(c => ({
        name: c.suggestedName,
        items: c.items
      }))
    };
  }

  return null;
}

/**
 * Check if categories should be merged
 * @param {Object} categories - All categories with their items
 * @returns {Array} - Array of merge suggestions
 */
export function checkForMerge(categories) {
  const suggestions = [];
  const categoryList = Object.entries(categories)
    .filter(([name, data]) => name !== 'uncategorized' && (data.items?.length || 0) < 5);

  for (let i = 0; i < categoryList.length; i++) {
    for (let j = i + 1; j < categoryList.length; j++) {
      const [nameA, dataA] = categoryList[i];
      const [nameB, dataB] = categoryList[j];

      // Calculate similarity between categories
      const similarity = calculateCategorySimilarity(dataA.items || [], dataB.items || []);

      if (similarity > 0.4) {
        suggestions.push({
          categoryA: nameA,
          categoryB: nameB,
          similarity,
          totalItems: (dataA.items?.length || 0) + (dataB.items?.length || 0)
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Calculate similarity between two sets of items
 * @param {Array} itemsA - First set of items
 * @param {Array} itemsB - Second set of items
 * @returns {number} - Similarity score
 */
function calculateCategorySimilarity(itemsA, itemsB) {
  if (!itemsA.length || !itemsB.length) return 0;

  const wordsA = new Set(itemsA.flatMap(extractWords));
  const wordsB = new Set(itemsB.flatMap(extractWords));

  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.length / union.size;
}
