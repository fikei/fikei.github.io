// Documentation Agent - Architecture Domain
// Functions: arch:sync, arch:audit

import { createLogger } from './logger.ts'
import type { GitHubClient } from './github.ts'
import type { Analyzer } from './analyzer.ts'
import type { DocAgentRequest, DocAgentResult, FileChange, ArchDocChange, ArchGap } from './types.ts'
import { SUB_PRODUCTS } from './types.ts'

const log = createLogger('arch')

// Map of tech spec files to their related code directories
const SPEC_CODE_MAP: Record<string, string[]> = {
  'docs/infrastructure/technical-design/ai-widget-system.md': [
    'supabase/functions/generate-widget/',
    'boards/js/widgets/',
  ],
  'docs/infrastructure/technical-design/client-architecture.md': [
    'boards/js/',
    'boards/index.html',
  ],
  'docs/infrastructure/technical-design/content-type-system.md': [
    'boards/js/content-types/',
  ],
  'docs/infrastructure/technical-design/widget-architecture.md': [
    'supabase/functions/generate-widget/config/',
    'boards/js/widgets/',
  ],
  'docs/infrastructure/technical-design/auth-system.md': [
    'boards/js/auth/',
  ],
  'docs/infrastructure/technical-design/sync-protocol.md': [
    'supabase/functions/notion-sync/',
    'supabase/functions/documentation-agent/',
  ],
}

// ═══════════════════════════════════════════════════════════════
// ARCH:SYNC
// ═══════════════════════════════════════════════════════════════

export async function archSync(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  const since = request.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  log.info('Starting arch sync', { since })

  // 1. Get recent commits
  const commits = await github.getCommits({ since, limit: 50 })
  if (commits.length === 0) {
    return {
      success: true,
      action: 'arch:sync',
      report: '## Architecture Sync Report\n\nNo commits found in the specified range. All docs are current.',
      changes: [],
      errors: [],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  // 2. Collect all changed files from commits
  const allChangedFiles = new Set<string>()
  for (const commit of commits) {
    if (commit.files.length === 0) {
      // Need to fetch individual commit for file list
      try {
        const files = await github.getCommitFiles(commit.sha)
        files.forEach((f) => allChangedFiles.add(f))
      } catch {
        // Skip commits we can't inspect
      }
    } else {
      commit.files.forEach((f) => allChangedFiles.add(f))
    }
  }

  log.info(`${allChangedFiles.size} files changed across ${commits.length} commits`)

  // 3. Map changed code files to their tech spec docs
  const docsUpdated: ArchDocChange[] = []
  const docsCurrent: string[] = []
  const gapsFound: ArchGap[] = []
  const affectedDocs = new Map<string, string[]>()

  for (const [specPath, codeDirs] of Object.entries(SPEC_CODE_MAP)) {
    const relevantChanges = [...allChangedFiles].filter((f) =>
      codeDirs.some((dir) => f.startsWith(dir))
    )

    if (relevantChanges.length > 0) {
      affectedDocs.set(specPath, relevantChanges)
    }
  }

  // 4. For each affected doc, analyze if it needs updating
  for (const [specPath, changedFiles] of affectedDocs) {
    const specFile = await github.getFile(specPath)
    if (!specFile) {
      errors.push(`Could not read ${specPath}`)
      continue
    }

    // Check last update of the spec vs the code changes
    const specLastUpdate = await github.getLastCommitDate(specPath)
    const codeLastUpdate = changedFiles[0] ? await github.getLastCommitDate(changedFiles[0]) : null

    if (specLastUpdate && codeLastUpdate) {
      const specDate = new Date(specLastUpdate)
      const codeDate = new Date(codeLastUpdate)

      if (codeDate > specDate) {
        docsUpdated.push({
          doc: specPath,
          section: 'Multiple',
          whatChanged: `${changedFiles.length} code files changed since doc was last updated`,
        })

        changes.push({
          file: specPath,
          type: 'updated',
          summary: `Code changed in ${changedFiles.length} files since last doc update`,
        })
      } else {
        docsCurrent.push(specPath)
      }
    }
  }

  // 5. Check for code with no corresponding doc
  const documentedDirs = new Set(
    Object.values(SPEC_CODE_MAP).flat()
  )

  for (const file of allChangedFiles) {
    const isDocumented = [...documentedDirs].some((dir) => file.startsWith(dir))
    const isDoc = file.startsWith('docs/') || file.endsWith('.md')
    const isConfig = file.includes('.json') || file.includes('.yml') || file.includes('.yaml')

    if (!isDocumented && !isDoc && !isConfig && file.includes('/')) {
      // Find which sub-product this might belong to
      const subProduct = SUB_PRODUCTS.find((sp) =>
        sp.codePatterns.some((p) => file.startsWith(p))
      )

      if (subProduct && subProduct.techSpecs.length > 0) {
        gapsFound.push({
          code: file,
          suggestedDoc: subProduct.techSpecs[0],
          reason: `Part of ${subProduct.name} sub-product`,
        })
      }
    }
  }

  // 6. Generate report
  const date = new Date().toISOString().split('T')[0]
  let report = `## Architecture Sync Report — ${date}\n\n`

  if (docsUpdated.length > 0) {
    report += `### Docs Needing Update\n`
    report += `| Doc | What Changed |\n`
    report += `|-----|------------|\n`
    for (const d of docsUpdated) {
      report += `| \`${d.doc.split('/').pop()}\` | ${d.whatChanged} |\n`
    }
    report += '\n'
  }

  if (docsCurrent.length > 0) {
    report += `### Docs Still Current (no changes needed)\n`
    for (const d of docsCurrent) {
      report += `- \`${d.split('/').pop()}\` — up to date\n`
    }
    report += '\n'
  }

  if (gapsFound.length > 0) {
    report += `### Gaps Found (code with no doc coverage)\n`
    report += `| Code | Suggested Doc |\n`
    report += `|------|---------------|\n`
    for (const g of gapsFound.slice(0, 10)) {
      report += `| \`${g.code}\` | \`${g.suggestedDoc}\` |\n`
    }
    if (gapsFound.length > 10) {
      report += `| ... | ${gapsFound.length - 10} more gaps |\n`
    }
    report += '\n'
  }

  if (docsUpdated.length === 0 && gapsFound.length === 0) {
    report += `### ✅ All Clear\nArchitecture docs are current with code.\n`
  }

  report += `\n### Recommended Actions\n`
  if (docsUpdated.length > 0) {
    report += `1. Update ${docsUpdated.length} stale architecture docs\n`
  }
  if (gapsFound.length > 0) {
    report += `2. Add documentation coverage for ${gapsFound.length} undocumented code areas\n`
  }
  report += `3. Run \`ux:audit\` to check if UX docs need matching updates\n`

  const endTime = Date.now()

  return {
    success: true,
    action: 'arch:sync',
    report,
    changes,
    errors,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      filesRead: affectedDocs.size + commits.length,
      filesChanged: changes.length,
      apiCalls: github.apiCalls + analyzer.apiCalls,
    },
    nextActions: [
      docsUpdated.length > 0 ? '`arch:audit` for deep analysis of stale docs' : '',
      '`ux:audit` to check UX doc coverage',
      '`cleanup:stale` for full staleness report',
    ].filter(Boolean),
  }
}

// ═══════════════════════════════════════════════════════════════
// ARCH:AUDIT
// ═══════════════════════════════════════════════════════════════

export async function archAudit(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  const targetDoc = request.doc || 'all'
  log.info('Starting arch audit', { doc: targetDoc })

  // Get tech spec files to audit
  const specPaths = targetDoc === 'all'
    ? Object.keys(SPEC_CODE_MAP)
    : [targetDoc]

  let totalVerified = 0
  let totalContradictions = 0
  let totalUnverifiable = 0

  let report = `## Architecture Audit — ${new Date().toISOString().split('T')[0]}\n\n`

  for (const specPath of specPaths) {
    const specFile = await github.getFile(specPath)
    if (!specFile) {
      errors.push(`Could not read ${specPath}`)
      continue
    }

    const codeDirs = SPEC_CODE_MAP[specPath] || []
    if (codeDirs.length === 0) continue

    // Read sample code files for comparison
    let codeContent = ''
    for (const dir of codeDirs) {
      const files = await github.getDirectory(dir)
      for (const f of files.slice(0, 3)) {
        const file = await github.getFile(f)
        if (file) {
          codeContent += `\n// FILE: ${f}\n${file.content.slice(0, 2000)}\n`
        }
      }
    }

    if (codeContent.length === 0) continue

    // Use Claude to compare doc claims vs code reality
    const analysis = await analyzer.compareDocToCode(
      specFile.content,
      codeContent,
      specPath
    )

    if (analysis.stale) {
      totalContradictions += analysis.changes.length
      report += `### ${specPath.split('/').pop()}\n`
      report += `**Status**: Needs update\n`
      for (const change of analysis.changes) {
        report += `- ⚠️ ${change}\n`
      }
      for (const suggestion of analysis.suggestions) {
        report += `- 💡 ${suggestion}\n`
      }
      report += '\n'
    } else {
      totalVerified++
      report += `### ${specPath.split('/').pop()}\n`
      report += `**Status**: ✅ Current\n\n`
    }
  }

  report = `## Architecture Audit — ${new Date().toISOString().split('T')[0]}\n\n`
    + `### Summary\n`
    + `- Docs verified: ${totalVerified}/${specPaths.length}\n`
    + `- Contradictions found: ${totalContradictions}\n`
    + `- Unverifiable claims: ${totalUnverifiable}\n\n`
    + report

  const endTime = Date.now()

  return {
    success: true,
    action: 'arch:audit',
    report,
    changes,
    errors,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      filesRead: specPaths.length * 4,
      filesChanged: 0,
      apiCalls: github.apiCalls + analyzer.apiCalls,
    },
    nextActions: [
      totalContradictions > 0 ? '`arch:update-spec` to fix contradictions' : '',
      '`plan:audit` to verify plan matches architecture state',
    ].filter(Boolean),
  }
}
