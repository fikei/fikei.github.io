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
  componentType: string;
  componentHtml?: string;
  componentStyles?: Record<string, string>;
  variants?: number;
  contextClues?: string[];
  contextUrls?: string[];
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

    const client = new Anthropic({ apiKey });

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
