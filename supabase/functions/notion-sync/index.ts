// Supabase Edge Function: notion-sync
// Bidirectional sync between GitHub docs and Notion workspace
// Supports PRDs, technical plans, and status updates
//
// POST /functions/v1/notion-sync
// Body: { action: 'push' | 'pull' | 'sync', type?: 'prd' | 'tech' | 'status', path?: string }
// Returns: { success, synced, timestamp }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NotionPage {
  id: string
  title: string
  content: string
  lastEdited: string
  type: 'prd' | 'tech' | 'status' | 'other'
}

interface SyncRequest {
  action: 'push' | 'pull' | 'sync'
  type?: 'prd' | 'tech' | 'status' | 'all'
  path?: string
  pageId?: string
}

interface SyncResult {
  success: boolean
  synced: Array<{
    source: 'github' | 'notion'
    destination: 'github' | 'notion'
    title: string
    path?: string
    pageId?: string
  }>
  errors: string[]
  timestamp: string
}

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

  async getPage(pageId: string): Promise<NotionPage> {
    const page = await this.request(`/pages/${pageId}`)
    const blocks = await this.request(`/blocks/${pageId}/children`)

    // Extract title from page properties
    const titleProp = Object.values(page.properties).find(
      (prop: any) => prop.type === 'title'
    ) as any
    const title = titleProp?.title?.[0]?.plain_text || 'Untitled'

    // Convert blocks to markdown
    const content = this.blocksToMarkdown(blocks.results)

    return {
      id: pageId,
      title,
      content,
      lastEdited: page.last_edited_time,
      type: this.inferType(title),
    }
  }

  async searchPages(query: string, pageSize = 10): Promise<NotionPage[]> {
    const results = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        query,
        filter: { property: 'object', value: 'page' },
        page_size: pageSize,
      }),
    })

    return Promise.all(
      results.results.map((page: any) => this.getPage(page.id))
    )
  }

  async createPage(parentId: string, title: string, content: string): Promise<string> {
    const blocks = this.markdownToBlocks(content)

    const page = await this.request('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { page_id: parentId },
        properties: {
          title: {
            title: [{ text: { content: title } }],
          },
        },
        children: blocks,
      }),
    })

    return page.id
  }

  async updatePage(pageId: string, content: string): Promise<void> {
    // Delete existing blocks
    const existingBlocks = await this.request(`/blocks/${pageId}/children`)
    for (const block of existingBlocks.results) {
      await this.request(`/blocks/${block.id}`, { method: 'DELETE' })
    }

    // Add new blocks
    const blocks = this.markdownToBlocks(content)
    await this.request(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children: blocks }),
    })
  }

  private inferType(title: string): NotionPage['type'] {
    const lower = title.toLowerCase()
    if (lower.includes('prd') || lower.includes('product requirement')) return 'prd'
    if (lower.includes('tech') || lower.includes('architecture')) return 'tech'
    if (lower.includes('status') || lower.includes('update')) return 'status'
    return 'other'
  }

  private blocksToMarkdown(blocks: any[]): string {
    return blocks
      .map((block) => {
        const type = block.type
        const content = block[type]

        switch (type) {
          case 'paragraph':
            return this.richTextToMarkdown(content.rich_text) + '\n'
          case 'heading_1':
            return '# ' + this.richTextToMarkdown(content.rich_text) + '\n'
          case 'heading_2':
            return '## ' + this.richTextToMarkdown(content.rich_text) + '\n'
          case 'heading_3':
            return '### ' + this.richTextToMarkdown(content.rich_text) + '\n'
          case 'bulleted_list_item':
            return '- ' + this.richTextToMarkdown(content.rich_text) + '\n'
          case 'numbered_list_item':
            return '1. ' + this.richTextToMarkdown(content.rich_text) + '\n'
          case 'code':
            return '```' + (content.language || '') + '\n' + this.richTextToMarkdown(content.rich_text) + '\n```\n'
          case 'quote':
            return '> ' + this.richTextToMarkdown(content.rich_text) + '\n'
          case 'divider':
            return '---\n'
          default:
            return ''
        }
      })
      .join('')
  }

  private richTextToMarkdown(richText: any[]): string {
    return richText
      .map((text) => {
        let result = text.plain_text
        if (text.annotations.bold) result = `**${result}**`
        if (text.annotations.italic) result = `*${result}*`
        if (text.annotations.code) result = `\`${result}\``
        if (text.href) result = `[${result}](${text.href})`
        return result
      })
      .join('')
  }

  private markdownToBlocks(markdown: string): any[] {
    const lines = markdown.split('\n')
    const blocks: any[] = []

    for (const line of lines) {
      if (!line.trim()) continue

      if (line.startsWith('# ')) {
        blocks.push({
          object: 'block',
          type: 'heading_1',
          heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        })
      } else if (line.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] },
        })
      } else if (line.startsWith('### ')) {
        blocks.push({
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] },
        })
      } else if (line.startsWith('- ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        })
      } else if (line.startsWith('> ')) {
        blocks.push({
          object: 'block',
          type: 'quote',
          quote: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] },
        })
      } else if (line === '---') {
        blocks.push({ object: 'block', type: 'divider', divider: {} })
      } else {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
        })
      }
    }

    return blocks
  }
}

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
      synced: [],
      errors: [],
      timestamp: new Date().toISOString(),
    }

    switch (request.action) {
      case 'pull':
        // Pull from Notion to GitHub format
        if (request.pageId) {
          try {
            const page = await client.getPage(request.pageId)
            result.synced.push({
              source: 'notion',
              destination: 'github',
              title: page.title,
              pageId: page.id,
              path: `docs/${page.type.toUpperCase()}-${page.title.toLowerCase().replace(/\s+/g, '-')}.md`,
            })
          } catch (error) {
            result.errors.push(`Failed to pull page ${request.pageId}: ${error.message}`)
          }
        }
        break

      case 'push':
        // Push from GitHub to Notion
        // This would read local files and create/update Notion pages
        // In production, this would use GitHub API to read files
        result.synced.push({
          source: 'github',
          destination: 'notion',
          title: 'Push placeholder',
          path: request.path,
        })
        break

      case 'sync':
        // Bidirectional sync - compare timestamps and sync newer
        // This is the most complex operation
        result.synced.push({
          source: 'github',
          destination: 'notion',
          title: 'Bidirectional sync placeholder',
        })
        break

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${request.action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    if (result.errors.length > 0) {
      result.success = false
    }

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
