// Supabase Edge Function: generate-intent-plan
// Streams a Claude-generated integration plan for AI tools.
// This is the only streaming function in the codebase.
//
// POST /functions/v1/generate-intent-plan
// Body: { tool_name, tagline, url, domain, docs_url, practical_tags, entities, recent_pins }

const VERSION = '1.0.2'
console.log(`[generate-intent-plan] v${VERSION} — streaming integration plan generator`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface PlanRequest {
  tool_name: string
  tagline?: string
  url: string
  domain: string
  docs_url?: string
  github_url?: string
  practical_tags?: string[]
  entities?: Array<{ name: string; type: string }>
  recent_pins?: Array<{ title: string; domain: string; content_type: string }>
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body: PlanRequest = await req.json()

    if (!body.tool_name || !body.url) {
      return new Response(
        JSON.stringify({ error: 'tool_name and url are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build context from recent pins for personalization
    const recentContext = body.recent_pins?.length
      ? `\n\nRecent tools/projects in the user's collection:\n${body.recent_pins
          .slice(0, 10)
          .map(p => `- ${p.title} (${p.domain})`)
          .join('\n')}`
      : ''

    const prompt = `You are a senior software architect. Generate a concrete integration plan for the following AI tool.

**Tool:** ${body.tool_name}
**URL:** ${body.url}
**Description:** ${body.tagline || 'No description available'}
**Domain:** ${body.domain}
${body.docs_url ? `**Docs:** ${body.docs_url}` : ''}
${body.github_url ? `**GitHub:** ${body.github_url}` : ''}
${body.practical_tags?.length ? `**Tags:** ${body.practical_tags.join(', ')}` : ''}
${body.entities?.length ? `**Related:** ${body.entities.map(e => e.name).join(', ')}` : ''}
${recentContext}

Generate a structured integration plan with these sections:

## Overview
One paragraph: what this tool does and why it's worth integrating.

## Setup Steps
Numbered steps to get started (install, auth, config).

## API Approach
How to integrate: key endpoints/methods, auth pattern, data format.

## Architecture Fit
How this fits into a web application: where it runs (client/server/edge), data flow, and dependencies.

## Estimated Effort
Time estimate and complexity rating (low/medium/high).

## Risks & Gotchas
Known limitations, pricing concerns, or compatibility issues.

Be specific and actionable. Use code snippets where helpful (shell commands, config examples). Keep it under 800 words.`

    // Stream from Anthropic
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text()
      console.error('[generate-intent-plan] Claude API error:', anthropicResponse.status, errText)
      return new Response(
        JSON.stringify({ error: 'Plan generation failed', detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Forward SSE stream to client
    return new Response(anthropicResponse.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    console.error('[generate-intent-plan] Error:', err)
    return new Response(
      JSON.stringify({ error: 'Internal error', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
