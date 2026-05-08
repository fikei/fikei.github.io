// jobs-pipe — read the Job Search sheet, enrich with Fit Score, return JSON.
// v1: GET only. Status writeback (POST) is in the next milestone.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { readSheetValues, writeSheetCell } from './sheets.ts';
import { computeFit, RoleRow } from './fit.ts';
import { ghTree } from '../_shared/job-github.ts';
import { roleSlug } from '../_shared/job-auth.ts';

const VERSION = '0.3.0';
console.log(`[jobs-pipe] v${VERSION} - asset flags`);

const SHEET_ID = '1YtZp3vxlsVP8t_eWpcYzYEVjaSKu8rVYmVRPr4AGeAU';
const ALLOWLIST = ['fike101@gmail.com'];
const STATUS_ENUM = new Set([
  '', 'New', 'Apply', 'Talking', 'Applied', 'Pass', 'Rejected', 'Closed', 'Not Listed', 'Nudge / Network',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 400) { return json({ error: message }, status); }

async function verifyAllowlistedUser(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
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

// Sheet column layout (1-based): A Status (header), B Rank, C Status,
// D Company, E Role Title, F Job Postings (URL), G Source, H Contact,
// I Salary Range, J Sector, K Investors, L Website, M Crunchbase.
function rowToRole(row: string[], rowNumber: number): { role: RoleRow; rowNumber: number } {
  return {
    rowNumber,
    role: {
      status: (row[2] || '').trim(),
      rank: (row[1] || '').trim(),
      company: (row[3] || '').trim(),
      title: (row[4] || '').trim(),
      url: (row[5] || '').trim(),
      source: (row[6] || '').trim(),
      contact: (row[7] || '').trim(),
      salary: (row[8] || '').trim(),
      sector: (row[9] || '').trim(),
      investors: (row[10] || '').trim(),
      website: (row[11] || '').trim(),
      crunchbase: (row[12] || '').trim(),
    },
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const email = await verifyAllowlistedUser(req);
    if (!email) return err('unauthorized', 401);

    if (req.method === 'GET') {
      const [values, tree] = await Promise.all([
        readSheetValues(SHEET_ID, 'Roles!A2:M1000'),
        ghTree('03-jobs/').catch(() => []),
      ]);
      // Build slug → asset-flags map.
      const assets = new Map<string, { hasResume: boolean; hasCoverLetter: boolean }>();
      for (const t of tree) {
        const m = t.path.match(/^03-jobs\/([^/]+)\/(resume|cover-letter)\.md$/);
        if (!m) continue;
        const cur = assets.get(m[1]) || { hasResume: false, hasCoverLetter: false };
        if (m[2] === 'resume') cur.hasResume = true;
        else cur.hasCoverLetter = true;
        assets.set(m[1], cur);
      }
      const enriched = values
        .map((row, idx) => rowToRole(row, idx + 2))
        .filter(({ role }) => role.company || role.title)
        .map(({ role, rowNumber }) => {
          const slug = roleSlug(role.company, role.title);
          const flags = assets.get(slug) || { hasResume: false, hasCoverLetter: false };
          return {
            rowNumber,
            slug,
            ...role,
            ...computeFit(role),
            ...flags,
          };
        });
      return json({ version: VERSION, count: enriched.length, roles: enriched });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const rowNumber = Number(body.rowNumber);
      const status = String(body.status ?? '');
      if (!Number.isInteger(rowNumber) || rowNumber < 2 || rowNumber > 5000) {
        return err('rowNumber must be int 2..5000', 400);
      }
      if (!STATUS_ENUM.has(status)) {
        return err(`status must be one of: ${Array.from(STATUS_ENUM).filter(Boolean).join(', ')}`, 400);
      }
      // Status lives in column C of the Roles tab.
      await writeSheetCell(SHEET_ID, `Roles!C${rowNumber}`, status);
      return json({ ok: true, rowNumber, status });
    }

    return err('GET or POST only', 405);
  } catch (e) {
    console.error('[jobs-pipe] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
