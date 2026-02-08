// Documentation Agent - UX Domain
// Functions: ux:update, ux:audit, ux:wireframe

import { createLogger } from './logger.ts'
import type { GitHubClient } from './github.ts'
import type { Analyzer } from './analyzer.ts'
import type { DocAgentRequest, DocAgentResult, FileChange } from './types.ts'

const log = createLogger('ux')

// UX doc locations mapped by feature area
const UX_AREAS: Record<string, { docDir: string; codeDir: string[] }> = {
  boards: { docDir: 'docs/ux/boards', codeDir: ['boards/'] },
  widgets: { docDir: 'docs/ux/widgets', codeDir: ['boards/js/widgets/', 'supabase/functions/generate-widget/'] },
  pins: { docDir: 'docs/ux/pins', codeDir: ['boards/js/'] },
  users: { docDir: 'docs/ux/users', codeDir: ['boards/js/auth/'] },
}

// ═══════════════════════════════════════════════════════════════
// UX:UPDATE
// ═══════════════════════════════════════════════════════════════

export async function uxUpdate(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []
  const errors: string[] = []

  const featureArea = (request.params?.feature_area as string) || request.scope || ''

  if (!featureArea || !UX_AREAS[featureArea]) {
    return {
      success: false, action: 'ux:update',
      report: `## Error\n\nUnknown feature area: \`${featureArea}\`\nAvailable: ${Object.keys(UX_AREAS).join(', ')}`,
      changes: [], errors: [`Unknown feature area: ${featureArea}`],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  const area = UX_AREAS[featureArea]
  log.info('Updating UX docs', { featureArea })

  // Read UX docs for this area
  const uxFiles = await github.getDirectory(area.docDir)
  if (uxFiles.length === 0) {
    return {
      success: true, action: 'ux:update',
      report: `## UX Update — ${featureArea}\n\nNo UX docs found in \`${area.docDir}/\`. Create one to start tracking UX for this feature area.\n\n### Recommended Actions\n1. Create \`${area.docDir}/index.md\` with User Goals, JTBD table, Wireframes sections`,
      changes: [], errors: [],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  // Get recent code changes in the feature area
  const codeCommits = await github.getCommits({ path: area.codeDir[0], limit: 20 })

  let report = `## UX Doc Update — ${featureArea}\n\n`

  // Read each UX doc and check for staleness
  for (const uxFile of uxFiles.filter((f) => f.endsWith('.md'))) {
    const doc = await github.getFile(uxFile)
    if (!doc) continue

    const docLastUpdate = await github.getLastCommitDate(uxFile)

    // Check for status markers
    const planned = (doc.content.match(/⏳/g) || []).length
    const shipped = (doc.content.match(/✅/g) || []).length

    report += `### ${uxFile.split('/').pop()}\n`
    report += `- Last updated: ${docLastUpdate?.split('T')[0] || 'unknown'}\n`
    report += `- ✅ Shipped features: ${shipped}\n`
    report += `- ⏳ Planned features: ${planned}\n`

    // Check if recent commits suggest UX changes
    const uiCommits = codeCommits.filter((c) =>
      c.message.toLowerCase().match(/ui|ux|layout|style|css|html|button|modal|form|input|display/)
    )

    if (uiCommits.length > 0) {
      report += `- ⚠️ ${uiCommits.length} recent UI commits may need doc updates\n`
      changes.push({ file: uxFile, type: 'updated', summary: `${uiCommits.length} UI commits since last doc update` })
    } else {
      report += `- ✅ No UI-relevant commits detected\n`
    }
    report += '\n'
  }

  report += `### Recommended Actions\n`
  if (changes.length > 0) {
    report += `1. Review ${changes.length} UX docs that may need updating\n`
    report += `2. Mark newly shipped features as ✅\n`
    report += `3. Run \`ux:wireframe ${featureArea}\` to regenerate wireframes\n`
  } else {
    report += `1. UX docs appear current for ${featureArea}\n`
  }

  const endTime = Date.now()
  return {
    success: true, action: 'ux:update', report, changes, errors,
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: uxFiles.length + 1, filesChanged: changes.length, apiCalls: github.apiCalls + analyzer.apiCalls },
    nextActions: changes.length > 0 ? ['`ux:wireframe` to update wireframes'] : [],
  }
}

// ═══════════════════════════════════════════════════════════════
// UX:AUDIT
// ═══════════════════════════════════════════════════════════════

export async function uxAudit(
  github: GitHubClient,
  _analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()
  const changes: FileChange[] = []

  const featureArea = (request.params?.feature_area as string) || 'all'
  log.info('Auditing UX docs', { featureArea })

  const areasToAudit = featureArea === 'all' ? Object.keys(UX_AREAS) : [featureArea]

  let report = `## UX Audit — ${new Date().toISOString().split('T')[0]}\n\n`

  let totalDocs = 0
  let totalShipped = 0
  let totalPlanned = 0
  let totalGaps = 0

  for (const area of areasToAudit) {
    const config = UX_AREAS[area]
    if (!config) continue

    const uxFiles = await github.getDirectory(config.docDir)

    report += `### ${area}\n`

    if (uxFiles.length === 0) {
      // Check if there's code with no UX docs
      let hasCode = false
      for (const codeDir of config.codeDir) {
        const codeFiles = await github.getDirectory(codeDir)
        if (codeFiles.length > 0) hasCode = true
      }

      if (hasCode) {
        report += `- ⚠️ Code exists but no UX docs in \`${config.docDir}/\`\n`
        totalGaps++
      } else {
        report += `- No code or docs (feature not started)\n`
      }
    } else {
      for (const uxFile of uxFiles.filter((f) => f.endsWith('.md'))) {
        const doc = await github.getFile(uxFile)
        if (!doc) continue
        totalDocs++

        const shipped = (doc.content.match(/✅/g) || []).length
        const planned = (doc.content.match(/⏳/g) || []).length
        totalShipped += shipped
        totalPlanned += planned

        report += `- \`${uxFile.split('/').pop()}\`: ${shipped} shipped, ${planned} planned\n`
      }
    }
    report += '\n'
  }

  report = `## UX Audit — ${new Date().toISOString().split('T')[0]}\n\n` +
    `### Summary\n` +
    `- Feature areas audited: ${areasToAudit.length}\n` +
    `- UX docs found: ${totalDocs}\n` +
    `- Shipped features documented: ${totalShipped}\n` +
    `- Planned features documented: ${totalPlanned}\n` +
    `- Documentation gaps: ${totalGaps}\n\n` +
    report.split('\n').slice(2).join('\n')

  report += `\n### Recommended Actions\n`
  if (totalGaps > 0) {
    report += `1. Create UX docs for ${totalGaps} undocumented areas\n`
  }
  if (totalPlanned > 0) {
    report += `2. Review ${totalPlanned} planned features — any shipped?\n`
  }
  report += `3. Run \`ux:update <area>\` for specific feature areas\n`

  const endTime = Date.now()
  return {
    success: true, action: 'ux:audit', report, changes, errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: totalDocs + areasToAudit.length, filesChanged: 0, apiCalls: github.apiCalls },
    nextActions: ['`ux:update <area>` for specific updates'],
  }
}

// ═══════════════════════════════════════════════════════════════
// UX:WIREFRAME
// ═══════════════════════════════════════════════════════════════

export async function uxWireframe(
  github: GitHubClient,
  analyzer: Analyzer,
  request: DocAgentRequest
): Promise<DocAgentResult> {
  const startTime = Date.now()

  const featureArea = (request.params?.feature_area as string) || request.scope || ''
  const capability = (request.params?.capability as string) || ''
  const viewport = (request.params?.viewport as string) || 'desktop'

  if (!featureArea) {
    return {
      success: false, action: 'ux:wireframe',
      report: '## Error\n\nMissing required: `feature_area`',
      changes: [], errors: ['feature_area is required'],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  log.info('Generating wireframe', { featureArea, capability, viewport })

  // Read HTML/CSS for the feature
  const area = UX_AREAS[featureArea]
  if (!area) {
    return {
      success: false, action: 'ux:wireframe',
      report: `## Error\n\nUnknown feature area: ${featureArea}`,
      changes: [], errors: [`Unknown: ${featureArea}`],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: 0 },
    }
  }

  // Gather UI code for analysis
  let uiCode = ''
  for (const codeDir of area.codeDir) {
    const files = await github.getDirectory(codeDir)
    const htmlCss = files.filter((f) => f.endsWith('.html') || f.endsWith('.css'))
    for (const f of htmlCss.slice(0, 3)) {
      const file = await github.getFile(f)
      if (file) {
        uiCode += `\n<!-- ${f} -->\n${file.content.slice(0, 3000)}\n`
      }
    }
  }

  if (!uiCode) {
    return {
      success: true, action: 'ux:wireframe',
      report: `## Wireframe — ${featureArea}\n\nNo HTML/CSS files found in ${area.codeDir.join(', ')}. Cannot generate wireframe.`,
      changes: [], errors: [],
      metrics: { startTime, endTime: Date.now(), durationMs: Date.now() - startTime, filesRead: 0, filesChanged: 0, apiCalls: github.apiCalls },
    }
  }

  // Use Claude to generate ASCII wireframe
  const prompt = `Generate an ASCII wireframe for the ${featureArea} ${capability || ''} feature based on this HTML/CSS code. Show the ${viewport} layout.
Use box-drawing characters (┌─┐│└─┘) for borders. Show major UI elements: navigation, content areas, buttons, forms, cards.
Keep it under 40 lines. Label each section.`

  const wireframe = await analyzer.analyze(prompt, uiCode)

  let report = `## Wireframe — ${featureArea}${capability ? ': ' + capability : ''}\n\n`
  report += `**Viewport**: ${viewport}\n\n`
  report += `\`\`\`\n${wireframe}\n\`\`\`\n\n`
  report += `### Recommended Actions\n`
  report += `1. Add this wireframe to the UX doc for ${featureArea}\n`
  report += `2. Run \`ux:update ${featureArea}\` to update feature status\n`

  const endTime = Date.now()
  return {
    success: true, action: 'ux:wireframe', report, changes: [], errors: [],
    metrics: { startTime, endTime, durationMs: endTime - startTime, filesRead: 3, filesChanged: 0, apiCalls: github.apiCalls + analyzer.apiCalls },
    nextActions: [`\`ux:update ${featureArea}\``],
  }
}
