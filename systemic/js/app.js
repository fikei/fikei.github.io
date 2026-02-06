/**
 * SystemicAI - Main Application
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
    this.tokenMapper = new TokenMapper();
    this.componentConsolidator = new ComponentConsolidator();
    this.docGenerator = new DocGenerator({
      aiEnabled: true,
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_ANON_KEY
    });
    this.viewer = null;
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
    const prefix = `[SystemicAI:${category}]`;

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
    this.initRouter();
  }

  /**
   * Bind DOM elements
   */
  bindElements() {
    // Navigation
    this.navButtons = DOMUtils.$$('.nav-btn');
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

    // Debug log export buttons
    DOMUtils.$('#copy-debug-log')?.addEventListener('click', () => this.copyDebugLogs());
    DOMUtils.$('#download-debug-log')?.addEventListener('click', () => this.downloadDebugLogs());

    // Auth type change
    this.authTypeSelect?.addEventListener('change', () => {
      const showAuthData = this.authTypeSelect.value !== 'none';
      if (this.authDataGroup) {
        this.authDataGroup.hidden = !showAuthData;
      }
    });

    // Theme toggle
    this.themeToggle?.addEventListener('click', () => this.toggleTheme());
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

    // Switch to the correct view panel
    this.activateView(route.view);

    // Handle sub-routes for docs view
    if (route.view === 'docs') {
      // If a system is loaded and a section is specified, navigate to it
      if (this.viewer?.designSystem && route.section) {
        const foundations = ['color', 'typography', 'spacing', 'elevation'];
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

    // Load systems list when switching to systems view
    if (route.view === 'systems') {
      this.renderSystemsList();
    }
  }

  /**
   * Activate a view panel and update nav state
   */
  activateView(view) {
    // Update navigation links
    this.navButtons.forEach(btn => {
      const btnView = btn.getAttribute('href')?.slice(1) || btn.dataset.view;
      btn.classList.toggle('active', btnView === view);
    });

    // Update panels
    this.viewPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `${view}-view`);
    });
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
   * Switch between views by updating the URL hash
   */
  switchView(view) {
    window.location.hash = view;
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
        this.viewer.load(designSystem);
        window.location.hash = 'docs/color';
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
   * Render systems list
   */
  renderSystemsList() {
    if (!this.systemsGrid) return;

    if (this.designSystems.length === 0) {
      this.systemsGrid.innerHTML = `
        <div class="empty-state" id="no-systems">
          <div class="empty-icon">+</div>
          <h3>No design systems yet</h3>
          <p>Start an audit to generate your first design system.</p>
          <a class="btn btn--filled" href="#audit">Start Audit</a>
        </div>
      `;
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

    // Bind click events for opening design system
    DOMUtils.$$('.system-card', this.systemsGrid).forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't open if clicking delete button
        if (e.target.closest('.system-card-delete')) return;

        const id = card.dataset.id;
        const fullSystem = this.loadDesignSystem(id);
        if (fullSystem) {
          this.viewer.load(fullSystem);
          window.location.hash = 'docs/color';
        } else {
          this.showToast('Failed to load design system', 'error');
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
