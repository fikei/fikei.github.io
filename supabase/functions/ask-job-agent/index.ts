// Supabase Edge Function: ask-job-agent
// P1: agent loop with 4 tools. Sonnet 4.6 coordinator. See chat thread for
// locked design recs.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { verifyJobUserDetailed, corsHeaders } from '../_shared/job-auth.ts';

const VERSION = '0.2.0';
console.log(`[ask-job-agent] v${VERSION} - P1 agent loop with 4 tools`);

const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 20;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_ITERATIONS = 5;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PIPE_URL     = `${SUPABASE_URL}/functions/v1/jobs-pipe`;
const ADD_ROLE_URL = `${SUPABASE_URL}/functions/v1/add-role`;
const KB_READ_URL  = `${SUPABASE_URL}/functions/v1/kb-read`;
const KB_WRITE_URL = `${SUPABASE_URL}/functions/v1/kb-write`;

const SYSTEM_PROMPT = `You are the agent for /job, Ian Fike's career knowledge base at ctrl.rodeo/job. Ian uses /job to track every role he's interested in, his career history, and his search preferences.

Speak with Ian directly. Be concise, conversational, useful. Voice = sharp, friendly co-worker, not customer support. No disclaimers, no "great question" filler. Keep replies under ~120 words unless he asks for more.

You have four tools:
- search_pipeline(query): find roles Ian has saved or marked active. Pass a short query. Returns up to 20 matches with slug, title, company, status, stage, fit_score, url.
- update_pipeline_row(slug, fields): change a row's status/stage/exit_reason. Find slug via search_pipeline first. Stages: Drafting|Applied|Interviewing|Offer. Status: Active|Archive.
- add_role_from_url(url): save a job posting URL into Ian's pipeline.
- update_preferences(blocked, must_have): record search-direction signals.

Rules:
- Use search_pipeline before update_pipeline_row to look up the slug.
- Don't confirm before single-row changes - just do them and report.
- If a tool fails, tell Ian honestly. Don't pretend it worked.
- If the request doesn't match any tool, just answer.`;

const TOOLS = [
  { name: 'search_pipeline', description: "Search Ian's saved + active job pipeline. Returns up to 20 matching rows.", input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Free-text query.' } }, required: ['query'] } },
  { name: 'update_pipeline_row', description: 'Update a single pipeline row by slug.', input_schema: { type: 'object', properties: { slug: { type: 'string' }, status: { type: 'string', enum: ['Active','Archive'] }, stage: { type: 'string', enum: ['Drafting','Applied','Interviewing','Offer'] }, exit_reason: { type: 'string' } }, required: ['slug'] } },
  { name: 'add_role_from_url', description: 'Save a job posting from a URL.', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'update_preferences', description: 'Record search-direction signals.', input_schema: { type: 'object', properties: { blocked: { type: 'string' }, must_have: { type: 'string' }, note: { type: 'string' } } } },
];

async function authedFetch(url: string, opts: RequestInit, authHeader: string): Promise<Response> {
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: authHeader } });
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

async function toolUpdatePreferences(args: { blocked?: string; must_have?: string; note?: string }, authHeader: string) {
  const path = 'fikei/job/02-goals-intents/agent-preferences.md';
  let existing = '';
  let sha: string | undefined;
  try {
    const readRes = await authedFetch(`${KB_READ_URL}?path=${encodeURIComponent(path)}`, {}, authHeader);
    if (readRes.ok) { const d = await readRes.json(); existing = d.content || ''; sha = d.sha; }
  } catch (_) {}
  if (!args.blocked && !args.must_have) return { ok: false, error: 'specify blocked or must_have' };
  const ts = new Date().toISOString().slice(0,10);
  const lines: string[] = [];
  if (args.blocked)   lines.push(`- ${ts}: **blocked** - ${args.blocked}${args.note ? ` _(${args.note})_` : ''}`);
  if (args.must_have) lines.push(`- ${ts}: **must_have** - ${args.must_have}${args.note ? ` _(${args.note})_` : ''}`);
  const header = '# Agent search preferences\n\nAppended by /job chat. Used to bias future recommendations.\n\n';
  const body = existing.includes('# Agent search preferences') ? existing : header;
  const newBody = body.trimEnd() + '\n' + lines.join('\n') + '\n';
  const writeRes = await authedFetch(KB_WRITE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: newBody, sha }) }, authHeader);
  if (!writeRes.ok) throw new Error(`kb-write ${writeRes.status}: ${(await writeRes.text()).slice(0,200)}`);
  return { ok: true, appended: lines };
}

async function runTool(name: string, input: Record<string, unknown>, authHeader: string): Promise<unknown> {
  try {
    switch (name) {
      case 'search_pipeline':     return await toolSearchPipeline(input as { query: string }, authHeader);
      case 'update_pipeline_row': return await toolUpdatePipelineRow(input, authHeader);
      case 'add_role_from_url':   return await toolAddRoleFromUrl(input as { url: string }, authHeader);
      case 'update_preferences':  return await toolUpdatePreferences(input as { blocked?: string; must_have?: string; note?: string }, authHeader);
      default: return { error: `unknown tool: ${name}` };
    }
  } catch (err) { return { error: String((err as Error).message || err) }; }
}

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
  for (const m of history) {
    if (m.role === 'tool') continue;
    if (!m.body) continue;
    out.push({ role: m.role as 'user'|'assistant', content: m.body });
  }
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const user = await verifyJobUserDetailed(req);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  let message = '';
  try { const body = await req.json(); message = String(body?.message || '').slice(0,4000).trim(); } catch (_) {}
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
        const result = await runTool(tu.name, tu.input, authHeader);
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
