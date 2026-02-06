// Notion Sync - Health Check Module
// Phase A: Staleness detection, orphan detection, empty page detection, auto-cleanup

import { createLogger } from './logger.ts'
import type {
  Structure, PageDef, PageHealth, HealthReport,
  NotionPage, NotionSearchResult, NotionBlockChildren,
  SimilarPages, FormattingIssue,
} from './types.ts'

interface HealthCheckClient {
  findPageByTitle(title: string): Promise<string | null>
  getChildPages(parentId: string): Promise<Map<string, string>>
  isPageEmpty(pageId: string): Promise<boolean>
  isHumanCreated(pageId: string): Promise<boolean>
  archivePage(pageId: string): Promise<void>
  getPageLastEdited(pageId: string): Promise<string | null>
}

const DEFAULT_STALE_DAYS = 90
const DEFAULT_REVIEW_DAYS = 30

function daysBetween(dateStr: string): number {
  const then = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
}

/** Walk a structure and collect all page definitions with their parent context */
function flattenStructure(
  sections: PageDef[],
  parentTitle: string,
  result: { title: string; file?: string; parentTitle: string; icon: string }[] = []
): { title: string; file?: string; parentTitle: string; icon: string }[] {
  for (const page of sections) {
    result.push({
      title: page.title,
      file: page.file,
      parentTitle,
      icon: page.icon,
    })
    if (page.children) {
      flattenStructure(page.children, page.title, result)
    }
  }
  return result
}

/** Find duplicate titles in the structure */
function findDuplicateTitles(sections: PageDef[]): { title: string; count: number; locations: string[] }[] {
  const titleMap = new Map<string, string[]>()

  function walk(pages: PageDef[], path: string) {
    for (const page of pages) {
      const pagePath = path ? `${path} > ${page.title}` : page.title
      const existing = titleMap.get(page.title) || []
      existing.push(pagePath)
      titleMap.set(page.title, existing)
      if (page.children) {
        walk(page.children, pagePath)
      }
    }
  }

  walk(sections, '')

  return Array.from(titleMap.entries())
    .filter(([_, locations]) => locations.length > 1)
    .map(([title, locations]) => ({ title, count: locations.length, locations }))
}

function countChildren(page: PageDef): number {
  if (!page.children) return 0
  let c = page.children.length
  for (const child of page.children) {
    c += countChildren(child)
  }
  return c
}

export async function runHealthCheck(
  client: HealthCheckClient,
  structure: Structure,
  staleDays: number = DEFAULT_STALE_DAYS,
  autoFix: boolean = false,
  readFile?: (path: string) => string | null,
  reviewDays: number = DEFAULT_REVIEW_DAYS,
): Promise<HealthReport> {
  const log = createLogger('health-check')

  // A.3.5: Check for unbalanced sections
  const unbalancedSections: string[] = []
  const sectionSizes = structure.sections.map(s => ({
    title: s.title,
    count: 1 + countChildren(s),
  }))
  if (sectionSizes.length >= 2) {
    const max = Math.max(...sectionSizes.map(s => s.count))
    const min = Math.min(...sectionSizes.map(s => s.count))
    if (max > 0 && min > 0 && max / min > 5) {
      const largest = sectionSizes.find(s => s.count === max)!
      const smallest = sectionSizes.find(s => s.count === min)!
      unbalancedSections.push(
        `"${largest.title}" (${largest.count} pages) vs "${smallest.title}" (${smallest.count} pages) — consider splitting`
      )
    }
  }

  // A.2.4: Check for broken internal links
  let brokenLinks: { page: string; file: string; brokenLink: string; target: string }[] = []
  let similarPages: SimilarPages[] = []
  let formattingIssues: FormattingIssue[] = []
  if (readFile) {
    const { findBrokenLinks, findSimilarPages, checkFormatting } = await import('./validator.ts')
    brokenLinks = findBrokenLinks(structure, readFile)
    // A.2.3: Detect near-duplicate pages
    similarPages = findSimilarPages(structure, readFile)
    // A.2.5: Check formatting consistency
    formattingIssues = checkFormatting(structure, readFile)
  }

  const report: HealthReport = {
    timestamp: new Date().toISOString(),
    root: structure.root,
    totalPages: 0,
    pagesChecked: 0,
    healthy: 0,
    stale: [],
    empty: [],
    orphaned: [],
    missingInNotion: [],
    needsReview: [],
    duplicateTitles: findDuplicateTitles(structure.sections),
    brokenLinks,
    unbalancedSections,
    similarPages,
    formattingIssues,
    autoFixed: [],
    summary: '',
  }

  // Find root
  const rootId = await client.findPageByTitle(structure.root)
  if (!rootId) {
    report.summary = `Root page '${structure.root}' not found in Notion.`
    return report
  }

  log.info(`Health check starting`, { root: structure.root, staleDays, autoFix })

  // Flatten the structure to get all expected pages
  const expectedPages = flattenStructure(structure.sections, structure.root)
  report.totalPages = expectedPages.length

  // Check each expected page in Notion
  for (const expected of expectedPages) {
    report.pagesChecked++

    // Find the page's parent first, then look for the page as a child
    const parentId = expected.parentTitle === structure.root
      ? rootId
      : await client.findPageByTitle(expected.parentTitle)

    if (!parentId) {
      // Parent doesn't exist, so this page is missing
      report.missingInNotion.push({
        title: expected.title,
        pageId: '',
        parentTitle: expected.parentTitle,
        status: 'missing-in-notion',
        lastEdited: null,
        daysSinceEdit: null,
        isEmpty: false,
        isHuman: false,
        file: expected.file,
      })
      continue
    }

    const children = await client.getChildPages(parentId)
    const pageId = children.get(expected.title)

    if (!pageId) {
      report.missingInNotion.push({
        title: expected.title,
        pageId: '',
        parentTitle: expected.parentTitle,
        status: 'missing-in-notion',
        lastEdited: null,
        daysSinceEdit: null,
        isEmpty: false,
        isHuman: false,
        file: expected.file,
      })
      continue
    }

    // Page exists — check its health
    const lastEdited = await client.getPageLastEdited(pageId)
    const days = lastEdited ? daysBetween(lastEdited) : null
    const isEmpty = await client.isPageEmpty(pageId)
    const isHuman = await client.isHumanCreated(pageId)

    const health: PageHealth = {
      title: expected.title,
      pageId,
      parentTitle: expected.parentTitle,
      status: 'healthy',
      lastEdited,
      daysSinceEdit: days,
      isEmpty,
      isHuman,
      file: expected.file,
    }

    if (isEmpty) {
      health.status = 'empty'
      report.empty.push(health)

      // Auto-fix: archive empty bot-created pages
      if (autoFix && !isHuman) {
        try {
          await client.archivePage(pageId)
          report.autoFixed.push(`Archived empty page: ${expected.title}`)
          log.info(`Auto-archived empty page: ${expected.title}`)
        } catch (e) {
          log.error(`Failed to archive ${expected.title}`, { error: String(e) })
        }
      }
    } else if (days !== null && days > staleDays) {
      health.status = 'stale'
      report.stale.push(health)
    } else if (days !== null && days > reviewDays) {
      // A.2.6: Page is past review threshold but not yet stale
      health.status = 'healthy' // Still healthy, just flagged for review
      report.needsReview.push(health)
      report.healthy++
    } else {
      report.healthy++
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 150))
  }

  // Now check for orphaned pages — pages in Notion under root that aren't in the structure
  const expectedTitles = new Set(expectedPages.map(p => p.title))
  expectedTitles.add('Archive') // Always expected

  async function findOrphans(parentId: string, parentTitle: string, depth: number) {
    if (depth > 6) return // Safety limit

    const children = await client.getChildPages(parentId)
    for (const [title, pageId] of children) {
      if (!expectedTitles.has(title)) {
        const lastEdited = await client.getPageLastEdited(pageId)
        const days = lastEdited ? daysBetween(lastEdited) : null
        const isHuman = await client.isHumanCreated(pageId)

        report.orphaned.push({
          title,
          pageId,
          parentTitle,
          status: 'orphaned',
          lastEdited,
          daysSinceEdit: days,
          isEmpty: false,
          isHuman,
        })

        // Auto-fix: archive orphaned bot-created pages
        if (autoFix && !isHuman) {
          try {
            await client.archivePage(pageId)
            report.autoFixed.push(`Archived orphan: ${title} (under ${parentTitle})`)
            log.info(`Auto-archived orphan: ${title}`)
          } catch (e) {
            log.error(`Failed to archive orphan ${title}`, { error: String(e) })
          }
        }
      } else {
        // Recurse into expected section pages to find nested orphans
        const pageDef = expectedPages.find(p => p.title === title)
        if (pageDef) {
          await findOrphans(pageId, title, depth + 1)
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  await findOrphans(rootId, structure.root, 0)

  // Build summary
  const issues: string[] = []
  if (report.stale.length > 0) issues.push(`${report.stale.length} stale (>${staleDays} days)`)
  if (report.needsReview.length > 0) issues.push(`${report.needsReview.length} need review (>${reviewDays} days)`)
  if (report.empty.length > 0) issues.push(`${report.empty.length} empty`)
  if (report.orphaned.length > 0) issues.push(`${report.orphaned.length} orphaned`)
  if (report.missingInNotion.length > 0) issues.push(`${report.missingInNotion.length} missing in Notion`)
  if (report.duplicateTitles.length > 0) issues.push(`${report.duplicateTitles.length} duplicate titles`)
  if (report.brokenLinks.length > 0) issues.push(`${report.brokenLinks.length} broken links`)
  if (report.unbalancedSections.length > 0) issues.push(`${report.unbalancedSections.length} unbalanced sections`)
  if (report.similarPages.length > 0) issues.push(`${report.similarPages.length} similar page pairs`)
  if (report.formattingIssues.length > 0) issues.push(`${report.formattingIssues.length} formatting issues`)

  if (issues.length === 0) {
    report.summary = `All ${report.healthy} pages are healthy.`
  } else {
    report.summary = `${report.healthy} healthy, ${issues.join(', ')}.`
    if (report.autoFixed.length > 0) {
      report.summary += ` Auto-fixed: ${report.autoFixed.length} pages.`
    }
  }

  log.info(`Health check complete`, {
    total: report.totalPages,
    healthy: report.healthy,
    stale: report.stale.length,
    needsReview: report.needsReview.length,
    empty: report.empty.length,
    orphaned: report.orphaned.length,
    missing: report.missingInNotion.length,
    similarPairs: report.similarPages.length,
    formattingIssues: report.formattingIssues.length,
    autoFixed: report.autoFixed.length,
  })

  return report
}
