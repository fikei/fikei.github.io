/**
 * Systemic - Main Application
 * Design System Generator powered by AI
 */

// Supabase Configuration
const SUPABASE_URL = 'https://atdqdfpdeytfuvvpsasz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0ZHFkZnBkZXl0ZnV2dnBzYXN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwODQzOTYsImV4cCI6MjA4NTY2MDM5Nn0.NHtQPeXM-xMC6MTTBRh6ETpmnUAsrfb2h7LAi0Y19M4';

class SystemicApp {
  constructor() {
    this.supabaseUrl = SUPABASE_URL;
    this.supabaseKey = SUPABASE_ANON_KEY;
    this.crawler = null;
    this.codeParser = null;
    this.figmaParser = null;
    this.tokenMapper = new TokenMapper();
    this.componentConsolidator = new ComponentConsolidator();
    this.docGenerator = new DocGenerator({
      aiEnabled: true,
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_ANON_KEY
    });
    this.stateRenderer = new StateRenderer();
    this.principlesGenerator = new PrinciplesGenerator({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_ANON_KEY
    });
    this.viewer = null;
    this.variantAudit = null;
    this.usageInspector = null;
    this.currentAudit = null;
    this.designSystems = [];
    this.debugMode = true; // Enable detailed logging
    this.debugLogs = []; // Store all debug logs for export

    this.init();
  }

  /**
   * Debug log - only logs when debugMode is enabled
   */
  debugLog(category, message, data = null) {
    if (!this.debugMode) return;

    const timestamp = new Date().toISOString();
    const prefix = `[Systemic:${category}]`;

    // Store for export
    this.debugLogs.push({
      timestamp,
      category,
      message,
      data: data ? JSON.parse(JSON.stringify(data)) : null
    });

    if (data) {
      console.log(`${prefix} ${message}`, data);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Export debug logs as JSON
   */
  exportDebugLogs() {
    const exportData = {
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      currentAudit: this.currentAudit,
      designSystemsCount: this.designSystems.length,
      designSystemsSummary: this.designSystems.map(ds => ({
        id: ds.id,
        name: ds.name,
        sourceUrl: ds.sourceUrl,
        stats: ds.stats
      })),
      logs: this.debugLogs
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Copy debug logs to clipboard
   */
  async copyDebugLogs() {
    try {
      const logs = this.exportDebugLogs();
      await navigator.clipboard.writeText(logs);
      this.showToast('Debug logs copied to clipboard!');
      return true;
    } catch (error) {
      console.error('Failed to copy:', error);
      this.showToast('Failed to copy - check console', 'error');
      return false;
    }
  }

  /**
   * Download debug logs as file
   */
  downloadDebugLogs() {
    const logs = this.exportDebugLogs();
    const blob = new Blob([logs], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `systemic-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('Debug log downloaded!');
  }

  /**
   * Clear debug logs
   */
  clearDebugLogs() {
    this.debugLogs = [];
    this.debugLog('SYSTEM', 'Debug logs cleared');
  }

  /**
   * Clean up duplicate design systems (keeps the one with most data)
   * Can be called from console: systemicApp.cleanupDuplicates()
   */
  cleanupDuplicates() {
    this.debugLog('CLEANUP', '=== Starting Duplicate Cleanup ===');
    const urlMap = new Map();

    // Group systems by URL key
    this.designSystems.forEach(ds => {
      const key = this.getUrlKey(ds.sourceUrl);
      if (!urlMap.has(key)) {
        urlMap.set(key, []);
      }
      urlMap.get(key).push(ds);
    });

    const newSystems = [];
    let removedCount = 0;

    urlMap.forEach((systems, urlKey) => {
      if (systems.length > 1) {
        // Sort by component count descending, keep the best one
        systems.sort((a, b) => (b.stats?.components || 0) - (a.stats?.components || 0));
        const keeper = systems[0];
        this.debugLog('CLEANUP', `URL "${urlKey}": keeping system ${keeper.id} (${keeper.stats?.components || 0} components), removing ${systems.length - 1} duplicates`);

        // Delete localStorage entries for duplicates
        systems.slice(1).forEach(dup => {
          localStorage.removeItem(`systemic-ds-${dup.id}`);
          removedCount++;
        });

        newSystems.push(keeper);
      } else {
        newSystems.push(systems[0]);
      }
    });

    this.designSystems = newSystems;
    localStorage.setItem('systemic-design-systems', JSON.stringify(this.designSystems));

    this.debugLog('CLEANUP', `Cleanup complete: removed ${removedCount} duplicate(s)`);
    this.showToast(`Cleaned up ${removedCount} duplicate design system(s)`);
    this.renderSystemsList();

    return { removed: removedCount, remaining: newSystems.length };
  }

  /**
   * Normalize a URL - handles messy user input
   */
  normalizeUrl(input) {
    if (!input) return null;

    let url = input.trim();

    this.debugLog('URL', `Normalizing input: "${url}"`);

    // Remove leading/trailing whitespace and quotes
    url = url.replace(/^["'\s]+|["'\s]+$/g, '');

    // Add protocol if missing
    if (!url.match(/^https?:\/\//i)) {
      // Check if it starts with www or looks like a domain
      if (url.match(/^(www\.)?[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}/i)) {
        url = 'https://' + url;
        this.debugLog('URL', 'Added https:// protocol');
      }
    }

    // Force HTTPS
    url = url.replace(/^http:/i, 'https:');

    try {
      const parsed = new URL(url);

      // Normalize hostname to lowercase
      parsed.hostname = parsed.hostname.toLowerCase();

      // Remove default ports
      if ((parsed.protocol === 'https:' && parsed.port === '443') ||
          (parsed.protocol === 'http:' && parsed.port === '80')) {
        parsed.port = '';
      }

      // Remove trailing slash from path (unless it's just "/")
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }

      // Remove empty hash
      if (parsed.hash === '#') {
        parsed.hash = '';
      }

      // Sort query parameters for consistency
      if (parsed.search) {
        const params = new URLSearchParams(parsed.search);
        const sortedParams = new URLSearchParams([...params.entries()].sort());
        parsed.search = sortedParams.toString();
      }

      const normalized = parsed.href;
      this.debugLog('URL', `Normalized to: "${normalized}"`);

      return normalized;

    } catch (e) {
      this.debugLog('URL', `Failed to parse URL: ${e.message}`);
      return null;
    }
  }

  /**
   * Get canonical URL key for comparison (strips www, trailing slash, etc.)
   */
  getUrlKey(url) {
    try {
      const parsed = new URL(url);
      // Remove www. prefix for comparison
      const hostname = parsed.hostname.replace(/^www\./i, '');
      // Create canonical key
      return `${hostname}${parsed.pathname}`.toLowerCase();
    } catch (e) {
      return url.toLowerCase();
    }
  }

  /**
   * Initialize the application
   */
  init() {
    this.bindElements();
    this.bindEvents();
    this.loadSavedSystems();
    this.initViewer();
    this.initVariantAudit();
    this.initUsageInspector();
    // Connect viewer to audit so component stage can show QA controls
    if (this.viewer && this.variantAudit) {
      this.viewer.variantAudit = this.variantAudit;
    }
    // Connect component filter to Usage Inspector
    DOMUtils.$('#qa-component-filter')?.addEventListener('change', (e) => {
      this._onQAComponentSelect(e.target.value);
    });
    this.initRouter();
  }

  /**
   * Load local design system from manifest.json + template-registry.json
   * This is "self-scan" — loads our own design system without crawling
   */
  async loadLocalDesignSystem() {
    this.debugLog('LOCAL', '=== Loading Local Design System ===');

    try {

      // Fetch manifest, template registry, and widget registry in parallel
      const [manifestRes, registryRes, widgetRegRes] = await Promise.all([
        fetch('/design-system/manifest.json'),
        fetch('/design-system/template-registry.json'),
        fetch('/design-system/widget-registry.json')
      ]);

      if (!manifestRes.ok) throw new Error(`Failed to load manifest: ${manifestRes.status}`);
      if (!registryRes.ok) throw new Error(`Failed to load template registry: ${registryRes.status}`);

      const manifest = await manifestRes.json();
      const registry = await registryRes.json();
      const widgetRegistry = widgetRegRes.ok ? await widgetRegRes.json() : null;

      this.debugLog('LOCAL', 'Loaded manifest:', {
        tokens: Object.keys(manifest.tokens),
        components: Object.keys(manifest.components).length,
        atoms: Object.keys(manifest.widgets.atoms).length,
        molecules: Object.keys(manifest.widgets.molecules).length,
        sizes: Object.keys(manifest.widgets.sizes).length,
        bodyModifiers: Object.keys(manifest.widgets.bodyModifiers).length
      });

      // Transform manifest into Systemic design system format
      const designSystem = this.transformManifestToDesignSystem(manifest, registry, widgetRegistry);
      this.debugLog('LOCAL', `Transformed: ${designSystem.components?.length} components, first template HTML starts with: ${designSystem.components?.find(c => c.type?.startsWith('template-'))?.variants?.[0]?.html?.slice(0, 80)}...`);

      // Save it (update if already exists)
      const isUpdate = this.designSystems.some(ds => ds.id === designSystem.id);
      this.debugLog('LOCAL', `Saving (isUpdate: ${isUpdate})`);
      this.saveDesignSystem(designSystem, isUpdate);

      // Load into viewer and QA
      this.setActiveSystem(designSystem);

      this.showToast('Local design system loaded');
      this.navigateTo('docs/color');

    } catch (error) {
      this.debugLog('LOCAL', 'Error loading local design system:', error);
      this.showToast(`Failed to load local design system: ${error.message}`, 'error');
    }
  }

  /**
   * Transform manifest.json + template-registry.json + widget-registry.json into Systemic's design system format
   */
  transformManifestToDesignSystem(manifest, registry, widgetRegistry) {
    const id = 'local-ctrl-design-system';

    // Build token data
    const darkColors = manifest.tokens.colors.dark || {};
    const tokens = {
      colors: {
        primary: { hex: darkColors['--fg'] || '#fff', role: 'primary' },
        secondary: { hex: darkColors['--fg-muted'] || '#888', role: 'secondary' },
        error: { hex: darkColors['--color-error'] || '#c00', role: 'error' },
        success: { hex: darkColors['--color-success'] || '#0f0', role: 'success' },
        warning: { hex: darkColors['--color-warning'] || '#f90', role: 'warning' },
        neutral: [
          { hex: darkColors['--gray-100'] || '#111' },
          { hex: darkColors['--gray-200'] || '#1a1a1a' },
          { hex: darkColors['--gray-300'] || '#222' },
          { hex: darkColors['--gray-400'] || '#333' },
          { hex: darkColors['--gray-500'] || '#666' },
          { hex: darkColors['--gray-600'] || '#888' },
          { hex: darkColors['--gray-700'] || '#999' },
          { hex: darkColors['--gray-800'] || '#ccc' },
          { hex: darkColors['--gray-900'] || '#e0e0e0' }
        ],
        surface: [
          { hex: darkColors['--bg'] || '#111' },
          { hex: darkColors['--bg-surface'] || '#1a1a1a' },
          { hex: darkColors['--bg-elevated'] || '#222' }
        ]
      },
      typography: {
        primary: manifest.tokens.typography['--font-primary'] || 'Space Grotesk',
        secondary: manifest.tokens.typography['--font-serif'] || 'Georgia',
        typescale: Object.entries(manifest.tokens.typography)
          .filter(([k]) => k.startsWith('--text-'))
          .map(([k, v]) => ({
            value: v,
            materialRole: k.replace('--text-', ''),
            token: k
          }))
      },
      spacing: {
        baseUnit: 4,
        scale: Object.entries(manifest.tokens.spacing)
          .map(([k, v]) => ({
            value: parseInt(v),
            normalized: parseInt(v),
            token: k
          }))
          .sort((a, b) => a.value - b.value)
      },
      elevation: {
        hasShadows: false
      }
    };

    // Build components from manifest + registry
    const components = [];

    // Add UI components from components.css
    for (const [name, comp] of Object.entries(manifest.components)) {
      components.push({
        type: name,
        name: this.formatComponentName(name),
        variants: comp.modifiers.length > 0
          ? comp.modifiers.map(mod => ({
              name: `${name}--${mod}`,
              classes: [`${name}`, `${name}--${mod}`],
              html: `<div class="${name} ${name}--${mod}">${this.formatComponentName(name)} (${mod})</div>`,
              usageCount: 1
            }))
          : [{ name: 'default', classes: [name], html: `<div class="${name}">${this.formatComponentName(name)}</div>`, usageCount: 1 }],
        totalUsage: comp.modifiers.length || 1,
        states: {
          hasDefault: true,
          hasHover: comp.states.includes('hover'),
          hasFocus: comp.states.includes('focus'),
          hasDisabled: comp.states.includes('disabled')
        },
        source: 'components.css'
      });
    }

    // Add widget atoms
    for (const [name, atom] of Object.entries(manifest.widgets.atoms)) {
      components.push({
        type: name,
        name: this.formatComponentName(name),
        variants: atom.modifiers.length > 0
          ? atom.modifiers.map(mod => ({
              name: `${name}--${mod}`,
              classes: [name, `${name}--${mod}`],
              html: `<span class="${name} ${name}--${mod}">${this.formatComponentName(name)} (${mod})</span>`,
              usageCount: 1
            }))
          : [{ name: 'default', classes: [name], html: `<span class="${name}">${this.formatComponentName(name)}</span>`, usageCount: 1 }],
        totalUsage: atom.modifiers.length || 1,
        source: 'widgets.css (atom)'
      });
    }

    // Add widget molecules
    for (const [name, mol] of Object.entries(manifest.widgets.molecules)) {
      components.push({
        type: name,
        name: this.formatComponentName(name),
        variants: mol.modifiers.length > 0
          ? mol.modifiers.map(mod => ({
              name: `${name}--${mod}`,
              classes: [name, `${name}--${mod}`],
              html: `<div class="${name} ${name}--${mod}">${this.formatComponentName(name)} (${mod})</div>`,
              usageCount: 1
            }))
          : [{ name: 'default', classes: [name], html: `<div class="${name}">${this.formatComponentName(name)}</div>`, usageCount: 1 }],
        totalUsage: mol.modifiers.length || 1,
        source: 'widgets.css (molecule)'
      });
    }

    // Add body modifier templates as components (from registry)
    // Generate a variant for ALL 15 grid sizes (like widgets.html),
    // not just validSizes, so QA can audit every permutation.
    const ALL_SIZES = [
      'sm', 'med', 'wide', 'banner',
      'tall', 'lg', 'xl', 'pano',
      'col', 'poster', 'max', 'cinema',
      'board', 'wall', 'full'
    ];

    if (registry?.templates) {
      for (const [name, tmpl] of Object.entries(registry.templates)) {
        const validSet = new Set(tmpl.validSizes || []);
        components.push({
          type: `template-${name}`,
          name: `Template: ${this.formatComponentName(name)}`,
          variants: ALL_SIZES.map(size => ({
            name: `${name} @ ${size}`,
            classes: ['w-shell', `w-shell--${size}`, 'w-body', tmpl.bodyModifier],
            html: this.generateTemplatePreviewHTML(name, size, tmpl),
            usageCount: validSet.has(size) ? 1 : 0
          })),
          totalUsage: ALL_SIZES.length,
          validSizes: tmpl.validSizes || [],
          guidelines: {
            whenToUse: [tmpl.description],
            whenNotToUse: tmpl.validSizes
              ? [`Recommended sizes: ${tmpl.validSizes.join(', ')}`]
              : []
          },
          source: 'template-registry.json',
          boardsStatus: tmpl.boardsStatus
        });
      }
    }

    // Add widgets from widget-registry.json, grouped by template
    if (widgetRegistry?.widgets && registry?.templates) {
      for (const [widgetId, widget] of Object.entries(widgetRegistry.widgets)) {
        const tmpl = registry.templates[widget.template];
        if (!tmpl) continue;
        const validSet = new Set(tmpl.validSizes || []);
        components.push({
          type: `widget-${widgetId}`,
          name: widget.name,
          templateRef: widget.template,
          category: widget.category,
          archetype: widget.archetype,
          variants: ALL_SIZES.map(size => ({
            name: `${widgetId} @ ${size}`,
            classes: ['w-shell', `w-shell--${size}`, 'w-body', tmpl.bodyModifier],
            html: this.generateTemplatePreviewHTML(widget.template, size, tmpl),
            usageCount: validSet.has(size) ? 1 : 0
          })),
          totalUsage: ALL_SIZES.length,
          validSizes: tmpl.validSizes || [],
          guidelines: {
            whenToUse: [`${widget.name} — ${widget.archetype} widget for ${widget.category}`],
            whenNotToUse: tmpl.validSizes
              ? [`Uses ${this.formatComponentName(widget.template)} template. Recommended sizes: ${tmpl.validSizes.join(', ')}`]
              : []
          },
          source: `widget:${widget.template}`,
          boardsStatus: tmpl.boardsStatus
        });
      }
    }

    return {
      id,
      name: 'CTRL Design System',
      sourceUrl: window.location.origin,
      tokens,
      components,
      createdAt: manifest.version,
      updatedAt: manifest.version,
      manifest,
      registry,
      widgetRegistry
    };
  }

  /**
   * Size pixel widths — matches widgets.html variant-item widths
   * Row height is ~160px (content fills naturally)
   */
  static SIZE_WIDTHS = {
    sm: 200,   med: 420,   wide: 640,   banner: 860,
    tall: 200, lg: 420,    xl: 640,     pano: 860,
    col: 200,  poster: 420, max: 640,   cinema: 860,
    board: 420, wall: 640,  full: 860,
  };

  static SIZE_ROWS = {
    sm: 1,   med: 1,   wide: 1,   banner: 1,
    tall: 2, lg: 2,    xl: 2,     pano: 2,
    col: 3,  poster: 3, max: 3,   cinema: 3,
    board: 4, wall: 4,  full: 4,
  };

  static SIZE_LABELS = {
    sm: '1x1', med: '2x1', wide: '3x1', banner: '4x1',
    tall: '1x2', lg: '2x2', xl: '3x2', pano: '4x2',
    col: '1x3', poster: '2x3', max: '3x3', cinema: '4x3',
    board: '2x4', wall: '3x4', full: '4x4',
  };

  /**
   * Generate a self-contained preview HTML for a template at a given size.
   * Each template type renders dummy content matching its real layout pattern.
   */
  generateTemplatePreviewHTML(templateName, size, tmpl) {
    const w = SystemicApp.SIZE_WIDTHS[size] || 420;
    const rows = SystemicApp.SIZE_ROWS[size] || 1;
    const h = rows * 160;

    const s = {
      label: 'font-size:9px;text-transform:uppercase;letter-spacing:1px;color:var(--fg-muted)',
      meta: 'font-size:10px;color:var(--fg-subtle)',
      title: 'font-size:13px;font-weight:500;color:var(--fg)',
      display: 'font-size:18px;font-weight:600;color:var(--fg);line-height:1.2',
      prose: 'font-size:11px;color:var(--fg-muted);line-height:1.5',
      badge: 'font-size:9px;padding:2px 6px;border:1px solid var(--border-subtle);color:var(--fg-muted);display:inline-block',
      badgeFilled: 'font-size:9px;padding:2px 6px;background:var(--fg);color:var(--bg);display:inline-block',
      row: 'display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) 0;border-top:1px solid var(--border-subtle)',
      thumb: 'width:28px;height:28px;background:var(--bg-elevated);flex-shrink:0',
      axis: 'display:flex;flex-direction:column;gap:2px',
      track: 'height:3px;background:var(--bg-elevated);position:relative',
      marker: 'position:absolute;top:-2px;width:7px;height:7px;background:var(--fg);border-radius:50%',
      col: 'flex:1;display:flex;flex-direction:column;gap:var(--space-2)',
      divider: 'width:1px;background:var(--border-subtle);align-self:stretch',
      dividerH: 'height:1px;background:var(--border-subtle)',
      section: 'display:flex;flex-direction:column;gap:var(--space-1)',
    };

    const bodyContent = this.getTemplateBodyContent(templateName, s);

    return `<div style="display:flex;flex-direction:column;width:${w}px;height:${h}px;overflow:hidden;border:1px solid var(--border-subtle);background:var(--bg-surface);">
        <div style="display:flex;align-items:center;gap:var(--space-2);padding:var(--space-2) var(--space-3);flex-shrink:0;">
          <span style="${s.label};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">${this.formatComponentName(templateName)}</span>
          <span style="${s.badge}">AI</span>
        </div>
        <div style="flex:1;min-height:0;padding:var(--space-3);overflow:hidden;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:var(--space-2);">
          ${bodyContent}
        </div>
      </div>`;
  }

  /**
   * Get template-specific body content with dummy data matching the layout pattern
   */
  getTemplateBodyContent(name, s) {
    switch (name) {
      case 'verdict':
        return `
          <div style="text-align:center;flex:1;display:flex;flex-direction:column;justify-content:center;gap:var(--space-2)">
            <div style="${s.display}">Bold vs Minimal</div>
            <div style="${s.meta}">3 items lean warm, 2 lean cool</div>
            <div style="display:flex;gap:var(--space-1);justify-content:center;flex-wrap:wrap;margin-top:var(--space-1)">
              <span style="${s.badgeFilled}">Bold</span>
              <span style="${s.badge}">vs</span>
              <span style="${s.badgeFilled}">Minimal</span>
            </div>
          </div>`;

      case 'narrative':
        return `
          <p style="${s.prose};margin:0">Your recent saves share an underlying theme: <strong style="color:var(--fg)">the tension between craft and convenience</strong>. You're drawn to handmade details but keep choosing mass-market.</p>
          <div style="display:flex;gap:var(--space-1);flex-wrap:wrap;margin-top:auto">
            <span style="${s.badge}">Craft</span>
            <span style="${s.badge}">Design</span>
          </div>`;

      case 'list':
        return `
          <div style="${s.row};border-top:none;padding-top:0"><div style="${s.thumb}"></div><div><div style="${s.title}">Golden Gate Bridge</div><div style="${s.meta}">Start here — morning light</div></div></div>
          <div style="${s.row}"><div style="${s.thumb}"></div><div><div style="${s.title}">Tartine Bakery</div><div style="${s.meta}">12 min drive — lunch stop</div></div></div>
          <div style="${s.row}"><div style="${s.thumb}"></div><div><div style="${s.title}">SFMOMA</div><div style="${s.meta}">8 min walk — afternoon</div></div></div>`;

      case 'spectrum':
        return `
          <div style="${s.axis}"><div style="display:flex;justify-content:space-between"><span style="${s.label}">Read</span><span style="${s.label}">Watch</span></div><div style="${s.track}"><div style="${s.marker};left:35%"></div></div></div>
          <div style="${s.axis}"><div style="display:flex;justify-content:space-between"><span style="${s.label}">Browse</span><span style="${s.label}">Buy</span></div><div style="${s.track}"><div style="${s.marker};left:70%"></div></div></div>
          <div style="${s.axis}"><div style="display:flex;justify-content:space-between"><span style="${s.label}">Solo</span><span style="${s.label}">Social</span></div><div style="${s.track}"><div style="${s.marker};left:25%"></div></div></div>
          <div style="${s.meta};margin-top:auto">Based on 34 saves</div>`;

      case 'split':
        return `
          <div style="display:flex;gap:var(--space-3);flex:1">
            <div style="${s.col}"><div style="${s.label}">Your Items</div><div style="${s.title}">White sneakers</div><div style="${s.meta}">Nike</div><div style="${s.title}">Blue jeans</div><div style="${s.meta}">Levi's</div></div>
            <div style="${s.divider}"></div>
            <div style="${s.col}"><div style="${s.label}">Suggestions</div><div style="${s.title}">Canvas tote</div><div style="${s.meta}">Baggu</div><div style="${s.title}">Sunglasses</div><div style="${s.meta}">Ray-Ban</div></div>
          </div>`;

      case 'comparison':
        return `
          <div style="display:flex;gap:var(--space-2);flex:1;align-items:center">
            <div style="${s.col};text-align:center"><div style="${s.title}">Notion</div><div style="${s.meta}">Your current pick</div><div style="display:flex;gap:2px;justify-content:center;margin-top:var(--space-1)"><span style="${s.badge}">Docs</span><span style="${s.badge}">Wiki</span></div></div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:2px"><div style="${s.divider};height:24px"></div><span style="${s.label}">vs</span><div style="${s.divider};height:24px"></div></div>
            <div style="${s.col};text-align:center"><div style="${s.title}">Obsidian</div><div style="${s.meta}">Worth trying</div><div style="display:flex;gap:2px;justify-content:center;margin-top:var(--space-1)"><span style="${s.badge}">Local</span><span style="${s.badge}">MD</span></div></div>
          </div>`;

      case 'choices':
        return `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2);flex:1">
            <div style="border:1px solid var(--border-subtle);padding:var(--space-2);display:flex;flex-direction:column;gap:2px"><div style="${s.title}">Plan A</div><div style="${s.meta}">Quick & safe</div></div>
            <div style="border:1px solid var(--border-subtle);padding:var(--space-2);display:flex;flex-direction:column;gap:2px"><div style="${s.title}">Plan B</div><div style="${s.meta}">Bold & risky</div></div>
            <div style="border:1px solid var(--border-subtle);padding:var(--space-2);display:flex;flex-direction:column;gap:2px"><div style="${s.title}">Plan C</div><div style="${s.meta}">Balanced</div></div>
          </div>`;

      case 'checklist':
        return `
          <div style="${s.row};border-top:none;padding-top:0"><span style="width:12px;height:12px;border:1px solid var(--fg-muted);flex-shrink:0"></span><div style="${s.title}">Return running shoes</div></div>
          <div style="${s.row}"><span style="width:12px;height:12px;border:1px solid var(--fg-muted);flex-shrink:0;background:var(--fg)"></span><div style="${s.title};text-decoration:line-through;color:var(--fg-subtle)">Cancel trial subscription</div></div>
          <div style="${s.row}"><span style="width:12px;height:12px;border:1px solid var(--fg-muted);flex-shrink:0"></span><div style="${s.title}">Compare prices on jacket</div></div>
          <div style="${s.meta};margin-top:auto">1 of 3 done</div>`;

      case 'suggestion':
        return `
          <div style="height:48px;background:var(--bg-elevated);margin-bottom:var(--space-2)"></div>
          <div style="${s.title}">Try this instead</div>
          <div style="${s.prose}">Based on what you've been saving, this fits your style better than your current pick.</div>
          <div style="display:flex;gap:var(--space-2);margin-top:auto">
            <span style="${s.badgeFilled}">View</span>
            <span style="${s.badge}">Skip</span>
          </div>`;

      case 'grouped':
        return `
          <div style="${s.section}"><div style="${s.label}">Morning</div><div style="${s.title}">Read: Morning Brew</div><div style="${s.meta}">5 min — from your saves</div></div>
          <div style="${s.dividerH}"></div>
          <div style="${s.section}"><div style="${s.label}">Afternoon</div><div style="${s.title}">Listen: Huberman Lab</div><div style="${s.meta}">Saved episode — 45 min</div></div>
          <div style="${s.dividerH}"></div>
          <div style="${s.section}"><div style="${s.label}">Evening</div><div style="${s.title}">Watch: Chef's Table</div><div style="${s.meta}">Next unwatched — S7E2</div></div>`;

      default:
        return `<div style="${s.meta}">Template preview</div>`;
    }
  }

  /**
   * Format component name for display (w-text--label → W Text Label)
   */
  formatComponentName(name) {
    return name
      .replace(/^w-/, '')
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Bind DOM elements
   */
  bindElements() {
    // Navigation
    this.appNav = DOMUtils.$('#app-nav');
    this.viewPanels = DOMUtils.$$('.view-panel');

    // Audit view
    this.auditForm = DOMUtils.$('#audit-form');
    this.auditFormSection = DOMUtils.$('#audit-form-section');
    this.auditProgressSection = DOMUtils.$('#audit-progress-section');
    this.auditUrlDisplay = DOMUtils.$('#audit-url-display');
    this.auditStatusText = DOMUtils.$('#audit-status-text');
    this.auditProgressFill = DOMUtils.$('#audit-progress-fill');
    this.pagesCrawled = DOMUtils.$('#pages-crawled');
    this.tokensExtracted = DOMUtils.$('#tokens-extracted');
    this.componentsFound = DOMUtils.$('#components-found');
    this.crawlLog = DOMUtils.$('#crawl-log');
    this.cancelAuditBtn = DOMUtils.$('#cancel-audit');

    // Auth type toggle
    this.authTypeSelect = DOMUtils.$('#auth-type');
    this.authDataGroup = DOMUtils.$('#auth-data-group');

    // Systems view
    this.systemsGrid = DOMUtils.$('#systems-grid');

    // Theme toggle
    this.themeToggle = DOMUtils.$('#theme-toggle');

    // Toast container
    this.toastContainer = DOMUtils.$('#toast-container');

    // Scan modal
    this.scanModal = DOMUtils.$('#scan-modal');
    this.scanModalBackdrop = DOMUtils.$('#scan-modal-backdrop');
    this.scanModalClose = DOMUtils.$('#scan-modal-close');
    this.scanUrlInput = DOMUtils.$('#scan-url-input');
    this.scanUrlSubmit = DOMUtils.$('#scan-url-submit');
    this.scanLocalBtn = DOMUtils.$('#scan-local-btn');

    // Scan modal — new source tabs
    this.scanFigmaUrl = DOMUtils.$('#scan-figma-url');
    this.scanFigmaToken = DOMUtils.$('#scan-figma-token');
    this.scanFigmaSubmit = DOMUtils.$('#scan-figma-submit');
    this.scanGithubUrl = DOMUtils.$('#scan-github-url');
    this.scanGithubToken = DOMUtils.$('#scan-github-token');
    this.scanGithubSubmit = DOMUtils.$('#scan-github-submit');
  }

  /**
   * Bind event listeners
   */
  bindEvents() {
    // Audit form submission
    this.auditForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.startAudit();
    });

    // Cancel audit
    this.cancelAuditBtn?.addEventListener('click', () => this.cancelAudit());

    // Debug log export buttons (audit progress view)
    DOMUtils.$('#copy-debug-log')?.addEventListener('click', () => this.copyDebugLogs());
    DOMUtils.$('#download-debug-log')?.addEventListener('click', () => this.downloadDebugLogs());

    // Dev menu
    this.initDevMenu();

    // Auth type change
    this.authTypeSelect?.addEventListener('change', () => {
      const showAuthData = this.authTypeSelect.value !== 'none';
      if (this.authDataGroup) {
        this.authDataGroup.hidden = !showAuthData;
      }
    });

    // Theme toggle
    this.themeToggle?.addEventListener('click', () => this.toggleTheme());

    // Scan modal
    this.scanModalClose?.addEventListener('click', () => this.closeScanModal());
    this.scanModalBackdrop?.addEventListener('click', () => this.closeScanModal());
    this.scanUrlSubmit?.addEventListener('click', () => {
      const url = this.scanUrlInput?.value?.trim();
      if (url) {
        this.closeScanModal();
        // Populate the audit form and navigate
        const auditUrlInput = DOMUtils.$('#audit-url');
        if (auditUrlInput) auditUrlInput.value = url;
        this.navigateTo('audit');
        // Auto-submit the audit form after a tick so the view is active
        setTimeout(() => this.startAudit(), 100);
      }
    });
    this.scanUrlInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.scanUrlSubmit?.click();
      }
    });
    this.scanLocalBtn?.addEventListener('click', () => {
      this.closeScanModal();
      this.loadLocalDesignSystem();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.scanModal?.classList.contains('open')) {
        this.closeScanModal();
      }
    });

    // "Run a scan" button in initial HTML nav
    DOMUtils.$('#run-scan-btn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openScanModal();
    });

    // Scan modal — tab switching
    this.scanModal?.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      const targetTab = tab.dataset.tab;
      this.scanModal.querySelectorAll('.scan-modal__tab').forEach(t => {
        const active = t.dataset.tab === targetTab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      this.scanModal.querySelectorAll('.scan-modal__panel').forEach(p => {
        const active = p.dataset.panel === targetTab;
        p.classList.toggle('active', active);
        p.hidden = !active;
      });
    });

    // Figma scan submit
    this.scanFigmaSubmit?.addEventListener('click', () => {
      const url = this.scanFigmaUrl?.value?.trim();
      const token = this.scanFigmaToken?.value?.trim();
      if (!url) { this.showToast('Enter a Figma file URL', 'error'); return; }
      if (!token) { this.showToast('A Figma Personal Access Token is required', 'error'); return; }
      // Persist token for session
      try { localStorage.setItem('systemic-figma-token', token); } catch {}
      this.closeScanModal();
      this.startFigmaScan(url, token);
    });

    // GitHub repo scan submit
    this.scanGithubSubmit?.addEventListener('click', () => {
      const url = this.scanGithubUrl?.value?.trim();
      const token = this.scanGithubToken?.value?.trim() || null;
      if (!url) { this.showToast('Enter a GitHub repo URL', 'error'); return; }
      if (token) { try { localStorage.setItem('systemic-github-token', token); } catch {} }
      this.closeScanModal();
      this.startGitHubScan(url, token);
    });
  }

  /**
   * Initialize dev menu toggle and actions
   */
  initDevMenu() {
    const trigger = DOMUtils.$('#dev-menu-trigger');
    const dropdown = DOMUtils.$('#dev-menu-dropdown');
    if (!trigger || !dropdown) return;

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.addEventListener('click', (e) => e.stopPropagation());

    // Actions
    DOMUtils.$('#dev-reload-local')?.addEventListener('click', () => {
      this.loadLocalDesignSystem();
      dropdown.classList.remove('open');
    });

    DOMUtils.$('#dev-cleanup-duplicates')?.addEventListener('click', () => {
      this.cleanupDuplicates();
      dropdown.classList.remove('open');
    });

    DOMUtils.$('#dev-copy-debug-log')?.addEventListener('click', () => {
      this.copyDebugLogs();
      dropdown.classList.remove('open');
    });

    DOMUtils.$('#dev-download-debug-log')?.addEventListener('click', () => {
      this.downloadDebugLogs();
      dropdown.classList.remove('open');
    });

    DOMUtils.$('#dev-clear-debug-log')?.addEventListener('click', () => {
      this.clearDebugLogs();
      this.showToast('Debug log cleared');
      dropdown.classList.remove('open');
    });

    DOMUtils.$('#dev-clear-all')?.addEventListener('click', () => {
      if (confirm('Delete ALL design systems and debug data? This cannot be undone.')) {
        this.designSystems.forEach(ds => localStorage.removeItem(`systemic-ds-${ds.id}`));
        this.designSystems = [];
        localStorage.removeItem('systemic-design-systems');
        this.clearDebugLogs();
        this.renderSystemsList();
        this.showToast('All data cleared');
      }
      dropdown.classList.remove('open');
    });
  }

  /**
   * Initialize hash-based router
   */
  initRouter() {
    // Listen for hash changes
    window.addEventListener('hashchange', () => this.handleRoute());

    // Handle initial route
    this.handleRoute();
  }

  /**
   * Parse the current hash into route segments
   * Examples: #systems, #audit, #docs, #docs/color, #docs/component/button
   */
  parseHash() {
    const hash = window.location.hash.slice(1) || 'systems';
    const parts = hash.split('/');
    return {
      view: parts[0] || 'systems',
      section: parts[1] || null,
      detail: parts[2] || null
    };
  }

  /**
   * Handle route changes based on URL hash
   */
  handleRoute() {
    const route = this.parseHash();

    // If navigating to docs/qa/principles without a loaded system, try to restore
    if ((route.view === 'docs' || route.view === 'qa' || route.view === 'principles') && !this.viewer?.designSystem) {
      const restored = this.restoreActiveSystem();
      if (!restored) {
        // No system to restore — redirect to systems list
        window.location.hash = 'systems';
        return;
      }
    }

    // Switch to the correct view panel
    this.activateView(route.view);

    // Render progressive nav for the current view
    this.renderNav(route);

    // Handle sub-routes for docs view
    if (route.view === 'docs') {
      if (this.viewer?.designSystem && route.section) {
        const foundations = ['color', 'typography', 'spacing', 'elevation', 'examples'];
        if (foundations.includes(route.section)) {
          this.viewer.selectFoundation(route.section);
        } else if (route.section === 'component' && route.detail) {
          const comp = this.viewer.designSystem.components?.find(
            c => c.type === route.detail
          );
          if (comp) {
            this.viewer.selectComponent(comp);
          }
        }
      }
    }

    // Handle QA view
    if (route.view === 'qa') {
      this.variantAudit?.init();
      // Deep link to a specific component: #qa/component-name
      if (route.section && this.variantAudit) {
        this.variantAudit.show(route.section);
      }
    }

    // Load systems list when switching to systems view
    if (route.view === 'systems') {
      this.renderSystemsList();
    }

    // Render principles view
    if (route.view === 'principles') {
      this.renderPrinciples();
    }
  }

  /**
   * Activate a view panel
   */
  activateView(view) {
    this.viewPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `${view}-view`);
    });
  }

  /**
   * Render progressive navigation based on current route
   */
  renderNav(route) {
    if (!this.appNav) return;

    switch (route.view) {
      case 'systems':
        this.appNav.innerHTML = `
          <a href="#systems" class="docs-nav__link active" data-nav="systems">My Systems</a>
          <span class="docs-nav__spacer"></span>
          <button class="btn btn--filled btn--sm" id="nav-run-scan-btn">Run a scan</button>
        `;
        DOMUtils.$('#nav-run-scan-btn')?.addEventListener('click', () => this.openScanModal());
        break;

      case 'audit':
        this.appNav.innerHTML = `
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="#systems" class="breadcrumb-link">Systems</a>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">Audit</span>
          </nav>
          <span class="docs-nav__spacer"></span>
        `;
        break;

      case 'qa': {
        const qaSystemName = this.viewer?.designSystem?.name || 'System';
        this.appNav.innerHTML = `
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="#systems" class="breadcrumb-link">Systems</a>
            <span class="breadcrumb-sep">/</span>
            <a href="#docs/color" class="breadcrumb-link">${qaSystemName}</a>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">Variant Audit</span>
          </nav>
          <span class="docs-nav__spacer"></span>
        `;
        break;
      }

      case 'principles': {
        const pSystemName = this.viewer?.designSystem?.name || 'System';
        this.appNav.innerHTML = `
          <nav class="breadcrumb" aria-label="Breadcrumb">
            <a href="#systems" class="breadcrumb-link">Systems</a>
            <span class="breadcrumb-sep">/</span>
            <a href="#docs/color" class="breadcrumb-link">${pSystemName}</a>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">Principles</span>
          </nav>
          <span class="docs-nav__spacer"></span>
        `;
        break;
      }

      case 'docs':
        this.renderDocsNav(route);
        break;

      default:
        this.appNav.innerHTML = `
          <a href="#systems" class="docs-nav__link">My Systems</a>
          <span class="docs-nav__spacer"></span>
        `;
    }
  }

  /**
   * Render the docs-specific navigation with foundation links and dropdowns
   */
  renderDocsNav(route) {
    const systemName = this.viewer?.designSystem?.name || 'System';
    const components = this.viewer?.designSystem?.components || [];

    // Group components by source for structured dropdown
    const groupOrder = [
      { source: 'components.css', label: 'Components' },
      { source: 'widgets.css (atom)', label: 'Widget Atoms' },
      { source: 'widgets.css (molecule)', label: 'Widget Molecules' },
      { source: 'template-registry.json', label: 'Templates' },
    ];
    const grouped = {};
    const ungrouped = [];
    const widgetsByTemplate = {};
    for (const c of components) {
      const key = c.source || '';
      if (key.startsWith('widget:')) {
        const tmplName = key.slice(7);
        (widgetsByTemplate[tmplName] = widgetsByTemplate[tmplName] || []).push(c);
      } else if (key) {
        (grouped[key] = grouped[key] || []).push(c);
      } else {
        ungrouped.push(c);
      }
    }
    let componentOptions = '';
    // Render ungrouped items first (e.g. crawled design systems with no source)
    for (const c of ungrouped) {
      const name = c.name || c.type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const count = c.variants?.length || 0;
      componentOptions += `<option value="${c.type}">${name} (${count})</option>`;
    }
    // Render grouped items with optgroup headers
    for (const { source, label } of groupOrder) {
      const items = grouped[source];
      if (!items || items.length === 0) continue;
      componentOptions += `<optgroup label="${label}">`;
      for (const c of items) {
        let name = c.name || c.type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        // Strip redundant "Template: " prefix inside Templates optgroup
        if (source === 'template-registry.json') name = name.replace(/^Template:\s*/, '');
        const count = c.variants?.length || 0;
        componentOptions += `<option value="${c.type}">${name} (${count})</option>`;

        // After each template, render its widgets as indented options
        if (source === 'template-registry.json') {
          const tmplKey = c.type.replace('template-', '');
          const widgets = widgetsByTemplate[tmplKey];
          if (widgets) {
            for (const w of widgets) {
              const wCount = w.variants?.length || 0;
              componentOptions += `<option value="${w.type}">\u00A0\u00A0\u00A0\u00A0${w.name} (${wCount})</option>`;
            }
          }
        }
      }
      componentOptions += `</optgroup>`;
    }
    // Render any remaining groups not in groupOrder
    const knownSources = new Set(groupOrder.map(g => g.source));
    for (const [source, items] of Object.entries(grouped)) {
      if (knownSources.has(source)) continue;
      componentOptions += `<optgroup label="${source}">`;
      for (const c of items) {
        const name = c.name || c.type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const count = c.variants?.length || 0;
        componentOptions += `<option value="${c.type}">${name} (${count})</option>`;
      }
      componentOptions += `</optgroup>`;
    }

    this.appNav.innerHTML = `
      <nav class="breadcrumb" id="stage-breadcrumb" aria-label="Breadcrumb">
        <a href="#systems" class="breadcrumb-link">Systems</a>
        <span class="breadcrumb-sep">/</span>
        <span class="breadcrumb-current" id="breadcrumb-system-name">${systemName}</span>
      </nav>
      <span class="docs-nav__divider"></span>
      <a href="#" class="docs-nav__link" data-section="color">Color</a>
      <a href="#" class="docs-nav__link" data-section="typography">Typography</a>
      <a href="#" class="docs-nav__link" data-section="spacing">Spacing</a>
      <a href="#" class="docs-nav__link" data-section="elevation">Elevation</a>
      <a href="#" class="docs-nav__link" data-section="examples">Examples</a>
      <a href="#principles" class="docs-nav__link">Principles</a>
      <a href="#qa" class="docs-nav__link">QA</a>
      <span class="docs-nav__spacer"></span>
      <select class="docs-nav__select" id="component-select">
        <option value="">Component...</option>
        ${componentOptions}
      </select>
      <select class="docs-nav__select" id="variant-select" hidden>
        <option value="">Variant...</option>
      </select>
      <div class="state-toggles" id="state-toggles">
        <button class="state-btn active" data-state="default" title="Default">○</button>
        <button class="state-btn" data-state="hover" title="Hover">◉</button>
        <button class="state-btn" data-state="focus" title="Focus">◎</button>
        <button class="state-btn" data-state="disabled" title="Disabled">◌</button>
      </div>
      <div class="view-toggle">
        <button class="toggle-btn active" data-context="design">Design</button>
        <button class="toggle-btn" data-context="code">Code</button>
      </div>
    `;

    // Rebind viewer events to the newly created nav elements
    if (this.viewer) {
      this.viewer.rebindNav(this.appNav);
    }

    // Set active foundation link if applicable
    if (route.section) {
      const activeLink = this.appNav.querySelector(`[data-section="${route.section}"]`);
      if (activeLink) activeLink.classList.add('active');
    }
  }

  /**
   * Initialize the viewer
   */
  initViewer() {
    const viewerContainer = DOMUtils.$('#docs-view');
    if (viewerContainer) {
      this.viewer = new DesignSystemViewer(viewerContainer);
    }
  }

  /**
   * Initialize the variant audit module
   */
  initVariantAudit() {
    const qaContainer = DOMUtils.$('#qa-view');
    if (qaContainer) {
      this.variantAudit = new VariantAudit({
        container: qaContainer,
        systemId: 'default',
        onToast: (msg) => this.showToast(msg)
      });

      // Wire blocked toggle button
      const blockedToggle = DOMUtils.$('#qa-blocked-toggle');
      if (blockedToggle) {
        blockedToggle.addEventListener('click', () => this.variantAudit.toggleBlockedSection());
      }
    }
  }

  /**
   * Called when a component is selected in the QA component filter.
   * Opens the Usage Inspector for that component.
   */
  _onQAComponentSelect(componentType) {
    if (!this.usageInspector) return;
    if (!componentType) {
      this.usageInspector.hide();
      return;
    }
    const ds = this.viewer?.designSystem;
    if (!ds) return;
    const component = ds.components?.find(c => c.type === componentType || c.name === componentType);
    if (component) {
      this.usageInspector.show(component);
    } else {
      this.usageInspector.hide();
    }
  }

  /**
   * Initialize the Usage Inspector
   */
  initUsageInspector() {
    const mount = DOMUtils.$('#usage-inspector-mount');
    if (mount) {
      this.usageInspector = new UsageInspector({
        container: mount,
        onToast: (msg, type) => this.showToast(msg, type)
      });
    }
  }

  /**
   * Open the scan modal
   */
  openScanModal() {
    if (this.scanModal) {
      this.scanModal.classList.add('open');
      // Restore saved tokens
      try {
        const ft = localStorage.getItem('systemic-figma-token');
        const gt = localStorage.getItem('systemic-github-token');
        if (ft && this.scanFigmaToken) this.scanFigmaToken.value = ft;
        if (gt && this.scanGithubToken) this.scanGithubToken.value = gt;
      } catch {}
      this.scanUrlInput?.focus();
    }
  }

  /**
   * Close the scan modal
   */
  closeScanModal() {
    if (this.scanModal) {
      this.scanModal.classList.remove('open');
      if (this.scanUrlInput) this.scanUrlInput.value = '';
    }
  }

  /**
   * Start a GitHub repo scan
   */
  async startGitHubScan(repoUrl, token) {
    const name = repoUrl.replace(/^https?:\/\/github\.com\//i, '').split('/').slice(0, 2).join('/');
    this.debugLog('GITHUB', `Starting GitHub scan: ${repoUrl}`);

    this.navigateTo('audit');
    await new Promise(r => setTimeout(r, 50)); // let view activate

    this.auditFormSection.hidden = true;
    this.auditProgressSection.hidden = false;
    this.auditUrlDisplay.textContent = repoUrl;
    this.auditStatusText.textContent = 'Connecting to GitHub...';
    this.clearLog();

    this.codeParser = new CodeParser({
      token,
      onLog: (log) => this.addLogEntry(log),
      onProgress: (progress) => this.updateProgress(progress)
    });

    this.currentAudit = {
      id: crypto.randomUUID(),
      config: { url: repoUrl, name, source: 'github' },
      startedAt: new Date().toISOString()
    };

    try {
      const results = await this.codeParser.parse(repoUrl);
      await this.onAuditComplete(results);
    } catch (err) {
      this.onAuditError(err);
    }
  }

  /**
   * Start a Figma file scan
   */
  async startFigmaScan(figmaUrl, token) {
    const name = figmaUrl.replace(/\?.*/, '').split('/').pop()?.replace(/-/g, ' ') || 'Figma File';
    this.debugLog('FIGMA', `Starting Figma scan: ${figmaUrl}`);

    this.navigateTo('audit');
    await new Promise(r => setTimeout(r, 50));

    this.auditFormSection.hidden = true;
    this.auditProgressSection.hidden = false;
    this.auditUrlDisplay.textContent = figmaUrl;
    this.auditStatusText.textContent = 'Connecting to Figma...';
    this.clearLog();

    this.figmaParser = new FigmaParser({
      token,
      onLog: (log) => this.addLogEntry(log),
      onProgress: (progress) => this.updateProgress(progress)
    });

    this.currentAudit = {
      id: crypto.randomUUID(),
      config: { url: figmaUrl, name, source: 'figma' },
      startedAt: new Date().toISOString()
    };

    try {
      const results = await this.figmaParser.parse(figmaUrl);
      await this.onAuditComplete(results);
    } catch (err) {
      this.onAuditError(err);
    }
  }

  /**
   * Navigate to a hash route, forcing handleRoute even if hash is unchanged
   */
  navigateTo(hash) {
    if (window.location.hash === `#${hash}`) {
      this.handleRoute();
    } else {
      window.location.hash = hash;
    }
  }

  /**
   * Switch between views by updating the URL hash
   */
  switchView(view) {
    this.navigateTo(view);
  }

  /**
   * Start a new audit
   */
  async startAudit() {
    const formData = new FormData(this.auditForm);
    const rawUrl = formData.get('url');

    this.debugLog('AUDIT', '=== Starting New Audit ===');
    this.debugLog('AUDIT', `Raw URL input: "${rawUrl}"`);

    // Normalize the URL
    const normalizedUrl = this.normalizeUrl(rawUrl);
    if (!normalizedUrl) {
      this.showToast('Please enter a valid URL (e.g., example.com or https://example.com)', 'error');
      return;
    }

    // Check for existing design system with this URL
    const urlKey = this.getUrlKey(normalizedUrl);

    // Find all matching systems (there might be duplicates from before the fix)
    const matchingSystems = this.designSystems.filter(ds =>
      this.getUrlKey(ds.sourceUrl) === urlKey
    );

    // Prefer the one with the most data (components > 0), or the most recent
    let existingSystem = null;
    if (matchingSystems.length > 0) {
      this.debugLog('AUDIT', `Found ${matchingSystems.length} existing system(s) for URL key: ${urlKey}`);

      // Sort by: has data (components > 0) first, then by most components
      matchingSystems.sort((a, b) => {
        const aComponents = a.stats?.components || 0;
        const bComponents = b.stats?.components || 0;
        return bComponents - aComponents; // Descending by component count
      });

      existingSystem = matchingSystems[0];
      this.debugLog('AUDIT', `Selected system with most data:`, {
        id: existingSystem.id,
        components: existingSystem.stats?.components || 0,
        tokens: existingSystem.stats?.tokens || 0
      });

      // If there are duplicates, log a warning
      if (matchingSystems.length > 1) {
        this.debugLog('AUDIT', `WARNING: ${matchingSystems.length - 1} duplicate system(s) found for this URL`);
        this.addLogEntry({
          type: 'warning',
          message: `Found ${matchingSystems.length} duplicate entries for this URL - using the one with most data`
        });
      }
    } else {
      this.debugLog('AUDIT', `No existing design system found for URL key: ${urlKey}`);
    }

    const config = {
      url: normalizedUrl,
      name: formData.get('name') || new URL(normalizedUrl).hostname,
      maxPages: parseInt(formData.get('maxPages')) || 50,
      crawlDepth: parseInt(formData.get('crawlDepth')) || 3,
      authType: formData.get('authType') || 'none',
      authData: formData.get('authData') || null,
      excludePatterns: (formData.get('excludePatterns') || '')
        .split('\n')
        .filter(p => p.trim()),
      existingSystemId: existingSystem?.id || null
    };

    this.debugLog('AUDIT', 'Audit config:', config);

    // Show progress section
    this.auditFormSection.hidden = true;
    this.auditProgressSection.hidden = false;
    this.auditUrlDisplay.textContent = config.url;
    this.auditStatusText.textContent = 'Initializing crawler...';
    this.clearLog();

    // Create crawler with Supabase credentials for edge function fetching
    this.crawler = new AgenticCrawler({
      ...config,
      supabaseUrl: this.supabaseUrl,
      supabaseKey: this.supabaseKey,
      onProgress: (progress) => this.updateProgress(progress),
      onPageCrawled: (data) => this.onPageCrawled(data),
      onComponentFound: (component) => this.onComponentFound(component),
      onComplete: (results) => this.onAuditComplete(results),
      onError: (error) => this.onAuditError(error),
      onLog: (log) => this.addLogEntry(log)
    });

    // Start crawling
    try {
      this.currentAudit = {
        id: crypto.randomUUID(),
        config,
        startedAt: new Date().toISOString()
      };

      this.addLogEntry({ type: 'info', message: `Starting audit of ${config.url}` });
      await this.crawler.start(config.url);

    } catch (error) {
      this.onAuditError(error);
    }
  }

  /**
   * Update progress display
   */
  updateProgress(progress) {
    const percentage = progress.pagesTotal > 0
      ? Math.round((progress.pagesCrawled / progress.pagesTotal) * 100)
      : 0;

    this.auditProgressFill.style.width = `${percentage}%`;
    this.pagesCrawled.textContent = progress.pagesCrawled;
    this.tokensExtracted.textContent = progress.tokensExtracted;
    this.componentsFound.textContent = progress.componentsFound;
    this.auditStatusText.textContent = `Crawling: ${progress.currentUrl || '...'}`;
  }

  /**
   * Handle page crawled event
   */
  onPageCrawled(data) {
    this.addLogEntry({
      type: 'success',
      message: `Crawled: ${data.url} (${data.components} components, ${data.tokens} tokens)`
    });
  }

  /**
   * Handle component found event
   */
  onComponentFound(component) {
    // Could show real-time component discovery
  }

  /**
   * Handle audit completion
   */
  async onAuditComplete(results) {
    this.debugLog('COMPLETE', '=== Audit Complete ===');
    this.debugLog('COMPLETE', 'Raw crawl results:', {
      pagesCrawled: results.pagesCrawled,
      componentsFound: results.components?.length || 0,
      tokensFound: results.tokens?.length || 0,
      pagesData: results.pages?.length || 0
    });

    this.addLogEntry({ type: 'success', message: 'Crawl complete! Processing results...' });
    this.auditStatusText.textContent = 'Processing tokens...';

    try {
      // Process tokens
      this.debugLog('TOKENS', 'Processing extracted tokens...');
      const tokens = this.tokenMapper.processExtractedData(results);
      this.debugLog('TOKENS', 'Processed tokens:', {
        hasColors: !!tokens?.colors,
        colorCount: tokens?.colors ? Object.keys(tokens.colors).length : 0,
        hasTypography: !!tokens?.typography,
        hasSpacing: !!tokens?.spacing
      });

      // Log raw components detail
      this.debugLog('COMPONENTS', `Found ${results.components?.length || 0} raw components`);
      if (results.components?.length > 0) {
        const componentTypes = {};
        results.components.forEach(c => {
          componentTypes[c.type] = (componentTypes[c.type] || 0) + 1;
        });
        this.debugLog('COMPONENTS', 'Raw component types:', componentTypes);

        // Consolidate components
        this.auditStatusText.textContent = 'Consolidating components...';
        this.addLogEntry({ type: 'info', message: 'Consolidating components by type and variant...' });

        const consolidatedComponents = this.componentConsolidator.consolidate(results.components);

        this.debugLog('COMPONENTS', `Consolidated into ${consolidatedComponents.length} component types`);
        consolidatedComponents.forEach(comp => {
          this.debugLog('COMPONENTS', `  - ${comp.name}: ${comp.variants.length} variants, ${comp.totalUsage} usages`);
        });

        // Replace raw components with consolidated ones
        results.components = consolidatedComponents;

        this.addLogEntry({
          type: 'success',
          message: `Consolidated into ${consolidatedComponents.length} component types`
        });
      } else {
        this.debugLog('COMPONENTS', 'WARNING: No components were detected!');
        this.addLogEntry({ type: 'warning', message: 'No components detected - check console for details' });
      }

      // Check if we're updating an existing system
      const existingId = this.currentAudit.config.existingSystemId;
      const isUpdate = !!existingId;

      this.debugLog('SAVE', isUpdate
        ? `Updating existing design system: ${existingId}`
        : 'Creating new design system');

      // Generate documentation
      const designSystem = {
        id: isUpdate ? existingId : this.currentAudit.id,
        name: this.currentAudit.config.name,
        sourceUrl: this.currentAudit.config.url,
        tokens,
        components: results.components,
        pages: results.pages,
        createdAt: isUpdate ? this.getExistingCreatedAt(existingId) : new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      this.auditStatusText.textContent = 'Generating documentation...';
      designSystem.documentation = await this.docGenerator.generateDocumentation(designSystem);

      // Save design system
      this.saveDesignSystem(designSystem, isUpdate);

      const actionText = isUpdate ? 'updated' : 'generated';
      this.addLogEntry({ type: 'success', message: `Design system ${actionText} successfully!` });
      this.auditStatusText.textContent = 'Complete!';

      // Log final stats
      this.debugLog('COMPLETE', 'Final design system:', {
        id: designSystem.id,
        name: designSystem.name,
        sourceUrl: designSystem.sourceUrl,
        tokenCount: this.countTokens(designSystem.tokens),
        componentCount: designSystem.components?.length || 0,
        pageCount: designSystem.pages?.length || 0,
        isUpdate
      });

      // Show toast
      this.showToast(`Design system ${actionText} successfully!`);

      // Switch to docs view after delay
      setTimeout(() => {
        this.setActiveSystem(designSystem);
        this.navigateTo('docs/color');
        this.resetAuditForm();
      }, 1500);

    } catch (error) {
      this.debugLog('ERROR', 'Audit completion error:', error);
      this.onAuditError(error);
    }
  }

  /**
   * Get createdAt from existing system
   */
  getExistingCreatedAt(id) {
    const existing = this.designSystems.find(ds => ds.id === id);
    return existing?.createdAt || new Date().toISOString();
  }

  /**
   * Handle audit error
   */
  onAuditError(error) {
    console.error('Audit error:', error);
    this.addLogEntry({ type: 'error', message: `Error: ${error.message}` });
    this.auditStatusText.textContent = 'Audit failed';
    this.showToast(`Audit failed: ${error.message}`, 'error');
  }

  /**
   * Cancel current audit
   */
  cancelAudit() {
    if (this.crawler) {
      this.crawler.stop();
      this.addLogEntry({ type: 'info', message: 'Audit cancelled by user' });
    }
    if (this.codeParser) {
      this.codeParser.stop();
      this.addLogEntry({ type: 'info', message: 'GitHub scan cancelled' });
    }
    if (this.figmaParser) {
      this.figmaParser.stop();
      this.addLogEntry({ type: 'info', message: 'Figma scan cancelled' });
    }
    this.resetAuditForm();
  }

  /**
   * Reset audit form
   */
  resetAuditForm() {
    this.auditFormSection.hidden = false;
    this.auditProgressSection.hidden = true;
    this.auditForm.reset();
    this.crawler = null;
    this.currentAudit = null;
  }

  /**
   * Add log entry
   */
  addLogEntry(log) {
    const timestamp = new Date().toISOString();

    // Add to debug logs for export
    this.debugLogs.push({
      timestamp,
      category: 'CRAWL',
      message: log.message,
      data: null
    });

    // Add to UI
    const entry = DOMUtils.createElement('div', {
      className: `log-entry ${log.type}`
    }, [
      DOMUtils.createElement('span', { className: 'log-time' }, [
        new Date().toLocaleTimeString()
      ]),
      DOMUtils.createElement('span', { className: 'log-message' }, [
        log.message
      ])
    ]);

    this.crawlLog?.appendChild(entry);
    this.crawlLog.scrollTop = this.crawlLog.scrollHeight;
  }

  /**
   * Clear log
   */
  clearLog() {
    if (this.crawlLog) {
      this.crawlLog.innerHTML = '';
    }
  }

  /**
   * Save design system to localStorage
   */
  saveDesignSystem(designSystem, isUpdate = false) {
    this.debugLog('SAVE', `Saving design system (isUpdate: ${isUpdate})`, {
      id: designSystem.id,
      name: designSystem.name,
      componentCount: designSystem.components?.length || 0
    });

    if (isUpdate) {
      // Find and update existing system
      const index = this.designSystems.findIndex(ds => ds.id === designSystem.id);
      if (index !== -1) {
        const oldSystem = this.designSystems[index];
        this.debugLog('SAVE', 'Replacing existing system at index:', index);
        this.debugLog('SAVE', 'Old stats:', {
          components: oldSystem.stats?.components || 0,
          tokens: oldSystem.stats?.tokens || 0
        });
        this.designSystems[index] = {
          id: designSystem.id,
          name: designSystem.name,
          sourceUrl: designSystem.sourceUrl,
          createdAt: designSystem.createdAt,
          updatedAt: designSystem.updatedAt,
          stats: {
            tokens: this.countTokens(designSystem.tokens),
            components: designSystem.components?.length || 0,
            pages: designSystem.pages?.length || 0
          }
        };
        this.debugLog('SAVE', 'New stats:', this.designSystems[index].stats);
      } else {
        this.debugLog('SAVE', 'WARNING: Could not find existing system to update, adding as new');
        this.designSystems.push({
          id: designSystem.id,
          name: designSystem.name,
          sourceUrl: designSystem.sourceUrl,
          createdAt: designSystem.createdAt,
          updatedAt: designSystem.updatedAt,
          stats: {
            tokens: this.countTokens(designSystem.tokens),
            components: designSystem.components?.length || 0,
            pages: designSystem.pages?.length || 0
          }
        });
      }
    } else {
      // Add new system
      this.debugLog('SAVE', 'Adding new design system');
      this.designSystems.push({
        id: designSystem.id,
        name: designSystem.name,
        sourceUrl: designSystem.sourceUrl,
        createdAt: designSystem.createdAt,
        stats: {
          tokens: this.countTokens(designSystem.tokens),
          components: designSystem.components?.length || 0,
          pages: designSystem.pages?.length || 0
        }
      });
    }

    try {
      // Save index
      localStorage.setItem('systemic-design-systems', JSON.stringify(this.designSystems));
      this.debugLog('SAVE', 'Saved design systems index to localStorage');

      // Store full data separately
      localStorage.setItem(`systemic-ds-${designSystem.id}`, JSON.stringify(designSystem));
      this.debugLog('SAVE', `Saved full design system data: systemic-ds-${designSystem.id}`);

    } catch (error) {
      console.warn('Failed to save to localStorage:', error);
      this.debugLog('SAVE', 'ERROR saving to localStorage:', error);
      this.showToast('Storage full — design system data could not be saved. Try deleting unused systems.', 'error');
    }
  }

  /**
   * Count tokens
   */
  countTokens(tokens) {
    let count = 0;
    if (tokens?.colors) {
      count += tokens.colors.primary ? 1 : 0;
      count += tokens.colors.secondary ? 1 : 0;
      count += tokens.colors.neutral?.length || 0;
    }
    count += tokens?.typography?.typescale?.length || 0;
    count += tokens?.spacing?.scale?.length || 0;
    return count;
  }

  /**
   * Load saved design systems
   */
  loadSavedSystems() {
    try {
      const saved = localStorage.getItem('systemic-design-systems');
      if (saved) {
        this.designSystems = JSON.parse(saved);
      }
    } catch (error) {
      console.warn('Failed to load saved systems:', error);
    }
  }

  /**
   * Set the active design system (loads into viewer + persists ID for reload)
   */
  setActiveSystem(fullSystem) {
    this.viewer.load(fullSystem);
    this.variantAudit?.registerFromDesignSystem(fullSystem);
    try {
      localStorage.setItem('systemic-active-system', fullSystem.id);
    } catch (e) { /* quota exceeded — non-critical */ }
  }

  /**
   * Restore the last-active design system into the viewer (for page reload)
   * Returns true if a system was restored, false otherwise
   */
  restoreActiveSystem() {
    const activeId = localStorage.getItem('systemic-active-system');
    if (!activeId) return false;

    // For local design system, always rebuild fresh from manifest
    // so template previews use current code (not stale cached HTML)
    if (activeId === 'local-ctrl-design-system') {
      this.debugLog('RESTORE', 'Local system detected — rebuilding from manifest');
      this.loadLocalDesignSystem();
      return true;
    }

    const fullSystem = this.loadDesignSystem(activeId);
    if (!fullSystem) return false;

    this.debugLog('RESTORE', `Restoring active system: ${activeId}`);
    this.viewer.load(fullSystem);
    this.variantAudit?.registerFromDesignSystem(fullSystem);
    return true;
  }

  /**
   * Load full design system
   */
  loadDesignSystem(id) {
    try {
      const data = localStorage.getItem(`systemic-ds-${id}`);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to load design system:', error);
    }
    return null;
  }

  /**
   * Delete design system
   */
  deleteDesignSystem(id) {
    this.designSystems = this.designSystems.filter(ds => ds.id !== id);

    try {
      localStorage.setItem('systemic-design-systems', JSON.stringify(this.designSystems));
      localStorage.removeItem(`systemic-ds-${id}`);
    } catch (error) {
      console.warn('Failed to delete design system:', error);
    }

    this.renderSystemsList();
    this.showToast('Design system deleted');
  }

  /**
   * Render the Principles view.
   * Calls PrinciplesGenerator, then renders global + per-component principles.
   */
  async renderPrinciples() {
    const container = DOMUtils.$('#principles-container');
    if (!container) return;

    const ds = this.viewer?.designSystem;
    if (!ds) {
      container.innerHTML = `
        <div class="principles-empty">
          <div class="principles-empty__icon">◈</div>
          <h3>No design system loaded</h3>
          <p>Open a design system from <a href="#systems">My Systems</a> to generate its principles.</p>
        </div>
      `;
      return;
    }

    // Show loading state
    container.innerHTML = `
      <div class="principles-loading">
        <div class="principles-loading__spinner"></div>
        <p>Analysing design system…</p>
      </div>
    `;

    try {
      const principles = await this.principlesGenerator.generate(ds);

      // Cache on the design system object + persist
      ds.principles = principles;
      this.saveDesignSystem(ds, true);

      container.innerHTML = this._buildPrinciplesHTML(ds, principles);

      // Bind accordion toggles for component sections
      container.querySelectorAll('.pcomp-header').forEach(header => {
        header.addEventListener('click', () => {
          const section = header.closest('.pcomp-section');
          section?.classList.toggle('open');
          header.setAttribute('aria-expanded', String(section?.classList.contains('open')));
        });
      });

      // Regenerate button — clears cache and re-runs
      DOMUtils.$('#principles-regenerate')?.addEventListener('click', () => {
        if (ds.principles) delete ds.principles.generatedAt;
        this.renderPrinciples();
      });

    } catch (err) {
      this.debugLog('PRINCIPLES', 'Error generating principles:', err);
      container.innerHTML = `
        <div class="principles-error">
          <p>Failed to generate principles: ${err.message}</p>
          <button class="btn btn--ghost btn--sm" id="principles-retry">Retry</button>
        </div>
      `;
      DOMUtils.$('#principles-retry')?.addEventListener('click', () => this.renderPrinciples());
    }
  }

  /**
   * Build the full HTML for the Principles view from a principles result object.
   */
  _buildPrinciplesHTML(ds, p) {
    const globalCards = (p.globalPrinciples || []).map(pr => `
      <div class="principle-card">
        <h4 class="principle-card__title">${this._escHtml(pr.title)}</h4>
        <p class="principle-card__desc">${this._escHtml(pr.description)}</p>
      </div>
    `).join('');

    const componentSections = Object.entries(p.componentPrinciples || {}).map(([type, rules]) => {
      if (!rules?.length) return '';
      const ruleItems = rules.map(r => `
        <div class="pcomp-rule">
          <div class="pcomp-rule__rule">${this._escHtml(r.rule)}</div>
          <div class="pcomp-rule__rationale">${this._escHtml(r.rationale)}</div>
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

    return `
      <div class="principles-header">
        <h2 class="principles-title">${this._escHtml(ds.name)}</h2>
        <p class="principles-philosophy">${this._escHtml(p.philosophyStatement || '')}</p>
        ${aiLabel ? `<span class="principles-meta">${aiLabel}</span>` : ''}
        <button class="btn btn--ghost btn--sm" id="principles-regenerate">Regenerate</button>
      </div>

      <section class="principles-section">
        <h3 class="principles-section__heading">Global Principles</h3>
        <div class="principles-grid">${globalCards}</div>
      </section>

      ${componentSections ? `
      <section class="principles-section">
        <h3 class="principles-section__heading">Component Principles</h3>
        <div class="pcomp-list">${componentSections}</div>
      </section>
      ` : ''}
    `;
  }

  _escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render systems list
   */
  renderSystemsList() {
    if (!this.systemsGrid) return;

    if (this.designSystems.length === 0) {
      this.systemsGrid.innerHTML = `
        <div class="empty-state" id="no-systems">
          <div class="empty-icon">+</div>
          <h3>No design systems yet</h3>
          <p>Scan a website or load a local design system to get started.</p>
          <button class="btn btn--filled" id="empty-run-scan-btn">Run a scan</button>
        </div>
      `;
      DOMUtils.$('#empty-run-scan-btn')?.addEventListener('click', () => this.openScanModal());
      return;
    }

    this.systemsGrid.innerHTML = this.designSystems.map(ds => `
      <div class="system-card" data-id="${ds.id}">
        <div class="system-card-header">
          <h3 class="system-card-title">${ds.name}</h3>
          <div class="system-card-actions">
            <span class="system-card-date">${this.formatDate(ds.createdAt)}</span>
            <button class="system-card-delete" data-delete-id="${ds.id}" title="Delete design system">×</button>
          </div>
        </div>
        <div class="system-card-url">${ds.sourceUrl}</div>
        <div class="system-card-stats">
          <div class="system-stat">
            <span class="system-stat-value">${ds.stats?.tokens || 0}</span>
            <span class="system-stat-label">Tokens</span>
          </div>
          <div class="system-stat">
            <span class="system-stat-value">${ds.stats?.components || 0}</span>
            <span class="system-stat-label">Components</span>
          </div>
          <div class="system-stat">
            <span class="system-stat-value">${ds.stats?.pages || 0}</span>
            <span class="system-stat-label">Pages</span>
          </div>
        </div>
      </div>
    `).join('');

    // Bind click events for opening design system (only cards with data-id)
    DOMUtils.$$('.system-card[data-id]', this.systemsGrid).forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't open if clicking delete button
        if (e.target.closest('.system-card-delete')) return;

        const id = card.dataset.id;
        const fullSystem = this.loadDesignSystem(id);
        if (fullSystem) {
          this.setActiveSystem(fullSystem);
          this.navigateTo('docs/color');
        } else {
          this.showToast('Could not load design system data — it may need to be re-scanned', 'error');
        }
      });
    });

    // Bind delete button events
    DOMUtils.$$('.system-card-delete', this.systemsGrid).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        const ds = this.designSystems.find(d => d.id === id);
        const name = ds?.name || 'this design system';

        if (confirm(`Delete "${name}"? This cannot be undone.`)) {
          this.deleteDesignSystem(id);
        }
      });
    });
  }

  /**
   * Format date
   */
  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  /**
   * Toggle theme
   */
  toggleTheme() {
    document.documentElement.classList.toggle('light');
    const isLight = document.documentElement.classList.contains('light');
    localStorage.setItem('systemic-theme', isLight ? 'light' : 'dark');
  }

  /**
   * Show toast notification
   */
  showToast(message, type = 'info') {
    const toast = DOMUtils.createElement('div', {
      className: `toast ${type === 'error' ? 'toast--error' : ''}`
    }, [message]);

    this.toastContainer?.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.systemicApp = new SystemicApp();
});
