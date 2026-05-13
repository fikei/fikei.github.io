// Supabase Edge Function: job-mcp
// Model Context Protocol JSON-RPC adapter for the /job tool registry.
// Lets MCP-aware clients (Claude Desktop, IDE integrations, future
// agents) invoke the same tools the in-app chat agent uses.
//
// Separate from the existing supabase/functions/mcp-server which serves
// the ctrl.rodeo browsing/connector product.
//
// Wire protocol: MCP JSON-RPC 2.0 over HTTP.
//   POST /functions/v1/job-mcp
//   Body: { jsonrpc: "2.0", id, method, params? }
//   → Body: { jsonrpc: "2.0", id, result?, error? }
//
// Methods:
//   - initialize     → server name + version + capabilities
//   - tools/list     → schemas from TOOL_SCHEMAS
//   - tools/call     → invokes a tool, returns the result as content block
//
// Auth: standard /job bearer token.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyJobUserAny, corsHeaders } from '../_shared/job-auth.ts';
import { TOOL_SCHEMAS, invokeTool, type ToolContext } from '../_shared/job-tools.ts';

const VERSION = '0.1.0';
console.log(`[job-mcp] v${VERSION} — ${TOOL_SCHEMAS.length} tools`);

interface JsonRpcReq { jsonrpc: '2.0'; id: number | string | null; method: string; params?: Record<string, unknown>; }

function rpcResult(id: number | string | null, result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function rpcError(id: number | string | null, code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return rpcError(null, -32600, 'POST required', 405);

  const user = await verifyJobUserAny(req);
  if (!user) return rpcError(null, -32001, 'unauthorized', 401);

  let body: JsonRpcReq;
  try { body = await req.json(); } catch (_) { return rpcError(null, -32700, 'parse error'); }
  if (body.jsonrpc !== '2.0' || !body.method) return rpcError(body?.id ?? null, -32600, 'invalid request');

  const id = body.id ?? null;
  const method = body.method;
  const params = body.params || {};

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ctrl-rodeo-job', version: VERSION },
      });

    case 'tools/list':
      return rpcResult(id, {
        tools: TOOL_SCHEMAS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.input_schema,
        })),
      });

    case 'tools/call': {
      const name = String(params.name || '');
      const args = (params.arguments || {}) as Record<string, unknown>;
      if (!name) return rpcError(id, -32602, 'tool name required');
      const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const ctx: ToolContext = { userId: user.id, authHeader: `Bearer ${token}` };
      const output = await invokeTool(name, args, ctx);
      return rpcResult(id, {
        content: [
          { type: 'text', text: typeof output === 'string' ? output : JSON.stringify(output, null, 2) },
        ],
        isError: !!(output && typeof output === 'object' && 'error' in (output as Record<string, unknown>)),
      });
    }

    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
});
