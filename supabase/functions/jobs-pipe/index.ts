// jobs-pipe — read the Job Search sheet, enrich with Fit Score, return JSON.
// v1: GET only. Status writeback (POST) is in the next milestone.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { readSheetValues } from './sheets.ts';
import { computeFit, RoleRow } from './fit.ts';

const VERSION = '0.1.0';
console.log(`[jobs-pipe] v${VERSION} - sheet read + fit score`);

const SHEET_ID = '1YtZp3vxlsVP8t_eWpcYzYEVjaSKu8rVYmVRPr4AGeAU';
const ALLOWLIST = ['fike101@gmail.com'];

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
  if (req.method !== 'GET') return err('GET only', 405);

  try {
    const email = await verifyAllowlistedUser(req);
    if (!email) return err('unauthorized', 401);

    const values = await readSheetValues(SHEET_ID, 'Roles!A2:M1000');
    const enriched = values
      .map((row, idx) => rowToRole(row, idx + 2))
      .filter(({ role }) => role.company || role.title)
      .map(({ role, rowNumber }) => ({
        rowNumber,
        ...role,
        ...computeFit(role),
      }));

    return json({
      version: VERSION,
      count: enriched.length,
      roles: enriched,
    });
  } catch (e) {
    console.error('[jobs-pipe] error', e);
    return err((e as Error).message || 'server error', 500);
  }
});
