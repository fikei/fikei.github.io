// Supabase Edge Function: agent-handler
// Orchestrates AI agent workforce for automated management tasks
// Handles requests from GitHub Actions, webhooks, and manual triggers
//
// POST /functions/v1/agent-handler
// Body: { agent, trigger, context?, payload? }
// Returns: { success, agent, result, timestamp }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Agent definitions matching .claude/agents/
const AGENTS = {
  'status-update': {
    name: 'Status Update Agent',
    description: 'Tracks progress and flags risks in real-time',
    systemPrompt: `You are the Status Update Agent for ctrl.rodeo. Your role is to:
1. Track project progress across all active work
2. Identify and flag risks or blockers proactively
3. Generate concise status summaries
4. Highlight items needing attention

Be factual, concise, and actionable. Use bullet points.`,
  },
  'organizational': {
    name: 'Organizational Agent',
    description: 'Maintains documentation standards and data integrity',
    systemPrompt: `You are the Organizational Agent for ctrl.rodeo. Your role is to:
1. Audit documentation for completeness and accuracy
2. Ensure naming conventions are followed
3. Check that PRDs, TECH docs, and code are aligned
4. Flag inconsistencies or missing documentation

Be thorough but concise. List specific issues with file paths.`,
  },
  'project-management': {
    name: 'Project Management Agent',
    description: 'Formats content into phases, epics, and tasks',
    systemPrompt: `You are the Project Management Agent for ctrl.rodeo. Your role is to:
1. Break down PRDs into actionable tasks
2. Organize work into phases and epics
3. Estimate complexity and dependencies
4. Generate sprint-ready task lists

Output structured task breakdowns in markdown format.`,
  },
  'chief-of-staff': {
    name: 'Chief of Staff Agent',
    description: 'Maintains global view and routes decisions',
    systemPrompt: `You are the Chief of Staff Agent for ctrl.rodeo. Your role is to:
1. Synthesize information from all other agents
2. Provide executive-level summaries
3. Identify cross-cutting concerns
4. Route critical decisions to appropriate stakeholders

Be strategic, concise, and highlight what matters most.`,
  },
  'security-compliance': {
    name: 'Security & Compliance Agent',
    description: 'Audits privacy and security',
    systemPrompt: `You are the Security & Compliance Agent for ctrl.rodeo. Your role is to:
1. Scan for potential security vulnerabilities
2. Check for exposed secrets or credentials
3. Review API security practices
4. Ensure data privacy compliance

Report findings with severity levels: CRITICAL, HIGH, MEDIUM, LOW.`,
  },
  'continuous-improvement': {
    name: 'Continuous Improvement Agent',
    description: 'Analyzes patterns and suggests optimizations',
    systemPrompt: `You are the Continuous Improvement Agent for ctrl.rodeo. Your role is to:
1. Analyze development patterns and velocity
2. Identify bottlenecks and inefficiencies
3. Suggest process improvements
4. Track metrics over time

Provide data-driven recommendations with expected impact.`,
  },
}

type AgentType = keyof typeof AGENTS

interface AgentRequest {
  agent: AgentType | 'all'
  trigger: 'push' | 'pr' | 'scheduled' | 'manual' | 'webhook'
  context?: {
    branch?: string
    commit?: string
    files?: string[]
    prNumber?: number
  }
  payload?: Record<string, unknown>
}

interface AgentResult {
  agent: string
  success: boolean
  result: string
  timestamp: string
  duration: number
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  return data.content[0].text
}

async function runAgent(agentType: AgentType, request: AgentRequest): Promise<AgentResult> {
  const startTime = Date.now()
  const agent = AGENTS[agentType]

  try {
    // Build context-aware prompt
    let userPrompt = `Trigger: ${request.trigger}\n`

    if (request.context) {
      if (request.context.branch) userPrompt += `Branch: ${request.context.branch}\n`
      if (request.context.commit) userPrompt += `Commit: ${request.context.commit}\n`
      if (request.context.files?.length) {
        userPrompt += `Changed files:\n${request.context.files.map(f => `- ${f}`).join('\n')}\n`
      }
      if (request.context.prNumber) userPrompt += `PR: #${request.context.prNumber}\n`
    }

    if (request.payload) {
      userPrompt += `\nAdditional context:\n${JSON.stringify(request.payload, null, 2)}\n`
    }

    userPrompt += `\nPlease analyze and provide your report.`

    const result = await callClaude(agent.systemPrompt, userPrompt)

    return {
      agent: agent.name,
      success: true,
      result,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    }
  } catch (error) {
    return {
      agent: agent.name,
      success: false,
      result: `Error: ${error.message}`,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    }
  }
}

async function syncToNotion(results: AgentResult[]): Promise<void> {
  const notionKey = Deno.env.get('NOTION_API_KEY')
  if (!notionKey) {
    console.log('Notion sync skipped - NOTION_API_KEY not configured')
    return
  }

  // TODO: Implement Notion sync
  // This would create/update pages in Notion with agent results
  console.log('Notion sync placeholder - implement when Notion is configured')
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const request: AgentRequest = await req.json()

    // Validate request
    if (!request.agent || !request.trigger) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: agent, trigger' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const results: AgentResult[] = []

    if (request.agent === 'all') {
      // Run all agents in parallel
      const agentTypes = Object.keys(AGENTS) as AgentType[]
      const promises = agentTypes.map(type => runAgent(type, request))
      results.push(...await Promise.all(promises))
    } else if (AGENTS[request.agent]) {
      // Run single agent
      results.push(await runAgent(request.agent, request))
    } else {
      return new Response(
        JSON.stringify({ error: `Unknown agent: ${request.agent}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Sync results to Notion if configured
    await syncToNotion(results)

    return new Response(
      JSON.stringify({
        success: true,
        results,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Agent handler error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
