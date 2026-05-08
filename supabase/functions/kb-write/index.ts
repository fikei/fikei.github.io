// kb-write — write a markdown file to the private fikei/job repo.
// POST { path, content, baseSha?, message? } → { path, sha }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders } from '../_shared/job-auth.ts';
import { ghWriteFile } from '../_shared/job-github.ts';

const VERSION = '0.1.0';
console.log(`[kb-write] v${VERSION} - initial`);

const PATH_RE = /^[a-zA-Z0-9_\-./]+\.md$/;
const MAX_CONTENT_BYTES = 64 * 1024;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const path = String(body.path || '').trim();
    const content = String(body.content ?? '');
    const baseSha = body.baseSha ? String(body.baseSha) : undefined;
    const message = String(body.message || `chore: edit ${path} via /job product`);

    if (!path || path.includes('..') || !PATH_RE.test(path) || path.startsWith('/')) {
      return err('invalid path; must be a relative *.md path', 400);
    }
    if (content.length > MAX_CONTENT_BYTES) {
      return err(`content exceeds ${MAX_CONTENT_BYTES} bytes`, 413);
    }

    const result = await ghWriteFile(path, content, message, baseSha);
    return jsonResp({ ok: true, ...result });
  } catch (e) {
    console.error('[kb-write] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
