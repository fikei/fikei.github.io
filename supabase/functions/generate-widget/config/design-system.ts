// Design System Registry for Widget Generation
// Embeds template-registry.json data so AI prompts can reference
// available w-* classes, body modifiers, and structure rules.
//
// Source of truth: design-system/widgets.css + template-registry.json
// This file is a server-side snapshot. Regenerate when the design system changes.

// =============================================================================
// TEMPLATE DEFINITIONS (from template-registry.json)
// =============================================================================

export interface TemplateDefinition {
  bodyModifier: string
  description: string
  validSizes: string[]
  requiredAtoms: string[]
  optionalAtoms: string[]
  structure: string
}

// Boards template name → design system template name
export const boardsTemplateMap: Record<string, string> = {
  'grid-split': 'split',
  'hero-card': 'verdict',
  'list': 'list',
  'text-block': 'narrative',
  'spectrum': 'spectrum',
  'stat-row': 'stats',
  'quick-add': 'suggestion',
}

export const templates: Record<string, TemplateDefinition> = {
  verdict: {
    bodyModifier: 'w-body--verdict',
    description: 'Hero headline with verdict tags — bold statement + supporting evidence',
    validSizes: ['sm', 'med', 'lg'],
    requiredAtoms: ['w-text--display', 'w-tag-group', 'w-badge'],
    optionalAtoms: ['w-text--meta', 'w-img--hero'],
    structure: 'w-shell > w-header + w-body.w-body--verdict > w-headline + w-tag-group',
  },
  list: {
    bodyModifier: 'w-body--list',
    description: 'Vertical stack of rows — ranked items, search results, feeds',
    validSizes: ['sm', 'med', 'tall', 'lg', 'wide'],
    requiredAtoms: ['w-row', 'w-text'],
    optionalAtoms: ['w-img--thumb', 'w-badge', 'w-bar'],
    structure: 'w-shell > w-header + w-body.w-body--list > w-row*',
  },
  spectrum: {
    bodyModifier: 'w-body--spectrum',
    description: 'Dimensional positioning on labeled axes',
    validSizes: ['sm', 'med', 'lg'],
    requiredAtoms: ['w-axis', 'w-text--label'],
    optionalAtoms: ['w-text--note'],
    structure: 'w-shell > w-header + w-body.w-body--spectrum > w-axis*',
  },
  split: {
    bodyModifier: 'w-body--split',
    description: 'Two-column layout with vertical divider',
    validSizes: ['med', 'lg'],
    requiredAtoms: ['w-column', 'w-divider--vertical'],
    optionalAtoms: ['w-text', 'w-img', 'w-badge'],
    structure: 'w-shell > w-header + w-body.w-body--split > w-column + w-divider--vertical + w-column',
  },
  narrative: {
    bodyModifier: 'w-body--narrative',
    description: 'Long-form prose text — editorial commentary, style notes',
    validSizes: ['med', 'tall', 'lg'],
    requiredAtoms: ['w-text--prose'],
    optionalAtoms: ['w-text--title', 'w-tag-group', 'w-img--hero'],
    structure: 'w-shell > w-header + w-body.w-body--narrative > w-text--prose*',
  },
  suggestion: {
    bodyModifier: 'w-body--suggestion',
    description: 'Featured single item recommendation with CTA',
    validSizes: ['sm', 'med', 'tall', 'lg'],
    requiredAtoms: ['w-text--title', 'w-img'],
    optionalAtoms: ['w-text--meta', 'w-badge', 'w-btn', 'w-text--note'],
    structure: 'w-shell > w-header + w-body.w-body--suggestion > w-img + w-headline + w-actions',
  },
  stats: {
    bodyModifier: 'w-body--stats',
    description: 'Collection metrics as stat cards',
    validSizes: ['sm', 'med', 'lg'],
    requiredAtoms: ['w-stat'],
    optionalAtoms: ['w-text--label', 'w-badge'],
    structure: 'w-shell > w-header + w-body.w-body--stats > w-stat*',
  },
  comparison: {
    bodyModifier: 'w-body--comparison',
    description: 'Two options side by side with labeled divider',
    validSizes: ['med', 'lg'],
    requiredAtoms: ['w-option', 'w-divider--labeled'],
    optionalAtoms: ['w-text', 'w-badge', 'w-btn'],
    structure: 'w-shell > w-header + w-body.w-body--comparison > w-option + w-divider--labeled + w-option',
  },
  choices: {
    bodyModifier: 'w-body--choices',
    description: 'Selectable option cards — quiz-style, preference picking',
    validSizes: ['sm', 'med', 'lg'],
    requiredAtoms: ['w-option'],
    optionalAtoms: ['w-text--title', 'w-badge', 'w-img--card'],
    structure: 'w-shell > w-header + w-body.w-body--choices > w-option*',
  },
  grouped: {
    bodyModifier: 'w-body--grouped',
    description: 'Labeled sections with grouped content',
    validSizes: ['med', 'tall', 'lg'],
    requiredAtoms: ['w-section', 'w-text--title'],
    optionalAtoms: ['w-row', 'w-badge', 'w-divider'],
    structure: 'w-shell > w-header + w-body.w-body--grouped > w-section*',
  },
}

// =============================================================================
// CLASS ALLOWLIST (from manifest.json)
// =============================================================================

// All valid w-* class names that may appear in widget HTML
const ALLOWED_CLASSES = new Set([
  // Shell & structure
  'w-shell', 'w-header', 'w-body', 'w-footer',
  'w-header__left', 'w-header__controls',
  // Shell sizes
  'w-shell--sm', 'w-shell--med', 'w-shell--tall', 'w-shell--lg',
  'w-shell--wide', 'w-shell--full', 'w-shell--banner',
  'w-shell--col-1', 'w-shell--col-2', 'w-shell--col-3', 'w-shell--col-4',
  'w-shell--hero-wide', 'w-shell--hero-tall', 'w-shell--strip',
  'w-shell--mini', 'w-shell--half', 'w-shell--third',
  // Body modifiers
  'w-body--verdict', 'w-body--list', 'w-body--spectrum', 'w-body--split',
  'w-body--narrative', 'w-body--suggestion', 'w-body--stats',
  'w-body--comparison', 'w-body--choices', 'w-body--grouped',
  'w-body--checklist', 'w-body--loading',
  // Atoms
  'w-text', 'w-text--label', 'w-text--display', 'w-text--title',
  'w-text--meta', 'w-text--value', 'w-text--note', 'w-text--prose',
  'w-badge', 'w-badge--filled', 'w-badge--accent', 'w-badge--success', 'w-badge--error',
  'w-bar', 'w-bar--thick', 'w-bar--thin',
  'w-icon', 'w-icon--sm',
  'w-icon-btn',
  'w-img', 'w-img--wide', 'w-img--banner', 'w-img--thumb', 'w-img--card', 'w-img--hero',
  'w-btn', 'w-btn--filled', 'w-btn--sm', 'w-btn--block',
  'w-loader',
  // Molecules
  'w-headline',
  'w-tag-group',
  'w-row',
  'w-stat',
  'w-axis', 'w-axis__track', 'w-axis__marker', 'w-axis__labels',
  'w-items', 'w-item',
  'w-divider', 'w-divider--vertical', 'w-divider--labeled', 'w-divider__label',
  'w-action-bar',
  'w-option',
  'w-section',
  'w-column',
])

// =============================================================================
// PROMPT BUILDER — Design System Constraints
// =============================================================================

/**
 * Resolve a Boards template name to its design system template definition.
 * Accepts either a Boards name ("grid-split") or a DS name ("split").
 */
export function resolveTemplate(templateName: string): TemplateDefinition | null {
  // Try direct match first
  if (templates[templateName]) {
    return templates[templateName]
  }
  // Try Boards alias
  const dsName = boardsTemplateMap[templateName]
  if (dsName && templates[dsName]) {
    return templates[dsName]
  }
  return null
}

/**
 * Build the design system constraint section for an AI prompt.
 * Tells the AI which w-* classes are available and what structure to use.
 */
export function buildDesignSystemPrompt(templateName: string): string {
  const template = resolveTemplate(templateName)
  if (!template) {
    return ''
  }

  const dsName = boardsTemplateMap[templateName] || templateName

  return `
DESIGN SYSTEM OUTPUT FORMAT:
Your response will be rendered inside a widget using the "${dsName}" template.
Body modifier: ${template.bodyModifier}
Structure: ${template.structure}

Required elements (must include):
${template.requiredAtoms.map(a => `  - ${a}`).join('\n')}

Optional elements (may include):
${template.optionalAtoms.map(a => `  - ${a}`).join('\n')}

Valid widget sizes: ${template.validSizes.join(', ')}

ALLOWED CSS CLASSES (only use these w-* class names in any HTML output):
Shell: w-shell, w-header, w-body, w-footer, w-header__left, w-header__controls
Atoms: w-text, w-text--label, w-text--display, w-text--title, w-text--meta, w-text--value, w-text--note, w-text--prose, w-badge, w-badge--filled, w-btn, w-btn--filled, w-img, w-img--thumb, w-img--card, w-icon, w-icon-btn, w-bar, w-loader
Molecules: w-headline, w-tag-group, w-row, w-stat, w-axis, w-items, w-item, w-divider, w-divider--vertical, w-divider--labeled, w-action-bar, w-option, w-section, w-column

Do NOT invent custom class names. Only use classes from the list above.`
}

// =============================================================================
// HTML VALIDATION — Class Allowlist
// =============================================================================

export interface ValidationResult {
  valid: boolean
  unknownClasses: string[]
  classesUsed: string[]
}

/**
 * Extract all w-* class names from an HTML string and validate against allowlist.
 * Returns which classes are valid and which are unknown.
 */
export function validateWidgetHtml(html: string): ValidationResult {
  // Match all class="..." attributes and extract w-* tokens
  const classAttrRegex = /class="([^"]*)"/g
  const classesUsed = new Set<string>()
  const unknownClasses: string[] = []

  let match
  while ((match = classAttrRegex.exec(html)) !== null) {
    const classNames = match[1].split(/\s+/)
    for (const cls of classNames) {
      if (cls.startsWith('w-')) {
        classesUsed.add(cls)
        if (!ALLOWED_CLASSES.has(cls)) {
          unknownClasses.push(cls)
        }
      }
    }
  }

  return {
    valid: unknownClasses.length === 0,
    unknownClasses,
    classesUsed: Array.from(classesUsed),
  }
}

/**
 * Strip unknown w-* classes from HTML, keeping only allowed ones.
 * Non-w-* classes are preserved (they may be app-specific).
 */
export function sanitizeWidgetHtml(html: string): string {
  return html.replace(/class="([^"]*)"/g, (_match, classes: string) => {
    const filtered = classes
      .split(/\s+/)
      .filter((cls: string) => !cls.startsWith('w-') || ALLOWED_CLASSES.has(cls))
      .join(' ')
    return `class="${filtered}"`
  })
}
