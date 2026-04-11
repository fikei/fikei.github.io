/**
 * Systemic - Split-Context Viewer
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
   * Bind DOM elements (stage + sidebar - nav is bound separately via rebindNav)
   */
  bindElements() {
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
    this.compPrinciplesSection = DOMUtils.$('#comp-principles-section', this.container);
    this.compPrinciplesList = DOMUtils.$('#comp-principles-list', this.container);

    // Code view elements
    this.tokenList = DOMUtils.$('#token-list', this.container);
    this.cssCode = DOMUtils.$('#css-code', this.container);
    this.htmlCode = DOMUtils.$('#html-code', this.container);
    this.reactCode = DOMUtils.$('#react-code', this.container);
  }

  /**
   * Bind event listeners for stage + sidebar (not nav - that's rebindNav)
   */
  bindEvents() {
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
   * Rebind nav elements after app.js rebuilds the nav bar
   * Called by app.js after renderDocsNav()
   */
  rebindNav(navElement) {
    // Cache nav element references
    this.foundationLinks = DOMUtils.$$('.docs-nav__link[data-section]', navElement);
    this.componentSelect = DOMUtils.$('#component-select', navElement);
    this.variantSelect = DOMUtils.$('#variant-select', navElement);
    this.breadcrumb = DOMUtils.$('#stage-breadcrumb', navElement);
    this.breadcrumbSystemName = DOMUtils.$('#breadcrumb-system-name', navElement);

    // Foundation nav links
    this.foundationLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        this.selectFoundation(link.dataset.section);
      });
    });

    // Component dropdown — selection is handled by app.selectComponentGlobal()
    // (wired in app.js after rebindNav)

    // View toggle (Design / Code) — only bind buttons with data-context, not data-mode
    DOMUtils.$$('.view-toggle:not(.view-toggle--mode) .toggle-btn', navElement).forEach(btn => {
      if (btn.dataset.context) {
        btn.addEventListener('click', () => this.switchContext(btn.dataset.context));
      }
    });

    // Variant select
    this.variantSelect?.addEventListener('change', (e) => {
      this.selectVariant(e.target.value);
    });

    // Restore active states
    if (this.currentContext) {
      DOMUtils.$$('.view-toggle:not(.view-toggle--mode) .toggle-btn', navElement).forEach(btn => {
        if (btn.dataset.context) {
          btn.classList.toggle('active', btn.dataset.context === this.currentContext);
        }
      });
    }
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
   * Render navigation - now handled by app.js renderDocsNav()
   * This just triggers the route to refresh the nav
   */
  renderNavigation() {
    // Nav is built by app.js; nothing to do here
  }

  /**
   * Show default view
   */
  showDefaultView() {
    // Respect current hash route if present (e.g. on page refresh)
    const hash = window.location.hash.slice(1) || '';
    const parts = hash.split('/');
    if (parts[0] === 'docs' && parts[1]) {
      const foundations = ['color', 'typography', 'spacing', 'elevation', 'examples', 'principles'];
      if (foundations.includes(parts[1])) {
        this.selectFoundation(parts[1]);
        return;
      }
      // Component route — let handleRoute deal with it
      if (parts[1] === 'component') return;
    }
    // Default fallback
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
        let html = `<span class="breadcrumb__current">${item.label}</span>`;
        if (item.meta) {
          html += `<span class="breadcrumb-meta">${item.meta}</span>`;
        }
        return html;
      }

      if (item.hash) {
        return `<a href="${item.hash}" class="breadcrumb__link">${item.label}</a>`;
      }

      return `<span class="breadcrumb-text">${item.label}</span>`;
    });

    this.breadcrumb.innerHTML = parts.join('<span class="breadcrumb__sep">/</span>');
  }

  /**
   * Select a foundation section
   */
  selectFoundation(section) {
    this.currentSection = section;
    this.currentComponent = null;

    // Update navigation active state
    this.updateNavActiveState(section);

    // Update URL hash silently — only when already in docs view
    // (avoids poisoning the hash before app.js navigates via location.hash)
    const currentHash = window.location.hash.slice(1);
    if (currentHash.startsWith('docs')) {
      const newHash = `docs/${section}`;
      if (window.location.hash !== `#${newHash}`) {
        history.replaceState(null, '', `#${newHash}`);
      }
    }

    // Update breadcrumb with system name
    this.renderBreadcrumb([
      { label: 'Systems', hash: '#systems' },
      { label: this.designSystem?.name || 'System' }
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
      case 'examples':
        this.renderExamplesFoundation();
        break;
      case 'principles':
        this.renderPrinciplesFoundation();
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

    // Update URL hash silently — only when already in docs view
    const currentHash = window.location.hash.slice(1);
    if (currentHash.startsWith('docs')) {
      const newHash = `docs/component/${component.type}`;
      if (window.location.hash !== `#${newHash}`) {
        history.replaceState(null, '', `#${newHash}`);
      }
    }

    // Update breadcrumb with system name and stats
    const variantCount = component.variants?.length || 0;
    const totalUsage = component.totalUsage || 0;
    this.renderBreadcrumb([
      { label: 'Systems', hash: '#systems' },
      { label: this.designSystem?.name || 'System' }
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
    // Update foundation link active states (may not exist if nav not yet rendered)
    if (this.foundationLinks) {
      this.foundationLinks.forEach(link => {
        link.classList.toggle('active', link.dataset.section === activeId);
      });
    }

    // Update component dropdown if a component is selected
    const foundations = ['color', 'typography', 'spacing', 'elevation'];
    if (foundations.includes(activeId)) {
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
   * Render examples foundation - widgets.html showcase pattern with dummy content
   */
  renderExamplesFoundation() {
    const tokens = this.designSystem?.tokens || {};
    const colors = tokens.colors || {};
    const typography = tokens.typography || {};

    // Extract primary/secondary hex for inline styles
    const primaryHex = colors.primary?.hex || '#ffffff';
    const secondaryHex = colors.secondary?.hex || '#999999';
    const fontPrimary = typography.primary || 'Space Grotesk, sans-serif';

    let html = `
      <div class="foundation-content" style="max-width: 1200px; --ex-primary: ${primaryHex}; --ex-secondary: ${secondaryHex};">

        <!-- Atoms -->
        <div class="ex-section" id="ex-atoms">
          <h2 class="ex-section__heading">Atoms</h2>
          <p class="ex-section__desc">Smallest visual units extracted from the design system.</p>

          <div class="ex-grid">

            <!-- Buttons -->
            <div class="ex-card">
              <div class="ex-card__label">Buttons</div>
              <div class="ex-card__demo">
                <div class="ex-variants-row">
                  <button class="ex-btn">Default</button>
                  <button class="ex-btn ex-btn--filled">Filled</button>
                  <button class="ex-btn ex-btn--sm">Small</button>
                </div>
                <div class="ex-variants-row">
                  <button class="ex-btn ex-btn--primary">Primary</button>
                  <button class="ex-btn ex-btn--secondary">Secondary</button>
                </div>
              </div>
            </div>

            <!-- Badges -->
            <div class="ex-card">
              <div class="ex-card__label">Badges</div>
              <div class="ex-card__demo">
                <div class="ex-variants-row">
                  <span class="ex-badge">Default</span>
                  <span class="ex-badge ex-badge--filled">Filled</span>
                  <span class="ex-badge ex-badge--accent">Accent</span>
                </div>
                <div class="ex-variants-row">
                  <span class="ex-badge">New</span>
                  <span class="ex-badge">v2.0</span>
                  <span class="ex-badge ex-badge--filled">Beta</span>
                </div>
              </div>
            </div>

            <!-- Typography -->
            <div class="ex-card">
              <div class="ex-card__label">Typography</div>
              <div class="ex-card__demo" style="font-family: ${fontPrimary};">
                <span style="font-size: 24px; font-weight: 600;">Display</span>
                <span style="font-size: 18px; font-weight: 500;">Title</span>
                <span style="font-size: 14px; color: var(--fg);">Body text for paragraph content and descriptions.</span>
                <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg-muted);">Meta — supporting info</span>
                <span style="font-size: 10px; font-style: italic; color: var(--fg-subtle);">Note — explanatory italic</span>
              </div>
            </div>

            <!-- Colors -->
            <div class="ex-card">
              <div class="ex-card__label">Color Tokens</div>
              <div class="ex-card__demo">
                <div class="ex-variants-row">
                  <div class="ex-color-dot" style="background: ${primaryHex};" title="Primary"></div>
                  <div class="ex-color-dot" style="background: ${secondaryHex};" title="Secondary"></div>
                  ${(colors.neutral || []).slice(0, 4).map(c =>
                    `<div class="ex-color-dot" style="background: ${c.hex};" title="${c.hex}"></div>`
                  ).join('')}
                </div>
                <div class="ex-variants-row">
                  ${colors.error ? `<div class="ex-color-dot" style="background: ${colors.error.hex};" title="Error"></div>` : ''}
                  ${colors.success ? `<div class="ex-color-dot" style="background: ${colors.success.hex};" title="Success"></div>` : ''}
                  ${colors.warning ? `<div class="ex-color-dot" style="background: ${colors.warning.hex};" title="Warning"></div>` : ''}
                </div>
              </div>
            </div>

            <!-- Progress Bars -->
            <div class="ex-card">
              <div class="ex-card__label">Progress</div>
              <div class="ex-card__demo">
                <div class="ex-bar" style="height: 4px;"><div class="ex-bar__fill" style="width: 25%;"></div></div>
                <div class="ex-bar"><div class="ex-bar__fill" style="width: 67%;"></div></div>
                <div class="ex-bar" style="height: 8px;"><div class="ex-bar__fill" style="width: 90%; background: ${primaryHex};"></div></div>
              </div>
            </div>

            <!-- Inputs -->
            <div class="ex-card">
              <div class="ex-card__label">Form Inputs</div>
              <div class="ex-card__demo">
                <input class="ex-input" type="text" placeholder="Text input" readonly>
                <input class="ex-input" type="text" value="Filled value" readonly>
                <textarea class="ex-input ex-input--textarea" placeholder="Textarea" readonly></textarea>
              </div>
            </div>

          </div>
        </div>

        <hr class="ex-divider">

        <!-- Molecules -->
        <div class="ex-section" id="ex-molecules">
          <h2 class="ex-section__heading">Molecules</h2>
          <p class="ex-section__desc">Composed patterns using the extracted tokens.</p>

          <div class="ex-grid">

            <!-- Card -->
            <div class="ex-card">
              <div class="ex-card__label">Card</div>
              <div class="ex-card__demo">
                <div class="ex-card-widget">
                  <div class="ex-card-widget__media">320 × 180</div>
                  <div class="ex-card-widget__body">
                    <h3 class="ex-card-widget__title">Card Title</h3>
                    <p class="ex-card-widget__text">Brief description or summary text that provides context about the card content.</p>
                    <div class="ex-card-widget__footer">
                      <span class="ex-badge">Category</span>
                      <button class="ex-btn ex-btn--sm">Action</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- List Item -->
            <div class="ex-card">
              <div class="ex-card__label">List Items</div>
              <div class="ex-card__demo">
                <div class="ex-list-item">
                  <div class="ex-avatar">AB</div>
                  <div class="ex-list-item__content">
                    <div class="ex-list-item__title">List Item Title</div>
                    <div class="ex-list-item__meta">Supporting text · 2m ago</div>
                  </div>
                  <button class="ex-btn ex-btn--sm">View</button>
                </div>
                <div class="ex-list-item">
                  <div class="ex-avatar">CD</div>
                  <div class="ex-list-item__content">
                    <div class="ex-list-item__title">Another Item</div>
                    <div class="ex-list-item__meta">Description · 15m ago</div>
                  </div>
                  <span class="ex-badge ex-badge--accent">New</span>
                </div>
                <div class="ex-list-item">
                  <div class="ex-avatar">EF</div>
                  <div class="ex-list-item__content">
                    <div class="ex-list-item__title">Third Item</div>
                    <div class="ex-list-item__meta">More info · 1h ago</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Nav Bar -->
            <div class="ex-card">
              <div class="ex-card__label">Navigation</div>
              <div class="ex-card__demo">
                <div class="ex-variants-row">
                  <span class="ex-nav-item ex-nav-item--active">Overview</span>
                  <span class="ex-nav-item">Details</span>
                  <span class="ex-nav-item">Settings</span>
                </div>
              </div>
            </div>

            <!-- Form Group -->
            <div class="ex-card">
              <div class="ex-card__label">Form Group</div>
              <div class="ex-card__demo">
                <div>
                  <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg-muted); margin-bottom: var(--space-2);">Email Address</div>
                  <input class="ex-input" type="text" placeholder="name@example.com" readonly>
                </div>
                <div>
                  <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg-muted); margin-bottom: var(--space-2);">Message</div>
                  <textarea class="ex-input ex-input--textarea" placeholder="Enter your message..." readonly></textarea>
                </div>
                <div class="ex-variants-row" style="justify-content: flex-end;">
                  <button class="ex-btn">Cancel</button>
                  <button class="ex-btn ex-btn--primary">Submit</button>
                </div>
              </div>
            </div>

            <!-- Stats Card -->
            <div class="ex-card">
              <div class="ex-card__label">Stats</div>
              <div class="ex-card__demo">
                <div style="display: flex; justify-content: space-around; text-align: center;">
                  <div>
                    <div style="font-size: 24px; font-weight: 600; color: var(--fg);">128</div>
                    <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg-muted);">Pages</div>
                  </div>
                  <div>
                    <div style="font-size: 24px; font-weight: 600; color: ${primaryHex};">42</div>
                    <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg-muted);">Tokens</div>
                  </div>
                  <div>
                    <div style="font-size: 24px; font-weight: 600; color: var(--fg);">16</div>
                    <div style="font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: var(--fg-muted);">Components</div>
                  </div>
                </div>
                <div class="ex-bar"><div class="ex-bar__fill" style="width: 78%; background: ${primaryHex};"></div></div>
              </div>
            </div>

            <!-- Card with Avatar -->
            <div class="ex-card">
              <div class="ex-card__label">User Card</div>
              <div class="ex-card__demo">
                <div style="display: flex; align-items: center; gap: var(--space-3);">
                  <div class="ex-avatar" style="width: 48px; height: 48px; font-size: var(--text-sm);">JD</div>
                  <div>
                    <div style="font-weight: 500; color: var(--fg);">Jane Doe</div>
                    <div style="font-size: 11px; color: var(--fg-muted);">Product Designer</div>
                  </div>
                </div>
                <p style="font-size: 12px; color: var(--fg-muted); margin: 0; line-height: 1.5;">Building interfaces that balance form and function. Currently working on design systems and component libraries.</p>
                <div class="ex-variants-row">
                  <button class="ex-btn ex-btn--primary ex-btn--sm">Follow</button>
                  <button class="ex-btn ex-btn--sm">Message</button>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    `;

    this.componentPreview.innerHTML = html;
    this.componentSpecs.hidden = true;
  }

  /**
   * Render principles as a foundation section inside the docs view
   */
  renderPrinciplesFoundation() {
    const ds = this.designSystem;
    if (!ds) {
      this.componentPreview.innerHTML = '<div class="preview-placeholder"><p>No design system loaded</p></div>';
      return;
    }

    const principles = ds.principles;

    // If no principles yet, show loading and trigger generation
    if (!principles) {
      this.componentPreview.innerHTML = `
        <div class="principles-loading">
          <div class="principles-loading__spinner"></div>
          <p>Analysing design system…</p>
        </div>
      `;
      this._generateAndRenderPrinciples();
      return;
    }

    this._renderPrinciplesContent(principles);
  }

  /**
   * Generate principles via AI, save, then render
   */
  async _generateAndRenderPrinciples() {
    const ds = this.designSystem;
    if (!ds) return;

    try {
      const gen = new PrinciplesGenerator({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_ANON_KEY
      });
      const principles = await gen.generate(ds);
      ds.principles = principles;
      // Save via app reference
      if (window.systemicApp) {
        window.systemicApp.saveDesignSystem(ds, true);
      }
      // Only re-render if still on principles tab
      if (this.currentSection === 'principles') {
        this._renderPrinciplesContent(principles);
      }
    } catch (err) {
      console.error('[Viewer] Principles generation failed:', err);
      if (this.currentSection === 'principles') {
        this.componentPreview.innerHTML = `
          <div class="principles-error">
            <p>Failed to generate principles: ${err.message}</p>
            <button class="btn btn--ghost btn--sm" id="principles-retry-btn">Retry</button>
          </div>
        `;
        DOMUtils.$('#principles-retry-btn')?.addEventListener('click', () => {
          this.renderPrinciplesFoundation();
        });
      }
    }
  }

  /**
   * Render the principles HTML content into the stage
   */
  _renderPrinciplesContent(p) {
    const ds = this.designSystem;

    // Build global principles cards (editable)
    const globalCards = (p.globalPrinciples || []).map((pr, i) => `
      <div class="principle-card" data-principle-index="${i}">
        <h4 class="principle-card__title editable-field" contenteditable="true" data-field="globalPrinciples.${i}.title">${this._escHtml(pr.title)}</h4>
        <p class="principle-card__desc editable-field" contenteditable="true" data-field="globalPrinciples.${i}.description">${this._escHtml(pr.description)}</p>
      </div>
    `).join('');

    // Build component principles sections
    const componentSections = Object.entries(p.componentPrinciples || {}).map(([type, rules]) => {
      if (!rules?.length) return '';
      const ruleItems = rules.map((r, ri) => `
        <div class="pcomp-rule">
          <div class="pcomp-rule__rule editable-field" contenteditable="true" data-field="componentPrinciples.${type}.${ri}.rule">${this._escHtml(r.rule)}</div>
          <div class="pcomp-rule__rationale editable-field" contenteditable="true" data-field="componentPrinciples.${type}.${ri}.rationale">${this._escHtml(r.rationale)}</div>
        </div>
      `).join('');
      const label = type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      return `
        <div class="pcomp-section">
          <button class="pcomp-header" aria-expanded="false">
            <span class="pcomp-header__name">${this._escHtml(label)}</span>
            <span class="pcomp-header__count">${rules.length} rule${rules.length !== 1 ? 's' : ''}</span>
            <span class="pcomp-header__chevron">›</span>
          </button>
          <div class="pcomp-body">${ruleItems}</div>
        </div>
      `;
    }).join('');

    const aiLabel = p.generatedAt
      ? `Generated ${new Date(p.generatedAt).toLocaleDateString()}`
      : '';

    let html = `
      <div class="foundation-content principles-content">
        <div class="principles-header">
          <div class="principles-header__top">
            <h2 class="principles-title">${this._escHtml(ds.name)}</h2>
            <div class="principles-actions">
              ${aiLabel ? `<span class="principles-meta">${aiLabel}</span>` : ''}
              <button class="btn btn--ghost btn--sm" id="principles-regenerate">Regenerate</button>
              <button class="btn btn--ghost btn--sm" id="principles-add-global">+ Add Principle</button>
            </div>
          </div>
          <p class="principles-philosophy editable-field" contenteditable="true" data-field="philosophyStatement">${this._escHtml(p.philosophyStatement || '')}</p>
        </div>

        <section class="principles-section">
          <h3 class="principles-section__heading">Global Principles</h3>
          <div class="principles-grid" id="principles-grid">${globalCards}</div>
        </section>

        ${componentSections ? `
        <section class="principles-section">
          <h3 class="principles-section__heading">Component Principles</h3>
          <div class="pcomp-list">${componentSections}</div>
        </section>
        ` : ''}
      </div>
    `;

    this.componentPreview.innerHTML = html;
    this.componentSpecs.hidden = true;

    // Bind accordion toggles
    this.componentPreview.querySelectorAll('.pcomp-header').forEach(header => {
      header.addEventListener('click', () => {
        const section = header.closest('.pcomp-section');
        section?.classList.toggle('open');
        header.setAttribute('aria-expanded', String(section?.classList.contains('open')));
      });
    });

    // Regenerate button
    DOMUtils.$('#principles-regenerate', this.componentPreview)?.addEventListener('click', () => {
      if (ds.principles) delete ds.principles.generatedAt;
      this.componentPreview.innerHTML = `
        <div class="principles-loading">
          <div class="principles-loading__spinner"></div>
          <p>Regenerating principles…</p>
        </div>
      `;
      this._generateAndRenderPrinciples();
    });

    // Add new global principle
    DOMUtils.$('#principles-add-global', this.componentPreview)?.addEventListener('click', () => {
      if (!ds.principles) return;
      ds.principles.globalPrinciples = ds.principles.globalPrinciples || [];
      ds.principles.globalPrinciples.push({ title: 'New Principle', description: 'Describe this principle…' });
      if (window.systemicApp) window.systemicApp.saveDesignSystem(ds, true);
      this._renderPrinciplesContent(ds.principles);
    });

    // Bind editable fields — save on blur
    this.componentPreview.querySelectorAll('.editable-field').forEach(el => {
      el.addEventListener('blur', () => {
        const field = el.dataset.field;
        const value = el.textContent.trim();
        this._updatePrinciplesField(field, value);
      });
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          el.blur();
        }
      });
    });
  }

  /**
   * Update a principles field by dot-notation path and save
   */
  _updatePrinciplesField(fieldPath, value) {
    const ds = this.designSystem;
    if (!ds?.principles) return;

    const parts = fieldPath.split('.');
    let target = ds.principles;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = isNaN(parts[i]) ? parts[i] : parseInt(parts[i]);
      target = target[key];
      if (!target) return;
    }

    const lastKey = isNaN(parts[parts.length - 1]) ? parts[parts.length - 1] : parseInt(parts[parts.length - 1]);
    target[lastKey] = value;

    if (window.systemicApp) {
      window.systemicApp.saveDesignSystem(ds, true);
    }
  }

  /**
   * Extract audit key (size) from a variant for audit lookups
   */
  getAuditSize(variant, isTemplate) {
    if (isTemplate) {
      const m = variant.name?.match(/@ (\w+)$/);
      return m ? m[1] : variant.name;
    }
    return variant.name || 'default';
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
    const isTemplate = component.type?.startsWith('template-');
    const audit = this.variantAudit;
    const compName = component.type;

    if (variants.length > 1) {
      galleryHtml = `
        <div class="variants-preview-gallery">
          <h4>All Variants (${variants.length})</h4>
          <div class="variants-grid ${isTemplate ? 'variants-grid--template' : ''}">
            ${variants.map((v, i) => {
              const auditSize = this.getAuditSize(v, isTemplate);
              const status = audit ? audit.getStatus(compName, auditSize) : 'green';
              const entry = audit ? audit.getAuditEntry(compName, auditSize) : {};
              const isFlagged = !!entry.flagged;
              const isPref = !!entry.preferred;
              const hasNote = !!entry.note;
              const statusLabel = audit?.STATUS_LABELS?.[status] || '';

              return `
              <div class="variant-preview-card ${isTemplate ? 'variant-preview-card--template' : ''} ${i === variantIndex ? 'active' : ''} ${isFlagged ? 'variant-preview-card--flagged' : ''} ${isPref ? 'variant-preview-card--preferred' : ''}"
                   data-index="${i}" data-audit-name="${compName}" data-audit-size="${auditSize}">
                <div class="variant-preview-content ${isTemplate ? 'variant-preview-content--template' : ''}">
                  ${v.html || '<span class="no-preview">No preview</span>'}
                </div>
                <div class="variant-preview-label">
                  <span class="qa-stoplight qa-stoplight--${status}" title="${statusLabel}"></span>
                  ${isPref ? '<span class="qa-preferred-badge" title="Preferred">Preferred</span>' : ''}
                  <span class="variant-name">${v.name}</span>
                  <span class="variant-usage">${v.usageCount || 0} uses</span>
                  ${hasNote ? `<span class="qa-comment-count" title="${(entry.note || '').replace(/"/g, '&quot;')}">1</span>` : ''}
                  <div class="qa-variant-actions stage-audit-actions">
                    <button class="qa-action-btn qa-action-btn--prefer${isPref ? ' qa-action-btn--active' : ''}" data-action="prefer">${isPref ? 'Unprefer' : 'Prefer'}</button>
                    <button class="qa-action-btn${hasNote ? ' qa-action-btn--active' : ''}" data-action="comment">${hasNote ? 'Edit' : 'Comment'}</button>
                    ${status === 'yellow' ? '<button class="qa-action-btn" data-action="process">Mark processed</button>' : ''}
                    ${status === 'orange' ? '<button class="qa-action-btn" data-action="approve">Approve</button>' : ''}
                    <button class="qa-action-btn qa-action-btn--block" data-action="block">${isFlagged ? 'Unblock' : 'Block'}</button>
                  </div>
                </div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Add inline audit log for this component
    let auditLogHtml = '';
    if (audit) {
      auditLogHtml = this.renderStageAuditLog(compName, variants, isTemplate);
    }

    // Multi-state grid (StateRenderer)
    let stateGridHtml = '';
    if (typeof StateRenderer !== 'undefined') {
      const renderer = new StateRenderer();
      stateGridHtml = renderer.buildComponentStateGrid(component);
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
      ${stateGridHtml}
      ${auditLogHtml}
    `;

    // Bind click events for variant cards (not on action buttons)
    this.componentPreview.querySelectorAll('.variant-preview-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't select variant when clicking audit action buttons
        if (e.target.closest('.qa-variant-actions')) return;
        const index = parseInt(card.dataset.index);
        this.variantSelect.value = index;
        this.renderComponentPreview(component, index);
      });
    });

    // Bind audit action buttons
    this.bindStageAuditActions(component, variantIndex);

    // Show specs
    this.showComponentSpecs(component, currentVariant);
  }

  /**
   * Render inline audit log for the current component on the stage
   */
  renderStageAuditLog(compName, variants, isTemplate) {
    const audit = this.variantAudit;
    if (!audit) return '';

    // Collect entries for this component
    const entries = [];
    variants.forEach(v => {
      const size = this.getAuditSize(v, isTemplate);
      const entry = audit.getAuditEntry(compName, size);
      if (entry.flagged || entry.note || entry.preferred) {
        const status = audit.getStatus(compName, size);
        entries.push({ size, entry, status });
      }
    });

    if (entries.length === 0) return '';

    const sizeLabels = audit.SIZE_LABELS || {};
    let html = `
      <div class="stage-audit-log">
        <h4>Audit Log</h4>
        <table class="qa-audit-table">
          <thead><tr>
            <th>Variant</th><th>Grid</th><th>Status</th><th>Note</th>
          </tr></thead>
          <tbody>
    `;

    entries.forEach(({ size, entry, status }) => {
      const statusLabel = entry.flagged ? 'Blocked'
        : entry.preferred ? 'Preferred'
        : entry.note && entry.processed ? 'Needs review'
        : entry.note ? 'To process' : 'Clean';
      const statusClass = entry.flagged ? 'status--blocked'
        : entry.preferred ? 'status--preferred'
        : entry.note && entry.processed ? 'status--review'
        : entry.note ? 'status--todo' : 'status--clean';
      const dotColor = entry.flagged ? '#ef4444'
        : entry.preferred ? '#3b82f6'
        : entry.note && entry.processed ? '#f97316'
        : entry.note ? '#eab308' : '#22c55e';
      const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:${dotColor}"></span>`;
      const prefTag = entry.preferred ? '<span class="qa-preferred-badge">Preferred</span> ' : '';
      const note = entry.note ? `<span class="note-text">${entry.note.replace(/</g, '&lt;')}</span>` : '';

      html += `<tr>
        <td>${size}</td>
        <td>${sizeLabels[size] || size}</td>
        <td class="${statusClass}">${dot}${statusLabel}</td>
        <td>${prefTag}${note}</td>
      </tr>`;
    });

    html += '</tbody></table>';
    html += `<div class="qa-actions">
      <button class="stage-audit-export">Copy as JSON</button>
    </div>`;
    html += '</div>';

    return html;
  }

  /**
   * Bind audit action button events on the component stage
   */
  bindStageAuditActions(component, currentVariantIndex) {
    const audit = this.variantAudit;
    if (!audit) return;

    const isTemplate = component.type?.startsWith('template-');

    // Action buttons on variant cards
    this.componentPreview.querySelectorAll('.stage-audit-actions .qa-action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.variant-preview-card');
        if (!card) return;
        const name = card.dataset.auditName;
        const size = card.dataset.auditSize;
        const action = btn.dataset.action;

        switch (action) {
          case 'prefer':
            audit.setPreferred(name, size, !audit.isPreferred(name, size));
            audit.renderAuditTable();
            this.renderComponentPreview(component, currentVariantIndex);
            break;
          case 'comment':
            this.openStageComment(card, name, size, component, currentVariantIndex);
            break;
          case 'process':
            audit.setProcessed(name, size, true);
            audit.renderAuditTable();
            this.renderComponentPreview(component, currentVariantIndex);
            break;
          case 'approve':
            audit.setNote(name, size, '');
            audit.setProcessed(name, size, false);
            audit.renderAuditTable();
            this.renderComponentPreview(component, currentVariantIndex);
            break;
          case 'block':
            const entry = audit.getAuditEntry(name, size);
            audit.setFlag(name, size, !entry.flagged);
            audit.renderAuditTable();
            this.renderComponentPreview(component, currentVariantIndex);
            break;
        }
      });
    });

    // Export button in audit log
    this.componentPreview.querySelector('.stage-audit-export')?.addEventListener('click', () => {
      const variants = component.variants || [];
      const compName = component.type;
      const data = [];

      variants.forEach(v => {
        const size = this.getAuditSize(v, isTemplate);
        const entry = audit.getAuditEntry(compName, size);
        if (entry.flagged || entry.note) {
          const sizeLabels = audit.SIZE_LABELS || {};
          data.push({
            name: compName,
            size,
            grid: sizeLabels[size] || size,
            status: entry.flagged ? 'blocked'
              : entry.note && entry.processed ? 'needs-review'
              : entry.note ? 'to-process' : 'clean',
            note: entry.note || null
          });
        }
      });

      navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
        this.showToast('Audit data copied to clipboard');
      });
    });
  }

  /**
   * Open inline comment on a variant card in the stage
   */
  openStageComment(card, name, size, component, currentVariantIndex) {
    const audit = this.variantAudit;
    if (!audit) return;

    // Close any existing comment
    this.closeStageComment();

    const entry = audit.getAuditEntry(name, size);
    const div = document.createElement('div');
    div.className = 'qa-comment stage-comment-active';
    div.innerHTML =
      '<textarea placeholder="How should this variant change?">' +
      (entry.note || '').replace(/</g, '&lt;') +
      '</textarea>' +
      '<div class="qa-comment__footer">' +
      '<span class="qa-comment__hint">Esc to close · auto-saves on blur</span>' +
      '</div>';

    card.appendChild(div);
    const ta = div.querySelector('textarea');
    ta.focus();

    const save = () => {
      audit.setNote(name, size, ta.value);
      audit.renderAuditTable();
    };

    ta.addEventListener('blur', () => {
      save();
      setTimeout(() => {
        this.closeStageComment();
        this.renderComponentPreview(component, currentVariantIndex);
      }, 50);
    });

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        save();
        this.closeStageComment();
        this.renderComponentPreview(component, currentVariantIndex);
      }
    });
  }

  /**
   * Close the active stage comment
   */
  closeStageComment() {
    const el = this.componentPreview?.querySelector('.stage-comment-active');
    if (el) el.remove();
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
  /**
   * Render the description field as editable with save-on-blur.
   * Shows a loader if AI description is being generated.
   */
  _renderEditableDescription(text, scope, key) {
    const ds = this.designSystem;
    const descEl = this.componentDescription;
    if (!descEl) return;

    const wrapper = descEl.parentElement;
    // Replace the description paragraph with an editable version
    wrapper.innerHTML = `
      <h4>Description</h4>
      <p id="component-description" class="editable-desc" contenteditable="true" data-scope="${scope}" data-key="${key}">${this._escHtml(text)}</p>
    `;

    // Re-bind reference
    this.componentDescription = DOMUtils.$('#component-description', wrapper.parentElement) || wrapper.querySelector('#component-description');

    // Save on blur
    const editableP = wrapper.querySelector('.editable-desc');
    editableP?.addEventListener('blur', () => {
      const newValue = editableP.textContent.trim();
      if (!ds) return;

      // Save to userDescriptions on the design system
      if (!ds.userDescriptions) ds.userDescriptions = {};
      if (scope === 'foundation') {
        if (!ds.userDescriptions.foundations) ds.userDescriptions.foundations = {};
        ds.userDescriptions.foundations[key] = newValue;
      } else {
        if (!ds.userDescriptions.components) ds.userDescriptions.components = {};
        if (!ds.userDescriptions.components[key]) ds.userDescriptions.components[key] = {};
        ds.userDescriptions.components[key].description = newValue;
      }
      if (window.systemicApp) window.systemicApp.saveDesignSystem(ds, true);
    });

    editableP?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        editableP.blur();
      }
    });

    // If no AI descriptions loaded yet, trigger background generation
    if (!ds?.aiDescriptions?.generatedAt && !ds?._aiDescLoading) {
      this._triggerAIDescriptions();
    }
  }

  /**
   * Generate AI descriptions for all foundations and components on initial load.
   * Shows a loader indicator in the description field while generating.
   */
  async _triggerAIDescriptions() {
    const ds = this.designSystem;
    if (!ds || ds._aiDescLoading || ds.aiDescriptions?.generatedAt) return;

    ds._aiDescLoading = true;

    // Show subtle loading indicator next to description
    const descEl = this.componentDescription;
    if (descEl) {
      const loader = document.createElement('span');
      loader.className = 'desc-ai-loader';
      loader.id = 'desc-ai-loader';
      loader.textContent = ' generating…';
      descEl.parentElement?.appendChild(loader);
    }

    try {
      const gen = new PrinciplesGenerator({
        supabaseUrl: SUPABASE_URL,
        supabaseKey: SUPABASE_ANON_KEY
      });
      const summary = gen._buildSummary(ds);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/systemic-analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          action: 'descriptions',
          designSystemSummary: summary,
        }),
      });

      if (res.ok) {
        const descriptions = await res.json();
        ds.aiDescriptions = descriptions;

        // Save to localStorage
        if (window.systemicApp) window.systemicApp.saveDesignSystem(ds, true);

        // Re-render current context if still viewing the same section
        if (this.currentSection && this.currentSection !== 'component') {
          const userDesc = ds.userDescriptions?.foundations?.[this.currentSection];
          if (!userDesc) {
            const aiDesc = descriptions.foundations?.[this.currentSection]?.description;
            if (aiDesc && this.componentDescription) {
              this.componentDescription.textContent = aiDesc;
            }
          }
        } else if (this.currentComponent) {
          const userDesc = ds.userDescriptions?.components?.[this.currentComponent.type]?.description;
          if (!userDesc) {
            const aiDesc = descriptions.components?.[this.currentComponent.type];
            if (aiDesc?.description && this.componentDescription) {
              this.componentDescription.textContent = aiDesc.description;
            }
            // Update when to use / when not to use / accessibility
            if (aiDesc?.whenToUse?.length > 0 && this.usageSection?.hidden) {
              this.usageSection.hidden = false;
              this.whenToUse.innerHTML = aiDesc.whenToUse.map(item => `<li>${item}</li>`).join('');
            }
            if (aiDesc?.whenNotToUse?.length > 0 && this.dontUseSection?.hidden) {
              this.dontUseSection.hidden = false;
              this.whenNotToUse.innerHTML = aiDesc.whenNotToUse.map(item => `<li>${item}</li>`).join('');
            }
            if (aiDesc?.accessibility?.length > 0 && this.a11ySection?.hidden) {
              this.a11ySection.hidden = false;
              this.accessibilityNotes.innerHTML = aiDesc.accessibility.map(item => `<li>${item}</li>`).join('');
            }
          }
        }
      }
    } catch (err) {
      console.warn('[Viewer] AI description generation failed:', err);
    } finally {
      ds._aiDescLoading = false;
      // Remove loader
      DOMUtils.$('#desc-ai-loader')?.remove();
    }
  }

  updateContextForFoundation(section) {
    const ds = this.designSystem;
    const docs = ds?.documentation?.foundations?.[section];
    const aiDescs = ds?.aiDescriptions?.foundations?.[section];

    // Design context — use AI description if available, else fallback
    const defaultDesc = section === 'principles'
      ? `Design principles and usage guidelines for ${ds?.name || 'this system'}.`
      : `Documentation for ${this.formatName(section)} tokens.`;

    const descText = ds?.userDescriptions?.foundations?.[section]
      || aiDescs?.description
      || docs?.description
      || defaultDesc;

    this._renderEditableDescription(descText, 'foundation', section);

    // Hide component-specific sections for foundations
    this.usageSection.hidden = true;
    this.dontUseSection.hidden = true;
    this.a11ySection.hidden = true;
    if (this.statesSection) this.statesSection.hidden = true;
    if (this.compPrinciplesSection) this.compPrinciplesSection.hidden = true;

    // Hide specs for principles
    if (section === 'principles') {
      this.componentSpecs.hidden = true;
      this.tokenList.innerHTML = '<p>No tokens for principles</p>';
      if (this.cssCode) this.cssCode.textContent = '';
      if (this.htmlCode) this.htmlCode.textContent = '';
      if (this.reactCode) this.reactCode.textContent = '';
    } else {
      // Code context - show token list
      this.updateTokenList(section);
      this.updateCodeBlocks(section);
    }
  }

  /**
   * Update context sidebar for component
   */
  updateContextForComponent(component) {
    const ds = this.designSystem;
    const guidelines = component.guidelines || {};
    const aiDesc = ds?.aiDescriptions?.components?.[component.type];
    const userDesc = ds?.userDescriptions?.components?.[component.type];

    // Design context — description (editable)
    const descText = userDesc?.description
      || aiDesc?.description
      || `${component.name} component extracted from the source website.`;
    this._renderEditableDescription(descText, 'component', component.type);

    // When to use — prefer AI-generated, then guidelines
    const whenToUse = aiDesc?.whenToUse || guidelines.whenToUse;
    if (whenToUse?.length > 0) {
      this.usageSection.hidden = false;
      this.whenToUse.innerHTML = whenToUse
        .map(item => `<li>${item}</li>`)
        .join('');
    } else {
      this.usageSection.hidden = true;
    }

    // When not to use
    const whenNotToUse = aiDesc?.whenNotToUse || guidelines.whenNotToUse;
    if (whenNotToUse?.length > 0) {
      this.dontUseSection.hidden = false;
      this.whenNotToUse.innerHTML = whenNotToUse
        .map(item => `<li>${item}</li>`)
        .join('');
    } else {
      this.dontUseSection.hidden = true;
    }

    // Accessibility
    const a11y = aiDesc?.accessibility || component.accessibility;
    if (a11y?.length > 0) {
      this.a11ySection.hidden = false;
      this.accessibilityNotes.innerHTML = a11y
        .map(item => `<li>${item}</li>`)
        .join('');
    } else {
      this.a11ySection.hidden = true;
    }

    // States section
    this.renderStatesSection(component);

    // Component-level principles (from already-generated system principles)
    this.renderComponentPrinciples(component);

    // Update code context
    this.updateTokenListForComponent(component);
    this.updateCodeBlocksForComponent(component);
  }

  /**
   * Inject component-specific usage principles into the context sidebar.
   * Reads from this.designSystem.principles.componentPrinciples[type].
   */
  renderComponentPrinciples(component) {
    if (!this.compPrinciplesSection || !this.compPrinciplesList) return;

    const rules = this.designSystem?.principles?.componentPrinciples?.[component.type];

    if (rules && rules.length > 0) {
      this.compPrinciplesList.innerHTML = rules.map(r => `
        <li class="comp-principles-item">
          <span class="comp-principles-item__rule">${this._escHtml(r.rule)}</span>
          ${r.rationale ? `<span class="comp-principles-item__rationale">${this._escHtml(r.rationale)}</span>` : ''}
        </li>
      `).join('');
      this.compPrinciplesSection.hidden = false;
    } else {
      this.compPrinciplesSection.hidden = true;
    }
  }

  /** HTML-escape helper */
  _escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

    // Update toggle buttons (in the app nav, not container)
    DOMUtils.$$('.toggle-btn').forEach(btn => {
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

    // Update state buttons (in the app nav, not container)
    DOMUtils.$$('.state-btn').forEach(btn => {
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
