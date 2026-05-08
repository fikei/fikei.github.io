// gen-asset — generate a resume or cover letter for a pipeline role using
// Ian's career KB + Anthropic Claude, then commit the result to fikei/job.
//
// POST { rowNumber: int, kind: 'resume' | 'cover-letter' }
//   → { slug, path, sha, content }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUser, jsonResp, err, corsHeaders, roleSlug } from '../_shared/job-auth.ts';
import { ghReadFile, ghTree, ghWriteFile } from '../_shared/job-github.ts';
import { readSheetValues } from '../jobs-pipe/sheets.ts';
import { buildSystemPrompt, buildUserMessage } from './prompts.ts';

const VERSION = '0.1.0';
console.log(`[gen-asset] v${VERSION} - initial`);

const SHEET_ID = '1YtZp3vxlsVP8t_eWpcYzYEVjaSKu8rVYmVRPr4AGeAU';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const KB_DIRS = ['01-job-history/', '02-goals-intents/'];

interface SheetRole {
  rowNumber: number;
  company: string;
  title: string;
  url: string;
  sector: string;
  salary: string;
}

async function fetchRole(rowNumber: number): Promise<SheetRole | null> {
  const values = await readSheetValues(SHEET_ID, `Roles!A${rowNumber}:M${rowNumber}`);
  const row = values[0];
  if (!row) return null;
  return {
    rowNumber,
    company: (row[3] || '').trim(),
    title: (row[4] || '').trim(),
    url: (row[5] || '').trim(),
    salary: (row[8] || '').trim(),
    sector: (row[9] || '').trim(),
  };
}

async function loadKb(): Promise<string> {
  const tree = await ghTree();
  const files = tree.filter(t => /\.md$/.test(t.path) && KB_DIRS.some(d => t.path.startsWith(d)));
  // Cap to a reasonable size — total KB shouldn't blow past 200KB.
  const fetched = await Promise.all(files.map(async f => {
    try {
      const r = await ghReadFile(f.path);
      return r ? `## ${f.path}\n\n${r.content}` : null;
    } catch { return null; }
  }));
  return fetched.filter(Boolean).join('\n\n---\n\n');
}

async function callClaude(system: string, user: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = (data.content || [])
    .filter(c => c.type === 'text')
    .map(c => c.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('empty model output');
  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return err('POST only', 405);

  try {
    const email = await verifyJobUser(req);
    if (!email) return err('unauthorized', 401);

    const body = await req.json().catch(() => ({}));
    const rowNumber = Number(body.rowNumber);
    const kind = body.kind === 'cover-letter' ? 'cover-letter' : (body.kind === 'resume' ? 'resume' : null);
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > 5000) return err('rowNumber must be int 2..5000', 400);
    if (!kind) return err('kind must be "resume" or "cover-letter"', 400);

    const role = await fetchRole(rowNumber);
    if (!role || !role.company) return err('role not found at that row', 404);

    const slug = roleSlug(role.company, role.title);
    if (!slug) return err('could not derive slug for role', 400);

    const [kb] = await Promise.all([loadKb()]);
    const system = buildSystemPrompt(kind);
    const user = buildUserMessage(kind, kb, role);

    const content = await callClaude(system, user);

    const path = `03-jobs/${slug}/${kind}.md`;
    const written = await ghWriteFile(
      path,
      content,
      `chore: generate ${kind} for ${role.company} ${role.title} via /job`,
    );

    return jsonResp({ ok: true, slug, path: written.path, sha: written.sha, content });
  } catch (e) {
    console.error('[gen-asset] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
