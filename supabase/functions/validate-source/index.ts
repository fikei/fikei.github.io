// Supabase Edge Function: validate-source
// Server-side structural probe for event source URLs.
// Fetches the page, analyzes content structure, detects source type,
// and optionally uses Claude Haiku to diagnose parsing failures.
// Used by the auto-repair system to determine why a source is broken
// and suggest a repair strategy.
//
// POST /functions/v1/validate-source
// Body: { sourceId, url, currentType, includeAiAnalysis?, parserContext? }
// Returns: { sourceId, reachable, httpStatus, contentType, detectedType, structureReport, htmlSnippet?, aiAnalysis? }
// aiAnalysis may include suggestedOverrides when parserContext is provided

const VERSION = '1.1.1'
console.log(`[validate-source] v${VERSION} - parser-level diagnosis with parserContext + suggestedOverrides`)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Domain allowlist — same as fetch-source
const ALLOWED_DOMAINS = [
  '19hz.info',
  'ra.co', 'www.ra.co',
  'punchlinecomedyclub.com', 'www.punchlinecomedyclub.com',
  'cobbscomedy.com', 'www.cobbscomedy.com',
  'roxie.com', 'www.roxie.com',
  'screenslate.com', 'www.screenslate.com',
  'alamodrafthouse.com', 'drafthouse.com', 'www.drafthouse.com',
  'eventbrite.com', 'www.eventbrite.com',
  'garysguide.com', 'www.garysguide.com',
  'bonobonetwork.com', 'www.bonobonetwork.com',
  'hyperallergic.com', 'www.hyperallergic.com',
  'sfmoma.org', 'www.sfmoma.org',
  'famsf.org', 'www.famsf.org',
  'sfdesignweek.org', 'www.sfdesignweek.org',
  'citylights.com', 'www.citylights.com',
  'sfpl.org', 'www.sfpl.org',
  'commonwealthclub.org', 'www.commonwealthclub.org',
  'audium.org', 'www.audium.org',
  'dice.fm', 'www.dice.fm',
  'songkick.com', 'www.songkick.com',
]

function isDomainAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d))
  } catch {
    return false
  }
}

// --- Content type detection ---

type SourceType = 'html' | 'rss' | 'json' | 'ical' | null

function detectContentType(contentTypeHeader: string, body: string): SourceType {
  const ct = contentTypeHeader.toLowerCase()

  // Check headers first
  if (ct.includes('application/json')) return 'json'
  if (ct.includes('application/rss+xml') || ct.includes('application/atom+xml')) return 'rss'
  if (ct.includes('text/calendar')) return 'ical'

  // Content sniffing for ambiguous content-types
  const trimmed = body.trimStart()
  if (trimmed.startsWith('BEGIN:VCALENDAR')) return 'ical'
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') || trimmed.startsWith('<feed')) return 'rss'
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      JSON.parse(body)
      return 'json'
    } catch { /* not valid JSON */ }
  }

  if (ct.includes('text/html') || ct.includes('application/xhtml')) return 'html'
  if (ct.includes('text/xml') || ct.includes('application/xml')) {
    // Could be RSS or generic XML
    if (body.includes('<item>') || body.includes('<entry>')) return 'rss'
    return 'html' // treat as HTML for table parsing
  }

  return null
}

// --- Structural analysis ---

interface StructureReport {
  hasTable: boolean
  tableRowCount: number
  hasEventSchema: boolean
  hasIcalEvents: boolean
  hasRssItems: boolean
  hasJsonArray: boolean
  hasDatePatterns: boolean
  eventSignals: string[]
}

function analyzeStructure(body: string, detectedType: SourceType): StructureReport {
  const report: StructureReport = {
    hasTable: false,
    tableRowCount: 0,
    hasEventSchema: false,
    hasIcalEvents: false,
    hasRssItems: false,
    hasJsonArray: false,
    hasDatePatterns: false,
    eventSignals: [],
  }

  // Date pattern detection (applies to all types)
  const datePatterns = [
    /\d{4}-\d{2}-\d{2}/g,                     // ISO dates
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/gi,  // Month Day
    /\d{1,2}\/\d{1,2}\/\d{2,4}/g,             // MM/DD/YYYY
  ]
  for (const pattern of datePatterns) {
    const matches = body.match(pattern)
    if (matches && matches.length >= 2) {
      report.hasDatePatterns = true
      report.eventSignals.push(`date-patterns-found:${matches.length}`)
      break
    }
  }

  // iCal analysis
  const veventCount = (body.match(/BEGIN:VEVENT/g) || []).length
  if (veventCount > 0) {
    report.hasIcalEvents = true
    report.eventSignals.push(`ical-events:${veventCount}`)
  }

  // RSS analysis
  const itemCount = (body.match(/<item[\s>]/g) || []).length
  const entryCount = (body.match(/<entry[\s>]/g) || []).length
  if (itemCount > 0 || entryCount > 0) {
    report.hasRssItems = true
    report.eventSignals.push(`rss-items:${itemCount + entryCount}`)
  }

  // JSON analysis
  if (detectedType === 'json') {
    try {
      const parsed = JSON.parse(body)
      if (Array.isArray(parsed)) {
        report.hasJsonArray = true
        report.eventSignals.push(`json-array:${parsed.length}`)
      } else if (typeof parsed === 'object') {
        // Check for common event wrapper keys
        const wrapperKeys = ['events', 'items', 'results', 'data', 'listings']
        for (const key of wrapperKeys) {
          if (parsed[key] && Array.isArray(parsed[key])) {
            report.hasJsonArray = true
            report.eventSignals.push(`json-wrapper:${key}:${parsed[key].length}`)
            break
          }
        }
      }
    } catch { /* already handled by detectedType check */ }
  }

  // HTML analysis (most complex)
  if (detectedType === 'html' || detectedType === null) {
    try {
      const doc = new DOMParser().parseFromString(body, 'text/html')
      if (doc) {
        // Table analysis
        const tables = doc.querySelectorAll('table')
        if (tables.length > 0) {
          report.hasTable = true
          let maxRows = 0
          tables.forEach((table: Element) => {
            const rows = table.querySelectorAll('tr')
            if (rows.length > maxRows) maxRows = rows.length
          })
          report.tableRowCount = maxRows
          report.eventSignals.push(`table-rows:${maxRows}`)

          // Check for 19hz-style 11-column tables
          const firstTable = tables[0]
          if (firstTable) {
            const firstRow = firstTable.querySelector('tr')
            const cells = firstRow?.querySelectorAll('td, th')
            if (cells) {
              const colCount = cells.length
              if (colCount >= 10) report.eventSignals.push(`table-${colCount}-col`)
              else if (colCount >= 6) report.eventSignals.push(`table-${colCount}-col`)
              else if (colCount >= 4) report.eventSignals.push(`table-${colCount}-col`)
            }
          }
        }

        // JSON-LD Event schema
        const scripts = doc.querySelectorAll('script[type="application/ld+json"]')
        scripts.forEach((script: Element) => {
          const text = script.textContent || ''
          if (text.includes('"Event"') || text.includes('"MusicEvent"') || text.includes('"ComedyEvent"')) {
            report.hasEventSchema = true
            report.eventSignals.push('json-ld-event')
          }
        })

        // Event-specific CSS classes
        const eventSelectors = [
          '.event', '.event-item', '.event-card', '.event-listing',
          '.eventlist-event', '[data-type="events"]',
          '.event-row', '.event-entry', '.listing',
          '.show', '.performance', '.screening',
        ]
        for (const sel of eventSelectors) {
          const elements = doc.querySelectorAll(sel)
          if (elements.length > 0) {
            report.eventSignals.push(`css-class:${sel}:${elements.length}`)
          }
        }

        // Squarespace event indicators
        if (body.includes('squarespace') || body.includes('sqs-block')) {
          report.eventSignals.push('squarespace-detected')
          const sqsEvents = doc.querySelectorAll('.eventlist-event, [data-type="events"] article')
          if (sqsEvents.length > 0) {
            report.eventSignals.push(`squarespace-events:${sqsEvents.length}`)
          }
        }

        // Gary's Guide specific
        if (body.includes('ftitle') || body.includes('fblack')) {
          report.eventSignals.push('garysguide-structure')
          const titles = doc.querySelectorAll('.ftitle')
          if (titles.length > 0) {
            report.eventSignals.push(`garysguide-titles:${titles.length}`)
          }
        }
      }
    } catch (e) {
      report.eventSignals.push(`html-parse-error:${(e as Error).message.substring(0, 50)}`)
    }
  }

  return report
}

// --- AI Diagnosis (Claude Haiku) ---

interface ParserContext {
  errors: string[]
  configUsed: Record<string, unknown>
  responseSnippet?: string
}

interface AiAnalysis {
  diagnosis: string
  suggestedType: string
  suggestedStrategy: string
  confidence: number
  suggestedOverrides?: Record<string, unknown>
}

async function diagnoseWithAI(
  sourceId: string,
  url: string,
  currentType: string,
  htmlSnippet: string,
  structureReport: StructureReport,
  parserContext?: ParserContext | null,
): Promise<AiAnalysis | null> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    console.log('[validate-source] ANTHROPIC_API_KEY not set, skipping AI diagnosis')
    return null
  }

  // Build parser diagnostics section if available
  let parserDiagnosticsSection = ''
  if (parserContext?.errors?.length) {
    parserDiagnosticsSection = `

PARSER DIAGNOSTICS — The parser ran and produced these errors:
${parserContext.errors.map(e => `- ${e}`).join('\n')}

Parser config used:
${JSON.stringify(parserContext.configUsed, null, 2)}

${parserContext.responseSnippet ? `Response snippet: ${parserContext.responseSnippet}\n` : ''}
Focus on diagnosing parameter issues. Available overrides per parser type:
- ra: pageSize (int, max 100), dateRangeDays (int), areaId (int)
- screenslate: cityId (string), dayRange (int)
- json: topLevelKeyPath (string — key name in JSON response containing the events array)

If the error suggests a parameter fix, include "suggestedOverrides" in your response with the corrected values.`
  }

  const prompt = `You are diagnosing a broken event source. This web page was being scraped for events using a "${currentType}" parser, but it's returning 0 results.

Source ID: ${sourceId}
URL: ${url}
Current parser type: ${currentType}
Available parser types: html (table-based), rss, json, ical, ra (Resident Advisor GraphQL), screenslate, garysguide, bonobo (Squarespace)

Structural analysis found these signals:
${structureReport.eventSignals.length > 0 ? structureReport.eventSignals.join('\n') : 'No event signals detected'}

Has tables: ${structureReport.hasTable} (${structureReport.tableRowCount} rows)
Has JSON-LD Event schema: ${structureReport.hasEventSchema}
Has RSS items: ${structureReport.hasRssItems}
Has iCal events: ${structureReport.hasIcalEvents}
Has JSON array: ${structureReport.hasJsonArray}
Has date patterns: ${structureReport.hasDatePatterns}
${parserDiagnosticsSection}

First 1500 chars of page content:
${htmlSnippet.substring(0, 1500)}

Analyze why parsing is failing and suggest a fix. Return JSON only:
{
  "diagnosis": "brief explanation of what's wrong",
  "suggestedType": "the parser type that would work (html|rss|json|ical|ra|screenslate|garysguide|bonobo) or empty string if unknown",
  "suggestedStrategy": "one of: retry (transient failure), switch-type (wrong parser), url-changed (page moved), structure-changed (DOM changed), seasonal-empty (no events right now), blocked (access denied), param-fix (parameter adjustment needed), unknown",
  "confidence": 0.0 to 1.0,
  "suggestedOverrides": { "paramName": "value" } or null if no parameter fix needed
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      console.error('[validate-source] AI API error:', response.status)
      return null
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)

    if (match) {
      const result = JSON.parse(match[0])
      const analysis: AiAnalysis = {
        diagnosis: typeof result.diagnosis === 'string' ? result.diagnosis : 'Unknown issue',
        suggestedType: typeof result.suggestedType === 'string' ? result.suggestedType : '',
        suggestedStrategy: typeof result.suggestedStrategy === 'string' ? result.suggestedStrategy : 'unknown',
        confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0.5,
      }
      // Extract parameter overrides if AI suggested them
      if (result.suggestedOverrides && typeof result.suggestedOverrides === 'object' && result.suggestedOverrides !== null) {
        analysis.suggestedOverrides = result.suggestedOverrides
        console.log(`[validate-source] AI suggested overrides: ${JSON.stringify(result.suggestedOverrides)}`)
      }
      return analysis
    }
  } catch (e) {
    console.error('[validate-source] AI diagnosis error:', e)
  }

  return null
}

// --- Fetch page with detailed status ---

interface FetchResult {
  body: string | null
  status: number
  contentType: string
  error: string | null
}

async function fetchWithDetails(url: string): Promise<FetchResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const body = await resp.text()
    return {
      body,
      status: resp.status,
      contentType: resp.headers.get('content-type') || '',
      error: null,
    }
  } catch (e) {
    const msg = (e as Error).message || 'Unknown fetch error'
    return {
      body: null,
      status: 0,
      contentType: '',
      error: msg.includes('abort') ? 'timeout' : msg,
    }
  }
}

// --- Main handler ---

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST required' }, 405)
  }

  try {
    const { sourceId, url, currentType, includeAiAnalysis, parserContext } = await req.json() as {
      sourceId: string
      url: string
      currentType: string
      includeAiAnalysis?: boolean
      parserContext?: ParserContext
    }

    if (!sourceId || !url) {
      return jsonResponse({ error: 'sourceId and url are required' }, 400)
    }

    // Domain check
    if (!isDomainAllowed(url)) {
      return jsonResponse({
        sourceId,
        reachable: false,
        httpStatus: 0,
        contentType: '',
        detectedType: null,
        structureReport: {
          hasTable: false, tableRowCount: 0, hasEventSchema: false,
          hasIcalEvents: false, hasRssItems: false, hasJsonArray: false,
          hasDatePatterns: false, eventSignals: [],
        },
        htmlSnippet: null,
        aiAnalysis: null,
        error: 'Domain not in allowlist',
      })
    }

    console.log(`[validate-source] Probing ${sourceId}: ${url} (type=${currentType})`)

    // Fetch the page
    const fetchResult = await fetchWithDetails(url)

    if (!fetchResult.body || fetchResult.error) {
      console.log(`[validate-source] ${sourceId}: fetch failed — ${fetchResult.error || `HTTP ${fetchResult.status}`}`)
      // Even if fetch failed, run AI analysis when parser diagnostics are available
      let aiAnalysis: AiAnalysis | null = null
      if (includeAiAnalysis && parserContext?.errors?.length) {
        console.log(`[validate-source] ${sourceId}: fetch failed but parser context available — running AI diagnosis`)
        const emptyReport: StructureReport = {
          hasTable: false, tableRowCount: 0, hasEventSchema: false,
          hasIcalEvents: false, hasRssItems: false, hasJsonArray: false,
          hasDatePatterns: false, eventSignals: [],
        }
        aiAnalysis = await diagnoseWithAI(sourceId, url, currentType || 'unknown', '', emptyReport, parserContext)
      }
      return jsonResponse({
        sourceId,
        reachable: false,
        httpStatus: fetchResult.status,
        contentType: fetchResult.contentType,
        detectedType: null,
        structureReport: {
          hasTable: false, tableRowCount: 0, hasEventSchema: false,
          hasIcalEvents: false, hasRssItems: false, hasJsonArray: false,
          hasDatePatterns: false, eventSignals: [],
        },
        htmlSnippet: null,
        aiAnalysis,
        error: fetchResult.error || `HTTP ${fetchResult.status}`,
      })
    }

    const reachable = fetchResult.status >= 200 && fetchResult.status < 400
    const detectedType = detectContentType(fetchResult.contentType, fetchResult.body)
    const structureReport = analyzeStructure(fetchResult.body, detectedType)
    const htmlSnippet = fetchResult.body.substring(0, 2000)

    console.log(`[validate-source] ${sourceId}: reachable=${reachable} status=${fetchResult.status} detected=${detectedType} signals=[${structureReport.eventSignals.join(', ')}]`)

    // AI diagnosis (optional)
    // Run AI when: (a) reachable + AI requested, OR (b) parser diagnostics provided (don't need reachability for parameter fixes)
    let aiAnalysis: AiAnalysis | null = null
    if (includeAiAnalysis && (reachable || parserContext)) {
      if (parserContext) {
        console.log(`[validate-source] ${sourceId}: parser context provided — errors: ${parserContext.errors?.join('; ')}`)
      }
      aiAnalysis = await diagnoseWithAI(sourceId, url, currentType || 'unknown', htmlSnippet || '', structureReport, parserContext)
      if (aiAnalysis) {
        console.log(`[validate-source] AI: ${sourceId} → diagnosis="${aiAnalysis.diagnosis}" suggested="${aiAnalysis.suggestedType}" strategy="${aiAnalysis.suggestedStrategy}" confidence=${aiAnalysis.confidence}${aiAnalysis.suggestedOverrides ? ` overrides=${JSON.stringify(aiAnalysis.suggestedOverrides)}` : ''}`)
      }
    }

    return jsonResponse({
      sourceId,
      reachable,
      httpStatus: fetchResult.status,
      contentType: fetchResult.contentType,
      detectedType,
      structureReport,
      htmlSnippet,
      aiAnalysis,
      error: null,
    })
  } catch (err) {
    console.error('[validate-source] Error:', err)
    return jsonResponse({ error: (err as Error).message }, 500)
  }
})
