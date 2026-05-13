// Shared Google OAuth token store for any function that needs Google
// API access (calendar-api, gmail-auth, gmail-scan, …).
//
// Keyed by (user_id, scope_set). When the user re-consents to add a
// new scope (e.g. gmail.readonly on top of calendar.events), we write
// a separate row so revoking one scope doesn't take down the other.
//
// Two halves:
//   - DB I/O: read / write rows in public.user_google_tokens.
//   - Refresh: exchange the refresh_token for a fresh access_token
//     and persist the new expiry.
//
// Functions consuming this should call `getAccessToken(user, scope)`
// to get a valid bearer; the helper handles refresh transparently.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface UserGoogleToken {
  id: string;
  user_id: string;
  scope_set: string;
  google_refresh_token: string;
  google_access_token: string | null;
  token_expires_at: string | null;
  google_email: string | null;
  granted_for: string | null;
  revoked_at: string | null;
}

// Canonical form for a scope set. Sorting + lowercase makes lookups
// deterministic regardless of the order Google returns scopes in.
export function canonicalScopeSet(scopes: string[]): string {
  return [...new Set(scopes.map(s => s.trim()).filter(Boolean))]
    .sort()
    .join(',');
}

// Returns true if `tokenScopes` covers every scope in `required`. Used
// to decide whether an existing row is sufficient or we need re-consent.
export function scopeSetCovers(tokenScopes: string, required: string[]): boolean {
  const have = new Set(tokenScopes.split(','));
  return required.every(s => have.has(s));
}

export function getServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// Find the active (non-revoked) token row whose scope_set covers every
// required scope. Returns null if the user hasn't consented yet.
export async function findTokenForScopes(
  db: SupabaseClient,
  userId: string,
  required: string[],
): Promise<UserGoogleToken | null> {
  const { data, error } = await db
    .from('user_google_tokens')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (error || !data) return null;
  for (const row of data as UserGoogleToken[]) {
    if (scopeSetCovers(row.scope_set, required)) return row;
  }
  return null;
}

// Upsert a token row. Caller passes the canonical scope_set.
export async function upsertToken(
  db: SupabaseClient,
  row: {
    user_id: string;
    scope_set: string;
    google_refresh_token: string;
    google_access_token: string;
    token_expires_at: string;
    google_email?: string | null;
    granted_for?: string | null;
  },
): Promise<void> {
  const { error } = await db.from('user_google_tokens').upsert({
    ...row,
    revoked_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,scope_set' });
  if (error) throw new Error(`upsertToken: ${error.message}`);
}

// Mark a row revoked. Called when Google returns invalid_grant on
// refresh — that means the user revoked consent on Google's side.
export async function markRevoked(
  db: SupabaseClient,
  tokenId: string,
): Promise<void> {
  await db.from('user_google_tokens')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', tokenId);
}

// Refresh the access token if it's expired or close to expiry. Returns
// a valid access token string or throws.
export async function getAccessToken(
  db: SupabaseClient,
  userId: string,
  required: string[],
): Promise<{ accessToken: string; tokenRow: UserGoogleToken } | null> {
  const row = await findTokenForScopes(db, userId, required);
  if (!row) return null;

  // Still valid (with 5 min buffer)?
  if (row.google_access_token && row.token_expires_at) {
    const expires = new Date(row.token_expires_at).getTime();
    if (expires > Date.now() + 5 * 60 * 1000) {
      return { accessToken: row.google_access_token, tokenRow: row };
    }
  }

  const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!;
  const clientSecret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!;
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    // invalid_grant = user revoked consent on Google's side. Mark the
    // row revoked so subsequent calls don't keep retrying a dead token.
    if (text.includes('invalid_grant')) {
      await markRevoked(db, row.id);
    }
    throw new Error(`token refresh failed: ${resp.status} ${text.slice(0, 200)}`);
  }

  const data = await resp.json() as { access_token: string; expires_in: number };
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await db.from('user_google_tokens')
    .update({
      google_access_token: data.access_token,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  return {
    accessToken: data.access_token,
    tokenRow: { ...row, google_access_token: data.access_token, token_expires_at: expiresAt },
  };
}

// Look up a user_id by job-product email. The job product authenticates
// users by email (job-auth.ts → ALLOWLIST), but Google tokens are keyed
// by auth.users.id. Uses the admin API since RLS prevents direct
// auth.users selects from a service-role client through the REST layer.
export async function userIdForEmail(
  db: SupabaseClient,
  email: string,
): Promise<string | null> {
  const adminClient = db as unknown as { auth: { admin: { listUsers: (args: { perPage: number }) => Promise<{ data: { users: Array<{ id: string; email: string | null }> } }> } } };
  try {
    const res = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const user = res.data.users.find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    return user?.id ?? null;
  } catch (e) {
    console.warn(`[google-tokens] userIdForEmail(${email}) failed: ${(e as Error).message}`);
    return null;
  }
}

// Standard Gmail scope. Exported so every call site uses the same string.
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
// gmail.modify is a strict superset of gmail.readonly. Required to apply
// labels (users.messages.modify / users.messages.batchModify). Added so
// the pipeline can stamp a "Ladder" label on every email it sources from.
export const GMAIL_MODIFY_SCOPE   = 'https://www.googleapis.com/auth/gmail.modify';
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
export const CALENDAR_EVENTS_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
