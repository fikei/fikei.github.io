// Supabase Edge Function: ask-job-agent
// P2 (Move B): tool schemas + handlers now come from _shared/job-tools.ts.
// This file is the chat-specific orchestration: thread persistence,
// Anthropic agent loop with breadcrumbed history replay, error fallback.
// Pure tool execution moved to the shared registry so a headless
// job-tools endpoint (and future MCP adapter) can invoke the same code.
//
// POST /functions/v1/ask-job-agent
// Body: { message: string }
// Returns: { events: ChatEvent[] }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { verifyJobUserDetailed, corsHeaders } from '../_shared/job-auth.ts';
import { TOOL_SCHEMAS, invokeTool, type ToolContext } from '../_shared/job-tools.ts';

const VERSION = '0.6.0';
console.log(`[ask-job-agent] v${VERSION} — Move B: tool registry extracted to _shared/job-tools`);

const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 20;
const MAX_OUTPUT_TOKENS = 1500;
const MAX_ITERATIONS = 6;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

const SYSTEM_PROMPT = `You are the agent for /job, Ian Fike's career knowledge base at ctrl.rodeo/job. Ian uses /job to track every role he's interested in, his career history, and his search preferences.

Speak with Ian directly. Be concise, conversational, useful. Voice = sharp, friendly co-worker, not customer support. No disclaimers, no "great question" filler. Keep replies under ~150 words unless he asks for more.

## ALWAYS READ BEFORE WRITE

Before mutating anything, read the current state.
- Before update_preferences: call read_preferences to see what's already blocked / required, then only pass NEW terms in update_preferences. Don't re-submit duplicates.
- Before update_pipeline_row: call search_pipeline to resolve the slug AND confirm the row's current state.

## Convert vague asks into thorough scope

When Ian gives you a category-level instruction, expand it into the specific terms a recommender would match against. Make ONE update_preferences call with the full expanded list.

Examples:
- "block developer jobs" → ["software engineer","backend engineer","frontend engineer","full-stack engineer","developer","software developer","sre","devops engineer","platform engineer","infrastructure engineer","mobile engineer","ml engineer"]
- "no early-stage startups" → ["seed","series a","pre-seed","early-stage","founding engineer"]
- "must be remote" → ["remote","fully remote","remote-first"]
- "only climate tech" → ["climate","climate tech","decarbonization","clean energy","sustainability","carbon"]

Lean toward MORE coverage — recommenders match strings. Cap each call at ~12 terms.

## Conversational confirms

Tell Ian WHAT YOU ACTUALLY DID and what's NOW in effect. Don't say "done" alone. Show the expanded terms so he can correct course.

## Rules

- Don't confirm before single-row changes — just do them and report.
- If a tool fails, tell Ian honestly. Don't pretend it worked.
- If the request doesn't match any tool, just answer.
- Never write vague strings like "developer jobs" — expand first.`;

// ── Chat persistence ─────────────────────────────────────────────────────

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  body: string;
  tool_name?: string;
  tool_payload?: unknown;
  created_at: string;
}

async function fetchHistory(supabase: ReturnType<typeof createClient>, userId: string): Promise<PersistedMessage[]> {
  const { data, error } = await supabase
    .from('chat_message')
    .select('id, role, body, tool_name, tool_payload, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY);
  if (error) { console.warn('[ask-job-agent] history fail', error); return []; }
  return ((data || []) as PersistedMessage[]).reverse();
}

async function insertMessage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  row: { role: 'user' | 'assistant' | 'tool'; body: string; tool_name?: string; tool_payload?: unknown },
): Promise<PersistedMessage | null> {
  const { data, error } = await supabase
    .from('chat_message')
    .insert({ user_id: userId, ...row })
    .select('id, role, body, tool_name, tool_payload, created_at')
    .single();
  if (error) { console.warn('[ask-job-agent] insert fail', error); return null; }
  return data as PersistedMessage;
}

// ── Anthropic loop ───────────────────────────────────────────────────────

interface TextBlock { type: 'text'; text: string; }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; }
type ContentBlock = TextBlock | ToolUseBlock;
interface ClaudeResp { content: ContentBlock[]; stop_reason: string; }

async function callClaude(messages: Array<{ role: 'user' | 'assistant'; content: unknown }>): Promise<ClaudeResp> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_OUTPUT_TOKENS, system: SYSTEM_PROMPT, tools: TOOL_SCHEMAS, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return await res.json();
}

// Replay prior tool runs as compact assistant breadcrumbs so the model
// remembers what it did across turns. We don't persist Anthropic's
// tool_use_id, so we synthesize a faithful textual summary instead.
function historyToMessages(history: PersistedMessage[]): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  let pending: string[] = [];
  const flush = () => {
    if (!pending.length) return;
    const last = out.length - 1;
    if (last >= 0 && out[last].role === 'assistant') {
      out[last] = { role: 'assistant', content: `${out[last].content as string}\n\n${pending.join('\n')}` };
    } else {
      out.push({ role: 'assistant', content: pending.join('\n') });
    }
    pending = [];
  };
  for (const m of history) {
    if (m.role === 'tool') {
      const p = (m.tool_payload || {}) as { input?: unknown; output?: unknown };
      pending.push(`[Ran ${m.tool_name} with ${JSON.stringify(p.input ?? {}).slice(0, 400)} → ${JSON.stringify(p.output ?? {}).slice(0, 600)}]`);
      continue;
    }
    if (m.role === 'user') { flush(); if (m.body) out.push({ role: 'user', content: m.body }); continue; }
    if (m.role === 'assistant') { flush(); if (m.body) out.push({ role: 'assistant', content: m.body }); }
  }
  flush();
  return out;
}

// ── Handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const user = await verifyJobUserDetailed(req);
  if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let message = '';
  try { const body = await req.json(); message = String(body?.message || '').slice(0, 4000).trim(); } catch (_) { /* ignore */ }
  if (!message) return new Response(JSON.stringify({ error: 'message required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const authHeader = `Bearer ${token}`;
  const supabase = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
  const ctx: ToolContext = { userId: user.id, authHeader };
  const newEvents: PersistedMessage[] = [];

  try {
    const history = await fetchHistory(supabase, user.id);
    const userRec = await insertMessage(supabase, user.id, { role: 'user', body: message });
    if (userRec) newEvents.push(userRec);

    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = historyToMessages(history);
    messages.push({ role: 'user', content: message });

    let iter = 0;
    while (iter < MAX_ITERATIONS) {
      iter++;
      const response = await callClaude(messages);
      const blocks = response.content;
      const text = blocks.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      const toolUses = blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (text) {
        const rec = await insertMessage(supabase, user.id, { role: 'assistant', body: text });
        if (rec) newEvents.push(rec);
      }
      messages.push({ role: 'assistant', content: blocks });
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      const resultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      for (const tu of toolUses) {
        const result = await invokeTool(tu.name, tu.input, ctx);
        const rec = await insertMessage(supabase, user.id, { role: 'tool', body: '', tool_name: tu.name, tool_payload: { input: tu.input, output: result } });
        if (rec) newEvents.push(rec);
        resultBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 8000) });
      }
      messages.push({ role: 'user', content: resultBlocks });
    }

    return new Response(JSON.stringify({ events: newEvents }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('[ask-job-agent] err', err);
    const rec = await insertMessage(supabase, user.id, { role: 'assistant', body: `Sorry — I hit an error. (${String((err as Error).message || err).slice(0, 200)})` });
    if (rec) newEvents.push(rec);
    return new Response(JSON.stringify({ events: newEvents, error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
