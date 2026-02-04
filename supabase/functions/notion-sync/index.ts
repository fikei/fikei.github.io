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
  action: 'sync-structure' | 'update-page' | 'create-structure'
  structure?: Structure
  page?: PageUpdate
}

interface SyncResult {
  success: boolean
  created: string[]
  updated: string[]
  skipped: string[]
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
        { title: 'PRDs', icon: '📄' },
        { title: 'Decision Log (ADRs)', icon: '📄' },
      ],
    },
    {
      title: 'Products',
      icon: '📦',
      children: [
        {
          title: 'Boards',
          icon: '📋',
          children: [
            { title: 'Overview', icon: '📄' },
            { title: 'Human TODOs', icon: '👤' },
          ],
        },
        {
          title: 'Soundscape',
          icon: '🎵',
          children: [
            { title: 'Overview', icon: '📄' },
            { title: 'Human TODOs', icon: '👤' },
          ],
        },
        {
          title: 'Systemic',
          icon: '🔧',
          children: [
            { title: 'Overview', icon: '📄' },
            { title: 'Human TODOs', icon: '👤' },
          ],
        },
        {
          title: 'Favicon Generator',
          icon: '🎨',
          children: [
            { title: 'Overview', icon: '📄' },
            { title: 'Human TODOs', icon: '👤' },
          ],
        },
        {
          title: 'Design System',
          icon: '🎨',
          children: [
            { title: 'Overview', icon: '📄' },
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
