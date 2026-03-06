// ============================================
// Taste Map — Shared Types
// ============================================

// --- Pin data (from Supabase links table) ---

export interface VideoMeta {
  title?: string;
  creator?: string;
  year?: number;
  genre?: string;
  genres?: string[];
  runtime?: string;
  rating?: string;
  type?: string;
  keywords?: string[];
  tags?: string[];
  summary?: string;
}

export interface MusicMeta {
  trackTitle?: string;
  artist?: string;
  albumTitle?: string;
  genre?: string;
  genreTags?: string[];
  contentFormat?: string;
  duration?: string;
  bpm?: number;
  label?: string;
}

export interface BookMeta {
  title?: string;
  author?: string;
  year?: number;
  genre?: string;
  format?: string;
  pages?: number;
  summary?: string;
}

export interface Pin {
  id: string;
  url: string;
  title: string;
  description: string;
  image: string | null;
  domain: string;
  category: string;
  content_type: string | null;
  tags: string[];
  created_at: string;
  video?: VideoMeta | null;
  music?: MusicMeta | null;
  book?: BookMeta | null;
  notes?: string | null;
  is_merged?: boolean;
}

// --- Clustering ---

export interface ClusterDescription {
  whatItIs: string;
  whyYou: string;
  howItChanged: string;
}

export interface Cluster {
  id: string;
  pinIds: string[];
  centroidVector: Map<string, number>;
  topTokens: string[];
  sampleTitles: string[];
  representativeTitle: string;
  dominantCategory: string;
  pinCount: number;
  label: string;
  domain: string;
  description?: ClusterDescription;
  drillable: boolean;
  // Richer context (for LLM labeling)
  topDomains?: string[];
  tags?: string[];
  categoryBreakdown?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

// --- Force simulation ---

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  cluster: Cluster;
}

// --- Insights (from LLM) ---

export interface Bridge {
  clusterA: string;
  clusterB: string;
  reason: string;
}

export interface Insights {
  motifs: string[];
  bridges: Bridge[];
  fastestGrowing?: string;
  mostDistinctive?: string;
}

// --- API payloads ---

export interface ClusterInput {
  id: string;
  topTokens: string[];
  sampleTitles: string[];
  representativeTitle: string;
  dominantCategory: string;
  pinCount: number;
  // Richer context for LLM
  topDomains?: string[];
  tags?: string[];
  categoryBreakdown?: string;
}

export interface LabeledCluster {
  id: string;
  label: string;
  domain: string;
  description?: ClusterDescription;
}

// --- Drill-down ---

export interface DrillFrame {
  depth: number;
  parentClusterId: string | null;
  parentLabel: string;
  pinIds: string[];
  clusters: Cluster[];
  edges: GraphEdge[];
  focusNodeId?: string;
}

export interface TasteGraphResponse {
  clusters: LabeledCluster[];
  insights: Insights;
  cached: boolean;
}
