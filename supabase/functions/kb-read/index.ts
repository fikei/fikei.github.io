// kb-read — read markdown files (and directory listings) from the private
// fikei/job repo on behalf of an allowlisted user.
//
// Modes:
//   GET ?path=foo/bar.md  → { content, sha, path }
//   GET ?path=foo/        → { entries: [{ name, path, type, size }] }
//
// Auth: Authorization: Bearer <Supabase JWT>; user email must be in ALLOWLIST.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';

const VERSION = '0.1.0';
console.log(`[kb-read] v${VERSION} - initial`);

const REPO = 'fikei/job';
const REF = 'main';
const ALLOWLIST = ['fike101@gmail.com'];

const PATH_RE = /^[a-zA-Z0-9_\-./]+$/;
const FILE_PATH_RE = /^[a-zA-Z0-9_\-./]+\.md$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

async function verifyAllowlistedUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.email) return null;
  const email = data.user.email.toLowerCase();
  if (!ALLOWLIST.includes(email)) return null;
  return email;
}

function isPathSafe(p: string): boolean {
  if (!p || p.length > 256) return false;
  if (p.includes('..')) return false;
  if (p.startsWith('/')) return false;
  return PATH_RE.test(p);
}

async function ghContents(path: string) {
  const pat = Deno.env.get('GITHUB_PAT');
  if (!pat) throw new Error('GITHUB_PAT not configured');
  const url = `https://api.github.com/repos/${REPO}/contents/${path}?ref=${REF}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ctrl-rodeo-kb-read',
    },
  });
  if (res.status === 404) return { notFound: true } as const;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  return { data: await res.json() } as const;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return err('GET only', 405);

  try {
    const email = await verifyAllowlistedUser(req);
    if (!email) return err('unauthorized', 401);

    const url = new URL(req.url);
    const path = (url.searchParams.get('path') || '').trim();
    if (!isPathSafe(path)) return err('invalid path', 400);

    const isDir = path.endsWith('/');
    const ghPath = isDir ? path.replace(/\/$/, '') : path;

    if (!isDir && !FILE_PATH_RE.test(path)) {
      return err('files must end in .md', 400);
    }

    const result = await ghContents(ghPath);
    if ('notFound' in result) return err('not found', 404);
    const data = result.data;

    if (isDir) {
      if (!Array.isArray(data)) return err('expected directory', 400);
      const entries = data.map((e: { name: string; path: string; type: string; size: number }) => ({
        name: e.name,
        path: e.path,
        type: e.type, // 'file' | 'dir'
        size: e.size,
      }));
      return json({ path, entries });
    } else {
      if (Array.isArray(data) || data.type !== 'file') return err('expected file', 400);
      const content = data.encoding === 'base64' ? atob(data.content.replace(/\n/g, '')) : data.content;
      return json({ path: data.path, sha: data.sha, content });
    }
  } catch (e) {
    console.error('[kb-read] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
