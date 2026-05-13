// Shared auth check for /job product Edge Functions.
//
// Multi-user since Phase 1 of the onboarding flow: any signed-in user with a
// public.user_profile row is authorized. The legacy single-tenant email
// allowlist is gone — see migrations/070_user_profile.sql and
// docs/strategy/prods/job-onboarding-flow.md.
//
// Returns the user's email when authorized so existing call sites that pass
// it along to the per-user KB path (fikei/job/...) keep working. Edge
// functions that need the user UUID can call verifyJobUserDetailed().
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';

export interface JobUser {
  id: string;
  email: string;
}

export async function verifyJobUserDetailed(req: Request): Promise<JobUser | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id || !data?.user?.email) return null;
  // Authorization gate: user must have a user_profile row. RLS scopes the
  // query to auth.uid(), so a row coming back proves both existence and
  // ownership without us having to filter by id.
  const { data: profile, error: profileError } = await supabase
    .from('user_profile')
    .select('user_id')
    .maybeSingle();
  if (profileError) return null;
  if (!profile) return null;
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

// Returns the user's email when authenticated via a Supabase JWT, OR a
// non-empty marker string ("mcp:<userid>") when authenticated via an
// mcp_* personal-access token. Callers use this string only for a
// truthiness gate today; data-routing key off user_id, not email.
export async function verifyJobUser(req: Request): Promise<string | null> {
  const u = await verifyJobUserAny(req);
  if (!u) return null;
  return u.email || `mcp:${u.id}`;
}

// Lighter auth check: returns the user when a valid signed-in session is
// present, without requiring a user_profile row. Used by onboard.finalize
// since that's the moment the row is created. Returns null for anon (anon
// key only, no user session) callers.
export async function verifySignedInUser(req: Request): Promise<JobUser | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id || !data?.user?.email) return null;
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

// ── MCP personal-access tokens ─────────────────────────────────────────
// Format: "mcp_" + 32 base64url chars. The server stores sha256(raw)
// in job.mcp_token.token_hash. Used as a long-lived alternative to
// Supabase JWTs for MCP clients (Claude Desktop, Cursor, …).

const MCP_TOKEN_RE = /^mcp_[A-Za-z0-9_-]{32,64}$/;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Verify an `mcp_…` bearer. Returns the user_id + token row id on
// success, null otherwise. Bumps last_used_at as a side effect.
export async function verifyMcpToken(raw: string): Promise<{ user_id: string; token_id: string } | null> {
  if (!MCP_TOKEN_RE.test(raw)) return null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) return null;
  const hash = await sha256Hex(raw);
  // Function lives in the `job` schema, not public.
  const supabase = createClient(supabaseUrl, supabaseAnonKey, { db: { schema: 'job' } });
  const { data, error } = await supabase.rpc('mcp_token_verify', { p_hash: hash });
  if (error || !data || !data.length) return null;
  const row = (data as Array<{ user_id: string; token_id: string }>)[0];
  // Bump last_used_at, fire-and-forget.
  supabase.rpc('mcp_token_bump_used', { p_id: row.token_id }).then(() => {}, () => {});
  return row;
}

// Accept EITHER a Supabase JWT or an mcp_* token. Used by the MCP
// endpoints so a single client config can authenticate.
export async function verifyJobUserAny(req: Request): Promise<JobUser | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  if (token.startsWith('mcp_')) {
    const mcp = await verifyMcpToken(token);
    if (!mcp) return null;
    // user_profile has no email column today; MCP-token callers don't
    // need email (the tools use userId). Returning empty string keeps
    // the JobUser shape stable.
    return { id: mcp.user_id, email: '' };
  }
  return verifyJobUserDetailed(req);
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function err(message: string, status = 400) { return jsonResp({ error: message }, status); }

export function slugify(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function roleSlug(company: string, title: string): string {
  const c = slugify(company);
  const t = slugify(title).split('-').filter(Boolean).slice(0, 3).join('-');
  return [c, t].filter(Boolean).join('-');
}
