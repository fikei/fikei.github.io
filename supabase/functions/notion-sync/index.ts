// Supabase Edge Function: notion-sync
// Automatic sync from GitHub to Notion workspace
// Triggered by GitHub Actions on push
//
// POST /functions/v1/notion-sync
// Body: { action: 'sync-structure' | 'update-page', structure?: Structure, page?: PageUpdate }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface PageDef {
  title: string
  icon: string
  content?: string  // Markdown content
  children?: PageDef[]
}

interface Structure {
  root: string  // Root page title to find/create under
  sections: PageDef[]
}

interface PageUpdate {
  pageTitle: string
  content: string
}

interface SyncRequest {
  action: 'sync-structure' | 'update-page' | 'create-structure' | 'cleanup'
  structure?: Structure
  page?: PageUpdate
  dryRun?: boolean  // For cleanup: preview without deleting
}

interface SyncResult {
  success: boolean
  created: string[]
  updated: string[]
  skipped: string[]
  deleted: string[]
  errors: string[]
  timestamp: string
}

// ═══════════════════════════════════════════════════════════════
// NOTION CLIENT
// ═══════════════════════════════════════════════════════════════

class NotionClient {
  private apiKey: string
  private baseUrl = 'https://api.notion.com/v1'

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Notion API error: ${response.status} - ${error}`)
    }

    return response.json()
  }

  async findPageByTitle(title: string): Promise<string | null> {
    const results = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        query: title,
        filter: { property: 'object', value: 'page' },
        page_size: 10,
      }),
    })

    // Find exact match
    for (const page of results.results) {
      const titleProp = Object.values(page.properties).find(
        (prop: any) => prop.type === 'title'
      ) as any
      const pageTitle = titleProp?.title?.[0]?.plain_text
      if (pageTitle === title) {
        return page.id
      }
    }

    return null
  }

  async getChildPages(parentId: string): Promise<Map<string, string>> {
    const children = new Map<string, string>()

    try {
      const results = await this.request(`/blocks/${parentId}/children?page_size=100`)

      for (const block of results.results) {
        if (block.type === 'child_page') {
          children.set(block.child_page.title, block.id)
        }
      }
    } catch (e) {
      // Ignore errors - parent might be new
    }

    return children
  }

  async findOrCreateChildPage(
    parentId: string,
    title: string,
    icon: string,
    existingChildren: Map<string, string>,
    content?: string
  ): Promise<{ id: string; created: boolean }> {
    // Check if already exists under this parent
    const existingId = existingChildren.get(title)
    if (existingId) {
      return { id: existingId, created: false }
    }

    // Create new page under parent
    const id = await this.createPage(parentId, title, icon, content)
    return { id, created: true }
  }

  async createPage(parentId: string, title: string, icon: string, content?: string): Promise<string> {
    const children = content ? this.markdownToBlocks(content) : []

    const page = await this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: parentId },
        icon: { type: 'emoji', emoji: icon },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
        children: children.slice(0, 100), // Notion limit
      }),
    })

    return page.id
  }

  async updatePageContent(pageId: string, content: string): Promise<void> {
    // Get existing blocks
    const existingBlocks = await this.request(`/blocks/${pageId}/children`)

    // Delete existing blocks (in batches to avoid rate limits)
    for (const block of existingBlocks.results) {
      try {
        await this.request(`/blocks/${block.id}`, { method: 'DELETE' })
      } catch (e) {
        // Ignore deletion errors
      }
    }

    // Add new blocks
    const blocks = this.markdownToBlocks(content)
    if (blocks.length > 0) {
      await this.request(`/blocks/${pageId}/children`, {
        method: 'PATCH',
        body: JSON.stringify({ children: blocks.slice(0, 100) }),
      })
    }
  }

  async archivePage(pageId: string): Promise<void> {
    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
  }

  private parseRichText(text: string): any[] {
    const segments: any[] = []
    let remaining = text

    while (remaining.length > 0) {
      // Link: [text](url)
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        segments.push({
          type: 'text',
          text: { content: linkMatch[1], link: { url: linkMatch[2] } },
        })
        remaining = remaining.slice(linkMatch[0].length)
        continue
      }

      // Bold: **text** or __text__
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/) || remaining.match(/^__([^_]+)__/)
      if (boldMatch) {
        segments.push({
          type: 'text',
          text: { content: boldMatch[1] },
          annotations: { bold: true },
        })
        remaining = remaining.slice(boldMatch[0].length)
        continue
      }

      // Italic: *text* or _text_
      const italicMatch = remaining.match(/^\*([^*]+)\*/) || remaining.match(/^_([^_]+)_/)
      if (italicMatch) {
        segments.push({
          type: 'text',
          text: { content: italicMatch[1] },
          annotations: { italic: true },
        })
        remaining = remaining.slice(italicMatch[0].length)
        continue
      }

      // Inline code: `text`
      const codeMatch = remaining.match(/^`([^`]+)`/)
      if (codeMatch) {
        segments.push({
          type: 'text',
          text: { content: codeMatch[1] },
          annotations: { code: true },
        })
        remaining = remaining.slice(codeMatch[0].length)
        continue
      }

      // Plain text until next special character
      const plainMatch = remaining.match(/^[^[*_`]+/)
      if (plainMatch) {
        segments.push({
          type: 'text',
          text: { content: plainMatch[0] },
        })
        remaining = remaining.slice(plainMatch[0].length)
        continue
      }

      // Single special character (no match found)
      segments.push({
        type: 'text',
        text: { content: remaining[0] },
      })
      remaining = remaining.slice(1)
    }

    return segments.length > 0 ? segments : [{ type: 'text', text: { content: text } }]
  }

  private markdownToBlocks(markdown: string): any[] {
    const lines = markdown.split('\n')
    const blocks: any[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]

      // Skip empty lines
      if (!line.trim()) {
        i++
        continue
      }

      // Code block: ```language
      if (line.startsWith('```')) {
        const language = line.slice(3).trim() || 'plain text'
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i])
          i++
        }
        i++ // Skip closing ```
        blocks.push({
          object: 'block',
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
            language: language === 'js' ? 'javascript' : language === 'ts' ? 'typescript' : language,
          },
        })
        continue
      }

      // Table: line contains | characters (detect table rows)
      const trimmedLine = line.trim()
      if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
        const tableLines: string[] = []
        const dataRows: string[][] = []
        let headerRow: string[] | null = null

        while (i < lines.length) {
          const currentLine = lines[i].trim()

          // Stop if not a table row
          if (!currentLine.startsWith('|') || !currentLine.endsWith('|')) {
            break
          }

          tableLines.push(currentLine)

          // Check if separator row (|---|---|)
          if (/^\|[\s\-:|]+\|$/.test(currentLine)) {
            i++
            continue
          }

          // Parse cells
          const cells = currentLine.split('|').slice(1, -1).map(c => c.trim())
          if (cells.length > 0) {
            if (headerRow === null) {
              headerRow = cells
            } else {
              dataRows.push(cells)
            }
          }
          i++
        }

        // Render table as formatted text blocks for reliable display
        if (headerRow && headerRow.length > 0) {
          // Calculate column widths
          const allRows = [headerRow, ...dataRows]
          const colWidths = headerRow.map((_, colIdx) =>
            Math.max(...allRows.map(row => (row[colIdx] || '').length))
          )

          // Create header as bold paragraph
          const headerText = headerRow.map((cell, idx) =>
            cell.padEnd(colWidths[idx])
          ).join(' | ')

          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: headerText },
                annotations: { bold: true },
              }],
            },
          })

          // Create separator
          const separator = colWidths.map(w => '-'.repeat(w)).join('-+-')
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{
                type: 'text',
                text: { content: separator },
                annotations: { code: true },
              }],
            },
          })

          // Create data rows
          for (const row of dataRows) {
            const rowText = headerRow.map((_, idx) =>
              (row[idx] || '').padEnd(colWidths[idx])
            ).join(' | ')

            blocks.push({
              object: 'block',
              type: 'paragraph',
              paragraph: { rich_text: this.parseRichText(rowText) },
            })
          }

          // Add spacing after table
          blocks.push({
            object: 'block',
            type: 'paragraph',
            paragraph: { rich_text: [{ type: 'text', text: { content: '' } }] },
          })
        }
        continue
      }

      // Heading 1: #
      if (line.startsWith('# ')) {
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: { rich_text: this.parseRichText(line.slice(2)) },
        })
        i++
        continue
      }

      // Heading 2: ##
      if (line.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: this.parseRichText(line.slice(3)) },
        })
        i++
        continue
      }

      // Heading 3: ###
      if (line.startsWith('### ')) {
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: this.parseRichText(line.slice(4)) },
        })
        i++
        continue
      }

      // Numbered list: 1. or 1)
      const numberedMatch = line.match(/^(\d+)[.)]\s+(.*)/)
      if (numberedMatch) {
        blocks.push({
          object: 'block',
          type: 'numbered_list_item',
          numbered_list_item: { rich_text: this.parseRichText(numberedMatch[2]) },
        })
        i++
        continue
      }

      // Bullet list: - or *
      if (line.startsWith('- ') || line.startsWith('* ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: this.parseRichText(line.slice(2)) },
        })
        i++
        continue
      }

      // Checkbox: - [ ] or - [x]
      const checkboxMatch = line.match(/^- \[([ x])\]\s+(.*)/)
      if (checkboxMatch) {
        blocks.push({
          object: 'block',
          type: 'to_do',
          to_do: {
            rich_text: this.parseRichText(checkboxMatch[2]),
            checked: checkboxMatch[1] === 'x',
          },
        })
        i++
        continue
      }

      // Quote: >
      if (line.startsWith('> ')) {
        blocks.push({
          object: 'block',
          type: 'quote',
          quote: { rich_text: this.parseRichText(line.slice(2)) },
        })
        i++
        continue
      }

      // Divider: ---
      if (line === '---' || line === '***' || line === '___') {
        blocks.push({ object: 'block', type: 'divider', divider: {} })
        i++
        continue
      }

      // Callout: > [!NOTE] or > [!TIP] etc.
      const calloutMatch = line.match(/^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*(.*)/)
      if (calloutMatch) {
        const icons: Record<string, string> = {
          NOTE: 'ℹ️',
          TIP: '💡',
          WARNING: '⚠️',
          IMPORTANT: '❗',
        }
        blocks.push({
          object: 'block',
          type: 'callout',
          callout: {
            rich_text: this.parseRichText(calloutMatch[2] || calloutMatch[1]),
            icon: { type: 'emoji', emoji: icons[calloutMatch[1]] || 'ℹ️' },
          },
        })
        i++
        continue
      }

      // Default: paragraph
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: this.parseRichText(line) },
      })
      i++
    }

    return blocks
  }
}

// ═══════════════════════════════════════════════════════════════
// SYNC LOGIC
// ═══════════════════════════════════════════════════════════════

async function syncStructure(
  client: NotionClient,
  structure: Structure,
  result: SyncResult
): Promise<void> {
  // Find root page
  const rootId = await client.findPageByTitle(structure.root)
  if (!rootId) {
    result.errors.push(`Root page '${structure.root}' not found. Create it in Notion first.`)
    return
  }

  // Recursively create/sync pages under their correct parents
  async function syncPages(parentId: string, pages: PageDef[], depth = 0, parentPath = '') {
    // Get existing children of this parent
    const existingChildren = await client.getChildPages(parentId)

    for (const page of pages) {
      const pagePath = parentPath ? `${parentPath} > ${page.title}` : page.title

      try {
        // Find or create under the correct parent
        const { id: pageId, created } = await client.findOrCreateChildPage(
          parentId,
          page.title,
          page.icon,
          existingChildren,
          page.content
        )

        if (created) {
          result.created.push(pagePath)
        } else if (page.content) {
          // Update existing page content
          await client.updatePageContent(pageId, page.content)
          result.updated.push(pagePath)
        } else {
          result.skipped.push(pagePath)
        }

        // Sync children recursively
        if (page.children && pageId) {
          await syncPages(pageId, page.children, depth + 1, pagePath)
        }

        // Rate limiting - wait between operations
        await new Promise(resolve => setTimeout(resolve, 150))
      } catch (error) {
        result.errors.push(`Failed to sync '${pagePath}': ${error.message}`)
      }
    }
  }

  await syncPages(rootId, structure.sections)
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT STRUCTURE
// ═══════════════════════════════════════════════════════════════

const DEFAULT_STRUCTURE: Structure = {
  root: 'Ctrl Rodeo',
  sections: [
    {
      title: 'Strategy',
      icon: '🎯',
      children: [
        { title: 'Vision & Roadmap', icon: '📄' },
        {
          title: 'PRDs',
          icon: '📄',
          children: [
            { title: 'Things I Like (Boards)', icon: '📋' },
            { title: 'Collaborative Boards', icon: '📋' },
            { title: 'Content Type System', icon: '📋' },
            { title: 'Corporate Management', icon: '📋' },
          ],
        },
        { title: 'Decision Log (ADRs)', icon: '📄' },
      ],
    },
    {
      title: 'Product',
      icon: '📦',
      children: [
        {
          title: 'Boards',
          icon: '📋',
          children: [
            { title: 'Overview', icon: '📄' },
            { title: 'Features', icon: '⭐' },
            { title: 'Changelog', icon: '📝' },
            { title: 'Human TODOs', icon: '👤' },
          ],
        },
        {
          title: 'Design System',
          icon: '🎨',
          children: [
            { title: 'Overview', icon: '📄' },
            { title: 'Features', icon: '⭐' },
            { title: 'Changelog', icon: '📝' },
            { title: 'Human TODOs', icon: '👤' },
          ],
        },
      ],
    },
    {
      title: 'Execution',
      icon: '🔨',
      children: [
        { title: 'Global Backlog', icon: '📊' },
        { title: 'Current Sprint', icon: '🏃' },
        { title: 'Recently Shipped', icon: '✅' },
        { title: 'Blocked/Waiting', icon: '🚧' },
      ],
    },
    {
      title: 'Infrastructure',
      icon: '🏗',
      children: [
        {
          title: 'Architecture',
          icon: '📐',
          children: [
            { title: 'System Overview', icon: '🗺️' },
          ],
        },
        {
          title: 'Deployment',
          icon: '🚀',
          children: [
            { title: 'Overview', icon: '📄' },
          ],
        },
        { title: 'Security', icon: '🔒' },
        { title: 'Monitoring', icon: '📈' },
      ],
    },
    {
      title: 'AI Agents',
      icon: '🤖',
      children: [
        { title: 'Agent Definitions', icon: '📋' },
        { title: 'Workflows', icon: '🔄' },
        { title: 'Logs/Reports', icon: '📊' },
      ],
    },
    {
      title: 'Playground',
      icon: '🧪',
      children: [
        {
          title: 'Soundscape',
          icon: '🎵',
          children: [
            { title: 'Overview', icon: '📄' },
          ],
        },
        {
          title: 'Systemic',
          icon: '🔧',
          children: [
            { title: 'Overview', icon: '📄' },
          ],
        },
        {
          title: 'Favicon',
          icon: '🎨',
          children: [
            { title: 'Overview', icon: '📄' },
          ],
        },
      ],
    },
    {
      title: 'Operations',
      icon: '📅',
      children: [
        { title: 'Costs', icon: '💰' },
        { title: 'Calendar', icon: '📆' },
        { title: 'Meeting Notes', icon: '📝' },
        { title: 'Admin', icon: '⚙️' },
      ],
    },
  ],
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP LOGIC
// ═══════════════════════════════════════════════════════════════

function getExpectedTitles(pages: PageDef[]): Set<string> {
  const titles = new Set<string>()
  for (const page of pages) {
    titles.add(page.title)
    if (page.children) {
      for (const child of page.children) {
        titles.add(child.title)
        if (child.children) {
          for (const grandchild of child.children) {
            titles.add(grandchild.title)
          }
        }
      }
    }
  }
  return titles
}

async function cleanupLegacyPages(
  client: NotionClient,
  structure: Structure,
  result: SyncResult,
  dryRun: boolean
): Promise<void> {
  const rootId = await client.findPageByTitle(structure.root)
  if (!rootId) {
    result.errors.push(`Root page '${structure.root}' not found.`)
    return
  }

  const expectedTitles = getExpectedTitles(structure.sections)

  async function cleanupChildren(parentId: string, expectedForParent: PageDef[], parentPath = '') {
    const existingChildren = await client.getChildPages(parentId)
    const expectedTitlesForParent = new Set(expectedForParent.map(p => p.title))

    for (const [title, pageId] of existingChildren) {
      const pagePath = parentPath ? `${parentPath} > ${title}` : title

      if (!expectedTitlesForParent.has(title)) {
        // This page is not in the expected structure - mark for deletion
        if (dryRun) {
          result.deleted.push(`[DRY RUN] ${pagePath}`)
        } else {
          try {
            await client.archivePage(pageId)
            result.deleted.push(pagePath)
            await new Promise(resolve => setTimeout(resolve, 150))
          } catch (error) {
            result.errors.push(`Failed to archive '${pagePath}': ${error.message}`)
          }
        }
      } else {
        // Page exists and is expected - check its children
        const pageDef = expectedForParent.find(p => p.title === title)
        if (pageDef?.children) {
          await cleanupChildren(pageId, pageDef.children, pagePath)
        }
      }
    }
  }

  await cleanupChildren(rootId, structure.sections)
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const notionKey = Deno.env.get('NOTION_API_KEY')
    if (!notionKey) {
      return new Response(
        JSON.stringify({ error: 'NOTION_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const request: SyncRequest = await req.json()
    const client = new NotionClient(notionKey)

    const result: SyncResult = {
      success: true,
      created: [],
      updated: [],
      skipped: [],
      deleted: [],
      errors: [],
      timestamp: new Date().toISOString(),
    }

    switch (request.action) {
      case 'create-structure':
        // Create the default structure
        await syncStructure(client, DEFAULT_STRUCTURE, result)
        break

      case 'sync-structure':
        // Sync with provided or default structure
        const structure = request.structure || DEFAULT_STRUCTURE
        await syncStructure(client, structure, result)
        break

      case 'update-page':
        // Update a single page's content
        if (!request.page) {
          result.errors.push('Missing page data for update-page action')
        } else {
          const pageId = await client.findPageByTitle(request.page.pageTitle)
          if (pageId) {
            await client.updatePageContent(pageId, request.page.content)
            result.updated.push(request.page.pageTitle)
          } else {
            result.errors.push(`Page '${request.page.pageTitle}' not found`)
          }
        }
        break

      case 'cleanup':
        // Remove pages not in the expected structure
        const cleanupStructure = request.structure || DEFAULT_STRUCTURE
        await cleanupLegacyPages(client, cleanupStructure, result, request.dryRun || false)
        break

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${request.action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    result.success = result.errors.length === 0

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Notion sync error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
