// ============================================
// Clustering — k-means++ on TF-IDF vectors
// ============================================

import type { Pin, Cluster, GraphEdge } from './types';
import { tokenize, buildPinDocument, computeIDF, tfidfVector, cosineSimilarity } from './tfidf';

const CATEGORY_DOMAIN_MAP: Record<string, string> = {
  listen: 'music', watch: 'film', wear: 'fashion', home: 'design',
  read: 'books', eat: 'food', go: 'travel', use: 'tech', follow: 'social',
};

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

export function buildClusters(pins: Pin[]): Cluster[] {
  const idf = computeIDF(pins);

  const pinVectors: PinVector[] = pins.map(p => {
    const doc = buildPinDocument(p);
    const tokens = tokenize(doc);
    return { pin: p, tokens, vector: tfidfVector(tokens, idf) };
  });

  const validPins = pinVectors.filter(pv => pv.vector.size > 0);
  if (validPins.length === 0) return [];

  const K = Math.min(40, Math.max(8, Math.floor(validPins.length / 8)));
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

  // Build cluster map from assignments
  const clusterMap = new Map<number, PinVector[]>();
  for (let i = 0; i < validPins.length; i++) {
    const c = assignments[i];
    if (!clusterMap.has(c)) clusterMap.set(c, []);
    clusterMap.get(c)!.push(validPins[i]);
  }

  // Merge clusters with < 2 pins into nearest neighbor
  const smallClusters: number[] = [];
  const largeClusters: number[] = [];
  for (const [idx, members] of clusterMap) {
    if (members.length < 2) smallClusters.push(idx);
    else largeClusters.push(idx);
  }

  if (largeClusters.length > 0) {
    for (const smallIdx of smallClusters) {
      const smallMembers = clusterMap.get(smallIdx)!;
      const smallCentroid = meanVector(smallMembers.map(m => m.vector));

      let bestLarge = largeClusters[0];
      let bestDist = Infinity;
      for (const largeIdx of largeClusters) {
        const largeCentroid = meanVector(clusterMap.get(largeIdx)!.map(m => m.vector));
        const d = cosineDistance(smallCentroid, largeCentroid);
        if (d < bestDist) { bestDist = d; bestLarge = largeIdx; }
      }

      clusterMap.get(bestLarge)!.push(...smallMembers);
      clusterMap.delete(smallIdx);
    }
  }

  // Build final Cluster objects
  const clusters: Cluster[] = [];
  let clusterIdx = 0;

  for (const [, members] of clusterMap) {
    const centroid = meanVector(members.map(m => m.vector));
    const categories = members.map(m => m.pin.category).filter(Boolean);
    const dominantCat = mode(categories) || 'uncategorized';
    const top = topTokens(centroid, 8);
    const label = top[0] ? top[0].charAt(0).toUpperCase() + top[0].slice(1) : `Cluster ${clusterIdx}`;

    clusters.push({
      id: `c${clusterIdx}`,
      pinIds: members.map(m => m.pin.id),
      centroidVector: centroid,
      topTokens: top,
      sampleTitles: members.slice(0, 5).map(m => m.pin.title),
      dominantCategory: dominantCat,
      pinCount: members.length,
      label,
      domain: CATEGORY_DOMAIN_MAP[dominantCat] || 'other',
    });
    clusterIdx++;
  }

  return clusters;
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
