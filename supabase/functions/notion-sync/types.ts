// Notion Sync - Shared Types
// All TypeScript interfaces for the sync system

// ═══════════════════════════════════════════════════════════════
// STRUCTURE TYPES
// ═══════════════════════════════════════════════════════════════

export interface PageDef {
  title: string
  icon: string
  file?: string
  source?: 'ai' | 'human'
  content?: string
  children?: PageDef[]
}

export interface Structure {
  root: string
  sections: PageDef[]
}

// ═══════════════════════════════════════════════════════════════
// REQUEST / RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface PageUpdate {
  pageTitle: string
  content: string
  pagePath?: string
  contentHash?: string
  parentPageTitle?: string
  icon?: string
}

export interface SyncRequest {
  action: 'sync-structure' | 'update-page' | 'create-structure' | 'cleanup' | 'detect-moves' | 'check-changes' | 'get-state' | 'update-state' | 'health-check'
  staleDays?: number
  autoFix?: boolean
  structure?: Structure
  page?: PageUpdate
  root?: string
  dryRun?: boolean
  skipContent?: boolean
  pageSources?: Record<string, 'ai' | 'human'>
  protectHuman?: boolean
  targetSection?: string
  useStateTracking?: boolean
  contentHashes?: Record<string, string>
  stateUpdates?: StateUpdateEntry[]
}

export interface StateUpdateEntry {
  pagePath: string
  notionPageId?: string
  githubHash: string
  blockCount?: number
  source?: 'ai' | 'human'
}

export interface MovedPage {
  title: string
  file?: string
  expectedParent: string
  actualParent: string
}

export interface BlockStats {
  total: number
  failed: number
  types: Record<string, number>
  failedTypes: Record<string, number>
}

export interface SyncResult {
  success: boolean
  created: string[]
  updated: string[]
  skipped: string[]
  deleted: string[]
  protected: string[]
  moved: MovedPage[]
  errors: string[]
  timestamp: string
  metrics?: SyncMetrics
  // State tracking fields
  needsSync?: string[]
  newPages?: string[]
  changedPages?: string[]
  upToDate?: string[]
  totalChecked?: number
  states?: import('./state-manager.ts').SyncState[]
  totalPages?: number
  debug?: {
    totalBlocks: number
    failedBlocks: number
    blockTypes: Record<string, number>
  }
  // Health check fields
  healthReport?: HealthReport
}

export interface SyncMetrics {
  startTime: number
  endTime?: number
  durationMs?: number
  pagesProcessed: number
  apiCalls: number
  blocksCreated: number
  blocksFailed: number
}

// ═══════════════════════════════════════════════════════════════
// NOTION API RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface NotionRichText {
  type: 'text'
  text: { content: string; link?: { url: string } | null }
  annotations?: {
    bold?: boolean
    italic?: boolean
    strikethrough?: boolean
    underline?: boolean
    code?: boolean
    color?: string
  }
}

export interface NotionBlock {
  id: string
  type: string
  has_children: boolean
  archived: boolean
  created_time: string
  last_edited_time: string
  child_page?: { title: string }
  paragraph?: { rich_text: NotionRichText[] }
  heading_1?: { rich_text: NotionRichText[] }
  heading_2?: { rich_text: NotionRichText[] }
  heading_3?: { rich_text: NotionRichText[] }
  bulleted_list_item?: { rich_text: NotionRichText[] }
  numbered_list_item?: { rich_text: NotionRichText[] }
  to_do?: { rich_text: NotionRichText[]; checked: boolean }
  code?: { rich_text: NotionRichText[]; language: string }
  quote?: { rich_text: NotionRichText[] }
  callout?: { rich_text: NotionRichText[]; icon?: { type: string; emoji?: string } }
  divider?: Record<string, never>
  table?: { table_width: number; has_column_header: boolean; has_row_header: boolean; children?: NotionBlock[] }
  table_row?: { cells: NotionRichText[][] }
}

export interface NotionPage {
  id: string
  object: 'page'
  created_time: string
  last_edited_time: string
  created_by: { type: 'person' | 'bot'; id: string }
  last_edited_by: { type: 'person' | 'bot'; id: string }
  archived: boolean
  parent: { type: 'page_id' | 'workspace' | 'database_id'; page_id?: string }
  properties: Record<string, NotionProperty>
}

export interface NotionProperty {
  id: string
  type: string
  title?: NotionRichText[]
}

export interface NotionSearchResult {
  results: NotionPage[]
  has_more: boolean
  next_cursor: string | null
}

export interface NotionBlockChildren {
  results: NotionBlock[]
  has_more: boolean
  next_cursor: string | null
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION TYPES
// ═══════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK TYPES
// ═══════════════════════════════════════════════════════════════

export interface HealthCheckRequest extends SyncRequest {
  action: 'health-check'
  staleDays?: number       // Days before a page is considered stale (default: 90)
  autoFix?: boolean        // Apply fixes automatically (archive empty, etc.)
}

export interface PageHealth {
  title: string
  pageId: string
  parentTitle: string | null
  status: 'healthy' | 'stale' | 'empty' | 'orphaned' | 'missing-in-notion'
  lastEdited: string | null
  daysSinceEdit: number | null
  isEmpty: boolean
  isHuman: boolean
  file?: string
}

export interface HealthReport {
  timestamp: string
  root: string
  totalPages: number
  pagesChecked: number
  healthy: number
  stale: PageHealth[]
  empty: PageHealth[]
  orphaned: PageHealth[]
  missingInNotion: PageHealth[]
  duplicateTitles: { title: string; count: number; locations: string[] }[]
  brokenLinks: { page: string; file: string; brokenLink: string; target: string }[]
  unbalancedSections: string[]
  autoFixed: string[]
  summary: string
}
