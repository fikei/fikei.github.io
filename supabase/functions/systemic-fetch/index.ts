/**
 * SystemicAI - Page Fetcher Edge Function
 * Fetches external pages, extracts CSS (including pseudo-class states), and discovers links
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FetchRequest {
  url: string;
  extractCss?: boolean;
  extractLinks?: boolean;
  baseUrl?: string;
}

interface FetchResponse {
  html: string;
  css: CssData;
  links: string[];
  error?: string;
}

interface CssData {
  inlineStyles: string[];
  externalSheets: StylesheetData[];
  stateRules: StateRule[];
  customProperties: CustomProperty[];
}

interface StylesheetData {
  url: string;
  content: string;
}

interface StateRule {
  selector: string;
  state: string; // hover, focus, active, disabled, etc.
  properties: Record<string, string>;
  componentType?: string;
}

interface CustomProperty {
  name: string;
  value: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: FetchRequest = await req.json();
    const { url, extractCss = true, extractLinks = true, baseUrl } = body;

    if (!url) {
      return new Response(
        JSON.stringify({ error: "url is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SystemicAI/1.0; Design System Analyzer)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const base = baseUrl || new URL(url).origin;

    // Extract CSS data
    const css: CssData = extractCss
      ? await extractCssData(html, url, base)
      : { inlineStyles: [], externalSheets: [], stateRules: [], customProperties: [] };

    // Extract links
    const links: string[] = extractLinks
      ? extractPageLinks(html, url, base)
      : [];

    const result: FetchResponse = {
      html,
      css,
      links,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Fetch error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Fetch failed",
        html: "",
        css: { inlineStyles: [], externalSheets: [], stateRules: [], customProperties: [] },
        links: [],
      }),
      {
        status: 200, // Return 200 with error in body so client can handle gracefully
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Extract CSS data from HTML including external stylesheets
 */
async function extractCssData(html: string, pageUrl: string, baseUrl: string): Promise<CssData> {
  const cssData: CssData = {
    inlineStyles: [],
    externalSheets: [],
    stateRules: [],
    customProperties: [],
  };

  // Extract inline <style> tags
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    cssData.inlineStyles.push(match[1]);
    parseStateRules(match[1], cssData);
    parseCustomProperties(match[1], cssData);
  }

  // Find external stylesheet links
  const linkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>|<link[^>]+href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi;
  const stylesheetUrls: string[] = [];

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1] || match[2];
    if (href) {
      try {
        const absoluteUrl = new URL(href, pageUrl).href;
        stylesheetUrls.push(absoluteUrl);
      } catch {
        // Invalid URL, skip
      }
    }
  }

  // Fetch external stylesheets (limit to 5 to avoid timeout)
  const sheetsToFetch = stylesheetUrls.slice(0, 5);
  const fetchPromises = sheetsToFetch.map(async (sheetUrl) => {
    try {
      const response = await fetch(sheetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; SystemicAI/1.0)",
        },
      });
      if (response.ok) {
        const content = await response.text();
        return { url: sheetUrl, content };
      }
    } catch {
      // Failed to fetch stylesheet
    }
    return null;
  });

  const sheets = await Promise.all(fetchPromises);
  for (const sheet of sheets) {
    if (sheet) {
      cssData.externalSheets.push(sheet);
      parseStateRules(sheet.content, cssData);
      parseCustomProperties(sheet.content, cssData);
    }
  }

  return cssData;
}

/**
 * Parse CSS for pseudo-class state rules
 */
function parseStateRules(cssText: string, cssData: CssData): void {
  // Match rules with pseudo-class selectors
  const pseudoClasses = ['hover', 'focus', 'active', 'disabled', 'focus-visible', 'focus-within', 'visited', 'checked'];

  // Simplified CSS rule parser - matches selector { properties }
  const ruleRegex = /([^{}]+)\s*\{([^{}]+)\}/g;
  let match;

  while ((match = ruleRegex.exec(cssText)) !== null) {
    const selector = match[1].trim();
    const properties = match[2].trim();

    // Check for pseudo-class states
    for (const state of pseudoClasses) {
      if (selector.includes(`:${state}`)) {
        const rule: StateRule = {
          selector,
          state,
          properties: parseProperties(properties),
          componentType: detectComponentTypeFromSelector(selector),
        };
        cssData.stateRules.push(rule);
        break; // Only add once per rule
      }
    }

    // Also check for state classes (common patterns)
    const stateClassPatterns = [
      { pattern: /\.is-active|\.active(?![a-z-])/i, state: 'active' },
      { pattern: /\.is-disabled|\.disabled(?![a-z-])/i, state: 'disabled' },
      { pattern: /\.is-focused|\.focused(?![a-z-])/i, state: 'focus' },
      { pattern: /\.is-hovered|\.hovered(?![a-z-])/i, state: 'hover' },
      { pattern: /\.is-loading|\.loading(?![a-z-])/i, state: 'loading' },
      { pattern: /\.is-error|\.error(?![a-z-])/i, state: 'error' },
      { pattern: /\.is-success|\.success(?![a-z-])/i, state: 'success' },
    ];

    for (const { pattern, state } of stateClassPatterns) {
      if (pattern.test(selector)) {
        const rule: StateRule = {
          selector,
          state,
          properties: parseProperties(properties),
          componentType: detectComponentTypeFromSelector(selector),
        };
        cssData.stateRules.push(rule);
        break;
      }
    }
  }
}

/**
 * Parse CSS properties from a declaration block
 */
function parseProperties(propertiesStr: string): Record<string, string> {
  const props: Record<string, string> = {};
  const declarations = propertiesStr.split(';');

  for (const decl of declarations) {
    const colonIndex = decl.indexOf(':');
    if (colonIndex > 0) {
      const property = decl.slice(0, colonIndex).trim();
      const value = decl.slice(colonIndex + 1).trim();
      if (property && value) {
        props[property] = value;
      }
    }
  }

  return props;
}

/**
 * Detect component type from CSS selector
 */
function detectComponentTypeFromSelector(selector: string): string | undefined {
  const patterns: [RegExp, string][] = [
    [/button|\.btn/i, 'button'],
    [/input|\.input|\.text-field/i, 'input'],
    [/\.card/i, 'card'],
    [/\.modal|\.dialog/i, 'modal'],
    [/\.nav|navigation/i, 'navigation'],
    [/\.tab/i, 'tabs'],
    [/\.link|^a[^a-z]/i, 'link'],
    [/\.checkbox/i, 'checkbox'],
    [/\.radio/i, 'radio'],
    [/\.select|\.dropdown/i, 'select'],
    [/\.toggle|\.switch/i, 'toggle'],
  ];

  for (const [pattern, type] of patterns) {
    if (pattern.test(selector)) {
      return type;
    }
  }

  return undefined;
}

/**
 * Parse CSS custom properties (CSS variables)
 */
function parseCustomProperties(cssText: string, cssData: CssData): void {
  const varRegex = /--[\w-]+\s*:\s*[^;}]+/g;
  let match;

  while ((match = varRegex.exec(cssText)) !== null) {
    const [name, ...valueParts] = match[0].split(':');
    const value = valueParts.join(':').trim();

    // Avoid duplicates
    if (!cssData.customProperties.some(p => p.name === name.trim())) {
      cssData.customProperties.push({
        name: name.trim(),
        value,
      });
    }
  }
}

/**
 * Extract links from HTML for crawling
 */
function extractPageLinks(html: string, pageUrl: string, baseUrl: string): string[] {
  const links: Set<string> = new Set();
  const baseDomain = new URL(baseUrl).hostname;

  // Match <a href="..."> tags
  const linkRegex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];

    // Skip non-page links
    if (href.startsWith('javascript:') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        href.startsWith('data:')) {
      continue;
    }

    try {
      const absoluteUrl = new URL(href, pageUrl);

      // Only include same-domain links
      if (absoluteUrl.hostname === baseDomain) {
        // Normalize: remove hash, trailing slash
        absoluteUrl.hash = '';
        let normalized = absoluteUrl.href;
        if (normalized.endsWith('/') && normalized.length > 1) {
          normalized = normalized.slice(0, -1);
        }
        links.add(normalized);
      }
    } catch {
      // Invalid URL, skip
    }
  }

  // Also look for navigation patterns and common page links
  const navPatterns = [
    /<nav[^>]*>([\s\S]*?)<\/nav>/gi,
    /<[^>]+role=["']navigation["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
    /<header[^>]*>([\s\S]*?)<\/header>/gi,
    /<footer[^>]*>([\s\S]*?)<\/footer>/gi,
  ];

  for (const pattern of navPatterns) {
    let navMatch;
    while ((navMatch = pattern.exec(html)) !== null) {
      const navContent = navMatch[1];
      const navLinkRegex = /href=["']([^"'#]+)["']/gi;
      let navLinkMatch;

      while ((navLinkMatch = navLinkRegex.exec(navContent)) !== null) {
        try {
          const absoluteUrl = new URL(navLinkMatch[1], pageUrl);
          if (absoluteUrl.hostname === baseDomain) {
            absoluteUrl.hash = '';
            let normalized = absoluteUrl.href;
            if (normalized.endsWith('/') && normalized.length > 1) {
              normalized = normalized.slice(0, -1);
            }
            links.add(normalized);
          }
        } catch {
          // Invalid URL
        }
      }
    }
  }

  return Array.from(links);
}
