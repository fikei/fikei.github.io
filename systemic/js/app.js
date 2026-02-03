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
    this.docGenerator = new DocGenerator({
      aiEnabled: true,
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_ANON_KEY
    });
    this.viewer = null;
    this.currentAudit = null;
    this.designSystems = [];

    this.init();
  }

  /**
   * Initialize the application
   */
  init() {
    this.bindElements();
    this.bindEvents();
    this.loadSavedSystems();
    this.initViewer();
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
    // Navigation
    this.navButtons.forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.view));
    });

    // Audit form submission
    this.auditForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.startAudit();
    });

    // Cancel audit
    this.cancelAuditBtn?.addEventListener('click', () => this.cancelAudit());

    // Auth type change
    this.authTypeSelect?.addEventListener('change', () => {
      const showAuthData = this.authTypeSelect.value !== 'none';
      if (this.authDataGroup) {
        this.authDataGroup.hidden = !showAuthData;
      }
    });

    // Theme toggle
    this.themeToggle?.addEventListener('click', () => this.toggleTheme());

    // Go to audit button
    DOMUtils.$('[data-action="go-to-audit"]')?.addEventListener('click', () => {
      this.switchView('audit');
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
   * Switch between views
   */
  switchView(view) {
    // Update navigation
    this.navButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });

    // Update panels
    this.viewPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === `${view}-view`);
    });

    // Load content for specific views
    if (view === 'systems') {
      this.renderSystemsList();
    }
  }

  /**
   * Start a new audit
   */
  async startAudit() {
    const formData = new FormData(this.auditForm);
    const config = {
      url: formData.get('url'),
      name: formData.get('name') || new URL(formData.get('url')).hostname,
      maxPages: parseInt(formData.get('maxPages')) || 50,
      crawlDepth: parseInt(formData.get('crawlDepth')) || 3,
      authType: formData.get('authType') || 'none',
      authData: formData.get('authData') || null,
      excludePatterns: (formData.get('excludePatterns') || '')
        .split('\n')
        .filter(p => p.trim())
    };

    // Validate URL
    try {
      new URL(config.url);
    } catch (e) {
      this.showToast('Please enter a valid URL', 'error');
      return;
    }

    // Show progress section
    this.auditFormSection.hidden = true;
    this.auditProgressSection.hidden = false;
    this.auditUrlDisplay.textContent = config.url;
    this.auditStatusText.textContent = 'Initializing crawler...';
    this.clearLog();

    // Create crawler
    this.crawler = new AgenticCrawler({
      ...config,
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
    this.addLogEntry({ type: 'success', message: 'Crawl complete! Processing results...' });
    this.auditStatusText.textContent = 'Processing tokens...';

    try {
      // Process tokens
      const tokens = this.tokenMapper.processExtractedData(results);

      // Generate documentation
      const designSystem = {
        id: this.currentAudit.id,
        name: this.currentAudit.config.name,
        sourceUrl: this.currentAudit.config.url,
        tokens,
        components: results.components,
        pages: results.pages,
        createdAt: new Date().toISOString()
      };

      this.auditStatusText.textContent = 'Generating documentation...';
      designSystem.documentation = await this.docGenerator.generateDocumentation(designSystem);

      // Save design system
      this.saveDesignSystem(designSystem);

      this.addLogEntry({ type: 'success', message: 'Design system generated successfully!' });
      this.auditStatusText.textContent = 'Complete!';

      // Show toast
      this.showToast('Design system generated successfully!');

      // Switch to docs view after delay
      setTimeout(() => {
        this.viewer.load(designSystem);
        this.switchView('docs');
        this.resetAuditForm();
      }, 1500);

    } catch (error) {
      this.onAuditError(error);
    }
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
  saveDesignSystem(designSystem) {
    this.designSystems.push(designSystem);

    try {
      localStorage.setItem('systemic-design-systems', JSON.stringify(
        this.designSystems.map(ds => ({
          id: ds.id,
          name: ds.name,
          sourceUrl: ds.sourceUrl,
          createdAt: ds.createdAt,
          stats: {
            tokens: this.countTokens(ds.tokens),
            components: ds.components?.length || 0,
            pages: ds.pages?.length || 0
          }
        }))
      ));

      // Store full data separately
      localStorage.setItem(`systemic-ds-${designSystem.id}`, JSON.stringify(designSystem));

    } catch (error) {
      console.warn('Failed to save to localStorage:', error);
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
          <button class="btn btn--filled" data-action="go-to-audit">Start Audit</button>
        </div>
      `;

      DOMUtils.$('[data-action="go-to-audit"]', this.systemsGrid)
        ?.addEventListener('click', () => this.switchView('audit'));
      return;
    }

    this.systemsGrid.innerHTML = this.designSystems.map(ds => `
      <div class="system-card" data-id="${ds.id}">
        <div class="system-card-header">
          <h3 class="system-card-title">${ds.name}</h3>
          <span class="system-card-date">${this.formatDate(ds.createdAt)}</span>
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

    // Bind click events
    DOMUtils.$$('.system-card', this.systemsGrid).forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const fullSystem = this.loadDesignSystem(id);
        if (fullSystem) {
          this.viewer.load(fullSystem);
          this.switchView('docs');
        } else {
          this.showToast('Failed to load design system', 'error');
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
