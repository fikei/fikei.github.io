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

export async function verifyJobUser(req: Request): Promise<string | null> {
  const u = await verifyJobUserDetailed(req);
  return u?.email ?? null;
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
