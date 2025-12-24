/**
 * Beat Pad Scene System
 *
 * Manages a 4×4 grid of scene slots for saving/loading complete visualization states.
 * Each pad stores a snapshot of theme, controls, and audio reactivity settings.
 */

class BeatPad {
  constructor(soundscape, controlSystem) {
    this.soundscape = soundscape;
    this.controlSystem = controlSystem;
    this.scenes = new Array(16).fill(null); // 16 pads (4×4 grid)
    this.activePadIndex = null;
    this.gridContainer = null;

    this.init();
  }

  /**
   * Initialize the beat pad system
   */
  init() {
    this.loadScenesFromStorage();
    this.createGridUI();
    this.attachEventListeners();
    this.setupKeyboardShortcuts();
  }

  /**
   * Create the 4×4 grid UI
   */
  createGridUI() {
    // Create container
    this.gridContainer = document.createElement('div');
    this.gridContainer.id = 'beat-pad-grid';
    this.gridContainer.className = 'beat-pad-container';

    // Create header
    const header = document.createElement('div');
    header.className = 'beat-pad-header';
    header.innerHTML = `
      <h3>BEAT PAD</h3>
      <div class="beat-pad-actions">
        <button class="beat-pad-btn" id="beat-pad-save-current" title="Save current state to selected pad">SAVE</button>
        <button class="beat-pad-btn" id="beat-pad-export" title="Export all scenes as JSON">EXPORT</button>
        <button class="beat-pad-btn" id="beat-pad-import" title="Import scenes from JSON">IMPORT</button>
        <button class="beat-pad-btn" id="beat-pad-clear-all" title="Clear all scenes">CLEAR ALL</button>
      </div>
    `;
    this.gridContainer.appendChild(header);

    // Add hidden file input for import
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.id = 'beat-pad-file-input';
    this.gridContainer.appendChild(fileInput);

    // Create grid (4×4 = 16 pads)
    const grid = document.createElement('div');
    grid.className = 'beat-pad-grid';

    // Keyboard hints for each pad
    const keyHints = ['1', '2', '3', '4', 'Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'];

    for (let i = 0; i < 16; i++) {
      const pad = document.createElement('div');
      pad.className = 'beat-pad';
      pad.dataset.index = i;

      const padKeyHint = document.createElement('div');
      padKeyHint.className = 'beat-pad-key';
      padKeyHint.textContent = keyHints[i];

      const padNumber = document.createElement('div');
      padNumber.className = 'beat-pad-number';
      padNumber.textContent = i + 1;

      const padLabel = document.createElement('div');
      padLabel.className = 'beat-pad-label';
      padLabel.textContent = 'EMPTY';

      pad.appendChild(padKeyHint);
      pad.appendChild(padNumber);
      pad.appendChild(padLabel);
      grid.appendChild(pad);
    }

    this.gridContainer.appendChild(grid);

    // Add to page (insert before controls panel)
    const controlsPanel = document.querySelector('.controls-panel');
    if (controlsPanel) {
      controlsPanel.parentNode.insertBefore(this.gridContainer, controlsPanel);
    } else {
      document.body.appendChild(this.gridContainer);
    }

    this.updateGridUI();
  }

  /**
   * Attach event listeners to UI elements
   */
  attachEventListeners() {
    const grid = this.gridContainer.querySelector('.beat-pad-grid');

    // Pad clicks - load scene
    grid.addEventListener('click', (e) => {
      const pad = e.target.closest('.beat-pad');
      if (!pad) return;

      const index = parseInt(pad.dataset.index);
      this.loadScene(index);
    });

    // Pad right-click - context menu
    grid.addEventListener('contextmenu', (e) => {
      const pad = e.target.closest('.beat-pad');
      if (!pad) return;

      e.preventDefault();
      const index = parseInt(pad.dataset.index);
      this.showContextMenu(index, e.clientX, e.clientY);
    });

    // Save current button
    const saveBtn = document.getElementById('beat-pad-save-current');
    saveBtn.addEventListener('click', () => {
      if (this.activePadIndex !== null) {
        this.saveCurrentScene(this.activePadIndex);
      } else {
        // Find first empty slot
        const emptyIndex = this.scenes.findIndex(s => s === null);
        if (emptyIndex !== -1) {
          this.saveCurrentScene(emptyIndex);
          this.activePadIndex = emptyIndex;
        } else {
          alert('All pads are full. Right-click a pad to clear it first.');
        }
      }
    });

    // Clear all button
    const clearAllBtn = document.getElementById('beat-pad-clear-all');
    clearAllBtn.addEventListener('click', () => {
      if (confirm('Clear all scenes? This cannot be undone.')) {
        this.clearAllScenes();
      }
    });

    // Export button
    const exportBtn = document.getElementById('beat-pad-export');
    exportBtn.addEventListener('click', () => {
      this.exportScenes();
    });

    // Import button
    const importBtn = document.getElementById('beat-pad-import');
    const fileInput = document.getElementById('beat-pad-file-input');

    importBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.importScenes(file);
        fileInput.value = ''; // Reset input
      }
    });
  }

  /**
   * Setup keyboard shortcuts for pad triggering
   */
  setupKeyboardShortcuts() {
    // Keyboard layout mapping (4×4 grid):
    // Row 1: 1, 2, 3, 4 -> pads 0-3
    // Row 2: Q, W, E, R -> pads 4-7
    // Row 3: A, S, D, F -> pads 8-11
    // Row 4: Z, X, C, V -> pads 12-15
    const keyMap = {
      '1': 0, '2': 1, '3': 2, '4': 3,
      'q': 4, 'w': 5, 'e': 6, 'r': 7,
      'a': 8, 's': 9, 'd': 10, 'f': 11,
      'z': 12, 'x': 13, 'c': 14, 'v': 15
    };

    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();
      const padIndex = keyMap[key];

      if (padIndex !== undefined) {
        e.preventDefault();

        // Shift + key = save to pad
        if (e.shiftKey) {
          this.saveCurrentScene(padIndex);
          this.activePadIndex = padIndex;
        }
        // Just key = load scene
        else {
          this.loadScene(padIndex);
        }
      }
    });

    console.log('⌨️ Keyboard shortcuts enabled (1-4, QWER, ASDF, ZXCV to load, Shift+key to save)');
  }

  /**
   * Capture current visualization state as a scene
   */
  getCurrentScene() {
    const scene = {
      version: '1.0',
      timestamp: Date.now(),
      name: `Scene ${new Date().toLocaleTimeString()}`,
      theme: this.soundscape.currentTheme,
      settings: {}
    };

    // Capture all control values from control system
    const registry = window.CONTROL_REGISTRY || {};
    for (const [controlId, config] of Object.entries(registry)) {
      // Get current value from soundscape
      const currentValue = this.getCurrentControlValue(controlId, config);
      if (currentValue !== undefined) {
        scene.settings[controlId] = currentValue;
      }
    }

    // Capture audio reactivity settings
    if (this.controlSystem && this.controlSystem.audioReactivity) {
      scene.audioReactivity = { ...this.controlSystem.audioReactivity };
    }

    return scene;
  }

  /**
   * Get current value for a control
   */
  getCurrentControlValue(controlId, config) {
    // Try to get from theme config first
    if (this.soundscape.themeConfig && this.soundscape.themeConfig[controlId] !== undefined) {
      return this.soundscape.themeConfig[controlId];
    }

    // Try to get from soundscape properties
    if (this.soundscape[controlId] !== undefined) {
      return this.soundscape[controlId];
    }

    // Use default from config
    return config.default;
  }

  /**
   * Save current state to a pad
   */
  saveCurrentScene(index) {
    if (index < 0 || index >= 16) return;

    const scene = this.getCurrentScene();
    this.scenes[index] = scene;
    this.activePadIndex = index;

    this.saveScenestoStorage();
    this.updateGridUI();

    console.log(`Scene saved to pad ${index + 1}:`, scene);
  }

  /**
   * Load a scene from a pad
   */
  loadScene(index, transitionType = 'CUT') {
    if (index < 0 || index >= 16) return;

    const scene = this.scenes[index];
    if (!scene) {
      console.log(`Pad ${index + 1} is empty`);
      return;
    }

    console.log(`Loading scene from pad ${index + 1}:`, scene);

    // For now, use instant transition (CUT)
    // TODO: Implement CROSSFADE, MORPH, WIPE transitions in Phase 3
    this.applySceneInstant(scene);

    this.activePadIndex = index;
    this.updateGridUI();
  }

  /**
   * Apply scene with instant transition (CUT)
   */
  applySceneInstant(scene) {
    // Switch theme if different
    if (scene.theme !== this.soundscape.currentTheme) {
      this.soundscape.switchTheme(scene.theme);
    }

    // Apply all control values
    for (const [controlId, value] of Object.entries(scene.settings)) {
      this.applyControlValue(controlId, value);
    }

    // Apply audio reactivity settings
    if (scene.audioReactivity && this.controlSystem) {
      this.controlSystem.audioReactivity = { ...scene.audioReactivity };
    }

    // Update all UI controls to reflect new values
    if (this.controlSystem) {
      this.controlSystem.refreshAllControls();
    }
  }

  /**
   * Apply a single control value
   */
  applyControlValue(controlId, value) {
    // Set on theme config
    if (this.soundscape.themeConfig) {
      this.soundscape.themeConfig[controlId] = value;
    }

    // Set on soundscape if property exists
    if (this.soundscape.hasOwnProperty(controlId)) {
      this.soundscape[controlId] = value;
    }
  }

  /**
   * Update grid UI to reflect current state
   */
  updateGridUI() {
    const pads = this.gridContainer.querySelectorAll('.beat-pad');

    pads.forEach((pad, index) => {
      const scene = this.scenes[index];
      const label = pad.querySelector('.beat-pad-label');

      // Remove all state classes
      pad.classList.remove('empty', 'loaded', 'active');

      if (scene) {
        // Pad has a scene
        pad.classList.add('loaded');
        label.textContent = scene.name || `Scene ${index + 1}`;

        if (index === this.activePadIndex) {
          pad.classList.add('active');
        }
      } else {
        // Pad is empty
        pad.classList.add('empty');
        label.textContent = 'EMPTY';
      }
    });
  }

  /**
   * Show context menu for a pad
   */
  showContextMenu(index, x, y) {
    // Remove existing context menu
    const existing = document.querySelector('.beat-pad-context-menu');
    if (existing) existing.remove();

    const scene = this.scenes[index];
    const menu = document.createElement('div');
    menu.className = 'beat-pad-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const items = [];

    if (scene) {
      items.push({ label: 'Load', action: () => this.loadScene(index) });
      items.push({ label: 'Rename', action: () => this.renameScene(index) });
      items.push({ label: 'Save Over', action: () => this.saveCurrentScene(index) });
      items.push({ label: 'Clear', action: () => this.clearScene(index) });
    } else {
      items.push({ label: 'Save Here', action: () => this.saveCurrentScene(index) });
    }

    items.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'beat-pad-context-item';
      menuItem.textContent = item.label;
      menuItem.addEventListener('click', () => {
        item.action();
        menu.remove();
      });
      menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);

    // Close menu on click outside
    const closeMenu = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  /**
   * Rename a scene
   */
  renameScene(index) {
    const scene = this.scenes[index];
    if (!scene) return;

    const newName = prompt('Enter scene name:', scene.name);
    if (newName && newName.trim()) {
      scene.name = newName.trim();
      this.saveScenestoStorage();
      this.updateGridUI();
    }
  }

  /**
   * Clear a specific scene
   */
  clearScene(index) {
    if (index < 0 || index >= 16) return;

    this.scenes[index] = null;
    if (this.activePadIndex === index) {
      this.activePadIndex = null;
    }

    this.saveScenestoStorage();
    this.updateGridUI();
  }

  /**
   * Clear all scenes
   */
  clearAllScenes() {
    this.scenes = new Array(16).fill(null);
    this.activePadIndex = null;
    this.saveScenestoStorage();
    this.updateGridUI();
  }

  /**
   * Save scenes to localStorage
   */
  saveScenestoStorage() {
    try {
      const data = {
        scenes: this.scenes,
        activePadIndex: this.activePadIndex,
        timestamp: Date.now()
      };
      localStorage.setItem('beatPadScenes', JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save scenes to localStorage:', e);
    }
  }

  /**
   * Load scenes from localStorage
   */
  loadScenesFromStorage() {
    try {
      const stored = localStorage.getItem('beatPadScenes');
      if (stored) {
        const data = JSON.parse(stored);
        this.scenes = data.scenes || new Array(16).fill(null);
        this.activePadIndex = data.activePadIndex || null;
      }
    } catch (e) {
      console.error('Failed to load scenes from localStorage:', e);
      this.scenes = new Array(16).fill(null);
    }
  }

  /**
   * Export all scenes as JSON
   */
  exportScenes() {
    const data = {
      version: '1.0',
      exported: Date.now(),
      scenes: this.scenes
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beatpad-scenes-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Import scenes from JSON
   */
  importScenes(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.scenes && Array.isArray(data.scenes)) {
          this.scenes = data.scenes;
          this.activePadIndex = null;
          this.saveScenestoStorage();
          this.updateGridUI();
          console.log('Scenes imported successfully');
        }
      } catch (err) {
        console.error('Failed to import scenes:', err);
        alert('Failed to import scenes. Please check the file format.');
      }
    };
    reader.readAsText(file);
  }
}

// Export for use in main application
window.BeatPad = BeatPad;
