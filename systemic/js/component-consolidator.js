/**
 * SystemicAI - Component Consolidator
 * Consolidates raw crawled components into organized design system components
 */

class ComponentConsolidator {
  constructor() {
    // Variant detection patterns
    this.variantPatterns = {
      style: ['primary', 'secondary', 'tertiary', 'ghost', 'outline', 'outlined', 'filled', 'text', 'link', 'elevated', 'tonal'],
      size: ['xs', 'sm', 'small', 'md', 'medium', 'lg', 'large', 'xl', 'xxl'],
      state: ['active', 'disabled', 'loading', 'selected', 'error', 'success', 'warning'],
      intent: ['danger', 'destructive', 'info', 'success', 'warning', 'error']
    };
  }

  /**
   * Consolidate raw components into organized component groups
   */
  consolidate(rawComponents) {
    if (!rawComponents || rawComponents.length === 0) {
      return [];
    }

    console.log(`[Consolidator] Processing ${rawComponents.length} raw components`);

    // Step 1: Group by component type
    const groupedByType = this.groupByType(rawComponents);

    // Step 2: Within each type, identify variants
    const consolidated = [];

    groupedByType.forEach((components, type) => {
      const consolidatedComponent = this.consolidateType(type, components);
      if (consolidatedComponent) {
        consolidated.push(consolidatedComponent);
      }
    });

    // Step 3: Sort by importance (usage count, then alphabetically)
    consolidated.sort((a, b) => {
      const aCount = a.totalUsage || 0;
      const bCount = b.totalUsage || 0;
      if (bCount !== aCount) return bCount - aCount;
      return a.name.localeCompare(b.name);
    });

    console.log(`[Consolidator] Consolidated into ${consolidated.length} component types`);
    return consolidated;
  }

  /**
   * Group raw components by their type
   */
  groupByType(components) {
    const groups = new Map();

    components.forEach(comp => {
      const type = comp.type || 'unknown';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type).push(comp);
    });

    return groups;
  }

  /**
   * Consolidate all components of a single type into one component with variants
   */
  consolidateType(type, components) {
    // Skip if no components
    if (components.length === 0) return null;

    // Group by variant signature
    const variantGroups = this.groupByVariant(components);

    // Convert groups to variants array
    const variants = [];
    let totalUsage = 0;

    variantGroups.forEach((group, signature) => {
      // Pick the best example from the group (highest usage count)
      const example = this.pickBestExample(group);
      const usageCount = group.reduce((sum, c) => sum + (c.usageCount || 1), 0);
      totalUsage += usageCount;

      variants.push({
        name: this.generateVariantName(signature, type),
        signature,
        html: example.html,
        classes: example.classes,
        styles: example.styles,
        usageCount,
        exampleCount: group.length
      });
    });

    // Sort variants by usage
    variants.sort((a, b) => b.usageCount - a.usageCount);

    // Limit to top 10 variants
    const topVariants = variants.slice(0, 10);

    return {
      name: this.formatTypeName(type),
      type,
      variants: topVariants,
      totalUsage,
      totalVariants: variants.length,
      // Generate component metadata
      guidelines: this.generateGuidelines(type, topVariants),
      accessibility: this.generateAccessibilityNotes(type),
      code: this.generateCodeExamples(type, topVariants[0])
    };
  }

  /**
   * Group components by their variant signature (visual characteristics)
   */
  groupByVariant(components) {
    const groups = new Map();

    components.forEach(comp => {
      const signature = this.getVariantSignature(comp);
      if (!groups.has(signature)) {
        groups.set(signature, []);
      }
      groups.get(signature).push(comp);
    });

    return groups;
  }

  /**
   * Generate a variant signature based on visual characteristics
   */
  getVariantSignature(component) {
    const classes = component.classes || [];
    const hints = component.styles?._classHints || {};

    // Extract variant indicators from classes
    const variantIndicators = [];

    // Check for style variants
    this.variantPatterns.style.forEach(pattern => {
      if (classes.some(c => c.toLowerCase().includes(pattern))) {
        variantIndicators.push(pattern);
      }
    });

    // Check for size variants
    this.variantPatterns.size.forEach(pattern => {
      if (classes.some(c => c.toLowerCase().includes(pattern) || c.match(new RegExp(`-${pattern}$`)))) {
        variantIndicators.push(`size:${pattern}`);
      }
    });

    // Check for intent variants
    this.variantPatterns.intent.forEach(pattern => {
      if (classes.some(c => c.toLowerCase().includes(pattern))) {
        variantIndicators.push(`intent:${pattern}`);
      }
    });

    // Use class hints if available
    if (hints.colorRole) variantIndicators.push(hints.colorRole);
    if (hints.size) variantIndicators.push(`size:${hints.size}`);
    if (hints.variant) variantIndicators.push(hints.variant);

    // If no indicators, use 'default'
    if (variantIndicators.length === 0) {
      return 'default';
    }

    // Sort for consistency
    return variantIndicators.sort().join('|');
  }

  /**
   * Pick the best example from a group of similar components
   */
  pickBestExample(group) {
    // Prefer components with more usage, then shorter HTML (less noise)
    return group.sort((a, b) => {
      const usageDiff = (b.usageCount || 1) - (a.usageCount || 1);
      if (usageDiff !== 0) return usageDiff;
      return (a.html?.length || 0) - (b.html?.length || 0);
    })[0];
  }

  /**
   * Generate a human-readable variant name
   */
  generateVariantName(signature, type) {
    if (signature === 'default') {
      return 'Default';
    }

    const parts = signature.split('|');
    const nameParts = parts.map(part => {
      if (part.startsWith('size:')) {
        return this.formatSizeName(part.replace('size:', ''));
      }
      if (part.startsWith('intent:')) {
        return this.capitalize(part.replace('intent:', ''));
      }
      return this.capitalize(part);
    });

    return nameParts.join(' ');
  }

  /**
   * Format size name
   */
  formatSizeName(size) {
    const sizeMap = {
      'xs': 'Extra Small',
      'sm': 'Small',
      'small': 'Small',
      'md': 'Medium',
      'medium': 'Medium',
      'lg': 'Large',
      'large': 'Large',
      'xl': 'Extra Large',
      'xxl': '2X Large'
    };
    return sizeMap[size.toLowerCase()] || this.capitalize(size);
  }

  /**
   * Format type name for display
   */
  formatTypeName(type) {
    const nameMap = {
      'button': 'Button',
      'text-input': 'Text Input',
      'textarea': 'Text Area',
      'select': 'Select',
      'checkbox': 'Checkbox',
      'radio': 'Radio Button',
      'card': 'Card',
      'navigation': 'Navigation',
      'modal': 'Modal',
      'tabs': 'Tabs',
      'list': 'List',
      'link': 'Link',
      'heading': 'Heading',
      'container': 'Container',
      'unknown': 'Other'
    };
    return nameMap[type] || this.capitalize(type);
  }

  /**
   * Capitalize first letter
   */
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Generate usage guidelines based on component type
   */
  generateGuidelines(type, variants) {
    const guidelines = {
      whenToUse: [],
      whenNotToUse: []
    };

    switch (type) {
      case 'button':
        guidelines.whenToUse = [
          'For primary actions like form submission',
          'For navigation that changes application state',
          'When the action has clear, immediate consequences'
        ];
        guidelines.whenNotToUse = [
          'For simple navigation between pages (use links instead)',
          'When there are too many actions competing for attention',
          'For actions that can be easily undone'
        ];
        break;

      case 'text-input':
        guidelines.whenToUse = [
          'For collecting short text input from users',
          'When you need a single line of text',
          'For search fields and form inputs'
        ];
        guidelines.whenNotToUse = [
          'For long-form content (use textarea)',
          'For selecting from predefined options (use select)',
          'When the input format is highly structured (consider specialized inputs)'
        ];
        break;

      case 'card':
        guidelines.whenToUse = [
          'For grouping related content and actions',
          'For displaying items in a grid or list',
          'When content needs visual separation'
        ];
        guidelines.whenNotToUse = [
          'For simple text content without actions',
          'When nesting would create visual confusion',
          'For inline content that should flow naturally'
        ];
        break;

      case 'modal':
        guidelines.whenToUse = [
          'For critical information requiring user attention',
          'For confirmation of destructive actions',
          'When user input is required before proceeding'
        ];
        guidelines.whenNotToUse = [
          'For non-critical information (use inline messages)',
          'For complex multi-step workflows',
          'When users need to reference other content'
        ];
        break;

      default:
        guidelines.whenToUse = [
          `Use ${this.formatTypeName(type)} components for their intended purpose`,
          'Ensure consistent usage across the application'
        ];
        guidelines.whenNotToUse = [
          'Avoid overusing or misusing this component type'
        ];
    }

    return guidelines;
  }

  /**
   * Generate accessibility notes based on component type
   */
  generateAccessibilityNotes(type) {
    const notes = {
      'button': [
        'Ensure buttons have descriptive text or aria-label',
        'Maintain 4.5:1 contrast ratio for text',
        'Support keyboard navigation (Enter/Space to activate)',
        'Indicate disabled state visually and programmatically'
      ],
      'text-input': [
        'Always associate labels with inputs using for/id',
        'Provide clear error messages for validation',
        'Ensure sufficient color contrast for text',
        'Support autofill and autocomplete where appropriate'
      ],
      'link': [
        'Use descriptive link text (avoid "click here")',
        'Indicate external links visually and with aria',
        'Ensure links are keyboard accessible',
        'Maintain consistent link styling'
      ],
      'modal': [
        'Trap focus within the modal when open',
        'Provide a clear close mechanism',
        'Return focus to trigger element on close',
        'Use appropriate ARIA roles (dialog, alertdialog)'
      ],
      'card': [
        'Ensure heading hierarchy is maintained',
        'Make interactive elements clearly focusable',
        'Provide sufficient touch target sizes',
        'Consider card content reading order'
      ]
    };

    return notes[type] || [
      'Ensure component is keyboard accessible',
      'Maintain sufficient color contrast',
      'Use appropriate ARIA attributes'
    ];
  }

  /**
   * Generate code examples for a component
   */
  generateCodeExamples(type, primaryVariant) {
    if (!primaryVariant) {
      return { html: '', css: '', react: '' };
    }

    const html = primaryVariant.html || '';

    // Generate CSS based on extracted styles
    const css = this.generateCSS(type, primaryVariant);

    // Generate React component
    const react = this.generateReact(type, primaryVariant);

    return { html, css, react };
  }

  /**
   * Generate CSS from component styles
   */
  generateCSS(type, variant) {
    const className = `.${type}`;
    const styles = variant.styles || {};

    let css = `${className} {\n`;

    // Add relevant style properties
    const relevantProps = [
      'color', 'background-color', 'border-radius',
      'padding', 'font-size', 'font-weight', 'font-family'
    ];

    relevantProps.forEach(prop => {
      const value = styles[prop];
      if (value && value !== '' && value !== 'none') {
        css += `  ${prop}: ${value};\n`;
      }
    });

    // Add class hints as comments
    if (styles._classHints) {
      const hints = styles._classHints;
      if (hints.colorRole) css += `  /* Color role: ${hints.colorRole} */\n`;
      if (hints.size) css += `  /* Size: ${hints.size} */\n`;
    }

    css += '}';
    return css;
  }

  /**
   * Generate React component from HTML
   */
  generateReact(type, variant) {
    const componentName = this.formatTypeName(type).replace(/\s+/g, '');
    const html = variant.html || '';

    // Convert HTML to JSX (basic conversion)
    const jsx = html
      .replace(/class="/g, 'className="')
      .replace(/for="/g, 'htmlFor="')
      .replace(/tabindex=/g, 'tabIndex=')
      .replace(/onclick=/gi, 'onClick=')
      .replace(/onchange=/gi, 'onChange=');

    return `function ${componentName}({ children, variant = 'default', ...props }) {
  return (
    ${jsx.split('\n').join('\n    ')}
  );
}`;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ComponentConsolidator;
}
