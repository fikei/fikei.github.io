/**
 * Beat Pad Scene System
 *
 * Manages a 3×3 grid of scene slots for saving/loading complete visualization states.
 * Each pad stores a snapshot of theme, controls, and audio reactivity settings.
 */

class BeatPad {
  constructor(soundscape, controlSystem) {
    this.soundscape = soundscape;
    this.controlSystem = controlSystem;
    this.scenes = new Array(9).fill(null); // 9 pads (3×3 grid)
    this.activePadIndex = null;
    this.gridContainer = null;

    // Transition settings
    this.transitionType = 'CUT'; // CUT, CROSSFADE, MORPH, WIPE
    this.transitionDuration = 1000; // milliseconds
    this.isTransitioning = false;

    // Drag state
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };

    this.init();
  }

  /**
   * Initialize the beat pad system
   */
  init() {
    this.loadScenesFromStorage();
    this.createGridUI();
    this.setupToggleButton();
    this.setupDragging();
    this.attachEventListeners();
    this.setupKeyboardShortcuts();

    // Restore position from localStorage
    this.restorePosition();

    // Initially hide the beatpad
    this.gridContainer.classList.add('hidden');
  }

  /**
   * Create the 3×3 grid UI
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

    // Create transition controls
    const transitionControls = document.createElement('div');
    transitionControls.className = 'beat-pad-transition-controls';
    transitionControls.innerHTML = `
      <div class="beat-pad-control-row">
        <label class="beat-pad-control-label">TRANSITION</label>
        <select id="beat-pad-transition-type" class="beat-pad-select">
          <option value="CUT">CUT</option>
          <option value="CROSSFADE">CROSSFADE</option>
          <option value="MORPH">MORPH</option>
          <option value="WIPE">WIPE</option>
        </select>
      </div>
      <div class="beat-pad-control-row">
        <label class="beat-pad-control-label">DURATION</label>
        <input type="range" id="beat-pad-transition-duration" class="beat-pad-slider" min="100" max="5000" step="100" value="1000">
        <span id="beat-pad-duration-value" class="beat-pad-value">1.0s</span>
      </div>
    `;
    this.gridContainer.appendChild(transitionControls);

    // Add hidden file input for import
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    fileInput.id = 'beat-pad-file-input';
    this.gridContainer.appendChild(fileInput);

    // Create grid (3×3 = 9 pads)
    const grid = document.createElement('div');
    grid.className = 'beat-pad-grid';

    // Keyboard hints for each pad
    const keyHints = ['1', '2', '3', 'Q', 'W', 'E', 'A', 'S', 'D'];

    for (let i = 0; i < 9; i++) {
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
   * Setup toggle button for showing/hiding beat pad
   */
  setupToggleButton() {
    const toggleBtn = document.getElementById('beatpadToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.toggle();
      });
    }
  }

  /**
   * Toggle beat pad visibility
   */
  toggle() {
    const toggleBtn = document.getElementById('beatpadToggle');
    const isHidden = this.gridContainer.classList.contains('hidden');

    console.log('🔧 Toggle called. Current state:', { isHidden, gridContainer: this.gridContainer, toggleBtn });

    if (isHidden) {
      this.gridContainer.classList.remove('hidden');
      if (toggleBtn) toggleBtn.classList.add('active');
      console.log('✅ Beat Pad opened');
    } else {
      this.gridContainer.classList.add('hidden');
      if (toggleBtn) toggleBtn.classList.remove('active');
      console.log('❌ Beat Pad closed');
    }
  }

  /**
   * Setup dragging functionality
   */
  setupDragging() {
    const header = this.gridContainer.querySelector('.beat-pad-header');
    if (!header) {
      console.warn('⚠️ Beat Pad header not found for dragging');
      return;
    }

    // Make the header (but not buttons) draggable
    header.style.cursor = 'grab';
    header.style.userSelect = 'none';

    const startDrag = (e) => {
      // Don't drag if clicking on buttons or inputs
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') {
        return;
      }

      this.isDragging = true;
      header.style.cursor = 'grabbing';
      document.body.style.cursor = 'grabbing';

      const rect = this.gridContainer.getBoundingClientRect();
      const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

      this.dragOffset.x = clientX - rect.left;
      this.dragOffset.y = clientY - rect.top;

      console.log('🎯 Drag started', { x: clientX, y: clientY, offset: this.dragOffset });

      e.preventDefault();
      e.stopPropagation();
    };

    const drag = (e) => {
      if (!this.isDragging) return;

      const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

      const newLeft = clientX - this.dragOffset.x;
      const newTop = clientY - this.dragOffset.y;

      // Keep within viewport bounds
      const maxLeft = window.innerWidth - this.gridContainer.offsetWidth;
      const maxTop = window.innerHeight - this.gridContainer.offsetHeight;

      const boundedLeft = Math.max(0, Math.min(newLeft, maxLeft));
      const boundedTop = Math.max(0, Math.min(newTop, maxTop));

      this.gridContainer.style.left = `${boundedLeft}px`;
      this.gridContainer.style.top = `${boundedTop}px`;
      this.gridContainer.style.right = 'auto';

      e.preventDefault();
    };

    const endDrag = () => {
      if (this.isDragging) {
        this.isDragging = false;
        header.style.cursor = 'grab';
        document.body.style.cursor = '';
        this.savePosition();
        console.log('🎯 Drag ended', { left: this.gridContainer.style.left, top: this.gridContainer.style.top });
      }
    };

    // Attach to header, not just h3
    header.addEventListener('mousedown', startDrag);
    header.addEventListener('touchstart', startDrag, { passive: false });
    document.addEventListener('mousemove', drag);
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);

    console.log('✅ Beat Pad drag handlers attached to header');
  }

  /**
   * Save position to localStorage
   */
  savePosition() {
    const position = {
      left: this.gridContainer.style.left,
      top: this.gridContainer.style.top
    };
    localStorage.setItem('beatpad-position', JSON.stringify(position));
  }

  /**
   * Restore position from localStorage
   */
  restorePosition() {
    const saved = localStorage.getItem('beatpad-position');
    if (saved) {
      try {
        const position = JSON.parse(saved);
        if (position.left && position.top) {
          this.gridContainer.style.left = position.left;
          this.gridContainer.style.top = position.top;
          this.gridContainer.style.right = 'auto';
        }
      } catch (err) {
        console.warn('Failed to restore Beat Pad position:', err);
      }
    }
  }

  /**
   * Attach event listeners to UI elements
   */
  attachEventListeners() {
    const grid = this.gridContainer.querySelector('.beat-pad-grid');

    // Pad clicks - save if empty, load if filled
    grid.addEventListener('click', (e) => {
      const pad = e.target.closest('.beat-pad');
      if (!pad) return;

      const index = parseInt(pad.dataset.index);
      const scene = this.scenes[index];

      console.log(`🎯 Pad ${index + 1} clicked:`, {
        hasScene: !!scene,
        sceneName: scene?.name,
        totalScenes: this.scenes.length,
        sceneData: scene ? 'Scene exists' : 'Empty pad'
      });

      // If pad is empty, save current scene
      if (!scene) {
        console.log(`💾 Pad ${index + 1} is empty, saving current scene`);
        this.saveCurrentScene(index);
        this.activePadIndex = index;
      } else {
        // If pad has a scene, load it
        console.log(`▶️ Pad ${index + 1} has scene "${scene.name}", loading it`);
        this.loadScene(index);
      }
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
    console.log('🔍 Clear All button element:', clearAllBtn ? 'FOUND' : 'NOT FOUND');

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        console.log('🗑️ Clear All button clicked - showing custom confirmation...');
        this.showClearAllConfirmation();
      });
      console.log('✅ Clear All button event listener attached');
    } else {
      console.error('⚠️ Clear All button not found!');
    }

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

    // Transition type selector
    const transitionTypeSelect = document.getElementById('beat-pad-transition-type');
    transitionTypeSelect.addEventListener('change', (e) => {
      this.transitionType = e.target.value;
      console.log(`Transition type: ${this.transitionType}`);
    });

    // Transition duration slider
    const durationSlider = document.getElementById('beat-pad-transition-duration');
    const durationValue = document.getElementById('beat-pad-duration-value');

    durationSlider.addEventListener('input', (e) => {
      this.transitionDuration = parseInt(e.target.value);
      durationValue.textContent = `${(this.transitionDuration / 1000).toFixed(1)}s`;
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

      // Shift+B = Toggle Beat Pad
      if (e.shiftKey && key === 'b') {
        e.preventDefault();
        this.toggle();
        return;
      }

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

    console.log('⌨️ Keyboard shortcuts enabled (Shift+B to toggle, 1-4/QWER/ASDF/ZXCV to load, Shift+key to save)');
  }

  /**
   * Capture current visualization state as a scene
   */
  getCurrentScene() {
    const currentTheme = this.soundscape.currentTheme;

    const scene = {
      version: '1.0',
      timestamp: Date.now(),
      name: `Scene ${new Date().toLocaleTimeString()}`,
      theme: currentTheme,
      settings: {},
      audioReactivity: {}
    };

    console.log(`📸 Capturing scene for theme: ${currentTheme}`);

    // Capture control settings from window.state.settings
    if (window.state && window.state.settings && window.state.settings[currentTheme]) {
      // Deep copy all theme-specific settings
      scene.settings = JSON.parse(JSON.stringify(window.state.settings[currentTheme]));
      console.log(`📸 Captured ${Object.keys(scene.settings).length} control settings from window.state.settings.${currentTheme}`);
    } else {
      console.warn(`⚠️ No settings found in window.state.settings.${currentTheme}`);
    }

    // Capture audio reactivity settings from window.state.audioReactivity
    if (window.state && window.state.audioReactivity && window.state.audioReactivity[currentTheme]) {
      // Deep copy all audio reactivity settings
      scene.audioReactivity = JSON.parse(JSON.stringify(window.state.audioReactivity[currentTheme]));
      console.log(`📸 Captured audio reactivity for ${Object.keys(scene.audioReactivity).length} controls`);
    } else {
      console.warn(`⚠️ No audio reactivity found in window.state.audioReactivity.${currentTheme}`);
    }

    console.log('📸 Scene capture complete:', {
      theme: scene.theme,
      settingsCount: Object.keys(scene.settings).length,
      audioReactivityCount: Object.keys(scene.audioReactivity).length
    });

    return scene;
  }

  /**
   * Save current state to a pad
   */
  saveCurrentScene(index) {
    if (index < 0 || index >= 9) return;

    const scene = this.getCurrentScene();
    console.log(`💾 saveCurrentScene(${index}):`, {
      theme: scene.theme,
      settingsCount: Object.keys(scene.settings).length,
      name: scene.name
    });

    this.scenes[index] = scene;
    this.activePadIndex = index;

    this.saveScenestoStorage();
    this.updateGridUI();

    console.log(`✅ Scene saved to pad ${index + 1}:`, scene.name);
  }

  /**
   * Load a scene from a pad
   */
  loadScene(index) {
    if (index < 0 || index >= 9) return;
    if (this.isTransitioning) {
      console.log('⏸️ Transition in progress, please wait');
      return;
    }

    const scene = this.scenes[index];
    if (!scene) {
      console.log(`⚠️ Pad ${index + 1} is empty, cannot load`);
      return;
    }

    console.log(`▶️ loadScene(${index}): "${scene.name}" with ${this.transitionType} transition (${this.transitionDuration}ms)`, {
      theme: scene.theme,
      settingsCount: Object.keys(scene.settings).length
    });

    // Check for quantization (if BeatSync is available)
    if (window.state && window.state.beatSync) {
      const timestamp = performance.now();
      const shouldTrigger = window.state.beatSync.shouldTrigger(timestamp);

      if (!shouldTrigger) {
        const timeUntilNext = window.state.beatSync.getTimeUntilNextTrigger();
        const quantizeMode = window.state.beatSync.quantizeMode;
        console.log(`⏱️ Quantize (${quantizeMode}): Waiting ${Math.round(timeUntilNext)}ms until next trigger`);

        // Queue the scene load for the next beat
        setTimeout(() => this.loadScene(index), timeUntilNext);
        return;
      }
    }

    // Apply scene with selected transition type
    switch (this.transitionType) {
      case 'CUT':
        this.applySceneInstant(scene);
        this.activePadIndex = index;
        this.updateGridUI();
        break;

      case 'CROSSFADE':
        this.applySceneCrossfade(scene, index);
        break;

      case 'MORPH':
        this.applySceneMorph(scene, index);
        break;

      case 'WIPE':
        this.applySceneWipe(scene, index);
        break;

      default:
        this.applySceneInstant(scene);
        this.activePadIndex = index;
        this.updateGridUI();
    }
  }

  /**
   * Apply scene with instant transition (CUT)
   */
  applySceneInstant(scene) {
    console.log('🎬 Applying scene:', scene);

    // Check if scene has control settings
    const settingsCount = Object.keys(scene.settings || {}).length;
    console.log(`📊 Scene has ${settingsCount} control settings to apply`);

    if (settingsCount === 0) {
      console.warn('⚠️ WARNING: Scene has NO control settings! This scene was saved before the fix.');
      console.warn('⚠️ To fix: Re-save this scene by adjusting controls and clicking the pad again.');
    }

    // Switch theme if different
    if (scene.theme !== this.soundscape.currentTheme) {
      console.log(`🎨 Switching theme from ${this.soundscape.currentTheme} to ${scene.theme}`);
      this.soundscape.switchTheme(scene.theme);
    }

    // Apply all control values
    console.log('🎛️ Applying control values:', scene.settings);
    console.log('🎛️ Control values detail:', Object.entries(scene.settings || {}).map(([k, v]) => `${k}=${v}`).join(', '));
    for (const [controlId, value] of Object.entries(scene.settings)) {
      console.log(`  Setting ${controlId} = ${value}`);
      this.applyControlValue(controlId, value);
    }

    // Apply audio reactivity settings to window.state
    if (scene.audioReactivity) {
      if (!window.state.audioReactivity) {
        window.state.audioReactivity = {};
      }
      window.state.audioReactivity[scene.theme] = JSON.parse(JSON.stringify(scene.audioReactivity));
      console.log(`🎵 Restored audio reactivity for ${Object.keys(scene.audioReactivity).length} controls`);
    }

    // Update all UI controls to reflect new values
    if (this.controlSystem) {
      console.log('🔄 Refreshing all controls UI');
      this.controlSystem.refreshAllControls();
    }
  }

  /**
   * Apply a single control value
   */
  applyControlValue(controlId, value) {
    // Use the soundscape API to set control value
    if (this.soundscape.setControlValue) {
      console.log(`    → Calling soundscape.setControlValue("${controlId}", ${value})`);
      this.soundscape.setControlValue(controlId, value);
    } else {
      console.warn(`    ⚠️ soundscape.setControlValue not available for ${controlId}`);
    }
  }

  /**
   * Apply scene with CROSSFADE transition (opacity blend)
   */
  applySceneCrossfade(scene, index) {
    this.isTransitioning = true;

    const container = document.getElementById('visualization-container');
    const startTime = Date.now();
    const duration = this.transitionDuration;

    // Apply scene immediately (instant switch)
    this.applySceneInstant(scene);

    // Animate opacity fade
    let lastOpacity = 0;
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-in-out
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Apply opacity to container
      const opacity = 0.3 + (eased * 0.7); // Fade from 30% to 100%
      if (opacity !== lastOpacity) {
        container.style.opacity = opacity;
        lastOpacity = opacity;
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        container.style.opacity = 1;
        this.isTransitioning = false;
        this.activePadIndex = index;
        this.updateGridUI();
      }
    };

    animate();
  }

  /**
   * Apply scene with MORPH transition (parameter interpolation)
   */
  applySceneMorph(scene, index) {
    this.isTransitioning = true;

    // Capture starting values
    const startValues = {};
    for (const controlId in scene.settings) {
      startValues[controlId] = this.soundscape.themeConfig?.[controlId]
        || this.soundscape[controlId];
    }

    // Switch theme if different (instant for now)
    if (scene.theme !== this.soundscape.currentTheme) {
      this.soundscape.switchTheme(scene.theme);
    }

    const startTime = Date.now();
    const duration = this.transitionDuration;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-in-out
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Interpolate all control values
      for (const [controlId, endValue] of Object.entries(scene.settings)) {
        const startValue = startValues[controlId];
        if (typeof startValue === 'number' && typeof endValue === 'number') {
          const currentValue = startValue + (endValue - startValue) * eased;
          this.applyControlValue(controlId, currentValue);
        }
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Apply final values
        for (const [controlId, value] of Object.entries(scene.settings)) {
          this.applyControlValue(controlId, value);
        }

        // Apply audio reactivity
        if (scene.audioReactivity && this.controlSystem) {
          this.controlSystem.audioReactivity = { ...scene.audioReactivity };
        }

        if (this.controlSystem) {
          this.controlSystem.refreshAllControls();
        }

        this.isTransitioning = false;
        this.activePadIndex = index;
        this.updateGridUI();
      }
    };

    animate();
  }

  /**
   * Apply scene with WIPE transition (directional reveal)
   */
  applySceneWipe(scene, index) {
    this.isTransitioning = true;

    const container = document.getElementById('visualization-container');
    const startTime = Date.now();
    const duration = this.transitionDuration;

    // Apply scene immediately
    this.applySceneInstant(scene);

    // Animate clip-path wipe from left to right
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-in-out
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Wipe from left (0%) to right (100%)
      const wipePercent = eased * 100;
      container.style.clipPath = `inset(0 ${100 - wipePercent}% 0 0)`;

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        container.style.clipPath = '';
        this.isTransitioning = false;
        this.activePadIndex = index;
        this.updateGridUI();
      }
    };

    animate();
  }

  /**
   * Update grid UI to reflect current state
   */
  updateGridUI() {
    const pads = this.gridContainer.querySelectorAll('.beat-pad');
    console.log(`🔄 Updating grid UI: ${pads.length} pads, ${this.scenes.filter(s => s !== null).length} scenes loaded`);

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
    if (index < 0 || index >= 9) return;

    this.scenes[index] = null;
    if (this.activePadIndex === index) {
      this.activePadIndex = null;
    }

    this.saveScenestoStorage();
    this.updateGridUI();
  }

  /**
   * Show custom confirmation dialog for Clear All
   */
  showClearAllConfirmation() {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // Create dialog
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #000;
      border: 2px solid #fff;
      padding: 2rem;
      max-width: 400px;
      font-family: 'IBM Plex Mono', monospace;
      color: #fff;
      text-align: center;
    `;

    dialog.innerHTML = `
      <div style="font-size: 24px; margin-bottom: 1rem;">⚠️</div>
      <div style="font-size: 16px; font-weight: bold; margin-bottom: 1rem;">DELETE ALL SCENES?</div>
      <div style="font-size: 12px; margin-bottom: 2rem; line-height: 1.5;">
        This will permanently delete all 9 saved scenes from storage.<br><br>
        This action cannot be undone.
      </div>
      <div style="display: flex; gap: 1rem; justify-content: center;">
        <button id="confirmClearAll" style="
          background: #fff;
          color: #000;
          border: none;
          padding: 0.5rem 1.5rem;
          font-family: 'IBM Plex Mono', monospace;
          font-weight: bold;
          cursor: pointer;
          font-size: 12px;
        ">DELETE</button>
        <button id="cancelClearAll" style="
          background: #000;
          color: #fff;
          border: 1px solid #fff;
          padding: 0.5rem 1.5rem;
          font-family: 'IBM Plex Mono', monospace;
          font-weight: bold;
          cursor: pointer;
          font-size: 12px;
        ">CANCEL</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Handle confirm
    document.getElementById('confirmClearAll').addEventListener('click', () => {
      console.log('✅ User confirmed: DELETE all scenes');
      document.body.removeChild(overlay);
      this.clearAllScenes();
    });

    // Handle cancel
    document.getElementById('cancelClearAll').addEventListener('click', () => {
      console.log('❌ User cancelled: Keep scenes');
      document.body.removeChild(overlay);
    });

    // ESC to cancel
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        console.log('❌ User cancelled with ESC: Keep scenes');
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    console.log('📋 Custom confirmation dialog shown');
  }

  /**
   * Clear all scenes
   */
  clearAllScenes() {
    console.log('🗑️ Clearing all scenes and purging localStorage...');

    // Log before state
    console.log('Before clear:', {
      scenesInMemory: this.scenes.filter(s => s !== null).length,
      totalSlots: this.scenes.length,
      activeIndex: this.activePadIndex
    });

    this.scenes = new Array(9).fill(null);
    this.activePadIndex = null;

    // Completely remove from localStorage
    try {
      const beforeRemove = localStorage.getItem('beatPadScenes');
      localStorage.removeItem('beatPadScenes');
      const afterRemove = localStorage.getItem('beatPadScenes');

      console.log('💾 localStorage operations:', {
        hadData: !!beforeRemove,
        dataSize: beforeRemove ? beforeRemove.length : 0,
        removedSuccessfully: afterRemove === null,
        afterValue: afterRemove
      });
    } catch (e) {
      console.error('❌ Failed to remove from localStorage:', e);
    }

    this.updateGridUI();

    // Log after state
    console.log('After clear:', {
      scenesInMemory: this.scenes.filter(s => s !== null).length,
      totalSlots: this.scenes.length,
      activeIndex: this.activePadIndex
    });

    console.log('✅ All scenes cleared, localStorage purged, UI updated');
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
      console.log('💾 Saved to localStorage:', { sceneCount: this.scenes.filter(s => s !== null).length, total: this.scenes.length });
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
      console.log('📂 Loading scenes from localStorage:', {
        hasData: !!stored,
        dataLength: stored ? stored.length : 0
      });

      if (stored) {
        const data = JSON.parse(stored);
        this.scenes = data.scenes || new Array(9).fill(null);
        this.activePadIndex = data.activePadIndex || null;

        const loadedScenes = this.scenes.filter(s => s !== null).length;
        console.log(`📂 Loaded ${loadedScenes} scenes from localStorage`);
      } else {
        console.log('📂 No saved scenes found, starting with empty grid');
        this.scenes = new Array(9).fill(null);
      }
    } catch (e) {
      console.error('❌ Failed to load scenes from localStorage:', e);
      this.scenes = new Array(9).fill(null);
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
