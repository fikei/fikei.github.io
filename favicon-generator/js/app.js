/**
 * Favicon Generator App
 * Main application controller
 */

class FaviconApp {
  constructor() {
    this.generator = new FaviconGenerator();
    this.currentMode = 'ai';
    this.hasGenerated = false;

    // DOM Elements
    this.elements = {
      // Mode tabs
      modeTabs: document.querySelectorAll('.mode-tab'),
      modePanels: document.querySelectorAll('.mode-panel'),

      // AI form
      aiForm: document.getElementById('ai-form'),
      aiPrompt: document.getElementById('ai-prompt'),
      aiStyle: document.getElementById('ai-style'),
      aiColor: document.getElementById('ai-color'),
      aiProvider: document.getElementById('ai-provider'),
      aiApiKey: document.getElementById('ai-api-key'),

      // Text form
      textForm: document.getElementById('text-form'),
      textContent: document.getElementById('text-content'),
      textBgColor: document.getElementById('text-bg-color'),
      textFgColor: document.getElementById('text-fg-color'),
      textFont: document.getElementById('text-font'),
      textShape: document.getElementById('text-shape'),

      // Upload form
      uploadForm: document.getElementById('upload-form'),
      uploadZone: document.getElementById('upload-zone'),
      uploadInput: document.getElementById('upload-input'),
      uploadPreview: document.getElementById('upload-preview'),
      previewImage: document.getElementById('preview-image'),
      clearUpload: document.getElementById('clear-upload'),
      uploadSubmit: document.getElementById('upload-submit'),

      // Emoji picker
      emojiButtons: document.querySelectorAll('.emoji-btn'),

      // Preview elements
      previewGrid: document.querySelector('.preview-grid'),
      previewEmpty: document.getElementById('preview-empty'),
      previewTabFavicon: document.getElementById('preview-tab-favicon'),
      previewBookmarkFavicon: document.getElementById('preview-bookmark-favicon'),
      previewMobileIcon: document.getElementById('preview-mobile-icon'),
      previewCanvases: {
        16: document.getElementById('preview-16'),
        32: document.getElementById('preview-32'),
        48: document.getElementById('preview-48'),
        180: document.getElementById('preview-180'),
        192: document.getElementById('preview-192'),
        512: document.getElementById('preview-512')
      },

      // Export section
      exportSection: document.getElementById('export-section'),
      downloadZip: document.getElementById('download-zip'),
      htmlCode: document.getElementById('html-code'),
      manifestCode: document.getElementById('manifest-code'),
      individualDownloads: document.getElementById('individual-downloads'),
      copyButtons: document.querySelectorAll('.copy-btn'),

      // Loading & notifications
      loadingOverlay: document.getElementById('loading-overlay'),
      loadingText: document.getElementById('loading-text'),
      toastContainer: document.getElementById('toast-container'),

      // Theme toggle
      themeToggle: document.getElementById('theme-toggle')
    };

    this.init();
  }

  init() {
    this.loadSettings();
    this.bindEvents();
    this.updateCodeBlocks();
  }

  loadSettings() {
    // Load theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.documentElement.classList.add('light');
    }

    // Load API key
    const savedKey = localStorage.getItem('favicon-api-key');
    const savedProvider = localStorage.getItem('favicon-api-provider');

    if (savedKey) {
      this.elements.aiApiKey.value = savedKey;
    }
    if (savedProvider) {
      this.elements.aiProvider.value = savedProvider;
    }
  }

  bindEvents() {
    // Mode tabs
    this.elements.modeTabs.forEach(tab => {
      tab.addEventListener('click', () => this.switchMode(tab.dataset.mode));
    });

    // Theme toggle
    this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());

    // AI form
    this.elements.aiForm.addEventListener('submit', (e) => this.handleAiGenerate(e));

    // Text form
    this.elements.textForm.addEventListener('submit', (e) => this.handleTextGenerate(e));

    // Upload form
    this.elements.uploadForm.addEventListener('submit', (e) => this.handleUploadGenerate(e));
    this.elements.uploadZone.addEventListener('click', () => this.elements.uploadInput.click());
    this.elements.uploadInput.addEventListener('change', (e) => this.handleFileSelect(e));
    this.elements.clearUpload.addEventListener('click', () => this.clearUploadPreview());

    // Drag and drop
    this.elements.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.elements.uploadZone.classList.add('dragover');
    });
    this.elements.uploadZone.addEventListener('dragleave', () => {
      this.elements.uploadZone.classList.remove('dragover');
    });
    this.elements.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.elements.uploadZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        this.loadImageFile(file);
      }
    });

    // Emoji picker
    this.elements.emojiButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.elements.textContent.value = btn.dataset.emoji;
        this.elements.textContent.focus();
      });
    });

    // Live preview for text mode
    ['textContent', 'textBgColor', 'textFgColor', 'textFont', 'textShape'].forEach(key => {
      this.elements[key].addEventListener('input', () => this.updateTextPreview());
    });

    // API key saving
    this.elements.aiApiKey.addEventListener('change', () => {
      localStorage.setItem('favicon-api-key', this.elements.aiApiKey.value);
    });
    this.elements.aiProvider.addEventListener('change', () => {
      localStorage.setItem('favicon-api-provider', this.elements.aiProvider.value);
    });

    // Download ZIP
    this.elements.downloadZip.addEventListener('click', () => this.downloadZip());

    // Copy buttons
    this.elements.copyButtons.forEach(btn => {
      btn.addEventListener('click', () => this.copyCode(btn.dataset.target));
    });
  }

  switchMode(mode) {
    this.currentMode = mode;

    this.elements.modeTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    this.elements.modePanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `${mode}-mode`);
    });
  }

  toggleTheme() {
    document.documentElement.classList.toggle('light');
    const isLight = document.documentElement.classList.contains('light');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
  }

  // ============================================
  // Text Generation
  // ============================================

  handleTextGenerate(e) {
    e.preventDefault();

    const text = this.elements.textContent.value.trim();
    if (!text) {
      this.showToast('Please enter text or an emoji', 'error');
      return;
    }

    this.generateTextFavicon();
  }

  generateTextFavicon() {
    const options = {
      text: this.elements.textContent.value.trim(),
      bgColor: this.elements.textBgColor.value,
      fgColor: this.elements.textFgColor.value,
      font: this.elements.textFont.value,
      shape: this.elements.textShape.value
    };

    this.generator.generateFromText(options);
    this.updatePreviews();
    this.showExportSection();
    this.showToast('Favicon generated successfully!', 'success');
  }

  updateTextPreview() {
    const text = this.elements.textContent.value.trim();
    if (!text) return;

    this.generateTextFavicon();
  }

  // ============================================
  // Upload Generation
  // ============================================

  handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      this.loadImageFile(file);
    }
  }

  loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.elements.previewImage.src = e.target.result;
      this.elements.uploadPreview.hidden = false;
      this.elements.uploadZone.hidden = true;
      this.elements.uploadSubmit.disabled = false;
    };
    reader.readAsDataURL(file);
  }

  clearUploadPreview() {
    this.elements.previewImage.src = '';
    this.elements.uploadPreview.hidden = true;
    this.elements.uploadZone.hidden = false;
    this.elements.uploadSubmit.disabled = true;
    this.elements.uploadInput.value = '';
  }

  handleUploadGenerate(e) {
    e.preventDefault();

    const img = this.elements.previewImage;
    if (!img.src) {
      this.showToast('Please upload an image first', 'error');
      return;
    }

    this.showLoading('Processing image...');

    // Create a new image to ensure it's loaded
    const image = new Image();
    image.onload = () => {
      this.generator.generateFromImage(image);
      this.updatePreviews();
      this.showExportSection();
      this.hideLoading();
      this.showToast('Favicon generated from image!', 'success');
    };
    image.src = img.src;
  }

  // ============================================
  // AI Generation
  // ============================================

  async handleAiGenerate(e) {
    e.preventDefault();

    const prompt = this.elements.aiPrompt.value.trim();
    const apiKey = this.elements.aiApiKey.value.trim();
    const provider = this.elements.aiProvider.value;
    const style = this.elements.aiStyle.value;
    const color = this.elements.aiColor.value;

    if (!prompt) {
      this.showToast('Please enter a prompt', 'error');
      return;
    }

    if (!apiKey) {
      this.showToast('Please enter your API key in the settings', 'error');
      return;
    }

    // Build enhanced prompt for favicon
    const enhancedPrompt = this.buildFaviconPrompt(prompt, style, color);

    this.showLoading('Generating with AI...');

    try {
      let imageUrl;

      switch (provider) {
        case 'openai':
          imageUrl = await this.generateWithOpenAI(apiKey, enhancedPrompt);
          break;
        case 'stability':
          imageUrl = await this.generateWithStability(apiKey, enhancedPrompt);
          break;
        case 'replicate':
          imageUrl = await this.generateWithReplicate(apiKey, enhancedPrompt);
          break;
        default:
          throw new Error('Unknown provider');
      }

      await this.generator.generateFromUrl(imageUrl);
      this.updatePreviews();
      this.showExportSection();
      this.showToast('AI favicon generated successfully!', 'success');

    } catch (error) {
      console.error('AI generation error:', error);
      this.showToast(`Generation failed: ${error.message}`, 'error');
    } finally {
      this.hideLoading();
    }
  }

  buildFaviconPrompt(userPrompt, style, color) {
    const styleDescriptions = {
      flat: 'flat design, solid colors, no gradients, minimal shadows',
      '3d': '3D rendered, subtle depth, soft lighting',
      pixel: 'pixel art style, retro, blocky',
      minimal: 'extremely minimalist, simple shapes, clean lines',
      gradient: 'smooth gradients, modern, vibrant',
      outline: 'line art, outline only, no fill'
    };

    const hexToName = (hex) => {
      const colors = {
        '#ffffff': 'white',
        '#000000': 'black',
        '#ff0000': 'red',
        '#00ff00': 'green',
        '#0000ff': 'blue',
        '#ffff00': 'yellow',
        '#ff00ff': 'magenta',
        '#00ffff': 'cyan'
      };
      return colors[hex.toLowerCase()] || hex;
    };

    return `Create a favicon/app icon: ${userPrompt}. Style: ${styleDescriptions[style]}. Primary color: ${hexToName(color)}. Square format, centered composition, works well at small sizes (16x16 to 512x512 pixels), simple and recognizable, no text unless specifically requested. High contrast, professional quality.`;
  }

  async generateWithOpenAI(apiKey, prompt) {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'url'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const data = await response.json();
    return data.data[0].url;
  }

  async generateWithStability(apiKey, prompt) {
    const response = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        text_prompts: [{ text: prompt, weight: 1 }],
        cfg_scale: 7,
        height: 1024,
        width: 1024,
        samples: 1,
        steps: 30
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Stability AI API error');
    }

    const data = await response.json();
    const base64 = data.artifacts[0].base64;
    return `data:image/png;base64,${base64}`;
  }

  async generateWithReplicate(apiKey, prompt) {
    // Start prediction
    const startResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiKey}`
      },
      body: JSON.stringify({
        version: 'ac732df83cea7fff18b8472768c88ad041fa750ff7682a21affe81863cbe77e4', // SDXL
        input: {
          prompt: prompt,
          width: 1024,
          height: 1024,
          num_outputs: 1
        }
      })
    });

    if (!startResponse.ok) {
      const error = await startResponse.json();
      throw new Error(error.detail || 'Replicate API error');
    }

    const prediction = await startResponse.json();

    // Poll for completion
    let result = prediction;
    while (result.status !== 'succeeded' && result.status !== 'failed') {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const pollResponse = await fetch(result.urls.get, {
        headers: { 'Authorization': `Token ${apiKey}` }
      });

      result = await pollResponse.json();
    }

    if (result.status === 'failed') {
      throw new Error(result.error || 'Generation failed');
    }

    return result.output[0];
  }

  // ============================================
  // Preview Updates
  // ============================================

  updatePreviews() {
    this.hasGenerated = true;

    // Show preview grid, hide empty state
    this.elements.previewGrid.classList.add('visible');
    this.elements.previewEmpty.classList.add('hidden');

    // Update size previews
    for (const [size, canvas] of this.generator.getAllCanvases()) {
      const previewCanvas = this.elements.previewCanvases[size];
      if (previewCanvas) {
        const ctx = previewCanvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(canvas, 0, 0);
      }
    }

    // Update browser tab preview
    const canvas16 = this.generator.getCanvas(16);
    if (canvas16) {
      this.elements.previewTabFavicon.innerHTML = '';
      const clone = document.createElement('canvas');
      clone.width = 16;
      clone.height = 16;
      clone.getContext('2d').drawImage(canvas16, 0, 0);
      this.elements.previewTabFavicon.appendChild(clone);

      // Also update bookmark
      this.elements.previewBookmarkFavicon.innerHTML = '';
      const bookmarkClone = clone.cloneNode();
      bookmarkClone.getContext('2d').drawImage(canvas16, 0, 0);
      this.elements.previewBookmarkFavicon.appendChild(bookmarkClone);
    }

    // Update mobile icon preview
    const canvas180 = this.generator.getCanvas(180);
    if (canvas180) {
      this.elements.previewMobileIcon.innerHTML = '';
      const clone = document.createElement('canvas');
      clone.width = 180;
      clone.height = 180;
      clone.style.width = '100%';
      clone.style.height = '100%';
      clone.getContext('2d').drawImage(canvas180, 0, 0);
      this.elements.previewMobileIcon.appendChild(clone);
    }
  }

  // ============================================
  // Export
  // ============================================

  showExportSection() {
    this.elements.exportSection.hidden = false;
    this.updateCodeBlocks();
    this.updateIndividualDownloads();
  }

  updateCodeBlocks() {
    this.elements.htmlCode.textContent = this.generator.generateHtmlCode();
    this.elements.manifestCode.textContent = this.generator.generateManifest();
  }

  updateIndividualDownloads() {
    this.elements.individualDownloads.innerHTML = '';

    for (const size of this.generator.sizes) {
      const btn = document.createElement('button');
      btn.className = 'btn btn--ghost btn--sm';
      btn.textContent = `${size}×${size}`;
      btn.addEventListener('click', () => this.downloadSingle(size));
      this.elements.individualDownloads.appendChild(btn);
    }

    // Add ICO download
    const icoBtn = document.createElement('button');
    icoBtn.className = 'btn btn--ghost btn--sm';
    icoBtn.textContent = 'favicon.ico';
    icoBtn.addEventListener('click', () => this.downloadIco());
    this.elements.individualDownloads.appendChild(icoBtn);
  }

  async downloadSingle(size) {
    try {
      const blob = await this.generator.exportAsPng(size);
      const filename = this.generator.getFileName(size);
      this.downloadBlob(blob, filename);
      this.showToast(`Downloaded ${filename}`, 'success');
    } catch (error) {
      this.showToast(`Download failed: ${error.message}`, 'error');
    }
  }

  async downloadIco() {
    try {
      const blob = await IcoEncoder.createFromCanvasMap(this.generator.getAllCanvases());
      this.downloadBlob(blob, 'favicon.ico');
      this.showToast('Downloaded favicon.ico', 'success');
    } catch (error) {
      this.showToast(`Download failed: ${error.message}`, 'error');
    }
  }

  async downloadZip() {
    if (!this.hasGenerated) {
      this.showToast('Please generate a favicon first', 'error');
      return;
    }

    this.showLoading('Creating ZIP package...');

    try {
      // We'll use JSZip-like functionality with native APIs
      const files = [];

      // Add PNG files
      for (const size of this.generator.sizes) {
        const blob = await this.generator.exportAsPng(size);
        const filename = this.generator.getFileName(size);
        files.push({ name: filename, blob });
      }

      // Add ICO file
      const icoBlob = await IcoEncoder.createFromCanvasMap(this.generator.getAllCanvases());
      files.push({ name: 'favicon.ico', blob: icoBlob });

      // Add manifest
      const manifestBlob = new Blob([this.generator.generateManifest()], { type: 'application/json' });
      files.push({ name: 'site.webmanifest', blob: manifestBlob });

      // Add HTML snippet
      const htmlBlob = new Blob([this.generator.generateHtmlCode()], { type: 'text/html' });
      files.push({ name: 'favicon-html.txt', blob: htmlBlob });

      // Create ZIP
      const zipBlob = await this.createZip(files);
      this.downloadBlob(zipBlob, 'favicons.zip');

      this.showToast('Downloaded favicons.zip', 'success');

    } catch (error) {
      console.error('ZIP creation error:', error);
      this.showToast(`ZIP creation failed: ${error.message}`, 'error');
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Create a ZIP file using the simple ZIP format
   * @param {Array<{name: string, blob: Blob}>} files
   * @returns {Promise<Blob>}
   */
  async createZip(files) {
    const encoder = new TextEncoder();
    const chunks = [];
    const centralDirectory = [];
    let offset = 0;

    for (const file of files) {
      const data = new Uint8Array(await file.blob.arrayBuffer());
      const nameBytes = encoder.encode(file.name);
      const crc = this.crc32(data);

      // Local file header
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const localView = new DataView(localHeader);

      localView.setUint32(0, 0x04034b50, true);  // Signature
      localView.setUint16(4, 20, true);          // Version needed
      localView.setUint16(6, 0, true);           // Flags
      localView.setUint16(8, 0, true);           // Compression (none)
      localView.setUint16(10, 0, true);          // Mod time
      localView.setUint16(12, 0, true);          // Mod date
      localView.setUint32(14, crc, true);        // CRC32
      localView.setUint32(18, data.length, true); // Compressed size
      localView.setUint32(22, data.length, true); // Uncompressed size
      localView.setUint16(26, nameBytes.length, true); // Filename length
      localView.setUint16(28, 0, true);          // Extra field length

      // Copy filename
      new Uint8Array(localHeader, 30).set(nameBytes);

      chunks.push(new Uint8Array(localHeader));
      chunks.push(data);

      // Central directory entry
      const cdEntry = new ArrayBuffer(46 + nameBytes.length);
      const cdView = new DataView(cdEntry);

      cdView.setUint32(0, 0x02014b50, true);     // Signature
      cdView.setUint16(4, 20, true);             // Version made by
      cdView.setUint16(6, 20, true);             // Version needed
      cdView.setUint16(8, 0, true);              // Flags
      cdView.setUint16(10, 0, true);             // Compression
      cdView.setUint16(12, 0, true);             // Mod time
      cdView.setUint16(14, 0, true);             // Mod date
      cdView.setUint32(16, crc, true);           // CRC32
      cdView.setUint32(20, data.length, true);   // Compressed size
      cdView.setUint32(24, data.length, true);   // Uncompressed size
      cdView.setUint16(28, nameBytes.length, true); // Filename length
      cdView.setUint16(30, 0, true);             // Extra field length
      cdView.setUint16(32, 0, true);             // Comment length
      cdView.setUint16(34, 0, true);             // Disk number start
      cdView.setUint16(36, 0, true);             // Internal attributes
      cdView.setUint32(38, 0, true);             // External attributes
      cdView.setUint32(42, offset, true);        // Relative offset

      new Uint8Array(cdEntry, 46).set(nameBytes);
      centralDirectory.push(new Uint8Array(cdEntry));

      offset += 30 + nameBytes.length + data.length;
    }

    // Add central directory
    const cdOffset = offset;
    let cdSize = 0;
    for (const entry of centralDirectory) {
      chunks.push(entry);
      cdSize += entry.length;
    }

    // End of central directory
    const eocd = new ArrayBuffer(22);
    const eocdView = new DataView(eocd);

    eocdView.setUint32(0, 0x06054b50, true);        // Signature
    eocdView.setUint16(4, 0, true);                 // Disk number
    eocdView.setUint16(6, 0, true);                 // CD disk number
    eocdView.setUint16(8, files.length, true);      // Entries on this disk
    eocdView.setUint16(10, files.length, true);     // Total entries
    eocdView.setUint32(12, cdSize, true);           // CD size
    eocdView.setUint32(16, cdOffset, true);         // CD offset
    eocdView.setUint16(20, 0, true);                // Comment length

    chunks.push(new Uint8Array(eocd));

    return new Blob(chunks, { type: 'application/zip' });
  }

  /**
   * Calculate CRC32 checksum
   */
  crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = this.getCrc32Table();

    for (let i = 0; i < data.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xFF];
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  getCrc32Table() {
    if (!this._crc32Table) {
      this._crc32Table = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        this._crc32Table[i] = c;
      }
    }
    return this._crc32Table;
  }

  downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  copyCode(targetId) {
    const element = document.getElementById(targetId);
    const text = element.textContent;

    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Copied to clipboard!', 'success');
    }).catch(() => {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.showToast('Copied to clipboard!', 'success');
    });
  }

  // ============================================
  // UI Helpers
  // ============================================

  showLoading(message = 'Loading...') {
    this.elements.loadingText.textContent = message;
    this.elements.loadingOverlay.hidden = false;
  }

  hideLoading() {
    this.elements.loadingOverlay.hidden = true;
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    this.elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.faviconApp = new FaviconApp();
});
