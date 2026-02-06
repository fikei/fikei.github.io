// Notion Sync - Structure Validator
// Schema validation for notion-structure.json

import type { Structure, PageDef, ValidationResult } from './types.ts'

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
