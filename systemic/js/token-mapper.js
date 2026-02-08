/**
 * Systemic - Token Mapper
 * Maps extracted styles to semantic design tokens with Material Design integration
 */

class TokenMapper {
  constructor() {
    this.colorTokens = new Map();
    this.typographyTokens = new Map();
    this.spacingTokens = new Map();
    this.elevationTokens = new Map();
    this.shapeTokens = new Map();
    this.motionTokens = new Map();
  }

  /**
   * Process extracted data and generate design tokens
   */
  processExtractedData(crawlResults) {
    // Reset token collections
    this.colorTokens.clear();
    this.typographyTokens.clear();
    this.spacingTokens.clear();
    this.elevationTokens.clear();
    this.shapeTokens.clear();
    this.motionTokens.clear();

    // Process all tokens
    crawlResults.tokens.forEach(token => {
      this.categorizeToken(token);
    });

    // Process component styles
    crawlResults.components.forEach(component => {
      this.extractTokensFromComponent(component);
    });

    // Generate semantic mappings
    const colorSystem = this.generateColorSystem();
    const typographySystem = this.generateTypographySystem();
    const spacingSystem = this.generateSpacingSystem();
    const elevationSystem = this.generateElevationSystem();
    const shapeSystem = this.generateShapeSystem();

    return {
      colors: colorSystem,
      typography: typographySystem,
      spacing: spacingSystem,
      elevation: elevationSystem,
      shape: shapeSystem,
      cssVariables: this.generateCSSVariables(
        colorSystem, typographySystem, spacingSystem, elevationSystem, shapeSystem
      ),
      materialMapping: this.generateMaterialMapping(
        colorSystem, typographySystem, spacingSystem
      )
    };
  }

  /**
   * Categorize a token by type
   */
  categorizeToken(token) {
    switch (token.category) {
      case 'color':
        this.addColorToken(token);
        break;
      case 'typography':
        this.addTypographyToken(token);
        break;
      case 'spacing':
        this.addSpacingToken(token);
        break;
      case 'elevation':
        this.addElevationToken(token);
        break;
      case 'shape':
        this.addShapeToken(token);
        break;
      case 'motion':
        this.addMotionToken(token);
        break;
      case 'custom-property':
        this.handleCustomProperty(token);
        break;
    }
  }

  /**
   * Add a color token
   */
  addColorToken(token) {
    const parsed = ColorUtils.parseColor(token.value);
    if (!parsed) return;

    const hex = ColorUtils.rgbToHex(parsed.r, parsed.g, parsed.b);
    const key = hex.toLowerCase();

    if (this.colorTokens.has(key)) {
      const existing = this.colorTokens.get(key);
      existing.usageCount++;
      if (token.context) {
        existing.contexts.add(token.context);
      }
      existing.sources.add(token.source || 'unknown');
    } else {
      this.colorTokens.set(key, {
        hex,
        rgb: parsed,
        hsl: ColorUtils.rgbToHsl(parsed.r, parsed.g, parsed.b),
        usageCount: 1,
        contexts: new Set(token.context ? [token.context] : []),
        sources: new Set([token.source || 'unknown']),
        isLight: ColorUtils.isLight(parsed.r, parsed.g, parsed.b)
      });
    }
  }

  /**
   * Add typography token
   */
  addTypographyToken(token) {
    const key = `${token.property}:${token.value}`;

    if (this.typographyTokens.has(key)) {
      this.typographyTokens.get(key).usageCount++;
    } else {
      this.typographyTokens.set(key, {
        property: token.property,
        value: token.value,
        usageCount: 1,
        source: token.source
      });
    }
  }

  /**
   * Add spacing token
   */
  addSpacingToken(token) {
    const numericValue = parseFloat(token.value);
    if (isNaN(numericValue)) return;

    const key = `${numericValue}px`;

    if (this.spacingTokens.has(key)) {
      this.spacingTokens.get(key).usageCount++;
    } else {
      this.spacingTokens.set(key, {
        value: numericValue,
        unit: 'px',
        usageCount: 1,
        property: token.property
      });
    }
  }

  /**
   * Add elevation token
   */
  addElevationToken(token) {
    if (!token.value || token.value === 'none') return;

    const key = token.value;

    if (this.elevationTokens.has(key)) {
      this.elevationTokens.get(key).usageCount++;
    } else {
      this.elevationTokens.set(key, {
        value: token.value,
        usageCount: 1
      });
    }
  }

  /**
   * Add shape token
   */
  addShapeToken(token) {
    const numericValue = parseFloat(token.value);
    if (isNaN(numericValue)) return;

    const key = `${numericValue}px`;

    if (this.shapeTokens.has(key)) {
      this.shapeTokens.get(key).usageCount++;
    } else {
      this.shapeTokens.set(key, {
        value: numericValue,
        unit: 'px',
        usageCount: 1
      });
    }
  }

  /**
   * Add motion token
   */
  addMotionToken(token) {
    const key = `${token.property}:${token.value}`;

    if (!this.motionTokens.has(key)) {
      this.motionTokens.set(key, {
        property: token.property,
        value: token.value,
        usageCount: 1
      });
    } else {
      this.motionTokens.get(key).usageCount++;
    }
  }

  /**
   * Handle CSS custom properties
   */
  handleCustomProperty(token) {
    // Try to categorize the custom property by its name or value
    const name = token.name.toLowerCase();
    const value = token.value;

    if (name.includes('color') || value.startsWith('#') || value.startsWith('rgb')) {
      this.addColorToken({ ...token, category: 'color', value });
    } else if (name.includes('font') || name.includes('text') || name.includes('type')) {
      const property = name.includes('size') ? 'font-size' :
                       name.includes('weight') ? 'font-weight' :
                       name.includes('family') ? 'font-family' : 'other';
      this.addTypographyToken({ ...token, category: 'typography', property, value });
    } else if (name.includes('space') || name.includes('gap') ||
               name.includes('margin') || name.includes('padding')) {
      this.addSpacingToken({ ...token, category: 'spacing', value });
    } else if (name.includes('radius') || name.includes('corner')) {
      this.addShapeToken({ ...token, category: 'shape', value });
    } else if (name.includes('shadow') || name.includes('elevation')) {
      this.addElevationToken({ ...token, category: 'elevation', value });
    } else if (name.includes('duration') || name.includes('ease') || name.includes('transition')) {
      this.addMotionToken({ ...token, category: 'motion', property: 'transition', value });
    }
  }

  /**
   * Extract tokens from component styles
   */
  extractTokensFromComponent(component) {
    const styles = component.styles || {};

    // Extract colors
    ['color', 'background-color', 'border-color', 'outline-color'].forEach(prop => {
      if (styles[prop] && styles[prop] !== 'transparent') {
        this.addColorToken({
          category: 'color',
          value: styles[prop],
          source: component.type,
          context: component.type
        });
      }
    });

    // Extract typography
    ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing'].forEach(prop => {
      if (styles[prop]) {
        this.addTypographyToken({
          category: 'typography',
          property: prop,
          value: styles[prop],
          source: component.type
        });
      }
    });

    // Extract spacing
    ['margin-top', 'margin-right', 'margin-bottom', 'margin-left',
     'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'gap'].forEach(prop => {
      if (styles[prop] && styles[prop] !== '0px') {
        this.addSpacingToken({
          category: 'spacing',
          property: prop,
          value: styles[prop]
        });
      }
    });

    // Extract elevation
    if (styles['box-shadow'] && styles['box-shadow'] !== 'none') {
      this.addElevationToken({
        category: 'elevation',
        value: styles['box-shadow']
      });
    }

    // Extract shape
    if (styles['border-radius'] && styles['border-radius'] !== '0px') {
      this.addShapeToken({
        category: 'shape',
        value: styles['border-radius']
      });
    }

    // Extract motion
    if (styles['transition']) {
      this.addMotionToken({
        category: 'motion',
        property: 'transition',
        value: styles['transition']
      });
    }
  }

  /**
   * Generate color system with semantic names
   */
  generateColorSystem() {
    const colors = Array.from(this.colorTokens.entries())
      .map(([hex, data]) => ({ hex, ...data }))
      .sort((a, b) => b.usageCount - a.usageCount);

    // Cluster similar colors
    const clusters = ColorUtils.clusterColors(
      colors.map(c => c.rgb),
      20 // threshold
    );

    // Assign semantic roles based on usage and context
    const colorSystem = {
      primary: null,
      secondary: null,
      tertiary: null,
      surface: [],
      onSurface: [],
      error: null,
      success: null,
      warning: null,
      neutral: [],
      accent: []
    };

    // Find primary color (most used saturated color)
    const saturatedColors = colors.filter(c => c.hsl.s > 20);
    if (saturatedColors.length > 0) {
      colorSystem.primary = this.createColorToken(saturatedColors[0], 'primary');
    }

    // Find secondary color
    if (saturatedColors.length > 1) {
      // Choose a color with different hue
      const primaryHue = saturatedColors[0].hsl.h;
      const secondary = saturatedColors.find(c =>
        Math.abs(c.hsl.h - primaryHue) > 30 ||
        c.contexts.has('secondary')
      );
      if (secondary) {
        colorSystem.secondary = this.createColorToken(secondary, 'secondary');
      }
    }

    // Find semantic colors
    colors.forEach(color => {
      const contexts = Array.from(color.contexts);

      if (contexts.includes('error') || contexts.includes('danger')) {
        if (!colorSystem.error) {
          colorSystem.error = this.createColorToken(color, 'error');
        }
      }
      if (contexts.includes('success')) {
        if (!colorSystem.success) {
          colorSystem.success = this.createColorToken(color, 'success');
        }
      }
      if (contexts.includes('warning')) {
        if (!colorSystem.warning) {
          colorSystem.warning = this.createColorToken(color, 'warning');
        }
      }
    });

    // Find surface colors (high lightness, low saturation)
    const neutralColors = colors.filter(c => c.hsl.s <= 20);
    neutralColors.forEach(color => {
      if (color.isLight) {
        colorSystem.surface.push(this.createColorToken(color, 'surface'));
      } else {
        colorSystem.onSurface.push(this.createColorToken(color, 'on-surface'));
      }
    });

    // Collect remaining colors as neutrals/accents
    colors.forEach(color => {
      if (color.hsl.s <= 10) {
        colorSystem.neutral.push(this.createColorToken(color, 'neutral'));
      } else if (!this.isAssigned(color, colorSystem)) {
        colorSystem.accent.push(this.createColorToken(color, 'accent'));
      }
    });

    return colorSystem;
  }

  /**
   * Create a color token object
   */
  createColorToken(color, role) {
    const materialTone = ColorUtils.findClosestMaterialTone(color.rgb);

    return {
      hex: color.hex,
      rgb: `rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`,
      hsl: `hsl(${color.hsl.h}, ${color.hsl.s}%, ${color.hsl.l}%)`,
      role,
      usageCount: color.usageCount,
      materialTone,
      materialToken: `sys.color.${role}`,
      cssVariable: `--sys-color-${role}`
    };
  }

  /**
   * Check if color is already assigned
   */
  isAssigned(color, colorSystem) {
    const assigned = [
      colorSystem.primary,
      colorSystem.secondary,
      colorSystem.tertiary,
      colorSystem.error,
      colorSystem.success,
      colorSystem.warning,
      ...colorSystem.surface,
      ...colorSystem.onSurface
    ].filter(Boolean);

    return assigned.some(c => c.hex === color.hex);
  }

  /**
   * Generate typography system
   */
  generateTypographySystem() {
    const fontFamilies = [];
    const fontSizes = [];
    const fontWeights = [];
    const lineHeights = [];

    this.typographyTokens.forEach((data, key) => {
      switch (data.property) {
        case 'font-family':
          fontFamilies.push({
            value: data.value,
            usageCount: data.usageCount
          });
          break;
        case 'font-size':
          fontSizes.push({
            value: data.value,
            numeric: parseFloat(data.value),
            usageCount: data.usageCount
          });
          break;
        case 'font-weight':
          fontWeights.push({
            value: data.value,
            usageCount: data.usageCount
          });
          break;
        case 'line-height':
          lineHeights.push({
            value: data.value,
            usageCount: data.usageCount
          });
          break;
      }
    });

    // Sort by usage
    fontFamilies.sort((a, b) => b.usageCount - a.usageCount);
    fontSizes.sort((a, b) => b.numeric - a.numeric);
    fontWeights.sort((a, b) => b.usageCount - a.usageCount);

    // Map to Material typescale
    const typescale = fontSizes.map((size, index) => {
      const materialRole = MaterialTokens.findTypescaleRole(size.numeric);
      return {
        ...size,
        materialRole,
        cssVariable: `--sys-typescale-${materialRole}`
      };
    });

    return {
      fontFamilies: fontFamilies.slice(0, 3), // Top 3 font families
      typescale,
      fontWeights,
      lineHeights,
      primary: fontFamilies[0]?.value || 'system-ui',
      secondary: fontFamilies[1]?.value || fontFamilies[0]?.value || 'system-ui'
    };
  }

  /**
   * Generate spacing system
   */
  generateSpacingSystem() {
    const spacings = Array.from(this.spacingTokens.entries())
      .map(([key, data]) => ({
        key,
        ...data
      }))
      .sort((a, b) => a.value - b.value);

    // Create a normalized scale
    const scale = [];
    const baseUnit = 4; // Common base unit

    spacings.forEach(spacing => {
      const normalizedValue = Math.round(spacing.value / baseUnit) * baseUnit;
      const materialToken = MaterialTokens.findSpacingToken(spacing.value);

      scale.push({
        original: spacing.value,
        normalized: normalizedValue,
        usageCount: spacing.usageCount,
        materialToken,
        cssVariable: `--sys-spacing-${normalizedValue / baseUnit}`
      });
    });

    // Deduplicate by normalized value
    const uniqueScale = [];
    const seen = new Set();
    scale.forEach(s => {
      if (!seen.has(s.normalized)) {
        seen.add(s.normalized);
        uniqueScale.push(s);
      }
    });

    return {
      baseUnit,
      scale: uniqueScale.slice(0, 16), // Limit to reasonable scale
      raw: spacings
    };
  }

  /**
   * Generate elevation system
   */
  generateElevationSystem() {
    const elevations = Array.from(this.elevationTokens.entries())
      .map(([key, data]) => ({
        shadow: key,
        ...data,
        materialLevel: MaterialTokens.findElevationLevel(key)
      }))
      .sort((a, b) => b.usageCount - a.usageCount);

    return {
      levels: elevations.slice(0, 5),
      hasShadows: elevations.length > 0
    };
  }

  /**
   * Generate shape system
   */
  generateShapeSystem() {
    const shapes = Array.from(this.shapeTokens.entries())
      .map(([key, data]) => ({
        key,
        ...data,
        materialToken: MaterialTokens.findShapeToken(data.value)
      }))
      .sort((a, b) => a.value - b.value);

    return {
      corners: shapes.slice(0, 6),
      hasRoundedCorners: shapes.some(s => s.value > 0)
    };
  }

  /**
   * Generate CSS variables
   */
  generateCSSVariables(colors, typography, spacing, elevation, shape) {
    const lines = [':root {'];

    // Color tokens
    lines.push('  /* Color Tokens */');
    if (colors.primary) {
      lines.push(`  --sys-color-primary: ${colors.primary.hex};`);
    }
    if (colors.secondary) {
      lines.push(`  --sys-color-secondary: ${colors.secondary.hex};`);
    }
    if (colors.error) {
      lines.push(`  --sys-color-error: ${colors.error.hex};`);
    }
    if (colors.success) {
      lines.push(`  --sys-color-success: ${colors.success.hex};`);
    }
    if (colors.warning) {
      lines.push(`  --sys-color-warning: ${colors.warning.hex};`);
    }
    colors.surface.slice(0, 3).forEach((color, i) => {
      lines.push(`  --sys-color-surface-${i + 1}: ${color.hex};`);
    });
    colors.onSurface.slice(0, 3).forEach((color, i) => {
      lines.push(`  --sys-color-on-surface-${i + 1}: ${color.hex};`);
    });
    colors.neutral.slice(0, 10).forEach((color, i) => {
      lines.push(`  --sys-color-neutral-${(i + 1) * 10}: ${color.hex};`);
    });

    // Typography tokens
    lines.push('');
    lines.push('  /* Typography Tokens */');
    lines.push(`  --sys-typescale-font-primary: ${typography.primary};`);
    if (typography.secondary !== typography.primary) {
      lines.push(`  --sys-typescale-font-secondary: ${typography.secondary};`);
    }
    typography.typescale.forEach(size => {
      lines.push(`  --sys-typescale-${size.materialRole}-size: ${size.value};`);
    });

    // Spacing tokens
    lines.push('');
    lines.push('  /* Spacing Tokens */');
    spacing.scale.forEach(s => {
      lines.push(`  --sys-spacing-${s.normalized / spacing.baseUnit}: ${s.normalized}px;`);
    });

    // Shape tokens
    lines.push('');
    lines.push('  /* Shape Tokens */');
    shape.corners.forEach(corner => {
      lines.push(`  --sys-shape-${corner.materialToken}: ${corner.value}px;`);
    });

    // Elevation tokens
    if (elevation.hasShadows) {
      lines.push('');
      lines.push('  /* Elevation Tokens */');
      elevation.levels.forEach((level, i) => {
        lines.push(`  --sys-elevation-${i + 1}: ${level.shadow};`);
      });
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Generate Material Design mapping
   */
  generateMaterialMapping(colors, typography, spacing) {
    return {
      colorScheme: {
        primary: colors.primary?.materialToken || 'sys.color.primary',
        secondary: colors.secondary?.materialToken || 'sys.color.secondary',
        surface: colors.surface[0]?.materialToken || 'sys.color.surface',
        onSurface: colors.onSurface[0]?.materialToken || 'sys.color.on-surface',
        error: colors.error?.materialToken || 'sys.color.error'
      },
      typescale: typography.typescale.map(t => ({
        size: t.value,
        materialRole: t.materialRole
      })),
      spacingScale: spacing.scale.map(s => s.materialToken)
    };
  }

  /**
   * Export tokens to various formats
   */
  export(format = 'css') {
    const results = this.getTokens();

    switch (format) {
      case 'css':
        return results.cssVariables;

      case 'json':
        return JSON.stringify({
          colors: results.colors,
          typography: results.typography,
          spacing: results.spacing,
          elevation: results.elevation,
          shape: results.shape
        }, null, 2);

      case 'scss':
        return this.toSCSS(results);

      case 'design-tokens':
        return this.toDesignTokensFormat(results);

      default:
        return results;
    }
  }

  /**
   * Convert to SCSS variables
   */
  toSCSS(results) {
    const lines = [];

    // Colors
    if (results.colors.primary) {
      lines.push(`$color-primary: ${results.colors.primary.hex};`);
    }
    if (results.colors.secondary) {
      lines.push(`$color-secondary: ${results.colors.secondary.hex};`);
    }

    results.colors.neutral.forEach((color, i) => {
      lines.push(`$color-neutral-${(i + 1) * 10}: ${color.hex};`);
    });

    // Typography
    lines.push('');
    lines.push(`$font-primary: ${results.typography.primary};`);

    // Spacing
    lines.push('');
    results.spacing.scale.forEach(s => {
      lines.push(`$spacing-${s.normalized / results.spacing.baseUnit}: ${s.normalized}px;`);
    });

    return lines.join('\n');
  }

  /**
   * Convert to W3C Design Tokens format
   */
  toDesignTokensFormat(results) {
    const tokens = {
      color: {},
      typography: {},
      spacing: {},
      elevation: {},
      shape: {}
    };

    // Colors
    if (results.colors.primary) {
      tokens.color.primary = {
        $value: results.colors.primary.hex,
        $type: 'color'
      };
    }

    results.colors.neutral.forEach((color, i) => {
      tokens.color[`neutral-${(i + 1) * 10}`] = {
        $value: color.hex,
        $type: 'color'
      };
    });

    // Spacing
    results.spacing.scale.forEach(s => {
      tokens.spacing[`space-${s.normalized / results.spacing.baseUnit}`] = {
        $value: `${s.normalized}px`,
        $type: 'dimension'
      };
    });

    return JSON.stringify(tokens, null, 2);
  }

  /**
   * Get all tokens
   */
  getTokens() {
    return {
      colors: this.generateColorSystem(),
      typography: this.generateTypographySystem(),
      spacing: this.generateSpacingSystem(),
      elevation: this.generateElevationSystem(),
      shape: this.generateShapeSystem(),
      cssVariables: ''
    };
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TokenMapper;
}
