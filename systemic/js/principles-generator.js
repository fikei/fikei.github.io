/**
 * PrinciplesGenerator — AI-powered design principles extractor
 *
 * Analyses a loaded design system (tokens + components) and returns:
 *   • A philosophy statement for the whole system
 *   • 4-7 global design principles grounded in token evidence
 *   • 2-4 usage principles per component type
 *
 * Results are cached on designSystem.principles and in localStorage.
 *
 * Usage:
 *   const gen = new PrinciplesGenerator({ supabaseUrl, supabaseKey });
 *   const principles = await gen.generate(designSystem);
 */
class PrinciplesGenerator {
  constructor({ supabaseUrl, supabaseKey } = {}) {
    this.supabaseUrl = supabaseUrl || '';
    this.supabaseKey = supabaseKey || '';
  }

  // ----------------------------------------------------------------
  // Public
  // ----------------------------------------------------------------

  /**
   * Generate or retrieve cached principles for a design system.
   * Returns a PrinciplesResult object.
   */
  async generate(designSystem) {
    if (!designSystem) throw new Error('No design system provided');

    // Return cached result if fresh (< 24 hours)
    if (designSystem.principles?.generatedAt) {
      const age = Date.now() - new Date(designSystem.principles.generatedAt).getTime();
      if (age < 24 * 60 * 60 * 1000) return designSystem.principles;
    }

    const summary = this._buildSummary(designSystem);

    let result;
    if (this.supabaseUrl && this.supabaseKey) {
      result = await this._callAI(summary);
    } else {
      result = this._buildFallback(summary);
    }

    return result;
  }

  // ----------------------------------------------------------------
  // Summary builder
  // ----------------------------------------------------------------

  /**
   * Compress a full design system into a summary safe to send as an API payload.
   */
  _buildSummary(ds) {
    const tokens = ds.tokens || {};
    const colors = tokens.colors || {};
    const spacing = tokens.spacing || {};
    const elevation = tokens.elevation || {};
    const cssVars = tokens.cssVariables || {};

    // Collect CSS variable names for context
    const cssVariableNames = Object.keys(cssVars).slice(0, 20);

    // Also collect from raw token arrays (GitHub/Figma sources)
    const rawTokenNames = (ds.tokens?.rawTokens || [])
      .slice(0, 20)
      .map(t => t.name)
      .filter(Boolean);

    const allVarNames = [...new Set([...cssVariableNames, ...rawTokenNames])];

    const summary = {
      name: ds.name || 'Unknown System',
      sourceUrl: ds.sourceUrl || '',
      source: ds.source || null,
      tokens: {
        colorCount: this._countColors(colors),
        primaryColor: colors.primary?.hex || null,
        secondaryColor: colors.secondary?.hex || null,
        fontPrimary: tokens.typography?.primary || null,
        spacingBase: spacing.baseUnit || null,
        hasElevation: !!(elevation.levels?.length),
        hasBorderRadius: !!(tokens.shape?.values?.length),
        cssVariableNames: allVarNames,
      },
      components: (ds.components || []).map(c => ({
        type: c.type,
        variantCount: c.variants?.length || 0,
        totalUsage: c.totalUsage || 0,
        states: c.states || [],
        sampleClasses: this._gatherClasses(c),
        sampleHtml: c.variants?.[0]?.html?.slice(0, 200) || null,
      })),
    };

    return summary;
  }

  _countColors(colors) {
    let n = 0;
    if (colors.primary) n++;
    if (colors.secondary) n++;
    if (colors.tertiary) n++;
    if (colors.error) n++;
    if (colors.success) n++;
    if (colors.warning) n++;
    n += (colors.neutral?.length || 0);
    n += (colors.surface?.length || 0);
    return n;
  }

  _gatherClasses(component) {
    const classes = new Set();
    (component.variants || []).forEach(v => {
      (v.classes || []).forEach(c => classes.add(c));
    });
    return [...classes].slice(0, 12);
  }

  // ----------------------------------------------------------------
  // AI call
  // ----------------------------------------------------------------

  async _callAI(summary) {
    const res = await fetch(`${this.supabaseUrl}/functions/v1/systemic-analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
      },
      body: JSON.stringify({
        action: 'principles',
        designSystemSummary: summary,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI principles call failed (${res.status}): ${err}`);
    }

    return await res.json();
  }

  // ----------------------------------------------------------------
  // Fallback (no AI)
  // ----------------------------------------------------------------

  /**
   * Rule-based fallback — derives principles directly from token data
   * without calling the AI. Useful for local design systems or when
   * the edge function is unavailable.
   */
  _buildFallback(summary) {
    const principles = [];

    // Spacing
    if (summary.tokens.spacingBase) {
      principles.push({
        title: 'Grid-based Spacing',
        description: `All layout spacing is derived from a ${summary.tokens.spacingBase}px base unit, ensuring consistent visual rhythm across every component.`,
      });
    }

    // Color
    if (summary.tokens.colorCount > 0) {
      principles.push({
        title: 'Semantic Color',
        description: `${summary.tokens.colorCount} color tokens carry explicit semantic roles (primary, surface, error, etc.) rather than raw values, so color changes propagate consistently.`,
      });
    }
    if (summary.tokens.primaryColor) {
      const isDark = this._isDarkColor(summary.tokens.primaryColor);
      principles.push({
        title: isDark ? 'Dark-first Palette' : 'Light-first Palette',
        description: `The system is designed ${isDark ? 'dark-first' : 'light-first'}, with ${summary.tokens.primaryColor} as the primary surface. All contrast ratios are evaluated against this baseline.`,
      });
    }

    // Typography
    if (summary.tokens.fontPrimary) {
      principles.push({
        title: 'Single Type Family',
        description: `${summary.tokens.fontPrimary} is the sole typeface, with weight and size variations carrying the full typographic hierarchy — no secondary fonts needed.`,
      });
    }

    // Elevation
    if (summary.tokens.hasElevation) {
      principles.push({
        title: 'Elevation as Hierarchy',
        description: 'Shadow levels communicate z-axis depth and content priority. Higher elevation = higher user focus.',
      });
    } else {
      principles.push({
        title: 'Flat Design',
        description: 'No shadows or elevation — hierarchy is expressed through color, weight, and spacing alone.',
      });
    }

    // Components
    if (summary.components.length > 0) {
      principles.push({
        title: 'Shared Component Language',
        description: `${summary.components.length} reusable component types form the vocabulary of this system. Every new surface should be assembled from these building blocks before introducing new patterns.`,
      });
    }

    // CSS variables
    if (summary.tokens.cssVariableNames?.length > 0) {
      principles.push({
        title: 'Token-driven Customisation',
        description: 'CSS custom properties are the single source of truth. Theming, brand updates, and accessibility overrides all flow through the token layer — never through one-off overrides.',
      });
    }

    // Per-component principles (rule-based)
    const componentPrinciples = {};
    for (const comp of summary.components) {
      componentPrinciples[comp.type] = this._componentFallback(comp);
    }

    return {
      philosophyStatement: this._philosophyFallback(summary),
      globalPrinciples: principles,
      componentPrinciples,
      generatedAt: new Date().toISOString(),
    };
  }

  _philosophyFallback(summary) {
    const compCount = summary.components.length;
    const font = summary.tokens.fontPrimary ? `${summary.tokens.fontPrimary} typography` : 'consistent typography';
    return `${summary.name} is a ${summary.source?.type === 'figma' ? 'design-file-driven' : summary.source?.type === 'github' ? 'code-first' : 'web-extracted'} design system built around ${font}, ${summary.tokens.colorCount} semantic color tokens, and ${compCount} shared component type${compCount !== 1 ? 's' : ''} — optimised for consistency and developer velocity.`;
  }

  _componentFallback(comp) {
    const rules = [];
    const type = comp.type;

    const baseRules = {
      button:     [
        { rule: 'Use variant to signal action priority', rationale: `${comp.variantCount} variants found — reserve primary/filled for the single highest-priority action per screen.` },
        { rule: 'Never use more than one primary button per view', rationale: 'Multiple primary buttons compete for attention and dilute call-to-action clarity.' },
      ],
      input:      [
        { rule: 'Always show a visible label', rationale: 'Placeholder text alone is inaccessible once the field has a value. Every input in this system uses a persistent label.' },
        { rule: 'Pair error state with an inline message', rationale: 'Error styling alone is not sufficient — a text message below the field explains what went wrong.' },
      ],
      card:       [
        { rule: 'Keep content hierarchy consistent across instances', rationale: `${comp.totalUsage} card usages found — consistent title/body/action order makes scanning predictable.` },
        { rule: 'Cards are containers, not interactive targets', rationale: 'If the whole card is clickable, ensure it has focus, role, and keyboard handling.' },
      ],
      nav:        [
        { rule: 'Mark the active item explicitly', rationale: 'Users need to know where they are. Use aria-current="page" and a visible active style.' },
        { rule: 'Keep nav items consistent across breakpoints', rationale: 'Mobile collapse patterns should preserve the same hierarchy as the desktop navigation.' },
      ],
      modal:      [
        { rule: 'Trap focus inside while open', rationale: 'Keyboard and screen reader users must not be able to interact with content behind the modal.' },
        { rule: 'Always provide an explicit close action', rationale: 'Do not rely solely on Escape key — a visible close button is required for discoverability.' },
      ],
      select:     [
        { rule: 'Use for 5+ options only', rationale: 'Fewer than 5 options are better served by radio buttons, which show all choices at a glance.' },
        { rule: 'Show selected value clearly in closed state', rationale: 'Users should never have to open the dropdown to see what is currently selected.' },
      ],
      form:       [
        { rule: 'Group related fields with a fieldset', rationale: 'Logical grouping helps screen readers announce context and makes long forms scannable.' },
        { rule: 'Validate inline, not only on submit', rationale: 'Immediate field-level feedback reduces form abandonment and cognitive load.' },
      ],
    };

    const typeRules = baseRules[type];
    if (typeRules) {
      rules.push(...typeRules);
    }

    // Add usage-count rule
    if (comp.totalUsage > 1) {
      rules.push({
        rule: `Rely on this component — it appears ${comp.totalUsage} times`,
        rationale: `High usage confirms this is a core pattern. Any change to it has broad surface-area impact; validate across all ${comp.totalUsage} uses.`,
      });
    }

    // Add state rule if states detected
    if (comp.states?.length > 0) {
      rules.push({
        rule: `Implement all ${comp.states.length} detected states`,
        rationale: `States found: ${comp.states.join(', ')}. Missing states in implementation lead to visual regressions.`,
      });
    }

    return rules.length > 0 ? rules : [
      { rule: 'Follow system token conventions', rationale: `This component uses ${comp.variantCount} variant${comp.variantCount !== 1 ? 's' : ''} — choose the closest match before creating a new one.` },
    ];
  }

  _isDarkColor(hex) {
    if (!hex || !hex.startsWith('#')) return true;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  }
}
