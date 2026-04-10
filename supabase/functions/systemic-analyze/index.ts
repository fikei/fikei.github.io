/**
 * SystemicAI - Component Analysis Edge Function
 * Uses Anthropic API to analyze UI components and generate documentation
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AnalyzeRequest {
  // Component analysis (existing)
  componentType?: string;
  componentHtml?: string;
  componentStyles?: Record<string, string>;
  variants?: number;
  contextClues?: string[];
  contextUrls?: string[];
  // Principles extraction (new)
  action?: 'component' | 'principles';
  designSystemSummary?: DesignSystemSummary;
}

interface DesignSystemSummary {
  name: string;
  sourceUrl?: string;
  tokens: {
    colorCount: number;
    primaryColor?: string;
    secondaryColor?: string;
    fontPrimary?: string;
    spacingBase?: number;
    hasElevation?: boolean;
    hasBorderRadius?: boolean;
    cssVariableNames?: string[];
  };
  components: Array<{
    type: string;
    variantCount: number;
    totalUsage: number;
    states: string[];
    sampleClasses: string[];
    sampleHtml?: string;
  }>;
  source?: { type: string };
}

interface PrinciplesResponse {
  philosophyStatement: string;
  globalPrinciples: Array<{ title: string; description: string }>;
  componentPrinciples: Record<string, Array<{ rule: string; rationale: string }>>;
  generatedAt: string;
}

interface AnalyzeResponse {
  name: string;
  intent: string;
  suggestedToken: string;
  whenToUse: string[];
  whenNotToUse: string[];
  accessibility: string[];
  materialMapping: string;
  description: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured");
    }

    const body: AnalyzeRequest = await req.json();
    const client = new Anthropic({ apiKey });

    // ── Principles extraction ──────────────────────────────────────
    if (body.action === 'principles') {
      if (!body.designSystemSummary) {
        return new Response(
          JSON.stringify({ error: "designSystemSummary is required for action=principles" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const principlesPrompt = buildPrinciplesPrompt(body.designSystemSummary);
      const principlesMsg = await client.messages.create({
        model: "claude-haiku-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: principlesPrompt }],
      });

      const principlesText = principlesMsg.content.find((c) => c.type === "text");
      if (!principlesText || principlesText.type !== "text") {
        throw new Error("No text response from AI");
      }

      const principles = parsePrinciplesResponse(principlesText.text, body.designSystemSummary);
      return new Response(JSON.stringify(principles), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Component analysis (existing) ─────────────────────────────
    const {
      componentType,
      componentHtml,
      componentStyles,
      variants = 1,
      contextClues = [],
    } = body;

    if (!componentType) {
      return new Response(
        JSON.stringify({ error: "componentType is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const prompt = buildAnalysisPrompt(
      componentType,
      componentHtml,
      componentStyles,
      variants,
      contextClues
    );

    const message = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    // Extract text content
    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from AI");
    }

    // Parse the structured response
    const analysis = parseAnalysisResponse(textContent.text, componentType);

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Analysis error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Analysis failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

/**
 * Build the analysis prompt for Claude
 */
function buildAnalysisPrompt(
  componentType: string,
  html?: string,
  styles?: Record<string, string>,
  variants?: number,
  contextClues?: string[]
): string {
  let prompt = `You are a UI/UX expert analyzing a component for design system documentation.

Component Type: ${componentType}
Number of Variants: ${variants}
`;

  if (contextClues && contextClues.length > 0) {
    prompt += `Context Clues (CSS classes found): ${contextClues.join(", ")}\n`;
  }

  if (html) {
    prompt += `\nHTML Structure:\n\`\`\`html\n${html}\n\`\`\`\n`;
  }

  if (styles && Object.keys(styles).length > 0) {
    prompt += `\nComputed Styles:\n\`\`\`json\n${JSON.stringify(styles, null, 2)}\n\`\`\`\n`;
  }

  prompt += `
Based on this component, provide a comprehensive analysis following Material Design guidelines.

Respond in this exact JSON format:
{
  "name": "Human-readable component name",
  "intent": "Primary purpose (e.g., 'primary-action', 'form-control', 'navigation')",
  "suggestedToken": "CSS class token name (e.g., 'btn-primary')",
  "description": "1-2 sentence description of the component",
  "whenToUse": ["Guideline 1", "Guideline 2", "Guideline 3"],
  "whenNotToUse": ["Anti-pattern 1", "Anti-pattern 2"],
  "accessibility": ["A11y requirement 1", "A11y requirement 2", "A11y requirement 3"],
  "materialMapping": "Closest Material Design 3 component (e.g., 'FilledButton', 'OutlinedTextField')"
}

Ensure:
- "whenToUse" has 3-5 actionable guidelines
- "whenNotToUse" has 2-3 clear anti-patterns
- "accessibility" has 3-4 specific WCAG requirements
- "materialMapping" references an actual Material Design 3 component

Return ONLY the JSON, no additional text.`;

  return prompt;
}

/**
 * Parse the AI response into structured data
 */
function parseAnalysisResponse(
  text: string,
  componentType: string
): AnalyzeResponse {
  try {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        name: parsed.name || formatComponentName(componentType),
        intent: parsed.intent || "general",
        suggestedToken: parsed.suggestedToken || componentType,
        whenToUse: parsed.whenToUse || getDefaultWhenToUse(componentType),
        whenNotToUse: parsed.whenNotToUse || getDefaultWhenNotToUse(componentType),
        accessibility: parsed.accessibility || getDefaultAccessibility(componentType),
        materialMapping: parsed.materialMapping || getMaterialMapping(componentType),
        description: parsed.description || `A ${componentType} component.`,
      };
    }
  } catch (e) {
    console.warn("Failed to parse AI response, using defaults:", e);
  }

  // Return defaults if parsing fails
  return {
    name: formatComponentName(componentType),
    intent: "general",
    suggestedToken: componentType,
    whenToUse: getDefaultWhenToUse(componentType),
    whenNotToUse: getDefaultWhenNotToUse(componentType),
    accessibility: getDefaultAccessibility(componentType),
    materialMapping: getMaterialMapping(componentType),
    description: `A ${componentType} component.`,
  };
}

/**
 * Format component name for display
 */
function formatComponentName(type: string): string {
  return type
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Get default "when to use" guidelines
 */
function getDefaultWhenToUse(type: string): string[] {
  const defaults: Record<string, string[]> = {
    button: [
      "For primary actions that advance the user workflow",
      "To submit forms or confirm dialogs",
      "For calls-to-action that require visual prominence",
    ],
    "text-input": [
      "For collecting short text input from users",
      "In forms requiring user data entry",
      "For search functionality",
    ],
    card: [
      "To group related content together",
      "For presenting preview information",
      "When content needs visual separation",
    ],
    link: [
      "For navigation to other pages or resources",
      "When action results in leaving current context",
      "For inline references to other content",
    ],
    navigation: [
      "For primary site/app navigation",
      "To help users understand their location",
      "When providing access to main sections",
    ],
  };

  return defaults[type] || ["Use when appropriate for the context"];
}

/**
 * Get default "when not to use" guidelines
 */
function getDefaultWhenNotToUse(type: string): string[] {
  const defaults: Record<string, string[]> = {
    button: [
      "For navigation between pages (use links instead)",
      "When the action is purely informational",
    ],
    "text-input": [
      "For long-form content (use textarea)",
      "When selecting from predefined options (use select)",
    ],
    card: [
      "For simple text content without grouping needs",
      "When nesting would create confusion",
    ],
    link: [
      "For actions that don't navigate (use buttons)",
      "When action is destructive",
    ],
    navigation: [
      "For in-page navigation (use anchor links)",
      "For action triggers (use buttons)",
    ],
  };

  return defaults[type] || ["Avoid when the pattern doesn't fit user needs"];
}

/**
 * Get default accessibility guidelines
 */
function getDefaultAccessibility(type: string): string[] {
  const defaults: Record<string, string[]> = {
    button: [
      "Ensure minimum touch target of 44x44 pixels",
      "Include visible focus states",
      "Use aria-label for icon-only buttons",
      "Maintain 4.5:1 contrast ratio for text",
    ],
    "text-input": [
      "Associate labels with inputs using for/id",
      "Provide clear error messages",
      "Support keyboard navigation",
      "Include aria-describedby for helper text",
    ],
    card: [
      "Use semantic HTML structure",
      "Ensure focusable if interactive",
      "Include alt text for images",
    ],
    link: [
      "Use descriptive link text",
      "Indicate external links",
      "Ensure visible focus states",
    ],
    navigation: [
      "Use nav element or role='navigation'",
      "Include skip links for keyboard users",
      "Indicate current page with aria-current",
    ],
  };

  return defaults[type] || [
    "Ensure keyboard accessibility",
    "Include appropriate ARIA attributes",
    "Maintain sufficient color contrast",
  ];
}

/**
 * Get Material Design 3 component mapping
 */
function getMaterialMapping(type: string): string {
  const mappings: Record<string, string> = {
    button: "FilledButton",
    "text-input": "FilledTextField",
    card: "ElevatedCard",
    link: "TextButton",
    navigation: "NavigationBar",
    checkbox: "Checkbox",
    radio: "RadioButton",
    select: "ExposedDropdownMenu",
    textarea: "FilledTextField",
    toggle: "Switch",
    tabs: "Tabs",
    modal: "Dialog",
    chip: "FilterChip",
    badge: "Badge",
  };

  return mappings[type] || "Custom";
}

// ──────────────────────────────────────────────────────────────────
// Principles extraction (new)
// ──────────────────────────────────────────────────────────────────

function buildPrinciplesPrompt(ds: DesignSystemSummary): string {
  const compList = ds.components.map(c =>
    `- ${c.type}: ${c.variantCount} variants, ${c.totalUsage} uses, classes: [${c.sampleClasses.slice(0, 6).join(', ')}]`
  ).join('\n');

  return `You are a senior design systems expert. Analyse this design system and extract its design principles.

DESIGN SYSTEM: ${ds.name}
SOURCE: ${ds.sourceUrl || 'unknown'}
SOURCE TYPE: ${ds.source?.type || 'url'}

TOKENS:
- Colors: ${ds.tokens.colorCount} tokens, primary: ${ds.tokens.primaryColor || 'unknown'}, secondary: ${ds.tokens.secondaryColor || 'unknown'}
- Typography: ${ds.tokens.fontPrimary || 'unknown'}
- Spacing base: ${ds.tokens.spacingBase ? ds.tokens.spacingBase + 'px' : 'unknown'}
- Elevation: ${ds.tokens.hasElevation ? 'yes' : 'no'}
- Border radius: ${ds.tokens.hasBorderRadius ? 'yes' : 'no'}
- CSS variables (sample): ${(ds.tokens.cssVariableNames || []).slice(0, 12).join(', ')}

COMPONENTS (${ds.components.length} types):
${compList}

Respond ONLY in this exact JSON format — no markdown, no extra text:
{
  "philosophyStatement": "One sentence describing the overall visual and interaction philosophy of this design system.",
  "globalPrinciples": [
    { "title": "Principle name (2-4 words)", "description": "1-2 sentence explanation of what this principle means in this system, with specific evidence from the tokens or components." }
  ],
  "componentPrinciples": {
    "<componentType>": [
      { "rule": "Short imperative rule (e.g. 'Always pair with a ghost cancel')", "rationale": "Why this rule exists based on what was found in this system." }
    ]
  }
}

Rules:
- globalPrinciples: 4-7 principles. Each must be grounded in actual evidence from the token/component data above. Cover: visual language, hierarchy, spacing/density, color use, interaction pattern, accessibility stance.
- componentPrinciples: include every component type listed above. 2-4 rules per component. Rules must be specific to THIS system, not generic design advice.
- philosophyStatement: must read like something from a brand guidelines doc — opinionated, specific to this system.
Return ONLY the JSON object.`;
}

function parsePrinciplesResponse(text: string, ds: DesignSystemSummary): PrinciplesResponse {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        philosophyStatement: parsed.philosophyStatement || fallbackPhilosophy(ds),
        globalPrinciples: Array.isArray(parsed.globalPrinciples) ? parsed.globalPrinciples : fallbackGlobalPrinciples(ds),
        componentPrinciples: typeof parsed.componentPrinciples === 'object' ? parsed.componentPrinciples : {},
        generatedAt: new Date().toISOString(),
      };
    }
  } catch (e) {
    console.warn('Failed to parse principles response:', e);
  }
  return {
    philosophyStatement: fallbackPhilosophy(ds),
    globalPrinciples: fallbackGlobalPrinciples(ds),
    componentPrinciples: {},
    generatedAt: new Date().toISOString(),
  };
}

function fallbackPhilosophy(ds: DesignSystemSummary): string {
  return `${ds.name} is a design system built around ${ds.components.length} component types with a focus on consistency and usability.`;
}

function fallbackGlobalPrinciples(ds: DesignSystemSummary): Array<{ title: string; description: string }> {
  const principles = [];
  if (ds.tokens.spacingBase) {
    principles.push({ title: "Grid-based Spacing", description: `All spacing derives from a ${ds.tokens.spacingBase}px base unit, creating consistent rhythm throughout the interface.` });
  }
  if (ds.tokens.colorCount > 0) {
    principles.push({ title: "Intentional Color", description: `${ds.tokens.colorCount} color tokens define a deliberate palette where each color carries semantic meaning.` });
  }
  if (ds.components.length > 0) {
    principles.push({ title: "Component Reuse", description: `${ds.components.length} shared component types reduce design debt and enforce interface consistency.` });
  }
  principles.push({ title: "Accessible by Default", description: "Interactive components are designed with keyboard navigation and ARIA semantics from the start." });
  return principles;
}
