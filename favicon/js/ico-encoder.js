/**
 * ICO Encoder
 * Creates .ico files from multiple PNG images
 * ICO format spec: https://en.wikipedia.org/wiki/ICO_(file_format)
 */

class IcoEncoder {
  /**
   * Create an ICO file from multiple canvases
   * @param {HTMLCanvasElement[]} canvases - Array of canvases (should be 16, 32, 48 sizes)
   * @returns {Promise<Blob>} ICO file as blob
   */
  static async encode(canvases) {
    // Get PNG data for each canvas
    const pngDataArray = await Promise.all(
      canvases.map(canvas => this.canvasToPngData(canvas))
    );

    // Calculate file size
    // ICONDIR (6 bytes) + ICONDIRENTRY per image (16 bytes each) + PNG data
    const headerSize = 6;
    const entrySize = 16;
    const dirSize = headerSize + entrySize * canvases.length;

    // Calculate total size and offsets
    let totalSize = dirSize;
    const offsets = [];

    for (const pngData of pngDataArray) {
      offsets.push(totalSize);
      totalSize += pngData.length;
    }

    // Create the ICO file buffer
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);

    // Write ICONDIR header
    view.setUint16(0, 0, true);      // Reserved (must be 0)
    view.setUint16(2, 1, true);      // Image type (1 = ICO)
    view.setUint16(4, canvases.length, true);  // Number of images

    // Write ICONDIRENTRY for each image
    let offset = headerSize;
    for (let i = 0; i < canvases.length; i++) {
      const canvas = canvases[i];
      const pngData = pngDataArray[i];

      // Width and height (0 means 256)
      const width = canvas.width >= 256 ? 0 : canvas.width;
      const height = canvas.height >= 256 ? 0 : canvas.height;

      view.setUint8(offset + 0, width);           // Width
      view.setUint8(offset + 1, height);          // Height
      view.setUint8(offset + 2, 0);               // Color palette (0 = no palette)
      view.setUint8(offset + 3, 0);               // Reserved
      view.setUint16(offset + 4, 1, true);        // Color planes
      view.setUint16(offset + 6, 32, true);       // Bits per pixel
      view.setUint32(offset + 8, pngData.length, true);   // Size of image data
      view.setUint32(offset + 12, offsets[i], true);      // Offset to image data

      offset += entrySize;
    }

    // Write PNG data for each image
    for (let i = 0; i < pngDataArray.length; i++) {
      uint8.set(pngDataArray[i], offsets[i]);
    }

    return new Blob([buffer], { type: 'image/x-icon' });
  }

  /**
   * Convert canvas to PNG data as Uint8Array
   * @param {HTMLCanvasElement} canvas
   * @returns {Promise<Uint8Array>}
   */
  static canvasToPngData(canvas) {
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        const arrayBuffer = await blob.arrayBuffer();
        resolve(new Uint8Array(arrayBuffer));
      }, 'image/png');
    });
  }

  /**
   * Create ICO from FaviconGenerator canvases map
   * Uses 16, 32, and 48 pixel sizes for ICO
   * @param {Map<number, HTMLCanvasElement>} canvasMap
   * @returns {Promise<Blob>}
   */
  static async createFromCanvasMap(canvasMap) {
    const icoSizes = [16, 32, 48];
    const canvases = [];

    for (const size of icoSizes) {
      const canvas = canvasMap.get(size);
      if (canvas) {
        canvases.push(canvas);
      }
    }

    if (canvases.length === 0) {
      throw new Error('No suitable canvases found for ICO creation');
    }

    return this.encode(canvases);
  }
}

// Export for use in other modules
window.IcoEncoder = IcoEncoder;
