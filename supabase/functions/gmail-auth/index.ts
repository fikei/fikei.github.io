// gmail-auth — Google OAuth flow for the gmail.readonly scope used by
// the jobs pipe. Mirrors calendar-api's connect/status pattern but
// writes to the shared user_google_tokens table so revoking gmail
// doesn't take down calendar (and vice-versa).
//
// POST /functions/v1/gmail-auth
//   body: { action: 'auth-url' }                         → { url }
//   body: { action: 'connect', code }                    → { connected, email }
//   body: { action: 'status' }                           → { connected, email }
//   body: { action: 'disconnect' }                       → { revoked }
//
// Uses the existing GOOGLE_CALENDAR_* secrets (same OAuth client) so we
// don't need a new client registration. The redirect URI for gmail
// connect points at /job/ — calendar-api keeps /calendar/.

const VERSION = '0.1.0';
console.log(`[gmail-auth] v${VERSION} - oauth for gmail.readonly`);

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  canonicalScopeSet,
  findTokenForScopes,
  getServiceClient,
  GMAIL_READONLY_SCOPE,
  markRevoked,
  upsertToken,
} from '../_shared/google-tokens.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GOOGLE_CLIENT_ID     = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET')!;
// Separate redirect for gmail so the JS handler on /job/ can spot the
// callback and call action:'connect'. Falls back to a sane default.
const GMAIL_REDIRECT_URI   = Deno.env.get('GMAIL_OAUTH_REDIRECT_URI') || 'https://ctrl.rodeo/job/';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getUser(req: Request): Promise<{ id: string; email: string } | null> {
  const auth = req.headers.get('authorization');
  if (!auth) return null;
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data } = await sb.auth.getUser();
  if (!data?.user?.id || !data.user.email) return null;
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return json({ error: 'action is required' }, 400);

    const user = await getUser(req);
    if (!user) return json({ error: 'unauthorized' }, 401);

    const db = getServiceClient();
    const scopeSet = canonicalScopeSet([GMAIL_READONLY_SCOPE]);

    if (action === 'auth-url') {
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GMAIL_REDIRECT_URI,
        response_type: 'code',
        scope: GMAIL_READONLY_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        // Including 'gmail' in state lets the /job/ JS distinguish this
        // callback from a calendar one if both flows ever land on the
        // same host. user_id is included so the JS doesn't have to track
        // it client-side.
        state: `gmail:${user.id}`,
        include_granted_scopes: 'true',
      });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
    }

    if (action === 'connect') {
      const code = body.code;
      if (!code) return json({ error: 'code required' }, 400);

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: GMAIL_REDIRECT_URI,
        }),
      });
      if (!tokenResp.ok) {
        const err = await tokenResp.text();
        console.error('[gmail-auth] token exchange failed:', err);
        return json({ error: 'oauth exchange failed' }, 400);
      }
      const tokens = await tokenResp.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        scope: string;
      };

      // Verify Google actually granted gmail.readonly. include_granted_scopes
      // means a previous calendar consent could come back without gmail.
      const grantedScopes = tokens.scope.split(/\s+/).filter(Boolean);
      if (!grantedScopes.includes(GMAIL_READONLY_SCOPE)) {
        return json({ error: 'gmail.readonly was not granted' }, 400);
      }

      // Resolve the Google account email so the user can confirm which
      // identity they connected.
      const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = profileResp.ok ? await profileResp.json() as { email?: string } : { email: null };

      // Refresh-token quirk: Google only re-issues a refresh_token when
      // prompt=consent forces it. We always send prompt=consent above,
      // so refresh_token should be present — but if the user already
      // had a row, fall back to the previously stored token.
      let refresh = tokens.refresh_token;
      if (!refresh) {
        const existing = await findTokenForScopes(db, user.id, [GMAIL_READONLY_SCOPE]);
        refresh = existing?.google_refresh_token;
      }
      if (!refresh) {
        return json({ error: 'no refresh_token; reconnect with prompt=consent' }, 400);
      }

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      await upsertToken(db, {
        user_id: user.id,
        scope_set: scopeSet,
        google_refresh_token: refresh,
        google_access_token: tokens.access_token,
        token_expires_at: expiresAt,
        google_email: profile.email ?? null,
        granted_for: 'gmail-jobs',
      });

      return json({ connected: true, email: profile.email ?? null });
    }

    if (action === 'status') {
      const row = await findTokenForScopes(db, user.id, [GMAIL_READONLY_SCOPE]);
      return json({
        connected: !!row,
        email: row?.google_email ?? null,
        connectedAt: row ? null : null, // updated_at not exposed; keep response minimal
      });
    }

    if (action === 'disconnect') {
      const row = await findTokenForScopes(db, user.id, [GMAIL_READONLY_SCOPE]);
      if (!row) return json({ revoked: false });
      // Best-effort revocation on Google's side. Even if this fails,
      // mark our row revoked so we stop trying to refresh it.
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(row.google_refresh_token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
      } catch (e) {
        console.warn('[gmail-auth] revoke call failed:', (e as Error).message);
      }
      await markRevoked(db, row.id);
      return json({ revoked: true });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    console.error('[gmail-auth] error', e);
    return json({ error: (e as Error).message || 'server error' }, 500);
  }
});
