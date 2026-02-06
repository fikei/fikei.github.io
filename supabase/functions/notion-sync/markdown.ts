// Notion Sync - Markdown to Notion Blocks Converter
// Extracted from NotionClient for modularity and reuse

import type { NotionRichText } from './types.ts'

// Notion supported languages for code blocks
const VALID_LANGUAGES = new Set([
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
  'webassembly', 'xml', 'yaml',
])

// Language aliases for common shorthand
const LANGUAGE_ALIASES: Record<string, string> = {
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

const MAX_CODE_BLOCK_LENGTH = 2000

/** Check if a URL is valid for Notion (must be absolute http/https) */
function isValidNotionUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** Normalize a code block language identifier to a Notion-supported value */
export function normalizeLanguage(lang: string): string {
  const lower = lang.toLowerCase()
  const aliased = LANGUAGE_ALIASES[lower] || lower
  return VALID_LANGUAGES.has(aliased) ? aliased : 'plain text'
}

/** Parse inline markdown formatting into Notion rich_text segments */
export function parseRichText(text: string): NotionRichText[] {
  const segments: NotionRichText[] = []
  let remaining = text

  while (remaining.length > 0) {
    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/)
    if (linkMatch) {
      const linkText = linkMatch[1]
      const linkUrl = linkMatch[2]

      if (isValidNotionUrl(linkUrl)) {
        segments.push({
          type: 'text',
          text: { content: linkText, link: { url: linkUrl } },
        })
      } else {
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

    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~([^~]+)~~/)
    if (strikeMatch) {
      segments.push({
        type: 'text',
        text: { content: strikeMatch[1] },
        annotations: { strikethrough: true },
      })
      remaining = remaining.slice(strikeMatch[0].length)
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
    const plainMatch = remaining.match(/^[^[*_`~]+/)
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

/** Convert a full markdown string into an array of Notion block objects */
export function markdownToBlocks(markdown: string): any[] {
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
      const langNormalized = normalizeLanguage(language)

      // Notion limits code block text to 2000 chars - split if needed
      if (codeContent.length <= MAX_CODE_BLOCK_LENGTH) {
        blocks.push({
          object: 'block',
          type: 'code',
          code: {
            rich_text: [{ type: 'text', text: { content: codeContent } }],
            language: langNormalized,
          },
        })
      } else {
        for (let start = 0; start < codeContent.length; start += MAX_CODE_BLOCK_LENGTH) {
          blocks.push({
            object: 'block',
            type: 'code',
            code: {
              rich_text: [{ type: 'text', text: { content: codeContent.slice(start, start + MAX_CODE_BLOCK_LENGTH) } }],
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
      const dataRows: string[][] = []
      let headerRow: string[] | null = null

      while (i < lines.length) {
        const currentLine = lines[i].trim()

        if (!currentLine.startsWith('|') || !currentLine.endsWith('|')) {
          break
        }

        // Check if separator row (|---|---|)
        if (/^\|[\s\-:|]+\|$/.test(currentLine)) {
          i++
          continue
        }

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

      if (headerRow && headerRow.length > 0) {
        const tableWidth = headerRow.length
        const tableRows: any[] = []

        // Header row
        tableRows.push({
          type: 'table_row',
          table_row: {
            cells: headerRow.map(cell => parseRichText(cell)),
          },
        })

        // Data rows
        for (const row of dataRows) {
          const cells: any[][] = []
          for (let col = 0; col < tableWidth; col++) {
            cells.push(parseRichText(row[col] || ''))
          }
          tableRows.push({
            type: 'table_row',
            table_row: { cells },
          })
        }

        blocks.push({
          object: 'block',
          type: 'table',
          table: {
            table_width: tableWidth,
            has_column_header: true,
            has_row_header: false,
            children: tableRows,
          },
        })
      }
      continue
    }

    // Heading 1: #
    if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: { rich_text: parseRichText(line.slice(2)) },
      })
      i++
      continue
    }

    // Heading 2: ##
    if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: parseRichText(line.slice(3)) },
      })
      i++
      continue
    }

    // Heading 3: ###
    if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: { rich_text: parseRichText(line.slice(4)) },
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
        numbered_list_item: { rich_text: parseRichText(numberedMatch[2]) },
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
          rich_text: parseRichText(checkboxMatch[2]),
          checked: checkboxMatch[1] === 'x',
        },
      })
      i++
      continue
    }

    // Bullet list: - or *
    if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: parseRichText(line.slice(2)) },
      })
      i++
      continue
    }

    // Callout: > [!NOTE] or > [!TIP] etc.
    const calloutMatch = line.match(/^>\s*\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*(.*)/)
    if (calloutMatch) {
      const icons: Record<string, string> = {
        NOTE: '\u2139\ufe0f',
        TIP: '\ud83d\udca1',
        WARNING: '\u26a0\ufe0f',
        IMPORTANT: '\u2757',
      }
      blocks.push({
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: parseRichText(calloutMatch[2] || calloutMatch[1]),
          icon: { type: 'emoji', emoji: icons[calloutMatch[1]] || '\u2139\ufe0f' },
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
        quote: { rich_text: parseRichText(line.slice(2)) },
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

    // Default: paragraph
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: parseRichText(line) },
    })
    i++
  }

  return blocks
}
