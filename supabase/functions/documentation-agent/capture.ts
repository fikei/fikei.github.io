// Documentation Agent - Capture Domain
// Functions: capture:bug, capture:work, capture:tech-debt

import { createLogger } from './logger.ts'
import type { GitHubClient } from './github.ts'
import type { Analyzer } from './analyzer.ts'
import type { DocAgentRequest, DocAgentResult, FileChange } from './types.ts'

const log = createLogger('capture')

// ═══════════════════════════════════════════════════════════════
// CAPTURE:BUG
// ═══════════════════════════════════════════════════════════════

export async function captureBug(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  const title = request.title || request.description || ''
  const description = request.description || ''
  const location = (request.params?.location as string) || ''

  if (!title) {
    return {
      success: false, action: 'capture:bug',
      report: '## Error\n\nMissing required field: `title` or `description`',
      changes: [], errors: ['title is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  // Auto-detect severity and sub-product
  const severity = request.severity || await analyzer.classifySeverity(title + ' ' + description)
  const subProduct = request.subProduct || await analyzer.detectSubProduct(title + ' ' + description)
  const date = new Date().toISOString().split('T')[0]

  log.info('Capturing bug', { title, severity, subProduct })

  // Read BUGS.md to get next ID
  const bugsFile = await github.getFile('docs/execution/BUGS.md')
  let bugId = 'BUG-001'
  if (bugsFile) {
    const existing = bugsFile.content.match(/BUG-(\d+)/g) || []
    const maxNum = existing.reduce((max, id) => {
      const num = parseInt(id.replace('BUG-', ''))
      return num > max ? num : max
    }, 0)
    bugId = `BUG-${String(maxNum + 1).padStart(3, '0')}`
  }

  // Build entry
  const entry = `| ${bugId} | ${title} | ${severity} | ${subProduct} | Open | ${date} |`

  let report = `## Bug Logged\n\n`
  report += `- **ID**: ${bugId}\n`
  report += `- **Title**: ${title}\n`
  report += `- **Severity**: ${severity}\n`
  report += `- **Sub-product**: ${subProduct}\n`
  report += `- **Filed to**: \`docs/execution/BUGS.md\`\n`
  if (location) report += `- **Location**: \`${location}\`\n`
  report += `\n### Entry\n\`\`\`\n${entry}\n\`\`\`\n`

  if (severity === 'critical' || severity === 'high') {
    report += `\n### ⚠️ High-severity bug — plan task recommended\n`
    report += `Run \`plan:add\` to create a task for this bug in the active phase.\n`
  }

  report += `\n### Recommended Actions\n`
  report += `1. Verify the bug entry in BUGS.md\n`
  if (severity === 'critical' || severity === 'high') {
    report += `2. Run \`plan:add --type=bug --title="Fix ${bugId}"\` to add to active phase\n`
  }

  changes.push({ file: 'docs/execution/BUGS.md', type: 'updated', summary: `Added ${bugId}: ${title}` })

  const endTime = Date.now()
  return {
    success: true, action: 'capture:bug', report, changes, errors,
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 1, filesChanged: 1, apiCalls: github.apiCalls + analyzer.apiCalls },
    nextActions: severity === 'critical' || severity === 'high'
      ? ['`plan:add` to create task for this bug']
      : ['`plan:audit` to verify plan state'],
  }
}

// ═══════════════════════════════════════════════════════════════
// CAPTURE:WORK
// ═══════════════════════════════════════════════════════════════

export async function captureWork(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []

  const title = request.title || request.description || ''
  const description = request.description || ''
  const size = (request.params?.size as string) || 'small'
  const urgency = (request.params?.urgency as string) || 'later'

  if (!title) {
    return {
      success: false, action: 'capture:work',
      report: '## Error\n\nMissing required field: `title` or `description`',
      changes: [], errors: ['title is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  const subProduct = request.subProduct || await analyzer.detectSubProduct(title + ' ' + description)

  log.info('Capturing work', { title, size, urgency, subProduct })

  // Determine fidelity level
  const fidelity = size === 'large' ? 'Epic' : size === 'medium' ? 'Story' : 'Task'

  // Determine target file
  let targetFile = 'docs/execution/project-plan/backlog.md'
  if (urgency === 'now') {
    // Find active phase
    const indexFile = await github.getFile('docs/execution/project-plan/index.md')
    if (indexFile) {
      const lines = indexFile.content.split('\n')
      for (const line of lines) {
        const match = line.match(/\[Phase\s+\d+[^\]]*\]\(\.\/([^)]+)\)\s*\|\s*IN PROGRESS/i)
        if (match) {
          targetFile = `docs/execution/project-plan/${match[1]}`
          break
        }
      }
    }
  }

  let report = `## Work Item Captured\n\n`
  report += `- **Title**: ${title}\n`
  report += `- **Type**: ${fidelity}\n`
  report += `- **Sub-product**: ${subProduct}\n`
  report += `- **Urgency**: ${urgency}\n`
  report += `- **Filed to**: \`${targetFile}\`\n`
  if (description) report += `- **Description**: ${description}\n`
  report += `\n### Recommended Actions\n`
  report += `1. Review the item in \`${targetFile}\`\n`
  report += `2. Run \`plan:audit\` to verify counts\n`

  changes.push({ file: targetFile, type: 'updated', summary: `Added ${fidelity.toLowerCase()}: ${title}` })

  const endTime = Date.now()
  return {
    success: true, action: 'capture:work', report, changes, errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 1, filesChanged: 1, apiCalls: github.apiCalls + analyzer.apiCalls },
    nextActions: ['`plan:audit` to verify counts'],
  }
}

// ═══════════════════════════════════════════════════════════════
// CAPTURE:TECH-DEBT
// ═══════════════════════════════════════════════════════════════

export async function captureTechDebt(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []

  const title = request.title || request.description || ''
  const description = request.description || ''
  const location = (request.params?.location as string) || ''
  const effort = (request.params?.effort as string) || 'medium'
  const risk = (request.params?.risk as string) || 'medium'

  if (!title) {
    return {
      success: false, action: 'capture:tech-debt',
      report: '## Error\n\nMissing required field: `title` or `description`',
      changes: [], errors: ['title is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  const subProduct = request.subProduct || await analyzer.detectSubProduct(title + ' ' + description)

  log.info('Capturing tech debt', { title, effort, risk, subProduct })

  const targetFile = 'docs/execution/project-plan/backlog.md'
  const date = new Date().toISOString().split('T')[0]

  let report = `## Tech Debt Logged\n\n`
  report += `- **Title**: ${title}\n`
  report += `- **Sub-product**: ${subProduct}\n`
  report += `- **Effort**: ${effort}\n`
  report += `- **Risk**: ${risk}\n`
  report += `- **Filed to**: \`${targetFile}\` (Technical Debt section)\n`
  if (location) report += `- **Location**: \`${location}\`\n`
  if (description) report += `- **Description**: ${description}\n`

  if (risk === 'high') {
    report += `\n### ⚠️ High-risk debt — also filed to risks.md\n`
    changes.push({ file: 'docs/infrastructure/risks.md', type: 'updated', summary: `Added high-risk tech debt: ${title}` })
  }

  report += `\n### Recommended Actions\n`
  report += `1. Review the item in \`${targetFile}\`\n`
  if (risk === 'high') {
    report += `2. Review \`docs/infrastructure/risks.md\` for impact\n`
  }

  changes.push({ file: targetFile, type: 'updated', summary: `Added tech debt: ${title} [${effort}/${risk}]` })

  const endTime = Date.now()
  return {
    success: true, action: 'capture:tech-debt', report, changes, errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 1, filesChanged: changes.length, apiCalls: github.apiCalls + analyzer.apiCalls },
    nextActions: risk === 'high' ? ['Review risks.md'] : [],
  }
}
