/**
 * Systemic - Material Design Token Mappings
 * Reference data for Material Design 3 token system
 */

const MaterialTokens = {
  /**
   * Material Design 3 Color Roles
   */
  colorRoles: {
    // Primary colors
    primary: {
      description: 'High-emphasis elements like buttons and active states',
      usage: ['Primary buttons', 'Active indicators', 'Links']
    },
    'on-primary': {
      description: 'Text/icons on primary color',
      usage: ['Button labels', 'Icon tints on primary surfaces']
    },
    'primary-container': {
      description: 'Standout fill color for containers',
      usage: ['FABs', 'Selected chips', 'Selected list items']
    },
    'on-primary-container': {
      description: 'Text/icons on primary container',
      usage: ['Labels in containers']
    },

    // Secondary colors
    secondary: {
      description: 'Less prominent elements than primary',
      usage: ['Filter chips', 'Secondary buttons']
    },
    'on-secondary': {
      description: 'Text/icons on secondary color',
      usage: ['Secondary button labels']
    },
    'secondary-container': {
      description: 'Tonal container for secondary elements',
      usage: ['Input chips', 'Date picker today']
    },
    'on-secondary-container': {
      description: 'Text/icons on secondary container',
      usage: ['Labels in secondary containers']
    },

    // Tertiary colors
    tertiary: {
      description: 'Contrast accents for balance',
      usage: ['Complementary accents']
    },
    'on-tertiary': {
      description: 'Text/icons on tertiary color',
      usage: ['Tertiary button labels']
    },
    'tertiary-container': {
      description: 'Tonal container for tertiary elements',
      usage: ['Tertiary containers']
    },
    'on-tertiary-container': {
      description: 'Text/icons on tertiary container',
      usage: ['Labels in tertiary containers']
    },

    // Error colors
    error: {
      description: 'Attention-grabbing for errors',
      usage: ['Error messages', 'Invalid input indicators']
    },
    'on-error': {
      description: 'Text/icons on error color',
      usage: ['Error button labels']
    },
    'error-container': {
      description: 'Container for errors',
      usage: ['Error banners', 'Error cards']
    },
    'on-error-container': {
      description: 'Text/icons on error container',
      usage: ['Error message text']
    },

    // Surface colors
    surface: {
      description: 'Default background color',
      usage: ['Page backgrounds', 'Cards', 'Sheets']
    },
    'on-surface': {
      description: 'Text/icons on surface',
      usage: ['Body text', 'Headlines', 'Icons']
    },
    'surface-variant': {
      description: 'Alternative surface color',
      usage: ['Search bars', 'Variant cards']
    },
    'on-surface-variant': {
      description: 'Text/icons on surface variant',
      usage: ['Supporting text', 'Secondary icons']
    },

    // Outline colors
    outline: {
      description: 'Important boundaries',
      usage: ['Outlined buttons', 'Text field outlines']
    },
    'outline-variant': {
      description: 'Decorative boundaries',
      usage: ['Dividers', 'Decorative lines']
    },

    // Inverse colors
    'inverse-surface': {
      description: 'Surface for contrast',
      usage: ['Snackbars', 'Tooltips']
    },
    'inverse-on-surface': {
      description: 'Text on inverse surface',
      usage: ['Snackbar text']
    },
    'inverse-primary': {
      description: 'Primary for contrast',
      usage: ['Links in snackbars']
    },

    // Scrim
    scrim: {
      description: 'Overlay for modals',
      usage: ['Modal backdrops', 'Drawer scrims']
    },

    // Shadow
    shadow: {
      description: 'Color for shadows',
      usage: ['Elevation shadows']
    }
  },

  /**
   * Material Design 3 Typography Roles
   */
  typescale: {
    'display-large': {
      size: 57, lineHeight: 64, tracking: -0.25, weight: 400,
      usage: 'Hero text, large headlines'
    },
    'display-medium': {
      size: 45, lineHeight: 52, tracking: 0, weight: 400,
      usage: 'Section headers, page titles'
    },
    'display-small': {
      size: 36, lineHeight: 44, tracking: 0, weight: 400,
      usage: 'Feature headlines'
    },
    'headline-large': {
      size: 32, lineHeight: 40, tracking: 0, weight: 400,
      usage: 'Major section titles'
    },
    'headline-medium': {
      size: 28, lineHeight: 36, tracking: 0, weight: 400,
      usage: 'Card titles, dialog titles'
    },
    'headline-small': {
      size: 24, lineHeight: 32, tracking: 0, weight: 400,
      usage: 'Sub-section headers'
    },
    'title-large': {
      size: 22, lineHeight: 28, tracking: 0, weight: 400,
      usage: 'App bar titles'
    },
    'title-medium': {
      size: 16, lineHeight: 24, tracking: 0.15, weight: 500,
      usage: 'List item titles, tabs'
    },
    'title-small': {
      size: 14, lineHeight: 20, tracking: 0.1, weight: 500,
      usage: 'Chips, navigation labels'
    },
    'body-large': {
      size: 16, lineHeight: 24, tracking: 0.5, weight: 400,
      usage: 'Primary body text'
    },
    'body-medium': {
      size: 14, lineHeight: 20, tracking: 0.25, weight: 400,
      usage: 'Secondary body text'
    },
    'body-small': {
      size: 12, lineHeight: 16, tracking: 0.4, weight: 400,
      usage: 'Captions, helper text'
    },
    'label-large': {
      size: 14, lineHeight: 20, tracking: 0.1, weight: 500,
      usage: 'Prominent buttons'
    },
    'label-medium': {
      size: 12, lineHeight: 16, tracking: 0.5, weight: 500,
      usage: 'Standard buttons'
    },
    'label-small': {
      size: 11, lineHeight: 16, tracking: 0.5, weight: 500,
      usage: 'Small labels, badges'
    }
  },

  /**
   * Material Design 3 Spacing Scale
   */
  spacing: {
    'spacing-0': 0,
    'spacing-1': 4,
    'spacing-2': 8,
    'spacing-3': 12,
    'spacing-4': 16,
    'spacing-5': 20,
    'spacing-6': 24,
    'spacing-7': 28,
    'spacing-8': 32,
    'spacing-9': 36,
    'spacing-10': 40,
    'spacing-11': 44,
    'spacing-12': 48,
    'spacing-16': 64,
    'spacing-20': 80,
    'spacing-24': 96
  },

  /**
   * Material Design 3 Elevation Levels
   */
  elevation: {
    'level-0': { shadow: 'none', tonal: 0 },
    'level-1': { shadow: '0 1px 2px rgba(0,0,0,0.3), 0 1px 3px 1px rgba(0,0,0,0.15)', tonal: 0.05 },
    'level-2': { shadow: '0 1px 2px rgba(0,0,0,0.3), 0 2px 6px 2px rgba(0,0,0,0.15)', tonal: 0.08 },
    'level-3': { shadow: '0 4px 8px 3px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.3)', tonal: 0.11 },
    'level-4': { shadow: '0 6px 10px 4px rgba(0,0,0,0.15), 0 2px 3px rgba(0,0,0,0.3)', tonal: 0.12 },
    'level-5': { shadow: '0 8px 12px 6px rgba(0,0,0,0.15), 0 4px 4px rgba(0,0,0,0.3)', tonal: 0.14 }
  },

  /**
   * Material Design 3 Shape Corners
   */
  shape: {
    'corner-none': 0,
    'corner-extra-small': 4,
    'corner-small': 8,
    'corner-medium': 12,
    'corner-large': 16,
    'corner-extra-large': 28,
    'corner-full': 9999
  },

  /**
   * Material Design 3 Motion Durations
   */
  motion: {
    durations: {
      'duration-short-1': 50,
      'duration-short-2': 100,
      'duration-short-3': 150,
      'duration-short-4': 200,
      'duration-medium-1': 250,
      'duration-medium-2': 300,
      'duration-medium-3': 350,
      'duration-medium-4': 400,
      'duration-long-1': 450,
      'duration-long-2': 500,
      'duration-long-3': 550,
      'duration-long-4': 600,
      'duration-extra-long-1': 700,
      'duration-extra-long-2': 800,
      'duration-extra-long-3': 900,
      'duration-extra-long-4': 1000
    },
    easings: {
      'emphasized': 'cubic-bezier(0.2, 0, 0, 1)',
      'emphasized-decelerate': 'cubic-bezier(0.05, 0.7, 0.1, 1)',
      'emphasized-accelerate': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
      'standard': 'cubic-bezier(0.2, 0, 0, 1)',
      'standard-decelerate': 'cubic-bezier(0, 0, 0, 1)',
      'standard-accelerate': 'cubic-bezier(0.3, 0, 1, 1)'
    }
  },

  /**
   * Material Design 3 Component Mappings
   */
  components: {
    button: {
      filled: {
        container: 'primary',
        label: 'on-primary',
        icon: 'on-primary',
        shape: 'corner-full',
        elevation: 'level-0'
      },
      outlined: {
        outline: 'outline',
        label: 'primary',
        icon: 'primary',
        shape: 'corner-full',
        elevation: 'level-0'
      },
      text: {
        label: 'primary',
        icon: 'primary',
        shape: 'corner-full',
        elevation: 'level-0'
      },
      elevated: {
        container: 'surface-variant',
        label: 'primary',
        icon: 'primary',
        shape: 'corner-full',
        elevation: 'level-1'
      },
      tonal: {
        container: 'secondary-container',
        label: 'on-secondary-container',
        icon: 'on-secondary-container',
        shape: 'corner-full',
        elevation: 'level-0'
      }
    },
    card: {
      elevated: {
        container: 'surface',
        shape: 'corner-medium',
        elevation: 'level-1'
      },
      filled: {
        container: 'surface-variant',
        shape: 'corner-medium',
        elevation: 'level-0'
      },
      outlined: {
        container: 'surface',
        outline: 'outline-variant',
        shape: 'corner-medium',
        elevation: 'level-0'
      }
    },
    chip: {
      assist: {
        container: 'surface',
        outline: 'outline',
        label: 'on-surface',
        shape: 'corner-small'
      },
      filter: {
        container: 'secondary-container',
        label: 'on-secondary-container',
        shape: 'corner-small'
      },
      input: {
        container: 'surface-variant',
        label: 'on-surface-variant',
        shape: 'corner-small'
      },
      suggestion: {
        container: 'surface',
        outline: 'outline',
        label: 'on-surface-variant',
        shape: 'corner-small'
      }
    },
    textField: {
      filled: {
        container: 'surface-variant',
        activeIndicator: 'on-surface-variant',
        label: 'on-surface-variant',
        input: 'on-surface',
        shape: 'corner-extra-small'
      },
      outlined: {
        container: 'surface',
        outline: 'outline',
        label: 'on-surface-variant',
        input: 'on-surface',
        shape: 'corner-extra-small'
      }
    },
    navigation: {
      bar: {
        container: 'surface',
        icon: 'on-surface-variant',
        activeIcon: 'on-secondary-container',
        activeIndicator: 'secondary-container',
        label: 'on-surface-variant',
        activeLabel: 'on-surface',
        elevation: 'level-2'
      },
      rail: {
        container: 'surface',
        icon: 'on-surface-variant',
        activeIcon: 'on-secondary-container',
        activeIndicator: 'secondary-container',
        label: 'on-surface-variant',
        activeLabel: 'on-surface'
      },
      drawer: {
        container: 'surface',
        activeIcon: 'on-secondary-container',
        activeIndicator: 'secondary-container',
        label: 'on-surface-variant',
        activeLabel: 'on-surface'
      }
    }
  },

  /**
   * Find the closest Material typography role for a given font size
   */
  findTypescaleRole(fontSize) {
    const sizes = Object.entries(this.typescale)
      .map(([role, config]) => ({ role, size: config.size }))
      .sort((a, b) => b.size - a.size);

    const numericSize = parseFloat(fontSize);

    for (const { role, size } of sizes) {
      if (numericSize >= size) {
        return role;
      }
    }

    return 'label-small';
  },

  /**
   * Find the closest Material spacing token
   */
  findSpacingToken(value) {
    const numericValue = parseFloat(value);
    const spacings = Object.entries(this.spacing)
      .sort((a, b) => a[1] - b[1]);

    let closest = spacings[0];
    let minDiff = Math.abs(numericValue - closest[1]);

    for (const [token, size] of spacings) {
      const diff = Math.abs(numericValue - size);
      if (diff < minDiff) {
        minDiff = diff;
        closest = [token, size];
      }
    }

    return closest[0];
  },

  /**
   * Find the closest Material elevation level
   */
  findElevationLevel(shadow) {
    if (!shadow || shadow === 'none') return 'level-0';

    // Extract vertical offset from shadow
    const match = shadow.match(/(\d+)px\s+(\d+)px/);
    if (!match) return 'level-0';

    const yOffset = parseInt(match[2]);

    if (yOffset <= 1) return 'level-1';
    if (yOffset <= 3) return 'level-2';
    if (yOffset <= 6) return 'level-3';
    if (yOffset <= 10) return 'level-4';
    return 'level-5';
  },

  /**
   * Find the closest Material shape corner
   */
  findShapeToken(borderRadius) {
    const numericValue = parseFloat(borderRadius);

    if (numericValue === 0) return 'corner-none';
    if (numericValue <= 4) return 'corner-extra-small';
    if (numericValue <= 8) return 'corner-small';
    if (numericValue <= 12) return 'corner-medium';
    if (numericValue <= 16) return 'corner-large';
    if (numericValue <= 28) return 'corner-extra-large';
    return 'corner-full';
  },

  /**
   * Find the closest Material motion duration
   */
  findMotionDuration(duration) {
    const numericValue = parseFloat(duration) * 1000; // Convert to ms
    const durations = Object.entries(this.motion.durations)
      .sort((a, b) => a[1] - b[1]);

    let closest = durations[0];
    let minDiff = Math.abs(numericValue - closest[1]);

    for (const [token, ms] of durations) {
      const diff = Math.abs(numericValue - ms);
      if (diff < minDiff) {
        minDiff = diff;
        closest = [token, ms];
      }
    }

    return closest[0];
  },

  /**
   * Generate CSS custom properties for a Material theme
   */
  generateThemeCSS(colors) {
    const lines = [':root {'];

    // Color tokens
    Object.entries(colors).forEach(([role, color]) => {
      lines.push(`  --md-sys-color-${role}: ${color};`);
    });

    // Typescale tokens
    Object.entries(this.typescale).forEach(([role, config]) => {
      lines.push(`  --md-sys-typescale-${role}-size: ${config.size}px;`);
      lines.push(`  --md-sys-typescale-${role}-line-height: ${config.lineHeight}px;`);
      lines.push(`  --md-sys-typescale-${role}-weight: ${config.weight};`);
      lines.push(`  --md-sys-typescale-${role}-tracking: ${config.tracking}px;`);
    });

    // Spacing tokens
    Object.entries(this.spacing).forEach(([token, value]) => {
      lines.push(`  --md-sys-${token}: ${value}px;`);
    });

    // Shape tokens
    Object.entries(this.shape).forEach(([token, value]) => {
      lines.push(`  --md-sys-${token}: ${value}px;`);
    });

    lines.push('}');
    return lines.join('\n');
  },

  /**
   * Generate component documentation
   */
  generateComponentDocs(componentType, variant) {
    const component = this.components[componentType];
    if (!component || !component[variant]) return null;

    const config = component[variant];
    const colorRoles = [];

    Object.entries(config).forEach(([prop, role]) => {
      if (this.colorRoles[role]) {
        colorRoles.push({
          property: prop,
          role,
          description: this.colorRoles[role].description,
          usage: this.colorRoles[role].usage
        });
      }
    });

    return {
      component: componentType,
      variant,
      colorRoles,
      shape: config.shape ? this.shape[config.shape] : null,
      elevation: config.elevation ? this.elevation[config.elevation] : null
    };
  }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MaterialTokens;
}
