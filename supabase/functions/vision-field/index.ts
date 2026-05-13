// Supabase Edge Function: vision-field
// Read + write the user's job.vision_field rows. The /job/vision UI talks
// here instead of kb-read/kb-write, so vision data lives in Postgres rather
// than the fikei/job KB.
//
// GET  /functions/v1/vision-field
//   → { fields: { [name]: { value, kind, display_name, description,
//                           examples, updated_at, source, source_detail } } }
//
// POST /functions/v1/vision-field
//   Body: { updates: [{ name, value }, ...] }
//   → { updated: [{ name, updated_at, source }], errors: [...] }
//
// Validation: each update's `value` shape must match the field's `kind`.
// Writes are 'source: user' (this is the UI editor). Agent-driven writes
// continue to flow through ask-job-agent's update_preferences tool.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, corsHeaders, jsonResp, err } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.1.0';
console.log(`[vision-field] v${VERSION}`);

interface FieldRow {
  name: string;
  value: unknown;
  kind: string;
  display_name: string | null;
  description: string | null;
  examples: unknown;
  updated_at: string;
  created_at: string;
  source: string;
  source_detail: unknown;
}

function validateValue(kind: string, value: unknown): { ok: true } | { ok: false; reason: string } {
  switch (kind) {
    case 'string_array':
      if (!Array.isArray(value)) return { ok: false, reason: 'expected array' };
      if (!value.every((v) => typeof v === 'string')) return { ok: false, reason: 'expected array of strings' };
      return { ok: true };
    case 'text_md':
      if (value !== null && typeof value !== 'string') return { ok: false, reason: 'expected string or null' };
      return { ok: true };
    case 'number':
      if (value !== null && typeof value !== 'number') return { ok: false, reason: 'expected number or null' };
      return { ok: true };
    case 'bool':
      if (typeof value !== 'boolean') return { ok: false, reason: 'expected boolean' };
      return { ok: true };
    case 'json':
      // Anything jsonb-serializable. Null and primitives also count.
      return { ok: true };
    default:
      return { ok: false, reason: `unknown kind: ${kind}` };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const user = await verifyJobUserDetailed(req);
  if (!user) return err('unauthorized', 401);
  const sql = db();

  // ── GET: return all fields for this user ────────────────────────────
  if (req.method === 'GET') {
    const rows = await sql<FieldRow[]>`
      select name, value, kind, display_name, description, examples,
             updated_at, created_at, source, source_detail
        from job.vision_field
       where user_id = ${user.id}
       order by name
    `;
    const fields: Record<string, FieldRow> = {};
    for (const r of rows) fields[r.name] = r;
    return jsonResp({ fields });
  }

  // ── POST: partial diff update ───────────────────────────────────────
  if (req.method === 'POST') {
    let body: { updates?: Array<{ name?: string; value?: unknown }> };
    try { body = await req.json(); } catch (_) { return err('invalid JSON body'); }
    const updates = Array.isArray(body?.updates) ? body.updates : [];
    if (updates.length === 0) return err('updates array required');
    if (updates.length > 50) return err('too many updates (max 50)');

    // Look up known fields for this user so we can validate against kind.
    const known = await sql<{ name: string; kind: string }[]>`
      select name, kind from job.vision_field where user_id = ${user.id}
    `;
    const kindByName = new Map(known.map((r) => [r.name, r.kind]));

    const successes: Array<{ name: string; updated_at: string; source: string }> = [];
    const errors: Array<{ name: string; reason: string }> = [];

    for (const u of updates) {
      const name = String(u?.name ?? '').trim();
      if (!name) { errors.push({ name: '', reason: 'name required' }); continue; }
      const kind = kindByName.get(name);
      if (!kind) {
        errors.push({ name, reason: 'unknown field — only existing fields are editable via this endpoint' });
        continue;
      }
      const v = u.value;
      const check = validateValue(kind, v);
      if (!check.ok) { errors.push({ name, reason: check.reason }); continue; }

      try {
        const [updated] = await sql<{ updated_at: string }[]>`
          update job.vision_field
             set value = ${JSON.stringify(v)}::jsonb,
                 source = 'user',
                 source_detail = null
           where user_id = ${user.id} and name = ${name}
           returning updated_at
        `;
        if (updated) successes.push({ name, updated_at: updated.updated_at, source: 'user' });
        else errors.push({ name, reason: 'row not found' });
      } catch (e) {
        errors.push({ name, reason: String((e as Error).message || e).slice(0, 200) });
      }
    }

    return jsonResp({ updated: successes, errors });
  }

  return err('method not allowed', 405);
});
