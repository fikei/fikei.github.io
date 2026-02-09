// Documentation Agent - Cleanup Domain
// Functions: cleanup:stale, cleanup:orphans, cleanup:duplicates, cleanup:archive

import { createLogger } from './logger.ts'
import type { GitHubClient } from './github.ts'
import type { Analyzer } from './analyzer.ts'
import type { DocAgentRequest, DocAgentResult, FileChange, StaleDoc, StaleReport } from './types.ts'

const log = createLogger('cleanup')

// Directories containing documentation that should track code
const DOC_CODE_PAIRS: Array<{ doc: string; code: string[] }> = [
  { doc: 'docs/infrastructure/technical-design/', code: ['supabase/functions/', 'boards/js/', 'design-system/'] },
  { doc: 'docs/ux/', code: ['boards/', 'boards/index.html'] },
  { doc: 'docs/execution/project-plan/', code: ['boards/', 'supabase/', 'design-system/'] },
]

// ═══════════════════════════════════════════════════════════════
// CLEANUP:STALE
// ═══════════════════════════════════════════════════════════════

export async function cleanupStale(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  const thresholdDays = (request.params?.threshold_days as number) || 30
  log.info('Starting stale check', { thresholdDays })

  // 1. Gather all documentation files
  const techDesignFiles = await github.getDirectory('docs/infrastructure/technical-design')
  const uxFiles = await github.getDirectory('docs/ux')
  const planFiles = await github.getDirectory('docs/execution/project-plan')

  const allDocFiles = [...techDesignFiles, ...uxFiles, ...planFiles]
    .filter((f) => f.endsWith('.md'))

  log.info(`Found ${allDocFiles.length} doc files to check`)

  // 2. For each doc file, compare last doc update vs last code update
  const staleResults: StaleDoc[] = []
  let healthyCount = 0

  for (const docFile of allDocFiles) {
    const docLastUpdate = await github.getLastCommitDate(docFile)
    if (!docLastUpdate) continue

    // Find related code directories
    const relatedCode = DOC_CODE_PAIRS
      .filter((pair) => docFile.startsWith(pair.doc))
      .flatMap((pair) => pair.code)

    if (relatedCode.length === 0) {
      healthyCount++
      continue
    }

    // Get most recent code change across related directories
    let latestCodeChange: string | null = null
    let codeCommitCount = 0

    for (const codeDir of relatedCode) {
      const commits = await github.getCommits({
        path: codeDir,
        since: docLastUpdate,
        limit: 50,
      })
      codeCommitCount += commits.length
      if (commits.length > 0 && (!latestCodeChange || commits[0].date > latestCodeChange)) {
        latestCodeChange = commits[0].date
      }
    }

    if (latestCodeChange) {
      const docDate = new Date(docLastUpdate)
      const codeDate = new Date(latestCodeChange)
      const gapDays = Math.floor((codeDate.getTime() - docDate.getTime()) / (1000 * 60 * 60 * 24))

      if (gapDays > thresholdDays) {
        const severity = gapDays > 60 ? 'critical' : gapDays > thresholdDays ? 'moderate' : 'healthy'
        staleResults.push({
          file: docFile,
          lastDocUpdate: docLastUpdate.split('T')[0],
          lastCodeChange: latestCodeChange.split('T')[0],
          gapDays,
          codeCommits: codeCommitCount,
          severity,
        })
      } else {
        healthyCount++
      }
    } else {
      healthyCount++
    }

    // Rate limit protection
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  // Sort by staleness severity
  staleResults.sort((a, b) => b.gapDays - a.gapDays)

  // 3. Generate report
  const critical = staleResults.filter((s) => s.severity === 'critical')
  const moderate = staleResults.filter((s) => s.severity === 'moderate')

  const staleReport: StaleReport = {
    critical,
    moderate,
    healthy: healthyCount,
    totalDocs: allDocFiles.length,
  }

  let report = `## Stale Documentation Report — ${new Date().toISOString().split('T')[0]}\n\n`

  report += `### Summary\n`
  report += `- Total docs checked: ${staleReport.totalDocs}\n`
  report += `- Healthy (up to date): ${staleReport.healthy}\n`
  report += `- Moderate (${thresholdDays}–60 days behind): ${staleReport.moderate.length}\n`
  report += `- Critical (60+ days behind): ${staleReport.critical.length}\n\n`

  if (critical.length > 0) {
    report += `### Critical (code changed significantly, doc very outdated)\n`
    report += `| Doc | Last Updated | Code Last Changed | Gap |\n`
    report += `|-----|-------------|-------------------|-----|\n`
    for (const s of critical) {
      report += `| \`${s.file.split('/').pop()}\` | ${s.lastDocUpdate} | ${s.lastCodeChange} | ${s.gapDays} days, ${s.codeCommits} commits |\n`
    }
    report += '\n'
  }

  if (moderate.length > 0) {
    report += `### Moderate (minor code changes, doc slightly behind)\n`
    report += `| Doc | Last Updated | Code Last Changed | Gap |\n`
    report += `|-----|-------------|-------------------|-----|\n`
    for (const s of moderate) {
      report += `| \`${s.file.split('/').pop()}\` | ${s.lastDocUpdate} | ${s.lastCodeChange} | ${s.gapDays} days, ${s.codeCommits} commits |\n`
    }
    report += '\n'
  }

  if (critical.length === 0 && moderate.length === 0) {
    report += `### ✅ All Clear\nAll ${healthyCount} documentation files are up to date.\n`
  }

  report += `\n### Recommended Actions\n`
  if (critical.length > 0) {
    report += `1. Prioritize updating ${critical.length} critically stale docs\n`
    report += `2. Run \`arch:sync\` to auto-update architecture docs\n`
  }
  if (moderate.length > 0) {
    report += `3. Review ${moderate.length} moderately stale docs during next sprint\n`
  }
  report += `4. Run \`cleanup:orphans\` to check for dead references\n`

  for (const s of staleResults) {
    changes.push({
      file: s.file,
      type: 'updated',
      summary: `${s.gapDays} days stale (${s.codeCommits} code commits since last doc update)`,
    })
  }

  const endTime = Date.now()

  return {
    success: true,
    action: 'cleanup:stale',
    report,
    changes,
    errors,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      filesRead: allDocFiles.length,
      filesChanged: 0,
      apiCalls: github.apiCalls,
    },
    nextActions: [
      critical.length > 0 ? '`arch:sync` to update stale architecture docs' : '',
      '`cleanup:orphans` to check for dead references',
      '`ux:audit` to check UX doc coverage',
    ].filter(Boolean),
  }
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP:ORPHANS
// ═══════════════════════════════════════════════════════════════

export async function cleanupOrphans(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  log.info('Starting orphan detection')

  // 1. Read all doc files for cross-references
  const techDesignFiles = await github.getDirectory('docs/infrastructure/technical-design')
  const allDocFiles = [...techDesignFiles].filter((f) => f.endsWith('.md'))

  const deadRefs: Array<{ doc: string; reference: string; status: string }> = []
  const brokenLinks: Array<{ source: string; target: string; issue: string }> = []

  for (const docPath of allDocFiles) {
    const file = await github.getFile(docPath)
    if (!file) continue

    // Extract file path references from doc content
    const pathRefs = file.content.match(/`([a-zA-Z][\w/.-]+\.(ts|js|html|css|json))`/g)
    if (pathRefs) {
      for (const ref of pathRefs) {
        const cleanRef = ref.replace(/`/g, '')
        const exists = await github.getFile(cleanRef)
        if (!exists) {
          deadRefs.push({
            doc: docPath,
            reference: cleanRef,
            status: 'File not found',
          })
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }

    // Check internal markdown links
    const linkRefs = file.content.match(/\[([^\]]+)\]\(([^)]+)\)/g)
    if (linkRefs) {
      for (const link of linkRefs) {
        const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/)
        if (match) {
          const target = match[2]
          // Only check relative links (not http/https)
          if (!target.startsWith('http') && !target.startsWith('#')) {
            // Resolve relative path
            const docDir = docPath.substring(0, docPath.lastIndexOf('/'))
            const resolvedPath = target.startsWith('/')
              ? target.substring(1)
              : `${docDir}/${target}`.replace(/[^/]+\/\.\.\//g, '')

            const exists = await github.getFile(resolvedPath.split('#')[0])
            if (!exists) {
              brokenLinks.push({
                source: docPath,
                target: resolvedPath,
                issue: 'Target file not found',
              })
            }
          }
        }
      }
    }
  }

  // 2. Generate report
  let report = `## Orphan Report — ${new Date().toISOString().split('T')[0]}\n\n`

  if (deadRefs.length > 0) {
    report += `### Dead References in Docs (doc points to code that doesn't exist)\n`
    report += `| Doc | References | Status |\n`
    report += `|-----|-----------|--------|\n`
    for (const ref of deadRefs) {
      report += `| \`${ref.doc.split('/').pop()}\` | \`${ref.reference}\` | ${ref.status} |\n`
    }
    report += '\n'
  }

  if (brokenLinks.length > 0) {
    report += `### Broken Internal Links\n`
    report += `| Source Doc | Link Target | Issue |\n`
    report += `|-----------|-------------|-------|\n`
    for (const link of brokenLinks) {
      report += `| \`${link.source.split('/').pop()}\` | \`${link.target}\` | ${link.issue} |\n`
    }
    report += '\n'
  }

  if (deadRefs.length === 0 && brokenLinks.length === 0) {
    report += `### ✅ All Clear\nNo orphaned references or broken links found.\n`
  }

  report += `\n### Recommended Actions\n`
  if (deadRefs.length > 0) {
    report += `1. Update or remove ${deadRefs.length} dead code references\n`
  }
  if (brokenLinks.length > 0) {
    report += `2. Fix ${brokenLinks.length} broken internal links\n`
  }
  report += `3. Run \`cleanup:archive\` to archive truly dead docs\n`

  const endTime = Date.now()

  return {
    success: true,
    action: 'cleanup:orphans',
    report,
    changes,
    errors,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      filesRead: allDocFiles.length * 2,
      filesChanged: 0,
      apiCalls: github.apiCalls,
    },
    nextActions: ['`cleanup:archive` for dead docs', '`cleanup:duplicates` to check for contradictions'],
  }
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP:DUPLICATES
// ═══════════════════════════════════════════════════════════════

export async function cleanupDuplicates(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const errors: string[] = []

  log.info('Checking for duplicate content')

  // Read all tech design docs — most likely source of duplicates
  const techFiles = await github.getDirectory('docs/infrastructure/technical-design')
  const mdFiles = techFiles.filter((f) => f.endsWith('.md'))

  // Extract key facts from each doc (headers, config values, endpoints)
  const docFacts: Record<string, string[]> = {}

  for (const filePath of mdFiles) {
    const file = await github.getFile(filePath)
    if (!file) continue

    // Extract facts: headers, quoted values, URLs, config keys
    const facts: string[] = []
    const lines = file.content.split('\n')
    for (const line of lines) {
      // Config values like key = value
      const configMatch = line.match(/`([A-Z_]+)`\s*[:=]\s*`?([^`\n]+)/)
      if (configMatch) facts.push(`${configMatch[1]}=${configMatch[2].trim()}`)

      // API endpoints
      const endpointMatch = line.match(/(GET|POST|PUT|DELETE|PATCH)\s+([/\w-]+)/)
      if (endpointMatch) facts.push(`${endpointMatch[1]} ${endpointMatch[2]}`)

      // Table names
      const tableMatch = line.match(/`(\w+)`\s+table/)
      if (tableMatch) facts.push(`table:${tableMatch[1]}`)
    }

    docFacts[filePath] = facts
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  // Compare facts across documents
  const contradictions: Array<{ fact: string; docA: string; docB: string; valueA: string; valueB: string }> = []
  const redundant: Array<{ fact: string; docs: string[] }> = []

  const allFacts = new Map<string, Array<{ doc: string; value: string }>>()

  for (const [doc, facts] of Object.entries(docFacts)) {
    for (const fact of facts) {
      const key = fact.split('=')[0]
      if (!allFacts.has(key)) allFacts.set(key, [])
      allFacts.get(key)!.push({ doc, value: fact })
    }
  }

  for (const [key, occurrences] of allFacts) {
    if (occurrences.length > 1) {
      const values = new Set(occurrences.map((o) => o.value))
      if (values.size > 1) {
        contradictions.push({
          fact: key,
          docA: occurrences[0].doc,
          docB: occurrences[1].doc,
          valueA: occurrences[0].value,
          valueB: occurrences[1].value,
        })
      } else {
        redundant.push({ fact: key, docs: occurrences.map((o) => o.doc) })
      }
    }
  }

  let report = `## Duplicate Content Report — ${new Date().toISOString().split('T')[0]}\n\n`

  if (contradictions.length > 0) {
    report += `### Contradictions (same fact, different values)\n`
    report += `| Fact | Doc A Says | Doc B Says |\n`
    report += `|------|-----------|------------|\n`
    for (const c of contradictions.slice(0, 15)) {
      report += `| ${c.fact} | \`${c.docA.split('/').pop()}\`: ${c.valueA} | \`${c.docB.split('/').pop()}\`: ${c.valueB} |\n`
    }
    report += '\n'
  }

  if (redundant.length > 0) {
    report += `### Redundant (same fact, multiple locations)\n`
    for (const r of redundant.slice(0, 10)) {
      report += `- **${r.fact}** appears in: ${r.docs.map((d) => '`' + d.split('/').pop() + '`').join(', ')}\n`
    }
    report += '\n'
  }

  if (contradictions.length === 0 && redundant.length === 0) {
    report += `### ✅ All Clear\nNo contradictions or significant redundancy found.\n`
  }

  report += `\n### Recommended Actions\n`
  if (contradictions.length > 0) report += `1. Resolve ${contradictions.length} contradictions\n`
  if (redundant.length > 0) report += `2. Consider consolidating ${redundant.length} redundant facts\n`
  report += `3. Run \`cleanup:archive\` to archive deprecated docs\n`

  const endTime = Date.now()
  return {
    success: true, action: 'cleanup:duplicates', report, changes: [], errors,
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: mdFiles.length, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: ['`cleanup:archive`'],
  }
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP:ARCHIVE
// ═══════════════════════════════════════════════════════════════

export async function cleanupArchive(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const autoDetect = (request.params?.auto as boolean) !== false

  log.info('Checking for archive candidates', { autoDetect })

  const archiveCandidates: Array<{ file: string; reason: string; lastUpdate: string }> = []

  // Check for docs with no updates in 90+ days
  const allDocDirs = ['docs/infrastructure/technical-design', 'docs/strategy/prds', 'docs/ux']

  for (const dir of allDocDirs) {
    const files = await github.getDirectory(dir)
    for (const filePath of files.filter((f) => f.endsWith('.md'))) {
      const lastUpdate = await github.getLastCommitDate(filePath)
      if (lastUpdate) {
        const daysAgo = Math.floor((Date.now() - new Date(lastUpdate).getTime()) / (1000 * 60 * 60 * 24))
        if (daysAgo > 90) {
          archiveCandidates.push({
            file: filePath,
            reason: `Not updated in ${daysAgo} days`,
            lastUpdate: lastUpdate.split('T')[0],
          })
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  let report = `## Archive Candidates — ${new Date().toISOString().split('T')[0]}\n\n`

  if (archiveCandidates.length > 0) {
    report += `### Candidates (90+ days without update)\n`
    report += `| File | Last Updated | Days Ago | Reason |\n`
    report += `|------|-------------|----------|--------|\n`
    for (const c of archiveCandidates) {
      const daysAgo = Math.floor((Date.now() - new Date(c.lastUpdate).getTime()) / (1000 * 60 * 60 * 24))
      report += `| \`${c.file.split('/').pop()}\` | ${c.lastUpdate} | ${daysAgo} | ${c.reason} |\n`
    }
    report += '\n'
  } else {
    report += `### ✅ No archive candidates\nAll docs have been updated within the last 90 days.\n`
  }

  report += `\n### Recommended Actions\n`
  if (archiveCandidates.length > 0) {
    report += `1. Review ${archiveCandidates.length} candidates — are they still relevant?\n`
    report += `2. Move deprecated docs to \`archive/\` with \`git mv\`\n`
    report += `3. Update \`notion-structure.json\` to remove archived pages\n`
  }

  const endTime = Date.now()
  return {
    success: true, action: 'cleanup:archive', report,
    changes: archiveCandidates.map((c) => ({ file: c.file, type: 'updated' as const, summary: c.reason })),
    errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: archiveCandidates.length, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: archiveCandidates.length > 0 ? ['Move candidates to archive/ directory'] : [],
  }
}
