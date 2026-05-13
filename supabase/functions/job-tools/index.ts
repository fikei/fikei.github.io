// Supabase Edge Function: job-tools
// Headless tool-execution surface for /job. Same registry + handlers
// the chat agent uses, exposed as plain HTTP so:
//   - any HTTP client (CLI, IDE, future MCP adapter) can invoke a tool
//     without going through Anthropic
//   - tools become testable in isolation
//   - the schemas are discoverable at runtime
//
// GET  /functions/v1/job-tools
//   → { tools: ToolSchema[] }   // identical to the array the chat agent
//                                  passes to the Anthropic messages API
//
// POST /functions/v1/job-tools
//   Body: { name: string, input: Record<string, unknown> }
//   → { name, input, output, duration_ms }
//
// Auth: standard /job bearer token (verifyJobUserDetailed). Each
// invocation runs with the caller's user id + their auth header so
// inner fetches to jobs-pipe / add-role inherit their permissions.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserDetailed, corsHeaders, jsonResp, err } from '../_shared/job-auth.ts';
import { TOOL_SCHEMAS, TOOL_HANDLERS, invokeTool, type ToolContext } from '../_shared/job-tools.ts';

const VERSION = '0.1.0';
console.log(`[job-tools] v${VERSION} — ${TOOL_SCHEMAS.length} tools registered`);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Both GET (schema discovery) and POST (invoke) require auth — Supabase
  // verify_jwt is on by default at the platform layer, and gating schema
  // discovery is fine for a private app.
  const user = await verifyJobUserDetailed(req);
  if (!user) return err('unauthorized', 401);

  if (req.method === 'GET') {
    return jsonResp({
      tools: TOOL_SCHEMAS,
      handlers: Object.keys(TOOL_HANDLERS),
    });
  }

  if (req.method !== 'POST') return err('method not allowed', 405);

  let body: { name?: string; input?: Record<string, unknown> };
  try { body = await req.json(); } catch (_) { return err('invalid JSON body'); }
  const name = String(body?.name || '').trim();
  if (!name) return err('name required');
  if (!TOOL_HANDLERS[name]) return err(`unknown tool: ${name}`, 404);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const ctx: ToolContext = {
    userId: user.id,
    authHeader: `Bearer ${token}`,
  };

  const t0 = Date.now();
  const output = await invokeTool(name, body.input || {}, ctx);
  const duration_ms = Date.now() - t0;

  return jsonResp({ name, input: body.input || {}, output, duration_ms });
});
