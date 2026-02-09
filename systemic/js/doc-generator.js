/**
 * Systemic - Documentation Generator
 * Generates Material Design-compliant documentation for design systems
 */

class DocGenerator {
  constructor(config = {}) {
    this.config = {
      aiEnabled: config.aiEnabled !== false,
      supabaseUrl: config.supabaseUrl || '',
      supabaseKey: config.supabaseKey || '',
      ...config
    };
  }

  /**
   * Generate complete documentation for a design system
   */
  async generateDocumentation(designSystem) {
    const docs = {
      overview: this.generateOverview(designSystem),
      foundations: {
        color: this.generateColorDocs(designSystem.tokens.colors),
        typography: this.generateTypographyDocs(designSystem.tokens.typography),
        spacing: this.generateSpacingDocs(designSystem.tokens.spacing),
        elevation: this.generateElevationDocs(designSystem.tokens.elevation),
        shape: this.generateShapeDocs(designSystem.tokens.shape)
      },
      components: await this.generateComponentDocs(designSystem.components),
      tokens: {
        css: designSystem.tokens.cssVariables,
        json: this.generateTokensJSON(designSystem.tokens),
        scss: this.generateTokensSCSS(designSystem.tokens)
      }
    };

    return docs;
  }

  /**
   * Generate system overview
   */
  generateOverview(designSystem) {
    const stats = {
      colorTokens: this.countTokens(designSystem.tokens.colors),
      typographyTokens: designSystem.tokens.typography.typescale?.length || 0,
      spacingTokens: designSystem.tokens.spacing.scale?.length || 0,
      components: designSystem.components.length,
      sourceUrl: designSystem.sourceUrl,
      generatedAt: new Date().toISOString()
    };

    return {
      name: designSystem.name,
      description: `Design system extracted from ${designSystem.sourceUrl}`,
      stats,
      philosophy: this.inferDesignPhilosophy(designSystem),
      quickStart: this.generateQuickStart(designSystem)
    };
  }

  /**
   * Count color tokens
   */
  countTokens(colors) {
    let count = 0;
    if (colors.primary) count++;
    if (colors.secondary) count++;
    if (colors.tertiary) count++;
    if (colors.error) count++;
    if (colors.success) count++;
    if (colors.warning) count++;
    count += (colors.surface?.length || 0);
    count += (colors.onSurface?.length || 0);
    count += (colors.neutral?.length || 0);
    count += (colors.accent?.length || 0);
    return count;
  }

  /**
   * Infer design philosophy from tokens
   */
  inferDesignPhilosophy(designSystem) {
    const traits = [];

    // Check color contrast
    const colors = designSystem.tokens.colors;
    if (colors.surface?.[0] && colors.onSurface?.[0]) {
      const surface = ColorUtils.parseColor(colors.surface[0].hex);
      const onSurface = ColorUtils.parseColor(colors.onSurface[0].hex);
      if (surface && onSurface) {
        const contrast = ColorUtils.getContrastRatio(surface, onSurface);
        if (contrast > 7) traits.push('High contrast design');
        else if (contrast > 4.5) traits.push('Accessible contrast');
      }
    }

    // Check color saturation
    if (colors.primary) {
      const primary = ColorUtils.parseColor(colors.primary.hex);
      if (primary) {
        const hsl = ColorUtils.rgbToHsl(primary.r, primary.g, primary.b);
        if (hsl.s > 70) traits.push('Vibrant color palette');
        else if (hsl.s < 30) traits.push('Muted color palette');
      }
    }

    // Check spacing consistency
    const spacing = designSystem.tokens.spacing;
    if (spacing.baseUnit === 4) traits.push('4px grid system');
    else if (spacing.baseUnit === 8) traits.push('8px grid system');

    // Check shape
    const shape = designSystem.tokens.shape;
    if (shape.hasRoundedCorners) {
      const maxRadius = Math.max(...shape.corners.map(c => c.value));
      if (maxRadius >= 16) traits.push('Rounded, friendly aesthetic');
      else if (maxRadius >= 8) traits.push('Subtly rounded corners');
      else traits.push('Sharp, geometric style');
    }

    // Check typography
    const typography = designSystem.tokens.typography;
    if (typography.primary) {
      if (typography.primary.includes('serif')) traits.push('Traditional typography');
      else if (typography.primary.includes('mono')) traits.push('Technical/code aesthetic');
      else traits.push('Modern sans-serif typography');
    }

    return traits;
  }

  /**
   * Generate quick start guide
   */
  generateQuickStart(designSystem) {
    return `
## Quick Start

### Installation

Include the design tokens in your project:

\`\`\`html
<link rel="stylesheet" href="tokens.css">
\`\`\`

### Basic Usage

\`\`\`css
.my-component {
  color: var(--sys-color-on-surface-1);
  background: var(--sys-color-surface-1);
  padding: var(--sys-spacing-4);
  border-radius: var(--sys-shape-corner-medium);
}
\`\`\`

### Color Tokens

- **Primary**: \`var(--sys-color-primary)\`
- **Surface**: \`var(--sys-color-surface-1)\`
- **On Surface**: \`var(--sys-color-on-surface-1)\`
`.trim();
  }

  /**
   * Generate color documentation
   */
  generateColorDocs(colors) {
    const docs = {
      title: 'Color System',
      description: 'The color palette extracted from the source website, mapped to Material Design color roles.',
      sections: []
    };

    // Primary colors section
    const primarySection = {
      title: 'Primary Colors',
      description: 'Core brand colors used for primary actions and key UI elements.',
      tokens: []
    };

    if (colors.primary) {
      primarySection.tokens.push({
        ...colors.primary,
        usage: [
          'Primary buttons',
          'Active navigation items',
          'Links and interactive elements',
          'Focus indicators'
        ]
      });
    }

    if (colors.secondary) {
      primarySection.tokens.push({
        ...colors.secondary,
        usage: [
          'Secondary buttons',
          'Less prominent actions',
          'Accent elements'
        ]
      });
    }

    if (primarySection.tokens.length > 0) {
      docs.sections.push(primarySection);
    }

    // Semantic colors section
    const semanticSection = {
      title: 'Semantic Colors',
      description: 'Colors with specific meaning for user feedback.',
      tokens: []
    };

    if (colors.error) {
      semanticSection.tokens.push({
        ...colors.error,
        usage: ['Error messages', 'Destructive actions', 'Invalid states']
      });
    }

    if (colors.success) {
      semanticSection.tokens.push({
        ...colors.success,
        usage: ['Success messages', 'Completion states', 'Valid inputs']
      });
    }

    if (colors.warning) {
      semanticSection.tokens.push({
        ...colors.warning,
        usage: ['Warning messages', 'Caution indicators', 'Pending states']
      });
    }

    if (semanticSection.tokens.length > 0) {
      docs.sections.push(semanticSection);
    }

    // Surface colors section
    if (colors.surface?.length > 0 || colors.onSurface?.length > 0) {
      const surfaceSection = {
        title: 'Surface Colors',
        description: 'Background and foreground colors for UI surfaces.',
        tokens: [
          ...colors.surface.map(c => ({
            ...c,
            usage: ['Page backgrounds', 'Card backgrounds', 'Container fills']
          })),
          ...colors.onSurface.map(c => ({
            ...c,
            usage: ['Body text', 'Icons', 'Labels']
          }))
        ]
      };
      docs.sections.push(surfaceSection);
    }

    // Neutral colors section
    if (colors.neutral?.length > 0) {
      const neutralSection = {
        title: 'Neutral Palette',
        description: 'Grayscale colors for borders, dividers, and subtle elements.',
        tokens: colors.neutral.map((c, i) => ({
          ...c,
          name: `Neutral ${(i + 1) * 10}`,
          usage: ['Borders', 'Dividers', 'Muted text', 'Disabled states']
        }))
      };
      docs.sections.push(neutralSection);
    }

    return docs;
  }

  /**
   * Generate typography documentation
   */
  generateTypographyDocs(typography) {
    const docs = {
      title: 'Typography',
      description: 'Type scale and font specifications extracted from the source.',
      sections: []
    };

    // Font families
    if (typography.fontFamilies?.length > 0) {
      docs.sections.push({
        title: 'Font Families',
        description: 'The typefaces used in this design system.',
        items: typography.fontFamilies.map((f, i) => ({
          name: i === 0 ? 'Primary' : i === 1 ? 'Secondary' : `Font ${i + 1}`,
          value: f.value,
          usage: i === 0 ?
            'Headlines, body text, and UI elements' :
            'Accent text, code blocks, or secondary content'
        }))
      });
    }

    // Type scale
    if (typography.typescale?.length > 0) {
      docs.sections.push({
        title: 'Type Scale',
        description: 'Font sizes mapped to Material Design typescale roles.',
        items: typography.typescale.map(t => ({
          name: t.materialRole,
          size: t.value,
          materialMapping: MaterialTokens.typescale[t.materialRole],
          cssVariable: t.cssVariable
        }))
      });
    }

    // Font weights
    if (typography.fontWeights?.length > 0) {
      docs.sections.push({
        title: 'Font Weights',
        description: 'Available font weights.',
        items: typography.fontWeights.map(w => ({
          value: w.value,
          usageCount: w.usageCount
        }))
      });
    }

    return docs;
  }

  /**
   * Generate spacing documentation
   */
  generateSpacingDocs(spacing) {
    return {
      title: 'Spacing',
      description: `Spacing scale based on a ${spacing.baseUnit}px base unit.`,
      baseUnit: spacing.baseUnit,
      scale: spacing.scale.map(s => ({
        name: `Space ${s.normalized / spacing.baseUnit}`,
        value: `${s.normalized}px`,
        cssVariable: s.cssVariable,
        materialToken: s.materialToken,
        usageCount: s.usageCount,
        usage: this.getSpacingUsage(s.normalized)
      }))
    };
  }

  /**
   * Get spacing usage description
   */
  getSpacingUsage(value) {
    if (value <= 4) return 'Micro spacing: icon padding, inline elements';
    if (value <= 8) return 'Tight spacing: button padding, list item gaps';
    if (value <= 16) return 'Standard spacing: card padding, section gaps';
    if (value <= 32) return 'Comfortable spacing: section padding, large gaps';
    return 'Generous spacing: page margins, major section breaks';
  }

  /**
   * Generate elevation documentation
   */
  generateElevationDocs(elevation) {
    if (!elevation.hasShadows) {
      return {
        title: 'Elevation',
        description: 'This design system uses a flat design without shadows.',
        levels: []
      };
    }

    return {
      title: 'Elevation',
      description: 'Shadow levels for creating depth and hierarchy.',
      levels: elevation.levels.map((level, i) => ({
        name: `Level ${i + 1}`,
        shadow: level.shadow,
        materialLevel: level.materialLevel,
        usage: this.getElevationUsage(i + 1)
      }))
    };
  }

  /**
   * Get elevation usage description
   */
  getElevationUsage(level) {
    const usages = {
      1: 'Cards, buttons, minimal elevation',
      2: 'Floating action buttons, menus',
      3: 'Navigation drawers, dialogs',
      4: 'Modals, popovers',
      5: 'Prominent dialogs, overlays'
    };
    return usages[level] || 'Custom elevation';
  }

  /**
   * Generate shape documentation
   */
  generateShapeDocs(shape) {
    return {
      title: 'Shape',
      description: 'Border radius values for creating consistent corner styles.',
      hasRoundedCorners: shape.hasRoundedCorners,
      corners: shape.corners.map(corner => ({
        name: corner.materialToken.replace('corner-', '').replace(/-/g, ' '),
        value: `${corner.value}px`,
        materialToken: corner.materialToken,
        usage: this.getShapeUsage(corner.value)
      }))
    };
  }

  /**
   * Get shape usage description
   */
  getShapeUsage(value) {
    if (value === 0) return 'Sharp corners for geometric, angular designs';
    if (value <= 4) return 'Subtle rounding for inputs, small elements';
    if (value <= 8) return 'Standard rounding for cards, buttons';
    if (value <= 16) return 'Prominent rounding for featured elements';
    if (value <= 28) return 'Large rounding for pills, FABs';
    return 'Full rounding for circular elements';
  }

  /**
   * Generate component documentation
   */
  async generateComponentDocs(components) {
    const docs = [];

    // Group components by type
    const grouped = {};
    components.forEach(component => {
      const type = component.type || 'other';
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(component);
    });

    // Generate docs for each type
    for (const [type, typeComponents] of Object.entries(grouped)) {
      const componentDoc = {
        name: this.formatComponentName(type),
        type,
        variants: typeComponents.map(c => ({
          name: c.variants.join(' ') || 'Default',
          html: c.html,
          styles: c.styles,
          usageCount: c.usageCount
        })),
        guidelines: await this.generateUsageGuidelines(type, typeComponents),
        accessibility: this.generateAccessibilityNotes(type),
        tokens: this.extractComponentTokens(typeComponents),
        code: this.generateCodeSnippets(type, typeComponents[0])
      };

      docs.push(componentDoc);
    }

    return docs.sort((a, b) => b.variants.length - a.variants.length);
  }

  /**
   * Format component name for display
   */
  formatComponentName(type) {
    return type
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Generate usage guidelines using AI
   */
  async generateUsageGuidelines(type, components) {
    // Default guidelines based on component type
    const defaultGuidelines = this.getDefaultGuidelines(type);

    if (!this.config.aiEnabled || !this.config.supabaseUrl) {
      return defaultGuidelines;
    }

    // If AI is enabled, enhance with AI-generated guidelines
    try {
      const response = await fetch(`${this.config.supabaseUrl}/functions/v1/systemic-analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.supabaseKey,
          'Authorization': `Bearer ${this.config.supabaseKey}`
        },
        body: JSON.stringify({
          componentType: type,
          variants: components.length,
          contextClues: components.map(c => c.classes).flat()
        })
      });

      if (response.ok) {
        const aiGuidelines = await response.json();
        return {
          ...defaultGuidelines,
          ...aiGuidelines
        };
      }
    } catch (error) {
      console.warn('AI guidelines generation failed, using defaults:', error);
    }

    return defaultGuidelines;
  }

  /**
   * Get default usage guidelines
   */
  getDefaultGuidelines(type) {
    const guidelines = {
      button: {
        whenToUse: [
          'For primary actions that advance the user workflow',
          'To submit forms or confirm dialogs',
          'For calls-to-action that require visual prominence',
          'When immediate action is expected from the user'
        ],
        whenNotToUse: [
          'For navigation between pages (use links instead)',
          'When the action is purely informational',
          'For toggling states (use toggles or checkboxes)'
        ]
      },
      'text-input': {
        whenToUse: [
          'For collecting short text input from users',
          'In forms requiring user data entry',
          'For search functionality',
          'When users need to enter specific information'
        ],
        whenNotToUse: [
          'For long-form content (use textarea)',
          'When selecting from predefined options (use select)',
          'For binary choices (use checkbox or toggle)'
        ]
      },
      card: {
        whenToUse: [
          'To group related content together',
          'For presenting preview information',
          'When content needs visual separation',
          'For interactive content blocks'
        ],
        whenNotToUse: [
          'For simple text content without grouping needs',
          'When nesting would create confusion',
          'For inline elements'
        ]
      },
      navigation: {
        whenToUse: [
          'For primary site/app navigation',
          'To help users understand their location',
          'When providing access to main sections',
          'For persistent navigation across pages'
        ],
        whenNotToUse: [
          'For in-page navigation (use anchor links)',
          'For action triggers (use buttons)',
          'When space is extremely limited'
        ]
      },
      link: {
        whenToUse: [
          'For navigation to other pages or resources',
          'When action results in leaving current context',
          'For inline references to other content',
          'For external resources'
        ],
        whenNotToUse: [
          'For actions that don\'t navigate (use buttons)',
          'When action is destructive',
          'For form submissions'
        ]
      }
    };

    return guidelines[type] || {
      whenToUse: ['Use when appropriate for the context'],
      whenNotToUse: ['Avoid when the pattern doesn\'t fit user needs']
    };
  }

  /**
   * Generate accessibility notes
   */
  generateAccessibilityNotes(type) {
    const notes = {
      button: [
        'Ensure minimum touch target of 44x44 pixels',
        'Include visible focus states',
        'Use aria-label for icon-only buttons',
        'Maintain 4.5:1 contrast ratio for text'
      ],
      'text-input': [
        'Associate labels with inputs using for/id',
        'Provide clear error messages',
        'Support keyboard navigation',
        'Include aria-describedby for helper text'
      ],
      card: [
        'Use semantic HTML structure',
        'Ensure focusable if interactive',
        'Include alt text for images',
        'Maintain logical reading order'
      ],
      navigation: [
        'Use nav element or role="navigation"',
        'Include skip links for keyboard users',
        'Indicate current page with aria-current',
        'Ensure keyboard accessibility'
      ],
      link: [
        'Use descriptive link text',
        'Indicate external links',
        'Ensure visible focus states',
        'Don\'t rely on color alone'
      ],
      checkbox: [
        'Associate labels with inputs',
        'Support keyboard activation',
        'Use aria-checked for custom checkboxes',
        'Group related checkboxes with fieldset/legend'
      ],
      radio: [
        'Group with fieldset and legend',
        'Use name attribute for grouping',
        'Support arrow key navigation',
        'Include clear labels'
      ]
    };

    return notes[type] || [
      'Ensure keyboard accessibility',
      'Include appropriate ARIA attributes',
      'Maintain sufficient color contrast',
      'Test with screen readers'
    ];
  }

  /**
   * Extract tokens used by components
   */
  extractComponentTokens(components) {
    const tokens = {
      colors: new Set(),
      spacing: new Set(),
      typography: new Set()
    };

    components.forEach(component => {
      const styles = component.styles || {};

      // Extract color usage
      ['color', 'background-color', 'border-color'].forEach(prop => {
        if (styles[prop]) {
          tokens.colors.add(styles[prop]);
        }
      });

      // Extract spacing usage
      ['padding', 'margin', 'gap'].forEach(prop => {
        if (styles[prop]) {
          tokens.spacing.add(styles[prop]);
        }
      });

      // Extract typography usage
      ['font-size', 'font-weight', 'font-family'].forEach(prop => {
        if (styles[prop]) {
          tokens.typography.add(styles[prop]);
        }
      });
    });

    return {
      colors: Array.from(tokens.colors),
      spacing: Array.from(tokens.spacing),
      typography: Array.from(tokens.typography)
    };
  }

  /**
   * Generate code snippets
   */
  generateCodeSnippets(type, component) {
    const html = component?.html || this.generateDefaultHTML(type);
    const css = this.generateComponentCSS(type, component);
    const react = this.generateReactComponent(type, component);

    return { html, css, react };
  }

  /**
   * Generate default HTML for component type
   */
  generateDefaultHTML(type) {
    const templates = {
      button: '<button class="btn btn--primary">Button</button>',
      'text-input': '<input type="text" class="input" placeholder="Enter text...">',
      card: '<div class="card">\n  <h3>Card Title</h3>\n  <p>Card content goes here.</p>\n</div>',
      link: '<a href="#" class="link">Link text</a>',
      navigation: '<nav class="nav">\n  <a href="#">Home</a>\n  <a href="#">About</a>\n</nav>'
    };

    return templates[type] || `<div class="${type}">Component</div>`;
  }

  /**
   * Generate component CSS
   */
  generateComponentCSS(type, component) {
    const styles = component?.styles || {};
    const cssProperties = [];

    // Add relevant properties
    if (styles['color']) cssProperties.push(`  color: var(--sys-color-on-surface-1);`);
    if (styles['background-color']) cssProperties.push(`  background: var(--sys-color-surface-1);`);
    if (styles['padding']) cssProperties.push(`  padding: var(--sys-spacing-4);`);
    if (styles['border-radius']) cssProperties.push(`  border-radius: var(--sys-shape-corner-medium);`);
    if (styles['font-family']) cssProperties.push(`  font-family: var(--sys-typescale-font-primary);`);

    return `.${type} {\n${cssProperties.join('\n')}\n}`;
  }

  /**
   * Generate React component
   */
  generateReactComponent(type, component) {
    const componentName = type
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('');

    return `import React from 'react';
import styles from './${componentName}.module.css';

export function ${componentName}({ children, variant = 'default', ...props }) {
  return (
    <${this.getReactElement(type)}
      className={\`\${styles.${type}} \${styles[variant]}\`}
      {...props}
    >
      {children}
    </${this.getReactElement(type)}>
  );
}`;
  }

  /**
   * Get React element for component type
   */
  getReactElement(type) {
    const elements = {
      button: 'button',
      'text-input': 'input',
      card: 'div',
      link: 'a',
      navigation: 'nav'
    };
    return elements[type] || 'div';
  }

  /**
   * Generate tokens JSON
   */
  generateTokensJSON(tokens) {
    return JSON.stringify({
      $schema: 'https://design-tokens.github.io/community-group/format/',
      color: this.flattenColorTokens(tokens.colors),
      typography: {
        fontFamily: {
          primary: { $value: tokens.typography.primary, $type: 'fontFamily' },
          secondary: { $value: tokens.typography.secondary, $type: 'fontFamily' }
        },
        fontSize: Object.fromEntries(
          (tokens.typography.typescale || []).map(t => [
            t.materialRole,
            { $value: t.value, $type: 'dimension' }
          ])
        )
      },
      spacing: Object.fromEntries(
        (tokens.spacing.scale || []).map(s => [
          `space-${s.normalized / tokens.spacing.baseUnit}`,
          { $value: `${s.normalized}px`, $type: 'dimension' }
        ])
      )
    }, null, 2);
  }

  /**
   * Flatten color tokens for JSON export
   */
  flattenColorTokens(colors) {
    const flat = {};

    if (colors.primary) flat.primary = { $value: colors.primary.hex, $type: 'color' };
    if (colors.secondary) flat.secondary = { $value: colors.secondary.hex, $type: 'color' };
    if (colors.error) flat.error = { $value: colors.error.hex, $type: 'color' };
    if (colors.success) flat.success = { $value: colors.success.hex, $type: 'color' };
    if (colors.warning) flat.warning = { $value: colors.warning.hex, $type: 'color' };

    (colors.neutral || []).forEach((c, i) => {
      flat[`neutral-${(i + 1) * 10}`] = { $value: c.hex, $type: 'color' };
    });

    return flat;
  }

  /**
   * Generate tokens SCSS
   */
  generateTokensSCSS(tokens) {
    const lines = ['// Design System Tokens (SCSS)', '// Generated by Systemic', ''];

    // Colors
    lines.push('// Colors');
    if (tokens.colors.primary) lines.push(`$color-primary: ${tokens.colors.primary.hex};`);
    if (tokens.colors.secondary) lines.push(`$color-secondary: ${tokens.colors.secondary.hex};`);
    if (tokens.colors.error) lines.push(`$color-error: ${tokens.colors.error.hex};`);
    if (tokens.colors.success) lines.push(`$color-success: ${tokens.colors.success.hex};`);

    (tokens.colors.neutral || []).forEach((c, i) => {
      lines.push(`$color-neutral-${(i + 1) * 10}: ${c.hex};`);
    });

    // Typography
    lines.push('');
    lines.push('// Typography');
    lines.push(`$font-primary: ${tokens.typography.primary};`);
    if (tokens.typography.secondary !== tokens.typography.primary) {
      lines.push(`$font-secondary: ${tokens.typography.secondary};`);
    }

    // Spacing
    lines.push('');
    lines.push('// Spacing');
    (tokens.spacing.scale || []).forEach(s => {
      lines.push(`$spacing-${s.normalized / tokens.spacing.baseUnit}: ${s.normalized}px;`);
    });

    return lines.join('\n');
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DocGenerator;
}
