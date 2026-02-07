// Documentation Agent - Shared Types
// All TypeScript interfaces for the documentation management system

// ═══════════════════════════════════════════════════════════════
// REQUEST / RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export type DocAgentAction =
  | 'plan:audit' | 'plan:update' | 'plan:add' | 'plan:rebalance'
  | 'arch:sync' | 'arch:audit' | 'arch:add-adr' | 'arch:update-spec'
  | 'capture:bug' | 'capture:work' | 'capture:tech-debt'
  | 'ux:update' | 'ux:audit' | 'ux:wireframe'
  | 'branch:diff' | 'branch:reconcile' | 'branch:cherry-pick-docs'
  | 'cleanup:stale' | 'cleanup:orphans' | 'cleanup:duplicates' | 'cleanup:archive'
  | 'pm:scope-check' | 'pm:dependency-map' | 'pm:status-report' | 'pm:retro'
  | 'pm:decision-log' | 'pm:prd-to-plan' | 'pm:changelog'

export interface DocAgentRequest {
  action: DocAgentAction
  params?: Record<string, unknown>
  // Common params
  scope?: string
  branch?: string
  since?: string
  dryRun?: boolean
  // plan:add / capture params
  title?: string
  description?: string
  subProduct?: string
  severity?: string
  priority?: string
  type?: string
  // arch params
  doc?: string
  section?: string
  changes?: string
  sourceFiles?: string[]
  // pm params
  period?: string
  format?: string
  audience?: string
  prd?: string
}

export interface DocAgentResult {
  success: boolean
  action: DocAgentAction
  report: string
  changes: FileChange[]
  errors: string[]
  metrics: ResultMetrics
  nextActions?: string[]
}

export interface FileChange {
  file: string
  type: 'created' | 'updated' | 'deleted' | 'moved'
  summary: string
  diff?: string
}

export interface ResultMetrics {
  startTime: number
  endTime: number
  durationMs: number
  filesRead: number
  filesChanged: number
  apiCalls: number
}

// ═══════════════════════════════════════════════════════════════
// PROJECT PLAN TYPES
// ═══════════════════════════════════════════════════════════════

export interface PlanPhase {
  file: string
  name: string
  number: number
  status: 'shipped' | 'in-progress' | 'pending'
  totalTasks: number
  completedTasks: number
  inProgressTasks: number
  pendingTasks: number
  blockedTasks: number
}

export interface PlanItem {
  title: string
  status: 'complete' | 'in-progress' | 'pending' | 'blocked'
  phase: string
  epic?: string
  story?: string
  line: number
  file: string
}

export interface PlanAuditReport {
  phasesScanned: number
  itemsAudited: number
  issuesFound: number
  countMismatches: CountMismatch[]
  staleItems: StaleItem[]
  misplacedItems: MisplacedItem[]
  untrackedWork: string[]
}

export interface CountMismatch {
  phase: string
  indexSays: string
  actual: string
  delta: string
}

export interface StaleItem {
  title: string
  phase: string
  epic: string
  lastCommit: string
}

export interface MisplacedItem {
  title: string
  currentPhase: string
  suggestedPhase: string
  reason: string
}

// ═══════════════════════════════════════════════════════════════
// ARCHITECTURE TYPES
// ═══════════════════════════════════════════════════════════════

export interface ArchDoc {
  file: string
  title: string
  lastUpdated: string
  sections: string[]
  relatedCode: string[]
}

export interface ArchSyncReport {
  docsUpdated: ArchDocChange[]
  docsCurrent: string[]
  gapsFound: ArchGap[]
}

export interface ArchDocChange {
  doc: string
  section: string
  whatChanged: string
}

export interface ArchGap {
  code: string
  suggestedDoc: string
  reason: string
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP TYPES
// ═══════════════════════════════════════════════════════════════

export interface StaleDoc {
  file: string
  lastDocUpdate: string
  lastCodeChange: string
  gapDays: number
  codeCommits: number
  severity: 'critical' | 'moderate' | 'healthy'
}

export interface StaleReport {
  critical: StaleDoc[]
  moderate: StaleDoc[]
  healthy: number
  totalDocs: number
}

// ═══════════════════════════════════════════════════════════════
// GITHUB TYPES
// ═══════════════════════════════════════════════════════════════

export interface GitHubFile {
  path: string
  content: string
  sha: string
  lastModified?: string
}

export interface GitHubCommit {
  sha: string
  message: string
  date: string
  files: string[]
}

// ═══════════════════════════════════════════════════════════════
// SUB-PRODUCT MAPPING
// ═══════════════════════════════════════════════════════════════

export interface SubProductMap {
  name: string
  prd: string[]
  planPhases: string[]
  techSpecs: string[]
  uxDocs: string[]
  codePatterns: string[]
}

export const SUB_PRODUCTS: SubProductMap[] = [
  {
    name: 'Boards',
    prd: ['prds/boards-mvp.md'],
    planPhases: ['phase-1', 'phase-2'],
    techSpecs: ['technical-design/client-architecture.md'],
    uxDocs: ['ux/boards/'],
    codePatterns: ['boards/', 'boards/js/', 'boards/index.html'],
  },
  {
    name: 'AI Widgets',
    prd: ['prds/ai-widgets.md', 'prds/generative-widget-ecosystem.md'],
    planPhases: ['phase-3'],
    techSpecs: ['technical-design/ai-widget-system.md', 'technical-design/ai-widget-pipeline.md', 'technical-design/widget-architecture.md'],
    uxDocs: ['ux/widgets/'],
    codePatterns: ['supabase/functions/generate-widget/', 'boards/js/widgets/'],
  },
  {
    name: 'Content Types',
    prd: ['prds/content-type-and-image-systems.md'],
    planPhases: ['phase-3'],
    techSpecs: ['technical-design/content-type-system.md'],
    uxDocs: ['ux/pins/content-types.md'],
    codePatterns: ['boards/js/content-types/'],
  },
  {
    name: 'Design System',
    prd: ['prds/widget-design-system.md'],
    planPhases: ['phase-3'],
    techSpecs: [],
    uxDocs: ['design-system/README.md'],
    codePatterns: ['design-system/'],
  },
  {
    name: 'Sharing',
    prd: ['prds/collaborative-boards.md'],
    planPhases: ['phase-4'],
    techSpecs: ['technical-design/auth-system.md'],
    uxDocs: ['ux/boards/sharing.md'],
    codePatterns: ['boards/js/auth/', 'boards/js/sharing/'],
  },
  {
    name: 'Notion Sync',
    prd: ['prds/notion-sync-platform.md'],
    planPhases: [],
    techSpecs: ['technical-design/sync-protocol.md'],
    uxDocs: [],
    codePatterns: ['supabase/functions/notion-sync/', 'supabase/functions/documentation-agent/'],
  },
  {
    name: 'Soundscape',
    prd: [],
    planPhases: [],
    techSpecs: [],
    uxDocs: [],
    codePatterns: ['soundscape/'],
  },
  {
    name: 'Systemic',
    prd: ['prds/design-system-validation-pipeline.md'],
    planPhases: [],
    techSpecs: [],
    uxDocs: [],
    codePatterns: ['systemic/'],
  },
]
