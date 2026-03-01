// ============================================
// Taste Map — Main App Shell
// Fetches pins, runs clustering, renders 3D graph
// Manages drill-down navigation stack
// ============================================

import { useEffect, useState, useCallback } from 'react';
import { fetchPins, callTasteGraphFunction } from './lib/supabase';
import { buildClusters, buildEdges } from './lib/clustering';
import { buildRootFrame, createDrillFrame } from './lib/drill';
import type {
  Pin, Cluster, GraphEdge, Insights, ClusterInput,
  DrillFrame, ClusterDescription,
} from './lib/types';
import { Graph } from './components/Graph';
import { InsightStrip } from './components/InsightStrip';
import { LoadingState } from './components/LoadingState';
import { ConceptDetail } from './components/ConceptDetail';
import { EdgeDetail } from './components/EdgeDetail';

type AppState = 'loading' | 'empty' | 'clustering' | 'labeling' | 'ready';

const CACHE_KEY_PREFIX = 'boards-taste-graph-v4-';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function clusterFingerprint(clusters: Cluster[]): string {
  const tokens = clusters
    .map(c => c.topTokens.slice(0, 4).sort().join(','))
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < tokens.length; i++) {
    hash = ((hash << 5) - hash + tokens.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

interface CacheData {
  labels: Record<string, { label: string; domain: string; description?: ClusterDescription }>;
  insights: Insights;
}

function loadCache(fingerprint: string): CacheData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + fingerprint);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY_PREFIX + fingerprint);
      return null;
    }
    return cached.data as CacheData;
  } catch {
    return null;
  }
}

function saveCache(fingerprint: string, data: CacheData) {
  try {
    localStorage.setItem(
      CACHE_KEY_PREFIX + fingerprint,
      JSON.stringify({ timestamp: Date.now(), data })
    );
  } catch { /* localStorage full */ }
}

export default function App() {
  const [state, setState] = useState<AppState>('loading');
  const [pins, setPins] = useState<Pin[]>([]);
  const [insights, setInsights] = useState<Insights>({ motifs: [], bridges: [] });
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [highlightedMotif, setHighlightedMotif] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [edgeScreenPos, setEdgeScreenPos] = useState<{ x: number; y: number } | null>(null);

  // Drill stack
  const [drillStack, setDrillStack] = useState<DrillFrame[]>([]);

  // Current frame is top of stack
  const currentFrame = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;
  const currentClusters = currentFrame?.clusters ?? [];
  const currentEdges = currentFrame?.edges ?? [];

  useEffect(() => {
    let cancelled = false;

    async function init() {
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

      // Cluster
      const rawClusters = buildClusters(pinData);
      const graphEdges = buildEdges(rawClusters);

      if (cancelled) return;

      // Push root frame
      const rootFrame = buildRootFrame(pinData, rawClusters, graphEdges);
      setDrillStack([rootFrame]);

      // Try cache
      const fp = clusterFingerprint(rawClusters);
      const cached = loadCache(fp);

      if (cached) {
        const labeled = rawClusters.map(c => ({
          ...c,
          label: cached.labels[c.id]?.label ?? c.label,
          domain: cached.labels[c.id]?.domain ?? c.domain,
          description: cached.labels[c.id]?.description,
        }));
        const updatedEdges = buildEdges(labeled);
        setDrillStack([buildRootFrame(pinData, labeled, updatedEdges)]);
        setInsights(cached.insights);
        setState('ready');
        return;
      }

      // Show immediately with auto-labels
      setState('ready');

      // Background: fetch LLM labels + descriptions
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

        const labelMap: Record<string, { label: string; domain: string; description?: ClusterDescription }> = {};
        for (const lc of result.clusters) {
          labelMap[lc.id] = {
            label: lc.label,
            domain: lc.domain,
            description: lc.description,
          };
        }

        const labeled = rawClusters.map(c => ({
          ...c,
          label: labelMap[c.id]?.label ?? c.label,
          domain: labelMap[c.id]?.domain ?? c.domain,
          description: labelMap[c.id]?.description,
        }));

        const updatedEdges = buildEdges(labeled);
        setDrillStack([buildRootFrame(pinData, labeled, updatedEdges)]);
        setInsights(result.insights ?? { motifs: [], bridges: [] });

        saveCache(fp, {
          labels: labelMap,
          insights: result.insights ?? { motifs: [], bridges: [] },
        });
      } catch (err) {
        console.warn('[taste-map] LLM labeling failed, using auto-labels:', err);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const handleSelectCluster = useCallback((id: string | null) => {
    setSelectedCluster(id);
    setSelectedEdge(null);
    setEdgeScreenPos(null);
  }, []);

  const handleHighlightMotif = useCallback((motif: string | null) => {
    setHighlightedMotif(motif);
  }, []);

  const handleSelectEdge = useCallback((edge: GraphEdge | null, screenPos: { x: number; y: number } | null) => {
    setSelectedEdge(edge);
    setEdgeScreenPos(screenPos);
    if (edge) setSelectedCluster(null);
  }, []);

  const handleDrillIn = useCallback((clusterId: string) => {
    const cluster = currentClusters.find(c => c.id === clusterId);
    if (!cluster || !cluster.drillable) return;

    const clusterPins = pins.filter(p => cluster.pinIds.includes(p.id));
    if (clusterPins.length < 4) return;

    const newFrame = createDrillFrame(
      drillStack.length,
      clusterId,
      cluster.label,
      clusterPins
    );

    setDrillStack(prev => [...prev, newFrame]);
    setSelectedCluster(null);
    setSelectedEdge(null);
    setEdgeScreenPos(null);
  }, [currentClusters, pins, drillStack]);

  const handleDrillTo = useCallback((depth: number) => {
    if (depth >= drillStack.length) return;
    setDrillStack(prev => prev.slice(0, depth + 1));
    setSelectedCluster(null);
    setSelectedEdge(null);
    setEdgeScreenPos(null);
  }, [drillStack]);

  const selectedClusterData = currentClusters.find(c => c.id === selectedCluster);

  // Breadcrumb data
  const breadcrumbs = drillStack.map(f => f.parentLabel);
  const showBreadcrumb = drillStack.length > 1;

  return (
    <div className="tg-app">
      <header className="tg-header">
        <h1 className="tg-header__title">Taste Map</h1>
        <div className="tg-header__actions">
          <a href="/boards/" className="tg-btn">Boards</a>
        </div>
      </header>

      {/* Breadcrumb bar */}
      {showBreadcrumb && (
        <div className="tg-breadcrumb">
          {breadcrumbs.map((label, i) => (
            <span key={i}>
              {i > 0 && <span className="tg-breadcrumb__sep"> &gt; </span>}
              <button
                className={`tg-breadcrumb__crumb ${i === breadcrumbs.length - 1 ? 'tg-breadcrumb__crumb--active' : ''}`}
                onClick={() => handleDrillTo(i)}
                disabled={i === breadcrumbs.length - 1}
              >
                {label.toUpperCase()}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Full-screen loading overlay (outside stage, like Soundscape) */}
      {(state === 'loading' || state === 'clustering' || state === 'labeling') && (
        <LoadingState
          message={
            state === 'loading'
              ? 'Loading your library'
              : state === 'clustering'
              ? 'Mapping your taste'
              : 'Labeling clusters'
          }
        />
      )}

      <div className={`tg-stage ${showBreadcrumb ? 'tg-stage--with-breadcrumb' : ''}`}>
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

        {state === 'ready' && currentClusters.length > 0 && (
          <Graph
            clusters={currentClusters}
            edges={currentEdges}
            pins={pins}
            insights={insights}
            onSelectCluster={handleSelectCluster}
            selectedCluster={selectedCluster}
            highlightedMotif={highlightedMotif}
            onDrillIn={handleDrillIn}
            onSelectEdge={handleSelectEdge}
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

      {/* Edge detail tooltip */}
      {selectedEdge && edgeScreenPos && (
        <EdgeDetail
          edge={selectedEdge}
          screenPos={edgeScreenPos}
          clusters={currentClusters}
          insights={insights}
          onClose={() => { setSelectedEdge(null); setEdgeScreenPos(null); }}
        />
      )}

      {/* Concept detail panel */}
      {selectedClusterData && (
        <ConceptDetail
          cluster={selectedClusterData}
          pins={pins}
          totalPins={pins.length}
          drillDepth={drillStack.length - 1}
          relatedClusters={currentClusters
            .filter(c => c.id !== selectedCluster && currentEdges.some(
              e => (e.source === selectedCluster && e.target === c.id) ||
                   (e.target === selectedCluster && e.source === c.id)
            ))
            .slice(0, 5)}
          onClose={() => setSelectedCluster(null)}
          onSelectCluster={handleSelectCluster}
          onDrillIn={handleDrillIn}
        />
      )}
    </div>
  );
}
