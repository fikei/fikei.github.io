/**
 * Favicon Generator
 * Core module for generating favicons from various sources
 */

class FaviconGenerator {
  constructor() {
    // Standard favicon sizes for deployment
    this.sizes = [16, 32, 48, 180, 192, 512];

    // Generated canvases storage
    this.canvases = new Map();

    // Source image (if any)
    this.sourceImage = null;
  }

  /**
   * Generate favicon from text or emoji
   * @param {Object} options - Generation options
   * @param {string} options.text - Text or emoji to render
   * @param {string} options.bgColor - Background color
   * @param {string} options.fgColor - Foreground/text color
   * @param {string} options.font - Font family
   * @param {string} options.shape - Shape: 'square', 'rounded', 'circle'
   * @returns {Map<number, HTMLCanvasElement>} Map of size to canvas
   */
  generateFromText(options) {
    const { text, bgColor, fgColor, font, shape } = options;

    this.canvases.clear();

    for (const size of this.sizes) {
      const canvas = this.createTextCanvas(size, text, bgColor, fgColor, font, shape);
      this.canvases.set(size, canvas);
    }

    return this.canvases;
  }

  /**
   * Create a single canvas with text/emoji
   */
  createTextCanvas(size, text, bgColor, fgColor, font, shape) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Draw background
    ctx.fillStyle = bgColor;

    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (shape === 'rounded') {
      const radius = size * 0.2;
      this.roundRect(ctx, 0, 0, size, size, radius);
      ctx.fill();
    } else {
      ctx.fillRect(0, 0, size, size);
    }

    // Draw text/emoji
    ctx.fillStyle = fgColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Check if text is emoji
    const isEmoji = this.containsEmoji(text);

    // Calculate font size (larger for single char, smaller for multiple)
    let fontSize;
    if (text.length === 1 || isEmoji) {
      fontSize = size * 0.65;
    } else if (text.length === 2) {
      fontSize = size * 0.5;
    } else {
      fontSize = size * 0.4;
    }

    // Use appropriate font
    if (isEmoji) {
      // For emoji, use system emoji font
      ctx.font = `${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
    } else {
      ctx.font = `bold ${fontSize}px "${font}", sans-serif`;
    }

    // Draw the text
    ctx.fillText(text, size / 2, size / 2 + size * 0.02);

    return canvas;
  }

  /**
   * Generate favicon from uploaded image
   * @param {HTMLImageElement|ImageBitmap} image - Source image
   * @returns {Map<number, HTMLCanvasElement>} Map of size to canvas
   */
  generateFromImage(image) {
    this.canvases.clear();
    this.sourceImage = image;

    for (const size of this.sizes) {
      const canvas = this.createImageCanvas(size, image);
      this.canvases.set(size, canvas);
    }

    return this.canvases;
  }

  /**
   * Create a single canvas from image
   */
  createImageCanvas(size, image) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Calculate aspect-fit dimensions
    const srcRatio = image.width / image.height;
    let drawWidth, drawHeight, offsetX, offsetY;

    if (srcRatio > 1) {
      // Wider than tall
      drawHeight = size;
      drawWidth = size * srcRatio;
      offsetX = (size - drawWidth) / 2;
      offsetY = 0;
    } else {
      // Taller than wide or square
      drawWidth = size;
      drawHeight = size / srcRatio;
      offsetX = 0;
      offsetY = (size - drawHeight) / 2;
    }

    // Enable image smoothing for better quality
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Draw centered and cropped
    ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

    return canvas;
  }

  /**
   * Generate favicon from AI-generated image URL
   * @param {string} imageUrl - URL of the generated image
   * @returns {Promise<Map<number, HTMLCanvasElement>>}
   */
  async generateFromUrl(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        resolve(this.generateFromImage(img));
      };

      img.onerror = () => {
        reject(new Error('Failed to load image from URL'));
      };

      img.src = imageUrl;
    });
  }

  /**
   * Get canvas for a specific size
   * @param {number} size
   * @returns {HTMLCanvasElement|null}
   */
  getCanvas(size) {
    return this.canvases.get(size) || null;
  }

  /**
   * Get all generated canvases
   * @returns {Map<number, HTMLCanvasElement>}
   */
  getAllCanvases() {
    return this.canvases;
  }

  /**
   * Export canvas as PNG blob
   * @param {number} size
   * @returns {Promise<Blob>}
   */
  async exportAsPng(size) {
    const canvas = this.canvases.get(size);
    if (!canvas) {
      throw new Error(`No canvas found for size ${size}`);
    }

    return new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
  }

  /**
   * Export canvas as data URL
   * @param {number} size
   * @returns {string}
   */
  exportAsDataUrl(size) {
    const canvas = this.canvases.get(size);
    if (!canvas) {
      throw new Error(`No canvas found for size ${size}`);
    }

    return canvas.toDataURL('image/png');
  }

  /**
   * Get file name for a specific size
   * @param {number} size
   * @returns {string}
   */
  getFileName(size) {
    switch (size) {
      case 16:
        return 'favicon-16x16.png';
      case 32:
        return 'favicon-32x32.png';
      case 48:
        return 'favicon-48x48.png';
      case 180:
        return 'apple-touch-icon.png';
      case 192:
        return 'android-chrome-192x192.png';
      case 512:
        return 'android-chrome-512x512.png';
      default:
        return `favicon-${size}x${size}.png`;
    }
  }

  /**
   * Generate HTML link tags for favicon
   * @returns {string}
   */
  generateHtmlCode() {
    return `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="manifest" href="/site.webmanifest">`;
  }

  /**
   * Generate web manifest JSON
   * @param {string} name - App name
   * @param {string} shortName - Short app name
   * @returns {string}
   */
  generateManifest(name = 'My App', shortName = 'App') {
    const manifest = {
      name,
      short_name: shortName,
      icons: [
        {
          src: '/android-chrome-192x192.png',
          sizes: '192x192',
          type: 'image/png'
        },
        {
          src: '/android-chrome-512x512.png',
          sizes: '512x512',
          type: 'image/png'
        }
      ],
      theme_color: '#000000',
      background_color: '#000000',
      display: 'standalone'
    };

    return JSON.stringify(manifest, null, 2);
  }

  /**
   * Helper: Draw rounded rectangle
   */
  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Helper: Check if string contains emoji
   */
  containsEmoji(str) {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/u;
    return emojiRegex.test(str);
  }
}

// Export for use in other modules
window.FaviconGenerator = FaviconGenerator;
