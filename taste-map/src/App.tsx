// ============================================
// Taste Map — Main App Shell
// Fetches pins, runs clustering, renders graph
// ============================================

import { useEffect, useState, useCallback } from 'react';
import { fetchPins, callTasteGraphFunction } from './lib/supabase';
import { buildClusters, buildEdges } from './lib/clustering';
import type { Pin, Cluster, GraphEdge, Insights, ClusterInput } from './lib/types';
import { Graph } from './components/Graph';
import { InsightStrip } from './components/InsightStrip';
import { LoadingState } from './components/LoadingState';
import { ConceptDetail } from './components/ConceptDetail';

type AppState = 'loading' | 'empty' | 'clustering' | 'labeling' | 'ready';

const CACHE_KEY_PREFIX = 'boards-taste-graph-v1-';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function clusterFingerprint(clusters: Cluster[]): string {
  const tokens = clusters
    .map(c => c.topTokens.slice(0, 4).sort().join(','))
    .sort()
    .join('|');
  // Simple hash
  let hash = 0;
  for (let i = 0; i < tokens.length; i++) {
    hash = ((hash << 5) - hash + tokens.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function loadCache(fingerprint: string) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + fingerprint);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + fingerprint);
      return null;
    }
    return cached.data as { labels: Record<string, { label: string; domain: string }>; insights: Insights };
  } catch {
    return null;
  }
}

function saveCache(fingerprint: string, data: { labels: Record<string, { label: string; domain: string }>; insights: Insights }) {
  try {
    localStorage.setItem(
      CACHE_KEY_PREFIX + fingerprint,
      JSON.stringify({ timestamp: Date.now(), data })
    );
  } catch { /* localStorage full — ignore */ }
}

export default function App() {
  const [state, setState] = useState<AppState>('loading');
  const [pins, setPins] = useState<Pin[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [insights, setInsights] = useState<Insights>({ motifs: [], bridges: [] });
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [highlightedMotif, setHighlightedMotif] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Step 1: Fetch pins
      setState('loading');
      const pinData = await fetchPins();

      if (cancelled) return;
      if (pinData.length < 10) {
        setPins(pinData);
        setState('empty');
        return;
      }

      setPins(pinData);
      setState('clustering');

      // Step 2: Cluster (runs synchronously, fast for <1000 pins)
      const rawClusters = buildClusters(pinData);
      const graphEdges = buildEdges(rawClusters);

      if (cancelled) return;
      setClusters(rawClusters);
      setEdges(graphEdges);

      // Step 3: Try LLM labels from cache or API
      const fp = clusterFingerprint(rawClusters);
      const cached = loadCache(fp);

      if (cached) {
        // Apply cached labels
        const labeled = rawClusters.map(c => ({
          ...c,
          label: cached.labels[c.id]?.label ?? c.label,
          domain: cached.labels[c.id]?.domain ?? c.domain,
        }));
        setClusters(labeled);
        setInsights(cached.insights);
        setState('ready');
        return;
      }

      // Show graph with auto-labels immediately, then upgrade
      setState('ready');

      // Background: fetch LLM labels
      try {
        const clusterInputs: ClusterInput[] = rawClusters.map(c => ({
          id: c.id,
          topTokens: c.topTokens,
          sampleTitles: c.sampleTitles,
          dominantCategory: c.dominantCategory,
          pinCount: c.pinCount,
        }));

        const result = await callTasteGraphFunction(clusterInputs);

        if (cancelled) return;

        // Apply LLM labels
        const labelMap: Record<string, { label: string; domain: string }> = {};
        for (const lc of result.clusters) {
          labelMap[lc.id] = { label: lc.label, domain: lc.domain };
        }

        const labeled = rawClusters.map(c => ({
          ...c,
          label: labelMap[c.id]?.label ?? c.label,
          domain: labelMap[c.id]?.domain ?? c.domain,
        }));

        setClusters(labeled);
        setInsights(result.insights ?? { motifs: [], bridges: [] });

        // Cache
        saveCache(fp, { labels: labelMap, insights: result.insights ?? { motifs: [], bridges: [] } });
      } catch (err) {
        console.warn('[taste-map] LLM labeling failed, using auto-labels:', err);
        // Graph is already visible with auto-labels — this is fine
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const handleSelectCluster = useCallback((id: string | null) => {
    setSelectedCluster(id);
  }, []);

  const handleHighlightMotif = useCallback((motif: string | null) => {
    setHighlightedMotif(motif);
  }, []);

  const selectedClusterData = clusters.find(c => c.id === selectedCluster);

  return (
    <div className="tg-app">
      <header className="tg-header">
        <h1 className="tg-header__title">Taste Map</h1>
        <div className="tg-header__actions">
          <a href="/boards/" className="tg-btn">Boards</a>
        </div>
      </header>

      <div className="tg-stage">
        {(state === 'loading' || state === 'clustering' || state === 'labeling') && (
          <LoadingState
            message={
              state === 'loading'
                ? 'Loading your library...'
                : state === 'clustering'
                ? 'Mapping your taste...'
                : 'Labeling clusters...'
            }
          />
        )}

        {state === 'empty' && (
          <div className="tg-empty">
            <p className="tg-empty__title">
              Add more links in Boards to see your Taste Map
            </p>
            <p className="tg-empty__title" style={{ fontSize: 'var(--font-size-xs)' }}>
              {pins.length} / 10 minimum
            </p>
            <a href="/boards/" className="tg-empty__link">
              Open Boards
            </a>
          </div>
        )}

        {state === 'ready' && (
          <Graph
            clusters={clusters}
            edges={edges}
            pins={pins}
            onSelectCluster={handleSelectCluster}
            selectedCluster={selectedCluster}
            highlightedMotif={highlightedMotif}
          />
        )}
      </div>

      {state === 'ready' && insights.motifs.length > 0 && (
        <InsightStrip
          insights={insights}
          highlightedMotif={highlightedMotif}
          onHighlightMotif={handleHighlightMotif}
        />
      )}

      {selectedClusterData && (
        <ConceptDetail
          cluster={selectedClusterData}
          pins={pins}
          totalPins={pins.length}
          relatedClusters={clusters
            .filter(c => c.id !== selectedCluster && edges.some(
              e => (e.source === selectedCluster && e.target === c.id) ||
                   (e.target === selectedCluster && e.source === c.id)
            ))
            .slice(0, 5)}
          onClose={() => setSelectedCluster(null)}
          onSelectCluster={handleSelectCluster}
        />
      )}
    </div>
  );
}
