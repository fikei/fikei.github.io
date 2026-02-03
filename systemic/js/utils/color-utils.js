/**
 * SystemicAI - Color Utilities
 * Functions for color extraction, analysis, and Material Design mapping
 */

const ColorUtils = {
  /**
   * Parse any color format to RGB
   */
  parseColor(color) {
    if (!color || color === 'transparent' || color === 'inherit') {
      return null;
    }

    // RGB/RGBA format
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (rgbMatch) {
      return {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3]),
        a: rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1
      };
    }

    // Hex format
    const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i);
    if (hexMatch) {
      return {
        r: parseInt(hexMatch[1], 16),
        g: parseInt(hexMatch[2], 16),
        b: parseInt(hexMatch[3], 16),
        a: hexMatch[4] ? parseInt(hexMatch[4], 16) / 255 : 1
      };
    }

    // Short hex format
    const shortHexMatch = color.match(/^#?([a-f\d])([a-f\d])([a-f\d])$/i);
    if (shortHexMatch) {
      return {
        r: parseInt(shortHexMatch[1] + shortHexMatch[1], 16),
        g: parseInt(shortHexMatch[2] + shortHexMatch[2], 16),
        b: parseInt(shortHexMatch[3] + shortHexMatch[3], 16),
        a: 1
      };
    }

    // HSL format
    const hslMatch = color.match(/hsla?\((\d+),\s*([\d.]+)%,\s*([\d.]+)%(?:,\s*([\d.]+))?\)/);
    if (hslMatch) {
      return this.hslToRgb(
        parseInt(hslMatch[1]),
        parseFloat(hslMatch[2]),
        parseFloat(hslMatch[3]),
        hslMatch[4] ? parseFloat(hslMatch[4]) : 1
      );
    }

    return null;
  },

  /**
   * Convert RGB to Hex
   */
  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const hex = Math.round(x).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  },

  /**
   * Convert RGB to HSL
   */
  rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100)
    };
  },

  /**
   * Convert HSL to RGB
   */
  hslToRgb(h, s, l, a = 1) {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r, g, b;

    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
      a
    };
  },

  /**
   * Calculate relative luminance (WCAG)
   */
  getLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  },

  /**
   * Calculate contrast ratio between two colors
   */
  getContrastRatio(color1, color2) {
    const l1 = this.getLuminance(color1.r, color1.g, color1.b);
    const l2 = this.getLuminance(color2.r, color2.g, color2.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  },

  /**
   * Check if color passes WCAG AA
   */
  passesWCAG_AA(foreground, background, isLargeText = false) {
    const ratio = this.getContrastRatio(foreground, background);
    return isLargeText ? ratio >= 3 : ratio >= 4.5;
  },

  /**
   * Check if color passes WCAG AAA
   */
  passesWCAG_AAA(foreground, background, isLargeText = false) {
    const ratio = this.getContrastRatio(foreground, background);
    return isLargeText ? ratio >= 4.5 : ratio >= 7;
  },

  /**
   * Determine if a color is light or dark
   */
  isLight(r, g, b) {
    return this.getLuminance(r, g, b) > 0.179;
  },

  /**
   * Calculate color distance (Euclidean)
   */
  colorDistance(color1, color2) {
    return Math.sqrt(
      Math.pow(color1.r - color2.r, 2) +
      Math.pow(color1.g - color2.g, 2) +
      Math.pow(color1.b - color2.b, 2)
    );
  },

  /**
   * Calculate perceptual color difference (CIE76)
   */
  deltaE(color1, color2) {
    const lab1 = this.rgbToLab(color1);
    const lab2 = this.rgbToLab(color2);

    return Math.sqrt(
      Math.pow(lab1.l - lab2.l, 2) +
      Math.pow(lab1.a - lab2.a, 2) +
      Math.pow(lab1.b - lab2.b, 2)
    );
  },

  /**
   * Convert RGB to LAB color space
   */
  rgbToLab(rgb) {
    // RGB to XYZ
    let r = rgb.r / 255;
    let g = rgb.g / 255;
    let b = rgb.b / 255;

    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

    const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;

    // XYZ to Lab
    const fx = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
    const fy = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
    const fz = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;

    return {
      l: (116 * fy) - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz)
    };
  },

  /**
   * Cluster similar colors together
   */
  clusterColors(colors, threshold = 25) {
    const clusters = [];

    colors.forEach(color => {
      let addedToCluster = false;

      for (const cluster of clusters) {
        if (this.deltaE(color, cluster.representative) < threshold) {
          cluster.colors.push(color);
          cluster.count++;
          addedToCluster = true;
          break;
        }
      }

      if (!addedToCluster) {
        clusters.push({
          representative: color,
          colors: [color],
          count: 1
        });
      }
    });

    // Sort by frequency
    return clusters.sort((a, b) => b.count - a.count);
  },

  /**
   * Extract dominant colors from a list
   */
  extractDominantColors(colors, maxColors = 10) {
    const clusters = this.clusterColors(colors);
    return clusters.slice(0, maxColors).map(cluster => ({
      color: cluster.representative,
      hex: this.rgbToHex(cluster.representative.r, cluster.representative.g, cluster.representative.b),
      count: cluster.count
    }));
  },

  /**
   * Generate a tonal palette from a base color
   */
  generateTonalPalette(baseColor) {
    const hsl = this.rgbToHsl(baseColor.r, baseColor.g, baseColor.b);
    const tones = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

    return tones.map(tone => {
      const rgb = this.hslToRgb(hsl.h, hsl.s, tone);
      return {
        tone,
        rgb,
        hex: this.rgbToHex(rgb.r, rgb.g, rgb.b)
      };
    });
  },

  /**
   * Find the closest Material Design color tone
   */
  findClosestMaterialTone(color) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    const materialTones = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];

    let closest = materialTones[0];
    let minDiff = Math.abs(hsl.l - closest);

    materialTones.forEach(tone => {
      const diff = Math.abs(hsl.l - tone);
      if (diff < minDiff) {
        minDiff = diff;
        closest = tone;
      }
    });

    return closest;
  },

  /**
   * Determine semantic role of a color based on context
   */
  determineSemanticRole(color, context) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);

    // Check for error colors (red hues)
    if (hsl.h >= 350 || hsl.h <= 10) {
      if (context.includes('error') || context.includes('danger') ||
          context.includes('delete') || context.includes('remove')) {
        return 'error';
      }
    }

    // Check for success colors (green hues)
    if (hsl.h >= 90 && hsl.h <= 150) {
      if (context.includes('success') || context.includes('valid') ||
          context.includes('confirm') || context.includes('complete')) {
        return 'success';
      }
    }

    // Check for warning colors (yellow/orange hues)
    if (hsl.h >= 30 && hsl.h <= 60) {
      if (context.includes('warning') || context.includes('caution') ||
          context.includes('alert')) {
        return 'warning';
      }
    }

    // Check for info colors (blue hues)
    if (hsl.h >= 190 && hsl.h <= 250) {
      if (context.includes('info') || context.includes('link') ||
          context.includes('primary')) {
        return 'info';
      }
    }

    // Check for neutral/surface colors
    if (hsl.s <= 10) {
      if (hsl.l >= 90) return 'surface';
      if (hsl.l <= 10) return 'on-surface';
      return 'outline';
    }

    // Default: check if it's commonly used for primary actions
    if (context.includes('primary') || context.includes('brand') ||
        context.includes('main') || context.includes('cta')) {
      return 'primary';
    }

    if (context.includes('secondary') || context.includes('accent')) {
      return 'secondary';
    }

    return 'custom';
  },

  /**
   * Generate a complementary color
   */
  getComplementary(color) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    hsl.h = (hsl.h + 180) % 360;
    return this.hslToRgb(hsl.h, hsl.s, hsl.l);
  },

  /**
   * Generate analogous colors
   */
  getAnalogous(color, angle = 30) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    return [
      this.hslToRgb((hsl.h - angle + 360) % 360, hsl.s, hsl.l),
      this.hslToRgb((hsl.h + angle) % 360, hsl.s, hsl.l)
    ];
  },

  /**
   * Generate triadic colors
   */
  getTriadic(color) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    return [
      this.hslToRgb((hsl.h + 120) % 360, hsl.s, hsl.l),
      this.hslToRgb((hsl.h + 240) % 360, hsl.s, hsl.l)
    ];
  },

  /**
   * Mix two colors
   */
  mixColors(color1, color2, ratio = 0.5) {
    return {
      r: Math.round(color1.r * (1 - ratio) + color2.r * ratio),
      g: Math.round(color1.g * (1 - ratio) + color2.g * ratio),
      b: Math.round(color1.b * (1 - ratio) + color2.b * ratio),
      a: color1.a * (1 - ratio) + color2.a * ratio
    };
  },

  /**
   * Lighten a color
   */
  lighten(color, amount = 10) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    hsl.l = Math.min(100, hsl.l + amount);
    return this.hslToRgb(hsl.h, hsl.s, hsl.l, color.a);
  },

  /**
   * Darken a color
   */
  darken(color, amount = 10) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    hsl.l = Math.max(0, hsl.l - amount);
    return this.hslToRgb(hsl.h, hsl.s, hsl.l, color.a);
  },

  /**
   * Saturate a color
   */
  saturate(color, amount = 10) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    hsl.s = Math.min(100, hsl.s + amount);
    return this.hslToRgb(hsl.h, hsl.s, hsl.l, color.a);
  },

  /**
   * Desaturate a color
   */
  desaturate(color, amount = 10) {
    const hsl = this.rgbToHsl(color.r, color.g, color.b);
    hsl.s = Math.max(0, hsl.s - amount);
    return this.hslToRgb(hsl.h, hsl.s, hsl.l, color.a);
  }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ColorUtils;
}
