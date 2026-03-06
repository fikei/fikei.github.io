// ============================================
// Clustering — k-means++ on TF-IDF vectors
// Soft assignment: pins can appear in multiple clusters
// ============================================

import type { Pin, Cluster, GraphEdge, SourceBreakdown } from './types';
import { tokenize, buildPinDocument, computeIDF, tfidfVector, cosineSimilarity, cleanDomain } from './tfidf';

const CATEGORY_DOMAIN_MAP: Record<string, string> = {
  listen: 'music', watch: 'film', wear: 'fashion', home: 'design',
  read: 'books', eat: 'food', go: 'travel', use: 'tech', follow: 'social',
};

// Soft-assignment: if a pin's similarity to a non-primary centroid is within
// this fraction of its primary centroid similarity, assign it there too.
// 0.7 means: if primary sim = 0.8, any centroid with sim >= 0.56 also gets the pin.
const SOFT_ASSIGN_RATIO = 0.7;

interface PinVector {
  pin: Pin;
  tokens: string[];
  vector: Map<string, number>;
}

function cosineDistance(a: Map<string, number>, b: Map<string, number>): number {
  return 1 - cosineSimilarity(a, b);
}

function meanVector(vectors: Map<string, number>[]): Map<string, number> {
  if (vectors.length === 0) return new Map();
  const sum = new Map<string, number>();
  for (const vec of vectors) {
    for (const [term, weight] of vec) {
      sum.set(term, (sum.get(term) || 0) + weight);
    }
  }
  const n = vectors.length;
  const mean = new Map<string, number>();
  for (const [term, total] of sum) {
    mean.set(term, total / n);
  }
  return mean;
}

function kmeansppInit(pinVectors: PinVector[], K: number): Map<string, number>[] {
  const centroids: Map<string, number>[] = [];
  const n = pinVectors.length;

  // Pick first centroid randomly
  const firstIdx = Math.floor(Math.random() * n);
  centroids.push(new Map(pinVectors[firstIdx].vector));

  for (let c = 1; c < K; c++) {
    const distances = new Float64Array(n);
    let totalDist = 0;

    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const d = cosineDistance(pinVectors[i].vector, centroid);
        if (d < minDist) minDist = d;
      }
      distances[i] = minDist * minDist;
      totalDist += distances[i];
    }

    if (totalDist === 0) {
      centroids.push(new Map(pinVectors[Math.floor(Math.random() * n)].vector));
      continue;
    }

    let r = Math.random() * totalDist;
    for (let i = 0; i < n; i++) {
      r -= distances[i];
      if (r <= 0) {
        centroids.push(new Map(pinVectors[i].vector));
        break;
      }
    }
    if (centroids.length <= c) {
      centroids.push(new Map(pinVectors[n - 1].vector));
    }
  }

  return centroids;
}

function mode(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const v of arr) counts.set(v, (counts.get(v) || 0) + 1);
  let best = '';
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) { best = val; bestCount = count; }
  }
  return best;
}

function topTokens(centroid: Map<string, number>, n: number): string[] {
  return [...centroid.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([token]) => token);
}

/** Get top domains from a set of pins for richer cluster context */
function topDomains(members: PinVector[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const m of members) {
    const dom = cleanDomain(m.pin.domain);
    if (dom) counts.set(dom, (counts.get(dom) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([d]) => d);
}

/** Get category breakdown for mixed clusters */
function categoryBreakdown(members: PinVector[]): string {
  const counts = new Map<string, number>();
  for (const m of members) {
    const cat = m.pin.category || 'uncategorized';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${cat}(${n})`)
    .join(', ');
}

/** Collect unique tags from cluster members */
function collectTags(members: PinVector[], max: number): string[] {
  const tagCounts = new Map<string, number>();
  for (const m of members) {
    if (m.pin.tags && Array.isArray(m.pin.tags)) {
      for (const tag of m.pin.tags) {
        const t = tag.toLowerCase().trim();
        if (t.length >= 2) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }
  }
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

export function buildClusters(pins: Pin[], idPrefix = 'c', kOverride?: number, includeYoutube = true): Cluster[] {
  const activePins = includeYoutube
    ? pins
    : pins.filter(p => p.import_source !== 'youtube');

  if (activePins.length === 0) return [];
  const idf = computeIDF(activePins);

  const pinVectors: PinVector[] = activePins.map(p => {
    const doc = buildPinDocument(p);
    const tokens = tokenize(doc);
    return { pin: p, tokens, vector: tfidfVector(tokens, idf) };
  });

  const validPins = pinVectors.filter(pv => pv.vector.size > 0);
  if (validPins.length === 0) return [];

  // Target ~4 pins per cluster so categories split into sub-tastes
  const K = kOverride ?? Math.min(40, Math.max(3, Math.floor(validPins.length / 4)));
  let centroids = kmeansppInit(validPins, K);
  const assignments = new Int32Array(validPins.length);

  const MAX_ITER = 20;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;

    for (let i = 0; i < validPins.length; i++) {
      let minDist = Infinity;
      let bestCluster = 0;
      for (let c = 0; c < centroids.length; c++) {
        const d = cosineDistance(validPins[i].vector, centroids[c]);
        if (d < minDist) { minDist = d; bestCluster = c; }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }

    if (!changed) break;

    const groups: Map<string, number>[][] = Array.from({ length: centroids.length }, () => []);
    for (let i = 0; i < validPins.length; i++) {
      groups[assignments[i]].push(validPins[i].vector);
    }
    centroids = groups.map((vecs, idx) =>
      vecs.length > 0 ? meanVector(vecs) : centroids[idx]
    );
  }

  // Build cluster map from hard assignments first
  const clusterMap = new Map<number, Set<number>>(); // centroid index -> set of pin indices
  for (let i = 0; i < validPins.length; i++) {
    const c = assignments[i];
    if (!clusterMap.has(c)) clusterMap.set(c, new Set());
    clusterMap.get(c)!.add(i);
  }

  // Merge clusters with < 2 pins into nearest neighbor
  const smallClusters: number[] = [];
  const largeClusters: number[] = [];
  for (const [idx, members] of clusterMap) {
    if (members.size < 2) smallClusters.push(idx);
    else largeClusters.push(idx);
  }

  if (largeClusters.length > 0) {
    for (const smallIdx of smallClusters) {
      const smallMembers = [...clusterMap.get(smallIdx)!].map(i => validPins[i]);
      const smallCentroid = meanVector(smallMembers.map(m => m.vector));

      let bestLarge = largeClusters[0];
      let bestDist = Infinity;
      for (const largeIdx of largeClusters) {
        const largeMembers = [...clusterMap.get(largeIdx)!].map(i => validPins[i]);
        const largeCentroid = meanVector(largeMembers.map(m => m.vector));
        const d = cosineDistance(smallCentroid, largeCentroid);
        if (d < bestDist) { bestDist = d; bestLarge = largeIdx; }
      }

      for (const pinIdx of clusterMap.get(smallIdx)!) {
        clusterMap.get(bestLarge)!.add(pinIdx);
      }
      clusterMap.delete(smallIdx);
    }
  }

  // Recompute final centroids after merging
  const finalCentroids = new Map<number, Map<string, number>>();
  for (const [idx, memberIndices] of clusterMap) {
    const vecs = [...memberIndices].map(i => validPins[i].vector);
    finalCentroids.set(idx, meanVector(vecs));
  }

  // Soft assignment: assign pins to additional clusters if they're similar enough
  for (let i = 0; i < validPins.length; i++) {
    const primaryCluster = assignments[i];
    // Find which final cluster this pin ended up in (after merging)
    let primaryFinal = primaryCluster;
    if (!clusterMap.has(primaryCluster)) {
      // It was merged — find where
      for (const [idx, members] of clusterMap) {
        if (members.has(i)) { primaryFinal = idx; break; }
      }
    }

    const primaryCentroid = finalCentroids.get(primaryFinal);
    if (!primaryCentroid) continue;

    const primarySim = cosineSimilarity(validPins[i].vector, primaryCentroid);
    const threshold = primarySim * SOFT_ASSIGN_RATIO;

    for (const [clusterIdx, centroid] of finalCentroids) {
      if (clusterIdx === primaryFinal) continue;
      const sim = cosineSimilarity(validPins[i].vector, centroid);
      if (sim >= threshold && sim > 0.15) {
        clusterMap.get(clusterIdx)!.add(i);
      }
    }
  }

  // Build final Cluster objects
  const clusters: Cluster[] = [];
  let clusterIdx = 0;

  for (const [, memberIndices] of clusterMap) {
    const members = [...memberIndices].map(i => validPins[i]);
    const centroid = meanVector(members.map(m => m.vector));
    const categories = members.map(m => m.pin.category).filter(Boolean);
    const dominantCat = mode(categories) || 'uncategorized';
    const top = topTokens(centroid, 10);
    const domains = topDomains(members, 5);
    const tags = collectTags(members, 10);
    const catBreakdown = categoryBreakdown(members);

    // Combine top 2 tokens for a more evocative auto-label
    const labelParts = top.slice(0, 2).filter(Boolean);
    const label = labelParts.length > 0
      ? labelParts.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')
      : `Cluster ${clusterIdx}`;

    // Sort members by cosine similarity to centroid (descending = most representative first)
    const ranked = [...members].sort((a, b) =>
      cosineSimilarity(b.vector, centroid) - cosineSimilarity(a.vector, centroid)
    );
    const sampleTitles = ranked.slice(0, 12).map(m => m.pin.title).filter(Boolean);
    const representativeTitle = ranked[0]?.pin.title || '';

    // Deduplicate pinIds (a pin can appear via both hard and soft assignment)
    const uniquePinIds = [...new Set(members.map(m => m.pin.id))];

    // Source breakdown for YouTube toggle visualization
    const uniqueMembers = [...new Set(members.map(m => m.pin))];
    const youtubeCount = uniqueMembers.filter(p => p.import_source === 'youtube').length;
    const manualCount = uniqueMembers.length - youtubeCount;
    const sourceBreakdown: SourceBreakdown = {
      youtube: youtubeCount,
      manual: manualCount,
      total: uniqueMembers.length,
      isYoutubeOnly: youtubeCount === uniqueMembers.length && youtubeCount > 0,
      hasMixedSources: youtubeCount > 0 && manualCount > 0,
    };

    clusters.push({
      id: `${idPrefix}${clusterIdx}`,
      pinIds: uniquePinIds,
      centroidVector: centroid,
      topTokens: top,
      sampleTitles,
      representativeTitle,
      dominantCategory: dominantCat,
      pinCount: uniquePinIds.length,
      label,
      domain: CATEGORY_DOMAIN_MAP[dominantCat] || 'other',
      drillable: uniquePinIds.length >= 4,
      // Richer context for LLM labeling
      topDomains: domains,
      tags,
      categoryBreakdown: catBreakdown,
      sourceBreakdown,
    });
    clusterIdx++;
  }

  return clusters;
}

export function buildSubClusters(pins: Pin[], parentId: string, includeYoutube = true): Cluster[] {
  if (pins.length < 4) return [];
  const K = Math.min(12, Math.max(3, Math.floor(pins.length / 3)));
  return buildClusters(pins, `${parentId}-s`, K, includeYoutube);
}

export function buildEdges(clusters: Cluster[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (let i = 0; i < clusters.length; i++) {
    const similarities: { target: number; weight: number }[] = [];

    for (let j = 0; j < clusters.length; j++) {
      if (i === j) continue;
      const sim = cosineSimilarity(clusters[i].centroidVector, clusters[j].centroidVector);
      if (sim > 0.15) {
        similarities.push({ target: j, weight: sim });
      }
    }

    similarities.sort((a, b) => b.weight - a.weight);
    for (const { target, weight } of similarities.slice(0, 5)) {
      if (i < target) {
        edges.push({ source: clusters[i].id, target: clusters[target].id, weight });
      }
    }
  }

  const seen = new Set<string>();
  return edges.filter(e => {
    const key = `${e.source}-${e.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
