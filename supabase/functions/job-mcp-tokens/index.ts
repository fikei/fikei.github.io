// Supabase Edge Function: job-mcp-tokens
// CRUD for the user's MCP personal-access tokens. Powers the /job/settings/
// "MCP tokens" section.
//
// GET    /functions/v1/job-mcp-tokens
//   → { tokens: [{ id, label, prefix, created_at, last_used_at, expires_at }] }
//   No raw token strings in this response — those are returned ONLY at
//   creation. Lost tokens require minting a new one.
//
// POST   /functions/v1/job-mcp-tokens   { label }
//   → { id, label, prefix, token, created_at }
//   `token` is the raw `mcp_…` string. Show it once, then never again.
//
// DELETE /functions/v1/job-mcp-tokens   { id }
//   → { revoked: true }
//   Sets revoked_at; verifyMcpToken rejects revoked tokens.
//
// Auth: standard /job bearer JWT (verifyJobUserDetailed). MCP tokens
// themselves cannot manage other MCP tokens — you must be signed in
// with a real session to use this endpoint.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { verifyJobUserDetailed, corsHeaders, jsonResp, err } from '../_shared/job-auth.ts';

const VERSION = '0.1.0';
console.log(`[job-mcp-tokens] v${VERSION}`);

const RAW_LEN = 32; // characters after the "mcp_" prefix

function randomToken(): string {
  const bytes = new Uint8Array(24); // 24 bytes → 32 base64url chars
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, RAW_LEN);
  return `mcp_${b64}`;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const user = await verifyJobUserDetailed(req);
  if (!user) return err('unauthorized', 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  // User-scoped client so RLS gates list/insert/update to this user.
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    db: { schema: 'job' },
  });

  if (req.method === 'GET') {
    const { data, error } = await sb
      .from('mcp_token')
      .select('id, label, prefix, created_at, last_used_at, expires_at, revoked_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) return err(error.message, 500);
    return jsonResp({ tokens: data || [] });
  }

  if (req.method === 'POST') {
    let body: { label?: string };
    try { body = await req.json(); } catch (_) { return err('invalid JSON body'); }
    const label = String(body?.label || '').trim().slice(0, 80);
    if (!label) return err('label required');

    const raw = randomToken();                       // 'mcp_xxxx…'
    const hash = await sha256Hex(raw);
    const prefix = raw.slice(4, 12);                 // 8 chars after 'mcp_'

    const { data, error } = await sb
      .from('mcp_token')
      .insert({ user_id: user.id, label, token_hash: hash, prefix })
      .select('id, label, prefix, created_at')
      .single();
    if (error) return err(error.message, 500);

    return jsonResp({ ...data, token: raw }, 201);
  }

  if (req.method === 'DELETE') {
    let body: { id?: string };
    try { body = await req.json(); } catch (_) { return err('invalid JSON body'); }
    const id = String(body?.id || '').trim();
    if (!id) return err('id required');
    const { error } = await sb
      .from('mcp_token')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return err(error.message, 500);
    return jsonResp({ revoked: true });
  }

  return err('method not allowed', 405);
});
