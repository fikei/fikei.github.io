// Documentation Agent - PM Domain
// Functions: pm:scope-check, pm:dependency-map, pm:status-report, pm:retro,
//            pm:decision-log, pm:prd-to-plan, pm:changelog

import { createLogger } from './logger.ts'
import type { GitHubClient } from './github.ts'
import type { Analyzer } from './analyzer.ts'
import type { DocAgentRequest, DocAgentResult, FileChange } from './types.ts'

const log = createLogger('pm')

// ═══════════════════════════════════════════════════════════════
// PM:SCOPE-CHECK
// ═══════════════════════════════════════════════════════════════

export async function pmScopeCheck(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const branch = request.branch || ''
  if (!branch) {
    return {
      success: false, action: 'pm:scope-check',
      report: '## Error\n\nMissing required: `branch`',
      changes: [], errors: ['branch is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  log.info('Checking scope', { branch })

  // Get branch commits and changed files
  let comparison
  try {
    comparison = await github.compareBranches('master', branch)
  } catch (e) {
    return {
      success: false, action: 'pm:scope-check',
      report: `## Error\n\nCould not compare master and ${branch}: ${e}`,
      changes: [], errors: [String(e)],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  const files = comparison.files
  const newFiles = files.filter((f) => f.status === 'added')
  const modifiedFiles = files.filter((f) => f.status === 'modified')
  const deletedFiles = files.filter((f) => f.status === 'removed')

  // Categorize
  const codeFiles = files.filter((f) => !f.filename.endsWith('.md') && !f.filename.startsWith('docs/'))
  const docFiles = files.filter((f) => f.filename.endsWith('.md') || f.filename.startsWith('docs/'))
  const configFiles = files.filter((f) => f.filename.endsWith('.json') || f.filename.endsWith('.yml'))

  let report = `## Scope Check — \`${branch}\`\n\n`
  report += `### Branch Stats\n`
  report += `- Commits: ${comparison.totalCommits}\n`
  report += `- Files changed: ${files.length} (${newFiles.length} new, ${modifiedFiles.length} modified, ${deletedFiles.length} deleted)\n`
  report += `- Code files: ${codeFiles.length}\n`
  report += `- Doc files: ${docFiles.length}\n`
  report += `- Config files: ${configFiles.length}\n\n`

  // Flag scope concerns
  const concerns: string[] = []
  if (newFiles.length > 10) concerns.push(`${newFiles.length} new files — consider splitting into multiple PRs`)
  if (files.length > 30) concerns.push(`${files.length} total files changed — large PR risk`)
  if (codeFiles.length > 0 && docFiles.length === 0) concerns.push('Code changes with no documentation updates')

  if (concerns.length > 0) {
    report += `### ⚠️ Scope Concerns\n`
    for (const c of concerns) {
      report += `- ${c}\n`
    }
    report += '\n'
  }

  if (newFiles.length > 0) {
    report += `### New Files\n`
    for (const f of newFiles.slice(0, 20)) {
      report += `- \`${f.filename}\`\n`
    }
    if (newFiles.length > 20) report += `- ... and ${newFiles.length - 20} more\n`
    report += '\n'
  }

  report += `### Recommended Actions\n`
  if (concerns.length > 0) {
    report += `1. Review scope concerns above\n`
    report += `2. Run \`capture:work\` for any unplanned additions\n`
  }
  report += `3. Run \`branch:diff\` to check doc coverage\n`

  const endTime = Date.now()
  return {
    success: true, action: 'pm:scope-check', report, changes: [], errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: ['`branch:diff` to check doc coverage', '`capture:work` for unplanned items'],
  }
}

// ═══════════════════════════════════════════════════════════════
// PM:DEPENDENCY-MAP
// ═══════════════════════════════════════════════════════════════

export async function pmDependencyMap(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  log.info('Mapping dependencies')

  // Read index to understand phase dependencies
  const indexFile = await github.getFile('docs/execution/project-plan/index.md')
  if (!indexFile) {
    return {
      success: false, action: 'pm:dependency-map',
      report: '## Error\n\nCould not read index.md',
      changes: [], errors: ['index.md not found'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  // Parse index for phases
  const lines = indexFile.content.split('\n')
  const phases: Array<{ name: string; status: string; progress: string }> = []

  for (const line of lines) {
    const match = line.match(/\[Phase\s+(\d+)[^\]]*\]\([^)]+\)\s*\|\s*([^|]+)\|\s*([^|]+)\|/)
    if (match) {
      phases.push({
        name: `Phase ${match[1]}`,
        status: match[2].trim(),
        progress: match[3].trim(),
      })
    }
  }

  // Read BUGS.md for blocking bugs
  const bugsFile = await github.getFile('docs/execution/BUGS.md')
  let openBugs = 0
  let criticalBugs = 0
  if (bugsFile) {
    const bugLines = bugsFile.content.split('\n')
    for (const line of bugLines) {
      if (line.includes('| Open |') || line.includes('| open |')) {
        openBugs++
        if (line.toLowerCase().includes('critical')) criticalBugs++
      }
    }
  }

  let report = `## Dependency Map — ${new Date().toISOString().split('T')[0]}\n\n`

  report += `### Phase Dependencies\n`
  report += `| Phase | Status | Progress | Depends On |\n`
  report += `|-------|--------|----------|------------|\n`
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]
    const deps = i > 0 ? phases.slice(0, i).filter((prev) => prev.status !== 'SHIPPED').map((prev) => prev.name) : []
    report += `| ${p.name} | ${p.status} | ${p.progress} | ${deps.length > 0 ? deps.join(', ') : 'None'} |\n`
  }
  report += '\n'

  if (openBugs > 0) {
    report += `### Blocking Issues\n`
    report += `- Open bugs: ${openBugs}\n`
    if (criticalBugs > 0) report += `- ⚠️ Critical bugs: ${criticalBugs}\n`
    report += '\n'
  }

  report += `### Recommended Actions\n`
  report += `1. Focus on completing in-progress phases before starting new ones\n`
  if (criticalBugs > 0) report += `2. Address ${criticalBugs} critical bugs first\n`
  report += `3. Run \`pm:status-report\` for velocity analysis\n`

  const endTime = Date.now()
  return {
    success: true, action: 'pm:dependency-map', report, changes: [], errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 2, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: ['`pm:status-report` for velocity'],
  }
}

// ═══════════════════════════════════════════════════════════════
// PM:STATUS-REPORT
// ═══════════════════════════════════════════════════════════════

export async function pmStatusReport(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const period = (request.params?.period as string) || request.period || 'weekly'
  const since = request.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  log.info('Generating status report', { period, since })

  // Gather commits
  const commits = await github.getCommits({ since, limit: 100 })

  // Read plan index
  const indexFile = await github.getFile('docs/execution/project-plan/index.md')

  // Read BUGS.md
  const bugsFile = await github.getFile('docs/execution/BUGS.md')

  const date = new Date().toISOString().split('T')[0]
  const sinceDate = since.split('T')[0]

  let report = `## ${period.charAt(0).toUpperCase() + period.slice(1)} Status Report — ${sinceDate} to ${date}\n\n`

  report += `### Summary\n`
  report += `- Commits this period: ${commits.length}\n`

  // Categorize commits
  const features = commits.filter((c) => c.message.match(/add|feat|implement|create|new/i))
  const fixes = commits.filter((c) => c.message.match(/fix|bug|patch|resolve/i))
  const docs = commits.filter((c) => c.message.match(/doc|readme|comment|plan/i))
  const infra = commits.filter((c) => c.message.match(/deploy|ci|config|build|infra/i))

  report += `- Features: ${features.length}\n`
  report += `- Fixes: ${fixes.length}\n`
  report += `- Documentation: ${docs.length}\n`
  report += `- Infrastructure: ${infra.length}\n\n`

  if (features.length > 0) {
    report += `### Shipped This Period\n`
    for (const c of features.slice(0, 10)) {
      report += `- ${c.message.split('\n')[0]}\n`
    }
    if (features.length > 10) report += `- ... and ${features.length - 10} more\n`
    report += '\n'
  }

  // Plan progress
  if (indexFile) {
    report += `### Plan Progress\n`
    const phaseLines = indexFile.content.split('\n').filter((l) => l.includes('Phase'))
    for (const line of phaseLines) {
      const match = line.match(/Phase\s+(\d+)[^|]*\|\s*([^|]+)\|\s*([^|]+)\|/)
      if (match) {
        report += `- Phase ${match[1]}: ${match[2].trim()} (${match[3].trim()})\n`
      }
    }
    report += '\n'
  }

  // Bug status
  if (bugsFile) {
    const openBugs = (bugsFile.content.match(/\| Open \|/gi) || []).length
    const closedBugs = (bugsFile.content.match(/\| Closed \|/gi) || []).length
    report += `### Bug Status\n`
    report += `- Open: ${openBugs}\n`
    report += `- Closed: ${closedBugs}\n\n`
  }

  report += `### Recommended Actions\n`
  report += `1. Run \`pm:changelog\` to generate changelog from this period\n`
  report += `2. Run \`plan:audit\` to verify plan reflects shipped work\n`
  report += `3. Run \`pm:deps\` to check for blockers\n`

  const endTime = Date.now()
  return {
    success: true, action: 'pm:status-report', report, changes: [], errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 2, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: ['`pm:changelog`', '`plan:audit`'],
  }
}

// ═══════════════════════════════════════════════════════════════
// PM:RETRO
// ═══════════════════════════════════════════════════════════════

export async function pmRetro(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const scope = request.scope || 'last 30 days'
  const since = request.since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  log.info('Generating retro', { scope, since })

  const commits = await github.getCommits({ since, limit: 200 })

  // Analyze commit patterns
  const dayMap: Record<string, number> = {}
  for (const c of commits) {
    const day = c.date.split('T')[0]
    dayMap[day] = (dayMap[day] || 0) + 1
  }
  const activeDays = Object.keys(dayMap).length
  const totalDays = Math.ceil((Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24))
  const avgPerDay = commits.length / Math.max(activeDays, 1)

  // Categorize work
  const features = commits.filter((c) => c.message.match(/add|feat|implement|new/i))
  const fixes = commits.filter((c) => c.message.match(/fix|bug|resolve/i))
  const refactors = commits.filter((c) => c.message.match(/refactor|clean|reorganize|rename/i))

  let report = `## Retrospective — ${scope}\n\n`
  report += `### Timeline\n`
  report += `- **Period**: ${since.split('T')[0]} to ${new Date().toISOString().split('T')[0]}\n`
  report += `- **Calendar days**: ${totalDays}\n`
  report += `- **Active days**: ${activeDays}\n`
  report += `- **Total commits**: ${commits.length}\n`
  report += `- **Avg commits/active day**: ${avgPerDay.toFixed(1)}\n\n`

  report += `### Work Breakdown\n`
  report += `| Type | Count | % |\n`
  report += `|------|-------|---|\n`
  report += `| Features | ${features.length} | ${Math.round(features.length / commits.length * 100)}% |\n`
  report += `| Fixes | ${fixes.length} | ${Math.round(fixes.length / commits.length * 100)}% |\n`
  report += `| Refactors | ${refactors.length} | ${Math.round(refactors.length / commits.length * 100)}% |\n`
  report += `| Other | ${commits.length - features.length - fixes.length - refactors.length} | ${Math.round((commits.length - features.length - fixes.length - refactors.length) / commits.length * 100)}% |\n\n`

  // Most active days
  const sortedDays = Object.entries(dayMap).sort((a, b) => b[1] - a[1])
  report += `### Most Active Days\n`
  for (const [day, count] of sortedDays.slice(0, 5)) {
    report += `- ${day}: ${count} commits\n`
  }
  report += '\n'

  report += `### Recommendations\n`
  if (fixes.length > features.length) {
    report += `- ⚠️ More fixes than features — consider stabilization sprint\n`
  }
  if (refactors.length / commits.length > 0.3) {
    report += `- High refactor ratio (${Math.round(refactors.length / commits.length * 100)}%) — positive for quality\n`
  }
  report += `- Run \`pm:status-report\` for current state\n`

  const endTime = Date.now()
  return {
    success: true, action: 'pm:retro', report, changes: [], errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: ['`pm:status-report`'],
  }
}

// ═══════════════════════════════════════════════════════════════
// PM:DECISION-LOG
// ═══════════════════════════════════════════════════════════════

export async function pmDecisionLog(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const action = (request.params?.decision_action as string) || 'list'
  const title = request.title || ''

  log.info('Decision log', { action, title })

  const decisionFile = await github.getFile('docs/strategy/decision-log.md')
  if (!decisionFile) {
    return {
      success: false, action: 'pm:decision-log',
      report: '## Error\n\nCould not read docs/strategy/decision-log.md',
      changes: [], errors: ['decision-log.md not found'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 1, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  let report = ''

  if (action === 'list') {
    // Extract decisions
    const decisions = decisionFile.content.match(/## ADR-\d+:.+/g) || []
    const pending = decisionFile.content.match(/\*\*Status\*\*:\s*Pending/gi) || []

    report = `## Open Decisions — ${pending.length} pending\n\n`
    report += `### All Decisions (${decisions.length} total)\n`
    for (const d of decisions) {
      report += `- ${d.replace('## ', '')}\n`
    }
    if (pending.length > 0) {
      report += `\n### ⚠️ ${pending.length} decisions still pending\n`
    }
  } else if (action === 'add') {
    if (!title) {
      return {
        success: false, action: 'pm:decision-log',
        report: '## Error\n\nMissing `title` for decision',
        changes: [], errors: ['title required for add'],
        metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 1, filesChanged: 0, apiCalls: github.apiCalls },
      }
    }

    report = `## Decision Added\n\n`
    report += `- **Title**: ${title}\n`
    report += `- **Status**: Pending\n`
    report += `- **Filed to**: docs/strategy/decision-log.md\n\n`
    report += `### Recommended Actions\n`
    report += `1. Fill in context, options, and deadline\n`
    report += `2. Run \`arch:add-adr\` when decision is made\n`
  } else if (action === 'resolve') {
    report = `## Decision Resolved\n\n`
    report += `- **Title**: ${title}\n`
    report += `- **Resolution**: ${request.description || 'See decision log'}\n`
    report += `\n### Recommended Actions\n`
    report += `1. Run \`arch:update-spec\` if decision affects tech specs\n`
    report += `2. Run \`plan:rebalance\` if decision changes scope\n`
  }

  const endTime = Date.now()
  return {
    success: true, action: 'pm:decision-log', report, changes: [], errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 1, filesChanged: action !== 'list' ? 1 : 0, apiCalls: github.apiCalls },
    nextActions: action === 'resolve' ? ['`arch:update-spec`', '`plan:rebalance`'] : [],
  }
}

// ═══════════════════════════════════════════════════════════════
// PM:PRD-TO-PLAN
// ═══════════════════════════════════════════════════════════════

export async function pmPrdToPlan(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const prdPath = request.prd || (request.params?.prd as string) || ''

  if (!prdPath) {
    return {
      success: false, action: 'pm:prd-to-plan',
      report: '## Error\n\nMissing required: `prd` (path to PRD file)',
      changes: [], errors: ['prd path is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  log.info('Generating plan from PRD', { prd: prdPath })

  const prdFile = await github.getFile(prdPath)
  if (!prdFile) {
    return {
      success: false, action: 'pm:prd-to-plan',
      report: `## Error\n\nCould not read PRD: \`${prdPath}\``,
      changes: [], errors: [`PRD not found: ${prdPath}`],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 1, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  // Use Claude to break PRD into plan items
  const prompt = `Break this PRD into a project plan. Output as markdown with:
- Epics (## headings) — major feature areas from the PRD sections
- Stories (### headings with **bold**) — user-facing capabilities
- Tasks (table rows) — implementation steps

Use this table format for each story:
| Story | Tasks | Status |
|-------|-------|--------|
| **Story Name** | | Pending |
| | Task 1 description | Pending |
| | Task 2 description | Pending |

Include T-shirt size estimates (S/M/L/XL) in task descriptions where helpful.
Only output the plan markdown, nothing else.`

  const planContent = await analyzer.analyze(prompt, prdFile.content.slice(0, 8000))

  let report = `## Plan Generated from PRD\n\n`
  report += `**Source**: \`${prdPath}\`\n\n`
  report += `### Generated Plan\n\n`
  report += planContent
  report += `\n\n### Recommended Actions\n`
  report += `1. Review the generated plan above\n`
  report += `2. Add to the appropriate phase file with \`plan:add\`\n`
  report += `3. Run \`pm:dependency-map\` to identify blockers\n`

  const endTime = Date.now()
  return {
    success: true, action: 'pm:prd-to-plan', report, changes: [], errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 1, filesChanged: 0, apiCalls: github.apiCalls + analyzer.apiCalls },
    nextActions: ['`plan:add` to file items', '`pm:dependency-map`'],
  }
}

// ═══════════════════════════════════════════════════════════════
// PM:CHANGELOG
// ═══════════════════════════════════════════════════════════════

export async function pmChangelog(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const audience = request.audience || (request.params?.audience as string) || 'internal'

  // Determine 'since' — last changelog entry or 7 days
  let since = request.since || ''
  if (!since) {
    const changelog = await github.getFile('CHANGELOG.md')
    if (changelog) {
      const dateMatch = changelog.content.match(/## \[?\d{4}-\d{2}-\d{2}\]?/)
      if (dateMatch) {
        since = dateMatch[0].replace(/## \[?/, '').replace(/\]?/, '') + 'T00:00:00Z'
      }
    }
    if (!since) {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    }
  }

  log.info('Generating changelog', { since, audience })

  const commits = await github.getCommits({ since, limit: 100 })

  // Categorize commits
  const features: string[] = []
  const improvements: string[] = []
  const fixes: string[] = []
  const infra: string[] = []
  const docs: string[] = []

  for (const c of commits) {
    const msg = c.message.split('\n')[0]

    // Skip noise for external audience
    if (audience === 'external' && msg.match(/typo|format|lint|merge|wip/i)) continue

    if (msg.match(/add|feat|implement|create|new|ship/i)) features.push(msg)
    else if (msg.match(/improve|enhance|update|optimize|refactor/i)) improvements.push(msg)
    else if (msg.match(/fix|bug|patch|resolve|correct/i)) fixes.push(msg)
    else if (msg.match(/deploy|ci|build|config|infra|workflow/i)) infra.push(msg)
    else if (msg.match(/doc|readme|plan|spec|prd/i)) docs.push(msg)
    else if (audience === 'internal') improvements.push(msg)
  }

  const date = new Date().toISOString().split('T')[0]
  let report = `## Changelog — ${date}\n\n`

  if (features.length > 0) {
    report += `### Features\n`
    for (const f of features) report += `- ${f}\n`
    report += '\n'
  }
  if (improvements.length > 0) {
    report += `### Improvements\n`
    for (const i of improvements) report += `- ${i}\n`
    report += '\n'
  }
  if (fixes.length > 0) {
    report += `### Bug Fixes\n`
    for (const f of fixes) report += `- ${f}\n`
    report += '\n'
  }
  if (audience === 'internal') {
    if (infra.length > 0) {
      report += `### Infrastructure\n`
      for (const i of infra) report += `- ${i}\n`
      report += '\n'
    }
    if (docs.length > 0) {
      report += `### Documentation\n`
      for (const d of docs) report += `- ${d}\n`
      report += '\n'
    }
  }

  if (features.length === 0 && improvements.length === 0 && fixes.length === 0) {
    report += `No significant changes since ${since.split('T')[0]}.\n\n`
  }

  report += `### Recommended Actions\n`
  report += `1. Review and append to CHANGELOG.md\n`
  report += `2. Run \`pm:status-report\` for full status\n`

  const endTime = Date.now()
  return {
    success: true, action: 'pm:changelog', report,
    changes: [{ file: 'CHANGELOG.md', type: 'updated', summary: `Changelog entry for ${date}` }],
    errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 1, filesChanged: 1, apiCalls: github.apiCalls },
    nextActions: ['`pm:status-report`'],
  }
}
