// Documentation Agent - Branch Domain
// Functions: branch:diff, branch:reconcile, branch:cherry-pick-docs

import { createLogger } from './logger.ts'
import type { GitHubClient } from './github.ts'
import type { Analyzer } from './analyzer.ts'
import type { DocAgentRequest, DocAgentResult, FileChange } from './types.ts'

const log = createLogger('branch')

// ═══════════════════════════════════════════════════════════════
// BRANCH:DIFF
// ═══════════════════════════════════════════════════════════════

export async function branchDiff(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  const base = (request.params?.base as string) || 'master'
  const compare = request.branch || (request.params?.compare as string) || ''

  if (!compare) {
    return {
      success: false, action: 'branch:diff',
      report: '## Error\n\nMissing required: `branch` or `params.compare`',
      changes: [], errors: ['compare branch is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  log.info('Diffing branches', { base, compare })

  let comparison
  try {
    comparison = await github.compareBranches(base, compare)
  } catch (e) {
    return {
      success: false, action: 'branch:diff',
      report: `## Error\n\nCould not compare \`${base}\` and \`${compare}\`: ${e}`,
      changes: [], errors: [String(e)],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  // Categorize files by type
  const docFiles = comparison.files.filter((f) =>
    f.filename.startsWith('docs/') || f.filename.endsWith('.md')
  )
  const codeFiles = comparison.files.filter((f) =>
    !f.filename.startsWith('docs/') && !f.filename.endsWith('.md')
  )

  // Categorize doc changes by domain
  const planChanges = docFiles.filter((f) => f.filename.includes('project-plan') || f.filename.includes('BUGS'))
  const archChanges = docFiles.filter((f) => f.filename.includes('technical-design') || f.filename.includes('infrastructure'))
  const uxChanges = docFiles.filter((f) => f.filename.includes('ux/'))
  const otherDocChanges = docFiles.filter((f) =>
    !planChanges.includes(f) && !archChanges.includes(f) && !uxChanges.includes(f)
  )

  let report = `## Documentation Diff — \`${base}\` vs \`${compare}\`\n\n`
  report += `**Total commits**: ${comparison.totalCommits}\n`
  report += `**Total files changed**: ${comparison.files.length} (${docFiles.length} docs, ${codeFiles.length} code)\n\n`

  if (docFiles.length > 0) {
    report += `### Doc Changes on \`${compare}\`\n`
    report += `| File | Type | Status |\n`
    report += `|------|------|--------|\n`
    for (const f of docFiles) {
      const domain = f.filename.includes('project-plan') ? 'Plan'
        : f.filename.includes('technical-design') ? 'Arch'
        : f.filename.includes('ux/') ? 'UX'
        : 'Other'
      report += `| \`${f.filename.split('/').pop()}\` | ${domain} | ${f.status} |\n`
      changes.push({ file: f.filename, type: f.status === 'added' ? 'created' : 'updated', summary: f.status })
    }
    report += '\n'
  }

  // Check for missing doc updates (code changed, docs didn't)
  const codeOnlyDirs = new Set<string>()
  for (const f of codeFiles) {
    const dir = f.filename.split('/').slice(0, 2).join('/')
    codeOnlyDirs.add(dir)
  }

  const docDirsChanged = new Set(docFiles.map((f) => f.filename.split('/').slice(0, 2).join('/')))

  const missingDocUpdates: string[] = []
  if (codeOnlyDirs.has('supabase/functions') && !docDirsChanged.has('docs/infrastructure')) {
    missingDocUpdates.push('Edge functions changed but no architecture doc updates')
  }
  if (codeOnlyDirs.has('boards/js') && !docDirsChanged.has('docs/ux')) {
    missingDocUpdates.push('Board UI code changed but no UX doc updates')
  }
  if (codeOnlyDirs.has('design-system') && !docDirsChanged.has('design-system')) {
    missingDocUpdates.push('Design system changed but README not updated')
  }

  if (missingDocUpdates.length > 0) {
    report += `### ⚠️ Missing Doc Updates (code changed, docs didn't)\n`
    for (const m of missingDocUpdates) {
      report += `- ${m}\n`
    }
    report += '\n'
  }

  report += `### Recommended Actions\n`
  if (missingDocUpdates.length > 0) {
    report += `1. Update ${missingDocUpdates.length} missing doc areas\n`
    report += `2. Run \`arch:sync\` and \`ux:update\` to address gaps\n`
  }
  if (docFiles.length > 0) {
    report += `3. Review ${docFiles.length} doc changes before merge\n`
  }

  const endTime = Date.now()
  return {
    success: true, action: 'branch:diff', report, changes, errors,
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: missingDocUpdates.length > 0
      ? ['`arch:sync`', '`ux:update`']
      : ['`plan:update` to mark tasks complete'],
  }
}

// ═══════════════════════════════════════════════════════════════
// BRANCH:RECONCILE
// ═══════════════════════════════════════════════════════════════

export async function branchReconcile(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const source = request.branch || (request.params?.source as string) || ''
  const target = (request.params?.target as string) || 'master'

  if (!source) {
    return {
      success: false, action: 'branch:reconcile',
      report: '## Error\n\nMissing required: `branch` or `params.source`',
      changes: [], errors: ['source branch is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  log.info('Reconciling branches', { source, target })

  let comparison
  try {
    comparison = await github.compareBranches(target, source)
  } catch (e) {
    return {
      success: false, action: 'branch:reconcile',
      report: `## Error\n\nCould not compare branches: ${e}`,
      changes: [], errors: [String(e)],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  const docFiles = comparison.files.filter((f) =>
    f.filename.startsWith('docs/') || f.filename.endsWith('.md')
  )

  // Check for conflicting doc changes
  let reverseComparison
  try {
    reverseComparison = await github.compareBranches(source, target)
  } catch {
    reverseComparison = null
  }

  const targetDocFiles = reverseComparison
    ? reverseComparison.files.filter((f) => f.filename.startsWith('docs/') || f.filename.endsWith('.md'))
    : []

  const conflicts: string[] = []
  const autoMergeable: string[] = []

  for (const sf of docFiles) {
    const conflict = targetDocFiles.find((tf) => tf.filename === sf.filename)
    if (conflict) {
      conflicts.push(sf.filename)
    } else {
      autoMergeable.push(sf.filename)
    }
  }

  let report = `## Branch Reconciliation — \`${source}\` → \`${target}\`\n\n`
  report += `**Doc files to merge**: ${docFiles.length}\n`
  report += `**Auto-mergeable**: ${autoMergeable.length}\n`
  report += `**Potential conflicts**: ${conflicts.length}\n\n`

  if (autoMergeable.length > 0) {
    report += `### Auto-Mergeable\n`
    for (const f of autoMergeable) {
      report += `- ✅ \`${f.split('/').pop()}\`\n`
    }
    report += '\n'
  }

  if (conflicts.length > 0) {
    report += `### Potential Conflicts (both branches modified)\n`
    for (const f of conflicts) {
      report += `- ⚠️ \`${f.split('/').pop()}\` — edited on both branches\n`
    }
    report += '\n'
  }

  report += `### Recommended Actions\n`
  report += `1. Merge auto-mergeable files\n`
  if (conflicts.length > 0) {
    report += `2. Manually resolve ${conflicts.length} conflicts\n`
  }
  report += `3. Run \`plan:audit\` after reconciliation to verify consistency\n`

  const endTime = Date.now()
  return {
    success: true, action: 'branch:reconcile', report,
    changes: autoMergeable.map((f) => ({ file: f, type: 'updated' as const, summary: 'auto-mergeable' })),
    errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: ['`plan:audit` after merge'],
  }
}

// ═══════════════════════════════════════════════════════════════
// BRANCH:CHERRY-PICK-DOCS
// ═══════════════════════════════════════════════════════════════

export async function branchCherryPickDocs(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const source = request.branch || (request.params?.source as string) || ''
  const target = (request.params?.target as string) || 'master'
  const domain = (request.params?.domain as string) || ''

  if (!source) {
    return {
      success: false, action: 'branch:cherry-pick-docs',
      report: '## Error\n\nMissing required: `branch` or `params.source`',
      changes: [], errors: ['source branch is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  log.info('Cherry-picking docs', { source, target, domain })

  let comparison
  try {
    comparison = await github.compareBranches(target, source)
  } catch (e) {
    return {
      success: false, action: 'branch:cherry-pick-docs',
      report: `## Error\n\nCould not compare branches: ${e}`,
      changes: [], errors: [String(e)],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  let docFiles = comparison.files.filter((f) =>
    f.filename.startsWith('docs/') || f.filename.endsWith('.md')
  )

  // Filter by domain if specified
  if (domain) {
    const domainPaths: Record<string, string> = {
      plans: 'project-plan',
      arch: 'technical-design',
      ux: 'ux/',
      bugs: 'BUGS',
    }
    const pathFilter = domainPaths[domain]
    if (pathFilter) {
      docFiles = docFiles.filter((f) => f.filename.includes(pathFilter))
    }
  }

  let report = `## Cherry-Pick Docs — \`${source}\` → \`${target}\`\n\n`
  report += `**Files to cherry-pick**: ${docFiles.length}\n`
  if (domain) report += `**Domain filter**: ${domain}\n`
  report += '\n'

  if (docFiles.length > 0) {
    report += `### Files\n`
    for (const f of docFiles) {
      report += `- \`${f.filename}\` (${f.status})\n`
    }
  } else {
    report += `### No doc files to cherry-pick\n`
    report += `\`${source}\` has no doc changes ahead of \`${target}\`${domain ? ` in the ${domain} domain` : ''}.\n`
  }

  report += `\n### Recommended Actions\n`
  if (docFiles.length > 0) {
    report += `1. Review the ${docFiles.length} files above\n`
    report += `2. Cherry-pick via git or merge the branch\n`
    report += `3. Run \`cleanup:orphans\` after cherry-pick to verify no broken refs\n`
  }

  const endTime = Date.now()
  return {
    success: true, action: 'branch:cherry-pick-docs', report,
    changes: docFiles.map((f) => ({ file: f.filename, type: 'updated' as const, summary: `cherry-pick candidate (${f.status})` })),
    errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: docFiles.length > 0 ? ['`cleanup:orphans` after cherry-pick'] : [],
  }
}
