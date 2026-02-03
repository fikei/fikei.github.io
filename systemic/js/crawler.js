/**
 * SystemicAI - Agentic Crawler
 * Navigates websites and extracts design components
 */

class AgenticCrawler {
  constructor(config = {}) {
    this.config = {
      maxPages: config.maxPages || 50,
      maxDepth: config.maxDepth || 3,
      timeout: config.timeout || 30000,
      excludePatterns: config.excludePatterns || [],
      authType: config.authType || 'none',
      authData: config.authData || null,
      ...config
    };

    this.urlQueue = [];
    this.visitedUrls = new Set();
    this.discoveredComponents = new Map();
    this.extractedStyles = new Map();
    this.pageData = [];
    this.isRunning = false;
    this.isPaused = false;

    // Callbacks
    this.onProgress = config.onProgress || (() => {});
    this.onPageCrawled = config.onPageCrawled || (() => {});
    this.onComponentFound = config.onComponentFound || (() => {});
    this.onComplete = config.onComplete || (() => {});
    this.onError = config.onError || (() => {});
  }

  /**
   * Start crawling from a URL
   */
  async start(startUrl) {
    this.isRunning = true;
    this.isPaused = false;

    try {
      const baseUrl = new URL(startUrl);
      this.baseUrl = baseUrl.origin;
      this.baseDomain = baseUrl.hostname;

      // Add start URL to queue
      this.urlQueue.push({
        url: startUrl,
        depth: 0,
        referrer: null
      });

      this.log(`Starting crawl of ${startUrl}`);

      // Process queue
      while (this.urlQueue.length > 0 && this.isRunning) {
        if (this.isPaused) {
          await this.sleep(100);
          continue;
        }

        if (this.visitedUrls.size >= this.config.maxPages) {
          this.log(`Reached max pages limit (${this.config.maxPages})`);
          break;
        }

        const target = this.urlQueue.shift();
        await this.crawlPage(target);
      }

      this.log('Crawl complete');
      this.isRunning = false;

      const results = this.getResults();
      this.onComplete(results);
      return results;

    } catch (error) {
      this.onError(error);
      throw error;
    }
  }

  /**
   * Crawl a single page
   */
  async crawlPage(target) {
    const { url, depth, referrer } = target;

    // Skip if already visited
    if (this.visitedUrls.has(url)) {
      return;
    }

    // Skip if exceeds depth
    if (depth > this.config.maxDepth) {
      return;
    }

    // Skip excluded patterns
    if (this.shouldExclude(url)) {
      this.log(`Skipping excluded URL: ${url}`, 'info');
      return;
    }

    this.visitedUrls.add(url);

    try {
      this.log(`Crawling: ${url}`);

      // Create iframe to load page (sandboxed)
      const pageContent = await this.fetchPage(url);

      if (!pageContent) {
        this.log(`Failed to fetch: ${url}`, 'error');
        return;
      }

      // Parse and analyze the page
      const analysis = await this.analyzePage(pageContent, url);

      // Store page data
      this.pageData.push({
        url,
        depth,
        referrer,
        ...analysis,
        crawledAt: new Date().toISOString()
      });

      // Extract new links
      const newLinks = this.extractLinks(pageContent, url);
      newLinks.forEach(link => {
        if (!this.visitedUrls.has(link) &&
            !this.urlQueue.some(q => q.url === link)) {
          this.urlQueue.push({
            url: link,
            depth: depth + 1,
            referrer: url
          });
        }
      });

      // Report progress
      this.onProgress({
        pagesCrawled: this.visitedUrls.size,
        pagesTotal: this.visitedUrls.size + this.urlQueue.length,
        tokensExtracted: this.extractedStyles.size,
        componentsFound: this.discoveredComponents.size,
        currentUrl: url
      });

      this.onPageCrawled({
        url,
        components: analysis.components.length,
        tokens: analysis.tokens.length
      });

    } catch (error) {
      this.log(`Error crawling ${url}: ${error.message}`, 'error');
    }
  }

  /**
   * Fetch page content
   */
  async fetchPage(url) {
    try {
      // For same-origin pages, we can use fetch directly
      // For cross-origin, we need a proxy or extension
      const response = await fetch(url, {
        credentials: this.config.authType !== 'none' ? 'include' : 'same-origin',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      return html;

    } catch (error) {
      // If fetch fails, try using an iframe approach for same-origin
      if (error.message.includes('CORS')) {
        return this.fetchViaProxy(url);
      }
      throw error;
    }
  }

  /**
   * Get authentication headers
   */
  getAuthHeaders() {
    const headers = {};

    if (this.config.authType === 'api-key' && this.config.authData) {
      headers['Authorization'] = `Bearer ${this.config.authData}`;
    }

    return headers;
  }

  /**
   * Fetch via proxy (placeholder for future implementation)
   */
  async fetchViaProxy(url) {
    // In a real implementation, this would use a CORS proxy
    // For now, we'll note this as a limitation
    this.log(`CORS restriction for ${url} - skipping`, 'info');
    return null;
  }

  /**
   * Analyze page content
   */
  async analyzePage(html, url) {
    // Create a temporary document to parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Fix relative URLs
    this.fixRelativeUrls(doc, url);

    // Extract components
    const components = this.extractComponents(doc);

    // Extract tokens (colors, typography, spacing)
    const tokens = this.extractTokens(doc);

    // Generate page hash for change detection
    const domHash = this.generateDOMHash(doc);

    return {
      title: doc.title,
      components,
      tokens,
      domHash,
      linkCount: doc.querySelectorAll('a').length,
      imageCount: doc.querySelectorAll('img').length
    };
  }

  /**
   * Fix relative URLs in document
   */
  fixRelativeUrls(doc, baseUrl) {
    const base = new URL(baseUrl);

    // Fix links
    doc.querySelectorAll('a[href]').forEach(a => {
      try {
        a.href = new URL(a.getAttribute('href'), base).href;
      } catch (e) {}
    });

    // Fix images
    doc.querySelectorAll('img[src]').forEach(img => {
      try {
        img.src = new URL(img.getAttribute('src'), base).href;
      } catch (e) {}
    });

    // Fix stylesheets
    doc.querySelectorAll('link[href]').forEach(link => {
      try {
        link.href = new URL(link.getAttribute('href'), base).href;
      } catch (e) {}
    });
  }

  /**
   * Extract UI components from document
   */
  extractComponents(doc) {
    const components = [];
    const componentSelectors = [
      // Buttons
      'button',
      '[role="button"]',
      'a.btn, a.button, a[class*="btn-"]',
      'input[type="submit"], input[type="button"]',

      // Form elements
      'input[type="text"], input[type="email"], input[type="password"]',
      'input[type="search"], input[type="tel"], input[type="url"]',
      'input[type="number"], input[type="date"]',
      'textarea',
      'select',
      'input[type="checkbox"]',
      'input[type="radio"]',

      // Cards
      '[class*="card"]',
      'article',

      // Navigation
      'nav',
      '[role="navigation"]',
      '[class*="nav"]',
      '[class*="menu"]',

      // Modals/Dialogs
      '[role="dialog"]',
      '[class*="modal"]',
      '[class*="popup"]',

      // Lists
      'ul, ol',

      // Headers
      'header',
      '[class*="header"]',

      // Footers
      'footer',
      '[class*="footer"]',

      // Tabs
      '[role="tablist"]',
      '[class*="tabs"]',

      // Chips/Tags
      '[class*="chip"]',
      '[class*="tag"]',
      '[class*="badge"]'
    ];

    componentSelectors.forEach(selector => {
      try {
        doc.querySelectorAll(selector).forEach(element => {
          const component = this.analyzeComponent(element);
          if (component) {
            // Check for duplicates
            const hash = component.structureHash;
            if (!this.discoveredComponents.has(hash)) {
              this.discoveredComponents.set(hash, component);
              components.push(component);
              this.onComponentFound(component);
            } else {
              // Update usage count
              const existing = this.discoveredComponents.get(hash);
              existing.usageCount = (existing.usageCount || 1) + 1;
            }
          }
        });
      } catch (e) {
        // Invalid selector, skip
      }
    });

    return components;
  }

  /**
   * Analyze a single component
   */
  analyzeComponent(element) {
    // Skip invisible elements
    if (!element.offsetParent && element.style.display !== 'none') {
      return null;
    }

    // Skip very small elements
    if (element.offsetWidth < 10 || element.offsetHeight < 10) {
      return null;
    }

    const type = DOMUtils.detectComponentType(element);
    const styles = DOMUtils.extractDesignStyles(element);
    const structureHash = DOMUtils.generateElementHash(element);

    // Extract classes for pattern detection
    const classes = Array.from(element.classList);

    // Get variants (based on classes that suggest states)
    const variants = classes.filter(c =>
      c.includes('primary') || c.includes('secondary') ||
      c.includes('large') || c.includes('small') ||
      c.includes('outlined') || c.includes('filled') ||
      c.includes('danger') || c.includes('success') ||
      c.includes('warning') || c.includes('info')
    );

    return {
      type,
      tag: element.tagName.toLowerCase(),
      classes,
      variants,
      styles,
      structureHash,
      html: this.getMinimalHTML(element),
      usageCount: 1,
      textContent: element.textContent.trim().slice(0, 50)
    };
  }

  /**
   * Get minimal HTML for component
   */
  getMinimalHTML(element) {
    const clone = element.cloneNode(true);

    // Remove unnecessary attributes
    const removeAttrs = (el) => {
      const attrsToRemove = [];
      for (const attr of el.attributes) {
        if (attr.name.startsWith('data-') ||
            attr.name.startsWith('ng-') ||
            attr.name.startsWith('v-') ||
            attr.name === 'style') {
          attrsToRemove.push(attr.name);
        }
      }
      attrsToRemove.forEach(attr => el.removeAttribute(attr));

      for (const child of el.children) {
        removeAttrs(child);
      }
    };

    removeAttrs(clone);
    return clone.outerHTML;
  }

  /**
   * Extract design tokens from document
   */
  extractTokens(doc) {
    const tokens = [];
    const colorSet = new Set();
    const fontSet = new Set();
    const spacingSet = new Set();

    // Get all elements with computed styles
    const allElements = doc.querySelectorAll('*');

    allElements.forEach(element => {
      // For server-side parsed HTML, we need to extract from inline styles
      // and class-based assumptions since computed styles aren't available
      const style = element.getAttribute('style') || '';

      // Extract colors from inline styles
      const colorMatches = style.match(/(#[a-f0-9]{3,8}|rgb\([^)]+\)|rgba\([^)]+\))/gi) || [];
      colorMatches.forEach(color => {
        if (!colorSet.has(color)) {
          colorSet.add(color);
          const parsed = ColorUtils.parseColor(color);
          if (parsed) {
            tokens.push({
              category: 'color',
              value: color,
              hex: ColorUtils.rgbToHex(parsed.r, parsed.g, parsed.b),
              source: element.tagName.toLowerCase(),
              context: this.getElementContext(element)
            });
          }
        }
      });

      // Extract from style attributes
      const fontFamily = style.match(/font-family:\s*([^;]+)/i);
      if (fontFamily && !fontSet.has(fontFamily[1])) {
        fontSet.add(fontFamily[1]);
        tokens.push({
          category: 'typography',
          property: 'font-family',
          value: fontFamily[1].trim(),
          source: element.tagName.toLowerCase()
        });
      }
    });

    // Also analyze stylesheet links for token hints
    doc.querySelectorAll('style').forEach(style => {
      const cssText = style.textContent;
      this.extractTokensFromCSS(cssText, tokens);
    });

    return tokens;
  }

  /**
   * Extract tokens from CSS text
   */
  extractTokensFromCSS(cssText, tokens) {
    // Extract CSS custom properties
    const customProps = cssText.match(/--[\w-]+:\s*[^;]+/g) || [];
    customProps.forEach(prop => {
      const [name, value] = prop.split(':').map(s => s.trim());
      tokens.push({
        category: 'custom-property',
        name,
        value,
        isVariable: true
      });
    });

    // Extract color values
    const colors = cssText.match(/(#[a-f0-9]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\))/gi) || [];
    colors.forEach(color => {
      const parsed = ColorUtils.parseColor(color);
      if (parsed) {
        tokens.push({
          category: 'color',
          value: color,
          hex: ColorUtils.rgbToHex(parsed.r, parsed.g, parsed.b),
          source: 'stylesheet'
        });
      }
    });
  }

  /**
   * Get context clues about an element's purpose
   */
  getElementContext(element) {
    const context = [];

    // Check classes for semantic hints
    const classes = Array.from(element.classList);
    classes.forEach(cls => {
      if (cls.includes('primary')) context.push('primary');
      if (cls.includes('secondary')) context.push('secondary');
      if (cls.includes('error') || cls.includes('danger')) context.push('error');
      if (cls.includes('success')) context.push('success');
      if (cls.includes('warning')) context.push('warning');
      if (cls.includes('info')) context.push('info');
      if (cls.includes('background') || cls.includes('bg')) context.push('background');
      if (cls.includes('text')) context.push('text');
      if (cls.includes('border')) context.push('border');
    });

    // Check role
    const role = element.getAttribute('role');
    if (role) context.push(role);

    // Check tag semantics
    const tag = element.tagName.toLowerCase();
    if (['button', 'a'].includes(tag)) context.push('interactive');
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) context.push('heading');
    if (['p', 'span', 'div'].includes(tag)) context.push('text');

    return context.join(',');
  }

  /**
   * Generate hash for DOM structure
   */
  generateDOMHash(doc) {
    const structure = {
      title: doc.title,
      bodyClasses: doc.body ? Array.from(doc.body.classList).sort() : [],
      elementCount: doc.querySelectorAll('*').length,
      formCount: doc.querySelectorAll('form').length,
      buttonCount: doc.querySelectorAll('button').length,
      linkCount: doc.querySelectorAll('a').length
    };

    return DOMUtils.hashString(JSON.stringify(structure));
  }

  /**
   * Extract links from page
   */
  extractLinks(html, currentUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = [];
    const currentBase = new URL(currentUrl);

    doc.querySelectorAll('a[href]').forEach(a => {
      try {
        const href = a.getAttribute('href');

        // Skip anchors, javascript, mailto, tel
        if (!href ||
            href.startsWith('#') ||
            href.startsWith('javascript:') ||
            href.startsWith('mailto:') ||
            href.startsWith('tel:')) {
          return;
        }

        const url = new URL(href, currentBase);

        // Only include same-domain links
        if (url.hostname === this.baseDomain) {
          // Normalize URL (remove hash, trailing slash)
          url.hash = '';
          let normalized = url.href;
          if (normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
          }

          links.push(normalized);
        }
      } catch (e) {
        // Invalid URL, skip
      }
    });

    return [...new Set(links)];
  }

  /**
   * Check if URL should be excluded
   */
  shouldExclude(url) {
    const path = new URL(url).pathname;

    return this.config.excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(path);
      }
      return path.includes(pattern);
    });
  }

  /**
   * Get crawl results
   */
  getResults() {
    return {
      url: this.baseUrl,
      pagesCrawled: this.visitedUrls.size,
      pages: this.pageData,
      components: Array.from(this.discoveredComponents.values()),
      tokens: this.aggregateTokens(),
      crawledAt: new Date().toISOString()
    };
  }

  /**
   * Aggregate and deduplicate tokens
   */
  aggregateTokens() {
    const allTokens = [];
    const seen = new Set();

    this.pageData.forEach(page => {
      page.tokens.forEach(token => {
        const key = `${token.category}:${token.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          allTokens.push(token);
        }
      });
    });

    return allTokens;
  }

  /**
   * Pause crawling
   */
  pause() {
    this.isPaused = true;
    this.log('Crawl paused');
  }

  /**
   * Resume crawling
   */
  resume() {
    this.isPaused = false;
    this.log('Crawl resumed');
  }

  /**
   * Stop crawling
   */
  stop() {
    this.isRunning = false;
    this.log('Crawl stopped');
  }

  /**
   * Log message
   */
  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);

    // Emit log event
    if (this.config.onLog) {
      this.config.onLog({ timestamp, type, message });
    }
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AgenticCrawler;
}
