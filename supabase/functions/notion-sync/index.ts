// Supabase Edge Function: notion-sync
// Automatic sync from GitHub to Notion workspace
// Root-agnostic: works with any Notion root page name
//
// POST /functions/v1/notion-sync
// Body: { action: 'sync-structure' | 'update-page' | ... }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { SyncStateManager, SyncState } from './state-manager.ts'
import { markdownToBlocks, parseRichText } from './markdown.ts'
import { validateStructure, extractAllTitles, countPages } from './validator.ts'
import { createLogger } from './logger.ts'
import { runHealthCheck } from './health.ts'
import type {
  PageDef, Structure, PageUpdate, SyncRequest,
  MovedPage, BlockStats, SyncResult, SyncMetrics,
  NotionPage, NotionSearchResult, NotionBlockChildren,
} from './types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ═══════════════════════════════════════════════════════════════
// NOTION CLIENT
// ═══════════════════════════════════════════════════════════════

class NotionClient {
  private apiKey: string
  private baseUrl = 'https://api.notion.com/v1'
  private log = createLogger('notion-api')
  apiCalls = 0

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    this.apiCalls++
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
    this.log.debug(`Searching for page: "${title}"`)

    const results: NotionSearchResult = await this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        query: title,
        filter: { property: 'object', value: 'page' },
        page_size: 100,
      }),
    })

    // Find exact match (case-sensitive)
    for (const page of results.results) {
      const titleProp = Object.values(page.properties).find(
        (prop: any) => prop.type === 'title'
      ) as any
      const pageTitle = titleProp?.title?.[0]?.plain_text
      if (pageTitle === title) {
        this.log.debug(`Found exact match: ${page.id}`, { title })
        return page.id
      }
    }

    // Try case-insensitive match as fallback
    const titleLower = title.toLowerCase()
    for (const page of results.results) {
      const titleProp = Object.values(page.properties).find(
        (prop: any) => prop.type === 'title'
      ) as any
      const pageTitle = titleProp?.title?.[0]?.plain_text
      if (pageTitle?.toLowerCase() === titleLower) {
        this.log.debug(`Found case-insensitive match: ${page.id}`, { title })
        return page.id
      }
    }

    // If title has multiple words, try searching with just first few words
    const words = title.split(' ')
    if (words.length > 2) {
      const shortQuery = words.slice(0, 2).join(' ')
      this.log.debug(`Trying shorter query: "${shortQuery}"`)
      const retryResults: NotionSearchResult = await this.request('/search', {
        method: 'POST',
        body: JSON.stringify({
          query: shortQuery,
          filter: { property: 'object', value: 'page' },
          page_size: 100,
        }),
      })

      for (const page of retryResults.results) {
        const titleProp = Object.values(page.properties).find(
          (prop: any) => prop.type === 'title'
        ) as any
        const pageTitle = titleProp?.title?.[0]?.plain_text
        if (pageTitle === title || pageTitle?.toLowerCase() === titleLower) {
          this.log.debug(`Found with shorter query: ${page.id}`, { title })
          return page.id
        }
      }
    }

    this.log.debug(`Page not found: "${title}"`)
    return null
  }

  async getChildPages(parentId: string): Promise<Map<string, string>> {
    const children = new Map<string, string>()

    try {
      const results: NotionBlockChildren = await this.request(`/blocks/${parentId}/children?page_size=100`)

      for (const block of results.results) {
        if (block.type === 'child_page' && block.child_page) {
          children.set(block.child_page.title, block.id)
        }
      }
    } catch (_e) {
      // Ignore errors - parent might be new
    }

    return children
  }

  async getChildPagesAll(parentId: string): Promise<Array<{title: string, id: string}>> {
    const children: Array<{title: string, id: string}> = []

    try {
      const results: NotionBlockChildren = await this.request(`/blocks/${parentId}/children?page_size=100`)

      for (const block of results.results) {
        if (block.type === 'child_page' && block.child_page) {
          children.push({ title: block.child_page.title, id: block.id })
        }
      }
    } catch (_e) {
      // Ignore errors - parent might be new
    }

    return children
  }

  async isPageEmpty(pageId: string): Promise<boolean> {
    try {
      const results: NotionBlockChildren = await this.request(`/blocks/${pageId}/children?page_size=100`)
      const contentBlocks = results.results.filter(
        (block) => block.type !== 'child_page'
      )
      return contentBlocks.length === 0
    } catch (_e) {
      return false
    }
  }

  async isHumanCreated(pageId: string): Promise<boolean> {
    try {
      const page: NotionPage = await this.request(`/pages/${pageId}`)
      return page.created_by?.type === 'person'
    } catch (_e) {
      return true // Safer default
    }
  }

  async getPageLastEdited(pageId: string): Promise<string | null> {
    try {
      const page: NotionPage = await this.request(`/pages/${pageId}`)
      return page.last_edited_time || null
    } catch (_e) {
      return null
    }
  }

  async findOrCreateChildPage(
    parentId: string,
    title: string,
    icon: string,
    existingChildren: Map<string, string>,
    content?: string
  ): Promise<{ id: string; created: boolean }> {
    const existingId = existingChildren.get(title)
    if (existingId) {
      return { id: existingId, created: false }
    }

    const id = await this.createPage(parentId, title, icon, content)
    return { id, created: true }
  }

  async createPage(parentId: string, title: string, icon: string, content?: string): Promise<string> {
    const children = content ? markdownToBlocks(content) : []

    const page: NotionPage = await this.request('/pages', {
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

  async updatePageContent(pageId: string, content: string): Promise<BlockStats> {
    // Get existing blocks (paginate if needed)
    let existingBlocks: any[] = []
    let cursor: string | undefined
    do {
      const url = cursor
        ? `/blocks/${pageId}/children?start_cursor=${cursor}&page_size=100`
        : `/blocks/${pageId}/children?page_size=100`
      const response: NotionBlockChildren = await this.request(url)
      existingBlocks = existingBlocks.concat(response.results)
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined
    } while (cursor)

    this.log.info(`Deleting ${existingBlocks.length} existing blocks`)

    // Delete existing blocks in parallel batches
    const DELETE_BATCH_SIZE = 10
    for (let i = 0; i < existingBlocks.length; i += DELETE_BATCH_SIZE) {
      const batch = existingBlocks.slice(i, i + DELETE_BATCH_SIZE)
      await Promise.all(batch.map(block =>
        this.request(`/blocks/${block.id}`, { method: 'DELETE' }).catch(() => {})
      ))
      if (i + DELETE_BATCH_SIZE < existingBlocks.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    const blocks = markdownToBlocks(content)
    this.log.info(`Adding ${blocks.length} new blocks`)
    return await this.addBlocksWithRetry(pageId, blocks)
  }

  async updatePageWithBlocks(pageId: string, blocks: any[], preserveChildPages = false): Promise<BlockStats> {
    // Get existing blocks (paginate if needed)
    let existingBlocks: any[] = []
    let cursor: string | undefined
    do {
      const url = cursor
        ? `/blocks/${pageId}/children?start_cursor=${cursor}&page_size=100`
        : `/blocks/${pageId}/children?page_size=100`
      const response: NotionBlockChildren = await this.request(url)
      existingBlocks = existingBlocks.concat(response.results)
      cursor = response.has_more ? response.next_cursor ?? undefined : undefined
    } while (cursor)

    // Filter out child_page blocks to avoid trashing child pages
    const blocksToDelete = preserveChildPages
      ? existingBlocks.filter(b => b.type !== 'child_page')
      : existingBlocks

    if (preserveChildPages && blocksToDelete.length < existingBlocks.length) {
      this.log.info(`Preserving ${existingBlocks.length - blocksToDelete.length} child_page blocks`)
    }

    // Delete existing blocks in parallel batches
    const DELETE_BATCH_SIZE = 10
    for (let i = 0; i < blocksToDelete.length; i += DELETE_BATCH_SIZE) {
      const batch = blocksToDelete.slice(i, i + DELETE_BATCH_SIZE)
      await Promise.all(batch.map(block =>
        this.request(`/blocks/${block.id}`, { method: 'DELETE' }).catch(() => {})
      ))
      if (i + DELETE_BATCH_SIZE < blocksToDelete.length) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
    }

    this.log.info(`Updating page with ${blocks.length} blocks`)
    return await this.addBlocksWithRetry(pageId, blocks)
  }

  private async addBlocksWithRetry(pageId: string, blocks: any[]): Promise<BlockStats> {
    const BATCH_SIZE = 100
    let failedBlocks = 0
    const blockTypes: Record<string, number> = {}
    const failedTypes: Record<string, number> = {}

    for (const block of blocks) {
      blockTypes[block.type] = (blockTypes[block.type] || 0) + 1
    }

    for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
      const batch = blocks.slice(i, i + BATCH_SIZE)
      if (batch.length === 0) continue

      try {
        await this.request(`/blocks/${pageId}/children`, {
          method: 'PATCH',
          body: JSON.stringify({ children: batch }),
        })
      } catch (batchError: any) {
        this.log.warn(`Batch ${i / BATCH_SIZE + 1} failed: ${batchError.message}`)

        for (const block of batch) {
          try {
            await this.request(`/blocks/${pageId}/children`, {
              method: 'PATCH',
              body: JSON.stringify({ children: [block] }),
            })
          } catch (blockError: any) {
            this.log.error(`Block failed`, { type: block.type, error: blockError.message })
            failedBlocks++
            failedTypes[block.type] = (failedTypes[block.type] || 0) + 1
          }
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }

      if (i + BATCH_SIZE < blocks.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }

    if (failedBlocks > 0) {
      this.log.error(`Total blocks failed: ${failedBlocks} of ${blocks.length}`, { failedTypes })
    }

    return { total: blocks.length, failed: failedBlocks, types: blockTypes, failedTypes }
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
    const children = await this.getChildPages(rootId)
    const archiveId = children.get('Archive')

    if (archiveId) {
      return archiveId
    }

    return await this.createPage(rootId, 'Archive', '\ud83d\uddc4\ufe0f')
  }

  async getPageInfo(pageId: string): Promise<{ id: string; title: string; parentId: string | null; parentTitle: string | null }> {
    const page: NotionPage = await this.request(`/pages/${pageId}`)

    const titleProp = Object.values(page.properties).find(
      (prop: any) => prop.type === 'title'
    ) as any
    const title = titleProp?.title?.[0]?.plain_text || ''

    let parentId: string | null = null
    let parentTitle: string | null = null

    if (page.parent?.type === 'page_id' && page.parent.page_id) {
      parentId = page.parent.page_id
      try {
        const parentPage: NotionPage = await this.request(`/pages/${parentId}`)
        const parentTitleProp = Object.values(parentPage.properties).find(
          (prop: any) => prop.type === 'title'
        ) as any
        parentTitle = parentTitleProp?.title?.[0]?.plain_text || null
      } catch (_e) {
        // Ignore - parent might not be accessible
      }
    }

    return { id: pageId, title, parentId, parentTitle }
  }

  async findPageWithParent(title: string): Promise<{ id: string; parentTitle: string | null } | null> {
    const results: NotionSearchResult = await this.request('/search', {
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

        if (page.parent?.type === 'page_id' && page.parent.page_id) {
          try {
            const parentPage: NotionPage = await this.request(`/pages/${page.parent.page_id}`)
            const parentTitleProp = Object.values(parentPage.properties).find(
              (prop: any) => prop.type === 'title'
            ) as any
            parentTitle = parentTitleProp?.title?.[0]?.plain_text || null
          } catch (_e) {
            // Ignore
          }
        }

        return { id: page.id, parentTitle }
      }
    }

    return null
  }

  // Expose markdownToBlocks for external callers (e.g. update-page counting)
  markdownToBlocks(content: string): any[] {
    return markdownToBlocks(content)
  }
}

// ═══════════════════════════════════════════════════════════════
// TABLE OF CONTENTS GENERATOR
// ═══════════════════════════════════════════════════════════════

/** Generate a flat list of child page links for section pages */
function generateChildPageLinks(
  children: PageDef[],
  childIds: Map<string, string>
): any[] {
  const blocks: any[] = []

  for (const item of children) {
    const pageId = childIds.get(item.title)
    const icon = item.icon || '\ud83d\udcc4'

    if (pageId) {
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
  }

  return blocks
}

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

/**
 * Filter structure to only include a target section and its children
 */
function filterStructureBySection(structure: Structure, targetPath: string): Structure {
  const pathParts = targetPath.split('/').map(p => p.trim())
  const log = createLogger('filter')

  function findSection(pages: PageDef[], remainingPath: string[]): PageDef | null {
    if (remainingPath.length === 0) return null

    const targetTitle = remainingPath[0]
    for (const page of pages) {
      if (page.title.toLowerCase() === targetTitle.toLowerCase()) {
        if (remainingPath.length === 1) {
          return page
        }
        if (page.children) {
          return findSection(page.children, remainingPath.slice(1))
        }
      }
    }
    return null
  }

  const targetSection = findSection(structure.sections, pathParts)

  if (!targetSection) {
    log.warn(`Target section '${targetPath}' not found, syncing full structure`)
    return structure
  }

  log.info(`Filtering to section: ${targetSection.title}`)
  return {
    root: structure.root,
    sections: [targetSection]
  }
}

async function syncStructure(
  client: NotionClient,
  structure: Structure,
  result: SyncResult,
  log: ReturnType<typeof createLogger>,
  skipContent = false
): Promise<void> {
  const rootId = await client.findPageByTitle(structure.root)
  if (!rootId) {
    result.errors.push(`Root page '${structure.root}' not found. Create it in Notion first.`)
    return
  }

  log.info(`Found root page: ${structure.root}`, { rootId })

  async function syncPages(
    parentId: string,
    pages: PageDef[],
    depth = 0,
    parentPath = ''
  ): Promise<Map<string, string>> {
    const existingChildren = await client.getChildPages(parentId)
    const syncedIds = new Map<string, string>()

    for (const page of pages) {
      const pagePath = parentPath ? `${parentPath} > ${page.title}` : page.title
      const isSectionPage = page.children && page.children.length > 0 && !page.content

      try {
        let contentToUse: string | undefined = undefined
        if (!skipContent && page.content) {
          contentToUse = page.content
        }

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
          const stats = await client.updatePageContent(pageId, contentToUse)
          result.updated.push(`${pagePath} (${stats.total} blocks, ${stats.failed} failed)`)
          if (result.debug) {
            result.debug.totalBlocks += stats.total
            result.debug.failedBlocks += stats.failed
            for (const [type, count] of Object.entries(stats.types)) {
              result.debug.blockTypes[type] = (result.debug.blockTypes[type] || 0) + count
            }
          }
        } else if (!isSectionPage) {
          result.skipped.push(pagePath)
        }

        if (page.children && pageId) {
          const childIds = await syncPages(pageId, page.children, depth + 1, pagePath)
          for (const [title, id] of childIds) {
            syncedIds.set(title, id)
          }

          // Section pages: set child page links as content
          if (isSectionPage && !skipContent) {
            const linkBlocks = generateChildPageLinks(page.children, childIds)
            if (linkBlocks.length > 0) {
              const stats = await client.updatePageWithBlocks(pageId, linkBlocks, true)
              result.updated.push(`${pagePath} (${linkBlocks.length} links)`)
              if (result.debug) {
                result.debug.totalBlocks += stats.total
                result.debug.failedBlocks += stats.failed
              }
            }
          }
        }

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
// CLEANUP LOGIC
// ═══════════════════════════════════════════════════════════════

async function cleanupLegacyPages(
  client: NotionClient,
  structure: Structure,
  result: SyncResult,
  log: ReturnType<typeof createLogger>,
  dryRun: boolean,
  protectHuman: boolean = false
): Promise<void> {
  const rootId = await client.findPageByTitle(structure.root)
  if (!rootId) {
    result.errors.push(`Root page '${structure.root}' not found.`)
    return
  }

  let archiveFolderId: string | null = null
  if (!dryRun) {
    archiveFolderId = await client.findOrCreateArchiveFolder(rootId)
  }

  async function cleanupChildren(parentId: string, expectedForParent: PageDef[], parentPath = '') {
    // Get ALL child pages including duplicates (Map would silently drop them)
    const allChildren = await client.getChildPagesAll(parentId)

    // Group by title to find duplicates
    const titleGroups = new Map<string, string[]>()
    for (const child of allChildren) {
      const ids = titleGroups.get(child.title) || []
      ids.push(child.id)
      titleGroups.set(child.title, ids)
    }

    // Dedup pass: archive duplicate-titled pages (keep first instance)
    for (const [title, ids] of titleGroups) {
      if (ids.length > 1) {
        const dupPath = parentPath ? `${parentPath} > ${title}` : title
        log.info(`Found ${ids.length} duplicates of "${title}", archiving ${ids.length - 1}`)
        for (let i = 1; i < ids.length; i++) {
          if (dryRun) {
            result.deleted.push(`[DRY RUN] Would archive duplicate: ${dupPath}`)
          } else {
            try {
              await client.archivePage(ids[i])
              result.deleted.push(`Archived duplicate: ${dupPath}`)
              await new Promise(resolve => setTimeout(resolve, 150))
            } catch (error) {
              result.errors.push(`Failed to archive duplicate '${dupPath}': ${error.message}`)
            }
          }
        }
      }
    }

    // Build deduplicated map for orphan cleanup (one entry per title)
    const existingChildren = new Map<string, string>()
    for (const [title, ids] of titleGroups) {
      existingChildren.set(title, ids[0])
    }

    const expectedTitlesForParent = new Set(expectedForParent.map(p => p.title))
    if (parentId === rootId) {
      expectedTitlesForParent.add('Archive')
    }

    for (const [title, pageId] of existingChildren) {
      const pagePath = parentPath ? `${parentPath} > ${title}` : title

      if (!expectedTitlesForParent.has(title)) {
        const isHuman = protectHuman ? await client.isHumanCreated(pageId) : false

        if (isHuman) {
          const isEmpty = await client.isPageEmpty(pageId)

          if (isEmpty) {
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
            result.protected.push(`Protected (created by human with content): ${pagePath}`)
          }
          continue
        }

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
        const pageDef = expectedForParent.find(p => p.title === title)
        if (pageDef?.children) {
          await cleanupChildren(pageId, pageDef.children, pagePath)
        }
      }
    }
  }

  await cleanupChildren(rootId, structure.sections)
}

async function detectMovedPages(
  client: NotionClient,
  structure: Structure,
  result: SyncResult,
  log: ReturnType<typeof createLogger>
): Promise<void> {
  interface PageMapping {
    title: string
    file?: string
    expectedParent: string
  }

  function buildMapping(sections: PageDef[], parentTitle: string, mappings: PageMapping[] = []): PageMapping[] {
    for (const section of sections) {
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

      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (error) {
      log.error(`Error checking page '${mapping.title}'`, { error: String(error) })
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

  const log = createLogger('notion-sync')
  const startTime = Date.now()

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
      debug: {
        totalBlocks: 0,
        failedBlocks: 0,
        blockTypes: {},
      },
    }

    // Root page: from request, env var, or error
    const effectiveRoot = request.root || Deno.env.get('NOTION_ROOT_PAGE')
    if (!effectiveRoot && !request.structure?.root) {
      return new Response(
        JSON.stringify({
          error: 'No root page specified. Provide "root" in the request body, set NOTION_ROOT_PAGE env var, or include "root" in the structure.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    log.info(`Action: ${request.action}`, { root: effectiveRoot || request.structure?.root })

    switch (request.action) {
      case 'create-structure': {
        if (!request.structure) {
          result.errors.push('No structure provided. Pass a structure object in the request body.')
          break
        }
        const createStruct = { ...request.structure, root: effectiveRoot || request.structure.root }

        // Validate before syncing
        const validation = validateStructure(createStruct)
        if (!validation.valid) {
          result.errors.push(...validation.errors.map(e => `Validation: ${e}`))
          break
        }
        if (validation.warnings.length > 0) {
          log.warn('Structure validation warnings', { warnings: validation.warnings })
        }

        await syncStructure(client, createStruct, result, log, true)
        break
      }

      case 'sync-structure': {
        if (!request.structure) {
          result.errors.push('No structure provided. Pass a structure object in the request body (from notion-structure.json).')
          break
        }
        let structure = { ...request.structure, root: effectiveRoot || request.structure.root }

        // Validate before syncing
        const validation = validateStructure(structure)
        if (!validation.valid) {
          result.errors.push(...validation.errors.map(e => `Validation: ${e}`))
          break
        }
        if (validation.warnings.length > 0) {
          log.warn('Structure validation warnings', { warnings: validation.warnings })
        }

        if (request.targetSection) {
          structure = filterStructureBySection(structure, request.targetSection)
        }
        await syncStructure(client, structure, result, log, request.skipContent || false)
        break
      }

      case 'update-page': {
        if (!request.page) {
          result.errors.push('Missing page data for update-page action')
          break
        }

        let pageId = await client.findPageByTitle(request.page.pageTitle)
        let wasCreated = false

        if (!pageId) {
          if (request.page.parentPageTitle) {
            const parentId = await client.findPageByTitle(request.page.parentPageTitle)
            if (!parentId) {
              result.errors.push(`Parent page '${request.page.parentPageTitle}' not found, cannot create '${request.page.pageTitle}'`)
              break
            }

            const icon = request.page.icon || '\ud83d\udcc4'
            pageId = await client.createPage(parentId, request.page.pageTitle, icon, request.page.content)
            wasCreated = true
            result.created.push(request.page.pageTitle)
          } else {
            result.errors.push(`Page '${request.page.pageTitle}' not found (provide parentPageTitle to auto-create)`)
            break
          }
        }

        let stats: BlockStats
        if (wasCreated) {
          const blocks = markdownToBlocks(request.page.content)
          stats = { total: blocks.length, failed: 0, types: {}, failedTypes: {} }
        } else {
          stats = await client.updatePageContent(pageId, request.page.content)
        }

        if (!wasCreated) {
          result.updated.push(`${request.page.pageTitle} (${stats.total} blocks, ${stats.failed} failed)`)
        }

        // Update sync state if path and hash provided
        if (request.page.pagePath && request.page.contentHash) {
          const supabaseUrl = Deno.env.get('SUPABASE_URL')
          const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

          if (supabaseUrl && supabaseKey) {
            const stateManager = new SyncStateManager(supabaseUrl, supabaseKey)
            await stateManager.upsertState({
              page_path: request.page.pagePath,
              notion_page_id: pageId,
              github_hash: request.page.contentHash,
              last_synced_at: new Date().toISOString(),
              block_count: stats.total,
              source: 'ai'
            })
          }
        }

        if (result.debug) {
          result.debug.totalBlocks = stats.total
          result.debug.failedBlocks = stats.failed
          result.debug.blockTypes = stats.types
        }
        break
      }

      case 'cleanup': {
        if (!request.structure) {
          result.errors.push('No structure provided for cleanup. Pass the structure to compare against.')
          break
        }
        const cleanupStructure = { ...request.structure, root: effectiveRoot || request.structure.root }
        await cleanupLegacyPages(
          client,
          cleanupStructure,
          result,
          log,
          request.dryRun || false,
          request.protectHuman || false
        )
        break
      }

      case 'detect-moves': {
        if (!request.structure) {
          result.errors.push('No structure provided for move detection.')
          break
        }
        const detectStructure = { ...request.structure, root: effectiveRoot || request.structure.root }
        await detectMovedPages(client, detectStructure, result, log)
        break
      }

      case 'check-changes': {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseKey) {
          result.errors.push('Supabase credentials not configured for state tracking')
          break
        }

        const stateManager = new SyncStateManager(supabaseUrl, supabaseKey)
        const contentHashes = request.contentHashes || {}

        const allStates = await stateManager.getAllStates()
        const stateMap = new Map(allStates.map(s => [s.page_path, s]))

        const newPages: string[] = []
        const changedPages: string[] = []
        const upToDate: string[] = []

        for (const [pagePath, currentHash] of Object.entries(contentHashes)) {
          const state = stateMap.get(pagePath)

          if (!state || !state.github_hash) {
            newPages.push(pagePath)
          } else if (state.github_hash !== currentHash) {
            changedPages.push(pagePath)
          } else {
            upToDate.push(pagePath)
          }
        }

        result.needsSync = [...newPages, ...changedPages]
        result.newPages = newPages
        result.changedPages = changedPages
        result.upToDate = upToDate
        result.totalChecked = Object.keys(contentHashes).length
        break
      }

      case 'get-state': {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseKey) {
          result.errors.push('Supabase credentials not configured for state tracking')
          break
        }

        const stateManager = new SyncStateManager(supabaseUrl, supabaseKey)
        const allStates = await stateManager.getAllStates()

        result.states = allStates
        result.totalPages = allStates.length
        break
      }

      case 'update-state': {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseKey) {
          result.errors.push('Supabase credentials not configured for state tracking')
          break
        }

        if (!request.stateUpdates || request.stateUpdates.length === 0) {
          result.errors.push('No state updates provided')
          break
        }

        const stateManager = new SyncStateManager(supabaseUrl, supabaseKey)
        let updatedCount = 0

        for (const update of request.stateUpdates) {
          await stateManager.upsertState({
            page_path: update.pagePath,
            notion_page_id: update.notionPageId || null,
            github_hash: update.githubHash,
            last_synced_at: new Date().toISOString(),
            block_count: update.blockCount || 0,
            source: update.source || 'ai'
          })
          updatedCount++
        }

        result.updated.push(`Updated state for ${updatedCount} pages`)
        break
      }

      case 'health-check': {
        if (!request.structure) {
          result.errors.push('No structure provided for health check.')
          break
        }
        const healthStructure = { ...request.structure, root: effectiveRoot || request.structure.root }
        const healthReport = await runHealthCheck(
          client,
          healthStructure,
          request.staleDays || 90,
          request.autoFix || false,
        )
        result.healthReport = healthReport
        break
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${request.action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    result.success = result.errors.length === 0

    // Add metrics
    const endTime = Date.now()
    result.metrics = {
      startTime,
      endTime,
      durationMs: endTime - startTime,
      pagesProcessed: result.created.length + result.updated.length + result.skipped.length,
      apiCalls: client.apiCalls,
      blocksCreated: result.debug?.totalBlocks || 0,
      blocksFailed: result.debug?.failedBlocks || 0,
    }

    log.info('Sync complete', {
      action: request.action,
      durationMs: result.metrics.durationMs,
      created: result.created.length,
      updated: result.updated.length,
      errors: result.errors.length,
      apiCalls: client.apiCalls,
    })

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    log.error('Notion sync error', { error: error.message })
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
