// Shared tool registry for /job. Single source of truth for:
//   - the Anthropic-format tool schemas (TOOL_SCHEMAS)
//   - the handlers that actually execute them (TOOL_HANDLERS)
//   - the typed input/output of each tool
//
// Both the live chat agent (ask-job-agent) and the headless API
// (job-tools) import from here. Future MCP server adapters can too.
//
// Each handler receives a ToolContext with the resolved user id, the
// auth header (for inner fetches to other /job endpoints), and a shared
// SQL connection.

import { db } from './job-db.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PIPE_URL     = `${SUPABASE_URL}/functions/v1/jobs-pipe`;
const ADD_ROLE_URL = `${SUPABASE_URL}/functions/v1/add-role`;

export interface ToolContext {
  userId: string;
  authHeader: string;   // 'Bearer <token>'
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ToolHandler = (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

// ── Helpers ─────────────────────────────────────────────────────────────

async function authedFetch(url: string, opts: RequestInit, ctx: ToolContext): Promise<Response> {
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: ctx.authHeader } });
}

// ── Tools ───────────────────────────────────────────────────────────────

async function toolReadPreferences(_input: Record<string, unknown>, ctx: ToolContext) {
  const sql = db();
  const wanted = ['blocked_titles', 'must_have_keywords', 'target_titles', 'target_geographies'];
  const rows = await sql<{ name: string; value: unknown; updated_at: string; source: string }[]>`
    select name, value, updated_at, source
      from job.vision_field
     where user_id = ${ctx.userId}
       and name = any(${wanted}::text[])
  `;
  const byName = new Map(rows.map((r) => [r.name, r]));
  const get = (n: string) => {
    const r = byName.get(n);
    if (!r) return { value: [], updated_at: null, source: null };
    const v = Array.isArray(r.value) ? (r.value as string[]) : [];
    return { value: v, updated_at: r.updated_at, source: r.source };
  };
  return {
    blocked_titles:     get('blocked_titles'),
    must_have_keywords: get('must_have_keywords'),
    target_titles:      get('target_titles'),
    target_geographies: get('target_geographies'),
  };
}

async function toolSearchPipeline(input: Record<string, unknown>, ctx: ToolContext) {
  const query = String(input.query || '');
  const res = await authedFetch(PIPE_URL, {}, ctx);
  if (!res.ok) throw new Error(`jobs-pipe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const roles: Array<Record<string, unknown>> = data.roles || [];
  const q = query.toLowerCase().trim();
  const filtered = q
    ? roles.filter((r) => [r.title, r.company, r.sector, r.notes, r.slug]
        .some((f) => (String(f || '')).toLowerCase().includes(q)))
    : roles;
  return {
    count: filtered.length,
    roles: filtered.slice(0, 20).map((r) => ({
      slug: r.slug, title: r.title, company: r.company, status: r.status,
      stage: r.stage, fit_score: r.fit_score, url: r.url,
    })),
  };
}

async function toolUpdatePipelineRow(input: Record<string, unknown>, ctx: ToolContext) {
  const patch: Record<string, unknown> = { slug: input.slug };
  for (const k of ['status', 'stage', 'exit_reason']) if (input[k] != null) patch[k] = input[k];
  const res = await authedFetch(PIPE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }, ctx);
  if (!res.ok) throw new Error(`update-role ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

async function toolAddRoleFromUrl(input: Record<string, unknown>, ctx: ToolContext) {
  const url = String(input.url || '');
  if (!url) throw new Error('url required');
  const res = await authedFetch(ADD_ROLE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  }, ctx);
  if (!res.ok) throw new Error(`add-role ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

async function toolUpdatePreferences(input: Record<string, unknown>, ctx: ToolContext) {
  const normalize = (arr: unknown): string[] => (Array.isArray(arr) ? arr : [])
    .map((s) => String(s).toLowerCase().trim()).filter(Boolean);
  const newBlocked  = normalize(input.blocked);
  const newMustHave = normalize(input.must_have);
  if (newBlocked.length === 0 && newMustHave.length === 0) {
    return { ok: false, error: 'specify at least one blocked or must_have term' };
  }

  const sql = db();
  const cur = await sql<{ name: string; value: unknown }[]>`
    select name, value from job.vision_field
     where user_id = ${ctx.userId} and name in ('blocked_titles', 'must_have_keywords')
  `;
  const curMap = new Map(cur.map((r) => [r.name, Array.isArray(r.value) ? (r.value as string[]) : []]));
  const curBlocked  = new Set((curMap.get('blocked_titles')      || []).map((s) => s.toLowerCase()));
  const curMustHave = new Set((curMap.get('must_have_keywords')  || []).map((s) => s.toLowerCase()));

  const addedBlocked    = newBlocked.filter((t) => !curBlocked.has(t));
  const skippedBlocked  = newBlocked.filter((t) =>  curBlocked.has(t));
  const addedMustHave   = newMustHave.filter((t) => !curMustHave.has(t));
  const skippedMustHave = newMustHave.filter((t) =>  curMustHave.has(t));

  if (addedBlocked.length === 0 && addedMustHave.length === 0) {
    return {
      ok: true, no_op: true,
      skipped_blocked: skippedBlocked, skipped_must_have: skippedMustHave,
      total_blocked: curBlocked.size, total_must_have: curMustHave.size,
    };
  }

  const nextBlocked  = Array.from(new Set([...curBlocked,  ...addedBlocked]));
  const nextMustHave = Array.from(new Set([...curMustHave, ...addedMustHave]));
  const note = input.note;
  const sourceDetail = note ? { note } : null;

  if (addedBlocked.length) {
    await sql`
      insert into job.vision_field (user_id, name, value, kind, source, source_detail)
      values (${ctx.userId}, 'blocked_titles', ${JSON.stringify(nextBlocked)}::jsonb, 'string_array', 'agent', ${sourceDetail})
      on conflict (user_id, name) do update set
        value = excluded.value,
        source = excluded.source,
        source_detail = excluded.source_detail,
        updated_at = now()
    `;
  }
  if (addedMustHave.length) {
    await sql`
      insert into job.vision_field (user_id, name, value, kind, source, source_detail)
      values (${ctx.userId}, 'must_have_keywords', ${JSON.stringify(nextMustHave)}::jsonb, 'string_array', 'agent', ${sourceDetail})
      on conflict (user_id, name) do update set
        value = excluded.value,
        source = excluded.source,
        source_detail = excluded.source_detail,
        updated_at = now()
    `;
  }

  return {
    ok: true,
    added_blocked: addedBlocked,
    added_must_have: addedMustHave,
    skipped_blocked: skippedBlocked,
    skipped_must_have: skippedMustHave,
    total_blocked: nextBlocked.length,
    total_must_have: nextMustHave.length,
  };
}

// ── Registry ────────────────────────────────────────────────────────────

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'read_preferences',
    description: "Read the user's current search preferences from job.vision_field. Each returned field is { value, updated_at, source } — use BEFORE update_preferences to dedupe and to tell the user WHEN something was last touched and WHO touched it.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_pipeline',
    description: "Search the user's saved + active job pipeline. Returns up to 20 matching rows with slug, title, company, status, stage, fit_score, url.",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Free-text query: company name, role title, keyword. Empty returns the most recent rows.' } }, required: ['query'] },
  },
  {
    name: 'update_pipeline_row',
    description: 'Update a single pipeline row by slug. Stages: Drafting|Applied|Interviewing|Offer. Status: Active|Archive. Find slug via search_pipeline first.',
    input_schema: {
      type: 'object',
      properties: {
        slug:        { type: 'string' },
        status:      { type: 'string', enum: ['Active', 'Archive'] },
        stage:       { type: 'string', enum: ['Drafting', 'Applied', 'Interviewing', 'Offer'] },
        exit_reason: { type: 'string' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'add_role_from_url',
    description: 'Save a job posting URL into the pipeline. The server scrapes + extracts company/title.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'update_preferences',
    description: 'Record search-direction signals into job.vision_field (blocked_titles + must_have_keywords). Server dedupes against current values. Always call read_preferences first.',
    input_schema: {
      type: 'object',
      properties: {
        blocked:   { type: 'array', items: { type: 'string' }, description: 'Categories/keywords to block. Expand vague asks (e.g. "developer jobs" → 8–12 concrete title phrases).' },
        must_have: { type: 'array', items: { type: 'string' }, description: 'Categories/keywords to require.' },
        note:      { type: 'string' },
      },
    },
  },
];

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  read_preferences:    toolReadPreferences,
  search_pipeline:     toolSearchPipeline,
  update_pipeline_row: toolUpdatePipelineRow,
  add_role_from_url:   toolAddRoleFromUrl,
  update_preferences:  toolUpdatePreferences,
};

export async function invokeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return { error: `unknown tool: ${name}` };
  try {
    return await handler(input || {}, ctx);
  } catch (err) {
    return { error: String((err as Error).message || err) };
  }
}
