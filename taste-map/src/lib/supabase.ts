// ============================================
// Taste Map — Supabase Client + Pin Fetching
// Shares auth session with Boards (same origin)
// ============================================

import { createClient } from '@supabase/supabase-js';
import type { Pin } from './types';

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
