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
  action: 'sync-structure' | 'update-page' | 'create-structure' | 'cleanup' | 'detect-moves'
  structure?: Structure
  page?: PageUpdate
  dryRun?: boolean  // For cleanup: preview without deleting
  skipContent?: boolean  // For sync-structure: only create pages, skip content updates
  pageSources?: Record<string, 'ai' | 'human'>  // For cleanup: track page origins
  protectHuman?: boolean  // For cleanup: protect human-created pages from deletion
}

interface MovedPage {
  title: string
  file?: string
  expectedParent: string
  actualParent: string
}

interface SyncResult {
  success: boolean
  created: string[]
  updated: string[]
  skipped: string[]
  deleted: string[]
  protected: string[]  // Human-created pages that were protected from deletion
  moved: MovedPage[]  // Pages that were moved in Notion
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

  // Check if a page is empty (no content, or only child pages)
  async isPageEmpty(pageId: string): Promise<boolean> {
    try {
      const results = await this.request(`/blocks/${pageId}/children?page_size=100`)

      // A page is empty if it has no blocks, or only child_page blocks
      const contentBlocks = results.results.filter(
        (block: any) => block.type !== 'child_page'
      )

      return contentBlocks.length === 0
    } catch (e) {
      // If we can't read it, assume it's not empty (safer)
      return false
    }
  }

  // Check if a page was created by a human (person) vs bot (integration/AI)
  async isHumanCreated(pageId: string): Promise<boolean> {
    try {
      const page = await this.request(`/pages/${pageId}`)

      // Check created_by type: "person" = human, "bot" = integration/AI
      const createdByType = page.created_by?.type

      return createdByType === 'person'
    } catch (e) {
      // If we can't read it, assume it's human-created (safer)
      return true
    }
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

    // Add new blocks in batches of 100 (Notion API limit)
    const blocks = this.markdownToBlocks(content)
    const BATCH_SIZE = 100

    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      const batch = blocks.slice(i, i + BATCH_SIZE)
      if (batch.length > 0) {
        await this.request(`/blocks/${pageId}/children`, {
          method: 'PATCH',
          body: JSON.stringify({ children: batch }),
        })
        // Small delay between batches to avoid rate limits
        if (i + BATCH_SIZE < blocks.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
    }
  }

  async updatePageWithBlocks(pageId: string, blocks: any[]): Promise<void> {
    // Get existing blocks
    const existingBlocks = await this.request(`/blocks/${pageId}/children`)

    // Delete existing blocks
    for (const block of existingBlocks.results) {
      try {
        await this.request(`/blocks/${block.id}`, { method: 'DELETE' })
      } catch (e) {
        // Ignore deletion errors
      }
    }

    // Add new blocks in batches of 100
    const BATCH_SIZE = 100

    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      const batch = blocks.slice(i, i + BATCH_SIZE)
      if (batch.length > 0) {
        await this.request(`/blocks/${pageId}/children`, {
          method: 'PATCH',
          body: JSON.stringify({ children: batch }),
        })
        if (i + BATCH_SIZE < blocks.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
    }
  }

  async archivePage(pageId: string): Promise<void> {
    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
  }

  async movePage(pageId: string, newParentId: string): Promise<void> {
    await this.request(`/pages/${pageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        parent: { page_id: newParentId },
      }),
    })
  }

  async findOrCreateArchiveFolder(rootId: string): Promise<string> {
    // Look for existing Archive folder under root
    const children = await this.getChildPages(rootId)
    const archiveId = children.get('Archive')

    if (archiveId) {
      return archiveId
    }

    // Create Archive folder
    return await this.createPage(rootId, 'Archive', '🗄️')
  }

  async getPageInfo(pageId: string): Promise<{ id: string; title: string; parentId: string | null; parentTitle: string | null }> {
    const page = await this.request(`/pages/${pageId}`)

    const titleProp = Object.values(page.properties).find(
      (prop: any) => prop.type === 'title'
    ) as any
    const title = titleProp?.title?.[0]?.plain_text || ''

    let parentId: string | null = null
    let parentTitle: string | null = null

    if (page.parent?.type === 'page_id') {
      parentId = page.parent.page_id
      // Get parent's title
      try {
        const parentPage = await this.request(`/pages/${parentId}`)
        const parentTitleProp = Object.values(parentPage.properties).find(
          (prop: any) => prop.type === 'title'
        ) as any
        parentTitle = parentTitleProp?.title?.[0]?.plain_text || null
      } catch (e) {
        // Ignore - parent might not be accessible
      }
    }

    return { id: pageId, title, parentId, parentTitle }
  }

  async findPageWithParent(title: string): Promise<{ id: string; parentTitle: string | null } | null> {
    const results = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        query: title,
        filter: { property: 'object', value: 'page' },
        page_size: 10,
      }),
    })

    for (const page of results.results) {
      const titleProp = Object.values(page.properties).find(
        (prop: any) => prop.type === 'title'
      ) as any
      const pageTitle = titleProp?.title?.[0]?.plain_text

      if (pageTitle === title) {
        let parentTitle: string | null = null

        if (page.parent?.type === 'page_id') {
          try {
            const parentPage = await this.request(`/pages/${page.parent.page_id}`)
            const parentTitleProp = Object.values(parentPage.properties).find(
              (prop: any) => prop.type === 'title'
            ) as any
            parentTitle = parentTitleProp?.title?.[0]?.plain_text || null
          } catch (e) {
            // Ignore
          }
        }

        return { id: page.id, parentTitle }
      }
    }

    return null
  }

  // Check if a URL is valid for Notion (must be absolute http/https URL)
  private isValidNotionUrl(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      // Relative URLs or malformed URLs will throw
      return false
    }
  }

  private parseRichText(text: string): any[] {
    const segments: any[] = []
    let remaining = text

    while (remaining.length > 0) {
      // Link: [text](url)
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
      if (linkMatch) {
        const linkText = linkMatch[1]
        const linkUrl = linkMatch[2]

        // Only create a link if the URL is valid for Notion
        if (this.isValidNotionUrl(linkUrl)) {
          segments.push({
            type: 'text',
            text: { content: linkText, link: { url: linkUrl } },
          })
        } else {
          // Invalid URL - render as plain text with the link text only
          segments.push({
            type: 'text',
            text: { content: linkText },
          })
        }
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

        const codeContent = codeLines.join('\n')

        // Notion supported languages
        const validLanguages = new Set([
          'abap', 'arduino', 'bash', 'basic', 'c', 'clojure', 'coffeescript',
          'cpp', 'csharp', 'css', 'dart', 'diff', 'docker', 'elixir', 'elm',
          'erlang', 'flow', 'fortran', 'fsharp', 'gherkin', 'glsl', 'go',
          'graphql', 'groovy', 'haskell', 'html', 'java', 'javascript', 'json',
          'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript', 'lua',
          'makefile', 'markdown', 'markup', 'matlab', 'mermaid', 'nix',
          'objective-c', 'ocaml', 'pascal', 'perl', 'php', 'plain text',
          'powershell', 'prolog', 'protobuf', 'python', 'r', 'reason', 'ruby',
          'rust', 'sass', 'scala', 'scheme', 'scss', 'shell', 'sql', 'swift',
          'typescript', 'vb.net', 'verilog', 'vhdl', 'visual basic',
          'webassembly', 'xml', 'yaml'
        ])

        // Language aliases
        const languageAliases: Record<string, string> = {
          'js': 'javascript',
          'ts': 'typescript',
          'sh': 'shell',
          'zsh': 'shell',
          'yml': 'yaml',
          'dockerfile': 'docker',
          'objc': 'objective-c',
          'objective-c': 'objective-c',
          'objectivec': 'objective-c',
          'c++': 'cpp',
          'c#': 'csharp',
          'cs': 'csharp',
          'f#': 'fsharp',
          'vb': 'visual basic',
          'vbnet': 'vb.net',
          'tex': 'latex',
          'console': 'shell',
          'terminal': 'shell',
          'text': 'plain text',
          'txt': 'plain text',
          'plaintext': 'plain text',
        }

        // Normalize language: check aliases first, then validate
        let langNormalized = languageAliases[language.toLowerCase()] || language.toLowerCase()
        if (!validLanguages.has(langNormalized)) {
          langNormalized = 'plain text'
        }

        // Notion limits code block text to 2000 chars - split if needed
        if (codeContent.length <= 2000) {
          blocks.push({
            object: 'block',
            type: 'code',
            code: {
              rich_text: [{ type: 'text', text: { content: codeContent } }],
              language: langNormalized,
            },
          })
        } else {
          // Split into chunks of 2000 chars
          for (let start = 0; start < codeContent.length; start += 2000) {
            blocks.push({
              object: 'block',
              type: 'code',
              code: {
                rich_text: [{ type: 'text', text: { content: codeContent.slice(start, start + 2000) } }],
                language: langNormalized,
              },
            })
          }
        }
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
// TABLE OF CONTENTS GENERATOR
// ═══════════════════════════════════════════════════════════════

// Generate linked TOC blocks with page mentions
function generateLinkedTocBlocks(
  title: string,
  children: PageDef[],
  childIds: Map<string, string>
): any[] {
  const blocks: any[] = []

  // Add title heading
  blocks.push({
    object: 'block',
    type: 'heading_1',
    heading_1: {
      rich_text: [{ type: 'text', text: { content: title } }],
    },
  })

  // Add "Contents" heading
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: 'Contents' } }],
    },
  })

  // Add TOC items as bulleted list with page mentions
  function addTocItems(items: PageDef[], ids: Map<string, string>) {
    for (const item of items) {
      const pageId = ids.get(item.title)
      const icon = item.icon || '📄'

      if (pageId) {
        // Create bulleted list item with page mention (linked)
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              { type: 'text', text: { content: `${icon} ` } },
              {
                type: 'mention',
                mention: {
                  type: 'page',
                  page: { id: pageId },
                },
              },
            ],
          },
        })
      } else {
        // Fallback: plain text if page ID not found
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              { type: 'text', text: { content: `${icon} ` } },
              {
                type: 'text',
                text: { content: item.title },
                annotations: { bold: true },
              },
            ],
          },
        })
      }

      // Add nested children as indented items (shown inline for simplicity)
      if (item.children && item.children.length > 0) {
        for (const child of item.children) {
          const childPageId = ids.get(child.title)
          const childIcon = child.icon || '📄'

          if (childPageId) {
            blocks.push({
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [
                  { type: 'text', text: { content: `    ${childIcon} ` } },
                  {
                    type: 'mention',
                    mention: {
                      type: 'page',
                      page: { id: childPageId },
                    },
                  },
                ],
              },
            })
          } else {
            blocks.push({
              object: 'block',
              type: 'bulleted_list_item',
              bulleted_list_item: {
                rich_text: [
                  { type: 'text', text: { content: `    ${childIcon} ` } },
                  {
                    type: 'text',
                    text: { content: child.title },
                    annotations: { bold: true },
                  },
                ],
              },
            })
          }
        }
      }
    }
  }

  addTocItems(children, childIds)

  return blocks
}

// Collect all page IDs from a tree of pages (title -> id mapping)
function collectPageIds(
  pages: PageDef[],
  existingIds: Map<string, string>,
  collected: Map<string, string> = new Map()
): Map<string, string> {
  for (const page of pages) {
    const id = existingIds.get(page.title)
    if (id) {
      collected.set(page.title, id)
    }
    if (page.children) {
      collectPageIds(page.children, existingIds, collected)
    }
  }
  return collected
}

// ═══════════════════════════════════════════════════════════════
// SYNC LOGIC
// ═══════════════════════════════════════════════════════════════

async function syncStructure(
  client: NotionClient,
  structure: Structure,
  result: SyncResult,
  skipContent = false
): Promise<void> {
  // Find root page
  const rootId = await client.findPageByTitle(structure.root)
  if (!rootId) {
    result.errors.push(`Root page '${structure.root}' not found. Create it in Notion first.`)
    return
  }

  // Recursively create/sync pages under their correct parents
  // Returns a map of title -> pageId for all pages synced
  async function syncPages(
    parentId: string,
    pages: PageDef[],
    depth = 0,
    parentPath = ''
  ): Promise<Map<string, string>> {
    // Get existing children of this parent
    const existingChildren = await client.getChildPages(parentId)
    const syncedIds = new Map<string, string>()

    for (const page of pages) {
      const pagePath = parentPath ? `${parentPath} > ${page.title}` : page.title
      const isSectionPage = page.children && page.children.length > 0 && !page.content

      try {
        // For section pages: create without content first, we'll add linked TOC after children
        // For content pages: use the file content
        let contentToUse: string | undefined = undefined
        if (!skipContent && page.content) {
          contentToUse = page.content
        }

        // Find or create under the correct parent
        const { id: pageId, created } = await client.findOrCreateChildPage(
          parentId,
          page.title,
          page.icon,
          existingChildren,
          contentToUse
        )

        syncedIds.set(page.title, pageId)

        if (created) {
          result.created.push(pagePath)
        } else if (!skipContent && contentToUse) {
          // Update existing content page
          await client.updatePageContent(pageId, contentToUse)
          result.updated.push(pagePath)
        } else if (!isSectionPage) {
          result.skipped.push(pagePath)
        }

        // Sync children recursively first (to get their IDs)
        if (page.children && pageId) {
          const childIds = await syncPages(pageId, page.children, depth + 1, pagePath)

          // Merge child IDs into our map
          for (const [title, id] of childIds) {
            syncedIds.set(title, id)
          }

          // Now update section page with linked TOC
          if (!skipContent && isSectionPage) {
            const tocBlocks = generateLinkedTocBlocks(page.title, page.children, childIds)
            await client.updatePageWithBlocks(pageId, tocBlocks)
            if (!created) {
              result.updated.push(pagePath)
            }
          }
        }

        // Rate limiting - wait between operations
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (error) {
        result.errors.push(`Failed to sync '${pagePath}': ${error.message}`)
      }
    }

    return syncedIds
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
        { title: 'Vision & Roadmap', icon: '🗺️' },
        { title: 'Decision Log', icon: '📋' },
        {
          title: 'PRDs',
          icon: '📄',
          children: [
            { title: 'Boards MVP', icon: '📋' },
            { title: 'Collaborative Boards', icon: '📋' },
            { title: 'Content Type System', icon: '📋' },
            { title: 'Corporate Management', icon: '📋' },
            { title: 'Generative Widget Ecosystem', icon: '📋' },
            { title: 'Widget Design System', icon: '📋' },
            { title: 'Widget Instrumentation', icon: '📋' },
            { title: 'Content Type and Image Systems', icon: '📋' },
          ],
        },
      ],
    },
    {
      title: 'User Experience',
      icon: '🎨',
      children: [
        {
          title: 'Design System',
          icon: '🎨',
          children: [
            { title: 'Overview', icon: '📄' },
            { title: 'Features', icon: '⭐' },
            { title: 'Changelog', icon: '📝' },
          ],
        },
        {
          title: 'Boards',
          icon: '📋',
          children: [
            { title: 'Features', icon: '⭐' },
            { title: 'Changelog', icon: '📝' },
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
        {
          title: 'Project Plans',
          icon: '📋',
          children: [
            { title: 'Boards', icon: '📄' },
            { title: 'Phase 0 Implementation', icon: '📄' },
            { title: 'Boards Original Plan', icon: '📄' },
          ],
        },
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
            { title: 'Deployment', icon: '🚀' },
            { title: 'Security', icon: '🔒' },
            { title: 'Monitoring', icon: '📈' },
          ],
        },
        {
          title: 'Technical Design',
          icon: '📐',
          children: [
            { title: 'AI Widget System', icon: '🤖' },
            { title: 'Content Type System', icon: '📄' },
            { title: 'Widget Architecture', icon: '📐' },
            { title: 'AI Widget Pipeline', icon: '🔄' },
            { title: 'Content Type and Image Systems Tech', icon: '📄' },
          ],
        },
      ],
    },
    {
      title: 'AI Agents',
      icon: '🤖',
      children: [
        { title: 'Overview', icon: '📄' },
        {
          title: 'Agents',
          icon: '🤖',
          children: [
            { title: 'Chief of Staff', icon: '👔' },
            { title: 'Documentation Sync', icon: '📚' },
            { title: 'Organizational', icon: '📋' },
            { title: 'Project Management', icon: '📅' },
            { title: 'Status Update', icon: '📊' },
            { title: 'Security & Compliance', icon: '🔒' },
            { title: 'Continuous Improvement', icon: '📈' },
          ],
        },
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
            { title: 'Project Plan', icon: '📋' },
            { title: 'Technical Design', icon: '📐' },
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
  dryRun: boolean,
  pageSources: Record<string, 'ai' | 'human'> = {},
  protectHuman: boolean = false
): Promise<void> {
  const rootId = await client.findPageByTitle(structure.root)
  if (!rootId) {
    result.errors.push(`Root page '${structure.root}' not found.`)
    return
  }

  // Get or create Archive folder
  let archiveFolderId: string | null = null
  if (!dryRun) {
    archiveFolderId = await client.findOrCreateArchiveFolder(rootId)
  }

  const expectedTitles = getExpectedTitles(structure.sections)
  // Add Archive to expected titles so we don't try to archive it
  expectedTitles.add('Archive')

  async function cleanupChildren(parentId: string, expectedForParent: PageDef[], parentPath = '') {
    const existingChildren = await client.getChildPages(parentId)
    const expectedTitlesForParent = new Set(expectedForParent.map(p => p.title))
    // Always expect Archive folder at root level
    if (parentId === rootId) {
      expectedTitlesForParent.add('Archive')
    }

    for (const [title, pageId] of existingChildren) {
      const pagePath = parentPath ? `${parentPath} > ${title}` : title

      if (!expectedTitlesForParent.has(title)) {
        // This page is not in the expected structure
        // Check Notion's created_by to determine if human or bot created
        const isHuman = protectHuman ? await client.isHumanCreated(pageId) : false

        if (isHuman) {
          // Human-created page (created by person, not bot/integration)
          // Check if it's empty before protecting
          const isEmpty = await client.isPageEmpty(pageId)

          if (isEmpty) {
            // Human-created but empty (title only) - archive it
            if (dryRun) {
              result.deleted.push(`[DRY RUN] Would archive empty human page: ${pagePath}`)
            } else {
              try {
                await client.archivePage(pageId)
                result.deleted.push(`Archived empty human page: ${pagePath}`)
                await new Promise(resolve => setTimeout(resolve, 150))
              } catch (error) {
                result.errors.push(`Failed to archive '${pagePath}': ${error.message}`)
              }
            }
          } else {
            // Human-created with content - protect from deletion
            result.protected.push(`Protected (created by human with content): ${pagePath}`)
          }
          continue
        }

        // Bot/AI-created page or protection disabled - archive it
        if (dryRun) {
          result.deleted.push(`[DRY RUN] Would archive: ${pagePath}`)
        } else {
          try {
            await client.archivePage(pageId)
            result.deleted.push(`Archived (bot-created): ${pagePath}`)
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

// Detect pages that were moved in Notion (different parent than expected)
async function detectMovedPages(
  client: NotionClient,
  structure: Structure,
  result: SyncResult
): Promise<void> {
  // Build expected parent mapping from structure
  interface PageMapping {
    title: string
    file?: string
    expectedParent: string
  }

  function buildMapping(sections: PageDef[], parentTitle: string, mappings: PageMapping[] = []): PageMapping[] {
    for (const section of sections) {
      // Only track pages that have a file mapping (actual content pages)
      if ((section as any).file) {
        mappings.push({
          title: section.title,
          file: (section as any).file,
          expectedParent: parentTitle,
        })
      }
      if (section.children) {
        buildMapping(section.children, section.title, mappings)
      }
    }
    return mappings
  }

  const mappings = buildMapping(structure.sections, structure.root)

  // Check each mapped page's actual parent in Notion
  for (const mapping of mappings) {
    try {
      const pageInfo = await client.findPageWithParent(mapping.title)

      if (pageInfo && pageInfo.parentTitle && pageInfo.parentTitle !== mapping.expectedParent) {
        result.moved.push({
          title: mapping.title,
          file: mapping.file,
          expectedParent: mapping.expectedParent,
          actualParent: pageInfo.parentTitle,
        })
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      // Ignore errors for individual pages
      console.error(`Error checking page '${mapping.title}':`, error)
    }
  }
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
      protected: [],
      moved: [],
      errors: [],
      timestamp: new Date().toISOString(),
    }

    switch (request.action) {
      case 'create-structure':
        // Create the default structure (structure only, no content)
        await syncStructure(client, DEFAULT_STRUCTURE, result, true)
        break

      case 'sync-structure':
        // Sync with provided or default structure
        // Use skipContent flag if provided (for faster structure-only sync)
        const structure = request.structure || DEFAULT_STRUCTURE
        await syncStructure(client, structure, result, request.skipContent || false)
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
        // Move pages not in expected structure to Archive folder
        // Respects source field: human-created pages are protected
        const cleanupStructure = request.structure || DEFAULT_STRUCTURE
        await cleanupLegacyPages(
          client,
          cleanupStructure,
          result,
          request.dryRun || false,
          request.pageSources || {},
          request.protectHuman || false
        )
        break

      case 'detect-moves':
        // Detect pages that were moved in Notion
        const detectStructure = request.structure || DEFAULT_STRUCTURE
        await detectMovedPages(client, detectStructure, result)
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
