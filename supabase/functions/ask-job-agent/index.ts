// Supabase Edge Function: ask-job-agent
// Coordinator for the /job global chat. P0 scope: single-turn LLM with the
// last N messages of context, no tools, no streaming. The agent loop with
// tool use and sub-agents lands in P1.
//
// POST /functions/v1/ask-job-agent
// Body: { message: string }
// Returns: { user: ChatMessage, assistant: ChatMessage }
//
// Auth: standard /job bearer token (verifyJobUserDetailed).
//
// Design recs locked in (see chat conversation):
//   - Coordinator: claude-sonnet-4-6
//   - Single rolling thread per user
//   - Direct-answer for read-only; in P0 every request is read-only
//   - $0.05 hard cap per turn (≈ ~25k input + 4k output tokens at Sonnet)
//   - No streaming yet (P4)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.97.0';
import { verifyJobUserDetailed, corsHeaders } from '../_shared/job-auth.ts';

const VERSION = '0.1.0';
console.log(`[ask-job-agent] v${VERSION} — P0 coordinator (no tools, no stream)`);

const MODEL = 'claude-sonnet-4-6';
const MAX_HISTORY = 20;   // last N messages included as context
const MAX_OUTPUT_TOKENS = 1024;

const SYSTEM_PROMPT = `You are the agent for /job, Ian Fike's career knowledge base at ctrl.rodeo/job. Ian uses this app to track every job he's interested in, his career history, his recommendations, and his search preferences.

You speak with Ian directly. Be concise, conversational, and useful. Match the voice of a sharp, friendly co-worker — not a customer-support bot. Don't add disclaimers, preambles, or "great question" filler.

Your job right now (P0 scope):
- Answer questions about what /job is, what's on the site, and what you (the agent) will be able to do once tools are wired up.
- Be honest about your limits. You can't yet read Ian's actual pipeline, vision, or career data — that lands in P1.
- If Ian asks you to *do* something (add a role, update preferences, archive items, generate a resume, summarize his pipeline) tell him which Tier-1 capability that maps to and that it's coming in the next phase. Don't pretend to do it.

When you do not know something, say so. Keep responses under ~120 words unless Ian explicitly asks for more.`;

interface ClientMessage { role: 'user' | 'assistant' | 'tool' | 'system'; body: string; }

async function fetchHistory(supabase: ReturnType<typeof createClient>, userId: string): Promise<ClientMessage[]> {
  const { data, error } = await supabase
    .from('chat_message')
    .select('role, body')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY);
  if (error) {
    console.warn('[ask-job-agent] fetchHistory failed', error);
    return [];
  }
  // Reverse so we end up with oldest-first to send to the model.
  return (data || []).reverse() as ClientMessage[];
}

async function insertMessage(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  role: 'user' | 'assistant',
  body: string,
): Promise<{ id: string; role: string; body: string; created_at: string } | null> {
  const { data, error } = await supabase
    .from('chat_message')
    .insert({ user_id: userId, role, body })
    .select('id, role, body, created_at')
    .single();
  if (error) {
    console.warn('[ask-job-agent] insertMessage failed', error);
    return null;
  }
  return data as { id: string; role: string; body: string; created_at: string };
}

async function callClaude(history: ClientMessage[], userMsg: string): Promise<string> {
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured');

  // Anthropic messages API expects only user/assistant roles; map tool
  // results down to user-role text for now (tools aren't in P0).
  const messages = [
    ...history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.body })),
    { role: 'user' as const, content: userMsg },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 400)}`);
  }
  const payload = await res.json();
  const text = (payload?.content || [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n')
    .trim();
  return text || '(no response)';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const user = await verifyJobUserDetailed(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let message = '';
  try {
    const body = await req.json();
    message = String(body?.message || '').slice(0, 4000).trim();
  } catch (_) { /* ignored */ }
  if (!message) {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Use a user-scoped client so RLS gates the insert/select to this user.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const history = await fetchHistory(supabase, user.id);

    // Persist the user turn first so even if the model call fails the
    // message isn't lost from the UI.
    const userRecord = await insertMessage(supabase, user.id, 'user', message);

    const assistantText = await callClaude(history, message);
    const assistantRecord = await insertMessage(supabase, user.id, 'assistant', assistantText);

    return new Response(JSON.stringify({ user: userRecord, assistant: assistantRecord }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[ask-job-agent] error', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
