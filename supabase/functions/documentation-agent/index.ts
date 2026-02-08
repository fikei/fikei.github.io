// Supabase Edge Function: documentation-agent
// Manages documentation content across the ctrl.rodeo repository
// Keeps plans, architecture docs, UX docs, and bug tracking current
//
// POST /functions/v1/documentation-agent
// Body: { action: 'plan:audit' | 'plan:update' | 'arch:sync' | ... }
//
// Deployed to: Ops project (ycilriwjnmcelkspmfmg)
// See: .claude/agents/documentation-agent.md for full spec

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createLogger } from './logger.ts'
import { GitHubClient } from './github.ts'
import { Analyzer } from './analyzer.ts'
import { planAudit, planUpdate, planAdd, planRebalance } from './plan.ts'
import { archSync, archAudit, archAddAdr, archUpdateSpec } from './arch.ts'
import { cleanupStale, cleanupOrphans, cleanupDuplicates, cleanupArchive } from './cleanup.ts'
import { captureBug, captureWork, captureTechDebt } from './capture.ts'
import { uxUpdate, uxAudit, uxWireframe } from './ux.ts'
import { branchDiff, branchReconcile, branchCherryPickDocs } from './branch.ts'
import { pmScopeCheck, pmDependencyMap, pmStatusReport, pmRetro, pmDecisionLog, pmPrdToPlan, pmChangelog } from './pm.ts'
import type { DocAgentRequest, DocAgentResult, DocAgentAction } from './types.ts'

const log = createLogger('doc-agent')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ═══════════════════════════════════════════════════════════════
// ACTION ROUTER
// ═══════════════════════════════════════════════════════════════

type ActionHandler = (
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
) => Promise<DocAgentResult>

const HANDLERS: Record<DocAgentAction, ActionHandler> = {
  // Plan domain
  'plan:audit': planAudit,
  'plan:update': planUpdate,
  'plan:add': planAdd,
  'plan:rebalance': planRebalance,

  // Architecture domain
  'arch:sync': archSync,
  'arch:audit': archAudit,
  'arch:add-adr': archAddAdr,
  'arch:update-spec': archUpdateSpec,

  // Capture domain
  'capture:bug': captureBug,
  'capture:work': captureWork,
  'capture:tech-debt': captureTechDebt,

  // UX domain
  'ux:update': uxUpdate,
  'ux:audit': uxAudit,
  'ux:wireframe': uxWireframe,

  // Branch domain
  'branch:diff': branchDiff,
  'branch:reconcile': branchReconcile,
  'branch:cherry-pick-docs': branchCherryPickDocs,

  // Cleanup domain
  'cleanup:stale': cleanupStale,
  'cleanup:orphans': cleanupOrphans,
  'cleanup:duplicates': cleanupDuplicates,
  'cleanup:archive': cleanupArchive,

  // PM domain
  'pm:scope-check': pmScopeCheck,
  'pm:dependency-map': pmDependencyMap,
  'pm:status-report': pmStatusReport,
  'pm:retro': pmRetro,
  'pm:decision-log': pmDecisionLog,
  'pm:prd-to-plan': pmPrdToPlan,
  'pm:changelog': pmChangelog,
}

// ═══════════════════════════════════════════════════════════════
// PRODUCT SCOPING
// ═══════════════════════════════════════════════════════════════

// When a product scope is specified, the agent limits its operations
// to documentation and code related to that product only.
// This prevents cross-contamination between sub-products.
const PRODUCT_SCOPES: Record<string, {
  name: string
  docPaths: string[]
  codePaths: string[]
  relatedProducts: string[]
}> = {
  'boards': {
    name: 'Boards',
    docPaths: ['docs/strategy/prds/boards-mvp.md', 'docs/ux/boards/', 'docs/infrastructure/technical-design/client-architecture.md'],
    codePaths: ['boards/'],
    relatedProducts: ['ai-widgets', 'content-types', 'design-system'],
  },
  'ai-widgets': {
    name: 'AI Widgets',
    docPaths: ['docs/strategy/prds/ai-widgets.md', 'docs/strategy/prds/generative-widget-ecosystem.md', 'docs/ux/widgets/', 'docs/infrastructure/technical-design/ai-widget-system.md', 'docs/infrastructure/technical-design/widget-architecture.md'],
    codePaths: ['supabase/functions/generate-widget/', 'boards/js/widgets/'],
    relatedProducts: ['boards', 'design-system'],
  },
  'design-system': {
    name: 'Design System',
    docPaths: ['docs/strategy/prds/widget-design-system.md', 'design-system/README.md'],
    codePaths: ['design-system/'],
    relatedProducts: ['boards', 'ai-widgets', 'systemic'],
  },
  'notion-sync': {
    name: 'Notion Sync',
    docPaths: ['docs/strategy/prds/notion-sync-platform.md', 'docs/infrastructure/NOTION-SYNC-GUIDE.md', 'docs/infrastructure/technical-design/sync-protocol.md'],
    codePaths: ['supabase/functions/notion-sync/', 'supabase/functions/documentation-agent/'],
    relatedProducts: [],
  },
  'systemic': {
    name: 'Systemic',
    docPaths: ['docs/strategy/prds/design-system-validation-pipeline.md'],
    codePaths: ['systemic/'],
    relatedProducts: ['design-system'],
  },
  'soundscape': {
    name: 'Soundscape',
    docPaths: ['soundscape/PROJECT_PLAN.md'],
    codePaths: ['soundscape/'],
    relatedProducts: [],
  },
  'sharing': {
    name: 'Sharing & Collaboration',
    docPaths: ['docs/strategy/prds/collaborative-boards.md', 'docs/ux/boards/sharing.md', 'docs/infrastructure/technical-design/auth-system.md'],
    codePaths: ['boards/js/auth/', 'boards/js/sharing/'],
    relatedProducts: ['boards'],
  },
  'content-types': {
    name: 'Content Types',
    docPaths: ['docs/strategy/prds/content-type-and-image-systems.md', 'docs/ux/pins/content-types.md', 'docs/infrastructure/technical-design/content-type-system.md'],
    codePaths: ['boards/js/content-types/'],
    relatedProducts: ['boards'],
  },
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = Date.now()

  try {
    const request: DocAgentRequest = await req.json()

    // Validate action
    if (!request.action) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required field: action',
          availableActions: Object.keys(HANDLERS),
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    log.info(`Received action: ${request.action}`, {
      scope: request.scope,
      branch: request.branch,
      product: request.params?.product as string,
    })

    // Get handler
    const handler = HANDLERS[request.action]
    if (!handler) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unknown action: ${request.action}`,
          availableActions: Object.keys(HANDLERS),
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Initialize clients
    const githubToken = Deno.env.get('GITHUB_TOKEN')
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    const repository = Deno.env.get('GITHUB_REPOSITORY') || 'fikei/fikei.github.io'

    if (!githubToken) {
      return new Response(
        JSON.stringify({ success: false, error: 'GITHUB_TOKEN not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!anthropicKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const github = new GitHubClient(githubToken, repository)
    const analyzer = new Analyzer(anthropicKey)

    // Apply product scope if specified
    if (request.params?.product) {
      const product = request.params.product as string
      const scope = PRODUCT_SCOPES[product]
      if (scope) {
        log.info(`Scoping to product: ${scope.name}`, {
          docPaths: scope.docPaths.length,
          codePaths: scope.codePaths.length,
          relatedProducts: scope.relatedProducts,
        })
        // Pass scope info into the request for handlers to use
        request.params = {
          ...request.params,
          _productScope: scope,
        }
      } else {
        log.warn(`Unknown product scope: ${product}`, { available: Object.keys(PRODUCT_SCOPES) })
      }
    }

    // Execute handler
    const result = await handler(github, analyzer, request)

    // Add product I/O context to the report if scoped
    if (request.params?.product) {
      const product = request.params.product as string
      const scope = PRODUCT_SCOPES[product]
      if (scope && scope.relatedProducts.length > 0) {
        result.report += `\n\n### Related Products (I/O boundaries)\n`
        result.report += `This report is scoped to **${scope.name}**. Related products that may need attention:\n`
        for (const related of scope.relatedProducts) {
          const relatedScope = PRODUCT_SCOPES[related]
          if (relatedScope) {
            result.report += `- **${relatedScope.name}**: ${relatedScope.docPaths.length} docs, ${relatedScope.codePaths.length} code paths\n`
          }
        }
        result.report += `\nTo check related products, re-run with \`"product": "${scope.relatedProducts[0]}"\`\n`
      }
    }

    const endTime = Date.now()
    log.info(`Action completed: ${request.action}`, {
      success: result.success,
      durationMs: endTime - startTime,
      filesChanged: result.changes.length,
      errors: result.errors.length,
    })

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Handler error', { error: message })

    return new Response(
      JSON.stringify({
        success: false,
        error: message,
        action: 'unknown',
        report: '',
        changes: [],
        errors: [message],
        metrics: {
          startTime,
          endTime: Date.now(),
          durationMs: Date.now() - startTime,
          filesRead: 0,
          filesChanged: 0,
          apiCalls: 0,
        },
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
