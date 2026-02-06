/**
 * SystemicAI - Split-Context Viewer
 * Interactive documentation viewer with designer/developer views
 */

class DesignSystemViewer {
  constructor(container) {
    this.container = container;
    this.designSystem = null;
    this.currentSection = null;
    this.currentComponent = null;
    this.currentContext = 'design'; // 'design' or 'code'
    this.currentState = 'default'; // 'default', 'hover', 'focus', 'disabled'

    this.init();
  }

  /**
   * Initialize the viewer
   */
  init() {
    this.bindElements();
    this.bindEvents();
  }

  /**
   * Bind DOM elements
   */
  bindElements() {
    // Docs nav bar
    this.docsNav = DOMUtils.$('#docs-nav', this.container);
    this.foundationLinks = DOMUtils.$$('.docs-nav__link', this.container);
    this.componentSelect = DOMUtils.$('#component-select', this.container);
    this.variantSelect = DOMUtils.$('#variant-select', this.container);
    this.breadcrumb = DOMUtils.$('#stage-breadcrumb', this.container);
    this.breadcrumbSystemName = DOMUtils.$('#breadcrumb-system-name', this.container);

    // Stage
    this.componentStage = DOMUtils.$('#component-stage', this.container);
    this.componentPreview = DOMUtils.$('#component-preview', this.container);
    this.componentSpecs = DOMUtils.$('#component-specs', this.container);
    this.specsGrid = DOMUtils.$('#specs-grid', this.container);

    // Context sidebar
    this.contextSidebar = DOMUtils.$('#context-sidebar', this.container);
    this.designContext = DOMUtils.$('#design-context', this.container);
    this.codeContext = DOMUtils.$('#code-context', this.container);

    // Design view elements
    this.componentDescription = DOMUtils.$('#component-description', this.container);
    this.usageSection = DOMUtils.$('#usage-section', this.container);
    this.whenToUse = DOMUtils.$('#when-to-use', this.container);
    this.dontUseSection = DOMUtils.$('#dont-use-section', this.container);
    this.whenNotToUse = DOMUtils.$('#when-not-to-use', this.container);
    this.a11ySection = DOMUtils.$('#a11y-section', this.container);
    this.accessibilityNotes = DOMUtils.$('#accessibility-notes', this.container);
    this.statesSection = DOMUtils.$('#states-section', this.container);
    this.statesList = DOMUtils.$('#states-list', this.container);
    this.variantsSection = DOMUtils.$('#variants-section', this.container);
    this.variantsGallery = DOMUtils.$('#variants-gallery', this.container);

    // Code view elements
    this.tokenList = DOMUtils.$('#token-list', this.container);
    this.cssCode = DOMUtils.$('#css-code', this.container);
    this.htmlCode = DOMUtils.$('#html-code', this.container);
    this.reactCode = DOMUtils.$('#react-code', this.container);
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Foundation nav links
    this.foundationLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.selectFoundation(link.dataset.section);
      });
    });

    // Component dropdown
    this.componentSelect?.addEventListener('change', (e) => {
      const type = e.target.value;
      if (!type) return;
      const comp = this.designSystem?.components?.find(c => c.type === type);
      if (comp) this.selectComponent(comp);
    });

    // View toggle (Design / Code)
    DOMUtils.$$('.toggle-btn', this.container).forEach(btn => {
      btn.addEventListener('click', () => this.switchContext(btn.dataset.context));
    });

    // State toggles
    DOMUtils.$$('.state-btn', this.container).forEach(btn => {
      btn.addEventListener('click', () => this.switchState(btn.dataset.state));
    });

    // Variant select
    this.variantSelect?.addEventListener('change', (e) => {
      this.selectVariant(e.target.value);
    });

    // Copy buttons
    DOMUtils.$$('.copy-btn', this.container).forEach(btn => {
      btn.addEventListener('click', () => this.copyCode(btn.dataset.copy));
    });

    // Mobile sidebar toggle
    this.contextSidebar?.addEventListener('click', (e) => {
      if (window.innerWidth <= 900 && e.target === this.contextSidebar) {
        this.contextSidebar.classList.toggle('expanded');
      }
    });
  }

  /**
   * Load a design system into the viewer
   */
  load(designSystem) {
    this.designSystem = designSystem;

    // Auto-consolidate old design systems that have raw components
    this.ensureConsolidated();

    this.renderNavigation();
    this.showDefaultView();
  }

  /**
   * Ensure components are consolidated (for backward compatibility with old data)
   */
  ensureConsolidated() {
    const components = this.designSystem?.components || [];
    if (components.length === 0) return;

    // Check if already consolidated (consolidated components have 'variants' array)
    const firstComponent = components[0];
    if (firstComponent.variants && Array.isArray(firstComponent.variants)) {
      // Already consolidated
      return;
    }

    // Need to consolidate - these are raw components
    console.log('[Viewer] Consolidating legacy component data...');

    if (typeof ComponentConsolidator !== 'undefined') {
      const consolidator = new ComponentConsolidator();
      this.designSystem.components = consolidator.consolidate(components);
      console.log(`[Viewer] Consolidated ${components.length} raw components into ${this.designSystem.components.length} types`);
    } else {
      console.warn('[Viewer] ComponentConsolidator not available, displaying raw components');
    }
  }

  /**
   * Render the navigation (populate component dropdown + update breadcrumb)
   */
  renderNavigation() {
    if (!this.designSystem) return;

    // Update breadcrumb system name
    if (this.breadcrumbSystemName) {
      this.breadcrumbSystemName.textContent = this.designSystem.name || 'System';
    }

    // Populate component dropdown
    if (this.componentSelect) {
      const components = this.designSystem.components || [];

      // Reset dropdown
      this.componentSelect.innerHTML = '<option value="">Component...</option>';

      if (components.length > 0) {
        components.forEach(component => {
          const variantCount = component.variants?.length || 0;
          const name = component.name || this.formatName(component.type);
          const option = document.createElement('option');
          option.value = component.type;
          option.textContent = `${name} (${variantCount})`;
          this.componentSelect.appendChild(option);
        });
      }
    }
  }

  /**
   * Show default view
   */
  showDefaultView() {
    // Show color foundation by default
    this.selectFoundation('color');
  }

  /**
   * Render breadcrumb navigation
   * @param {Array} items - Array of { label, hash?, meta? }
   */
  renderBreadcrumb(items) {
    if (!this.breadcrumb) return;

    const parts = items.map((item, i) => {
      const isLast = i === items.length - 1;

      if (isLast) {
        let html = `<span class="breadcrumb-current">${item.label}</span>`;
        if (item.meta) {
          html += `<span class="breadcrumb-meta">${item.meta}</span>`;
        }
        return html;
      }

      if (item.hash) {
        return `<a href="${item.hash}" class="breadcrumb-link">${item.label}</a>`;
      }

      return `<span class="breadcrumb-text">${item.label}</span>`;
    });

    this.breadcrumb.innerHTML = parts.join('<span class="breadcrumb-sep">/</span>');
  }

  /**
   * Select a foundation section
   */
  selectFoundation(section) {
    this.currentSection = section;
    this.currentComponent = null;

    // Update navigation active state
    this.updateNavActiveState(section);

    // Update URL hash (without triggering re-route)
    const newHash = `docs/${section}`;
    if (window.location.hash !== `#${newHash}`) {
      history.replaceState(null, '', `#${newHash}`);
    }

    // Update breadcrumb with system name
    this.renderBreadcrumb([
      { label: 'Systems', hash: '#systems' },
      { label: this.designSystem?.name || 'System', hash: '#docs' },
      { label: this.formatName(section) }
    ]);

    // Hide variant select for foundations
    if (this.variantSelect) {
      this.variantSelect.hidden = true;
    }

    // Render foundation content
    switch (section) {
      case 'color':
        this.renderColorFoundation();
        break;
      case 'typography':
        this.renderTypographyFoundation();
        break;
      case 'spacing':
        this.renderSpacingFoundation();
        break;
      case 'elevation':
        this.renderElevationFoundation();
        break;
      default:
        this.componentPreview.innerHTML = '<div class="preview-placeholder"><p>Select a section</p></div>';
    }

    // Update context sidebar
    this.updateContextForFoundation(section);
  }

  /**
   * Select a component
   */
  selectComponent(component) {
    this.currentSection = 'component';
    this.currentComponent = component;
    this.currentVariantIndex = 0;

    // Update navigation active state
    this.updateNavActiveState(component.type);

    // Update URL hash
    const newHash = `docs/component/${component.type}`;
    if (window.location.hash !== `#${newHash}`) {
      history.replaceState(null, '', `#${newHash}`);
    }

    // Update breadcrumb with system name and stats
    const variantCount = component.variants?.length || 0;
    const totalUsage = component.totalUsage || 0;
    this.renderBreadcrumb([
      { label: 'Systems', hash: '#systems' },
      { label: this.designSystem?.name || 'System', hash: '#docs' },
      { label: component.name, meta: `${variantCount} variant${variantCount !== 1 ? 's' : ''} · ${totalUsage} usage${totalUsage !== 1 ? 's' : ''}` }
    ]);

    // Show variant dropdown if multiple variants
    if (component.variants?.length > 1 && this.variantSelect) {
      this.variantSelect.hidden = false;
      this.variantSelect.innerHTML = component.variants
        .map((v, i) => `<option value="${i}">${v.name || 'Variant ' + (i + 1)} (${v.usageCount || 0})</option>`)
        .join('');
    } else if (this.variantSelect) {
      this.variantSelect.hidden = true;
    }

    // Render component preview
    this.renderComponentPreview(component);

    // Update context sidebar
    this.updateContextForComponent(component);
  }

  /**
   * Update navigation active state
   */
  updateNavActiveState(activeId) {
    // Update foundation link active states
    this.foundationLinks.forEach(link => {
      link.classList.toggle('active', link.dataset.section === activeId);
    });

    // Update component dropdown if a component is selected
    const foundations = ['color', 'typography', 'spacing', 'elevation'];
    if (foundations.includes(activeId)) {
      // Deselect component dropdown when viewing a foundation
      if (this.componentSelect) this.componentSelect.value = '';
    } else if (this.componentSelect) {
      this.componentSelect.value = activeId;
    }
  }

  /**
   * Render color foundation
   */
  renderColorFoundation() {
    const colors = this.designSystem?.tokens?.colors;
    if (!colors) {
      this.componentPreview.innerHTML = '<p>No color tokens available</p>';
      return;
    }

    let html = '<div class="foundation-content"><h3>Color Palette</h3>';

    // Primary colors
    html += '<div class="color-section"><h4>Primary Colors</h4><div class="color-grid">';
    if (colors.primary) {
      html += this.renderColorSwatch(colors.primary, 'Primary');
    }
    if (colors.secondary) {
      html += this.renderColorSwatch(colors.secondary, 'Secondary');
    }
    html += '</div></div>';

    // Semantic colors
    html += '<div class="color-section"><h4>Semantic Colors</h4><div class="color-grid">';
    if (colors.error) html += this.renderColorSwatch(colors.error, 'Error');
    if (colors.success) html += this.renderColorSwatch(colors.success, 'Success');
    if (colors.warning) html += this.renderColorSwatch(colors.warning, 'Warning');
    html += '</div></div>';

    // Surface colors
    if (colors.surface?.length > 0 || colors.onSurface?.length > 0) {
      html += '<div class="color-section"><h4>Surface Colors</h4><div class="color-grid">';
      colors.surface?.forEach((c, i) => {
        html += this.renderColorSwatch(c, `Surface ${i + 1}`);
      });
      colors.onSurface?.forEach((c, i) => {
        html += this.renderColorSwatch(c, `On Surface ${i + 1}`);
      });
      html += '</div></div>';
    }

    // Neutral colors
    if (colors.neutral?.length > 0) {
      html += '<div class="color-section"><h4>Neutral Palette</h4><div class="color-grid">';
      colors.neutral.forEach((c, i) => {
        html += this.renderColorSwatch(c, `Neutral ${(i + 1) * 10}`);
      });
      html += '</div></div>';
    }

    html += '</div>';
    this.componentPreview.innerHTML = html;

    // Show specs
    this.showColorSpecs(colors);
  }

  /**
   * Render a color swatch
   */
  renderColorSwatch(color, name) {
    return `
      <div class="color-swatch-card">
        <div class="color-swatch-preview" style="background: ${color.hex}"></div>
        <div class="color-swatch-info">
          <div class="color-swatch-name">${name}</div>
          <div class="color-swatch-value">${color.hex}</div>
        </div>
      </div>
    `;
  }

  /**
   * Show color specs
   */
  showColorSpecs(colors) {
    this.componentSpecs.hidden = false;
    const specs = [];

    if (colors.primary) {
      specs.push({ label: 'Primary', value: colors.primary.hex });
    }
    if (colors.secondary) {
      specs.push({ label: 'Secondary', value: colors.secondary.hex });
    }
    specs.push({ label: 'Total Colors', value: `${this.countColors(colors)} tokens` });

    this.specsGrid.innerHTML = specs.map(s => `
      <div class="spec-item">
        <div class="spec-label">${s.label}</div>
        <div class="spec-value">${s.value}</div>
      </div>
    `).join('');
  }

  /**
   * Count total colors
   */
  countColors(colors) {
    let count = 0;
    ['primary', 'secondary', 'tertiary', 'error', 'success', 'warning'].forEach(key => {
      if (colors[key]) count++;
    });
    ['surface', 'onSurface', 'neutral', 'accent'].forEach(key => {
      count += colors[key]?.length || 0;
    });
    return count;
  }

  /**
   * Render typography foundation
   */
  renderTypographyFoundation() {
    const typography = this.designSystem?.tokens?.typography;
    if (!typography) {
      this.componentPreview.innerHTML = '<p>No typography tokens available</p>';
      return;
    }

    let html = '<div class="foundation-content"><h3>Typography</h3>';

    // Font families
    html += '<div class="type-section"><h4>Font Families</h4>';
    html += `<p style="font-family: ${typography.primary}; font-size: 24px;">Primary: ${typography.primary}</p>`;
    if (typography.secondary !== typography.primary) {
      html += `<p style="font-family: ${typography.secondary}; font-size: 24px;">Secondary: ${typography.secondary}</p>`;
    }
    html += '</div>';

    // Type scale
    if (typography.typescale?.length > 0) {
      html += '<div class="type-section"><h4>Type Scale</h4><div class="type-scale">';
      typography.typescale.forEach(size => {
        html += `
          <div class="type-sample">
            <div class="type-sample-preview" style="font-size: ${size.value}">
              The quick brown fox
            </div>
            <div class="type-sample-meta">
              ${size.materialRole}<br>
              ${size.value}
            </div>
          </div>
        `;
      });
      html += '</div></div>';
    }

    html += '</div>';
    this.componentPreview.innerHTML = html;
    this.componentSpecs.hidden = true;
  }

  /**
   * Render spacing foundation
   */
  renderSpacingFoundation() {
    const spacing = this.designSystem?.tokens?.spacing;
    if (!spacing) {
      this.componentPreview.innerHTML = '<p>No spacing tokens available</p>';
      return;
    }

    let html = '<div class="foundation-content"><h3>Spacing</h3>';
    html += `<p>Base unit: ${spacing.baseUnit}px</p>`;

    html += '<div class="spacing-scale">';
    spacing.scale?.forEach(s => {
      html += `
        <div class="spacing-sample">
          <div class="spacing-label">Space ${s.normalized / spacing.baseUnit}</div>
          <div class="spacing-bar" style="width: ${s.normalized}px"></div>
          <div class="spacing-label">${s.normalized}px</div>
        </div>
      `;
    });
    html += '</div></div>';

    this.componentPreview.innerHTML = html;
    this.componentSpecs.hidden = true;
  }

  /**
   * Render elevation foundation
   */
  renderElevationFoundation() {
    const elevation = this.designSystem?.tokens?.elevation;
    if (!elevation) {
      this.componentPreview.innerHTML = '<p>No elevation tokens available</p>';
      return;
    }

    let html = '<div class="foundation-content"><h3>Elevation</h3>';

    if (!elevation.hasShadows) {
      html += '<p>This design system uses a flat design without shadows.</p>';
    } else {
      html += '<div class="elevation-scale">';
      elevation.levels?.forEach((level, i) => {
        html += `
          <div class="elevation-sample" style="box-shadow: ${level.shadow}; background: var(--bg-surface); padding: var(--space-4); margin: var(--space-4);">
            <strong>Level ${i + 1}</strong>
            <p style="font-size: var(--text-xs); color: var(--fg-muted);">${level.materialLevel}</p>
          </div>
        `;
      });
      html += '</div>';
    }

    html += '</div>';
    this.componentPreview.innerHTML = html;
    this.componentSpecs.hidden = true;
  }

  /**
   * Render component preview
   */
  renderComponentPreview(component, variantIndex = 0) {
    const variants = component.variants || [];

    if (variants.length === 0) {
      this.componentPreview.innerHTML = '<div class="preview-empty"><p>No variants available</p></div>';
      this.componentSpecs.hidden = true;
      return;
    }

    const currentVariant = variants[variantIndex] || variants[0];

    // Build variants gallery if multiple
    let galleryHtml = '';
    if (variants.length > 1) {
      galleryHtml = `
        <div class="variants-preview-gallery">
          <h4>All Variants (${variants.length})</h4>
          <div class="variants-grid">
            ${variants.map((v, i) => `
              <div class="variant-preview-card ${i === variantIndex ? 'active' : ''}" data-index="${i}">
                <div class="variant-preview-content">
                  ${v.html || '<span class="no-preview">No preview</span>'}
                </div>
                <div class="variant-preview-label">
                  <span class="variant-name">${v.name}</span>
                  <span class="variant-usage">${v.usageCount || 0} uses</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Create preview container
    this.componentPreview.innerHTML = `
      <div class="preview-main">
        <div class="preview-component" data-variant="${variantIndex}">
          ${currentVariant.html || '<p>No HTML preview available</p>'}
        </div>
        <div class="preview-info">
          <span class="preview-variant-name">${currentVariant.name}</span>
          <span class="preview-usage">${currentVariant.usageCount || 0} usages found</span>
        </div>
      </div>
      ${galleryHtml}
    `;

    // Bind click events for variant cards
    this.componentPreview.querySelectorAll('.variant-preview-card').forEach(card => {
      card.addEventListener('click', () => {
        const index = parseInt(card.dataset.index);
        this.variantSelect.value = index;
        this.renderComponentPreview(component, index);
      });
    });

    // Show specs
    this.showComponentSpecs(component, currentVariant);
  }

  /**
   * Show component specs
   */
  showComponentSpecs(component, variant) {
    this.componentSpecs.hidden = false;

    const specs = [
      { label: 'Type', value: this.formatName(component.type) },
      { label: 'Variants', value: `${component.variants?.length || 0} detected` },
      { label: 'Total Usage', value: `${component.totalUsage || 0} instances` },
      { label: 'Current Variant', value: variant?.name || 'Default' },
      { label: 'Variant Usage', value: `${variant?.usageCount || 0} instances` }
    ];

    // Add classes info if available
    if (variant?.classes?.length > 0) {
      specs.push({
        label: 'CSS Classes',
        value: variant.classes.slice(0, 3).join(', ') + (variant.classes.length > 3 ? '...' : '')
      });
    }

    this.specsGrid.innerHTML = specs.map(s => `
      <div class="spec-item">
        <div class="spec-label">${s.label}</div>
        <div class="spec-value">${s.value}</div>
      </div>
    `).join('');
  }

  /**
   * Update context sidebar for foundation
   */
  updateContextForFoundation(section) {
    const docs = this.designSystem?.documentation?.foundations?.[section];

    // Design context
    this.componentDescription.textContent = docs?.description ||
      `Documentation for ${this.formatName(section)} tokens.`;

    // Hide component-specific sections
    this.usageSection.hidden = true;
    this.dontUseSection.hidden = true;
    this.a11ySection.hidden = true;
    this.variantsSection.hidden = true;

    // Code context - show token list
    this.updateTokenList(section);
    this.updateCodeBlocks(section);
  }

  /**
   * Update context sidebar for component
   */
  updateContextForComponent(component) {
    const guidelines = component.guidelines || {};

    // Design context
    this.componentDescription.textContent = `${component.name} component extracted from the source website.`;

    // When to use
    if (guidelines.whenToUse?.length > 0) {
      this.usageSection.hidden = false;
      this.whenToUse.innerHTML = guidelines.whenToUse
        .map(item => `<li>${item}</li>`)
        .join('');
    } else {
      this.usageSection.hidden = true;
    }

    // When not to use
    if (guidelines.whenNotToUse?.length > 0) {
      this.dontUseSection.hidden = false;
      this.whenNotToUse.innerHTML = guidelines.whenNotToUse
        .map(item => `<li>${item}</li>`)
        .join('');
    } else {
      this.dontUseSection.hidden = true;
    }

    // Accessibility
    if (component.accessibility?.length > 0) {
      this.a11ySection.hidden = false;
      this.accessibilityNotes.innerHTML = component.accessibility
        .map(item => `<li>${item}</li>`)
        .join('');
    } else {
      this.a11ySection.hidden = true;
    }

    // States section
    this.renderStatesSection(component);

    // Variants gallery with clickable previews
    if (component.variants?.length > 1) {
      this.variantsSection.hidden = false;
      this.variantsGallery.innerHTML = component.variants
        .map((v, i) => `
          <div class="variant-thumb ${i === 0 ? 'active' : ''}" data-index="${i}">
            <div class="variant-thumb-preview">${v.html || '<span>—</span>'}</div>
            <span class="variant-thumb-name">${v.name || 'Variant ' + (i + 1)}</span>
          </div>
        `)
        .join('');

      // Bind click events for variant thumbs
      this.variantsGallery.querySelectorAll('.variant-thumb').forEach(thumb => {
        thumb.addEventListener('click', () => {
          const index = parseInt(thumb.dataset.index);
          // Update active state
          this.variantsGallery.querySelectorAll('.variant-thumb').forEach(t => t.classList.remove('active'));
          thumb.classList.add('active');
          // Update variant select dropdown
          if (this.variantSelect) this.variantSelect.value = index;
          // Re-render preview with new variant
          this.renderComponentPreview(component, index);
          // Update code blocks
          const variant = component.variants?.[index];
          if (variant) {
            this.updateCodeBlocksForComponent(component, variant);
          }
        });
      });
    } else {
      this.variantsSection.hidden = true;
    }

    // Update code context
    this.updateTokenListForComponent(component);
    this.updateCodeBlocksForComponent(component);
  }

  /**
   * Render states section for component
   */
  renderStatesSection(component) {
    if (!this.statesSection || !this.statesList) return;

    const states = component.states || {};
    const cssStates = component.cssStates || {};

    // Collect all detected states
    const detectedStates = [];

    // Add HTML/ARIA states
    if (states.hasDefault) detectedStates.push({ name: 'Default', type: 'base', hasCss: true });
    if (states.hasHover || cssStates.hover) detectedStates.push({ name: 'Hover', type: 'css', hasCss: !!cssStates.hover });
    if (states.hasFocus || cssStates.focus) detectedStates.push({ name: 'Focus', type: 'css', hasCss: !!cssStates.focus });
    if (states.hasFocusVisible || cssStates['focus-visible']) detectedStates.push({ name: 'Focus Visible', type: 'css', hasCss: !!cssStates['focus-visible'] });
    if (states.hasActive || cssStates.active) detectedStates.push({ name: 'Active', type: 'interactive', hasCss: !!cssStates.active });
    if (states.hasDisabled) detectedStates.push({ name: 'Disabled', type: 'interactive', hasCss: !!cssStates.disabled });
    if (states.hasLoading) detectedStates.push({ name: 'Loading', type: 'feedback', hasCss: false });
    if (states.hasError) detectedStates.push({ name: 'Error', type: 'feedback', hasCss: !!cssStates.error });
    if (states.hasSuccess) detectedStates.push({ name: 'Success', type: 'feedback', hasCss: !!cssStates.success });

    if (detectedStates.length > 1) { // More than just default
      this.statesSection.hidden = false;
      this.statesList.innerHTML = detectedStates.map(state => `
        <div class="state-tag ${state.type}">
          <span class="state-name">${state.name}</span>
          ${state.hasCss ? '<span class="state-indicator css" title="CSS styles detected">CSS</span>' : ''}
        </div>
      `).join('');
    } else {
      this.statesSection.hidden = true;
    }
  }

  /**
   * Update token list for foundation
   */
  updateTokenList(section) {
    const tokens = this.designSystem?.tokens?.[section === 'color' ? 'colors' : section];
    if (!tokens) {
      this.tokenList.innerHTML = '<p>No tokens available</p>';
      return;
    }

    let html = '';

    if (section === 'color') {
      if (tokens.primary) {
        html += this.renderTokenItem('--sys-color-primary', tokens.primary.hex);
      }
      if (tokens.secondary) {
        html += this.renderTokenItem('--sys-color-secondary', tokens.secondary.hex);
      }
      tokens.neutral?.slice(0, 5).forEach((c, i) => {
        html += this.renderTokenItem(`--sys-color-neutral-${(i + 1) * 10}`, c.hex);
      });
    }

    this.tokenList.innerHTML = html || '<p>No tokens available</p>';
  }

  /**
   * Update token list for component
   */
  updateTokenListForComponent(component) {
    const tokens = component.tokens || {};
    let html = '';

    tokens.colors?.slice(0, 5).forEach(color => {
      html += this.renderTokenItem('color', color);
    });

    tokens.spacing?.slice(0, 3).forEach(spacing => {
      html += this.renderTokenItem('spacing', spacing);
    });

    this.tokenList.innerHTML = html || '<p>No tokens used</p>';
  }

  /**
   * Render a token item
   */
  renderTokenItem(name, value) {
    const isColor = value.startsWith('#') || value.startsWith('rgb');

    return `
      <div class="token-item">
        <span class="token-name">${name}</span>
        <span class="token-value">
          ${isColor ? `<span class="token-swatch" style="background: ${value}"></span>` : ''}
          <button class="token-copy" data-value="${value}">Copy</button>
        </span>
      </div>
    `;
  }

  /**
   * Update code blocks for foundation
   */
  updateCodeBlocks(section) {
    const cssVars = this.designSystem?.tokens?.cssVariables || '';

    // Filter CSS vars for this section
    const lines = cssVars.split('\n').filter(line =>
      line.includes(`sys-${section === 'color' ? 'color' : section}`)
    );

    this.cssCode.textContent = lines.join('\n') || `/* No ${section} tokens */`;
    this.htmlCode.textContent = '<!-- N/A for foundation tokens -->';
    this.reactCode.textContent = '// N/A for foundation tokens';
  }

  /**
   * Update code blocks for component
   */
  updateCodeBlocksForComponent(component, variant = null) {
    const code = component.code || {};
    const currentVariant = variant || component.variants?.[0];

    // Use component-level code if available, otherwise use variant HTML
    this.cssCode.textContent = code.css || '/* No CSS available */';
    this.htmlCode.textContent = currentVariant?.html || code.html || '<!-- No HTML available -->';
    this.reactCode.textContent = code.react || '// No React component available';
  }

  /**
   * Switch context view (design/code)
   */
  switchContext(context) {
    this.currentContext = context;

    // Update toggle buttons
    DOMUtils.$$('.toggle-btn', this.container).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.context === context);
    });

    // Switch panels
    this.designContext?.classList.toggle('active', context === 'design');
    this.codeContext?.classList.toggle('active', context === 'code');
  }

  /**
   * Switch component state
   */
  switchState(state) {
    this.currentState = state;

    // Update state buttons
    DOMUtils.$$('.state-btn', this.container).forEach(btn => {
      btn.classList.toggle('active', btn.dataset.state === state);
    });

    // Apply state to preview
    const preview = DOMUtils.$('.preview-component', this.container);
    if (preview) {
      preview.dataset.state = state;
      // Apply pseudo-state styles
      this.applyPreviewState(preview, state);
    }
  }

  /**
   * Apply preview state styles
   */
  applyPreviewState(preview, state) {
    const element = preview.firstElementChild;
    if (!element) return;

    // Remove existing state classes
    element.classList.remove('is-hovered', 'is-focused', 'is-disabled');

    // Add new state class
    switch (state) {
      case 'hover':
        element.classList.add('is-hovered');
        break;
      case 'focus':
        element.classList.add('is-focused');
        break;
      case 'disabled':
        element.classList.add('is-disabled');
        element.disabled = true;
        break;
      default:
        element.disabled = false;
    }
  }

  /**
   * Select variant
   */
  selectVariant(index) {
    if (!this.currentComponent) return;

    const variantIndex = parseInt(index);
    this.currentVariantIndex = variantIndex;

    // Re-render the preview with the new variant
    this.renderComponentPreview(this.currentComponent, variantIndex);

    // Update code blocks for selected variant
    const variant = this.currentComponent.variants?.[variantIndex];
    if (variant) {
      this.updateCodeBlocksForComponent(this.currentComponent, variant);
    }
  }

  /**
   * Filter components by search (no-op since using dropdown now)
   */
  filterComponents(query) {
    // Component filtering is now handled by the native <select> dropdown
  }

  /**
   * Copy code to clipboard
   */
  async copyCode(codeId) {
    const codeElement = DOMUtils.$(`#${codeId}`, this.container);
    if (!codeElement) return;

    try {
      await navigator.clipboard.writeText(codeElement.textContent);
      this.showToast('Copied to clipboard');
    } catch (error) {
      this.showToast('Failed to copy', 'error');
    }
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const container = DOMUtils.$('#toast-container') || document.body;
    const toast = DOMUtils.createElement('div', {
      className: `toast ${type === 'error' ? 'toast--error' : ''}`
    }, [message]);

    container.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  /**
   * Format name for display
   */
  formatName(name) {
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DesignSystemViewer;
}
