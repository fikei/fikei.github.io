// =====================================================
// MULTI-LAYER COMPOSITING SYSTEM
// =====================================================
// Manages multiple visualization layers with blend modes,
// opacity control, and A/B crossfading for VJ performance

class LayerManager {
  constructor(outputCanvas) {
    this.outputCanvas = outputCanvas;
    this.outputCtx = outputCanvas.getContext('2d');

    // Layer configuration
    this.maxLayers = 4;
    this.layers = [];
    this.layerCanvases = [];

    // Crossfader state
    this.crossfaderPosition = 0.0; // 0 = A (Layer 0), 1 = B (Layer 1)
    this.crossfaderMode = 'layers'; // 'layers' or 'presets'

    // Initialize with 2 default layers
    this.initializeLayers();

    console.log('🎬 LayerManager initialized');
  }

  /**
   * Initialize layer structure
   */
  initializeLayers() {
    // Create 2 default layers to start
    for (let i = 0; i < 2; i++) {
      this.addLayer({
        theme: i === 0 ? 'linear' : 'neon',
        opacity: i === 0 ? 1.0 : 0.0,
        blendMode: 'normal',
        visible: true,
        solo: false,
        locked: false
      });
    }
  }

  /**
   * Add a new layer
   */
  addLayer(config = {}) {
    if (this.layers.length >= this.maxLayers) {
      console.warn(`⚠️ Maximum ${this.maxLayers} layers reached`);
      return null;
    }

    const layerId = this.layers.length;

    // Create layer configuration
    const layer = {
      id: layerId,
      theme: config.theme || 'linear',
      opacity: config.opacity !== undefined ? config.opacity : 1.0,
      blendMode: config.blendMode || 'normal',
      visible: config.visible !== undefined ? config.visible : true,
      solo: config.solo || false,
      locked: config.locked || false,
      preset: null // Current preset/scene for this layer
    };

    // Create dedicated canvas for this layer
    const canvas = document.createElement('canvas');
    canvas.width = this.outputCanvas.width;
    canvas.height = this.outputCanvas.height;

    this.layers.push(layer);
    this.layerCanvases.push(canvas);

    console.log(`✅ Added layer ${layerId}:`, layer);
    return layer;
  }

  /**
   * Remove a layer
   */
  removeLayer(layerId) {
    if (this.layers.length <= 1) {
      console.warn('⚠️ Cannot remove last layer');
      return false;
    }

    if (layerId < 0 || layerId >= this.layers.length) {
      console.warn(`⚠️ Invalid layer ID: ${layerId}`);
      return false;
    }

    this.layers.splice(layerId, 1);
    this.layerCanvases.splice(layerId, 1);

    // Re-index remaining layers
    this.layers.forEach((layer, i) => {
      layer.id = i;
    });

    console.log(`🗑️ Removed layer ${layerId}`);
    return true;
  }

  /**
   * Update layer property
   */
  updateLayer(layerId, property, value) {
    if (layerId < 0 || layerId >= this.layers.length) {
      console.warn(`⚠️ Invalid layer ID: ${layerId}`);
      return false;
    }

    const layer = this.layers[layerId];

    if (layer.locked && property !== 'locked') {
      console.warn(`🔒 Layer ${layerId} is locked`);
      return false;
    }

    layer[property] = value;
    console.log(`🎛️ Layer ${layerId}.${property} = ${value}`);
    return true;
  }

  /**
   * Set layer theme
   */
  setLayerTheme(layerId, themeName) {
    return this.updateLayer(layerId, 'theme', themeName);
  }

  /**
   * Set layer opacity (0-1)
   */
  setLayerOpacity(layerId, opacity) {
    opacity = Math.max(0, Math.min(1, opacity));
    return this.updateLayer(layerId, 'opacity', opacity);
  }

  /**
   * Set layer blend mode
   */
  setLayerBlendMode(layerId, blendMode) {
    const validBlendModes = [
      'normal', 'add', 'multiply', 'screen', 'overlay',
      'darken', 'lighten', 'color-dodge', 'color-burn',
      'hard-light', 'soft-light', 'difference', 'exclusion'
    ];

    if (!validBlendModes.includes(blendMode)) {
      console.warn(`⚠️ Invalid blend mode: ${blendMode}`);
      return false;
    }

    return this.updateLayer(layerId, 'blendMode', blendMode);
  }

  /**
   * Toggle layer visibility
   */
  toggleLayerVisibility(layerId) {
    const layer = this.layers[layerId];
    if (!layer) return false;

    layer.visible = !layer.visible;
    console.log(`👁️ Layer ${layerId} visibility: ${layer.visible}`);
    return true;
  }

  /**
   * Solo layer (show only this layer)
   */
  soloLayer(layerId) {
    const layer = this.layers[layerId];
    if (!layer) return false;

    // Toggle solo state
    layer.solo = !layer.solo;

    // If soloing, hide all other layers
    if (layer.solo) {
      this.layers.forEach((l, i) => {
        if (i !== layerId && !l.solo) {
          l.visible = false;
        }
      });
    } else {
      // If un-soloing and no other solos, show all layers
      const hasSolo = this.layers.some(l => l.solo);
      if (!hasSolo) {
        this.layers.forEach(l => {
          l.visible = true;
        });
      }
    }

    console.log(`🔊 Layer ${layerId} solo: ${layer.solo}`);
    return true;
  }

  /**
   * Get layer canvas for rendering
   */
  getLayerCanvas(layerId) {
    if (layerId < 0 || layerId >= this.layerCanvases.length) {
      console.warn(`⚠️ Invalid layer ID: ${layerId}`);
      return null;
    }
    return this.layerCanvases[layerId];
  }

  /**
   * Set crossfader position (0 = A/Layer 0, 1 = B/Layer 1)
   */
  setCrossfaderPosition(position) {
    this.crossfaderPosition = Math.max(0, Math.min(1, position));

    // Update layer opacities based on crossfader
    if (this.layers.length >= 2) {
      this.layers[0].opacity = 1 - this.crossfaderPosition;
      this.layers[1].opacity = this.crossfaderPosition;
    }

    console.log(`🎚️ Crossfader: ${(this.crossfaderPosition * 100).toFixed(1)}%`);
  }

  /**
   * Composite all layers to output canvas
   */
  composite() {
    // Clear output
    this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);

    // Render each visible layer
    this.layers.forEach((layer, i) => {
      if (!layer.visible || layer.opacity === 0) return;

      // Set blend mode
      this.outputCtx.globalCompositeOperation = this.getCanvasBlendMode(layer.blendMode);

      // Set opacity
      this.outputCtx.globalAlpha = layer.opacity;

      // Draw layer
      this.outputCtx.drawImage(this.layerCanvases[i], 0, 0);
    });

    // Reset context state
    this.outputCtx.globalAlpha = 1.0;
    this.outputCtx.globalCompositeOperation = 'source-over';
  }

  /**
   * Map blend mode names to Canvas composite operations
   */
  getCanvasBlendMode(blendMode) {
    const blendModeMap = {
      'normal': 'source-over',
      'add': 'lighter',
      'multiply': 'multiply',
      'screen': 'screen',
      'overlay': 'overlay',
      'darken': 'darken',
      'lighten': 'lighten',
      'color-dodge': 'color-dodge',
      'color-burn': 'color-burn',
      'hard-light': 'hard-light',
      'soft-light': 'soft-light',
      'difference': 'difference',
      'exclusion': 'exclusion'
    };

    return blendModeMap[blendMode] || 'source-over';
  }

  /**
   * Resize all layer canvases
   */
  resize(width, height) {
    this.outputCanvas.width = width;
    this.outputCanvas.height = height;

    this.layerCanvases.forEach(canvas => {
      canvas.width = width;
      canvas.height = height;
    });

    console.log(`📐 Layers resized to ${width}×${height}`);
  }

  /**
   * Get current state (for saving/restoring)
   */
  getState() {
    return {
      layers: this.layers.map(l => ({...l})),
      crossfaderPosition: this.crossfaderPosition,
      crossfaderMode: this.crossfaderMode
    };
  }

  /**
   * Restore state
   */
  setState(state) {
    if (!state || !state.layers) return false;

    // Clear existing layers
    this.layers = [];
    this.layerCanvases = [];

    // Restore layers
    state.layers.forEach(layerConfig => {
      this.addLayer(layerConfig);
    });

    this.crossfaderPosition = state.crossfaderPosition || 0.0;
    this.crossfaderMode = state.crossfaderMode || 'layers';

    console.log('🔄 Layer state restored:', state);
    return true;
  }
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LayerManager };
}
