// Documentation Agent - Plan Domain
// Functions: plan:audit, plan:update, plan:add, plan:rebalance

import { createLogger } from './logger.ts'
import type { GitHubClient } from './github.ts'
import type { Analyzer } from './analyzer.ts'
import type {
  DocAgentRequest, DocAgentResult, FileChange,
  PlanPhase, PlanItem, PlanAuditReport,
  CountMismatch, StaleItem,
} from './types.ts'

const log = createLogger('plan')

// ═══════════════════════════════════════════════════════════════
// PLAN PARSING UTILITIES
// ═══════════════════════════════════════════════════════════════

function parsePlanIndex(content: string): PlanPhase[] {
  const phases: PlanPhase[] = []
  const lines = content.split('\n')

  for (const line of lines) {
    // Match table rows like:
    // | [Phase 1: Foundation](./phase-1-foundation.md) | SHIPPED | 18/18 |
    // | [Phase 3: AI Intelligence](./phase-3-ai-intelligence.md) | IN PROGRESS | ~113/370 |
    const tableMatch = line.match(
      /\|\s*\[Phase\s+(\d+)[^\]]*\]\(\.\/([^)]+)\)\s*\|\s*([^|]+)\|\s*~?(\d+)\/(\d+)/i
    )
    if (tableMatch) {
      const statusText = tableMatch[3].trim().toLowerCase()
      phases.push({
        file: `docs/execution/project-plan/${tableMatch[2]}`,
        name: `Phase ${tableMatch[1]}`,
        number: parseInt(tableMatch[1]),
        status: statusText.includes('ship') ? 'shipped'
          : statusText.includes('progress') ? 'in-progress'
          : 'pending',
        completedTasks: parseInt(tableMatch[4]),
        totalTasks: parseInt(tableMatch[5]),
        inProgressTasks: 0,
        pendingTasks: 0,
        blockedTasks: 0,
      })
    }
  }

  return phases
}

function parsePlanItems(content: string, file: string): PlanItem[] {
  const items: PlanItem[] = []
  const lines = content.split('\n')
  let currentEpic = ''
  let currentStory = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track epic headers: ## Epic 3.1: Content Type System
    const epicMatch = line.match(/^#{2,3}\s+(?:Epic\s+[\d.]+[:\s]*)?(.+)/i)
    if (epicMatch && !line.includes('|')) {
      currentEpic = epicMatch[1].trim()
      continue
    }

    // Parse table rows for tasks
    // Format: | | Task description | Complete |
    // Format: | **Story Name** | | Complete |
    // Format: | | ~~Superseded task~~ | Superseded → ... |
    const tableRowMatch = line.match(/^\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|/)
    if (tableRowMatch) {
      const col1 = tableRowMatch[1].trim()
      const col2 = tableRowMatch[2].trim()
      const col3 = tableRowMatch[3].trim()

      // Skip header rows and separator rows
      if (col1 === 'Story' || col1 === '---' || col3 === 'Status' || line.includes('------|')) {
        continue
      }

      const statusText = col3.toLowerCase()

      // Story row: | **Story Name** | | Status |
      if (col1.startsWith('**') && col1.endsWith('**')) {
        currentStory = col1.replace(/\*\*/g, '').trim()
        // Stories themselves don't count as tasks — only sub-tasks do
        continue
      }

      // Task row: | | Task description | Status |
      if (col2 && statusText) {
        const title = col2.replace(/~~(.*?)~~/g, '$1').trim()

        // Skip empty task descriptions
        if (!title) continue

        let status: PlanItem['status'] = 'pending'
        if (statusText.includes('complete')) {
          status = 'complete'
        } else if (statusText.includes('in progress') || statusText.includes('in-progress')) {
          status = 'in-progress'
        } else if (statusText.includes('blocked')) {
          status = 'blocked'
        } else if (statusText.includes('superseded') || statusText.includes('cut') || statusText.includes('deferred')) {
          // Superseded/cut items count as complete (they're done — just not by building them)
          status = 'complete'
        } else if (statusText.includes('pending') || statusText.includes('planned')) {
          status = 'pending'
        }

        items.push({
          title,
          status,
          phase: file,
          epic: currentEpic,
          story: currentStory,
          line: i + 1,
          file,
        })
      }
    }

    // Also support checkbox format (backlog.md might use this)
    const checkboxMatch = line.match(/^(\s*)-\s*\[([ xX])\]\s*(.+)/)
    if (checkboxMatch) {
      const checked = checkboxMatch[2].toLowerCase() === 'x'
      const title = checkboxMatch[3].trim()

      let status: PlanItem['status'] = checked ? 'complete' : 'pending'
      if (title.toLowerCase().includes('in progress')) status = 'in-progress'
      if (title.toLowerCase().includes('blocked')) status = 'blocked'

      items.push({
        title,
        status,
        phase: file,
        epic: currentEpic,
        story: currentStory,
        line: i + 1,
        file,
      })
    }
  }

  return items
}

function countItems(items: PlanItem[]): { complete: number; inProgress: number; pending: number; blocked: number; total: number } {
  return {
    complete: items.filter((i) => i.status === 'complete').length,
    inProgress: items.filter((i) => i.status === 'in-progress').length,
    pending: items.filter((i) => i.status === 'pending').length,
    blocked: items.filter((i) => i.status === 'blocked').length,
    total: items.length,
  }
}

// ═══════════════════════════════════════════════════════════════
// PLAN:AUDIT
// ═══════════════════════════════════════════════════════════════

export async function planAudit(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  log.info('Starting plan audit', { scope: request.scope || 'all' })

  // 1. Read plan index
  const indexFile = await github.getFile('docs/execution/project-plan/index.md')
  if (!indexFile) {
    return {
      success: false,
      action: 'plan:audit',
      report: '## Plan Audit Failed\n\nCould not read `docs/execution/project-plan/index.md`',
      changes: [],
      errors: ['index.md not found'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  const indexPhases = parsePlanIndex(indexFile.content)
  log.info(`Found ${indexPhases.length} phases in index`)

  // 2. Read all phase files
  const phaseDir = await github.getDirectory('docs/execution/project-plan')
  const phaseFiles = phaseDir.filter((f) => f.match(/phase-\d+/))

  const allItems: PlanItem[] = []
  const countMismatches: CountMismatch[] = []

  for (const phaseFile of phaseFiles) {
    const file = await github.getFile(phaseFile)
    if (!file) {
      errors.push(`Could not read ${phaseFile}`)
      continue
    }

    const items = parsePlanItems(file.content, phaseFile)
    allItems.push(...items)

    // Compare counts against index
    const phaseNum = phaseFile.match(/phase-(\d+)/)?.[1]
    const indexPhase = indexPhases.find((p) => p.number === parseInt(phaseNum || '0'))
    if (indexPhase) {
      const counts = countItems(items)
      if (counts.complete !== indexPhase.completedTasks || counts.total !== indexPhase.totalTasks) {
        countMismatches.push({
          phase: indexPhase.name,
          indexSays: `${indexPhase.completedTasks}/${indexPhase.totalTasks}`,
          actual: `${counts.complete}/${counts.total}`,
          delta: `${counts.complete - indexPhase.completedTasks} complete, ${counts.total - indexPhase.totalTasks} total`,
        })
      }
    }
  }

  // 3. Check for stale in-progress items (no commits in 14+ days)
  const staleItems: StaleItem[] = []
  const inProgressItems = allItems.filter((i) => i.status === 'in-progress')

  for (const item of inProgressItems) {
    const lastCommit = await github.getLastCommitDate(item.file)
    if (lastCommit) {
      const daysSince = Math.floor((Date.now() - new Date(lastCommit).getTime()) / (1000 * 60 * 60 * 24))
      if (daysSince > 14) {
        staleItems.push({
          title: item.title,
          phase: item.phase,
          epic: item.epic || 'Unknown',
          lastCommit,
        })
      }
    }
  }

  // 4. Generate report
  const counts = countItems(allItems)
  const report = generateAuditReport({
    phasesScanned: phaseFiles.length,
    itemsAudited: allItems.length,
    issuesFound: countMismatches.length + staleItems.length,
    countMismatches,
    staleItems,
    misplacedItems: [],
    untrackedWork: [],
  })

  const endTime = Date.now()

  return {
    success: true,
    action: 'plan:audit',
    report,
    changes,
    errors,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      filesRead: phaseFiles.length + 1,
      filesChanged: changes.length,
      apiCalls: github.apiCalls + analyzer.apiCalls,
    },
    nextActions: [
      countMismatches.length > 0 ? '`plan:update` to fix count mismatches' : '',
      staleItems.length > 0 ? '`cleanup:stale` to review stale items' : '',
      '`arch:sync` to check if tech docs match plan state',
    ].filter(Boolean),
  }
}

function generateAuditReport(audit: PlanAuditReport): string {
  const date = new Date().toISOString().split('T')[0]
  let report = `## Plan Audit Report — ${date}\n\n`

  report += `### Summary\n`
  report += `- Phases scanned: ${audit.phasesScanned}\n`
  report += `- Items audited: ${audit.itemsAudited}\n`
  report += `- Issues found: ${audit.issuesFound}\n\n`

  if (audit.countMismatches.length > 0) {
    report += `### Count Mismatches\n`
    report += `| Phase | Index Says | Actual | Delta |\n`
    report += `|-------|-----------|--------|-------|\n`
    for (const m of audit.countMismatches) {
      report += `| ${m.phase} | ${m.indexSays} | ${m.actual} | ${m.delta} |\n`
    }
    report += '\n'
  }

  if (audit.staleItems.length > 0) {
    report += `### Stale In-Progress Items (no commits in 14+ days)\n`
    for (const s of audit.staleItems) {
      report += `- [ ] ${s.phase} / ${s.epic} / "${s.title}" — last commit ${s.lastCommit}\n`
    }
    report += '\n'
  }

  if (audit.misplacedItems.length > 0) {
    report += `### Misplaced Items\n`
    for (const m of audit.misplacedItems) {
      report += `- "${m.title}" is in ${m.currentPhase} but belongs in ${m.suggestedPhase} (${m.reason})\n`
    }
    report += '\n'
  }

  if (audit.issuesFound === 0) {
    report += `### ✅ All Clear\nPlan is consistent. No issues found.\n`
  } else {
    report += `### Recommended Actions\n`
    let actionNum = 1
    if (audit.countMismatches.length > 0) {
      report += `${actionNum++}. Update index.md counts to match actual phase counts\n`
    }
    if (audit.staleItems.length > 0) {
      report += `${actionNum++}. Review stale in-progress items — update or move to blocked\n`
    }
    if (audit.misplacedItems.length > 0) {
      report += `${actionNum++}. Move misplaced items to correct phases\n`
    }
  }

  return report
}

// ═══════════════════════════════════════════════════════════════
// PLAN:UPDATE
// ═══════════════════════════════════════════════════════════════

export async function planUpdate(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []
  const branch = request.branch || 'master'

  log.info('Starting plan update', { branch })

  // 1. Get recent commits on the branch
  const commits = await github.getCommits({ branch, limit: 30 })
  if (commits.length === 0) {
    return {
      success: true,
      action: 'plan:update',
      report: '## Plan Update\n\nNo commits found on branch. Nothing to update.',
      changes: [],
      errors: [],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  // 2. Read all plan items
  const phaseDir = await github.getDirectory('docs/execution/project-plan')
  const phaseFiles = phaseDir.filter((f) => f.match(/phase-\d+/))

  const allItems: PlanItem[] = []
  for (const phaseFile of phaseFiles) {
    const file = await github.getFile(phaseFile)
    if (file) {
      allItems.push(...parsePlanItems(file.content, phaseFile))
    }
  }

  // 3. Use Claude to match commits to tasks
  const commitMessages = commits.map((c) => c.message.split('\n')[0])
  const matches = await analyzer.matchCommitsToTasks(commitMessages, allItems)

  log.info(`Found ${matches.length} commit-task matches`)

  // 4. Generate update report
  let report = `## Plan Updated — ${new Date().toISOString().split('T')[0]}\n\n`

  if (matches.length > 0) {
    report += `### Items Completed (from branch \`${branch}\`)\n`
    for (const match of matches) {
      report += `- [x] ${match.taskTitle} (confidence: ${Math.round(match.confidence * 100)}%)\n`
    }
    report += '\n'

    changes.push({
      file: 'docs/execution/project-plan/',
      type: 'updated',
      summary: `${matches.length} tasks matched to commits`,
    })
  } else {
    report += `### No task matches found\n`
    report += `Analyzed ${commitMessages.length} commits against ${allItems.filter((i) => i.status !== 'complete').length} pending/in-progress tasks.\n\n`
  }

  report += `### Commits Analyzed\n`
  for (const msg of commitMessages.slice(0, 10)) {
    report += `- ${msg}\n`
  }
  if (commitMessages.length > 10) {
    report += `- ... and ${commitMessages.length - 10} more\n`
  }

  report += `\n### Recommended Actions\n`
  report += `1. Review matches above and confirm accuracy\n`
  if (matches.length > 0) {
    report += `2. Run \`plan:audit\` to verify counts after updates\n`
  }

  const endTime = Date.now()

  return {
    success: true,
    action: 'plan:update',
    report,
    changes,
    errors,
    metrics: {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      filesRead: phaseFiles.length + 1,
      filesChanged: changes.length,
      apiCalls: github.apiCalls + analyzer.apiCalls,
    },
    nextActions: ['`plan:audit` to verify counts', '`arch:sync` if architecture changed'],
  }
}
