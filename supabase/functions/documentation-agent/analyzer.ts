// Documentation Agent - Claude Analyzer
// Uses Claude API for intelligent content analysis

import { createLogger } from './logger.ts'

const log = createLogger('analyzer')

export class Analyzer {
  private apiKey: string
  private model: string
  apiCalls = 0

  constructor(apiKey: string, model = 'claude-3-haiku-20240307') {
    this.apiKey = apiKey
    this.model = model
  }

  async analyze(prompt: string, context: string): Promise<string> {
    this.apiCalls++
    log.info('Analyzing content', { promptLength: prompt.length, contextLength: context.length })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\n---\n\n${context}`,
          },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error: ${response.status} - ${error}`)
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>
    }

    return data.content[0]?.text || ''
  }

  // ═══════════════════════════════════════════════════════════════
  // SPECIALIZED ANALYSIS FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

  async matchCommitsToTasks(
    commitMessages: string[],
    planItems: Array<{ title: string; status: string }>
  ): Promise<Array<{ commitIndex: number; taskTitle: string; confidence: number }>> {
    const prompt = `Match these git commit messages to project plan tasks. For each commit, identify which task it completes (if any). Return JSON array of matches.

Commits:
${commitMessages.map((m, i) => `${i}: ${m}`).join('\n')}

Tasks (only match pending/in-progress ones):
${planItems.filter(t => t.status !== 'complete').map(t => `- ${t.title} [${t.status}]`).join('\n')}

Return ONLY valid JSON: [{"commitIndex": 0, "taskTitle": "exact task title", "confidence": 0.9}]
Return empty array [] if no matches.`

    const result = await this.analyze(prompt, '')
    try {
      const jsonMatch = result.match(/\[[\s\S]*\]/)
      return jsonMatch ? JSON.parse(jsonMatch[0]) : []
    } catch {
      log.warn('Failed to parse commit-task matches', { result })
      return []
    }
  }

  async detectSubProduct(description: string): Promise<string> {
    const prompt = `Classify this work item into one sub-product. Return ONLY the sub-product name.

Sub-products: Boards, AI Widgets, Content Types, Design System, Sharing, Notion Sync, Soundscape, Systemic

Work item: "${description}"

Return ONLY the sub-product name, nothing else.`

    const result = await this.analyze(prompt, '')
    return result.trim()
  }

  async classifyCaptureType(description: string): Promise<'bug' | 'work' | 'tech-debt'> {
    // Fast heuristic — no API call needed for obvious cases
    const lower = description.toLowerCase()

    const bugWords = ['broken', 'fails', 'crash', 'wrong', 'error', "doesn't work", 'bug', 'regression']
    const debtWords = ['hack', 'workaround', 'temporary', 'refactor', 'cleanup', 'tech debt', 'brittle']

    if (bugWords.some((w) => lower.includes(w))) return 'bug'
    if (debtWords.some((w) => lower.includes(w))) return 'tech-debt'
    return 'work'
  }

  async classifySeverity(description: string): Promise<'critical' | 'high' | 'medium' | 'low'> {
    const lower = description.toLowerCase()

    if (['crash', 'data loss', 'security', "can't use"].some((w) => lower.includes(w))) return 'critical'
    if (['broken', 'fails', 'incorrect'].some((w) => lower.includes(w))) return 'high'
    if (['slow', 'ugly', 'annoying', 'inconsistent'].some((w) => lower.includes(w))) return 'medium'
    return 'low'
  }

  async compareDocToCode(
    docContent: string,
    codeContent: string,
    docPath: string
  ): Promise<{ stale: boolean; changes: string[]; suggestions: string[] }> {
    const prompt = `Compare this documentation against the actual code. Identify:
1. Claims in the doc that are contradicted by the code
2. Features in the code not mentioned in the doc
3. Specific updates needed

Documentation file: ${docPath}

Return JSON: {"stale": true/false, "changes": ["change1", "change2"], "suggestions": ["suggestion1"]}`

    const context = `DOCUMENTATION:\n${docContent.slice(0, 3000)}\n\nCODE:\n${codeContent.slice(0, 3000)}`
    const result = await this.analyze(prompt, context)

    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      return jsonMatch ? JSON.parse(jsonMatch[0]) : { stale: false, changes: [], suggestions: [] }
    } catch {
      return { stale: false, changes: [], suggestions: [] }
    }
  }
}
