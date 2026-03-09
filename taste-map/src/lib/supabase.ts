// ============================================
// Taste Map — Supabase Client + Pin Fetching
// Shares auth session with Boards (same origin)
// ============================================

import { createClient } from '@supabase/supabase-js';
import type { Pin, Cluster, GraphEdge, Insights } from './types';

const SUPABASE_URL = 'https://yfhudwakpgzswiylhfbh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmaHVkd2FrcGd6c3dpeWxoZmJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE3ODYsImV4cCI6MjA4NTM4Nzc4Nn0.bemC-CPA2vkoM5P4P-tmsPQ1RPr4ifPa5iginUXPKLI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: true,
    flowType: 'implicit',
    autoRefreshToken: true,
    persistSession: true,
  },
});

/**
 * Get current authenticated user, or null if not logged in.
 */
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Sign in with Google OAuth.
 * Redirects to Google, then back to /taste-map/ with session token.
 */
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/taste-map/' },
  });
  if (error) console.error('[taste-map] Google sign-in failed:', error);
}

/**
 * Fetch all pins for the current user from Supabase.
 * Filters out loading/placeholder pins and uncategorized.
 */
export async function fetchPins(): Promise<Pin[]> {
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('links')
    .select('*')
    .eq('user_id', user.id);

  if (error) {
    console.error('[taste-map] Failed to fetch pins:', error);
    return [];
  }

  return (data ?? []).filter(
    (pin: Pin) => pin.category !== 'uncategorized' && pin.title
  );
}

// ---- Server-side taste profile cache ----

/**
 * Deterministic hash of a pin set: sort IDs, join, djb2 → base36.
 * Same pins always produce the same hash regardless of clustering randomness.
 */
export function pinSetHash(pins: Pin[]): string {
  const sorted = pins.map(p => p.id).sort().join('|');
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash + sorted.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

interface ServerCacheRow {
  clusters: unknown[];
  edges: GraphEdge[];
  insights: Insights;
}

/**
 * Load a cached taste profile from Supabase.
 * Returns null on miss or error.
 */
export async function loadServerCache(
  pinHash: string
): Promise<{ clusters: Cluster[]; edges: GraphEdge[]; insights: Insights } | null> {
  try {
    const { data, error } = await supabase
      .from('taste_profiles')
      .select('clusters, edges, insights')
      .eq('pin_hash', pinHash)
      .maybeSingle();

    if (error || !data) return null;

    const row = data as ServerCacheRow;

    // Reconstruct Cluster[] from stored JSONB
    const clusters: Cluster[] = (row.clusters as Array<Record<string, unknown>>).map((c) => ({
      ...c,
      centroidVector: new Map(),
      drillable: (c.pinCount as number) >= 4,
    })) as unknown as Cluster[];

    return {
      clusters,
      edges: row.edges,
      insights: row.insights,
    };
  } catch {
    return null;
  }
}

/**
 * Save a taste profile to Supabase (upsert by user + pin_hash).
 * Strips non-serializable centroidVector from clusters before storing.
 */
export async function saveServerCache(
  pinHash: string,
  pinCount: number,
  clusters: Cluster[],
  edges: GraphEdge[],
  insights: Insights
): Promise<void> {
  try {
    const user = await getUser();
    if (!user) return;

    // Strip centroidVector (Map, not JSON-serializable)
    const storable = clusters.map(c => {
      const { centroidVector: _cv, ...rest } = c;
      return rest;
    });

    await supabase
      .from('taste_profiles')
      .upsert(
        {
          user_id: user.id,
          pin_hash: pinHash,
          pin_count: pinCount,
          clusters: storable,
          edges,
          insights,
        },
        { onConflict: 'user_id,pin_hash' }
      );
  } catch {
    // Silent fail — cache write is non-critical
  }
}

/**
 * Call the taste-graph edge function for cluster labeling + insights.
 * Uses supabase.functions.invoke() for automatic token refresh.
 */
export async function callTasteGraphFunction(
  clusters: Array<{
    id: string;
    topTokens: string[];
    sampleTitles: string[];
    dominantCategory: string;
    pinCount: number;
  }>
) {
  const { data, error } = await supabase.functions.invoke('taste-graph', {
    body: { clusters },
  });

  if (error) {
    throw new Error(`Edge function failed: ${error.message}`);
  }

  return data;
}
