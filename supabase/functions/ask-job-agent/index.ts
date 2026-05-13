// Supabase Edge Function: ask-job-agent
// P1.1: agent loop with intent-expansion + read-before-write. Sonnet 4.6
// coordinator. Five tools, all backed by existing /job endpoints or
// job.vision Postgres rows.
//
// POST /functions/v1/ask-job-agent
// Body: { message: string }
// Returns: { events: ChatEvent[] }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { verifyJobUserDetailed, corsHeaders } from '../_shared/job-auth.ts';
import { db } from '../_shared/job-db.ts';

const VERSION = '0.4.0';
console.log(`[ask-job-agent] v${VERSION} - P1.1 read-before-write, vision-backed preferences`);

const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 20;
const MAX_OUTPUT_TOKENS = 1500;
const MAX_ITERATIONS = 6;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PIPE_URL     = `${SUPABASE_URL}/functions/v1/jobs-pipe`;
const ADD_ROLE_URL = `${SUPABASE_URL}/functions/v1/add-role`;

const SYSTEM_PROMPT = `You are the agent for /job, Ian Fike's career knowledge base at ctrl.rodeo/job. Ian uses /job to track every role he's interested in, his career history, and his search preferences.

Speak with Ian directly. Be concise, conversational, useful. Voice = sharp, friendly co-worker, not customer support. No disclaimers, no "great question" filler. Keep replies under ~150 words unless he asks for more.

## ALWAYS READ BEFORE WRITE

Before mutating anything, read the current state.
- Before update_preferences: call read_preferences to see what's already blocked / required, then only pass NEW terms in update_preferences. Don't re-submit duplicates.
- Before update_pipeline_row: call search_pipeline to resolve the slug AND confirm the row's current state. Don't blindly issue patches.

This rule applies to every future tool that mutates data. Read state, plan the diff, then call.

## Convert vague asks into thorough scope

When Ian gives you a category-level instruction, expand it into the specific terms a recommender would match against. Make ONE update_preferences call with the full expanded list.

Examples:
- "block developer jobs" → ["software engineer","backend engineer","frontend engineer","full-stack engineer","developer","software developer","sre","devops engineer","platform engineer","infrastructure engineer","mobile engineer","ml engineer"]
- "no early-stage startups" → ["seed","series a","pre-seed","early-stage","founding engineer"]
- "must be remote" → ["remote","fully remote","remote-first"]
- "only climate tech" → ["climate","climate tech","decarbonization","clean energy","sustainability","carbon"]

Lean toward MORE coverage — recommenders match strings, generous beats narrow. Cap each call at ~12 terms.

## Conversational confirms

When you respond, tell Ian WHAT YOU ACTUALLY DID and what's NOW in effect. Don't say "done" alone. Example:

> Read your prefs, then expanded "developer jobs" to: software engineer, backend engineer, frontend engineer, full-stack engineer, developer, sre, devops, platform engineer, infrastructure engineer, mobile engineer, ML engineer. Added 11 new terms (1 was already there). Your blocked list is at 12 total. Future recommendations will skip any posting whose title matches one of these. Tell me if I went too wide.

## Tools

- read_preferences(): returns current preferences from job.vision_field. Each field comes back as { value: string[], updated_at, source } — the updated_at tells you WHEN that preference was last touched and source tells you who touched it ('agent', 'user', 'migrate-job'). Use BEFORE update_preferences to see what's already configured, skip dupes, and tell Ian when something was last changed.
- search_pipeline(query): find roles Ian has saved/active. Returns up to 20 matches with slug, title, company, status, stage, fit_score, url.
- update_pipeline_row(slug, fields): patch a row. Stages: Drafting|Applied|Interviewing|Offer. Status: Active|Archive. Find slug via search_pipeline first.
- add_role_from_url(url): save a posting URL.
- update_preferences(blocked, must_have, note): WRITES TO job.vision so pull-recommendations actually filters by these. blocked + must_have are arrays. Always read_preferences first; only pass NEW terms.

## Rules

- Don't confirm before single-row changes — just do them and report.
- If a tool fails, tell Ian honestly. Don't pretend it worked.
- If the request doesn't match any tool, just answer.
- Never write vague strings like "developer jobs" — expand first.`;

const TOOLS = [
  {
    name: 'read_preferences',
    description: "Read Ian's current search preferences from job.vision. Returns blocked_titles, must_have_keywords, target_titles, target_geographies. Call this BEFORE update_preferences so you can dedupe and tell Ian what's already in effect.",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_pipeline',
    description: "Search Ian's saved + active job pipeline. Returns up to 20 matching rows with slug, title, company, status, stage, fit_score, url.",
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Free-text query: company name, role title, keyword. Empty returns the most recent rows.' } }, required: ['query'] },
  },
  {
    name: 'update_pipeline_row',
    description: 'Update a single pipeline row by slug. Use for stage advances, status changes, exit_reason capture. Slug from search_pipeline.',
    input_schema: { type: 'object', properties: { slug: { type: 'string' }, status: { type: 'string', enum: ['Active','Archive'] }, stage: { type: 'string', enum: ['Drafting','Applied','Interviewing','Offer'] }, exit_reason: { type: 'string' } }, required: ['slug'] },
  },
  {
    name: 'add_role_from_url',
    description: 'Save a job posting from a URL into the pipeline.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'update_preferences',
    description: 'Record search-direction signals into job.vision so pull-recommendations actually filters. Always call read_preferences first and only pass NEW terms. blocked and must_have are arrays.',
    input_schema: {
      type: 'object',
      properties: {
        blocked:   { type: 'array', items: { type: 'string' }, description: 'Categories/keywords to block. Expand the user\'s vague ask (e.g. "developer jobs" → ["software engineer","backend engineer",...]).' },
        must_have: { type: 'array', items: { type: 'string' }, description: 'Categories/keywords to require.' },
        note:      { type: 'string', description: 'Optional human-readable context.' },
      },
    },
  },
];

// ── Tool implementations ─────────────────────────────────────────────────

async function authedFetch(url: string, opts: RequestInit, authHeader: string): Promise<Response> {
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: authHeader } });
}

// Read preferences from the normalized job.vision_field table (one row
// per field, source of truth post-migration 074). Falls back to legacy
// job.vision for fields that haven't been seeded into vision_field yet.
async function toolReadPreferences(userId: string) {
  const sql = db();
  const wantedFields = ['blocked_titles', 'must_have_keywords', 'target_titles', 'target_geographies'];
  const rows = await sql<{ name: string; value: unknown; updated_at: string; source: string }[]>`
    select name, value, updated_at, source
      from job.vision_field
     where user_id = ${userId}
       and name = any(${wantedFields}::text[])
  `;
  const byName = new Map(rows.map((r) => [r.name, r]));
  const get = (n: string): { value: string[]; updated_at: string | null; source: string | null } => {
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

async function toolSearchPipeline({ query }: { query: string }, authHeader: string) {
  const res = await authedFetch(PIPE_URL, {}, authHeader);
  if (!res.ok) throw new Error(`jobs-pipe ${res.status}: ${(await res.text()).slice(0,200)}`);
  const data = await res.json();
  const roles: Array<Record<string, unknown>> = data.roles || [];
  const q = (query || '').toLowerCase().trim();
  const filtered = q ? roles.filter((r) => [r.title, r.company, r.sector, r.notes, r.slug].some((f) => (String(f||'')).toLowerCase().includes(q))) : roles;
  const trimmed = filtered.slice(0,20).map((r) => ({ slug: r.slug, title: r.title, company: r.company, status: r.status, stage: r.stage, fit_score: r.fit_score, url: r.url }));
  return { count: filtered.length, roles: trimmed };
}

async function toolUpdatePipelineRow(args: Record<string, unknown>, authHeader: string) {
  const patch: Record<string, unknown> = { slug: args.slug };
  for (const k of ['status','stage','exit_reason']) { if (args[k] != null) patch[k] = args[k]; }
  const res = await authedFetch(PIPE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }, authHeader);
  if (!res.ok) throw new Error(`update-role ${res.status}: ${(await res.text()).slice(0,200)}`);
  return await res.json();
}

async function toolAddRoleFromUrl({ url }: { url: string }, authHeader: string) {
  const res = await authedFetch(ADD_ROLE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }, authHeader);
  if (!res.ok) throw new Error(`add-role ${res.status}: ${(await res.text()).slice(0,200)}`);
  return await res.json();
}

// Writes to job.vision_field. The sync trigger mirrors changes back into
// job.vision for legacy readers (pull-recommendations, computeFit).
async function toolUpdatePreferences(args: { blocked?: string[]; must_have?: string[]; note?: string }, userId: string) {
  const normalize = (arr?: string[]): string[] => (Array.isArray(arr) ? arr : [])
    .map(s => String(s).toLowerCase().trim()).filter(Boolean);
  const newBlocked  = normalize(args.blocked);
  const newMustHave = normalize(args.must_have);
  if (newBlocked.length === 0 && newMustHave.length === 0) {
    return { ok: false, error: 'specify at least one blocked or must_have term' };
  }

  const sql = db();

  // Read current values from vision_field. We expect both rows to exist
  // (seeded by migration 074), but UPSERT defensively in case.
  const cur = await sql<{ name: string; value: unknown }[]>`
    select name, value from job.vision_field
     where user_id = ${userId} and name in ('blocked_titles', 'must_have_keywords')
  `;
  const curMap = new Map(cur.map((r) => [r.name, Array.isArray(r.value) ? (r.value as string[]) : []]));
  const curBlocked  = new Set((curMap.get('blocked_titles')      || []).map((s) => s.toLowerCase()));
  const curMustHave = new Set((curMap.get('must_have_keywords')  || []).map((s) => s.toLowerCase()));

  const addedBlocked    = newBlocked.filter((t) => !curBlocked.has(t));
  const skippedBlocked  = newBlocked.filter((t) =>  curBlocked.has(t));
  const addedMustHave   = newMustHave.filter((t) => !curMustHave.has(t));
  const skippedMustHave = newMustHave.filter((t) =>  curMustHave.has(t));

  if (addedBlocked.length === 0 && addedMustHave.length === 0) {
    return { ok: true, no_op: true, skipped_blocked: skippedBlocked, skipped_must_have: skippedMustHave, total_blocked: curBlocked.size, total_must_have: curMustHave.size };
  }

  const nextBlocked  = Array.from(new Set([...curBlocked,  ...addedBlocked]));
  const nextMustHave = Array.from(new Set([...curMustHave, ...addedMustHave]));
  const sourceDetail = args.note ? { note: args.note } : null;

  // Upsert both rows. on conflict updates value + source + updated_at.
  // The sync trigger mirrors the new arrays into job.vision columns.
  if (addedBlocked.length) {
    await sql`
      insert into job.vision_field (user_id, name, value, kind, source, source_detail)
      values (${userId}, 'blocked_titles', ${JSON.stringify(nextBlocked)}::jsonb, 'string_array', 'agent', ${sourceDetail})
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
      values (${userId}, 'must_have_keywords', ${JSON.stringify(nextMustHave)}::jsonb, 'string_array', 'agent', ${sourceDetail})
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

async function runTool(name: string, input: Record<string, unknown>, authHeader: string, userId: string): Promise<unknown> {
  try {
    switch (name) {
      case 'read_preferences':    return await toolReadPreferences(userId);
      case 'search_pipeline':     return await toolSearchPipeline(input as { query: string }, authHeader);
      case 'update_pipeline_row': return await toolUpdatePipelineRow(input, authHeader);
      case 'add_role_from_url':   return await toolAddRoleFromUrl(input as { url: string }, authHeader);
      case 'update_preferences':  return await toolUpdatePreferences(input as { blocked?: string[]; must_have?: string[]; note?: string }, userId);
      default: return { error: `unknown tool: ${name}` };
    }
  } catch (err) { return { error: String((err as Error).message || err) }; }
}

// ── Persistence ──────────────────────────────────────────────────────────

interface PersistedMessage { id: string; role: 'user'|'assistant'|'tool'; body: string; tool_name?: string; tool_payload?: unknown; created_at: string; }

async function fetchHistory(supabase: ReturnType<typeof createClient>, userId: string): Promise<PersistedMessage[]> {
  const { data, error } = await supabase.from('chat_message').select('id, role, body, tool_name, tool_payload, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(MAX_HISTORY);
  if (error) { console.warn('[ask-job-agent] history fail', error); return []; }
  return ((data || []) as PersistedMessage[]).reverse();
}

async function insertMessage(supabase: ReturnType<typeof createClient>, userId: string, row: { role: 'user'|'assistant'|'tool'; body: string; tool_name?: string; tool_payload?: unknown }): Promise<PersistedMessage | null> {
  const { data, error } = await supabase.from('chat_message').insert({ user_id: userId, ...row }).select('id, role, body, tool_name, tool_payload, created_at').single();
  if (error) { console.warn('[ask-job-agent] insert fail', error); return null; }
  return data as PersistedMessage;
}

interface TextBlock { type: 'text'; text: string; }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; }
type ContentBlock = TextBlock | ToolUseBlock;
interface ClaudeResp { content: ContentBlock[]; stop_reason: string; }

async function callClaude(messages: Array<{ role: 'user'|'assistant'; content: unknown }>): Promise<ClaudeResp> {
  const key = Deno.env.get('ANTHROPIC_API_KEY'); if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, system: SYSTEM_PROMPT, tools: TOOLS, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0,400)}`);
  return await res.json();
}

function historyToMessages(history: PersistedMessage[]): Array<{ role: 'user'|'assistant'; content: unknown }> {
  const out: Array<{ role: 'user'|'assistant'; content: unknown }> = [];
  let pendingBreadcrumbs: string[] = [];
  const flush = () => {
    if (!pendingBreadcrumbs.length) return;
    const last = out.length - 1;
    if (last >= 0 && out[last].role === 'assistant') {
      out[last] = { role: 'assistant', content: `${out[last].content as string}\n\n${pendingBreadcrumbs.join('\n')}` };
    } else {
      out.push({ role: 'assistant', content: pendingBreadcrumbs.join('\n') });
    }
    pendingBreadcrumbs = [];
  };
  for (const m of history) {
    if (m.role === 'tool') {
      const p = (m.tool_payload || {}) as { input?: unknown; output?: unknown };
      pendingBreadcrumbs.push(`[Ran ${m.tool_name} with ${JSON.stringify(p.input ?? {}).slice(0,400)} → ${JSON.stringify(p.output ?? {}).slice(0,600)}]`);
      continue;
    }
    if (m.role === 'user') { flush(); if (m.body) out.push({ role: 'user', content: m.body }); continue; }
    if (m.role === 'assistant') { flush(); if (m.body) out.push({ role: 'assistant', content: m.body }); }
  }
  flush();
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const user = await verifyJobUserDetailed(req);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  let message = '';
  try { const body = await req.json(); message = String(body?.message || '').slice(0,4000).trim(); } catch (_) { /* ignore */ }
  if (!message) return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const authHeader = `Bearer ${token}`;
  const supabase = createClient(SUPABASE_URL, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
  const newEvents: PersistedMessage[] = [];

  try {
    const history = await fetchHistory(supabase, user.id);
    const userRec = await insertMessage(supabase, user.id, { role: 'user', body: message });
    if (userRec) newEvents.push(userRec);

    const messages: Array<{ role: 'user'|'assistant'; content: unknown }> = historyToMessages(history);
    messages.push({ role: 'user', content: message });

    let iter = 0;
    while (iter < MAX_ITERATIONS) {
      iter++;
      const response = await callClaude(messages);
      const blocks = response.content;
      const text = blocks.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      const toolUses = blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (text) { const rec = await insertMessage(supabase, user.id, { role: 'assistant', body: text }); if (rec) newEvents.push(rec); }
      messages.push({ role: 'assistant', content: blocks });
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break;
      const resultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      for (const tu of toolUses) {
        const result = await runTool(tu.name, tu.input, authHeader, user.id);
        const rec = await insertMessage(supabase, user.id, { role: 'tool', body: '', tool_name: tu.name, tool_payload: { input: tu.input, output: result } });
        if (rec) newEvents.push(rec);
        resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0,8000) });
      }
      messages.push({ role: 'user', content: resultBlocks });
    }
    return new Response(JSON.stringify({ events: newEvents }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[ask-job-agent] err', err);
    const rec = await insertMessage(supabase, user.id, { role: 'assistant', body: `Sorry — I hit an error. (${String((err as Error).message || err).slice(0,200)})` });
    if (rec) newEvents.push(rec);
    return new Response(JSON.stringify({ events: newEvents, error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
