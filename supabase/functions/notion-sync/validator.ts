// Notion Sync - Structure Validator
// Schema validation for notion-structure.json

import type { Structure, PageDef, ValidationResult, SimilarPages, FormattingIssue } from './types.ts'

const VALID_SOURCES = new Set(['ai', 'human'])

/** Validate a notion-structure.json object against the expected schema */
export function validateStructure(structure: unknown): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!structure || typeof structure !== 'object') {
    return { valid: false, errors: ['Structure must be a non-null object'], warnings }
  }

  const s = structure as Record<string, unknown>

  // Root is required
  if (!s.root || typeof s.root !== 'string') {
    errors.push('Missing or invalid "root" field (must be a non-empty string)')
  } else if (s.root.length > 100) {
    warnings.push(`Root page name is very long (${s.root.length} chars) - may cause display issues`)
  }

  // Sections is required
  if (!Array.isArray(s.sections)) {
    errors.push('Missing or invalid "sections" field (must be an array)')
    return { valid: errors.length === 0, errors, warnings }
  }

  if (s.sections.length === 0) {
    warnings.push('Structure has no sections - nothing will be synced')
  }

  // Track titles for duplicate detection
  const allTitles = new Map<string, string[]>() // title -> paths where it appears

  function validatePage(page: unknown, path: string, depth: number) {
    if (!page || typeof page !== 'object') {
      errors.push(`${path}: Page must be a non-null object`)
      return
    }

    const p = page as Record<string, unknown>

    // Title is required
    if (!p.title || typeof p.title !== 'string') {
      errors.push(`${path}: Missing or invalid "title" (must be a non-empty string)`)
      return
    }

    const pagePath = `${path} > ${p.title}`

    // Track duplicate titles
    const existing = allTitles.get(p.title) || []
    existing.push(pagePath)
    allTitles.set(p.title, existing)

    // Icon is required
    if (!p.icon || typeof p.icon !== 'string') {
      warnings.push(`${pagePath}: Missing "icon" - will use default`)
    }

    // Source validation
    if (p.source !== undefined && !VALID_SOURCES.has(p.source as string)) {
      errors.push(`${pagePath}: Invalid "source" value "${p.source}" (must be "ai" or "human")`)
    }

    // File path validation
    if (p.file !== undefined) {
      if (typeof p.file !== 'string') {
        errors.push(`${pagePath}: "file" must be a string`)
      } else {
        if (p.file.startsWith('/')) {
          errors.push(`${pagePath}: "file" should be a relative path, not absolute: "${p.file}"`)
        }
        if (!p.file.endsWith('.md')) {
          warnings.push(`${pagePath}: "file" does not end with .md: "${p.file}"`)
        }
      }
    }

    // Depth check
    if (depth > 5) {
      warnings.push(`${pagePath}: Very deep nesting (${depth} levels) - may cause performance issues`)
    }

    // Validate children
    if (p.children !== undefined) {
      if (!Array.isArray(p.children)) {
        errors.push(`${pagePath}: "children" must be an array`)
      } else {
        for (const child of p.children) {
          validatePage(child, pagePath, depth + 1)
        }
      }
    }
  }

  for (const section of s.sections) {
    validatePage(section, s.root as string, 0)
  }

  // Check for duplicate titles
  for (const [title, paths] of allTitles) {
    if (paths.length > 1) {
      warnings.push(`Duplicate title "${title}" found at: ${paths.join(', ')}`)
    }
  }

  // A.1.4: Check for duplicate file paths (two entries pointing to same file)
  const allFiles = new Map<string, string[]>() // filepath -> page titles
  function collectFiles(pages: unknown[], parentPath: string) {
    for (const page of pages) {
      if (!page || typeof page !== 'object') continue
      const p = page as Record<string, unknown>
      const title = (p.title || '?') as string
      if (p.file && typeof p.file === 'string') {
        const existing = allFiles.get(p.file) || []
        existing.push(title)
        allFiles.set(p.file, existing)
      }
      if (Array.isArray(p.children)) {
        collectFiles(p.children, `${parentPath} > ${title}`)
      }
    }
  }
  collectFiles(s.sections as unknown[], s.root as string)

  for (const [filepath, titles] of allFiles) {
    if (titles.length > 1) {
      warnings.push(`Duplicate file "${filepath}" used by pages: ${titles.join(', ')}`)
    }
  }

  // A.3.5: Check for unbalanced trees
  const sectionSizes: { title: string; count: number }[] = []
  function countDeep(pages: unknown[]): number {
    let c = 0
    for (const page of pages) {
      if (!page || typeof page !== 'object') continue
      c++
      const p = page as Record<string, unknown>
      if (Array.isArray(p.children)) {
        c += countDeep(p.children)
      }
    }
    return c
  }
  for (const section of s.sections as Record<string, unknown>[]) {
    const title = (section.title || '?') as string
    const children = Array.isArray(section.children) ? section.children : []
    const size = 1 + countDeep(children)
    sectionSizes.push({ title, count: size })
  }
  if (sectionSizes.length >= 2) {
    const max = Math.max(...sectionSizes.map(s => s.count))
    const min = Math.min(...sectionSizes.map(s => s.count))
    if (max > 0 && min > 0 && max / min > 5) {
      const largest = sectionSizes.find(s => s.count === max)!
      const smallest = sectionSizes.find(s => s.count === min)!
      warnings.push(
        `Unbalanced structure: "${largest.title}" has ${largest.count} pages vs "${smallest.title}" with ${smallest.count}. Consider splitting large sections.`
      )
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/** Extract all file paths from a structure */
export function extractFilePaths(structure: Structure): string[] {
  const paths: string[] = []

  function walk(pages: PageDef[]) {
    for (const page of pages) {
      if (page.file) {
        paths.push(page.file)
      }
      if (page.children) {
        walk(page.children)
      }
    }
  }

  walk(structure.sections)
  return paths
}

/** Extract all page titles from a structure (for cleanup comparison) */
export function extractAllTitles(pages: PageDef[]): Set<string> {
  const titles = new Set<string>()

  function walk(items: PageDef[]) {
    for (const item of items) {
      titles.add(item.title)
      if (item.children) {
        walk(item.children)
      }
    }
  }

  walk(pages)
  return titles
}

/** A.2.4: Find broken internal links in markdown files
 *  Returns links that reference files not in the structure */
export function findBrokenLinks(
  structure: Structure,
  readFile: (path: string) => string | null,
): { page: string; file: string; brokenLink: string; target: string }[] {
  const structureFiles = new Set(extractFilePaths(structure))
  const broken: { page: string; file: string; brokenLink: string; target: string }[] = []

  // Regex for markdown links: [text](path)
  const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g

  function walkPages(pages: PageDef[]) {
    for (const page of pages) {
      if (page.file) {
        const content = readFile(page.file)
        if (content) {
          let match
          while ((match = linkPattern.exec(content)) !== null) {
            const target = match[2]
            // Only check relative links to local files, skip URLs and anchors
            if (target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) continue
            // Strip anchor from path
            const filePath = target.split('#')[0]
            if (!filePath) continue
            // Resolve relative to the file's directory
            const dir = page.file.includes('/') ? page.file.substring(0, page.file.lastIndexOf('/')) : ''
            const resolved = filePath.startsWith('/') ? filePath.slice(1) : (dir ? `${dir}/${filePath}` : filePath)
            // Normalize ../ paths
            const parts = resolved.split('/')
            const normalized: string[] = []
            for (const p of parts) {
              if (p === '..') normalized.pop()
              else if (p !== '.') normalized.push(p)
            }
            const normalizedPath = normalized.join('/')
            // Check if target exists in structure files or as a known file
            if (normalizedPath.endsWith('.md') && !structureFiles.has(normalizedPath)) {
              broken.push({
                page: page.title,
                file: page.file,
                brokenLink: match[0],
                target: normalizedPath,
              })
            }
          }
        }
      }
      if (page.children) walkPages(page.children)
    }
  }

  walkPages(structure.sections)
  return broken
}

/** Count total pages in a structure */
export function countPages(pages: PageDef[]): number {
  let count = 0

  function walk(items: PageDef[]) {
    for (const item of items) {
      count++
      if (item.children) {
        walk(item.children)
      }
    }
  }

  walk(pages)
  return count
}

// ═══════════════════════════════════════════════════════════════
// A.2.3: SIMILAR PAGE DETECTION
// ═══════════════════════════════════════════════════════════════

/** Extract headings from markdown content */
function extractHeadings(content: string): string[] {
  const headings: string[] = []
  for (const line of content.split('\n')) {
    const match = line.match(/^#{1,6}\s+(.+)/)
    if (match) {
      headings.push(match[1].trim().toLowerCase())
    }
  }
  return headings
}

/** Generate word-level trigrams (3-word shingles) from text */
function generateShingles(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 0)
  const shingles = new Set<string>()
  for (let i = 0; i <= words.length - 3; i++) {
    shingles.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`)
  }
  return shingles
}

/** Jaccard similarity between two sets */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const item of a) {
    if (b.has(item)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** A.2.3: Find pages with similar content that may be near-duplicates */
export function findSimilarPages(
  structure: Structure,
  readFile: (path: string) => string | null,
  threshold: number = 0.4,
): SimilarPages[] {
  const similar: SimilarPages[] = []

  // Collect all pages with files
  const pages: { title: string; file: string; content: string; headings: string[]; shingles: Set<string> }[] = []

  function walk(items: PageDef[]) {
    for (const page of items) {
      if (page.file) {
        const content = readFile(page.file)
        if (content && content.trim().length > 50) {
          pages.push({
            title: page.title,
            file: page.file,
            content,
            headings: extractHeadings(content),
            shingles: generateShingles(content),
          })
        }
      }
      if (page.children) walk(page.children)
    }
  }

  walk(structure.sections)

  // Compare all pairs
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const a = pages[i]
      const b = pages[j]

      // Check heading overlap
      const sharedHeadings = a.headings.filter(h => b.headings.includes(h))

      // Calculate content similarity via shingles
      const similarity = jaccardSimilarity(a.shingles, b.shingles)

      // Report if similarity exceeds threshold or many shared headings
      if (similarity >= threshold || (sharedHeadings.length >= 3 && a.headings.length > 0 && b.headings.length > 0)) {
        similar.push({
          pageA: a.title,
          fileA: a.file,
          pageB: b.title,
          fileB: b.file,
          similarity: Math.round(similarity * 100) / 100,
          sharedHeadings,
        })
      }
    }
  }

  // Sort by similarity descending
  similar.sort((a, b) => b.similarity - a.similarity)
  return similar
}

// ═══════════════════════════════════════════════════════════════
// A.2.5: FORMATTING CONSISTENCY CHECKS
// ═══════════════════════════════════════════════════════════════

/** A.2.5: Check for formatting inconsistencies in markdown files */
export function checkFormatting(
  structure: Structure,
  readFile: (path: string) => string | null,
): FormattingIssue[] {
  const results: FormattingIssue[] = []

  function walk(items: PageDef[]) {
    for (const page of items) {
      if (page.file) {
        const content = readFile(page.file)
        if (content) {
          const issues = analyzeFormatting(content)
          if (issues.length > 0) {
            results.push({ page: page.title, file: page.file, issues })
          }
        }
      }
      if (page.children) walk(page.children)
    }
  }

  walk(structure.sections)
  return results
}

function analyzeFormatting(content: string): string[] {
  const issues: string[] = []
  const lines = content.split('\n')

  // Track heading levels for gap detection
  let prevHeadingLevel = 0
  let headingLineNumbers: { level: number; line: number }[] = []

  // Track list markers for consistency
  const listMarkers = new Set<string>()

  // Count consecutive blank lines
  let consecutiveBlanks = 0
  let maxConsecutiveBlanks = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Check heading level gaps (e.g., # -> ### skipping ##)
    const headingMatch = line.match(/^(#{1,6})\s/)
    if (headingMatch) {
      const level = headingMatch[1].length
      headingLineNumbers.push({ level, line: lineNum })

      if (prevHeadingLevel > 0 && level > prevHeadingLevel + 1) {
        issues.push(`Heading level jump from h${prevHeadingLevel} to h${level} at line ${lineNum}`)
      }
      prevHeadingLevel = level

      // Check missing blank line before heading (except first line)
      if (i > 0 && lines[i - 1].trim() !== '') {
        issues.push(`Missing blank line before heading at line ${lineNum}`)
      }
    }

    // Track list markers
    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)]) /)
    if (listMatch) {
      const marker = listMatch[2]
      if (marker === '-' || marker === '*' || marker === '+') {
        listMarkers.add(marker)
      }
    }

    // Track consecutive blank lines
    if (line.trim() === '') {
      consecutiveBlanks++
      if (consecutiveBlanks > maxConsecutiveBlanks) {
        maxConsecutiveBlanks = consecutiveBlanks
      }
    } else {
      consecutiveBlanks = 0
    }
  }

  // Check for mixed list markers
  if (listMarkers.size > 1) {
    issues.push(`Mixed list markers: ${Array.from(listMarkers).map(m => `"${m}"`).join(', ')}`)
  }

  // Check for excessive blank lines
  if (maxConsecutiveBlanks > 3) {
    issues.push(`Excessive blank lines (${maxConsecutiveBlanks} consecutive)`)
  }

  return issues
}
